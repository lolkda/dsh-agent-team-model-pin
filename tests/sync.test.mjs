import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installTeamModelSync } from '../src/selection-sync.ts';
import { applyTeamPin } from '../src/pin.ts';

function emitter() {
  const listeners = new Map();
  return {
    on(event, callback) {
      const set = listeners.get(event) ?? new Set();
      set.add(callback);
      listeners.set(event, set);
      return () => set.delete(callback);
    },
    emit(event, payload) {
      for (const callback of listeners.get(event) ?? []) callback(payload);
    },
  };
}

function makeAgent(id, { options }) {
  const events = emitter();
  const selects = [];
  const model = {
    state: undefined,
    current() {
      return this.state !== undefined ? { ...this.state } : options ? { ...options } : undefined;
    },
    select(selection) {
      selects.push({ ...selection });
      this.state = { ...selection };
    },
  };
  return {
    id,
    ctx: { on: events.on },
    options: options ? { ...options } : {},
    session: { requestHeader: () => undefined },
    model,
    selects,
    claim() { events.emit('agent/inbox/claimed', { message: { id: `message-${id}` }, turn: 1 }); },
  };
}

async function harness(t) {
  const dir = await mkdtemp(join(tmpdir(), 'atmp-sync-'));
  const leadA = makeAgent('lead-A', { options: { provider: 'cpa', model: 'gpt-6-astra', reasoningEffort: 'max' } });
  const mateA = makeAgent('mate-A', { options: { provider: 'cpa', model: 'gpt-6-astra', reasoningEffort: 'max' } });
  const leadB = makeAgent('lead-B', { options: { provider: 'p2', model: 'm2', reasoningEffort: 'high' } });
  const mateB = makeAgent('mate-B', { options: { provider: 'p2', model: 'm2', reasoningEffort: 'high' } });
  const memberships = new Map([
    [leadA, { root: leadA, role: 'lead' }], [mateA, { root: leadA, role: 'teammate' }],
    [leadB, { root: leadB, role: 'lead' }], [mateB, { root: leadB, role: 'teammate' }],
  ]);
  let pins = { 'lead-A': { provider: 'cpa', model: 'deepseek-flash', modelDefault: true } };
  const audits = [];
  const effects = [];
  const host = {
    on(event, callback) { return emitter().on(event, callback); },
    get(name) { return name === 'agents' ? { list: () => [leadA, mateA, leadB, mateB] } : undefined; },
    effect(callback) { const disposer = callback(); if (typeof disposer === 'function') effects.push(disposer); return () => {}; },
  };
  const sync = installTeamModelSync(host, (agent) => {
    const membership = memberships.get(agent);
    if (!membership) return undefined;
    const sessionId = membership.root.id;
    const pin = pins[sessionId];
    if (pin === undefined && membership.role !== 'teammate') return undefined;
    const leader = membership.role === 'teammate' ? membership.root.model.current() : undefined;
    return { sessionId, role: membership.role, ...(pin === undefined ? {} : { pin }), ...(leader === undefined ? {} : { leader }) };
  }, (record) => { audits.push(record); });
  t.after(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); await rm(dir, { recursive: true, force: true }); });
  return { leadA, mateA, leadB, mateB, sync, audits, dir, dispose() { for (const effect of effects.reverse()) effect(); },
    setPins(value) { pins = value; },
    async readAudit() {
      try { return (await readFile(join(dir, 'audit.jsonl'), 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse); }
      catch { return []; }
    },
  };
}

test('sync: a teammate selects the Team route at its first step boundary', async (t) => {
  const h = await harness(t);
  assert.equal(h.mateA.model.current().model, 'gpt-6-astra');
  h.mateA.claim();
  assert.deepEqual(h.mateA.model.current(), { provider: 'cpa', model: 'deepseek-flash' });
  assert.equal(h.leadA.model.current().model, 'gpt-6-astra');
  assert.equal(h.audits.length, 1);
  assert.equal(h.audits[0].from.model, 'gpt-6-astra');
  assert.equal(h.audits[0].to.model, 'deepseek-flash');
});

test('sync: a setting change applies to the next step, never to the current one', async (t) => {
  const h = await harness(t);
  h.mateA.claim();
  const current = h.mateA.model.current();
  h.setPins({ 'lead-A': { provider: 'other', model: 'next-model', reasoningEffort: 'low' } });
  assert.deepEqual(h.mateA.model.current(), current, 'the current step keeps its captured selection');
  h.mateA.claim();
  assert.deepEqual(h.mateA.model.current(), { provider: 'other', model: 'next-model', reasoningEffort: 'low' });
});

test('sync: refresh writes a setting change immediately for the next step', async (t) => {
  const h = await harness(t);
  h.mateA.claim();
  h.setPins({ 'lead-A': { provider: 'other', model: 'next-model' } });
  h.sync.refresh();
  assert.deepEqual(h.mateA.model.current(), { provider: 'other', model: 'next-model' });
});

test('sync: two Teams and the Lead keep independent routes', async (t) => {
  const h = await harness(t);
  h.setPins({ 'lead-A': { provider: 'cpa', model: 'deepseek-flash', modelDefault: true },
    'lead-B': { provider: 'p2', model: 'm2' } });
  h.mateA.claim(); h.mateB.claim();
  assert.equal(h.mateA.model.current().model, 'deepseek-flash');
  assert.equal(h.mateB.model.current().model, 'm2');
  assert.equal(h.leadA.model.current().model, 'gpt-6-astra');
  assert.equal(h.leadB.model.current().model, 'm2');
});

test('sync: fresh and resumed teammates both select the Team route', async (t) => {
  const h = await harness(t);
  h.mateA.claim();
  assert.equal(h.mateA.model.current().model, 'deepseek-flash');
  // A resumed teammate's recorded route is its starting point, but the
  // next step boundary still applies the live Team policy.
  h.mateA.model.state = { provider: 'stale', model: 'stale-model' };
  h.mateA.claim();
  assert.equal(h.mateA.model.current().model, 'deepseek-flash');
});

test('sync: clearing a pin follows the Lead route', async (t) => {
  const h = await harness(t);
  h.mateA.claim();
  assert.equal(h.mateA.model.current().model, 'deepseek-flash');
  h.leadA.model.state = { provider: 'main', model: 'main-model', reasoningEffort: 'high' };
  h.setPins({});
  h.mateA.claim();
  assert.deepEqual(h.mateA.model.current(), { provider: 'main', model: 'main-model', reasoningEffort: 'high' });
});

test('sync: an effort-only pin preserves the teammate route', async (t) => {
  const h = await harness(t);
  h.setPins({ 'lead-A': { reasoningEffort: 'low' } });
  h.mateA.model.state = { provider: 'own', model: 'own-model', reasoningEffort: 'high' };
  h.mateA.claim();
  assert.deepEqual(h.mateA.model.current(), { provider: 'own', model: 'own-model', reasoningEffort: 'low' });
});

test('sync: a partial pin respects the ordinary selected route', async (t) => {
  const h = await harness(t);
  h.setPins({ 'lead-A': { reasoningEffort: 'low' } });
  h.mateA.model.state = { provider: 'native', model: 'native-model', reasoningEffort: 'high' };
  h.mateA.claim();
  assert.deepEqual(h.mateA.model.current(), { provider: 'native', model: 'native-model', reasoningEffort: 'low' });
});

test('sync: unloading stops future selection writes', async (t) => {
  const h = await harness(t);
  h.mateA.claim();
  assert.equal(h.mateA.model.current().model, 'deepseek-flash');
  const before = h.mateA.selects.length;
  assert.equal(h.sync.has(h.mateA), true);
  h.dispose();
  h.mateA.claim();
  assert.equal(h.mateA.selects.length, before);
});

test('sync: applyTeamPin follows the Lead only when no fixed route is pinned', () => {
  const base = { provider: 'cpa', model: 'own-model', reasoningEffort: 'high' };
  const leader = { provider: 'main', model: 'leader-model', reasoningEffort: 'medium' };
  assert.deepEqual(applyTeamPin(base, undefined, leader), { provider: 'main', model: 'leader-model', reasoningEffort: 'medium' });
  assert.deepEqual(applyTeamPin(base, { followLeader: true, reasoningEffort: 'low' }, leader),
    { provider: 'main', model: 'leader-model', reasoningEffort: 'low' });
});

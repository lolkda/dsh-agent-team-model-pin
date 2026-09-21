// Unit tests for src/pin.ts (SPEC v1, section 5.1 semantics, section 7.1 acceptance A1-A7).
// Zero dependencies: node:test + node:assert/strict only. No llm service, no mock framework.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizePin,
  resolvePin,
  applyPin,
  parseCommandInput,
  mutationFor,
  describePin,
  assertRouteSelectable,
} from '../src/pin.ts';

// ---------------------------------------------------------------------------
// Test-local fake LlmLike (hand-written, no framework). Never touches real llm.
// ---------------------------------------------------------------------------
function makeFakeLlm() {
  const catalogue = {
    alpha: {
      'a-1': { reasoning: { efforts: [{ id: 'low' }, { id: 'high' }] } },
      'a-2': {}, // publishes no reasoning block at all
    },
    beta: {
      'b-1': { reasoning: { efforts: [{ id: 'medium' }] } },
    },
  };
  let resolveCalls = 0;
  return {
    get resolveCalls() {
      return resolveCalls;
    },
    listProviders() {
      return [{ id: 'alpha' }, { id: 'beta' }];
    },
    async resolveModelInfo(provider, model) {
      resolveCalls += 1;
      const p = catalogue[provider];
      if (!p) throw new Error(`provider not found: ${provider}`);
      const m = p[model];
      if (!m) throw new Error(`model not found: ${provider}/${model}`);
      return m;
    },
  };
}

async function rejectionMessage(fn) {
  try {
    await fn();
  } catch (err) {
    assert.ok(err instanceof Error, 'expected an Error instance');
    assert.equal(typeof err.message, 'string');
    assert.ok(err.message.length > 0, 'error message must be displayable, non-empty');
    return err.message;
  }
  assert.fail('expected the call to reject/throw');
}

// ---------------------------------------------------------------------------
// normalizePin
// ---------------------------------------------------------------------------
test('normalizePin trims values, drops empty/blank fields, returns undefined when nothing is left', () => {
  assert.deepEqual(normalizePin({ provider: ' alpha ', model: ' a-1 ' }), {
    provider: 'alpha',
    model: 'a-1',
  });
  assert.deepEqual(normalizePin({ provider: '', model: 'a-1', reasoningEffort: '   ' }), {
    model: 'a-1',
  });
  assert.equal(normalizePin({ provider: '', model: '  ' }), undefined);
  assert.equal(normalizePin({}), undefined);
  assert.equal(normalizePin(undefined), undefined);
  assert.equal(normalizePin(null), undefined);
  assert.equal(normalizePin('nope'), undefined);
  assert.equal(normalizePin({ provider: 42 }), undefined);
});

// ---------------------------------------------------------------------------
// A1 — scope gating
// ---------------------------------------------------------------------------
const PINNED = { provider: 'alpha', model: 'a-1' };

test('A1 scope=teammates pins role=teammate and leaves lead unpinned', () => {
  const base = { scope: 'teammates', defaults: PINNED, sessionId: 'session-A' };
  assert.deepEqual(resolvePin({ ...base, role: 'teammate' }), PINNED);
  assert.equal(resolvePin({ ...base, role: 'lead' }), undefined);
  assert.equal(resolvePin({ ...base, role: undefined }), undefined);
});

test('A1 scope=members pins lead and teammate, not non-members', () => {
  const base = { scope: 'members', defaults: PINNED, sessionId: 'session-A' };
  assert.deepEqual(resolvePin({ ...base, role: 'lead' }), PINNED);
  assert.deepEqual(resolvePin({ ...base, role: 'teammate' }), PINNED);
  assert.equal(resolvePin({ ...base, role: undefined }), undefined);
});

test('A1 scope=all pins every agent key, including non-members', () => {
  const base = { scope: 'all', defaults: PINNED, sessionId: 'session-A' };
  assert.deepEqual(resolvePin({ ...base, role: undefined }), PINNED);
  assert.deepEqual(resolvePin({ ...base, role: 'lead' }), PINNED);
  assert.deepEqual(resolvePin({ ...base, role: 'teammate' }), PINNED);
});

test('A1 no configured layer anywhere yields undefined', () => {
  assert.equal(
    resolvePin({ scope: 'teammates', sessionId: 'session-A', role: 'teammate' }),
    undefined,
  );
});

// ---------------------------------------------------------------------------
// A2 — per-session isolation
// ---------------------------------------------------------------------------
test('A2 pin set for session A does not leak into session B', () => {
  const input = {
    scope: 'teammates',
    liveSessions: { 'session-A': PINNED },
    role: 'teammate',
  };
  assert.deepEqual(resolvePin({ ...input, sessionId: 'session-A' }), PINNED);
  assert.equal(resolvePin({ ...input, sessionId: 'session-B' }), undefined);
});

// ---------------------------------------------------------------------------
// A3 — three layers, field-level merge
// ---------------------------------------------------------------------------
test('A3 defaults plus session layer writing only model keeps lower provider and effort', () => {
  const pin = resolvePin({
    scope: 'teammates',
    defaults: { provider: 'alpha', model: 'a-1', reasoningEffort: 'high' },
    configSessions: { 'session-A': { model: 'a-2' } },
    sessionId: 'session-A',
    role: 'teammate',
  });
  assert.deepEqual(pin, { provider: 'alpha', model: 'a-2', reasoningEffort: 'high' });
});

test('A3 config session layer overrides defaults field by field', () => {
  const pin = resolvePin({
    scope: 'teammates',
    defaults: { provider: 'alpha', model: 'a-1', reasoningEffort: 'low' },
    configSessions: { 'session-A': { provider: 'beta', reasoningEffort: 'medium' } },
    sessionId: 'session-A',
    role: 'teammate',
  });
  assert.deepEqual(pin, { provider: 'beta', model: 'a-1', reasoningEffort: 'medium' });
});

test('A3 blank field in a higher layer counts as unset and falls through to the lower layer', () => {
  const pin = resolvePin({
    scope: 'teammates',
    defaults: { provider: 'alpha', model: 'a-1' },
    configSessions: { 'session-A': { provider: '   ', model: '' } },
    sessionId: 'session-A',
    role: 'teammate',
  });
  assert.deepEqual(pin, { provider: 'alpha', model: 'a-1' });
});

test('A3 a layer that exists but pins nothing is equivalent to no layer', () => {
  assert.equal(
    resolvePin({
      scope: 'teammates',
      configSessions: { 'session-A': {} },
      sessionId: 'session-A',
      role: 'teammate',
    }),
    undefined,
  );
});

// ---------------------------------------------------------------------------
// A4 — runtime layer wins; clear falls back
// ---------------------------------------------------------------------------
test('A4 live session layer wins over composition session layer, field by field', () => {
  const pin = resolvePin({
    scope: 'teammates',
    defaults: { provider: 'alpha', model: 'a-1', reasoningEffort: 'low' },
    configSessions: { 'session-A': { provider: 'beta', model: 'b-1' } },
    liveSessions: { 'session-A': { provider: 'alpha', reasoningEffort: 'high' } },
    sessionId: 'session-A',
    role: 'teammate',
  });
  assert.deepEqual(pin, { provider: 'alpha', model: 'b-1', reasoningEffort: 'high' });
});

test('A4 after clear (live layer for that session is undefined) resolution falls back to composition', () => {
  const input = {
    scope: 'teammates',
    defaults: { provider: 'alpha', model: 'a-1' },
    configSessions: { 'session-A': { model: 'a-2' } },
    role: 'teammate',
    sessionId: 'session-A',
  };
  const before = resolvePin({ ...input, liveSessions: { 'session-A': { model: 'b-1' } } });
  assert.deepEqual(before, { provider: 'alpha', model: 'b-1' });

  const afterExplicitUndefined = resolvePin({ ...input, liveSessions: { 'session-A': undefined } });
  assert.deepEqual(afterExplicitUndefined, { provider: 'alpha', model: 'a-2' });

  const afterKeyRemoved = resolvePin({ ...input, liveSessions: {} });
  assert.deepEqual(afterKeyRemoved, { provider: 'alpha', model: 'a-2' });
});

test('A4 a live pin on another session does not affect this session', () => {
  const pin = resolvePin({
    scope: 'teammates',
    configSessions: { 'session-A': { model: 'a-1' } },
    liveSessions: { 'session-B': { model: 'b-1' } },
    sessionId: 'session-B',
    role: 'teammate',
  });
  assert.deepEqual(pin, { model: 'b-1' });
});

// ---------------------------------------------------------------------------
// A5 — effort semantics
// ---------------------------------------------------------------------------
test('A5 pin changing only the route discards the inherited reasoningEffort', () => {
  const out = applyPin(
    { provider: 'alpha', model: 'a-1', reasoningEffort: 'low' },
    { provider: 'beta', model: 'b-1' },
  );
  assert.deepEqual(out, { provider: 'beta', model: 'b-1' });
  assert.equal(out.reasoningEffort, undefined);
});

test('A5 pin changing only the route keeps the untouched fields of the call config', () => {
  const out = applyPin({ provider: 'alpha', model: 'a-1', reasoningEffort: 'low' }, { model: 'a-2' });
  assert.equal(out.provider, 'alpha');
  assert.equal(out.model, 'a-2');
  assert.equal(out.reasoningEffort, undefined);
});

test('A5 pin giving only effort keeps the inherited provider and model', () => {
  const out = applyPin(
    { provider: 'alpha', model: 'a-1', reasoningEffort: 'low' },
    { reasoningEffort: 'high' },
  );
  assert.deepEqual(out, { provider: 'alpha', model: 'a-1', reasoningEffort: 'high' });
});

test('A5 pin giving route plus explicit effort keeps that explicit effort', () => {
  const out = applyPin(
    { provider: 'alpha', model: 'a-1', reasoningEffort: 'low' },
    { provider: 'beta', model: 'b-1', reasoningEffort: 'medium' },
  );
  assert.deepEqual(out, { provider: 'beta', model: 'b-1', reasoningEffort: 'medium' });
});

test('A5 applyPin leaves unrelated call-config fields untouched and does not mutate its input', () => {
  const config = {
    provider: 'alpha',
    model: 'a-1',
    reasoningEffort: 'low',
    temperature: 0.3,
    maxTokens: 1234,
    stop: ['END'],
  };
  const out = applyPin(config, { model: 'a-2' });
  assert.equal(out.temperature, 0.3);
  assert.equal(out.maxTokens, 1234);
  assert.deepEqual(out.stop, ['END']);
  assert.deepEqual(config, {
    provider: 'alpha',
    model: 'a-1',
    reasoningEffort: 'low',
    temperature: 0.3,
    maxTokens: 1234,
    stop: ['END'],
  });
});

test('A5 applyPin on an empty pin returns an equivalent config', () => {
  const out = applyPin({ provider: 'alpha', model: 'a-1', reasoningEffort: 'low' }, {});
  assert.deepEqual(out, { provider: 'alpha', model: 'a-1', reasoningEffort: 'low' });
});

// ---------------------------------------------------------------------------
// A6 — command parsing + mutation shape
// ---------------------------------------------------------------------------
test('A6 empty input and "show" both mean show', () => {
  assert.deepEqual(parseCommandInput(''), { action: 'show' });
  assert.deepEqual(parseCommandInput('   '), { action: 'show' });
  assert.deepEqual(parseCommandInput('show'), { action: 'show' });
  assert.deepEqual(parseCommandInput('  show  '), { action: 'show' });
});

test('A6 "clear" means clear', () => {
  assert.deepEqual(parseCommandInput('clear'), { action: 'clear' });
  assert.deepEqual(parseCommandInput(' clear '), { action: 'clear' });
});

test('A6 two and three tokens mean set (provider+model, provider+model+effort)', () => {
  assert.deepEqual(parseCommandInput('a b'), { action: 'set', provider: 'a', model: 'b' });
  assert.deepEqual(parseCommandInput('a b c'), {
    action: 'set',
    provider: 'a',
    model: 'b',
    reasoningEffort: 'c',
  });
  assert.deepEqual(parseCommandInput('  alpha   a-1  '), {
    action: 'set',
    provider: 'alpha',
    model: 'a-1',
  });
});

test('A6 one token (non-keyword) and four tokens are invalid with a displayable message', () => {
  const one = parseCommandInput('a');
  assert.equal(one.action, 'invalid');
  assert.ok(typeof one.error === 'string' && one.error.length > 0);

  const four = parseCommandInput('a b c d');
  assert.equal(four.action, 'invalid');
  assert.ok(typeof four.error === 'string' && four.error.length > 0);
});

test('A6 invalid input never carries a provider/model payload (zero-write precondition)', () => {
  for (const raw of ['a', 'a b c d', 'clear me', 'show me now']) {
    const plan = parseCommandInput(raw);
    if (raw === 'clear me' || raw === 'show me now') {
      assert.equal(plan.action, 'set', `${raw} is a well-formed set per arity rules`);
    } else {
      assert.equal(plan.action, 'invalid');
      assert.equal(plan.provider, undefined);
      assert.equal(plan.model, undefined);
    }
  }
});

test('A6 mutationFor maps set/clear onto the [sessions, sessionId] settings path', () => {
  assert.deepEqual(mutationFor({ action: 'set', provider: 'a', model: 'b', reasoningEffort: 'c' }, 'session-A'), {
    op: 'set',
    path: ['sessions', 'session-A'],
    value: { provider: 'a', model: 'b', reasoningEffort: 'c' },
  });
  assert.deepEqual(mutationFor({ action: 'set', provider: 'a', model: 'b' }, 'session-A'), {
    op: 'set',
    path: ['sessions', 'session-A'],
    value: { provider: 'a', model: 'b' },
  });
  assert.deepEqual(mutationFor({ action: 'clear' }, 'session-A'), {
    op: 'unset',
    path: ['sessions', 'session-A'],
  });
});

test('describePin reports the route and an explicit not-set text', () => {
  const none = describePin(undefined);
  assert.equal(typeof none, 'string');
  assert.match(none, /未设置/);

  const text = describePin({ provider: 'alpha', model: 'a-1', reasoningEffort: 'high' });
  assert.match(text, /alpha/);
  assert.match(text, /a-1/);
  assert.match(text, /high/);
});

// ---------------------------------------------------------------------------
// A7 — assertRouteSelectable
// ---------------------------------------------------------------------------
test('A7 unknown provider is rejected', async () => {
  const message = await rejectionMessage(() =>
    assertRouteSelectable(makeFakeLlm(), { provider: 'ghost', model: 'a-1' }, {}),
  );
  assert.match(message, /ghost/);
});

test('A7 unknown model is rejected', async () => {
  const message = await rejectionMessage(() =>
    assertRouteSelectable(makeFakeLlm(), { provider: 'alpha', model: 'ghost-1' }, {}),
  );
  assert.match(message, /ghost-1/);
});

test('A7 effort the model does not publish is rejected', async () => {
  const message = await rejectionMessage(() =>
    assertRouteSelectable(
      makeFakeLlm(),
      { provider: 'alpha', model: 'a-1', reasoningEffort: 'ultra' },
      {},
    ),
  );
  assert.match(message, /ultra/);
});

test('A7 explicit effort on a model publishing no reasoning block is rejected', async () => {
  await rejectionMessage(() =>
    assertRouteSelectable(
      makeFakeLlm(),
      { provider: 'alpha', model: 'a-2', reasoningEffort: 'high' },
      {},
    ),
  );
});

test('A7 a legal provider/model/effort triple resolves without throwing', async () => {
  await assertRouteSelectable(
    makeFakeLlm(),
    { provider: 'alpha', model: 'a-1', reasoningEffort: 'high' },
    {},
  );
  await assertRouteSelectable(makeFakeLlm(), { provider: 'beta', model: 'b-1' }, {});
});

test('A7 provider-only pin needs no model catalogue entry, model-only pin validates against fallback', async () => {
  const llm = makeFakeLlm();
  await assertRouteSelectable(llm, { provider: 'alpha' }, {});
  assert.equal(llm.resolveCalls, 0, 'provider-only must not need model resolution');

  await assertRouteSelectable(
    makeFakeLlm(),
    { model: 'b-1', reasoningEffort: 'medium' },
    { provider: 'beta' },
  );

  await rejectionMessage(() =>
    assertRouteSelectable(makeFakeLlm(), { model: 'b-1' }, { provider: 'ghost' }),
  );
  await rejectionMessage(() => assertRouteSelectable(makeFakeLlm(), { model: 'b-1' }, {}));
});

test('A7 effort-only pin is validated against the fallback route', async () => {
  await assertRouteSelectable(
    makeFakeLlm(),
    { reasoningEffort: 'high' },
    { provider: 'alpha', model: 'a-1' },
  );
  await rejectionMessage(() =>
    assertRouteSelectable(
      makeFakeLlm(),
      { reasoningEffort: 'ultra' },
      { provider: 'alpha', model: 'a-1' },
    ),
  );
});

test('A7 a pin that sets nothing is a no-op', async () => {
  const llm = makeFakeLlm();
  await assertRouteSelectable(llm, {}, {});
  assert.equal(llm.resolveCalls, 0);
});
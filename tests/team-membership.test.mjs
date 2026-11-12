import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTeamMembership } from '../src/team-membership.ts';

const lead = { id: 'lead' };
const teammate = { id: 'teammate' };
const ordinary = { id: 'ordinary' };

function modernHost({ enabled = true, names = {} } = {}) {
  return {
    get(name) {
      if (name === 'agentTeams') return { isEnabled: root => enabled && root.id === 'lead' };
      if (name === 'subagents') return {
        rootOf(agent) { return agent.id === 'teammate' ? lead : agent; },
        namesOf(agent) { return { name: names[agent.id] }; },
      };
    },
  };
}

test('rc.2 membership: Team root is lead, descendant is teammate, disabled/ordinary trees are excluded', () => {
  const host = modernHost({ names: { teammate: 'reviewer' } });
  assert.deepEqual(resolveTeamMembership(host, lead), { root: lead, id: 'lead', role: 'lead', name: 'lead' });
  assert.deepEqual(resolveTeamMembership(host, teammate), { root: lead, id: 'lead', role: 'teammate', name: 'reviewer' });
  assert.equal(resolveTeamMembership(modernHost({ enabled: false }), teammate), undefined);
  assert.equal(resolveTeamMembership(modernHost(), ordinary), undefined);
});

test('legacy membership wins for rc.1 hosts and preserves roster failures', () => {
  const membership = { root: lead, id: 'lead', role: 'lead', name: 'lead' };
  const host = {
    get(name) {
      if (name === 'agentTeams') return { tryMembership: agent => agent.id === 'lead' ? membership : undefined };
    },
  };
  assert.deepEqual(resolveTeamMembership(host, lead), membership);
  assert.equal(resolveTeamMembership(host, teammate), undefined);

  const broken = { get(name) { return name === 'agentTeams' ? { tryMembership() { throw new Error('roster down'); } } : undefined; } };
  assert.throws(() => resolveTeamMembership(broken, lead), /roster down/);
});

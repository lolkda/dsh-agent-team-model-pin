/** Explicit public Typert descriptors; no private SDK fields or native patches. */
import type { TypertCodec, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
const owner = '@lolkda/dsh-agent-team-model-pin';
const codec = (name: string, parse: (value: unknown) => unknown): TypertCodec => ({
  mode: 'strict', typeSymbol: `${owner}#${name}`, create: () => ({ parse }),
});
const text = (value: unknown): string => {
  if (typeof value !== 'string') throw new TypeError('Expected a string');
  return value;
};
const inputs: Record<string, TypertCodec> = {
  agent: codec('AgentId', value => { const id = text(value); if (!id) throw new TypeError('Expected an Agent ID'); return id; }),
  rawInput: codec('ModelInput', text),
  revision: codec('Revision', value => {
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError('Expected a non-negative revision');
    return value;
  }),
  choice: codec('PresetChoice', value => value === null ? null : text(value)),
};
const result = codec('SettingsResult', value => {
  if (value === null || typeof value !== 'object') throw new TypeError('Expected a settings result');
  const row = value as { kind?: unknown; text?: unknown };
  if ((row.kind !== 'success' && row.kind !== 'error') || (row.text !== undefined && typeof row.text !== 'string')) throw new TypeError('Invalid settings result');
  return value;
});
export const TEAM_SETTINGS_REMOTE: TypertRemoteContribution = {
  package: owner,
  descriptors: ['model', 'preset'].map(method => ({
    id: `${owner}#teamSettings/${method}`,
    service: 'teamSettings', namespace: 'teamSettings', method, invocation: { kind: 'direct' as const },
    parameters: [
      { name: 'agent', wire: 'agentId', source: 'lookup' as const, lookup: 'agent', codec: inputs.agent },
      ...(method === 'model' ? ['rawInput'] : ['revision', 'choice']).map(name => ({ name, wire: name, source: 'json' as const, codec: inputs[name] })),
    ],
    cancellation: { parameter: 'signal' as const }, result,
  })),
};

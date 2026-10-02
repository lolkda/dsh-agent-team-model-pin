/** Preset policy is independent of request-time model pins. Browser-safe. */
export type PresetChoice = string | null | undefined;

/** undefined inherits configuration; null explicitly follows the Lead. */
export function presetChoice(value: unknown): PresetChoice {
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string' || !value.trim()) throw new Error('Team Agent 预设必须是非空预设 ID 或 null（继承 Lead）');
  return value.trim();
}

/** Resolve only an own session entry; never fall through an explicit null. */
export function resolvePresetPolicy(defaultValue: unknown, sessions: unknown, leadId: string): PresetChoice {
  if (sessions !== undefined && (sessions === null || typeof sessions !== 'object' || Array.isArray(sessions))) {
    throw new Error('presetSessions 必须是以 Lead 会话 ID 为键的对象');
  }
  const entries = sessions as Record<string, unknown> | undefined;
  if (entries && Object.hasOwn(entries, leadId) && entries[leadId] !== undefined) return presetChoice(entries[leadId]);
  return presetChoice(defaultValue);
}

/** Internal popup save payload, not a user-facing subcommand grammar. */
export interface PresetSave { revision: number; choice: string | null }
export function parsePresetSave(input: string): PresetSave | undefined {
  const match = /^apply (\d+) ([\s\S]+)$/.exec(input.trim());
  if (!match || !Number.isSafeInteger(Number(match[1]))) return undefined;
  try {
    const choice = presetChoice(JSON.parse(match[2]));
    return choice === undefined ? undefined : { revision: Number(match[1]), choice };
  } catch { return undefined; }
}

export interface PresetRow { id: string; name?: string; description?: string; broken?: string }
export interface PresetCatalog {
  resolve(id: string): Promise<PresetRow>;
}

/** Never save an unknown/broken preset and then silently use a different one. */
export async function assertPresetSelectable(catalog: PresetCatalog, id: string): Promise<PresetRow> {
  const preset = await catalog.resolve(id);
  if (preset.id !== id) throw new Error(`Agent 预设解析不一致：请求 ${id}，返回 ${preset.id}`);
  if (preset.broken !== undefined) throw new Error(`Agent 预设 ${id} 不可用：${preset.broken}`);
  return preset;
}

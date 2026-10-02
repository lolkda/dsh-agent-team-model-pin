/** Host /team-preset: future teammate composition policy, never a live switch. */
import { assertPresetSelectable, parsePresetSave } from './preset-policy.ts';
import type { PresetCatalog } from './preset-policy.ts';
import { PRESET_RUNTIME_REQUIRED, supportsTeamPresetRuntime } from './preset-capability.ts';

interface MemberAgent { id: string }
interface Settings {
  describe?(): { ns: string; revision?: number }[];
  mutate(ns: string, ops: readonly unknown[], revision?: number): Promise<void>;
}
interface PresetCommandHost {
  get(name: string): unknown;
  agentTeams: { tryMembership(agent: MemberAgent): { root: MemberAgent; role: 'lead' | 'teammate' } | undefined };
  commands: { register(definition: {
    name: string; description: string;
    handler(input: { agent: MemberAgent; rawInput: string; signal: AbortSignal }): Promise<{ kind: 'success' | 'error'; text: string }>;
  }): () => void };
  effect(effect: () => unknown): unknown;
}
const scopeNotice = '仅作用于之后新建的队友；Lead 和已存在队友不变。模型与思考等级设置不受影响。';
const textOf = (error: unknown): string => error instanceof Error ? error.message : String(error);

export function installPresetCommand(host: PresetCommandHost, entryId: () => string): void {
  host.effect(() => host.commands.register({
    name: 'team-preset',
    description: '选择之后新建的 Team 队友使用的 Agent 预设（不热切换）',
    async handler({ agent, rawInput, signal }) {
      try {
        signal.throwIfAborted();
        // Bare invocation is decorated by the Web popup. Non-Web callers get
        // guidance, not a second CLI with list/set/show/follow/clear aliases.
        const save = parsePresetSave(rawInput);
        if (!save) return { kind: 'error', text: '请在 Web 中直接输入 /team-preset，从选择面板选择预设，无需填写参数。' };
        const membership = host.agentTeams.tryMembership(agent);
        if (!membership) return { kind: 'error', text: '当前 Agent 不属于可配置的 Agent Team，未写入设置。' };
        const leadId = membership.root.id;
        if (!supportsTeamPresetRuntime(host)) throw new Error(PRESET_RUNTIME_REQUIRED);
        const catalog = host.get('agentPresets') as PresetCatalog | undefined;
        const settings = host.get('settings') as Settings | undefined;
        if (!settings || typeof settings.describe !== 'function') throw new Error('settings 服务不可用，无法安全保存 Team Agent 预设');
        const revision = settings.describe().find(item => item.ns === entryId())?.revision;
        if (!Number.isSafeInteger(revision) || revision! < 0) throw new Error('Team 设置尚未就绪，无法获取配置 revision；未写入');
        if (save.revision !== revision) throw new Error('Team 设置 revision 已变化；请重新打开 /team-preset 菜单');
        const { choice } = save;
        if (typeof choice === 'string') {
          if (!catalog || typeof catalog.resolve !== 'function') throw new Error('agentPresets 服务不可用；未写入');
          await assertPresetSelectable(catalog, choice);
        }
        signal.throwIfAborted();
        const path = ['presetSessions', leadId];
        await settings.mutate(entryId(), [{ op: 'set', path, value: choice }], revision);
        return { kind: 'success', text: [
          `已设置 Team Agent 预设：${choice ?? '继承 Lead'}`,
          scopeNotice,
        ].join('\n') };
      } catch (error) {
        return { kind: 'error', text: `Team Agent 预设操作失败：${textOf(error)}` };
      }
    },
  }));
}

/** Native command policy for FUTURE teammates; never changes an Agent's live preset. */
import { resolvePresetPolicy } from './preset-policy.ts';
import { presetDisplayText } from '@deepseek-ai/dsh-agent-preset-registry/display';
import { choiceId, SETTINGS_NS, teamSessionKey } from './ui-state.ts';
import type { NamespaceView, Result, SessionsLike } from './ui-state.ts';

interface SessionContext { sessionId: string }
interface SelectOption {
  id: string;
  label: string;
  detail?: string;
  active?: boolean;
}
interface PopupSpec {
  kind: 'popupSelect';
  searchMode: 'fuzzy-label';
  searchLabels(): { placeholder: string; empty: string; noResults: string };
  options(session: SessionContext, signal: AbortSignal): Promise<readonly SelectOption[]>;
  onSelect(option: SelectOption, session: SessionContext): Promise<void>;
}
interface CommandRegistration {
  name: string;
  available(session: SessionContext): boolean;
  ui: PopupSpec;
  label?(): string;
  description?(): string;
}
interface PresetRow {
  id: string;
  name?: string;
  description?: string;
  broken?: string;
  isDefault?: boolean;
}
interface PresetCatalogRemote {
  list(): Promise<Result<{ presets: readonly PresetRow[] }>>;
}
interface PresetSaveRemote {
  preset(agentId: string, revision: number, choice: string | null, signal?: AbortSignal):
    Promise<Result<{ kind: 'success' | 'error'; text?: string }>>;
}
interface CatalogContext {
  remote: { agentPresets?: PresetCatalogRemote; teamSettings?: PresetSaveRemote };
  effect(effect: () => unknown): unknown;
}
/** Settings are read-only here; the Host RPC owns validation and persistence. */
export interface PresetClientContext {
  commandUi: {
    register(command: CommandRegistration): () => void;
    dismiss(name: string): void;
  };
  sessions: SessionsLike;
  remote: {
    settings: {
      describe(): Promise<Result<{ writable: boolean; namespaces: NamespaceView[] }>>;
    };
    agentPresets?: PresetCatalogRemote;
    teamSettings?: PresetSaveRemote;
  };
  locale: {
    register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void;
    bind(ns: string): (key: string) => string;
  };
  effect(effect: () => unknown): unknown;
  /** Cordis grants the qualified Remote dependency only inside this child. */
  inject?(dependencies: string[], callback: (child: CatalogContext) => void): unknown;
}
interface Opening {
  sessionId: string;
  key: string;
  binding: NonNullable<ReturnType<SessionsLike['binding']>>;
  revision: number;
  signal: AbortSignal;
  generation: number;
  catalog: PresetCatalogRemote;
  saver: PresetSaveRemote;
  saving: boolean;
  committed: boolean;
}
interface OfferedChoice { opening: Opening; preset: string | null }

// Fallback copy for compositions without DSH's optional preset UI dictionary.
// Prefer the host's settings.agentPreset translations when that UI is present.
const zh = {
  presetStandardName: '标准模式',
  presetStandardDescription: '处理代码、文件和资料，适合大多数任务。Agent 会按需使用检索、编辑和终端等工具。',
  presetPtcName: 'PTC 模式',
  presetPtcDescription: '包含标准模式的所有能力，更适合批量调用工具，并对结果进行筛选、整理、去重、统计或汇总的任务。',
  presetMinimalName: '极简模式',
  presetMinimalDescription: 'Agent 仅使用终端工具完成任务，适合测试和对比其基础表现。',
  presetCordisName: '创造模式',
  presetCordisDescription: '用对话定制 DSH：让 Agent 编写插件，添加新功能或界面；也能组合工具和提示词，创建自己的模式。',
  preset: 'Team 预设',
  description: '选择之后新建队友使用的 Agent 预设；现有队友不变',
  futureOnly: '仅对之后新建的队友生效，现有队友保持原预设',
  follow: '跟随主 Agent',
  followDetail: '新队友继承创建时主 Agent 的预设',
  search: '搜索 Team Agent 预设…', empty: '暂无可用预设', noResults: '没有匹配的预设',
  readOnly: '当前设置只读', missing: 'Team 插件尚未就绪，请刷新页面后重试',
  catalogUnavailable: 'Agent 预设目录不可用，请确认预设服务已启用后重试',
  invalidCatalog: 'Agent 预设目录返回了无效数据，请刷新后重试',
  saveUnavailable: 'Team 预设保存接口不可用，请确认 Host 插件已升级并重启后重试',
  saveFailed: 'Team 预设保存失败，请重新打开选择菜单',
  unavailable: '该 Agent 预设已移除或无法加载，请重新打开选择菜单',
  reopen: '会话或菜单状态已变化，请重新打开选择菜单',
  invalidSettings: 'Team 预设设置缺少有效版本号，请重新打开选择菜单',
};
const en: typeof zh = {
  presetStandardName: 'Standard mode',
  presetStandardDescription: 'Work with code, files, and information. Suitable for most tasks, with search, editing, terminal commands, and other tools available as needed.',
  presetPtcName: 'PTC mode',
  presetPtcDescription: 'Includes all Standard mode capabilities. Better suited to tasks that call tools in batches and then filter, organize, deduplicate, count, or summarize the results.',
  presetMinimalName: 'Minimal mode',
  presetMinimalDescription: 'The agent works using only a terminal tool. Useful for testing and comparing its basic performance.',
  presetCordisName: 'Creator mode',
  presetCordisDescription: 'Customize DSH through conversation. Let the agent write plugins that add features or UI, or combine tools and prompts to create your own mode.',
  preset: 'Team preset',
  description: 'Choose the Agent preset for future teammates; existing teammates stay unchanged',
  futureOnly: 'Applies only to new teammates; existing teammates keep their preset',
  follow: 'Follow main Agent',
  followDetail: 'New teammates inherit the main Agent’s preset at creation',
  search: 'Search Team Agent presets…', empty: 'No available presets', noResults: 'No matching presets',
  readOnly: 'Settings are read-only', missing: 'The Team plugin is not ready. Refresh the page and retry.',
  catalogUnavailable: 'The Agent preset catalog is unavailable. Enable the preset service and retry.',
  invalidCatalog: 'The Agent preset catalog returned invalid data. Refresh and retry.',
  saveUnavailable: 'The Team preset saving API is unavailable. Upgrade and restart the Host plugin, then retry.',
  saveFailed: 'Could not save the Team preset. Reopen the selection menu.',
  unavailable: 'The Agent preset was removed or cannot be loaded. Reopen the selection menu.',
  reopen: 'The session or menu changed. Reopen the selection menu.',
  invalidSettings: 'Team preset settings have no valid revision. Reopen the selection menu.',
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Resolved fields override immutable composition; explicit null MUST survive merging. */
function readPreset(view: NamespaceView, key: string): string | null | undefined {
  const base = record(view.base);
  const value = record(view.value);
  return resolvePresetPolicy(
    value.presetDefault === undefined ? base.presetDefault : value.presetDefault,
    { ...record(base.presetSessions), ...record(value.presetSessions) },
    key,
  );
}

/**
 * Install a data-only popup. The preset Remote is OPTIONAL: Cordis injects it
 * separately, so its absence never unloads the existing model/effort menus.
 * DSH's dsh-api-remotes already mounts dsh-agent-preset-registry/remote.
 */
export function installPresetCommand(ctx: PresetClientContext): void {
  ctx.effect(() => ctx.locale.register('agentTeamPreset', { zh, en }));
  const t = ctx.locale.bind('agentTeamPreset');
  const nativePresetText = ctx.locale.bind('settings.agentPreset');
  const display = (row: PresetRow) => presetDisplayText(row, key => {
    const translated = nativePresetText(key);
    // DSH Locale.bind returns the bare key when no dictionary supplies it.
    return translated === key ? t(key) : translated;
  });
  const commands = ctx.commandUi;
  const offered = new WeakMap<SelectOption, OfferedChoice>();
  let live = true;
  let generation = 0;
  let catalogSource: (() => PresetCatalogRemote | undefined) | undefined;
  let saveSource: (() => PresetSaveRemote | undefined) | undefined;

  if (ctx.inject) {
    ctx.inject(['remote.agentPresets'], child => {
      // Cordis creates a new traced Proxy on every Context service read.
      // Retain one caller-bound handle for this injection lifetime; comparing
      // fresh reads would falsely invalidate every opened menu.
      const remote = child.remote.agentPresets;
      const source = () => remote;
      catalogSource = source;
      child.effect(() => () => { if (catalogSource === source) catalogSource = undefined; });
    });
    ctx.inject(['remote.teamSettings'], child => {
      const remote = child.remote.teamSettings;
      const source = () => remote;
      saveSource = source;
      child.effect(() => () => { if (saveSource === source) saveSource = undefined; });
    });
  } else {
    // Standalone consumers without Cordis may supply the same structural API.
    catalogSource = () => ctx.remote.agentPresets;
    saveSource = () => ctx.remote.teamSettings;
  }
  const catalogRemote = (): PresetCatalogRemote | undefined => {
    // A guarded Remote getter can throw when an old Host lacks the namespace.
    try {
      const remote = catalogSource?.();
      return remote && typeof remote.list === 'function' ? remote : undefined;
    } catch { return undefined; }
  };
  const saveRemote = (): PresetSaveRemote | undefined => {
    try {
      const remote = saveSource?.();
      return remote && typeof remote.preset === 'function' ? remote : undefined;
    } catch { return undefined; }
  };
  const available = ({ sessionId }: SessionContext): boolean => live && ctx.sessions.binding(sessionId) !== undefined;
  const assertOpening = (opening: Opening, sessionId = opening.sessionId): void => {
    opening.signal.throwIfAborted();
    if (!live || sessionId !== opening.sessionId || opening.generation !== generation || opening.committed
      || ctx.sessions.binding(sessionId) !== opening.binding || teamSessionKey(sessionId, ctx.sessions) !== opening.key
      || catalogRemote() !== opening.catalog || saveRemote() !== opening.saver) throw new Error(t('reopen'));
  };
  const catalog = async (remote: PresetCatalogRemote): Promise<readonly PresetRow[]> => {
    const result = await remote.list();
    if (!result.ok) throw new Error(result.error.message);
    if (!result.value || !Array.isArray(result.value.presets)
      || result.value.presets.some(row => !row || typeof row.id !== 'string' || !row.id.trim()
        || (row.name !== undefined && typeof row.name !== 'string')
        || (row.description !== undefined && typeof row.description !== 'string')
        || (row.broken !== undefined && typeof row.broken !== 'string'))) throw new Error(t('invalidCatalog'));
    // A broken preset is never an actionable choice, including on a re-check.
    return result.value.presets.filter(row => row.broken === undefined);
  };
  const ui: PopupSpec = {
    kind: 'popupSelect', searchMode: 'fuzzy-label',
    searchLabels: () => ({ placeholder: t('search'), empty: t('empty'), noResults: t('noResults') }),
    async options({ sessionId }, signal) {
      signal.throwIfAborted();
      const binding = ctx.sessions.binding(sessionId);
      if (!live || !binding) throw new Error(t('reopen'));
      const remote = catalogRemote();
      if (!remote) throw new Error(t('catalogUnavailable'));
      const command = saveRemote();
      if (!command) throw new Error(t('saveUnavailable'));
      const opening: Opening = { sessionId, key: teamSessionKey(sessionId, ctx.sessions), binding, signal,
        generation: ++generation, revision: -1, catalog: remote, saver: command, saving: false, committed: false };
      const settings = await ctx.remote.settings.describe();
      assertOpening(opening);
      if (!settings.ok) throw new Error(settings.error.message);
      if (!settings.value.writable) throw new Error(t('readOnly'));
      const view = settings.value.namespaces.find(item => item.ns === SETTINGS_NS);
      if (!view) throw new Error(t('missing'));
      if (!Number.isSafeInteger(view.revision) || view.revision < 0) throw new Error(t('invalidSettings'));
      opening.revision = view.revision;
      const rows = await catalog(remote);
      assertOpening(opening);
      const selected = readPreset(view, opening.key);
      const offer = (option: SelectOption, preset: string | null): SelectOption => {
        offered.set(option, { opening, preset });
        return option;
      };
      return [offer({ id: choiceId('team-preset', null), label: t('follow'),
        detail: `${t('followDetail')} · ${t('futureOnly')}`, active: selected == null }, null),
      ...rows.map(row => {
        const text = display(row);
        return offer({ id: choiceId('team-preset', row.id), label: text.name || row.id,
          detail: [row.id, text.description, t('futureOnly')].filter(Boolean).join(' · '), active: selected === row.id }, row.id);
      })];
    },
    async onSelect(option, { sessionId }) {
      const choice = offered.get(option);
      if (!choice) throw new Error(t('reopen'));
      const { opening, preset } = choice;
      assertOpening(opening, sessionId);
      if (opening.saving) throw new Error(t('reopen'));
      opening.saving = true;
      try {
        const rows = await catalog(opening.catalog);
        assertOpening(opening, sessionId);
        if (preset !== null && !rows.some(row => row.id === preset)) throw new Error(t('unavailable'));
        // Never bypass the Host RPC's runtime-capability gate with settings.mutate.
        // The plugin-owned RPC carries the opening CAS token and raw preset ID.
        const result = await opening.saver.preset(opening.key,
          opening.revision, preset, opening.signal);
        if (!result.ok) throw new Error(result.error.message);
        if (!result.value) throw new Error(t('saveUnavailable'));
        if (result.value.kind !== 'success') throw new Error(result.value.text || t('saveFailed'));
        // Closing after submission cannot undo the write, but must not report
        // a late success to a new/replaced popup or consume its input token.
        assertOpening(opening, sessionId);
        opening.committed = true;
      } finally { opening.saving = false; }
    },
  };
  ctx.effect(() => commands.register({ name: 'team-preset', available,
    label: () => t('preset'), description: () => t('description'), ui }));
  ctx.effect(() => () => { live = false; generation++; commands.dismiss('team-preset'); });
}


/** Native command policy for FUTURE teammates; never changes an Agent's live preset. */
import { resolvePresetPolicy } from './preset-policy.ts';
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
interface PresetCommandRemote {
  execute(agentId: string, line: string, submittedAttachments: readonly never[], signal?: AbortSignal):
    Promise<Result<{ result: { kind: 'success' | 'error'; text?: string } } | undefined>>;
}
interface CatalogContext {
  remote: { agentPresets?: PresetCatalogRemote; commands?: PresetCommandRemote };
  effect(effect: () => (() => void)): unknown;
}
/** Settings are read-only here; the Host command owns validation and persistence. */
export interface PresetClientContext {
  commandUi: {
    register(command: CommandRegistration): () => void;
    decorate(command: CommandRegistration): () => void;
    dismiss(name: string): void;
  };
  sessions: SessionsLike;
  remote: {
    settings: {
      describe(): Promise<Result<{ writable: boolean; namespaces: NamespaceView[] }>>;
    };
    agentPresets?: PresetCatalogRemote;
    commands?: PresetCommandRemote;
  };
  locale: {
    register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void;
    bind(ns: string): (key: string) => string;
  };
  effect(effect: () => (() => void)): unknown;
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
  commands: PresetCommandRemote;
  saving: boolean;
  committed: boolean;
}
interface OfferedChoice { opening: Opening; preset: string | null }

const zh = {
  preset: 'Team 预设（新队友）',
  description: '选择之后新建队友使用的 Agent 预设；现有队友不变',
  futureOnly: '仅对之后新建的队友生效，现有队友保持原预设',
  follow: '跟随主 Agent',
  followDetail: '新队友继承创建时主 Agent 的预设',
  search: '搜索 Team Agent 预设…', empty: '暂无可用预设', noResults: '没有匹配的预设',
  readOnly: '当前设置只读', missing: 'Team 插件尚未就绪，请刷新页面后重试',
  catalogUnavailable: 'Agent 预设目录不可用，请确认预设服务已启用后重试',
  invalidCatalog: 'Agent 预设目录返回了无效数据，请刷新后重试',
  commandUnavailable: 'Team 预设保存命令不可用，请确认 Host 插件已升级后重试',
  saveFailed: 'Team 预设保存失败，请重新打开选择菜单',
  unavailable: '该 Agent 预设已移除或无法加载，请重新打开选择菜单',
  reopen: '会话或菜单状态已变化，请重新打开选择菜单',
  invalidSettings: 'Team 预设设置缺少有效版本号，请重新打开选择菜单',
};
const en: typeof zh = {
  preset: 'Team preset (new teammates)',
  description: 'Choose the Agent preset for future teammates; existing teammates stay unchanged',
  futureOnly: 'Applies only to new teammates; existing teammates keep their preset',
  follow: 'Follow main Agent',
  followDetail: 'New teammates inherit the main Agent’s preset at creation',
  search: 'Search Team Agent presets…', empty: 'No available presets', noResults: 'No matching presets',
  readOnly: 'Settings are read-only', missing: 'The Team plugin is not ready. Refresh the page and retry.',
  catalogUnavailable: 'The Agent preset catalog is unavailable. Enable the preset service and retry.',
  invalidCatalog: 'The Agent preset catalog returned invalid data. Refresh and retry.',
  commandUnavailable: 'The Team preset command is unavailable. Upgrade the Host plugin and retry.',
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
  const commands = ctx.commandUi;
  const offered = new WeakMap<SelectOption, OfferedChoice>();
  let live = true;
  let generation = 0;
  let catalogSource: (() => PresetCatalogRemote | undefined) | undefined;
  let commandSource: (() => PresetCommandRemote | undefined) | undefined;

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
    ctx.inject(['remote.commands'], child => {
      const remote = child.remote.commands;
      const source = () => remote;
      commandSource = source;
      child.effect(() => () => { if (commandSource === source) commandSource = undefined; });
    });
  } else {
    // Standalone consumers without Cordis may supply the same structural API.
    catalogSource = () => ctx.remote.agentPresets;
    commandSource = () => ctx.remote.commands;
  }
  const catalogRemote = (): PresetCatalogRemote | undefined => {
    // A guarded Remote getter can throw when an old Host lacks the namespace.
    try {
      const remote = catalogSource?.();
      return remote && typeof remote.list === 'function' ? remote : undefined;
    } catch { return undefined; }
  };
  const commandRemote = (): PresetCommandRemote | undefined => {
    try {
      const remote = commandSource?.();
      return remote && typeof remote.execute === 'function' ? remote : undefined;
    } catch { return undefined; }
  };
  const available = ({ sessionId }: SessionContext): boolean => live && ctx.sessions.binding(sessionId) !== undefined;
  const isChild = ({ sessionId }: SessionContext): boolean => teamSessionKey(sessionId, ctx.sessions) !== sessionId;
  const assertOpening = (opening: Opening, sessionId = opening.sessionId): void => {
    opening.signal.throwIfAborted();
    if (!live || sessionId !== opening.sessionId || opening.generation !== generation || opening.committed
      || ctx.sessions.binding(sessionId) !== opening.binding || teamSessionKey(sessionId, ctx.sessions) !== opening.key
      || catalogRemote() !== opening.catalog || commandRemote() !== opening.commands) throw new Error(t('reopen'));
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
      const command = commandRemote();
      if (!command) throw new Error(t('commandUnavailable'));
      const opening: Opening = { sessionId, key: teamSessionKey(sessionId, ctx.sessions), binding, signal,
        generation: ++generation, revision: -1, catalog: remote, commands: command, saving: false, committed: false };
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
      ...rows.map(row => offer({ id: choiceId('team-preset', row.id), label: row.name || row.id,
        detail: [row.id, row.description, t('futureOnly')].filter(Boolean).join(' · '), active: selected === row.id }, row.id))];
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
        // Never bypass the Host's runtime-capability gate with settings.mutate.
        // The apply grammar carries the same CAS token and JSON-escaped choice.
        const result = await opening.commands.execute(opening.key,
          `/team-preset apply ${opening.revision} ${JSON.stringify(preset)}`, [], opening.signal);
        if (!result.ok) throw new Error(result.error.message);
        if (!result.value?.result) throw new Error(t('commandUnavailable'));
        if (result.value.result.kind !== 'success') throw new Error(result.value.result.text || t('saveFailed'));
        // Closing after submission cannot undo the write, but must not report
        // a late success to a new/replaced popup or consume its input token.
        assertOpening(opening, sessionId);
        opening.committed = true;
      } finally { opening.saving = false; }
    },
  };
  ctx.effect(() => commands.decorate({ name: 'team-preset', available: session => available(session) && !isChild(session),
    label: () => t('preset'), description: () => t('description'), ui }));
  ctx.effect(() => commands.register({ name: 'team-preset', available: session => available(session) && isChild(session),
    label: () => t('preset'), description: () => t('description'), ui }));
  ctx.effect(() => () => { live = false; generation++; commands.dismiss('team-preset'); });
}


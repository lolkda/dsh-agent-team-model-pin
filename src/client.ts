/** Web half: contribute data/actions to DSH's native slash-command popups. */
import { applyTeamPin } from './pin.ts';
import { installPresetCommand } from './preset-client.ts';
import { TEAM_SETTINGS_REMOTE } from './team-settings-remote.ts';
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol';
import type { Pin } from './pin.ts';
import { CLIENT_VERSION, SETTINGS_NS, choiceId, effortPin, findModel, modelPin, readTeamPin, teamSessionKey, writeTeamPin } from './ui-state.ts';
import type { ProviderGroup, Selection, SessionsLike, SettingsRemote } from './ui-state.ts';

interface SessionContext { sessionId: string }
interface SelectOption {
  id: string;
  label: string;
  detail?: string;
  active?: boolean;
  group?: { name: string; label: string };
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
interface DirectoryState {
  current: Selection | null;
  groups: readonly ProviderGroup[];
  failures: readonly { name: string; message: string }[];
  error: string | null;
}
interface Directory {
  load(): Promise<DirectoryState>;
  store: { getSnapshot(): DirectoryState };
}
interface ClientContext {
  commandUi: {
    register(command: CommandRegistration): () => void;
    dismiss(name: string): void;
  };
  inputTriggers: { registerSource(source: { trigger: '/'; name: string; showGroupTitle: false; candidates(): Promise<never[]>; onPick(): undefined; matchEnter(session: SessionContext, line: string, signal: AbortSignal): Promise<undefined> }): () => void };
  modelDirectories: { directoryFor(sessionId: string): Directory };
  sessions: SessionsLike;
  remote: SettingsRemote & { $mount(contribution: TypertRemoteContribution): Promise<() => Promise<void>> };
  locale: {
    register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void;
    bind(ns: string): (key: string) => string;
  };
  effect(effect: () => unknown): unknown;
}
interface Opening {
  sessionId: string;
  key: string;
  revision: number;
  signal: AbortSignal;
  directory: Directory;
  effective: Selection | null;
  pin: Pin | undefined;
}
interface OfferedChoice {
  opening: Opening;
  resolve(state: DirectoryState): Pin;
}

const zh = {
  model: 'Team 模型', effort: 'Team 推理等级',
  modelDescription: '选择当前会话队友使用的模型', effortDescription: '选择当前会话队友的推理等级',
  follow: '跟随主 Agent', modelDefault: '模型默认',
  searchModel: '搜索 Team 模型…', searchEffort: '搜索 Team 推理等级…',
  empty: '暂无可用选项', noResults: '没有匹配的选项',
  readOnly: '当前设置只读', missing: 'Team 插件尚未就绪，请刷新页面后重试',
  unavailable: '无法确定当前模型，请先选择主模型',
  reopen: '模型或会话状态已变化，请重新打开选择菜单',
  menuOnly: '请只输入 /team-model、/team-effort 或 /team-preset，从选择面板操作，不需要填写参数。',
};
const en: typeof zh = {
  model: 'Team model', effort: 'Team reasoning effort',
  modelDescription: 'Choose the model for this session’s teammates', effortDescription: 'Choose reasoning effort for this session’s teammates',
  follow: 'Follow main Agent', modelDefault: 'Model default',
  searchModel: 'Search Team models…', searchEffort: 'Search Team reasoning efforts…',
  empty: 'No available options', noResults: 'No matching options',
  readOnly: 'Settings are read-only', missing: 'The Team plugin is not ready. Refresh the page and retry.',
  unavailable: 'The current model is unavailable. Select a main model first.',
  reopen: 'The model or session has changed. Reopen the selection menu.',
  menuOnly: 'Use /team-model, /team-effort or /team-preset without arguments and choose from the popup.',
};

export const name = `agent-team-model-pin-ui-${CLIENT_VERSION}`;
// Native directory creation and settings each need their qualified RPC service.
export const inject = ['commandUi', 'inputTriggers', 'locale', 'modelDirectories', 'sessions', 'remote', 'remote.session', 'remote.settings'];

/** Register native popup policies without installing a component or stylesheet. */
export function apply(ctx: ClientContext): void {
  ctx.effect(async function* () { yield await ctx.remote.$mount(TEAM_SETTINGS_REMOTE); });
  installPresetCommand(ctx);
  ctx.effect(() => ctx.locale.register('agentTeamModelPin', { zh, en }));
  const t = ctx.locale.bind('agentTeamModelPin');
  const commands = ctx.commandUi;
  // Refuse retired argument syntax rather than accidentally sending a settings
  // command to the conversation model. This public source contributes no rows.
  ctx.effect(() => ctx.inputTriggers.registerSource({
    trigger: '/', name: 'team-settings-input-guard', showGroupTitle: false,
    candidates: async () => [], onPick: () => undefined,
    async matchEnter(_session, line, signal) {
      signal.throwIfAborted();
      if (/^\/(?:team-model|team-effort|team-preset)\s+\S/.test(line.trim())) throw new Error(t('menuOnly'));
      return undefined;
    },
  }));
  const offered = new WeakMap<SelectOption, OfferedChoice>();
  let live = true;
  const available = ({ sessionId }: SessionContext): boolean => ctx.sessions.binding(sessionId) !== undefined;

  const makeSpec = (kind: 'model' | 'effort'): PopupSpec => ({
    kind: 'popupSelect',
    searchMode: 'fuzzy-label',
    searchLabels: () => ({ placeholder: t(kind === 'model' ? 'searchModel' : 'searchEffort'), empty: t('empty'), noResults: t('noResults') }),
    async options({ sessionId }, signal) {
      signal.throwIfAborted();
      if (!live || !available({ sessionId })) throw new Error(t('reopen'));
      const key = teamSessionKey(sessionId, ctx.sessions);
      const settings = await ctx.remote.settings.describe();
      signal.throwIfAborted();
      if (!settings.ok) throw new Error(settings.error.message);
      const view = settings.value.namespaces.find(item => item.ns === SETTINGS_NS);
      if (!view) throw new Error(t('missing'));
      if (!settings.value.writable) throw new Error(t('readOnly'));
      const directory = ctx.modelDirectories.directoryFor(key);
      const state = await directory.load();
      signal.throwIfAborted();
      if (!live) throw new Error(t('reopen'));
      if (state.error) throw new Error(state.error);
      if (state.failures.length) throw new Error(state.failures.map(item => `${item.name}: ${item.message}`).join('\n'));
      const pin = readTeamPin(view, key);
      const follows = !pin || pin.followLeader === true || (!pin.provider && !pin.model);
      const main = state.current;
      const effective = main ? applyTeamPin(main, pin, main) : null;
      const opening: Opening = { sessionId, key, revision: view.revision, signal, directory, effective, pin };
      const offer = (row: SelectOption, resolve: OfferedChoice['resolve']): SelectOption => {
        offered.set(row, { opening, resolve });
        return row;
      };
      if (kind === 'model') {
        return [offer({ id: choiceId('team-follow'), label: t('follow'), active: follows }, () => ({ followLeader: true })),
          ...state.groups.flatMap(group => group.models.map(model => offer({
            id: choiceId('team-model', group.id, model.id), label: model.name, detail: `${group.name} · ${model.id}`,
            group: { name: group.id, label: group.name },
            active: !follows && effective?.provider === group.id && effective.model === model.id,
          }, current => modelPin(current.groups, group.id, model.id))))];
      }
      if (!effective) throw new Error(t('unavailable'));
      const info = findModel(state.groups, effective);
      const selected = pin?.modelDefault ? null : pin?.reasoningEffort ?? (follows ? 'inherit' : null);
      return [
        ...(follows ? [offer({ id: choiceId('team-effort', 'inherit'), label: t('follow'), active: selected === 'inherit' },
          () => ({ followLeader: true }))] : []),
        offer({ id: choiceId('team-effort', null), label: t('modelDefault'), active: selected === null },
          current => effortPin(current.groups, effective, pin, null)),
        ...(info?.reasoning?.efforts ?? []).map(effort => offer({ id: choiceId('team-effort', effort.id), label: effort.name,
          detail: `${info?.name ?? effective.model} · ${effort.id}`, active: selected === effort.id },
        current => effortPin(current.groups, effective, pin, effort.id))),
      ];
    },
    async onSelect(option, { sessionId }) {
      const choice = offered.get(option);
      if (!choice || !live || choice.opening.sessionId !== sessionId) throw new Error(t('reopen'));
      const { opening } = choice;
      opening.signal.throwIfAborted();
      if (!available({ sessionId }) || teamSessionKey(sessionId, ctx.sessions) !== opening.key) throw new Error(t('reopen'));
      const current = opening.directory.store.getSnapshot();
      if (current.error) throw new Error(current.error);
      // An effort menu belongs to its effective Team route, not necessarily
      // the main route. Fixed Team models survive unrelated main selections.
      const effective = current.current ? applyTeamPin(current.current, opening.pin, current.current) : null;
      if (kind === 'effort' && (effective?.provider !== opening.effective?.provider || effective?.model !== opening.effective?.model)) {
        throw new Error(t('reopen'));
      }
      await writeTeamPin(ctx.remote, opening.key, choice.resolve(current), opening.revision);
    },
  });

  const model = makeSpec('model');
  ctx.effect(() => commands.register({ name: 'team-model', available,
    label: () => t('model'), description: () => t('modelDescription'), ui: model }));
  ctx.effect(() => commands.register({ name: 'team-effort', available,
    label: () => t('effort'), description: () => t('effortDescription'), ui: makeSpec('effort') }));
  ctx.effect(() => () => {
    live = false;
    commands.dismiss('team-model');
    commands.dismiss('team-effort');
  });
}

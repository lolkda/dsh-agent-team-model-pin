/** Web half: preserve native picker presentation and add Team rows in-place. */
import * as React from 'react';
import { ModelPicker } from './model-picker.ts';
import { applyTeamPin } from './pin.ts';
import type { Pin } from './pin.ts';
import {
  CLIENT_VERSION, SETTINGS_NS, buildMenu, choiceId, effortPin, findModel, isCurrentRequest,
  modelPin, readTeamPin, teamSessionKey, writeTeamPin,
} from './ui-state.ts';
import type {
  MenuCopy, NamespaceView, ProviderGroup, RequestKey,
  Result, Selection, SessionsLike, SettingsRemote,
} from './ui-state.ts';

interface DirectoryState {
  current: Selection | null;
  groups: readonly ProviderGroup[];
  failures: readonly { id: string; name: string; message: string }[];
  status: 'idle' | 'loading' | 'ready' | 'selecting' | 'error';
  error: string | null;
}
interface Directory {
  store: { getSnapshot(): DirectoryState; subscribe(listener: () => void): () => void };
  load(): Promise<DirectoryState>;
  select(selection: Selection): Promise<Result<void>>;
}
interface ClientContext {
  modelDirectories: { directoryFor(sessionId: string): Directory };
  /** DSH 0.1.7-rc.1 client Session catalog; owns the durable subagent address. */
  sessions: SessionsLike;
  remote: SettingsRemote;
  locale: {
    register(ns: string, dictionaries: Record<string, Record<string, string>>): () => void;
    bind(ns: string): (key: string) => string;
    subscribe(listener: () => void): () => void;
  };
  slots: {
    inject(name: string, effect: () => (() => void)): () => void;
    register(options: { name: string; priority: number }, component: React.ComponentType<ControlProps>): () => void;
  };
  effect(effect: () => (() => void)): unknown;
}
interface ControlProps { sessionId: string; locked: boolean }
interface TeamState { key: string; view: NamespaceView; writable: boolean }

const zh = {
  model: '模型', effort: '推理等级', teamModel: 'Team 模型', teamEffort: 'Team 推理等级',
  follow: '跟随主 Agent', modelDefault: '模型默认', unsupported: '不支持', unavailable: '选择模型',
  title: '模型与 Team 设置', loading: '正在读取 Team 设置…', loadingModels: '正在加载模型…', saving: '正在保存…',
  readOnly: '当前设置只读', back: '返回模型菜单',
  missing: 'Team 插件尚未就绪，请刷新页面后重试', reload: '重试',
  saveError: '保存失败', loadError: '读取 Team 设置失败',
};
const en: typeof zh = {
  model: 'Model', effort: 'Reasoning effort', teamModel: 'Team model', teamEffort: 'Team reasoning effort',
  follow: 'Follow main Agent', modelDefault: 'Model default', unsupported: 'Not supported', unavailable: 'Select model',
  title: 'Model and Team settings', loading: 'Loading Team settings…', loadingModels: 'Loading models…', saving: 'Saving…',
  readOnly: 'Settings are read-only', back: 'Back to model menu',
  missing: 'The Team plugin is not ready. Refresh the page and retry.', reload: 'Retry',
  saveError: 'Save failed', loadError: 'Could not load Team settings',
};
const h = React.createElement;
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

// The facade and EACH RPC namespace are independently guarded Cordis services.
// Native ModelDirectoryResolver also reads remote.session when its cache is cold.
export const name = `agent-team-model-pin-ui-${CLIENT_VERSION}`;
export const inject = ['slots', 'locale', 'modelDirectories', 'sessions', 'remote', 'remote.session', 'remote.settings'];

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register('agentTeamModelPin', { zh, en }));
  const t = ctx.locale.bind('agentTeamModelPin');

  function Control({ sessionId, locked }: ControlProps): React.ReactElement {
    const directory = React.useMemo(() => ctx.modelDirectories.directoryFor(sessionId), [sessionId]);
    const subscribe = React.useCallback((listener: () => void) => directory.store.subscribe(listener), [directory]);
    const snapshot = React.useCallback(() => directory.store.getSnapshot(), [directory]);
    const state = React.useSyncExternalStore(subscribe, snapshot, snapshot);
    const [open, setOpen] = React.useState(false);
    const [teamState, setTeamState] = React.useState<TeamState | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [saving, setSaving] = React.useState(false);
    const [error, setError] = React.useState<string | null>(null);
    const [, setLocaleVersion] = React.useState(0);
    const busy = React.useRef(false);
    const request = React.useRef<RequestKey>({ sessionId, generation: 0 });

    React.useEffect(() => ctx.locale.subscribe(() => setLocaleVersion((value) => value + 1)), []);
    const load = React.useCallback(async () => {
      const token = { sessionId, generation: ++request.current.generation };
      setLoading(true);
      setError(null);
      try {
        const settings = await ctx.remote.settings.describe();
        if (!isCurrentRequest(token, request.current)) return;
        if (!settings.ok) throw new Error(settings.error.message);
        const view = settings.value.namespaces.find((item) => item.ns === SETTINGS_NS);
        if (!view) throw new Error(t('missing'));
        setTeamState({ key: teamSessionKey(sessionId, ctx.sessions), view, writable: settings.value.writable });
      } catch (cause) {
        if (isCurrentRequest(token, request.current)) {
          setTeamState(null);
          setError(`${t('loadError')}: ${message(cause)}`);
        }
      } finally {
        if (isCurrentRequest(token, request.current)) setLoading(false);
      }
    }, [sessionId]);

    React.useEffect(() => {
      void directory.load().catch(() => { /* Native directory errors are published through its store. */ });
      void load();
      return () => { request.current.generation++; };
    }, [directory, load]);

    const pin = teamState ? readTeamPin(teamState.view, teamState.key) : undefined;
    const copy = Object.fromEntries(Object.keys(zh).map((key) => [key, t(key)])) as unknown as MenuCopy;
    const main = state.current;
    const model = findModel(state.groups, main);
    const mainEffort = main?.reasoningEffort ?? model?.reasoning?.defaultEffort;
    const effectiveTeam = main ? applyTeamPin(main, pin, main) : null;
    const rows = buildMenu(state.groups, main, pin, copy, locked || saving || state.status === 'selecting',
      loading || !teamState?.writable);
    const follows = !pin || pin.followLeader || (!pin.provider && !pin.model);
    const selectedIds = [
      choiceId('main-model', main?.provider ?? '', main?.model ?? ''),
      choiceId('main-effort', mainEffort ?? null),
      follows ? choiceId('team-follow') : choiceId('team-model', effectiveTeam?.provider ?? '', effectiveTeam?.model ?? ''),
      choiceId('team-effort', pin?.modelDefault ? null : pin?.reasoningEffort ?? (follows ? 'inherit' : null)),
    ];

    const save = async (id: string): Promise<boolean> => {
      if (busy.current || locked) return false;
      const [target, first, second] = JSON.parse(id) as [string, string | null, string | undefined];
      if (target.startsWith('team-') && (!teamState?.writable || loading)) return false;
      busy.current = true;
      setSaving(true);
      setError(null);
      const token = { sessionId, generation: ++request.current.generation };
      setLoading(false);
      try {
        if (target.startsWith('main-')) {
          let selection: Selection;
          if (target === 'main-model' && first && second) {
            modelPin(state.groups, first, second);
            if (main?.provider === first && main.model === second) {
              setOpen(false);
              return true;
            }
            const info = findModel(state.groups, { provider: first, model: second });
            selection = { provider: first, model: second, ...(info?.reasoning?.defaultEffort ? { reasoningEffort: info.reasoning.defaultEffort } : {}) };
          } else {
            if (!main) throw new Error(t('unavailable'));
            if (first !== null && !model?.reasoning?.efforts.some((item) => item.id === first)) throw new Error(t('unsupported'));
            selection = { provider: main.provider, model: main.model, ...(first ? { reasoningEffort: first } : {}) };
          }
          const result = await directory.select(selection);
          if (!result.ok) throw new Error(result.error.message);
        } else {
          if (!teamState) throw new Error(t('missing'));
          let next: Pin;
          if (target === 'team-follow' || target === 'team-effort' && first === 'inherit') next = { followLeader: true };
          else if (target === 'team-model' && first && second) next = modelPin(state.groups, first, second);
          else {
            if (!effectiveTeam) throw new Error(t('unavailable'));
            next = effortPin(state.groups, effectiveTeam, pin, first);
          }
          const view = await writeTeamPin(ctx.remote, teamState.key, next, teamState.view.revision);
          if (isCurrentRequest(token, request.current)) setTeamState({ ...teamState, view });
        }
        if (!isCurrentRequest(token, request.current)) return false;
        setOpen(false);
        return true;
      } catch (cause) {
        if (isCurrentRequest(token, request.current)) {
          setError(`${t('saveError')}: ${message(cause)}`);
          setOpen(true);
        }
        return false;
      } finally {
        if (isCurrentRequest(token, request.current)) { setSaving(false); busy.current = false; }
      }
    };

    const refresh = (): void => {
      if (busy.current) return;
      void directory.load().catch(() => { /* Native directory errors are published through its store. */ });
      void load();
    };
    const effort = model?.reasoning?.efforts.find((item) => item.id === mainEffort)?.name ?? mainEffort;
    return h(ModelPicker, {
      open, disabled: locked || saving, busy: saving,
      label: model?.name ?? main?.model ?? t('unavailable'), effort, title: t('title'),
      rows, selectedIds,
      status: saving ? t('saving') : loading ? t('loading') : state.status === 'loading' ? t('loadingModels')
        : teamState && !teamState.writable ? t('readOnly') : undefined,
      error: error ?? state.error ?? (state.failures.length ? state.failures.map((failure) => `${failure.name}: ${failure.message}`).join('\n') : undefined),
      backLabel: t('back'), reloadLabel: t('reload'),
      onChoose: save, onReload: refresh,
      onOpenChange: (next: boolean) => { if (busy.current) return; if (next) refresh(); setOpen(next); },
    });
  }

  function Seat(props: ControlProps): React.ReactElement {
    return h(Control, { ...props, key: props.sessionId });
  }
  const registration = { name: 'conversation.input.model', priority: -100, registrant: name };
  ctx.slots.inject('conversation.input.model', () => ctx.slots.register(registration, Seat));
}

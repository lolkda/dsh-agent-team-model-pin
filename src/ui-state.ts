/** Browser-safe selection rules shared by the menu and its tests. */
import { applyTeamPin, normalizePin, resolvePin } from './pin.ts';
import type { Pin, Scope } from './pin.ts';

export const SETTINGS_NS = 'agent-team-model-pin';
export interface Selection { provider: string; model: string; reasoningEffort?: string }
export interface ModelInfo {
  id: string; name: string; description?: string;
  reasoning?: { efforts: readonly { id: string; name: string }[]; defaultEffort?: string };
}
export interface ProviderGroup { id: string; name: string; models: readonly ModelInfo[] }
export type Result<T> = { ok: true; value: T } | { ok: false; error: { message: string; code?: string } };
export interface NamespaceView {
  ns: string; value: unknown; base?: unknown; revision: number;
}
export interface SettingsRemote {
  settings: {
    describe(): Promise<Result<{ writable: boolean; namespaces: NamespaceView[] }>>;
    mutate(ns: string, ops: { op: 'set'; path: string[]; value: Pin }[], revision: number): Promise<Result<NamespaceView>>;
  };
}
export interface TeamView { members: readonly { id: string; role: string }[] }
export interface RequestKey { sessionId: string; generation: number }

export function isCurrentRequest(request: RequestKey, current: RequestKey): boolean {
  return request.sessionId === current.sessionId && request.generation === current.generation;
}

export function teamSessionKey(sessionId: string, view: TeamView): string {
  return view.members.find((member) => member.role === 'lead')?.id ?? sessionId;
}

export function findModel(groups: readonly ProviderGroup[], route: Partial<Selection> | null | undefined): ModelInfo | undefined {
  return groups.find((group) => group.id === route?.provider)?.models.find((model) => model.id === route?.model);
}

export function modelPin(groups: readonly ProviderGroup[], provider: string, model: string): Pin {
  if (!findModel(groups, { provider, model })) throw new Error('The selected model is no longer available.');
  return { provider, model, modelDefault: true };
}

export function effortPin(groups: readonly ProviderGroup[], effective: Selection, pin: Pin | undefined, effort: string | null): Pin {
  const model = findModel(groups, effective);
  if (effort !== null && !model?.reasoning?.efforts.some((item) => item.id === effort)) {
    throw new Error('The selected model does not support this reasoning effort.');
  }
  const route: Pin = !pin?.provider && !pin?.model || pin?.followLeader
    ? { followLeader: true }
    : { provider: effective.provider, model: effective.model };
  return effort === null ? { ...route, modelDefault: true } : { ...route, reasoningEffort: effort };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function readTeamPin(view: Pick<NamespaceView, 'base' | 'value'>, sessionId: string): Pin | undefined {
  // Only the immutable base advertises composition metadata; never trust a
  // user-supplied "defaults" value as the Host's configuration.
  const base = record(view.base);
  const value = record(view.value);
  return resolvePin({
    scope: (['teammates', 'members', 'all'].includes(String(base.scope)) ? base.scope : 'teammates') as Scope,
    role: 'teammate', sessionId,
    defaults: normalizePin(base.defaults),
    configSessions: record(base.configuredSessions) as Record<string, Pin>,
    liveSessions: record(value.sessions) as Record<string, Pin>,
  });
}

export async function writeTeamPin(remote: Pick<SettingsRemote, 'settings'>, sessionId: string, pin: Pin, revision: number): Promise<NamespaceView> {
  if (!sessionId || !Number.isSafeInteger(revision) || revision < 0) throw new Error('Load the current session settings before saving.');
  const value = normalizePin(pin);
  if (!value) throw new Error('Choose a model or follow the main Agent.');
  const result = await remote.settings.mutate(SETTINGS_NS, [{ op: 'set', path: ['sessions', sessionId], value }], revision);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export interface MenuCopy {
  model: string; effort: string; teamModel: string; teamEffort: string;
  follow: string; modelDefault: string; unsupported: string; unavailable: string;
}
export interface Choice {
  id: string; label: string; detail?: string; value?: string; disabled?: boolean;
  submenu?: Choice[];
}
export type MenuRow = Choice | { id: string; type: 'separator' };
export const choiceId = (...parts: (string | null)[]): string => JSON.stringify(parts);

/** Choice data for the original two controls and Team controls in one picker. */
export function buildMenu(
  groups: readonly ProviderGroup[], main: Selection | null, pin: Pin | undefined,
  copy: MenuCopy, locked = false, teamLocked = false,
): MenuRow[] {
  const follows = !pin || pin.followLeader === true || (!pin.provider && !pin.model);
  const team = main ? applyTeamPin(main, pin, main) : null;
  const mainInfo = findModel(groups, main);
  const teamInfo = findModel(groups, team);
  const mainEfforts = mainInfo?.reasoning?.efforts ?? [];
  const teamEfforts = teamInfo?.reasoning?.efforts ?? [];
  const models = (target: string): Choice[] => groups.flatMap((provider) => provider.models.map((model) => ({
    id: choiceId(target, provider.id, model.id), label: model.name, detail: provider.name,
  })));
  const effortName = (info: ModelInfo | undefined, effort: string | undefined): string => {
    const effective = effort ?? info?.reasoning?.defaultEffort;
    return info?.reasoning?.efforts.find((item) => item.id === effective)?.name ?? effective ?? copy.modelDefault;
  };
  const teamEffortValue = pin?.modelDefault ? copy.modelDefault
    : pin?.reasoningEffort ? effortName(teamInfo, pin.reasoningEffort)
    : follows ? copy.follow : copy.modelDefault;
  return [
    { id: 'main-model', label: copy.model, value: mainInfo?.name ?? main?.model ?? copy.unavailable,
      disabled: locked || !groups.some((group) => group.models.length > 0), submenu: models('main-model') },
    { id: 'main-effort', label: copy.effort, value: mainEfforts.length ? effortName(mainInfo, main?.reasoningEffort) : copy.unsupported,
      disabled: locked || !main || !mainEfforts.length,
      submenu: [{ id: choiceId('main-effort', null), label: copy.modelDefault }, ...mainEfforts.map((effort) => ({
        id: choiceId('main-effort', effort.id), label: effort.name,
      }))] },
    { id: 'team-divider', type: 'separator' },
    { id: 'team-model', label: copy.teamModel, value: follows ? copy.follow : teamInfo?.name ?? pin?.model ?? copy.unavailable,
      disabled: locked || teamLocked,
      submenu: [{ id: choiceId('team-follow'), label: copy.follow }, ...models('team-model')] },
    { id: 'team-effort', label: copy.teamEffort, value: teamEfforts.length ? teamEffortValue : copy.unsupported,
      disabled: locked || teamLocked || !team || !teamEfforts.length,
      submenu: [
        ...(follows ? [{ id: choiceId('team-effort', 'inherit'), label: copy.follow }] : []),
        { id: choiceId('team-effort', null), label: copy.modelDefault },
        ...teamEfforts.map((effort) => ({ id: choiceId('team-effort', effort.id), label: effort.name })),
      ] },
  ];
}

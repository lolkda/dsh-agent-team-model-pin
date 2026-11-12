/** Pure client-side data rules for the three Team rows in the model menu. */
import { applyTeamPin } from './pin.ts';
import type { Pin } from './pin.ts';
import { resolvePresetPolicy } from './preset-policy.ts';
import type { PresetRow } from './preset-policy.ts';
import {
  choiceId,
  effortPin,
  findModel,
  modelPin,
  readTeamPin,
  teamSessionKey,
  writeTeamPin,
} from './ui-state.ts';
import type {
  NamespaceView,
  ProviderGroup,
  Result,
  Selection,
  SessionsLike,
  SettingsRemote,
} from './ui-state.ts';

export type TeamMenuKind = 'preset' | 'model' | 'effort';

export type TeamMenuChoice =
  | { kind: 'preset'; preset: string | null }
  | { kind: 'model'; follow: true }
  | { kind: 'model'; provider: string; model: string }
  | { kind: 'effort'; follow: true }
  | { kind: 'effort'; modelDefault: true }
  | { kind: 'effort'; effort: string };

export interface TeamMenuOption {
  id: string;
  label: string;
  detail?: string;
  group?: { name: string; label: string };
  active?: boolean;
  choice: TeamMenuChoice;
}

export interface TeamMenuRowState {
  revision: number;
  writable: boolean;
  current: string;
  options: readonly TeamMenuOption[];
  error?: string;
}

export interface TeamMenuData {
  preset: TeamMenuRowState;
  model: TeamMenuRowState;
  effort: TeamMenuRowState;
}

export interface TeamMenuLabels {
  follow: string;
  modelDefault: string;
  unavailable: string;
  readOnly: string;
  missing: string;
  catalogUnavailable: string;
  saveUnavailable: string;
  noModel: string;
  searchPreset: string;
  searchModel: string;
  searchEffort: string;
  empty: string;
  noResults: string;
}

export interface TeamDirectoryState {
  current: Selection | null;
  groups: readonly ProviderGroup[];
  failures: readonly { name: string; message: string }[];
  error: string | null;
}

export interface TeamDirectory {
  load(): Promise<TeamDirectoryState>;
  store: { getSnapshot(): TeamDirectoryState };
}

export interface TeamMenuContext {
  remote: {
    settings: SettingsRemote['settings'];
    agentPresets?: {
      list(): Promise<Result<{ presets: readonly PresetRow[] }>>;
    };
    teamSettings?: {
      preset(agentId: string, revision: number, choice: string | null, signal?: AbortSignal):
        Promise<Result<{ kind: 'success' | 'error'; text?: string }>>;
    };
  };
  sessions: SessionsLike;
  modelDirectories: { directoryFor(sessionId: string): TeamDirectory };
  commandUi?: { popupFor?(ctx: unknown): { open(...args: unknown[]): void } | undefined };
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/** Resolve the effective preset policy for one durable root key. */
function readPreset(view: Pick<NamespaceView, 'base' | 'value'>, key: string): string | null | undefined {
  const base = record(view.base);
  const value = record(view.value);
  return resolvePresetPolicy(
    value.presetDefault === undefined ? base.presetDefault : value.presetDefault,
    { ...record(base.presetSessions), ...record(value.presetSessions) },
    key,
  );
}

function followsLeader(pin: Pin | undefined): boolean {
  return pin === undefined || pin.followLeader === true || (!pin.provider && !pin.model);
}

async function readSettings(ctx: TeamMenuContext, labels: TeamMenuLabels): Promise<{
  view: NamespaceView;
  writable: boolean;
}> {
  const result = await ctx.remote.settings.describe();
  if (!result.ok) throw new Error(result.error.message);
  const view = result.value.namespaces.find(item => item.ns === 'agent-team-model-pin');
  if (!view) throw new Error(labels.missing);
  return { view, writable: result.value.writable };
}

/**
 * Load all three rows from one settings snapshot and one model-directory read.
 * Row-level failures stay local so a missing preset catalog does not hide the
 * model and effort controls.
 */
export async function loadTeamMenuData(
  ctx: TeamMenuContext,
  sessionId: string,
  labels: TeamMenuLabels,
  displayPreset: (row: PresetRow) => string,
): Promise<TeamMenuData> {
  const { view, writable } = await readSettings(ctx, labels);
  const key = teamSessionKey(sessionId, ctx.sessions);
  const revision = view.revision;

  let presetRows: readonly PresetRow[] = [];
  let presetError: string | undefined;
  if (ctx.remote.agentPresets === undefined) {
    presetError = labels.catalogUnavailable;
  } else {
    try {
      const result = await ctx.remote.agentPresets.list();
      if (!result.ok) presetError = result.error.message;
      else {
        presetRows = result.value.presets.filter(row => row.broken === undefined);
      }
    } catch (error) {
      presetError = error instanceof Error ? error.message : String(error);
    }
  }
  if (ctx.remote.teamSettings === undefined) presetError ??= labels.saveUnavailable;
  if (!writable) presetError ??= labels.readOnly;

  let selectedPreset: string | null | undefined;
  try {
    selectedPreset = readPreset(view, key);
  } catch (error) {
    presetError = error instanceof Error ? error.message : String(error);
  }
  const selectedRow = selectedPreset === null || selectedPreset === undefined
    ? undefined
    : presetRows.find(row => row.id === selectedPreset);
  const presetCurrent = selectedPreset === null || selectedPreset === undefined
    ? labels.follow
    : selectedRow === undefined ? selectedPreset : displayPreset(selectedRow);
  const presetOptions: TeamMenuOption[] = [
    { id: choiceId('menu-preset', null), label: labels.follow, active: selectedPreset === null || selectedPreset === undefined,
      choice: { kind: 'preset', preset: null } },
    ...presetRows.map(row => ({
      id: choiceId('menu-preset', row.id),
      label: displayPreset(row),
      ...(row.description === undefined ? {} : { detail: row.description }),
      active: selectedPreset === row.id,
      choice: { kind: 'preset' as const, preset: row.id },
    })),
  ];

  let directory: TeamDirectoryState | undefined;
  let directoryError: string | undefined;
  try {
    directory = await ctx.modelDirectories.directoryFor(key).load();
    if (directory.error !== null) directoryError = directory.error;
    else if (directory.failures.length > 0) {
      directoryError = directory.failures.map(item => `${item.name}: ${item.message}`).join('\n');
    }
  } catch (error) {
    directoryError = error instanceof Error ? error.message : String(error);
  }

  let pin: Pin | undefined;
  try {
    pin = readTeamPin(view, key);
  } catch (error) {
    directoryError ??= error instanceof Error ? error.message : String(error);
  }
  const follows = followsLeader(pin);
  const main = directory?.current ?? null;
  const effective = main === null ? null : applyTeamPin(main, pin, main);
  if (!writable) directoryError ??= labels.readOnly;

  const models = directory?.groups ?? [];
  const modelOptions: TeamMenuOption[] = [
    { id: choiceId('menu-model', 'follow'), label: labels.follow, active: follows,
      choice: { kind: 'model', follow: true } },
    ...models.flatMap(group => group.models.map(model => ({
      id: choiceId('menu-model', group.id, model.id),
      label: model.name,
      detail: `${group.name} · ${model.id}`,
      group: { name: group.id, label: group.name },
      active: !follows && effective?.provider === group.id && effective.model === model.id,
      choice: { kind: 'model' as const, provider: group.id, model: model.id },
    }))),
  ];
  const modelCurrent = follows
    ? labels.follow
    : effective === null
      ? pin?.provider && pin.model ? pin.model : labels.unavailable
      : findModel(models, effective)?.name ?? effective.model;

  const effortModel = effective === null ? undefined : findModel(models, effective);
  const effortOptions: TeamMenuOption[] = [
    { id: choiceId('menu-effort', 'follow'), label: labels.follow, active: follows,
      choice: { kind: 'effort', follow: true } },
    { id: choiceId('menu-effort', 'default'), label: labels.modelDefault,
      active: !follows && (pin?.modelDefault === true || pin?.reasoningEffort === undefined),
      choice: { kind: 'effort', modelDefault: true } },
    ...(effortModel?.reasoning?.efforts ?? []).map(effort => ({
      id: choiceId('menu-effort', effort.id),
      label: effort.name,
      detail: `${effortModel?.name ?? effective?.model ?? ''} · ${effort.id}`,
      group: { name: effortModel?.id ?? 'effort', label: effortModel?.name ?? effective?.model ?? '' },
      active: !follows && pin?.modelDefault !== true && pin?.reasoningEffort === effort.id,
      choice: { kind: 'effort' as const, effort: effort.id },
    })),
  ];
  const effortCurrent = follows
    ? labels.follow
    : pin?.modelDefault === true || pin?.reasoningEffort === undefined
      ? labels.modelDefault
      : effortModel?.reasoning?.efforts.find(item => item.id === pin?.reasoningEffort)?.name
        ?? pin.reasoningEffort;

  return {
    preset: {
      revision, writable, current: presetCurrent, options: presetOptions,
      ...(presetError === undefined ? {} : { error: presetError }),
    },
    model: {
      revision, writable, current: modelCurrent, options: modelOptions,
      ...(directoryError === undefined ? {} : { error: directoryError }),
    },
    effort: {
      revision, writable, current: effortCurrent, options: effortOptions,
      ...(directoryError === undefined ? {} : { error: directoryError }),
    },
  };
}

/** Persist one row's explicit choice through the same RPC/settings paths as the commands. */
export async function saveTeamMenuChoice(
  ctx: TeamMenuContext,
  sessionId: string,
  choice: TeamMenuChoice,
  revision: number,
  labels: TeamMenuLabels,
): Promise<void> {
  const key = teamSessionKey(sessionId, ctx.sessions);
  if (choice.kind === 'preset') {
    const remote = ctx.remote.teamSettings;
    if (remote === undefined) throw new Error(labels.saveUnavailable);
    const result = await remote.preset(key, revision, choice.preset);
    if (!result.ok) throw new Error(result.error.message);
    if (result.value === undefined || result.value.kind !== 'success') {
      throw new Error(result.value?.text ?? labels.saveUnavailable);
    }
    return;
  }
  if (choice.kind === 'model') {
    if ('follow' in choice) {
      await writeTeamPin(ctx.remote, key, { followLeader: true }, revision);
      return;
    }
    const directory = await ctx.modelDirectories.directoryFor(key).load();
    if (directory.error !== null) throw new Error(directory.error);
    const pin = modelPin(directory.groups, choice.provider, choice.model);
    await writeTeamPin(ctx.remote, key, pin, revision);
    return;
  }
  const { view } = await readSettings(ctx, labels);
  const pin = readTeamPin(view, key);
  if ('follow' in choice) {
    await writeTeamPin(ctx.remote, key, { followLeader: true }, revision);
    return;
  }
  const directory = await ctx.modelDirectories.directoryFor(key).load();
  if (directory.error !== null) throw new Error(directory.error);
  const main = directory.current;
  const effective = main === null ? null : applyTeamPin(main, pin, main);
  if (effective === null) throw new Error(labels.noModel);
  const next = 'modelDefault' in choice
    ? effortPin(directory.groups, effective, pin, null)
    : effortPin(directory.groups, effective, pin, choice.effort);
  await writeTeamPin(ctx.remote, key, next, revision);
}

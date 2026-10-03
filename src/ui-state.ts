/** Browser-safe Team selection and settings rules; native DSH owns the UI. */
import { normalizePin, resolvePin } from './pin.ts';
import type { Pin, Scope } from './pin.ts';

export const SETTINGS_NS = 'agent-team-model-pin';
/** Client registration marker; no custom DOM or CSS is installed. */
export const CLIENT_VERSION = '1.5.0-rc.4';
export const choiceId = (...parts: (string | null)[]): string => JSON.stringify(parts);
export interface Selection { provider: string; model: string; reasoningEffort?: string }
export interface ModelInfo {
  id: string; name: string; description?: string;
  reasoning?: { efforts: readonly { id: string; name: string }[]; defaultEffort?: string };
}
export interface ProviderGroup { id: string; name: string; models: readonly ModelInfo[] }
export type Result<T> = { ok: true; value: T } | { ok: false; error: { message: string; code?: string } };
export interface NamespaceView { ns: string; value: unknown; base?: unknown; revision: number }
export interface SettingsRemote {
  settings: {
    describe(): Promise<Result<{ writable: boolean; namespaces: NamespaceView[] }>>;
    mutate(ns: string, ops: { op: 'set'; path: string[]; value: Pin }[], revision: number): Promise<Result<NamespaceView>>;
  };
}
export interface SessionFaceLike {
  getSnapshot(): { subagent?: { address?: { parentSessionId?: string } } } | undefined;
}
export interface SessionsLike {
  binding(sessionId: string): { session: SessionFaceLike } | undefined;
}

/** Resolve a delegated session to the same durable Lead key as the native Team UI. */
export function teamSessionKey(sessionId: string, sessions: SessionsLike): string {
  try {
    const parent = sessions.binding(sessionId)?.session.getSnapshot()?.subagent?.address?.parentSessionId;
    return typeof parent === 'string' && parent.length > 0 ? parent : sessionId;
  } catch {
    return sessionId;
  }
}

export function findModel(groups: readonly ProviderGroup[], route: Partial<Selection> | null | undefined): ModelInfo | undefined {
  return groups.find(group => group.id === route?.provider)?.models.find(model => model.id === route?.model);
}

export function modelPin(groups: readonly ProviderGroup[], provider: string, model: string): Pin {
  if (!findModel(groups, { provider, model })) throw new Error('The selected model is no longer available.');
  return { provider, model, modelDefault: true };
}

export function effortPin(groups: readonly ProviderGroup[], effective: Selection, pin: Pin | undefined, effort: string | null): Pin {
  const model = findModel(groups, effective);
  if (effort !== null && !model?.reasoning?.efforts.some(item => item.id === effort)) {
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
  // Only immutable `base` describes composition; the resolved session layer
  // carries runtime overrides. Never treat user metadata as composition.
  const base = record(view.base);
  const value = record(view.value);
  return resolvePin({
    scope: (['teammates', 'members', 'all'].includes(String(base.scope)) ? base.scope : 'teammates') as Scope,
    role: 'teammate', sessionId,
    defaults: normalizePin(base.defaults),
    configSessions: record(base.sessions) as Record<string, Pin>,
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

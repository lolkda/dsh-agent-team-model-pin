/** Private-to-the-plugin Remote transport; never contributes slash-menu rows. */
import { bindTypertRemote, Remote } from '@deepseek-ai/dsh-typert-protocol';

export interface RpcAgent { id: string }
export type SettingsResult = { kind: 'success' | 'error'; text?: string };
export type SettingsHandler = (input: { agent: RpcAgent; rawInput: string; signal: AbortSignal }) => SettingsResult | Promise<SettingsResult>;
interface Host {
  provide(name: string, value: unknown): unknown;
  effect(callback: () => unknown): unknown;
}

/** Apply the public standard-decorator initializer without non-erasable TS syntax. */
function expose(instance: TeamSettingsRpc, name: 'model' | 'preset'): void {
  Remote(instance[name] as (...args: unknown[]) => unknown, {
    kind: 'method', name, static: false, private: false, metadata: undefined,
    access: { has: object => name in object, get: object => (object as unknown as Record<string, (...args: unknown[]) => unknown>)[name] },
    addInitializer(initializer) { initializer.call(instance); },
  });
}

class TeamSettingsRpc {
  readonly typertRemote;
  private active = true;
  private readonly abort = new AbortController();
  readonly ctx: Host;
  constructor(ctx: Host, privateHandlers: { model: SettingsHandler; preset: SettingsHandler }) {
    this.ctx = ctx;
    this.handlers = privateHandlers;
    expose(this, 'model'); expose(this, 'preset');
    this.typertRemote = bindTypertRemote(this, 'teamSettings');
    ctx.provide('teamSettings', this);
    ctx.effect(() => () => { this.active = false; this.abort.abort(new Error('Team settings plugin unloaded')); });
  }
  private readonly handlers: { model: SettingsHandler; preset: SettingsHandler };
  private signal(signal: AbortSignal): AbortSignal {
    if (!this.active) throw new Error('Team settings plugin unloaded');
    const combined = AbortSignal.any([signal, this.abort.signal]);
    combined.throwIfAborted();
    return combined;
  }
  async model(agent: RpcAgent, rawInput: unknown, signal: AbortSignal): Promise<SettingsResult> {
    if (typeof rawInput !== 'string') return { kind: 'error', text: 'Invalid Team model request' };
    return this.handlers.model({ agent, rawInput, signal: this.signal(signal) });
  }
  async preset(agent: RpcAgent, revision: unknown, choice: unknown, signal: AbortSignal): Promise<SettingsResult> {
    if (!Number.isSafeInteger(revision) || (revision as number) < 0 || (choice !== null && (typeof choice !== 'string' || !choice.trim()))) {
      return { kind: 'error', text: 'Team 预设保存参数无效；请重新打开选择菜单' };
    }
    return this.handlers.preset({ agent, rawInput: `apply ${revision} ${JSON.stringify(choice)}`, signal: this.signal(signal) });
  }
}

export function installTeamSettingsRpc(host: Host, handlers: { model: SettingsHandler; preset: SettingsHandler }): void {
  new TeamSettingsRpc(host, handlers);
}

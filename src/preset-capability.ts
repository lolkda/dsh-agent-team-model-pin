/** Explicit native seam; never infer support just from a package version. */
export function supportsTeamPresetRuntime(host: { get(name: string): unknown }): boolean {
  const api = host.get('subagents') as { childSetupVersion?: unknown; registerChildSetup?: unknown } | undefined;
  return api?.childSetupVersion === 1 && typeof api.registerChildSetup === 'function';
}
export const PRESET_RUNTIME_REQUIRED = '当前 DSH 缺少安全的队友创建前预设接口（childSetupVersion=1）。需要应用随本插件提供的宿主补丁或升级到提供该接口的 DSH；未保存预设设置。';

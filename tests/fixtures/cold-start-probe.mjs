import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const [installation, profileDir] = process.argv.slice(2);
const fromInstall = (name) => import(pathToFileURL(join(installation, 'node_modules', name, 'lib/index.js')).href);
const { boot, createProfileResolutionGeneration, loadProfileDirectory, PluginPackages } = await fromInstall('@deepseek-ai/dsh-app-boot');
const { createScope } = await fromInstall('@deepseek-ai/dsh-scope');
const profile = loadProfileDirectory('atmp-cold-start', profileDir, join(installation, 'package.json'));
const generation = await createProfileResolutionGeneration({
  installAnchor: join(installation, 'package.json'), profile,
});
let ctx;
const scopes = [];
let phase = 'boot';
try {
  // Exactly the runtime resolver mode used by runProfile() in DSH 0.1.6-alpha.2.
  ctx = await boot('atmp-cold-start', join(profileDir, 'cordis.yml'), [
    ...profile.layers.flatMap((layer) => layer.patches), ...profile.patches,
  ], (owner) => owner.plugin(PluginPackages, { generation, behavior: 'enforce' }));
  phase = 'plugin-activation';
  const pluginEntry = [...ctx.get('loader').entries()].find((entry) => entry.options.name === '@lolkda/dsh-agent-team-model-pin');
  if (profile.layers.some((layer) => layer.packageName === '@lolkda/dsh-agent-team-model-pin')) {
    assert.equal(pluginEntry?.fiber?.state, 2, 'the installed plugin must activate, not silently stay failed/pending');
    const deployed = await fromInstall('@deepseek-ai/dsh-agent');
    const loaded = await pluginEntry.parent.tree.import('@deepseek-ai/dsh-agent');
    assert.equal(loaded.installModelSelection, deployed.installModelSelection,
      'the official selector must be the deployment module instance');
  }
  phase = 'preset-mount';
  const presets = ctx.get('agentPresets');
  const prompts = ctx.get('systemPrompt');
  assert.ok(presets && prompts, 'the real registry and preset services must be active');
  const firstKey = {};
  const secondKey = {};
  const first = createScope(ctx, firstKey);
  const second = createScope(ctx, secondKey);
  scopes.push(first, second);
  await presets.mount(first.ctx, 'fixture');
  await presets.mount(second.ctx, 'fixture');
  const contains = (assembly) => assembly.sections.some((section) => section.text.includes('COLD_START_SCOPED_PERSONA'));
  const globalContainsPersona = contains(await prompts.assemble());
  const firstContainsPersona = contains(await prompts.assemble({ scope: firstKey }));
  const secondContainsPersona = contains(await prompts.assemble({ scope: secondKey }));
  await first.dispose();
  const afterDisposeContainsPersona = contains(await prompts.assemble({ scope: secondKey }));
  console.log('ATMP_COLD_START=' + JSON.stringify({
    phase: 'complete', globalContainsPersona, firstContainsPersona, secondContainsPersona, afterDisposeContainsPersona,
  }));
} catch (error) {
  console.log('ATMP_COLD_START=' + JSON.stringify({ phase, error: String(error) }));
} finally {
  for (const scope of scopes.reverse()) await scope.dispose();
  await ctx?.fiber.dispose();
}

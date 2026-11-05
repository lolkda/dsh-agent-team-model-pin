/**
 * TEST-ONLY loader for the deployment-owned subagent runtime.
 *
 * The npm package `@deepseek-ai/dsh-subagent@0.2.2-rc.1` published before the
 * native `childSetupVersion = 1` protocol landed in the harness build. Tests
 * therefore prefer the exact subagent package shipped in the installed DSH,
 * copy its bytes into an isolated directory, and resolve its dependencies from
 * this project's SDK so every Cordis service instance stays shared.
 */
import { cp, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findDshInstallation } from './dsh-installation.mjs';

export const workspaceSubagentRoot = fileURLToPath(new URL('../../node_modules/@deepseek-ai/dsh-subagent/', import.meta.url));
const projectNodeModules = fileURLToPath(new URL('../../node_modules/', import.meta.url));

async function hasChildSetup(sourceRoot) {
  try {
    return (await readFile(join(sourceRoot, 'lib/index.js'), 'utf8')).includes('childSetupVersion');
  } catch {
    return false;
  }
}

/**
 * Load an isolated copy of the deployment's real subagent runtime.
 * @param {{sourceRoot?: string, nodeModulesRoot?: string}} [options] Test seams.
 * @returns The module, copied root, and idempotent disposer.
 */
export async function loadPatchedSubagent({ sourceRoot, nodeModulesRoot = projectNodeModules } = {}) {
  const installation = await findDshInstallation();
  const candidates = [
    sourceRoot,
    installation ? join(installation, 'node_modules/@deepseek-ai/dsh-subagent') : undefined,
    workspaceSubagentRoot,
  ].filter(Boolean);
  let source;
  for (const candidate of candidates) {
    if (await hasChildSetup(candidate)) { source = candidate; break; }
  }
  if (source === undefined) throw new Error('No installed DSH subagent runtime exposes childSetupVersion');
  const directory = await mkdtemp(join(tmpdir(), 'atmp-preset-host-'));
  const root = join(directory, 'dsh-subagent');
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    // Keep the package layout, but never copy its dependency tree: the
    // symlink below makes it resolve the project's single SDK instance.
    await cp(source, root, {
      recursive: true,
      filter: (path) => path === source || !dirname(path).endsWith('node_modules'),
    });
    await symlink(nodeModulesRoot, join(directory, 'node_modules'), 'dir');
    const module = await import(pathToFileURL(join(root, 'lib/index.js')).href);
    return { module, root, dispose, [Symbol.asyncDispose]: dispose };
  } catch (error) {
    await dispose();
    throw error;
  }
}

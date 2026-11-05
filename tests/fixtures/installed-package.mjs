import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

/**
 * Resolve a package owned by an installed DSH runtime.
 *
 * A packaged deployment keeps dependencies under `dsh/node_modules`; a normal
 * npm global install hoists them beside the `dsh` package instead. Tests must
 * support both layouts rather than assume the deployment layout.
 *
 * @param {string} installation - Directory containing the `dsh` package.
 * @param {string} name - Package name to locate.
 * @returns {string} Absolute package directory.
 */
export function installedPackageRoot(installation, name) {
  const candidates = [
    join(installation, 'node_modules', name),
    join(dirname(installation), name.startsWith('@') ? name.split('/')[1] : name),
    join(dirname(dirname(installation)), name),
  ];
  const found = candidates.find(candidate => existsSync(join(candidate, 'package.json')));
  if (found === undefined) throw new Error(`Installed DSH package ${name} not found beside ${installation}`);
  return found;
}

/** Resolve one file inside an installed dependency. */
export function installedPackageFile(installation, name, path) {
  return join(installedPackageRoot(installation, name), path);
}

import { access, realpath } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';

// Test-only discovery. Production plugin code must never hard-code or probe
// installation paths; it receives the SDK from DSH's own runtime resolver.
export async function findDshInstallation() {
  if (process.env.DSH_TEST_INSTALL_ROOT) return process.env.DSH_TEST_INSTALL_ROOT;
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    try {
      const entry = await realpath(join(directory, 'dsh'));
      const root = dirname(dirname(entry));
      await access(join(root, 'lib', 'profile-boot.js'));
      return root;
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    }
  }
  return undefined;
}

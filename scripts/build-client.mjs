import { build } from 'esbuild';

// Browser artifact uses the Harness module table, never its own React copy.
await build({
  entryPoints: ['src/client.ts'],
  outfile: 'dist/client.js',
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  external: ['react', 'react-dom', '@deepseek-ai/dsh-client-ui-primitives'],
  banner: { js: `window.__ModuleLoader__.load({id:"@lolkda/dsh-agent-team-model-pin",factory(require){const module={exports:{}};const exports=module.exports;` },
  footer: { js: '\nreturn module.exports;}});' },
  logLevel: 'info',
});

// The bundle's Web-enabled Host entry is a distinct module from the legacy
// Host-only export. Both are generated from the same tested source.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/web.js',
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node20',
  logLevel: 'info',
});

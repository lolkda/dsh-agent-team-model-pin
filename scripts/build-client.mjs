import { build } from 'esbuild';

// Browser artifact registers native command policies plus the model-menu rows.
// React and the shared primitives stay external so the DSH module loader owns
// one runtime copy; the rows join DSH's existing model menu rather than
// shipping a separate picker or stylesheet.
await build({
  entryPoints: ['src/client.ts'],
  outfile: 'dist/client.js',
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  external: ['react', 'react/jsx-runtime'],
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

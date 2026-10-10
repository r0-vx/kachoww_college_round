import { build } from 'esbuild';
// Manifest content scripts are classic scripts, not shared-chunk ES modules.
await build({ entryPoints: ['src/extension/content.ts'], outfile: 'dist/assets/content.js', bundle: true, format: 'iife', target: 'chrome114', minify: true });

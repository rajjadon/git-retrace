// @ts-check
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

/** @type {import('esbuild').Plugin} */
const watchMarkerPlugin = {
  name: 'watch-marker',
  setup(build) {
    build.onStart(() => {
      process.stdout.write('[watch] build started\n');
    });
    build.onEnd((result) => {
      for (const { text, location } of result.errors) {
        process.stderr.write(`✘ [ERROR] ${text}\n`);
        if (location) {
          process.stderr.write(`    ${location.file}:${location.line}:${location.column}\n`);
        }
      }
      process.stdout.write('[watch] build finished\n');
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    platform: 'node',
    target: 'node20',
    external: ['vscode'],
    outfile: 'out/extension.js',
    sourcemap: !production,
    minify: production,
    logLevel: 'info',
    plugins: [watchMarkerPlugin],
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((err) => {
  process.stderr.write(`${err}\n`);
  process.exit(1);
});

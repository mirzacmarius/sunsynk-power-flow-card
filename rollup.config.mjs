import typescript from 'rollup-plugin-typescript2';
import commonjs from '@rollup/plugin-commonjs';
import { nodeResolve } from '@rollup/plugin-node-resolve';
import babel from '@rollup/plugin-babel';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';

const isWatch = process.env.ROLLUP_WATCH === 'true';

const plugins = [
  nodeResolve({
    jsnext: true,
    main: true,
  }),
  commonjs(),
  // Explicit include: picomatch 4 no longer matches rpt2's default `*.ts+(|x)` glob,
  // which made the plugin skip every TypeScript file.
  typescript({ include: ['*.ts', '**/*.ts'] }),
  json(),
  babel({
    exclude: 'node_modules/**',
    babelHelpers: 'bundled',
    compact: true,
    extensions: ['.js', '.ts'],
    presets: [
      [
        '@babel/env',
        {
          modules: false,
          targets: '> 2.5%, not dead',
        },
      ],
    ],
    plugins: [
      [
        '@babel/plugin-proposal-decorators',
        {
          legacy: true,
        },
      ],
      ['@babel/plugin-proposal-class-properties'],
      ['@babel/plugin-transform-template-literals'],
    ],
  }),
  // Only minify in non-watch (build) mode for better dev experience
  !isWatch && terser(),
].filter(Boolean);

export default {
  input: { 'sunsynk-power-flow-card-3d': './src/index.ts' },
  output: {
    // The 3D view (Three.js) is a lazily imported chunk next to the main file, so
    // classic-only dashboards never download it. Copy the whole dist/ folder.
    dir: 'dist',
    format: 'esm',
    entryFileNames: '[name].js',
    // The entry file stays a tiny facade: the card lives in a shared "core" chunk that
    // the entry and the 3D chunk both import by plain relative URL. Home Assistant adds
    // cache-busting queries (?v=, ?hacstag=) to the resource URL only, so if the 3D
    // chunk imported the entry itself the card module would be evaluated twice.
    chunkFileNames: (chunk) => {
      const names = { index: 'core', 'view-entry': 'scene' };
      return `sunsynk-power-flow-card-3d-${names[chunk.name] ?? chunk.name}-[hash].js`;
    },
    sourcemap: true,
  },
  watch: {
    clearScreen: false,
  },
  plugins: [...plugins],
  onwarn: function (warning, handler) {
    if (warning.code === 'THIS_IS_UNDEFINED') {
      return;
    }

    // console.warn everything else
    handler(warning);
  },
};

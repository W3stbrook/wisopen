import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import { resolve } from 'node:path';

const sharedAlias = {
  '@wisopen/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
};

export default defineConfig({
  main: {
    // bundle @wisopen/shared (TS source) but keep native/node deps external
    plugins: [externalizeDepsPlugin({ exclude: ['@wisopen/shared'] })],
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderers'),
    resolve: { alias: sharedAlias },
    build: {
      rollupOptions: {
        input: {
          engine: resolve(__dirname, 'src/renderers/engine/index.html'),
          overlay: resolve(__dirname, 'src/renderers/overlay/index.html'),
          settings: resolve(__dirname, 'src/renderers/settings/index.html'),
          onboarding: resolve(__dirname, 'src/renderers/onboarding/index.html'),
        },
      },
    },
  },
});

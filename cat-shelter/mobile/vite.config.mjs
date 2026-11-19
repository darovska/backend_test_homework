import { defineConfig } from 'vite';

// Build mobile/src/index.html + AdMob bridge into mobile/www for Capacitor.
// Relative paths are required for bundled assets inside iOS/Android WebViews.
export default defineConfig({
  root: 'src',
  base: './',
  build: {
    outDir: '../www',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
  },
});

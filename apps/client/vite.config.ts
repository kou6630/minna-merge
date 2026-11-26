import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages（https://kou6630.github.io/minna-merge/）でも動くように相対パスにする
  base: './',
  server: { allowedHosts: true },
  build: { outDir: 'dist', assetsInlineLimit: 0 },
});

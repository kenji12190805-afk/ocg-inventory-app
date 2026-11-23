import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * picoc-js の runC は「実行が終わった」ことを知らせてくれないので、終了コールバック(onDone)を足す。
 * 差し替え対象が見つからなければビルドを失敗させる(パッケージ更新で黙って壊れないように)。
 */
function patchPicoc(): Plugin {
  return {
    name: 'patch-picoc-js',
    enforce: 'pre',
    transform(code, id) {
      if (!/picoc-js[\\/]dist[\\/]bundle\.js/.test(id)) return null;
      const a = 'function runC(cprog, consoleWrite=null) {';
      const b = 'pc.runc(cprog, consoleWrite);';
      if (!code.includes(a) || !code.includes(b)) {
        this.error('picoc-js の構造が想定と違います。vite.config.ts の patchPicoc を見直してください。');
      }
      return code
        .replace(a, 'function runC(cprog, consoleWrite=null, onDone=null) {')
        .replace(
          b,
          'let __err = null; try { pc.runc(cprog, consoleWrite); } catch (e) { __err = e; } if (typeof onDone === "function") onDone(__err);',
        );
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [
    patchPicoc(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'コード辞典 — Python / JS / C / Kotlin',
        short_name: 'コード辞典',
        description: 'やりたいことから例文を探して、スマホの中で動かして、エラーも見られるプログラミング辞典。',
        lang: 'ja',
        theme_color: '#1d4ed8',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Pyodide(約12MB)も含めて全部をキャッシュして、圏外でも動くようにする
        globPatterns: ['**/*.{js,mjs,css,html,svg,png,wasm,zip,json,webmanifest}'],
        maximumFileSizeToCacheInBytes: 30 * 1024 * 1024,
        navigateFallback: 'index.html',
      },
    }),
  ],
  worker: { format: 'es', plugins: () => [patchPicoc()] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
});

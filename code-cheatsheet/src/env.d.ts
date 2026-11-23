/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

declare module 'picoc-js' {
  // vite.config.ts の patchPicoc で第3引数(終了コールバック)を足している
  export function runC(code: string, onLine?: ((line: string) => void) | null, onDone?: ((err: unknown) => void) | null): void;
}

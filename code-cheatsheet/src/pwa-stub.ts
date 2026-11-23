// Android アプリ(mode=native)用: Service Worker は使わないので、何もしない代わりの部品
export function registerSW(_options?: unknown): () => Promise<void> {
  return async () => {};
}

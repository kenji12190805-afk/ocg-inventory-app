// 画面づくりの共通部品
type Child = Node | string | null | false | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v === false || v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') (el as any)[k] = v;
    else if (k === 'class') el.className = v;
    else if (k === 'value' || k === 'disabled' || k === 'checked') (el as any)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== false && c !== undefined) el.append(c);
  return el;
}

let disposers: (() => void)[] = [];
/** 画面を作り直すときに片づけてほしい処理を登録する */
export const onDispose = (fn: () => void) => void disposers.push(fn);
export const disposeAll = () => {
  disposers.forEach((f) => f());
  disposers = [];
};

export function toast(msg: string) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), 2400);
}

export const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* 保存できなくても動く */
    }
  },
};

export const isOnline = () => navigator.onLine;

export function netBadge(): HTMLElement {
  const el = h('span', { class: `net${navigator.onLine ? '' : ' off'}`, role: 'status' }, navigator.onLine ? 'オンライン' : 'オフライン');
  const update = () => {
    el.textContent = navigator.onLine ? 'オンライン' : 'オフライン';
    el.classList.toggle('off', !navigator.onLine);
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  onDispose(() => {
    window.removeEventListener('online', update);
    window.removeEventListener('offline', update);
  });
  return el;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // 古い環境向け: 一時的な入力欄を使ってコピーする
    try {
      const ta = h('textarea', { 'aria-hidden': 'true', style: 'position:fixed;opacity:0;top:0;left:0' }, text);
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

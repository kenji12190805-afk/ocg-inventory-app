// console.log の値の見せ方(ブラウザのWorkerと記録スクリプトで同じ表示にするため共通化)
export function fmt(v, nested = false) {
  if (typeof v === 'string') return nested ? `'${v}'` : v;
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'function') return `[Function: ${v.name || 'anonymous'}]`;
  if (typeof v === 'bigint') return `${v}n`;
  if (typeof v === 'symbol') return v.toString();
  if (Array.isArray(v)) return `[${v.map((x) => fmt(x, true)).join(', ')}]`;
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (v instanceof Map) return `Map(${v.size}) {${[...v].map(([k, x]) => `${fmt(k, true)} => ${fmt(x, true)}`).join(', ')}}`;
  if (v instanceof Set) return `Set(${v.size}) {${[...v].map((x) => fmt(x, true)).join(', ')}}`;
  if (typeof v === 'object') {
    const entries = Object.entries(v).map(([k, x]) => `${k}: ${fmt(x, true)}`);
    return entries.length ? `{ ${entries.join(', ')} }` : '{}';
  }
  return String(v);
}
export const fmtArgs = (args) => args.map((a) => fmt(a)).join(' ');

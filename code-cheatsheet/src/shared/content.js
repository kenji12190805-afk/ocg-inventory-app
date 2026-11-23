// content/*.txt の読み込み(アプリとスクリプトの両方から使う)
// 形式: 先頭行から "=== セクション名" で区切る。セクション: meta(JSON), <lang>, <lang>.bug, <lang>.out, <lang>.bug.out
export const LANGS = ['python', 'javascript', 'c', 'kotlin'];

/** @param {string} text */
export function parseTopic(text) {
  const sections = {};
  let name = null;
  let buf = [];
  const flush = () => {
    if (name !== null) sections[name] = buf.join('\n').replace(/^\n+|\n+$/g, '');
  };
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const m = /^=== ([\w.]+)\s*$/.exec(line);
    if (m) {
      flush();
      name = m[1];
      buf = [];
    } else {
      buf.push(line);
    }
  }
  flush();
  const meta = JSON.parse(sections.meta ?? '{}');
  const variants = {};
  for (const lang of LANGS) {
    if (sections[lang] === undefined) continue;
    variants[lang] = {
      code: sections[lang],
      bugCode: sections[`${lang}.bug`],
      out: sections[`${lang}.out`], // Kotlinのみ手書き(それ以外は recorded から)
      bugOut: sections[`${lang}.bug.out`],
      note: meta.notes?.[lang],
      why: meta.why?.[lang],
    };
  }
  return { ...meta, variants };
}

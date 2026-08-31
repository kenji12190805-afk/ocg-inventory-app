// Must stay identical to data-pipeline/scripts/lib/normalize.mjs -- the dataset's
// name_ja_normalized/desc_ja_normalized columns are built with that version, and search
// here only matches if the query is folded the same way.
export function normalizeForSearch(text: string): string {
  if (!text) return '';
  return text
    .normalize('NFKC')
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .toLowerCase();
}

// Search-key normalization shared by the pipeline (when building name_ja_normalized /
// desc_ja_normalized) and, conceptually, by the app when normalizing a user's query --
// the two must stay in sync or LIKE-based search silently stops matching.
//
// Folds: full-width -> half-width alphanumerics/punctuation (NFKC), hiragana -> katakana,
// then lowercases. This makes search forgiving of the usual Japanese input variance
// (かな/カナ, ｶﾅ/カナ, full/half-width digits in card names like "No.") without needing
// an FTS5 tokenizer.
export function normalizeForSearch(text) {
  if (!text) return "";
  return text
    .normalize("NFKC")
    .replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60))
    .toLowerCase();
}

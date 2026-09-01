// English-name matching key shared by 04-build-dataset.mjs (BabelCDB<->Yugipedia join) and
// 03b-fetch-yugipedia-cards.mjs (deciding which Yugipedia names still need their own card
// page fetched). Strips real-world quirks found by auditing unmatched prints against a
// full Yugipedia crawl:
//  - invisible Unicode formatting marks (zero-width space/non-joiner/joiner, left/right-
//    to-left marks, BOM) that MediaWiki sometimes embeds in card-name wikilinks -- present
//    on both sides in principle, so stripped symmetrically here.
//  - a trailing " (card)" Wikipedia-style disambiguation suffix Yugipedia adds to some
//    Set Card Lists entries whose card name collides with a game-mechanic/keyword page
//    (e.g. "Shining Draw (card)", "Ice Barrier (card)").
//  - angle brackets around a type-designator letter in BabelCDB's name for the "Maliss"
//    ("M∀LICE") archetype (e.g. "Maliss <P> Dormouse") -- Yugipedia's own Set Card Lists
//    entries for these consistently drop the brackets ("Maliss P Dormouse"). All 10
//    BabelCDB names containing "<"/">" are this one archetype; stripping the brackets
//    entirely (not just around single letters) recovers every one with no false matches.
// Built from numeric code points (not literal characters) so the invisible marks
// themselves are never pasted into this source file: U+200B..U+200F (zero-width
// space/non-joiner/joiner, left-to-right/right-to-left marks) and U+FEFF (BOM).
const INVISIBLE_MARK_CODEPOINTS = [0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0xfeff];
const INVISIBLE_MARKS_RE = new RegExp(`[${INVISIBLE_MARK_CODEPOINTS.map((c) => `\\u${c.toString(16).padStart(4, "0")}`).join("")}]`, "g");

export function normalizeEnglishName(name) {
  return name
    .replace(INVISIBLE_MARKS_RE, "")
    .replace(/\s*\(card\)$/i, "")
    .replace(/[<>]/g, "")
    .trim()
    .toLowerCase();
}

// Small MediaWiki-wikitext helpers shared by the Yugipedia fetch scripts.

/** Extracts every occurrence of a `{{Marker ... }}` template from wikitext, depth-counting
 *  braces so nested templates (e.g. `{{Ruby|...}}` inside a card's `ja_name`) don't
 *  truncate the block early. Returns each block's body with the outer `{{`/`}}` stripped. */
export function extractTemplateBlocks(wikitext, marker) {
  const blocks = [];
  let searchFrom = 0;
  while (true) {
    const start = wikitext.indexOf(marker, searchFrom);
    if (start === -1) break;
    let depth = 0;
    let i = start;
    let end = -1;
    while (i < wikitext.length) {
      if (wikitext.startsWith("{{", i)) {
        depth++;
        i += 2;
      } else if (wikitext.startsWith("}}", i)) {
        depth--;
        i += 2;
        if (depth === 0) {
          end = i;
          break;
        }
      } else {
        i++;
      }
    }
    if (end === -1) break;
    blocks.push(wikitext.slice(start + 2, end - 2));
    searchFrom = end;
  }
  return blocks;
}

/** Parses a template body (as returned by extractTemplateBlocks) into its `|key = value`
 *  fields. Values can span multiple lines -- a line only starts a new field if it matches
 *  `|key = ...` at the start; anything else is a continuation of the previous field. */
export function parseTemplateFields(body) {
  const lines = body.split("\n");
  const fields = {};
  let currentKey = null;
  for (const rawLine of lines) {
    const m = rawLine.match(/^\|\s*([a-zA-Z0-9_.]+)\s*=\s*(.*)$/);
    if (m) {
      currentKey = m[1];
      fields[currentKey] = m[2];
    } else if (currentKey) {
      fields[currentKey] += "\n" + rawLine;
    }
  }
  for (const k of Object.keys(fields)) fields[k] = fields[k].trim();
  return fields;
}

/** Strips `{{Ruby|漢字|かな}}` furigana templates down to just the base text (kanji),
 *  matching how BabelCDB stores plain names/text with no furigana markup. */
export function stripRubyMarkup(text) {
  return text.replace(/\{\{Ruby\|([^|}]*)\|[^}]*\}\}/g, "$1");
}

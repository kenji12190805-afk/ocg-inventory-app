// Maps Yugipedia's `{{CardTable2}}` field vocabulary (English words in `attribute`,
// `types`, `property`) to the same OcgType/OcgRace/OcgAttribute bit values used throughout
// this pipeline and the app (app/src/gameConstants.ts, mirroring ocgcore-wasm). Used only
// for cards missing from BabelCDB -- see 03b-fetch-yugipedia-cards.mjs.

export const OcgType = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
  NORMAL: 0x10,
  EFFECT: 0x20,
  FUSION: 0x40,
  RITUAL: 0x80,
  SPIRIT: 0x200,
  UNION: 0x400,
  GEMINI: 0x800,
  TUNER: 0x1000,
  SYNCHRO: 0x2000,
  TOKEN: 0x4000,
  QUICKPLAY: 0x10000,
  CONTINUOUS: 0x20000,
  EQUIP: 0x40000,
  FIELD: 0x80000,
  COUNTER: 0x100000,
  FLIP: 0x200000,
  TOON: 0x400000,
  XYZ: 0x800000,
  PENDULUM: 0x1000000,
  SPSUMMON: 0x2000000,
  LINK: 0x4000000,
};

export const ATTRIBUTE_BY_NAME = {
  EARTH: 0x01,
  WATER: 0x02,
  FIRE: 0x04,
  WIND: 0x08,
  LIGHT: 0x10,
  DARK: 0x20,
  DIVINE: 0x40,
};

// English name -> OcgRace bit, limited to the 24 real OCG species (mirrors
// app/src/gameConstants.ts' RACES list).
export const RACE_BY_NAME = {
  Warrior: 1,
  Spellcaster: 2,
  Fairy: 4,
  Fiend: 8,
  Zombie: 16,
  Machine: 32,
  Aqua: 64,
  Pyro: 128,
  Rock: 256,
  "Winged Beast": 512,
  Plant: 1024,
  Insect: 2048,
  Thunder: 4096,
  Dragon: 8192,
  Beast: 16384,
  "Beast-Warrior": 32768,
  Dinosaur: 65536,
  Fish: 131072,
  "Sea Serpent": 262144,
  Reptile: 524288,
  Psychic: 1048576,
  Wyrm: 8388608,
  Cyberse: 16777216,
  Illusion: 33554432,
};

// `types` tokens (split on " / ") that mark a monster subtype/ability rather than its
// race -- each maps to an OcgType bit ORed onto MONSTER|EFFECT-or-NORMAL. Anything not a
// recognized race and not in this table is logged and ignored (see 03b).
export const MONSTER_TYPE_TOKEN_BITS = {
  Normal: OcgType.NORMAL,
  Effect: OcgType.EFFECT,
  Fusion: OcgType.FUSION,
  Ritual: OcgType.RITUAL,
  Synchro: OcgType.SYNCHRO,
  Xyz: OcgType.XYZ,
  Link: OcgType.LINK,
  Pendulum: OcgType.PENDULUM,
  Tuner: OcgType.TUNER,
  Flip: OcgType.FLIP,
  Toon: OcgType.TOON,
  Spirit: OcgType.SPIRIT,
  Union: OcgType.UNION,
  Gemini: OcgType.GEMINI,
  "Special Summon": OcgType.SPSUMMON,
};

// Spell/trap `property` field -> the same subtype bits app/src/gameConstants.ts'
// SPELL_TYPES/TRAP_TYPES use. "Normal" has no bit of its own (see that file).
export const SPELL_PROPERTY_BITS = {
  "Quick-Play": OcgType.QUICKPLAY,
  Ritual: OcgType.RITUAL,
  Continuous: OcgType.CONTINUOUS,
  Equip: OcgType.EQUIP,
  Field: OcgType.FIELD,
};

export const TRAP_PROPERTY_BITS = {
  Continuous: OcgType.CONTINUOUS,
  Counter: OcgType.COUNTER,
};

// link_arrows values (comma-separated on the page, e.g. "Bottom-Left, Bottom, Top-Right")
// -> the OcgLinkMarker bit layout ocgcore-wasm/BabelCDB pack into a Link monster's `def`
// column. Not currently rendered anywhere in the app (no link-arrow UI yet), so mismatches
// here have no visible effect today -- kept best-effort/for forward compatibility.
export const LINK_ARROW_BITS = {
  "Bottom-Left": 0x1,
  Bottom: 0x2,
  "Bottom-Right": 0x4,
  Left: 0x8,
  Right: 0x20,
  "Top-Left": 0x40,
  Top: 0x80,
  "Top-Right": 0x100,
  // Yugipedia's own labels for the same eight positions (Firewall Dragon uses these).
  "Middle-Left": 0x8,
  "Top-Center": 0x80,
  "Middle-Right": 0x20,
  "Bottom-Center": 0x2,
};

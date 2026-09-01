// Bit constants copied from ocgcore-wasm's index.d.ts (OcgAttribute / OcgRace / OcgType),
// the same values BabelCDB's datas.attribute/race/type columns use. Kept as plain numbers/
// bigints here rather than depending on ocgcore-wasm (a native/wasm duel-engine package,
// unnecessary weight for this app) since only the bit values and JA labels are needed for
// search filtering -- see data-pipeline/SCHEMA.md.

export const ATTRIBUTES: { value: number; labelJa: string }[] = [
  { value: 0x01, labelJa: '地' },
  { value: 0x02, labelJa: '水' },
  { value: 0x04, labelJa: '炎' },
  { value: 0x08, labelJa: '風' },
  { value: 0x10, labelJa: '光' },
  { value: 0x20, labelJa: '闇' },
  { value: 0x40, labelJa: '神' },
];

// Values fit safely in a JS number (max bit is 2^31); stored as plain INTEGER in the
// dataset (data-pipeline/scripts/04-build-dataset.mjs does Number(row.race)), not bigint.
// Limited to the 24 real OCG monster species (dropping anime/Rush-Duel-only or defunct
// bit values like 神族/創造神族/機皇族/魔導騎士族/幻神獣族/オメガサイキック族/天星族/銀河族
// that used to be listed here but never appear on an actual OCG card).
export const RACES: { value: number; labelJa: string }[] = [
  { value: 8, labelJa: '悪魔族' },
  { value: 16, labelJa: 'アンデット族' },
  { value: 4096, labelJa: '雷族' },
  { value: 262144, labelJa: '海竜族' },
  { value: 256, labelJa: '岩石族' },
  { value: 32, labelJa: '機械族' },
  { value: 65536, labelJa: '恐竜族' },
  { value: 16384, labelJa: '獣族' },
  { value: 33554432, labelJa: '幻想魔族' },
  { value: 8388608, labelJa: '幻竜族' },
  { value: 2048, labelJa: '昆虫族' },
  { value: 1048576, labelJa: 'サイキック族' },
  { value: 16777216, labelJa: 'サイバース族' },
  { value: 131072, labelJa: '魚族' },
  { value: 32768, labelJa: '獣戦士族' },
  { value: 1024, labelJa: '植物族' },
  { value: 1, labelJa: '戦士族' },
  { value: 512, labelJa: '鳥獣族' },
  { value: 4, labelJa: '天使族' },
  { value: 8192, labelJa: 'ドラゴン族' },
  { value: 524288, labelJa: '爬虫類族' },
  { value: 128, labelJa: '炎族' },
  { value: 2, labelJa: '魔法使い族' },
  { value: 64, labelJa: '水族' },
];

export const OcgType = {
  MONSTER: 0x1,
  SPELL: 0x2,
  TRAP: 0x4,
  NORMAL: 0x10,
  EFFECT: 0x20,
  FUSION: 0x40,
  RITUAL: 0x80,
  TRAPMONSTER: 0x100,
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
} as const;

// Supertype filter chips shown in the search screen (feature #3: 属性・種別・種類で検索).
export const SUPERTYPES: { value: number; labelJa: string }[] = [
  { value: OcgType.MONSTER, labelJa: 'モンスター' },
  { value: OcgType.SPELL, labelJa: '魔法' },
  { value: OcgType.TRAP, labelJa: '罠' },
];

// Spell/trap subtype is encoded as extra bits on card_type itself (not the race column,
// which BabelCDB leaves at 0 for non-monster cards). Value 0 is a sentinel meaning "none
// of the other bits are set" (= 通常魔法/通常罠), since normal spells/traps have no bit
// of their own -- see searchCards' spellSubtype/trapSubtype handling in datasetRepo.ts.
export const SPELL_TYPES: { value: number; labelJa: string }[] = [
  { value: 0, labelJa: '通常魔法' },
  { value: OcgType.QUICKPLAY, labelJa: '速攻魔法' },
  { value: OcgType.RITUAL, labelJa: '儀式魔法' },
  { value: OcgType.CONTINUOUS, labelJa: '永続魔法' },
  { value: OcgType.EQUIP, labelJa: '装備魔法' },
  { value: OcgType.FIELD, labelJa: 'フィールド魔法' },
];

export const TRAP_TYPES: { value: number; labelJa: string }[] = [
  { value: 0, labelJa: '通常罠' },
  { value: OcgType.CONTINUOUS, labelJa: '永続罠' },
  { value: OcgType.COUNTER, labelJa: 'カウンター罠' },
];

// All non-sentinel bits above, per card kind -- used to detect "none set" (通常魔法/通常罠).
export const SPELL_SUBTYPE_BITS = OcgType.QUICKPLAY | OcgType.RITUAL | OcgType.CONTINUOUS | OcgType.EQUIP | OcgType.FIELD;
export const TRAP_SUBTYPE_BITS = OcgType.CONTINUOUS | OcgType.COUNTER;

export function cardTypeLabel(cardType: number): string {
  if (cardType & OcgType.SPELL) return '魔法';
  if (cardType & OcgType.TRAP) return '罠';
  const kinds: string[] = [];
  if (cardType & OcgType.XYZ) kinds.push('エクシーズ');
  else if (cardType & OcgType.SYNCHRO) kinds.push('シンクロ');
  else if (cardType & OcgType.FUSION) kinds.push('融合');
  else if (cardType & OcgType.LINK) kinds.push('リンク');
  else if (cardType & OcgType.RITUAL) kinds.push('儀式');
  if (cardType & OcgType.PENDULUM) kinds.push('ペンデュラム');
  if (cardType & OcgType.EFFECT) kinds.push('効果');
  else if (cardType & OcgType.NORMAL) kinds.push('通常');
  return kinds.length ? `${kinds.join('/')}モンスター` : 'モンスター';
}

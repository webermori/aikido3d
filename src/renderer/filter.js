// Pure clip-filter helpers (no DOM) so they can be unit-tested in Node.

const ALIASES = { dori: 'tori', dore: 'tori' }; // common romanisations of 取り

/** Lower-cases, strips accents, spaces and hyphens: "Shomen-Uchi" -> "shomenuchi". */
export const normalize = (s) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[\s\-–—_']/g, '');

const aliased = (s) => Object.entries(ALIASES).reduce((t, [a, b]) => t.replaceAll(a, b), s);

/** Every whitespace-separated word of `query` must appear in the clip's normalised searchable text. */
export function matchesQuery(clip, query) {
  const words = (query ?? '').split(/\s+/).map((w) => aliased(normalize(w))).filter(Boolean);
  if (!words.length) return true;
  const hay = aliased(normalize([clip.id, clip.title, clip.category, clip.attack, clip.technique].join(' ')));
  return words.every((w) => hay.includes(w));
}

/** Filter key for an attack; knife variants collapse into one "Tantotori" group. */
export const attackKey = (attack) => (/^tantotori/i.test(normalize(attack)) ? 'tantotori' : normalize(attack));

/** `selected`: Map<field, Set<key>>. OR within a field, AND across fields; empty sets are ignored. */
export const matchesChips = (clip, selected) => [...selected].every(([field, keys]) => !keys.size || keys.has(clip[field]));

// Typical Aikikai-style syllabus progression (basic -> advanced); dojos vary, so keys not listed sort last.
const LEARNING_ORDER = {
  categoryKey: ['tachiwaza', 'suwariwaza', 'hanmihandachiwaza', 'hanmihandachiushirowaza'],
  attackKey: ['katatetori', 'ryotetori', 'katatori', 'katatorimenuchi', 'shomenuchi', 'yokomenuchi', 'tsuki', 'morotetori',
    'ushiroryokatatori', 'ushirotekubitori', 'ushirokubishime', 'tantotori'],
  techniqueKey: ['ikkyo', 'nikkyo', 'sankyo', 'yonkyo', 'gokyo', 'kotegaeshi', 'shihonage', 'iriminage', 'kaitennage', 'tenchinage',
    'kokyunage', 'kokyuho', 'koshinage', 'jujinage', 'sumiotoshi', 'udekimenage'],
  position: ['Omote', 'Ura'],
};

/** Sort comparator for [key, label] chip options of `field`: syllabus order first, then alphabetical. */
export const byLearningOrder = (field) => {
  const rank = (k) => { const i = LEARNING_ORDER[field]?.indexOf(k) ?? -1; return i < 0 ? Infinity : i; };
  return ([ka, la], [kb, lb]) => (rank(ka) === rank(kb) ? la.localeCompare(lb) : rank(ka) - rank(kb));
};

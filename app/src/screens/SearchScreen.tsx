import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useDb } from '../DbContext';
import { searchCards } from '../db/datasetRepo';
import type { Card } from '../db/types';
import { ATTRIBUTES, RACES, SUPERTYPES, SPELL_TYPES, TRAP_TYPES, OcgType, cardTypeLabel } from '../gameConstants';

// Card artwork keyed by BabelCDB card id, which for real (non-alt-art) cards is the same
// as the official Konami passcode -- this CDN is keyed by passcode. Best-effort only:
// missing art (tokens, some alt arts) just fails to load and is hidden via onError.
const CARD_IMAGE_BASE = 'https://images.ygoprodeck.com/images/cards_small/';

export default function SearchScreen() {
  const { dataset } = useDb();
  const [searchParams, setSearchParams] = useSearchParams();

  // Filter state lives in the URL (not useState) so that navigating to a card and back
  // (browser/hardware back) restores the exact same search instead of resetting it.
  const text = searchParams.get('q') ?? '';
  const attributeMask = Number(searchParams.get('attr') ?? 0);
  const supertype = Number(searchParams.get('type') ?? 0);
  const race = Number(searchParams.get('race') ?? 0);
  const spellParam = searchParams.get('spell');
  const trapParam = searchParams.get('trap');
  const spellSubtype = spellParam === null ? undefined : Number(spellParam);
  const trapSubtype = trapParam === null ? undefined : Number(trapParam);

  const [results, setResults] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    searchCards(dataset, {
      text,
      attributeMask,
      raceMask: supertype === OcgType.MONSTER ? race : undefined,
      supertypeMask: supertype || undefined,
      spellSubtype: supertype === OcgType.SPELL ? spellSubtype : undefined,
      trapSubtype: supertype === OcgType.TRAP ? trapSubtype : undefined,
    })
      .then((cards) => {
        if (!cancelled) setResults(cards);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataset, text, attributeMask, supertype, race, spellSubtype, trapSubtype]);

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  }

  function toggleAttribute(value: number) {
    const nextMask = attributeMask ^ value;
    setParam('attr', nextMask ? String(nextMask) : null);
  }

  function selectSupertype(value: number) {
    const next = new URLSearchParams(searchParams);
    if (supertype === value) next.delete('type');
    else next.set('type', String(value));
    next.delete('race');
    next.delete('spell');
    next.delete('trap');
    setSearchParams(next, { replace: true });
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="search"
          placeholder="カード名・効果で検索"
          value={text}
          onChange={(e) => setParam('q', e.target.value || null)}
        />
        <Link to="/camera" className="plain" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
          📷
        </Link>
      </div>

      <div className="section-title">種類</div>
      <div className="chip-row">
        {SUPERTYPES.map((s) => (
          <div
            key={s.value}
            className={`chip${supertype === s.value ? ' selected' : ''}`}
            onClick={() => selectSupertype(s.value)}
          >
            {s.labelJa}
          </div>
        ))}
      </div>

      <div className="section-title">属性</div>
      <div className="chip-row">
        {ATTRIBUTES.map((a) => (
          <div
            key={a.value}
            className={`chip${(attributeMask & a.value) !== 0 ? ' selected' : ''}`}
            onClick={() => toggleAttribute(a.value)}
          >
            {a.labelJa}
          </div>
        ))}
      </div>

      {supertype === OcgType.MONSTER && (
        <>
          <div className="section-title">種族</div>
          <select value={race} onChange={(e) => setParam('race', Number(e.target.value) ? e.target.value : null)}>
            <option value={0}>すべて</option>
            {RACES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.labelJa}
              </option>
            ))}
          </select>
        </>
      )}

      {supertype === OcgType.SPELL && (
        <>
          <div className="section-title">魔法の種類</div>
          <select
            value={spellSubtype ?? -1}
            onChange={(e) => setParam('spell', e.target.value === '-1' ? null : e.target.value)}
          >
            <option value={-1}>すべて</option>
            {SPELL_TYPES.map((s) => (
              <option key={s.labelJa} value={s.value}>
                {s.labelJa}
              </option>
            ))}
          </select>
        </>
      )}

      {supertype === OcgType.TRAP && (
        <>
          <div className="section-title">罠の種類</div>
          <select
            value={trapSubtype ?? -1}
            onChange={(e) => setParam('trap', e.target.value === '-1' ? null : e.target.value)}
          >
            <option value={-1}>すべて</option>
            {TRAP_TYPES.map((t) => (
              <option key={t.labelJa} value={t.value}>
                {t.labelJa}
              </option>
            ))}
          </select>
        </>
      )}

      <div className="section-title">
        検索結果 {loading ? '(検索中...)' : `(${results.length}件)`}
      </div>
      {results.length === 0 && !loading && <div className="empty-state">該当するカードがありません</div>}
      {results.map((c) => (
        <Link key={c.id} to={`/card/${c.id}`} className="card-list-item">
          <img
            className="card-thumb"
            src={`${CARD_IMAGE_BASE}${c.id}.jpg`}
            alt=""
            loading="lazy"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
            }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="name">{c.name_ja}</div>
            <div className="meta">
              {cardTypeLabel(c.card_type)}
              {c.card_type & 1 ? ` / ATK ${c.atk} DEF ${c.def} / Lv${c.level}` : ''}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

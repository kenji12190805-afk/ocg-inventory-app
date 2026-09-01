import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useDb } from '../DbContext';
import { getPrintIdsForCards, searchCards } from '../db/datasetRepo';
import { getOwnedCountByCardIds } from '../db/localRepo';
import type { Card } from '../db/types';
import { ATTRIBUTES, RACES, SUPERTYPES, SPELL_TYPES, TRAP_TYPES, OcgType, cardTypeLabel } from '../gameConstants';

// Card artwork keyed by BabelCDB card id, which for real (non-alt-art) cards is the same
// as the official Konami passcode -- this CDN is keyed by passcode. Best-effort only:
// missing art (tokens, some alt arts) just fails to load and is hidden via onError.
const CARD_IMAGE_BASE = 'https://images.ygoprodeck.com/images/cards_small/';

export default function SearchScreen() {
  const { dataset, local } = useDb();
  const [searchParams, setSearchParams] = useSearchParams();

  // The text field is local state, NOT derived from searchParams like the other filters:
  // feeding a controlled <input>'s value from router state (which round-trips through the
  // History API on every keystroke) broke IME composition on Android -- certain kana
  // (e.g. "で") became impossible to type because the input's value got reset mid-
  // composition. Local state changes synchronously with onChange like a normal input, so
  // composition is never disturbed; it's synced to the URL separately (debounced) purely
  // so "1つ前に戻る" still restores it -- see the sync effect below.
  const [textInput, setTextInput] = useState(() => searchParams.get('q') ?? '');

  useEffect(() => {
    const handle = setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (textInput) next.set('q', textInput);
          else next.delete('q');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(handle);
  }, [textInput, setSearchParams]);

  // Filter state (other than text) lives in the URL (not useState) so that navigating to a
  // card and back (browser/hardware back) restores the exact same search instead of
  // resetting it.
  const attributeMask = Number(searchParams.get('attr') ?? 0);
  const supertype = Number(searchParams.get('type') ?? 0);
  const race = Number(searchParams.get('race') ?? 0);
  const spellParam = searchParams.get('spell');
  const trapParam = searchParams.get('trap');
  const spellSubtype = spellParam === null ? undefined : Number(spellParam);
  const trapSubtype = trapParam === null ? undefined : Number(trapParam);

  // Whether any filter is actually active. With none, "all cards" is ~15k rows -- querying
  // and rendering that unfiltered pile as plain (non-virtualized) DOM list items pegs the
  // WebView's main thread hard enough to drop/delay touch input, so we simply don't.
  const hasFilter = Boolean(
    textInput.trim() || attributeMask || supertype || spellSubtype !== undefined || trapSubtype !== undefined,
  );

  const [results, setResults] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);
  // How many results are actually rendered -- grows via "さらに表示" (see PAGE_SIZE below).
  // Same reasoning as hasFilter: even a single broad filter (e.g. just "モンスター") can
  // still match thousands of cards, so results are paginated client-side rather than all
  // mounted as DOM nodes at once. searchCards itself is NOT limited -- every match is
  // found and reachable, just not all rendered up front (feature request #5).
  const PAGE_SIZE = 60;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [textInput, attributeMask, supertype, race, spellSubtype, trapSubtype]);

  useEffect(() => {
    if (!hasFilter) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    searchCards(dataset, {
      text: textInput,
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
  }, [dataset, hasFilter, textInput, attributeMask, supertype, race, spellSubtype, trapSubtype]);

  const visibleResults = results.slice(0, visibleCount);

  // Owned quantity (summed across every print) for each currently-rendered card, so the
  // search list can show what's already in inventory (feature request: link search results
  // to inventory counts). Only fetched for the visible slice, not the whole result set.
  const [ownedCounts, setOwnedCounts] = useState<Map<number, number>>(new Map());

  useEffect(() => {
    let cancelled = false;
    const visibleIds = results.slice(0, visibleCount).map((c) => c.id);
    if (visibleIds.length === 0) {
      setOwnedCounts(new Map());
      return;
    }
    (async () => {
      const printIdsByCard = await getPrintIdsForCards(dataset, visibleIds);
      const owned = await getOwnedCountByCardIds(local, printIdsByCard);
      if (!cancelled) setOwnedCounts(owned);
    })();
    return () => {
      cancelled = true;
    };
  }, [dataset, local, results, visibleCount]);

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
          value={textInput}
          onChange={(e) => setTextInput(e.target.value)}
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
      {!hasFilter && (
        <div className="empty-state">カード名・効果を入力するか、種類/属性で絞り込んでください</div>
      )}
      {hasFilter && results.length === 0 && !loading && (
        <div className="empty-state">該当するカードがありません</div>
      )}
      {visibleResults.map((c) => (
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
          {ownedCounts.get(c.id) ? <div className="qty-value">×{ownedCounts.get(c.id)}</div> : null}
        </Link>
      ))}
      {results.length > visibleCount && (
        <button
          type="button"
          className="plain"
          style={{ width: '100%', marginTop: 12 }}
          onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}
        >
          さらに表示 (残り{results.length - visibleCount}件)
        </button>
      )}
    </div>
  );
}

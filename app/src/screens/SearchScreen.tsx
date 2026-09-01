import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useDb } from '../DbContext';
import {
  getPrintIdsForCards,
  searchCards,
  searchPrintsBySetCode,
  suggestSetCodes,
  type PrintSearchResult,
} from '../db/datasetRepo';
import { getInventoryForPrints, getOwnedCountByCardIds, incrementInventory } from '../db/localRepo';
import type { Card } from '../db/types';
import { ATTRIBUTES, RACES, SUPERTYPES, SPELL_TYPES, TRAP_TYPES, OcgType, cardTypeLabel } from '../gameConstants';

// Card artwork keyed by BabelCDB card id, which for real (non-alt-art) cards is the same
// as the official Konami passcode -- this CDN is keyed by passcode. Best-effort only:
// missing art (tokens, some alt arts) just fails to load and is hidden via onError.
const CARD_IMAGE_BASE = 'https://images.ygoprodeck.com/images/cards_small/';

type Mode = 'name' | 'code';

export default function SearchScreen() {
  const { dataset, local } = useDb();
  const [searchParams, setSearchParams] = useSearchParams();

  // カード検索(名前・効果) / 型番検索 のタブ切り替え。URL に持たせることで、カード詳細から
  // 戻ってきたときにも選んでいたタブが復元される(他のフィルタと同じ理由 -- 下記参照)。
  const mode: Mode = searchParams.get('m') === 'code' ? 'code' : 'name';
  function switchMode(next: Mode) {
    const nextParams = new URLSearchParams(searchParams);
    if (next === 'name') nextParams.delete('m');
    else nextParams.set('m', next);
    setSearchParams(nextParams, { replace: true });
  }

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

  // ---- 型番検索タブ ----

  const [codeInput, setCodeInput] = useState(() => searchParams.get('code') ?? '');
  const [codeSuggestions, setCodeSuggestions] = useState<string[]>([]);
  const [showCodeSuggestions, setShowCodeSuggestions] = useState(false);
  const [printResults, setPrintResults] = useState<PrintSearchResult[]>([]);
  const [printLoading, setPrintLoading] = useState(false);
  const [printInventory, setPrintInventory] = useState<Map<number, number>>(new Map());
  const [justRegisteredPrintId, setJustRegisteredPrintId] = useState<number | null>(null);

  // Keep the URL in sync (debounced) purely so "1つ前に戻る" restores the typed code --
  // same reasoning as textInput above.
  useEffect(() => {
    if (mode !== 'code') return;
    const handle = setTimeout(() => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (codeInput) next.set('code', codeInput);
          else next.delete('code');
          return next;
        },
        { replace: true },
      );
    }, 300);
    return () => clearTimeout(handle);
  }, [codeInput, mode, setSearchParams]);

  useEffect(() => {
    if (mode !== 'code' || !codeInput.trim()) {
      setCodeSuggestions([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(() => {
      suggestSetCodes(dataset, codeInput.trim()).then((suggestions) => {
        if (!cancelled) setCodeSuggestions(suggestions);
      });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [dataset, mode, codeInput]);

  useEffect(() => {
    if (mode !== 'code' || codeInput.trim().length < 2) {
      setPrintResults([]);
      return;
    }
    let cancelled = false;
    setPrintLoading(true);
    const handle = setTimeout(() => {
      searchPrintsBySetCode(dataset, codeInput.trim())
        .then((results) => {
          if (!cancelled) setPrintResults(results);
        })
        .finally(() => {
          if (!cancelled) setPrintLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [dataset, mode, codeInput]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const inv = await getInventoryForPrints(local, printResults.map((r) => r.print.id));
      if (cancelled) return;
      setPrintInventory(new Map([...inv].map(([printId, row]) => [printId, row.quantity])));
    })();
    return () => {
      cancelled = true;
    };
  }, [local, printResults]);

  async function registerByCode(printId: number) {
    await incrementInventory(local, printId, 1);
    setPrintInventory((prev) => new Map(prev).set(printId, (prev.get(printId) ?? 0) + 1));
    setJustRegisteredPrintId(printId);
    setTimeout(() => setJustRegisteredPrintId((id) => (id === printId ? null : id)), 1200);
  }

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
      <div className="chip-row">
        <div className={`chip${mode === 'name' ? ' selected' : ''}`} onClick={() => switchMode('name')}>
          カード検索
        </div>
        <div className={`chip${mode === 'code' ? ' selected' : ''}`} onClick={() => switchMode('code')}>
          型番検索
        </div>
      </div>

      {mode === 'name' && (
        <>
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
        </>
      )}

      {mode === 'code' && (
        <>
          <div style={{ position: 'relative' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="search"
                placeholder="型番で検索 (例: SUB1-JP001)"
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                onFocus={() => setShowCodeSuggestions(true)}
                onBlur={() => setTimeout(() => setShowCodeSuggestions(false), 150)}
                style={{ textTransform: 'uppercase' }}
              />
              <Link to="/camera" className="plain" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', textDecoration: 'none' }}>
                📷
              </Link>
            </div>
            {showCodeSuggestions && codeSuggestions.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 48,
                  zIndex: 10,
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: 10,
                  marginTop: 4,
                  maxHeight: 200,
                  overflowY: 'auto',
                }}
              >
                {codeSuggestions.map((code) => (
                  <div
                    key={code}
                    style={{ padding: '8px 12px', fontSize: 14, cursor: 'pointer' }}
                    onMouseDown={() => {
                      setCodeInput(code);
                      setShowCodeSuggestions(false);
                    }}
                  >
                    {code}
                  </div>
                ))}
              </div>
            )}
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            カード左下(または右下)に印字されている型番を入力すると、収録弾・レアリティまで特定して直接+1登録できます。
          </p>

          <div className="section-title">
            検索結果 {printLoading ? '(検索中...)' : `(${printResults.length}件)`}
          </div>
          {codeInput.trim().length < 2 && (
            <div className="empty-state">型番を2文字以上入力してください</div>
          )}
          {codeInput.trim().length >= 2 && printResults.length === 0 && !printLoading && (
            <div className="empty-state">該当する型番が見つかりません</div>
          )}
          {printResults.map(({ print, card }) => {
            const owned = printInventory.get(print.id) ?? 0;
            return (
              <div key={print.id} className="print-row">
                <Link to={`/card/${card.id}`} className="info" style={{ color: 'inherit', textDecoration: 'none' }}>
                  <div className="name">{card.name_ja}</div>
                  <div className="set-code">{print.set_code}</div>
                  <div className="rarity">
                    {print.set_name} / {print.rarity}
                  </div>
                </Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {owned > 0 && <div className="qty-value">×{owned}</div>}
                  <button
                    type="button"
                    className="primary"
                    onClick={() => registerByCode(print.id)}
                  >
                    {justRegisteredPrintId === print.id ? '登録済み' : '＋1登録'}
                  </button>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

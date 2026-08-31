import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDb } from '../DbContext';
import { searchCards } from '../db/datasetRepo';
import type { Card } from '../db/types';
import { ATTRIBUTES, RACES, SUPERTYPES, cardTypeLabel } from '../gameConstants';

export default function SearchScreen() {
  const { dataset } = useDb();
  const [text, setText] = useState('');
  const [attributes, setAttributes] = useState<Set<number>>(new Set());
  const [race, setRace] = useState<number>(0);
  const [supertypes, setSupertypes] = useState<Set<number>>(new Set());
  const [results, setResults] = useState<Card[]>([]);
  const [loading, setLoading] = useState(false);

  const attributeMask = useMemo(() => [...attributes].reduce((a, b) => a | b, 0), [attributes]);
  const supertypeMask = useMemo(() => [...supertypes].reduce((a, b) => a | b, 0), [supertypes]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    searchCards(dataset, { text, attributeMask, raceMask: race, supertypeMask })
      .then((cards) => {
        if (!cancelled) setResults(cards);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [dataset, text, attributeMask, race, supertypeMask]);

  function toggle(set: Set<number>, setSet: (s: Set<number>) => void, value: number) {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setSet(next);
  }

  return (
    <div>
      <input
        type="search"
        placeholder="カード名・効果で検索"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="section-title">種類</div>
      <div className="chip-row">
        {SUPERTYPES.map((s) => (
          <div
            key={s.value}
            className={`chip${supertypes.has(s.value) ? ' selected' : ''}`}
            onClick={() => toggle(supertypes, setSupertypes, s.value)}
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
            className={`chip${attributes.has(a.value) ? ' selected' : ''}`}
            onClick={() => toggle(attributes, setAttributes, a.value)}
          >
            {a.labelJa}
          </div>
        ))}
      </div>

      <div className="section-title">種族</div>
      <select value={race} onChange={(e) => setRace(Number(e.target.value))}>
        <option value={0}>すべて</option>
        {RACES.map((r) => (
          <option key={r.value} value={r.value}>
            {r.labelJa}
          </option>
        ))}
      </select>

      <div className="section-title">
        検索結果 {loading ? '(検索中...)' : `(${results.length}件)`}
      </div>
      {results.length === 0 && !loading && <div className="empty-state">該当するカードがありません</div>}
      {results.map((c) => (
        <Link key={c.id} to={`/card/${c.id}`} className="card-list-item">
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

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useDb } from '../DbContext';
import { getCardsByIds, getPrintsForCard } from '../db/datasetRepo';
import { getDeck, getDeckCards, getOwnedCountByCardIds, setDeckCardQuantity } from '../db/localRepo';
import type { Card, Deck, DeckCard } from '../db/types';

interface Row {
  deckCard: DeckCard;
  card: Card;
  owned: number;
}

export default function DeckDetailScreen() {
  const { deckId } = useParams();
  const { dataset, local } = useDb();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const id = Number(deckId);
    setLoading(true);
    const [d, deckCards] = await Promise.all([getDeck(local, id), getDeckCards(local, id)]);
    setDeck(d);

    const cards = await getCardsByIds(dataset, deckCards.map((dc) => dc.card_id));
    const printIdsByCard = new Map<number, number[]>();
    for (const dc of deckCards) {
      const prints = await getPrintsForCard(dataset, dc.card_id);
      printIdsByCard.set(dc.card_id, prints.map((p) => p.id));
    }
    const owned = await getOwnedCountByCardIds(local, printIdsByCard);

    setRows(
      deckCards
        .map((dc) => {
          const card = cards.get(dc.card_id);
          if (!card) return null;
          return { deckCard: dc, card, owned: owned.get(dc.card_id) ?? 0 };
        })
        .filter((r): r is Row => r !== null)
        .sort((a, b) => a.card.name_ja.localeCompare(b.card.name_ja, 'ja')),
    );
    setLoading(false);
  }, [deckId, dataset, local]);

  useEffect(() => {
    reload();
  }, [reload]);

  async function changeQuantity(cardId: number, next: number) {
    await setDeckCardQuantity(local, Number(deckId), cardId, next);
    reload();
  }

  if (loading) return <div className="empty-state">読み込み中...</div>;
  if (!deck) return <div className="empty-state">デッキが見つかりません</div>;

  const totalShortage = rows.reduce((sum, r) => sum + Math.max(0, r.deckCard.quantity - r.owned), 0);

  return (
    <div>
      <Link to="/deck" className="badge" style={{ display: 'inline-block', marginBottom: 8 }}>
        ← デッキ一覧に戻る
      </Link>
      <h2 style={{ margin: '4px 0' }}>{deck.name}</h2>
      <div className="meta">
        {rows.length}種 ・ 不足{' '}
        <span style={{ color: totalShortage > 0 ? 'var(--danger)' : 'inherit', fontWeight: 700 }}>
          {totalShortage}枚
        </span>
      </div>

      <div className="section-title">カード一覧</div>
      {rows.map(({ deckCard, card, owned }) => {
        const shortage = Math.max(0, deckCard.quantity - owned);
        return (
          <div key={card.id} className="print-row">
            <div className="info">
              <Link to={`/card/${card.id}`} className="set-code" style={{ color: 'inherit', textDecoration: 'none' }}>
                {card.name_ja}
              </Link>
              <div className="rarity">
                所有 {owned}枚 / 必要 {deckCard.quantity}枚
                {shortage > 0 && <span style={{ color: 'var(--danger)', fontWeight: 700 }}> ・ 不足{shortage}枚</span>}
              </div>
            </div>
            <div className="qty-controls">
              <button className="qty-btn" onClick={() => changeQuantity(card.id, deckCard.quantity - 1)}>
                −
              </button>
              <span className="qty-value">{deckCard.quantity}</span>
              <button
                className="qty-btn"
                onClick={() => changeQuantity(card.id, deckCard.quantity + 1)}
                disabled={deckCard.quantity >= 3}
              >
                ＋
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

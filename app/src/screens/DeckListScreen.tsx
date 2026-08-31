import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useDb } from '../DbContext';
import { importDeckText, type DeckImportResult } from '../db/deckImport';
import { createDeck, deleteDeck, listDecks } from '../db/localRepo';
import type { Deck } from '../db/types';

export default function DeckListScreen() {
  const { dataset, local } = useDb();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [deckName, setDeckName] = useState('');
  const [pasteText, setPasteText] = useState('');
  const [preview, setPreview] = useState<DeckImportResult | null>(null);
  const [parsing, setParsing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function reload() {
    setDecks(await listDecks(local));
  }

  useEffect(() => {
    reload();
  }, [local]);

  async function handleParse() {
    if (!pasteText.trim()) return;
    setParsing(true);
    try {
      setPreview(await importDeckText(dataset, pasteText));
    } finally {
      setParsing(false);
    }
  }

  async function handleSave() {
    if (!preview || preview.matched.length === 0) return;
    setSaving(true);
    try {
      await createDeck(
        local,
        deckName,
        preview.matched.map((m) => ({ cardId: m.card.id, quantity: m.quantity })),
      );
      setDeckName('');
      setPasteText('');
      setPreview(null);
      await reload();
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(deck: Deck) {
    if (!confirm(`「${deck.name}」を削除しますか？`)) return;
    await deleteDeck(local, deck.id);
    reload();
  }

  return (
    <div>
      <div className="section-title">デッキを登録</div>
      <input
        type="text"
        placeholder="デッキ名(任意)"
        value={deckName}
        onChange={(e) => setDeckName(e.target.value)}
        style={{ marginBottom: 8 }}
      />
      <textarea
        placeholder={'デッキリストを貼り付け\n(例: カード名を1行ずつ。"3 カード名" や "カード名 x3" のような枚数指定にも対応)'}
        value={pasteText}
        onChange={(e) => {
          setPasteText(e.target.value);
          setPreview(null);
        }}
        rows={8}
        style={{
          width: '100%',
          padding: '10px 12px',
          borderRadius: 10,
          border: '1px solid var(--border)',
          fontSize: 14,
          fontFamily: 'inherit',
        }}
      />
      <button className="primary" style={{ marginTop: 8 }} onClick={handleParse} disabled={parsing}>
        {parsing ? '解析中...' : '解析'}
      </button>

      {preview && (
        <div style={{ marginTop: 12 }}>
          <div className="section-title">認識結果: {preview.matched.length}種</div>
          {preview.matched.map((m) => (
            <div key={m.card.id} className="list-row">
              <span>{m.card.name_ja}</span>
              <span>×{m.quantity}</span>
            </div>
          ))}
          {preview.unmatched.length > 0 && (
            <>
              <div className="section-title" style={{ color: 'var(--danger)' }}>
                認識できなかった行 ({preview.unmatched.length})
              </div>
              {preview.unmatched.map((name, i) => (
                <div key={i} className="list-row">
                  <span>{name}</span>
                </div>
              ))}
            </>
          )}
          <button className="primary" style={{ marginTop: 8 }} onClick={handleSave} disabled={saving || preview.matched.length === 0}>
            {saving ? '保存中...' : 'このデッキを保存'}
          </button>
        </div>
      )}

      <div className="section-title">登録済みデッキ ({decks.length})</div>
      {decks.length === 0 && <div className="empty-state">デッキが未登録です</div>}
      {decks.map((deck) => (
        <div key={deck.id} className="list-row">
          <Link to={`/deck/${deck.id}`} style={{ color: 'inherit', textDecoration: 'none', fontWeight: 600 }}>
            {deck.name}
          </Link>
          <button className="plain" onClick={() => handleDelete(deck)}>
            削除
          </button>
        </div>
      ))}
    </div>
  );
}

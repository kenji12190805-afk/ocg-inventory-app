import { useEffect, useState } from 'react';
import { useDb } from '../DbContext';
import { addStorageLocation, deleteStorageLocation, listStorageLocations, renameStorageLocation } from '../db/localRepo';
import type { StorageLocation } from '../db/types';

export default function StorageLocationsScreen() {
  const { local } = useDb();
  const [locations, setLocations] = useState<StorageLocation[]>([]);
  const [newName, setNewName] = useState('');

  async function reload() {
    setLocations(await listStorageLocations(local));
  }

  useEffect(() => {
    reload();
  }, [local]);

  async function handleAdd() {
    if (!newName.trim()) return;
    await addStorageLocation(local, newName);
    setNewName('');
    reload();
  }

  async function handleRename(loc: StorageLocation) {
    const next = prompt('保管場所名を編集', loc.name);
    if (next === null || !next.trim() || next === loc.name) return;
    await renameStorageLocation(local, loc.id, next);
    reload();
  }

  async function handleDelete(loc: StorageLocation) {
    if (!confirm(`「${loc.name}」を削除しますか？(この場所を使っている在庫は「未設定」になります)`)) return;
    await deleteStorageLocation(local, loc.id);
    reload();
  }

  return (
    <div>
      <div className="section-title">保管場所を追加</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          type="text"
          placeholder="例: バインダー3、デッキボックスA"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
        />
        <button className="primary" onClick={handleAdd}>
          追加
        </button>
      </div>

      <div className="section-title">保管場所一覧 ({locations.length})</div>
      {locations.length === 0 && <div className="empty-state">保管場所が未登録です</div>}
      {locations.map((loc) => (
        <div key={loc.id} className="list-row">
          <span>{loc.name}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="plain" onClick={() => handleRename(loc)}>
              編集
            </button>
            <button className="plain" onClick={() => handleDelete(loc)}>
              削除
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

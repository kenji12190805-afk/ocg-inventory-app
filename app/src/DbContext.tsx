import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SQLiteDBConnection } from '@capacitor-community/sqlite';
import { openDataset, openLocalDb } from './db/sqlite';

interface DbContextValue {
  dataset: SQLiteDBConnection;
  local: SQLiteDBConnection;
}

const DbContext = createContext<DbContextValue | null>(null);

export function useDb(): DbContextValue {
  const ctx = useContext(DbContext);
  if (!ctx) throw new Error('useDb() called outside <DbProvider>');
  return ctx;
}

export function DbProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<DbContextValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [dataset, local] = await Promise.all([openDataset(), openLocalDb()]);
        if (!cancelled) setValue({ dataset, local });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="app-main empty-state">
        カードデータの読み込みに失敗しました。
        <br />
        {error}
      </div>
    );
  }
  if (!value) {
    return <div className="app-main empty-state">カードデータを読み込み中...</div>;
  }
  return <DbContext.Provider value={value}>{children}</DbContext.Provider>;
}

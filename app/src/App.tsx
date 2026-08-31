import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { DbProvider } from './DbContext';
import SearchScreen from './screens/SearchScreen';
import CardDetailScreen from './screens/CardDetailScreen';
import InventoryListScreen from './screens/InventoryListScreen';
import StorageLocationsScreen from './screens/StorageLocationsScreen';
import SettingsScreen from './screens/SettingsScreen';

export default function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <div className="app-header">遊戯王OCG在庫</div>
        <div className="app-main">
          <DbProvider>
            <Routes>
              <Route path="/" element={<SearchScreen />} />
              <Route path="/card/:cardId" element={<CardDetailScreen />} />
              <Route path="/inventory" element={<InventoryListScreen />} />
              <Route path="/storage" element={<StorageLocationsScreen />} />
              <Route path="/settings" element={<SettingsScreen />} />
            </Routes>
          </DbProvider>
        </div>
        <nav className="bottom-nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="icon">🔍</span>検索/登録
          </NavLink>
          <NavLink to="/inventory" className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="icon">📦</span>在庫一覧
          </NavLink>
          <NavLink to="/storage" className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="icon">🗂️</span>保管場所
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="icon">⚙️</span>設定
          </NavLink>
        </nav>
      </div>
    </HashRouter>
  );
}

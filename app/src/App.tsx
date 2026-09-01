import { HashRouter, NavLink, Route, Routes } from 'react-router-dom';
import { DbProvider } from './DbContext';
import BackButtonHandler from './BackButtonHandler';
import UpdateBanner from './UpdateBanner';
import SearchScreen from './screens/SearchScreen';
import CardDetailScreen from './screens/CardDetailScreen';
import InventoryListScreen from './screens/InventoryListScreen';
import StorageLocationsScreen from './screens/StorageLocationsScreen';
import SettingsScreen from './screens/SettingsScreen';
import DeckListScreen from './screens/DeckListScreen';
import DeckDetailScreen from './screens/DeckDetailScreen';
import CameraRegisterScreen from './screens/CameraRegisterScreen';
import StatsScreen from './screens/StatsScreen';

export default function App() {
  return (
    <HashRouter>
      <BackButtonHandler />
      <div className="app-shell">
        <div className="app-header">遊戯王OCG在庫</div>
        <DbProvider>
          <UpdateBanner />
          <div className="app-main">
            <Routes>
              <Route path="/" element={<SearchScreen />} />
              <Route path="/card/:cardId" element={<CardDetailScreen />} />
              <Route path="/camera" element={<CameraRegisterScreen />} />
              <Route path="/inventory" element={<InventoryListScreen />} />
              <Route path="/deck" element={<DeckListScreen />} />
              <Route path="/deck/:deckId" element={<DeckDetailScreen />} />
              <Route path="/storage" element={<StorageLocationsScreen />} />
              <Route path="/settings" element={<SettingsScreen />} />
              <Route path="/stats" element={<StatsScreen />} />
            </Routes>
          </div>
        </DbProvider>
        <nav className="bottom-nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="icon">🔍</span>検索/登録
          </NavLink>
          <NavLink to="/inventory" className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="icon">📦</span>在庫一覧
          </NavLink>
          <NavLink to="/deck" className={({ isActive }) => (isActive ? 'active' : '')}>
            <span className="icon">🃏</span>デッキ
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

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { defineCustomElements as defineJeepSqlite } from 'jeep-sqlite/loader';
import App from './App';
import './index.css';

// Web-only: @capacitor-community/sqlite's browser implementation runs on top of a
// <jeep-sqlite> custom element (sql.js + IndexedDB storage) that must exist in the DOM
// before any SQLite call is made. No-op on native (Android), where the plugin talks to
// the OS's real SQLite directly.
defineJeepSqlite(window);
window.addEventListener('DOMContentLoaded', () => {
  if (!document.querySelector('jeep-sqlite')) {
    document.body.appendChild(document.createElement('jeep-sqlite'));
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

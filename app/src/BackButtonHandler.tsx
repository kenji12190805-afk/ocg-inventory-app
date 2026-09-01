import { useEffect } from 'react';
import { App as CapacitorApp } from '@capacitor/app';

// Capacitor 7+ no longer auto-drives the hardware back button through webview history --
// without this listener BridgeActivity's default onBackPressed() just finishes the
// activity (straight to the home screen) even when there's app history to go back to.
export default function BackButtonHandler() {
  useEffect(() => {
    const handle = CapacitorApp.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) window.history.back();
      else CapacitorApp.exitApp();
    });
    return () => {
      handle.then((h) => h.remove());
    };
  }, []);

  return null;
}

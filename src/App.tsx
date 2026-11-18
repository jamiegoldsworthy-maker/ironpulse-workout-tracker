import React, { useEffect } from 'react';
import { Layout } from './components/Layout';
import { LogView } from './components/LogView';
import { PlanView } from './components/PlanView';
import { LibraryView } from './components/LibraryView';
import { HistoryView } from './components/HistoryView';
import { SettingsView } from './components/SettingsView';
import { useWorkoutStore } from './store/useWorkoutStore';
import { initFirebaseServices, subscribeToAuthChanges } from './services/firebase';

export const App: React.FC = () => {
  const { activeTab, meta, setAuthUser } = useWorkoutStore();

  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (mode: 'light' | 'dark') => {
      if (mode === 'dark') {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
    };

    if (meta.theme === 'system') {
      const mql = window.matchMedia('(prefers-color-scheme: dark)');
      applyTheme(mql.matches ? 'dark' : 'light');
      const listener = (e: MediaQueryListEvent) => applyTheme(e.matches ? 'dark' : 'light');
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
    } else {
      applyTheme(meta.theme);
    }
  }, [meta.theme]);

  useEffect(() => {
    initFirebaseServices();
    const unsubscribe = subscribeToAuthChanges((user) => {
      if (user) {
        setAuthUser({
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
        });
      } else {
        setAuthUser(null);
      }
    });
    return () => unsubscribe();
  }, [setAuthUser]);

  return (
    <Layout>
      {activeTab === 'log' && <LogView />}
      {activeTab === 'plan' && <PlanView />}
      {activeTab === 'library' && <LibraryView />}
      {activeTab === 'history' && <HistoryView />}
      {activeTab === 'settings' && <SettingsView />}
    </Layout>
  );
};

export default App;

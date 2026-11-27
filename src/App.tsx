import React, { useEffect, useRef } from 'react';
import { Layout } from './components/Layout';
import { LogView } from './components/LogView';
import { PlanView } from './components/PlanView';
import { LibraryView } from './components/LibraryView';
import { HistoryView } from './components/HistoryView';
import { SettingsView } from './components/SettingsView';
import { useWorkoutStore } from './store/useWorkoutStore';
import {
  ACCESS_DENIED_MESSAGE,
  initFirebaseServices,
  isAllowedUserEmail,
  signOutFirebase,
  subscribeToAuthChanges,
} from './services/firebase';
import { getCachedGoogleTasksToken } from './lib/googleTasks';

export const App: React.FC = () => {
  const {
    activeTab,
    meta,
    authUser,
    hasCompletedCloudBootstrap,
    setAuthUser,
    startRealtimeSync,
    checkCompletedTasksInbound,
  } = useWorkoutStore();
  const hasCheckedTasksInboundRef = useRef(false);

  useEffect(() => {
    const root = document.documentElement;
    const applyTheme = (mode: 'light' | 'dark') => {
      root.dataset.theme = mode;
      if (mode === 'dark') {
        root.classList.add('dark');
      } else {
        root.classList.remove('dark');
      }
      const themeMeta = document.querySelector('meta[name="theme-color"]');
      if (themeMeta) {
        themeMeta.setAttribute('content', mode === 'dark' ? '#16181A' : '#F3EDE6');
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
    if (activeTab !== 'log' || meta.keepScreenAwake === false) return;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let wakeLock: any = null;
    const requestWake = async () => {
      try {
        if (document.visibilityState === 'visible') {
          wakeLock = await (navigator as any).wakeLock.request('screen');
        }
      } catch {
        // Ignore wake lock permission/battery-saver restrictions
      }
    };
    requestWake();

    const onVisChange = () => {
      if (document.visibilityState === 'visible') {
        requestWake();
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisChange);
      if (wakeLock) {
        wakeLock.release().catch(() => {});
      }
    };
  }, [activeTab, meta.keepScreenAwake]);

  useEffect(() => {
    initFirebaseServices();
    const unsubscribe = subscribeToAuthChanges(
      (user) => {
        if (user) {
          if (!isAllowedUserEmail(user.email)) {
            void signOutFirebase();
            setAuthUser(null);
            useWorkoutStore.setState({ lastSyncError: ACCESS_DENIED_MESSAGE });
            return;
          }
          setAuthUser({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL,
          });
        } else {
          setAuthUser(null);
        }
      },
      (deniedMessage) => {
        setAuthUser(null);
        useWorkoutStore.setState({ lastSyncError: deniedMessage });
      }
    );
    return () => unsubscribe();
  }, [setAuthUser]);

  useEffect(() => {
    if (!authUser?.uid) return;
    const stopRealtime = startRealtimeSync(authUser.uid);
    return () => stopRealtime();
  }, [authUser?.uid, startRealtimeSync]);

  useEffect(() => {
    if (!authUser?.uid || !hasCompletedCloudBootstrap) return;
    if (hasCheckedTasksInboundRef.current) return;
    hasCheckedTasksInboundRef.current = true;
    if (getCachedGoogleTasksToken()) {
      void checkCompletedTasksInbound();
    }
  }, [authUser?.uid, hasCompletedCloudBootstrap, checkCompletedTasksInbound]);

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

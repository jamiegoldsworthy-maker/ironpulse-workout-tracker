import React, { useEffect, useRef, useState } from 'react';
import {
  Dumbbell,
  Calendar,
  BookOpen,
  BarChart3,
  Settings,
  Sun,
  Moon,
  Monitor,
  Cloud,
  Smartphone,
  Laptop,
  AlertTriangle,
  X,
  Minimize2,
  Maximize2,
  LayoutList,
  GalleryHorizontalEnd,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { LiveTimerBar } from './LiveTimerBar';

interface LayoutProps {
  children: React.ReactNode;
}

const NAV_ITEMS: Array<{
  id: 'log' | 'plan' | 'library' | 'history' | 'settings';
  label: string;
  tooltip: string;
  icon: any;
}> = [
  { id: 'log', label: 'Log', tooltip: 'Log workouts on the gym floor', icon: Dumbbell },
  { id: 'plan', label: 'Plan', tooltip: 'Calendar schedule & programming', icon: Calendar },
  { id: 'library', label: 'Library', tooltip: 'Browse & edit workout presets', icon: BookOpen },
  { id: 'history', label: 'History', tooltip: 'Progress charts & past sessions', icon: BarChart3 },
  { id: 'settings', label: 'Settings', tooltip: 'Imports, AI sync & app settings', icon: Settings },
];

export const Layout: React.FC<LayoutProps> = ({ children }) => {
  const {
    activeTab,
    setActiveTab,
    viewportMode,
    setViewportMode,
    logLayoutMode,
    setLogLayoutMode,
    logDensityMode,
    setLogDensityMode,
    meta,
    setTheme,
    setDefaultAutoStartRestTimer,
    setKeepScreenAwake,
    setTimerSoundEnabled,
    authUser,
    syncStatus,
    lastSyncError,
    clearSyncError,
    syncWithFirestore,
    timer,
    pendingTaskCompletions,
    dismissPendingTaskCompletion,
    openPendingTaskInLog,
    quickCompletePendingTask,
  } = useWorkoutStore();

  const [cogOpen, setCogOpen] = useState(false);
  const cogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!cogOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (cogRef.current && !cogRef.current.contains(e.target as Node)) {
        setCogOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setCogOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [cogOpen]);

  const isForcedMobile = viewportMode === 'mobile';
  const isForcedDesktop = viewportMode === 'desktop';

  const showSidebarClass = isForcedMobile
    ? 'hidden'
    : isForcedDesktop
    ? 'flex w-60 flex-col fixed inset-y-0'
    : 'hidden md:flex md:w-60 md:flex-col md:fixed md:inset-y-0';

  const mainOffsetClass = isForcedMobile
    ? ''
    : isForcedDesktop
    ? 'pl-60'
    : 'md:pl-60';

  const bottomNavClass = isForcedMobile
    ? 'flex'
    : isForcedDesktop
    ? 'hidden'
    : 'flex md:hidden';

  return (
    <div
      className={`min-h-screen w-full max-w-full overflow-x-hidden transition-all ${
        isForcedMobile
          ? 'bg-slate-900/95 py-3 px-2 flex flex-col items-center justify-start'
          : 'bg-slate-50 dark:bg-slate-950'
      } text-slate-900 dark:text-slate-100`}
    >
      {/* Top Preview Switcher Pill when in Forced Mobile Mode so the phone header stays spacious */}
      {isForcedMobile && (
        <div className="mb-2.5 flex items-center gap-2 bg-slate-800/90 text-slate-200 px-3 py-1.5 rounded-full border border-slate-700 text-xs shadow-lg">
          <span className="text-[11px] font-semibold text-slate-400">Preview Mode:</span>
          <button
            type="button"
            onClick={() => setViewportMode('mobile')}
            className="px-2.5 py-0.5 rounded-full bg-orange-500 text-white font-bold text-[11px] flex items-center gap-1"
          >
            <Smartphone className="w-3 h-3" /> Mobile (430px)
          </button>
          <button
            type="button"
            onClick={() => setViewportMode('desktop')}
            className="px-2.5 py-0.5 rounded-full hover:bg-slate-700 text-slate-300 font-semibold text-[11px] flex items-center gap-1"
          >
            <Laptop className="w-3 h-3" /> Switch to Desktop
          </button>
        </div>
      )}

      <div
        className={
          isForcedMobile
            ? 'force-mobile-view w-full max-w-[430px] min-h-[844px] max-h-[88vh] bg-slate-50 dark:bg-slate-950 rounded-[36px] border-[6px] border-slate-800 shadow-2xl overflow-y-auto overflow-x-hidden relative flex flex-col'
            : 'w-full min-h-screen flex flex-col md:flex-row'
        }
      >
        {/* Left Sidebar (Desktop or Forced Desktop) */}
        <aside
          className={`${showSidebarClass} bg-white dark:bg-slate-900 border-r border-slate-200/80 dark:border-slate-800 px-4 py-6 z-40`}
        >
          <div className="space-y-6">
            {/* Brand Logo */}
            <div className="flex items-center gap-3 px-2">
              <div className="w-10 h-10 rounded-2xl bg-orange-500 text-white flex items-center justify-center shadow-md shadow-orange-500/25">
                <Dumbbell className="w-5 h-5" />
              </div>
              <div>
                <h1 className="font-display font-extrabold text-lg tracking-tight leading-none">
                  Iron<span className="text-orange-500">Pulse</span>
                </h1>
                <span className="text-[11px] font-medium text-slate-400">
                  Workout Tracker
                </span>
              </div>
            </div>

            {/* Sidebar Navigation Links */}
            <nav className="space-y-1.5">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const isActive = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    title={item.tooltip}
                    onClick={() => setActiveTab(item.id)}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-bold transition-all ${
                      isActive
                        ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        {/* Main Content Column */}
        <div className={`flex-1 ${mainOffsetClass} flex flex-col min-w-0`}>
          {/* Top App Header Bar */}
          <header className="sticky top-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-b border-slate-200/70 dark:border-slate-800 px-3.5 py-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className={`w-8 h-8 rounded-xl bg-orange-500 text-white flex items-center justify-center shadow-xs shrink-0 ${
                  isForcedMobile ? 'flex' : isForcedDesktop ? 'hidden' : 'flex md:hidden'
                }`}
              >
                <Dumbbell className="w-4 h-4" />
              </div>
              <h1 className="font-display font-extrabold text-sm sm:text-base truncate">
                {activeTab === 'log'
                  ? 'Workout Log'
                  : activeTab === 'plan'
                  ? 'Training Calendar'
                  : activeTab === 'library'
                  ? 'Workout Library'
                  : activeTab === 'history'
                  ? 'Progress & History'
                  : 'Settings & Sync'}
              </h1>
            </div>

            {/* Right Controls: Single Minimal Cog Popover */}
            <div ref={cogRef} className="relative flex items-center shrink-0">
              <button
                type="button"
                onClick={() => setCogOpen((prev) => !prev)}
                aria-label="View, Theme & Sync Controls"
                aria-expanded={cogOpen}
                data-tooltip="View, Theme & Sync"
                data-tooltip-pos="bottom"
                title="View, Theme & Sync Controls"
                className={`relative p-2 rounded-xl border transition-colors ${
                  cogOpen
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:text-orange-500 border-slate-200/60 dark:border-slate-700/60'
                }`}
              >
                <Settings
                  className={`w-4 h-4 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`}
                />
                {(syncStatus === 'error' || !authUser) && !cogOpen && (
                  <span
                    className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ring-2 ring-white dark:ring-slate-900 ${
                      syncStatus === 'error' ? 'bg-rose-500' : 'bg-amber-400'
                    }`}
                  />
                )}
              </button>

              {cogOpen && (
                <div className="fixed right-3 top-14 sm:absolute sm:right-0 sm:top-full sm:mt-2 w-72 max-w-[calc(100vw-1.5rem)] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xl p-3.5 space-y-3 z-50">
                  {/* 1. Density */}
                  <div className="space-y-1.5">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Density
                    </span>
                    <div className="grid grid-cols-2 rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200/60 dark:border-slate-700/60">
                      <button
                        type="button"
                        onClick={() => setLogDensityMode('compact')}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center justify-center gap-1.5 transition-all ${
                          logDensityMode === 'compact'
                            ? 'bg-orange-500 text-white'
                            : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <Minimize2 className="w-3.5 h-3.5" />
                        Compact
                      </button>
                      <button
                        type="button"
                        onClick={() => setLogDensityMode('detailed')}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center justify-center gap-1.5 transition-all ${
                          logDensityMode === 'detailed'
                            ? 'bg-orange-500 text-white'
                            : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <Maximize2 className="w-3.5 h-3.5" />
                        Detailed
                      </button>
                    </div>
                  </div>

                  {/* 2. Layout */}
                  <div className="space-y-1.5">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Layout
                    </span>
                    <div className="grid grid-cols-2 rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200/60 dark:border-slate-700/60">
                      <button
                        type="button"
                        onClick={() => setLogLayoutMode('list')}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center justify-center gap-1.5 transition-all ${
                          logLayoutMode === 'list'
                            ? 'bg-orange-500 text-white'
                            : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <LayoutList className="w-3.5 h-3.5" />
                        List
                      </button>
                      <button
                        type="button"
                        onClick={() => setLogLayoutMode('cards')}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center justify-center gap-1.5 transition-all ${
                          logLayoutMode === 'cards'
                            ? 'bg-orange-500 text-white'
                            : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <GalleryHorizontalEnd className="w-3.5 h-3.5" />
                        Cards
                      </button>
                    </div>
                  </div>

                  {/* 3. Viewport */}
                  <div className="space-y-1.5">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Viewport
                    </span>
                    <div className="grid grid-cols-2 rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200/60 dark:border-slate-700/60">
                      <button
                        type="button"
                        onClick={() => setViewportMode('auto')}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center justify-center gap-1.5 transition-all ${
                          viewportMode !== 'mobile'
                            ? 'bg-orange-500 text-white'
                            : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <Laptop className="w-3.5 h-3.5" />
                        Desktop
                      </button>
                      <button
                        type="button"
                        onClick={() => setViewportMode('mobile')}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center justify-center gap-1.5 transition-all ${
                          viewportMode === 'mobile'
                            ? 'bg-orange-500 text-white'
                            : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <Smartphone className="w-3.5 h-3.5" />
                        Mobile
                      </button>
                    </div>
                  </div>

                  {/* 4. Theme */}
                  <div className="space-y-1.5">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Theme
                    </span>
                    <div className="grid grid-cols-3 rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200/60 dark:border-slate-700/60">
                      <button
                        type="button"
                        onClick={() => setTheme('light')}
                        className={`px-2 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center justify-center gap-1 transition-all ${
                          meta.theme === 'light'
                            ? 'bg-orange-500 text-white'
                            : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <Sun className="w-3.5 h-3.5" />
                        Light
                      </button>
                      <button
                        type="button"
                        onClick={() => setTheme('dark')}
                        className={`px-2 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center justify-center gap-1 transition-all ${
                          meta.theme === 'dark'
                            ? 'bg-orange-500 text-white'
                            : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <Moon className="w-3.5 h-3.5" />
                        Dark
                      </button>
                      <button
                        type="button"
                        onClick={() => setTheme('system')}
                        className={`px-2 py-1.5 rounded-lg text-[11px] font-bold inline-flex items-center justify-center gap-1 transition-all ${
                          meta.theme === 'system'
                            ? 'bg-orange-500 text-white'
                            : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                        }`}
                      >
                        <Monitor className="w-3.5 h-3.5" />
                        Device
                      </button>
                    </div>
                  </div>

                  {/* 5. Workout Preferences */}
                  <div className="space-y-1.5 pt-1 border-t border-slate-100 dark:border-slate-800">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      Workout Controls
                    </span>
                    <label className="flex items-center justify-between text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer py-0.5">
                      <span>Keep Screen Awake</span>
                      <input
                        type="checkbox"
                        checked={meta.keepScreenAwake !== false}
                        onChange={(e) => setKeepScreenAwake(e.target.checked)}
                        className="rounded accent-orange-500"
                      />
                    </label>
                    <label className="flex items-center justify-between text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer py-0.5">
                      <span>Timer Countdown Beeps</span>
                      <input
                        type="checkbox"
                        checked={meta.timerSoundEnabled !== false}
                        onChange={(e) => setTimerSoundEnabled(e.target.checked)}
                        className="rounded accent-orange-500"
                      />
                    </label>
                    <label className="flex items-center justify-between text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer py-0.5">
                      <span>Auto-Rest on Set Log</span>
                      <input
                        type="checkbox"
                        checked={meta.defaultAutoStartRestTimer}
                        onChange={(e) => setDefaultAutoStartRestTimer(e.target.checked)}
                        className="rounded accent-orange-500"
                      />
                    </label>
                  </div>

                  {/* 6. Cloud Sync */}
                  <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
                    <button
                      type="button"
                      onClick={async () => {
                        if (!authUser) {
                          setCogOpen(false);
                          setActiveTab('settings');
                          return;
                        }
                        await syncWithFirestore();
                      }}
                      className={`w-full px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between border transition-colors ${
                        syncStatus === 'error'
                          ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400 hover:bg-rose-500/15'
                          : syncStatus === 'syncing'
                          ? 'bg-orange-500/10 border-orange-500/30 text-orange-600 dark:text-orange-400'
                          : authUser
                          ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15'
                          : 'bg-slate-100 dark:bg-slate-800 border-slate-200/70 dark:border-slate-700/70 text-slate-600 dark:text-slate-300 hover:border-orange-500'
                      }`}
                    >
                      <span className="inline-flex items-center gap-2">
                        <Cloud
                          className={`w-4 h-4 ${
                            syncStatus === 'error'
                              ? 'text-rose-500'
                              : syncStatus === 'syncing'
                              ? 'text-orange-500 animate-pulse'
                              : authUser
                              ? 'text-emerald-500'
                              : 'text-slate-400'
                          }`}
                        />
                        <span>
                          {syncStatus === 'error'
                            ? 'Sync Error'
                            : syncStatus === 'syncing'
                            ? 'Syncing...'
                            : authUser
                            ? 'Synced'
                            : 'Offline'}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold opacity-80">
                        <RefreshCw
                          className={`w-3 h-3 ${syncStatus === 'syncing' ? 'animate-spin' : ''}`}
                        />
                        {authUser ? 'Sync Now' : 'Sign In'}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </header>

          {/* Main View Content */}
          <main
            className={`flex-1 w-full min-w-0 overflow-x-hidden mx-auto px-3 sm:px-5 pt-3.5 ${
              isForcedMobile ? 'max-w-full' : 'max-w-5xl'
            }`}
          >
            {pendingTaskCompletions.length > 0 && (
              <div className="mb-3 space-y-2">
                {pendingTaskCompletions.map((pending) => (
                  <div
                    key={pending.scheduleItemUuid}
                    className="rounded-2xl bg-[var(--bg-card)] border border-[var(--accent-orange)] px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs shadow-sm"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="w-4 h-4 shrink-0 text-[var(--accent-sage)]" />
                      <span className="font-medium text-[var(--text-primary)]">
                        Completed in Google Tasks:{' '}
                        <strong>
                          {pending.workoutTitle} ({pending.date})
                        </strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 ml-auto shrink-0">
                      <button
                        type="button"
                        onClick={() => openPendingTaskInLog(pending)}
                        className="px-2.5 py-1 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-[11px] font-bold transition-colors"
                      >
                        Open &amp; Log
                      </button>
                      <button
                        type="button"
                        onClick={() => void quickCompletePendingTask(pending)}
                        className="px-2.5 py-1 rounded-xl bg-[var(--bg-inset)] border border-[var(--border-card)] text-[var(--text-primary)] hover:border-[var(--accent-sage)] text-[11px] font-bold transition-colors"
                      >
                        Quick-Complete
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissPendingTaskCompletion(pending.scheduleItemUuid)}
                        aria-label="Dismiss Google Tasks prompt"
                        className="p-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {lastSyncError && (
              <div className="mb-3 rounded-2xl bg-rose-500/10 border border-rose-500/25 px-3.5 py-2.5 flex items-start justify-between gap-2 text-xs text-rose-700 dark:text-rose-300">
                <div className="flex items-start gap-2 min-w-0">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-rose-500 mt-0.5" />
                  <div className="min-w-0 break-words">
                    <span className="font-semibold">Cloud Sync failed: </span>
                    <span>{lastSyncError}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={clearSyncError}
                  aria-label="Dismiss sync error"
                  className="p-1 rounded-lg hover:bg-rose-500/15 shrink-0 text-rose-500"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {children}
          </main>

          {/* Sticky Live Timer Bar */}
          {(activeTab === 'log' || timer.isRunning) && <LiveTimerBar />}

          {/* Bottom Navigation Bar (Mobile or Forced Mobile) */}
          <nav
            className={`${bottomNavClass} ${
              isForcedMobile ? 'sticky bottom-0' : 'fixed bottom-0 inset-x-0'
            } z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/80 dark:border-slate-800 px-1 py-1.5 items-center justify-around`}
          >
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  title={item.tooltip}
                  onClick={() => setActiveTab(item.id)}
                  className={`flex-1 flex flex-col items-center justify-center py-1 px-1 rounded-2xl transition-all min-w-0 ${
                    isActive
                      ? 'text-orange-500 font-bold'
                      : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-medium'
                  }`}
                >
                  <div
                    className={`px-2.5 py-1 rounded-full transition-colors ${
                      isActive ? 'bg-orange-500/15' : ''
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-[10px] mt-0.5 truncate max-w-full">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      </div>
    </div>
  );
};

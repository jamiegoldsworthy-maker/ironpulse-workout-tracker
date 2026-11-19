import React from 'react';
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
} from 'lucide-react';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { ThemeMode } from '../types/workout';
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
    meta,
    setTheme,
    authUser,
    syncStatus,
    lastSyncError,
    clearSyncError,
    timer,
  } = useWorkoutStore();

  const cycleTheme = () => {
    const order: ThemeMode[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(meta.theme) + 1) % order.length];
    setTheme(next);
  };

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

            {/* Right Controls */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Viewport Mode Toggle */}
              {!isForcedMobile && (
                <div className="inline-flex items-center rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200/70 dark:border-slate-700/70">
                  <button
                    type="button"
                    onClick={() => setViewportMode('mobile')}
                    data-tooltip="Preview Mobile Phone View"
                    data-tooltip-pos="bottom"
                    title="Preview Mobile Phone View"
                    className="p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-all"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline text-[11px]">Mobile</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setViewportMode(viewportMode === 'desktop' ? 'auto' : 'desktop')
                    }
                    data-tooltip="Force Desktop Sidebar View"
                    data-tooltip-pos="bottom"
                    title="Force Desktop Sidebar View"
                    className={`p-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all ${
                      viewportMode === 'desktop'
                        ? 'bg-orange-500 text-white shadow-2xs'
                        : 'text-slate-500 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <Laptop className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline text-[11px]">Desktop</span>
                  </button>
                </div>
              )}

              {/* Cloud / Offline Status Pill */}
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                data-tooltip={
                  syncStatus === 'error'
                    ? `Sync error: ${lastSyncError || 'Check Settings'}`
                    : authUser
                    ? `Signed in as ${authUser.email}`
                    : 'Offline-first mode — click to configure Cloud Sync'
                }
                data-tooltip-pos="bottom"
                title={
                  syncStatus === 'error'
                    ? `Sync error: ${lastSyncError || 'Check Settings'}`
                    : authUser
                    ? `Signed in as ${authUser.email}`
                    : 'Offline-first mode — click to open Sync settings'
                }
                className={`px-2.5 py-1.5 rounded-xl text-[11px] font-semibold inline-flex items-center gap-1 border transition-colors ${
                  syncStatus === 'error'
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-400'
                    : syncStatus === 'syncing'
                    ? 'bg-orange-500/10 border-orange-500/30 text-orange-600 dark:text-orange-400'
                    : authUser
                    ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-600 dark:text-emerald-400'
                    : 'bg-slate-100 dark:bg-slate-800 border-slate-200/70 dark:border-slate-700/70 text-slate-600 dark:text-slate-300 hover:border-orange-500'
                }`}
              >
                <Cloud
                  className={`w-3.5 h-3.5 ${
                    syncStatus === 'error'
                      ? 'text-rose-500'
                      : syncStatus === 'syncing'
                      ? 'text-orange-500 animate-pulse'
                      : 'text-orange-500'
                  }`}
                />
                <span>
                  {syncStatus === 'error'
                    ? 'Sync Error'
                    : syncStatus === 'syncing'
                    ? 'Syncing'
                    : authUser
                    ? 'Synced'
                    : 'Offline'}
                </span>
              </button>

              {/* Theme Switcher Button */}
              <button
                type="button"
                onClick={cycleTheme}
                data-tooltip={`Theme: ${meta.theme} (click to switch)`}
                data-tooltip-pos="bottom"
                title={`Current theme: ${meta.theme} (click to cycle Light / Dark / System)`}
                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:text-orange-500 border border-slate-200/60 dark:border-slate-700/60 transition-colors"
              >
                {meta.theme === 'light' ? (
                  <Sun className="w-4 h-4 text-orange-500" />
                ) : meta.theme === 'dark' ? (
                  <Moon className="w-4 h-4 text-orange-400" />
                ) : (
                  <Monitor className="w-4 h-4" />
                )}
              </button>
            </div>
          </header>

          {/* Main View Content */}
          <main
            className={`flex-1 w-full min-w-0 overflow-x-hidden mx-auto px-3 sm:px-5 pt-3.5 ${
              isForcedMobile ? 'max-w-full' : 'max-w-5xl'
            }`}
          >
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

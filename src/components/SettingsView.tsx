import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ClipboardPaste,
  Cloud,
  Copy,
  Database,
  Download,
  FileSpreadsheet,
  History,
  Layers,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Sun,
  Upload,
  X,
} from 'lucide-react';
import { ModalPortal } from './ModalPortal';
import {
  buildAiNotesDiffPreview,
  buildCoachReviewExport,
  parseAiNotesPatch,
  parseAiProgramCycleImport,
} from '../utils/aiCoachPatch';
import {
  GOOGLE_TASKS_TARGET_LIST_ID,
  getCachedGoogleTasksToken,
} from '../lib/googleTasks';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { DistanceUnit, ThemeMode, WorkoutPreset } from '../types/workout';
import {
  formatLoadBadge,
  getTodayIsoDate,
  shiftIsoDate,
  uuidv4,
} from '../utils/calculations';
import {
  buildLogsFromReconciledRows,
  generateSampleLegacyCsv,
  generateSamplePresetSheetCsv,
  ParsedLegacyRow,
  parseLegacyGoogleSheetCsv,
  parsePresetSheetCsv,
} from '../utils/legacyCsvParser';
import {
  clearRuntimeFirebaseConfig,
  getEffectiveFirebaseConfig,
  saveRuntimeFirebaseConfig,
  signInWithGoogle,
  signOutFirebase,
} from '../services/firebase';

type SettingsTab = 'sync_prefs' | 'ai_coach';
type CoachReviewPeriod = '7d' | '14d' | '30d' | 'program_block' | 'custom';

function formatSnapshotTimestamp(iso: string): string {
  try {
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return iso;
    return dt.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export const SettingsView: React.FC = () => {
  const {
    presets,
    programs,
    schedules,
    exercises: globalExercises,
    logs,
    contextBlocks,
    meta,
    logDensityMode,
    setLogDensityMode,
    authUser,
    syncStatus,
    lastSyncError,
    isOnline,
    offlineSyncQueue,
    safetySnapshotMeta,
    setTheme,
    setDefaultDistanceUnit,
    setDefaultAutoStartRestTimer,
    setKeepScreenAwake,
    setTimerSoundEnabled,
    upsertPreset,
    applyAiNotesPatch,
    importProgramCycle,
    commitReconciledLegacyImport,
    importContextBlocks,
    syncWithFirestore,
    pushLocalToCloud,
    resetToDemoSeed,
    restoreSafetySnapshot,
    lastTasksSync,
    runGoogleTasksSync,
  } = useWorkoutStore();

  const todayIso = getTodayIsoDate();

  // Top 2-Tab Segmented Switcher (Sync & Preferences default on open)
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('sync_prefs');
  const [isSyncingTasks, setIsSyncingTasks] = useState(false);

  // Collapsible bottom accordions inside Sync & Preferences (collapsed by default)
  const [backupAccordionOpen, setBackupAccordionOpen] = useState(false);
  const [legacyCsvAccordionOpen, setLegacyCsvAccordionOpen] = useState(false);
  const [sheetImportMode, setSheetImportMode] = useState<'presets' | 'logs'>('presets');

  // Portaled confirmation modals
  const [restoreSnapshotConfirmOpen, setRestoreSnapshotConfirmOpen] = useState(false);
  const [isRestoringSnapshot, setIsRestoringSnapshot] = useState(false);
  const [applyNotesConfirmOpen, setApplyNotesConfirmOpen] = useState(false);
  const [isApplyingNotes, setIsApplyingNotes] = useState(false);

  // Toast notice
  const [notice, setNotice] = useState<string | null>(null);
  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3400);
  };

  // =========================================================================
  // SYNC & PREFERENCES: FIREBASE CONFIG & LEGACY GOOGLE SHEET IMPORTER
  // =========================================================================
  const [firebaseJsonInput, setFirebaseJsonInput] = useState<string>('');
  const effectiveFbConfig = getEffectiveFirebaseConfig();

  const [presetSheetCsv, setPresetSheetCsv] = useState<string>('');
  const [parsedSheetPresets, setParsedSheetPresets] = useState<WorkoutPreset[]>([]);

  const handleParsePresetSheet = (rawText: string) => {
    const extracted = parsePresetSheetCsv(
      rawText,
      presets,
      globalExercises,
      meta.activeProgramUuid
    );
    setParsedSheetPresets(extracted);
  };

  const handleCommitPresetSheetImport = () => {
    if (parsedSheetPresets.length === 0) return;
    for (const pre of parsedSheetPresets) {
      upsertPreset(pre);
    }
    const count = parsedSheetPresets.length;
    setPresetSheetCsv('');
    setParsedSheetPresets([]);
    showNotice(`Imported ${count} Preset Workout(s) into your Library!`);
  };

  const [csvInputText, setCsvInputText] = useState<string>('');
  const [parsedLegacyRows, setParsedLegacyRows] = useState<ParsedLegacyRow[]>([]);
  const [workoutNameMap, setWorkoutNameMap] = useState<Record<string, string>>({});
  const [exerciseNameMap, setExerciseNameMap] = useState<Record<string, string>>({});

  const handleParseCsv = (rawText: string) => {
    const rows = parseLegacyGoogleSheetCsv(rawText);
    setParsedLegacyRows(rows);

    const wMap: Record<string, string> = {};
    const eMap: Record<string, string> = {};

    const uniqueWorkouts = Array.from(new Set(rows.map((r) => r.workoutName)));
    for (const wName of uniqueWorkouts) {
      const legacyIdsForWorkout = Array.from(
        new Set(rows.filter((r) => r.workoutName === wName).map((r) => r.legacyId.toLowerCase()))
      );
      const matchedByLegacyId = presets.find(
        (p) => p.legacyWorkoutId && legacyIdsForWorkout.includes(p.legacyWorkoutId.toLowerCase())
      );
      const exactOrFuzzy =
        matchedByLegacyId ||
        presets.find(
          (p) =>
            p.title.toLowerCase() === wName.toLowerCase() ||
            wName.toLowerCase().includes(p.title.toLowerCase())
        );
      wMap[wName] = exactOrFuzzy ? exactOrFuzzy.presetUuid : `pre-${uuidv4()}`;
    }

    const uniqueExercises = Array.from(new Set(rows.map((r) => r.exerciseName)));
    for (const eName of uniqueExercises) {
      const exactOrAlias = globalExercises.find(
        (ge) =>
          ge.exerciseName.toLowerCase() === eName.toLowerCase() ||
          ge.aliases?.some((a) => a.toLowerCase() === eName.toLowerCase())
      );
      eMap[eName] = exactOrAlias ? exactOrAlias.exerciseUuid : `ex-${uuidv4()}`;
    }

    setWorkoutNameMap(wMap);
    setExerciseNameMap(eMap);
  };

  // =========================================================================
  // AI COACH & DATA — CARD A: EXPORT TRAINING DATA FOR AI COACH REVIEW
  // =========================================================================
  const [reviewPeriod, setReviewPeriod] = useState<CoachReviewPeriod>('14d');
  const [customStartDate, setCustomStartDate] = useState<string>(() =>
    shiftIsoDate(todayIso, -13)
  );
  const [customEndDate, setCustomEndDate] = useState<string>(todayIso);
  const [includeUpcoming7Days, setIncludeUpcoming7Days] = useState<boolean>(true);
  const [includeContextFlags, setIncludeContextFlags] = useState<boolean>(true);
  const [includeSundayCheckInPrompt, setIncludeSundayCheckInPrompt] = useState<boolean>(true);

  const activeProgram = useMemo(
    () =>
      programs.find((p) => p.programUuid === meta.activeProgramUuid) || programs[0] || null,
    [programs, meta.activeProgramUuid]
  );

  const reviewWindow = useMemo(() => {
    if (reviewPeriod === '7d') {
      return {
        startDate: shiftIsoDate(todayIso, -6),
        endDate: todayIso,
        label: 'Last 7 Days',
      };
    }
    if (reviewPeriod === '14d') {
      return {
        startDate: shiftIsoDate(todayIso, -13),
        endDate: todayIso,
        label: 'Last 14 Days',
      };
    }
    if (reviewPeriod === '30d') {
      return {
        startDate: shiftIsoDate(todayIso, -29),
        endDate: todayIso,
        label: 'Last 30 Days',
      };
    }
    if (reviewPeriod === 'program_block') {
      if (activeProgram) {
        try {
          const savedRaw = window.localStorage.getItem(
            `ironpulse_autofill_range_${activeProgram.programUuid}`
          );
          if (savedRaw) {
            const saved = JSON.parse(savedRaw) as { start?: string; end?: string };
            if (saved.start && saved.end) {
              return {
                startDate: saved.start,
                endDate: saved.end > todayIso ? todayIso : saved.end,
                label: `Current Program Block (${activeProgram.title})`,
              };
            }
          }
        } catch {
          // ignore
        }
        const progDates = Object.keys(schedules)
          .filter((d) =>
            schedules[d]?.items.some((it) => it.programUuid === activeProgram.programUuid)
          )
          .sort();
        if (progDates.length > 0) {
          return {
            startDate: progDates[0],
            endDate: todayIso,
            label: `Current Program Block (${activeProgram.title})`,
          };
        }
      }
      return {
        startDate: shiftIsoDate(todayIso, -27),
        endDate: todayIso,
        label: 'Current Program Block',
      };
    }
    const start = customStartDate <= customEndDate ? customStartDate : customEndDate;
    const end = customStartDate <= customEndDate ? customEndDate : customStartDate;
    return {
      startDate: start,
      endDate: end,
      label: `Custom (${start} to ${end})`,
    };
  }, [reviewPeriod, todayIso, activeProgram, schedules, customStartDate, customEndDate]);

  const reviewStats = useMemo(() => {
    const completedCount = logs.filter(
      (l) =>
        l.status === 'completed' &&
        l.date >= reviewWindow.startDate &&
        l.date <= reviewWindow.endDate
    ).length;
    const next7End = shiftIsoDate(todayIso, 6);
    const upcomingCount = Object.keys(schedules)
      .filter((d) => d >= todayIso && d <= next7End)
      .reduce((acc, d) => acc + (schedules[d]?.items.length || 0), 0);
    const contextCount = contextBlocks.filter(
      (b) => b.endDate >= reviewWindow.startDate && b.startDate <= next7End
    ).length;
    return { completedCount, upcomingCount, contextCount };
  }, [logs, schedules, contextBlocks, reviewWindow, todayIso]);

  const handleCopyCoachReviewJson = async () => {
    const result = buildCoachReviewExport({
      startDate: reviewWindow.startDate,
      endDate: reviewWindow.endDate,
      periodLabel: reviewWindow.label,
      logs,
      schedules,
      contextBlocks,
      presets,
      programs,
      activeProgramUuid: meta.activeProgramUuid,
      includeUpcoming7Days,
      includeContextFlags,
      includeSundayCheckInPrompt,
    });
    try {
      await navigator.clipboard.writeText(JSON.stringify(result.payload, null, 2));
      showNotice(
        `Copied Coach Review JSON (${result.completedCount} completed workout${
          result.completedCount === 1 ? '' : 's'
        }${includeUpcoming7Days ? `, ${result.upcomingCount} upcoming` : ''})`
      );
    } catch {
      showNotice('Clipboard write blocked by browser.');
    }
  };

  // =========================================================================
  // AI COACH & DATA — CARD B: APPLY COACH NOTES PATCH (NON-DESTRUCTIVE)
  // =========================================================================
  const [notesPatchText, setNotesPatchText] = useState<string>('');

  const { patch: parsedNotesPatch, error: notesPatchError } = useMemo(
    () => parseAiNotesPatch(notesPatchText),
    [notesPatchText]
  );

  const notesPatchDiff = useMemo(() => {
    if (!parsedNotesPatch) return null;
    return buildAiNotesDiffPreview(parsedNotesPatch, { programs, presets, schedules });
  }, [parsedNotesPatch, programs, presets, schedules]);

  const notesScheduledSessionsCount = useMemo(() => {
    if (!notesPatchDiff) return 0;
    return new Set(notesPatchDiff.scheduleNoteDiffs.map((d) => d.scheduleItemUuid)).size;
  }, [notesPatchDiff]);

  const notesTotalUpdatesCount = notesPatchDiff
    ? notesPatchDiff.scheduleNoteDiffs.length +
      notesPatchDiff.programWeekDiffs.length +
      notesPatchDiff.presetNoteDiffs.length +
      notesPatchDiff.exerciseNoteDiffs.length
    : 0;

  const handleConfirmApplyNotesPatch = async () => {
    if (!parsedNotesPatch) return;
    setIsApplyingNotes(true);
    const res = await applyAiNotesPatch(parsedNotesPatch, {
      allowStructuralChanges: false,
    });
    setIsApplyingNotes(false);
    setApplyNotesConfirmOpen(false);
    if (res.ok) {
      setNotesPatchText('');
      const parts: string[] = [];
      if (res.schedulesUpdated > 0) parts.push(`${res.schedulesUpdated} scheduled session(s)`);
      if (res.weeksUpdated > 0) parts.push(`${res.weeksUpdated} week focus note(s)`);
      if (res.presetsUpdated > 0) parts.push(`${res.presetsUpdated} workout note(s)`);
      if (res.exercisesUpdated > 0) parts.push(`${res.exercisesUpdated} exercise cue(s)`);
      showNotice(
        parts.length > 0
          ? `Applied notes patch: ${parts.join(', ')}`
          : 'Notes patch checked — no differences to apply'
      );
    } else {
      showNotice(res.error || 'Failed to apply notes patch');
    }
  };

  // =========================================================================
  // AI COACH & DATA — CARD C: IMPORT FULL PROGRAM & WEEKLY CYCLE
  // =========================================================================
  const [programImportText, setProgramImportText] = useState<string>('');
  const [programImportMode, setProgramImportMode] = useState<'create_new' | 'replace_active'>(
    'create_new'
  );

  const { parsed: parsedProgramImport, error: programImportError } = useMemo(
    () => parseAiProgramCycleImport(programImportText, presets),
    [programImportText, presets]
  );

  const handleLoadSampleProgramJson = () => {
    const firstId = presets[0]?.presetUuid || 'pre-abc-double';
    const secondId = presets[1]?.presetUuid || firstId;
    const sample = {
      programName: 'AI 2-Week Hybrid Strength & Engine',
      cycleWeeks: 2,
      description: 'Two-week rotating progression generated by AI Coach',
      weeks: [
        {
          weekNumber: 1,
          focusNote: 'Week 1: Establish crisp pacing at RIR 2',
          days: [
            {
              dayOfWeek: 1,
              slots: [{ slotRole: 'Primary', workoutId: firstId, notes: 'Target steady tempo' }],
            },
            {
              dayOfWeek: 3,
              slots: [{ slotRole: 'Primary', workoutId: secondId, notes: 'Zone 2 nasal breathing' }],
            },
          ],
        },
        {
          weekNumber: 2,
          focusNote: 'Week 2: +5% volume progression',
          days: [
            {
              dayOfWeek: 1,
              slots: [{ slotRole: 'Primary', workoutId: firstId, notes: '+5% Build: add 1 set' }],
            },
            {
              dayOfWeek: 3,
              slots: [{ slotRole: 'Primary', workoutId: secondId, notes: '+5% Build: +5 mins' }],
            },
          ],
        },
      ],
      autoFill: {
        startDate: todayIso,
        endDate: shiftIsoDate(todayIso, 13),
      },
    };
    setProgramImportText(JSON.stringify(sample, null, 2));
  };

  const handleImportProgramCycle = () => {
    if (!parsedProgramImport) return;
    const res = importProgramCycle(parsedProgramImport, programImportMode);
    setProgramImportText('');
    const autoFillMsg = res.autoFillResult
      ? ` & auto-filled ${res.autoFillResult.daysModified} day(s)`
      : '';
    showNotice(
      `Imported "${res.programTitle}" (${res.cycleWeeks}-week cycle${
        res.presetsCount > 0 ? `, ${res.presetsCount} preset(s)` : ''
      }${autoFillMsg}). Safety snapshot saved.`
    );
  };

  return (
    <div className="space-y-4 pb-24">
      {notice && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-[1200] px-4 py-2 rounded-2xl bg-slate-900 dark:bg-orange-500 text-white text-xs font-bold shadow-lg flex items-center gap-2 max-w-[92vw]">
          <CheckCircle2 className="w-4 h-4 text-orange-400 dark:text-white shrink-0" />
          <span className="truncate">{notice}</span>
        </div>
      )}

      {/* Clean 2-Tab Segmented Switcher */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-1.5 border border-slate-200/80 dark:border-slate-800 grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={() => setActiveSettingsTab('sync_prefs')}
          className={`tactile-pill py-2.5 px-3 rounded-2xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-all ${
            activeSettingsTab === 'sync_prefs'
              ? 'bg-orange-500 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Cloud className="w-4 h-4 shrink-0" />
          <span>Sync &amp; Preferences</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveSettingsTab('ai_coach')}
          className={`tactile-pill py-2.5 px-3 rounded-2xl text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-all ${
            activeSettingsTab === 'ai_coach'
              ? 'bg-orange-500 text-white shadow-sm'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Sparkles className="w-4 h-4 shrink-0" />
          <span>AI Coach &amp; Data</span>
        </button>
      </div>

      {/* =====================================================================
          TAB 1: SYNC & PREFERENCES (DEFAULT)
         ===================================================================== */}
      {activeSettingsTab === 'sync_prefs' && (
        <div className="space-y-4">
          {/* Top Row: Cloud Sync & Google Tasks Sync */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Google Sign-In & Cloud Sync */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Cloud className="w-5 h-5 text-orange-500 shrink-0" />
                  <h3 className="font-display font-bold text-base truncate">
                    Google Sign-In &amp; Cloud Sync
                  </h3>
                </div>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 ${
                    !isOnline
                      ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
                      : syncStatus === 'synced'
                      ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : syncStatus === 'syncing'
                      ? 'bg-orange-500/15 text-orange-500'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                  }`}
                >
                  {!isOnline
                    ? `Offline${offlineSyncQueue.pendingCount > 0 ? ` (${offlineSyncQueue.pendingCount})` : ''}`
                    : syncStatus === 'local'
                    ? 'Saved on Device'
                    : syncStatus}
                </span>
              </div>

              <p className="text-xs text-slate-500 dark:text-slate-400">
                Sign in with Google to sync your workouts, schedule, and logs across your phone and
                laptop, with full offline gym support.
              </p>

              {authUser ? (
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold truncate">
                        {authUser.displayName || 'Signed In'}
                      </div>
                      <div className="text-[11px] text-slate-500 truncate">{authUser.email}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => signOutFirebase()}
                      className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-xs font-semibold inline-flex items-center gap-1 shrink-0"
                    >
                      <LogOut className="w-3.5 h-3.5" /> Sign Out
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        await syncWithFirestore();
                        showNotice('Synced workouts & schedule with Firestore');
                      }}
                      className="px-3 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Sync Now
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await pushLocalToCloud();
                        if (res.ok) {
                          showNotice(
                            `Force Sync complete — pushed ${res.pushedLogs} workout(s) & drafts to cloud`
                          );
                        } else {
                          showNotice(res.error || 'Force Sync failed');
                        }
                      }}
                      className="px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
                    >
                      <Upload className="w-3.5 h-3.5" /> Force Sync / Push Local Data
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        await signInWithGoogle();
                        showNotice('Signed in with Google!');
                      } catch (e: unknown) {
                        showNotice(
                          e instanceof Error ? e.message : 'Configure Firebase project below first'
                        );
                      }
                    }}
                    className="w-full py-2.5 px-4 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-sm"
                  >
                    <LogIn className="w-4 h-4" />
                    Sign In with Google
                  </button>

                  <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                    <label className="block text-[11px] font-semibold text-slate-500">
                      Firebase Project Config (Optional if not set in `.env`)
                    </label>
                    <textarea
                      rows={3}
                      value={firebaseJsonInput}
                      onChange={(e) => setFirebaseJsonInput(e.target.value)}
                      placeholder='Paste firebaseConfig object ({ "apiKey": "...", "projectId": "..." })...'
                      className="w-full p-2.5 rounded-xl font-mono text-[11px] bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                    />
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">
                        {effectiveFbConfig
                          ? `Project: ${effectiveFbConfig.projectId}`
                          : 'Running in Local Offline Mode'}
                      </span>
                      <div className="flex gap-1.5">
                        {effectiveFbConfig && (
                          <button
                            type="button"
                            onClick={() => {
                              clearRuntimeFirebaseConfig();
                              window.location.reload();
                            }}
                            className="px-2.5 py-1 rounded-lg text-[11px] bg-slate-100 dark:bg-slate-800"
                          >
                            Disconnect
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            if (saveRuntimeFirebaseConfig(firebaseJsonInput)) {
                              showNotice('Saved Firebase config — reloading...');
                              setTimeout(() => window.location.reload(), 600);
                            } else {
                              showNotice('Invalid Firebase config JSON');
                            }
                          }}
                          className="px-3 py-1 rounded-lg text-xs font-bold bg-slate-900 dark:bg-orange-500 text-white"
                        >
                          Save Config
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {lastSyncError && (
                <div className="text-xs text-rose-500 bg-rose-500/10 p-2.5 rounded-xl">
                  {lastSyncError}
                </div>
              )}
            </div>

            {/* Google Tasks Sync Card */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="font-display font-bold text-base">Google Tasks Sync</h3>
                  <p className="text-xs text-slate-500">
                    Two-way sync for today &amp; upcoming 6 days with stale-task cleanup.
                  </p>
                </div>
                <button
                  type="button"
                  disabled={isSyncingTasks}
                  onClick={async () => {
                    setIsSyncingTasks(true);
                    const res = await runGoogleTasksSync(true);
                    setIsSyncingTasks(false);
                    if (res.ok) {
                      showNotice(
                        `Google Tasks Master Sync complete (${res.pushed} pushed, ${res.pulled} completed)`
                      );
                    } else if (res.error) {
                      showNotice(`Google Tasks sync: ${res.error}`);
                    }
                  }}
                  className="px-3.5 py-2 rounded-2xl bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isSyncingTasks ? 'animate-spin' : ''}`} />
                  {isSyncingTasks ? 'Syncing...' : 'Master Sync'}
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                <div className="p-3 rounded-2xl bg-[var(--bg-inset)] border border-[var(--border-subtle)] space-y-0.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Connection / Token Status
                  </div>
                  <div
                    className="font-bold"
                    style={{
                      color: getCachedGoogleTasksToken()
                        ? 'var(--accent-sage)'
                        : 'var(--accent-orange)',
                    }}
                  >
                    {getCachedGoogleTasksToken()
                      ? 'Active (this session)'
                      : 'Needs authorization on next sync'}
                  </div>
                </div>

                <div className="p-3 rounded-2xl bg-[var(--bg-inset)] border border-[var(--border-subtle)] space-y-0.5 min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                    Target List ID
                  </div>
                  <div className="font-mono text-[11px] text-[var(--text-secondary)] truncate">
                    {GOOGLE_TASKS_TARGET_LIST_ID}
                  </div>
                </div>
              </div>

              <div className="text-xs text-[var(--text-secondary)]">
                {lastTasksSync ? (
                  <span
                    style={{
                      color:
                        lastTasksSync.status === 'success'
                          ? 'var(--accent-sage)'
                          : 'var(--accent-rust)',
                    }}
                    className="font-semibold"
                  >
                    Last sync:{' '}
                    {new Date(lastTasksSync.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    · {lastTasksSync.status === 'success' ? 'Success' : 'Failed'}
                    {lastTasksSync.message ? ` (${lastTasksSync.message})` : ''}
                  </span>
                ) : (
                  <span className="text-[var(--text-muted)]">Not synced yet this session.</span>
                )}
              </div>
            </div>
          </div>

          {/* Preferences Card */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 space-y-4">
            <h3 className="font-display font-bold text-base">Preferences</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Appearance */}
              <div className="space-y-1.5 md:col-span-2">
                <label className="block text-xs font-semibold text-slate-500">Appearance</label>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { id: 'light', label: 'Light Sand', icon: Sun },
                      { id: 'dark', label: 'Dark Charcoal', icon: Moon },
                      { id: 'system', label: 'System', icon: Monitor },
                    ] as Array<{
                      id: ThemeMode;
                      label: string;
                      icon: React.ComponentType<{ className?: string }>;
                    }>
                  ).map((t) => {
                    const Icon = t.icon;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTheme(t.id)}
                        className={`py-2.5 px-3 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all ${
                          meta.theme === t.id
                            ? 'bg-orange-500 text-white border-orange-500 shadow-sm'
                            : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" />
                        <span className="truncate">{t.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Default Cardio Distance Unit */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-500">
                  Default Cardio Distance Unit
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['mi', 'km'] as DistanceUnit[]).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setDefaultDistanceUnit(u)}
                      className={`py-2 px-3 rounded-2xl text-xs font-bold uppercase border ${
                        (meta.defaultDistanceUnit || 'mi') === u
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {u === 'mi' ? 'Miles (mi)' : 'Kilometers (km)'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Default Log View */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-slate-500">
                  Default Log View
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['compact', 'detailed'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setLogDensityMode(mode)}
                      className={`py-2 px-3 rounded-2xl text-xs font-bold capitalize border ${
                        logDensityMode === mode
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                      }`}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5 pt-1">
              <label className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
                <div>
                  <div className="text-xs font-bold">Keep Screen Awake</div>
                  <div className="text-[11px] text-slate-500">Prevent sleep while logging</div>
                </div>
                <input
                  type="checkbox"
                  checked={meta.keepScreenAwake !== false}
                  onChange={(e) => setKeepScreenAwake(e.target.checked)}
                  className="rounded accent-orange-500 w-4 h-4 shrink-0"
                />
              </label>

              <label className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
                <div>
                  <div className="text-xs font-bold">Timer Beeps</div>
                  <div className="text-[11px] text-slate-500">3-2-1 &amp; finish chimes</div>
                </div>
                <input
                  type="checkbox"
                  checked={meta.timerSoundEnabled !== false}
                  onChange={(e) => setTimerSoundEnabled(e.target.checked)}
                  className="rounded accent-orange-500 w-4 h-4 shrink-0"
                />
              </label>

              <label className="flex items-center justify-between gap-2 p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
                <div>
                  <div className="text-xs font-bold">Auto-Start Rest</div>
                  <div className="text-[11px] text-slate-500">Start rest on set log</div>
                </div>
                <input
                  type="checkbox"
                  checked={meta.defaultAutoStartRestTimer}
                  onChange={(e) => setDefaultAutoStartRestTimer(e.target.checked)}
                  className="rounded accent-orange-500 w-4 h-4 shrink-0"
                />
              </label>
            </div>
          </div>

          {/* Collapsible Accordion 1: Safety Snapshots & JSON Backup */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 overflow-hidden">
            <button
              type="button"
              onClick={() => setBackupAccordionOpen((prev) => !prev)}
              aria-expanded={backupAccordionOpen}
              className="w-full px-5 py-4 flex items-center justify-between gap-2 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <ShieldCheck className="w-4 h-4 text-orange-500 shrink-0" />
                <div className="min-w-0">
                  <div className="font-display font-bold text-sm truncate">
                    Safety Snapshots &amp; Full JSON Backup
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {safetySnapshotMeta
                      ? `Auto-snapshot saved ${formatSnapshotTimestamp(safetySnapshotMeta.timestamp)}`
                      : 'Automatic pre-reset snapshots, export & restore JSON backups'}
                  </div>
                </div>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
                  backupAccordionOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {backupAccordionOpen && (
              <div className="px-5 pb-5 pt-2 border-t border-slate-100 dark:border-slate-800 space-y-4">
                {/* Automatic Pre-Reset Safety Snapshot Block */}
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 space-y-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <History className="w-4 h-4 text-orange-500 shrink-0" />
                      <span className="text-xs font-bold">Automatic Pre-Reset Safety Snapshot</span>
                    </div>
                    {safetySnapshotMeta && (
                      <button
                        type="button"
                        onClick={() => setRestoreSnapshotConfirmOpen(true)}
                        className="px-3 py-1.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Restore Safety Snapshot
                      </button>
                    )}
                  </div>

                  {safetySnapshotMeta ? (
                    <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
                      <div>
                        Saved{' '}
                        <strong>{formatSnapshotTimestamp(safetySnapshotMeta.timestamp)}</strong>{' '}
                        before <span className="font-semibold">{safetySnapshotMeta.reason}</span>.
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Contains {safetySnapshotMeta.scheduleDaysCount} scheduled day(s),{' '}
                        {safetySnapshotMeta.logsCount} workout log(s),{' '}
                        {safetySnapshotMeta.programsCount} program(s), and{' '}
                        {safetySnapshotMeta.contextCount} context flag(s).
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      No snapshot recorded yet. A rolling snapshot (`wt_safety_snapshot`) is saved
                      automatically right before Reset to Program Plan, Auto-Fill overwrite, Delete
                      Program, or Program Import.
                    </p>
                  )}
                </div>

                {/* Full JSON Backup Export / Import / Demo Seed */}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const backup = {
                        exportedAt: new Date().toISOString(),
                        meta,
                        exercises: globalExercises,
                        presets,
                        programs,
                        schedules,
                        logs,
                        contextBlocks,
                      };
                      const blob = new Blob([JSON.stringify(backup, null, 2)], {
                        type: 'application/json',
                      });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `ironpulse-backup-${todayIso}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                      showNotice('Downloaded full JSON backup');
                    }}
                    className="px-3.5 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 text-xs font-bold inline-flex items-center gap-1.5 hover:text-orange-500 transition-colors"
                  >
                    <Download className="w-4 h-4 text-orange-500" />
                    Export Backup JSON
                  </button>

                  <label className="px-3.5 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer hover:text-orange-500 transition-colors">
                    <Upload className="w-4 h-4 text-orange-500" />
                    Import Backup JSON
                    <input
                      type="file"
                      accept="application/json,.json"
                      className="sr-only"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        if (!file) return;
                        try {
                          const raw = await file.text();
                          const parsed = JSON.parse(raw) as {
                            contextBlocks?: typeof contextBlocks;
                            presets?: typeof presets;
                          };
                          const importedParts: string[] = [];
                          if (
                            Array.isArray(parsed.contextBlocks) &&
                            parsed.contextBlocks.length > 0
                          ) {
                            importContextBlocks(parsed.contextBlocks);
                            importedParts.push(`${parsed.contextBlocks.length} context flag(s)`);
                          }
                          if (Array.isArray(parsed.presets) && parsed.presets.length > 0) {
                            for (const p of parsed.presets) {
                              if (p?.presetUuid && p?.title) upsertPreset(p);
                            }
                            importedParts.push(`${parsed.presets.length} preset(s)`);
                          }
                          showNotice(
                            importedParts.length > 0
                              ? `Imported ${importedParts.join(' & ')} from backup`
                              : 'Backup file contained no importable records'
                          );
                        } catch {
                          showNotice('Failed to parse backup JSON file');
                        }
                      }}
                    />
                  </label>

                  <button
                    type="button"
                    onClick={() => {
                      resetToDemoSeed();
                      showNotice('Loaded sample workouts & history');
                    }}
                    className="px-3.5 py-2 rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-bold ml-auto"
                  >
                    Load Sample Data
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Collapsible Accordion 2: Legacy Google Sheet CSV Importer */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/80 dark:border-slate-800 overflow-hidden">
            <button
              type="button"
              onClick={() => setLegacyCsvAccordionOpen((prev) => !prev)}
              aria-expanded={legacyCsvAccordionOpen}
              className="w-full px-5 py-4 flex items-center justify-between gap-2 text-left hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <FileSpreadsheet className="w-4 h-4 text-orange-500 shrink-0" />
                <div className="min-w-0">
                  <div className="font-display font-bold text-sm truncate">
                    Legacy Google Sheet CSV Importer
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    Import preset templates or historical workout logs from spreadsheet CSV exports
                  </div>
                </div>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 shrink-0 transition-transform duration-200 ${
                  legacyCsvAccordionOpen ? 'rotate-180' : ''
                }`}
              />
            </button>

            {legacyCsvAccordionOpen && (
              <div className="px-5 pb-5 pt-3 border-t border-slate-100 dark:border-slate-800 space-y-5">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div className="inline-flex rounded-2xl bg-slate-100 dark:bg-slate-800 p-1">
                    <button
                      type="button"
                      onClick={() => setSheetImportMode('presets')}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        sheetImportMode === 'presets'
                          ? 'bg-orange-500 text-white shadow-2xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      1. Preset Workouts
                    </button>
                    <button
                      type="button"
                      onClick={() => setSheetImportMode('logs')}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        sheetImportMode === 'logs'
                          ? 'bg-orange-500 text-white shadow-2xs'
                          : 'text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      2. Historical Logs
                    </button>
                  </div>

                  {sheetImportMode === 'presets' ? (
                    <button
                      type="button"
                      onClick={() => {
                        const sample = generateSamplePresetSheetCsv();
                        setPresetSheetCsv(sample);
                        handleParsePresetSheet(sample);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400 text-xs font-bold hover:bg-orange-500 hover:text-white transition-colors"
                    >
                      Load Sample Preset CSV
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        const sample = generateSampleLegacyCsv();
                        setCsvInputText(sample);
                        handleParseCsv(sample);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400 text-xs font-bold hover:bg-orange-500 hover:text-white transition-colors"
                    >
                      Load Sample Log CSV
                    </button>
                  )}
                </div>

                {sheetImportMode === 'presets' ? (
                  <div className="space-y-4">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Paste rows from your Google Sheet Preset tab (`WorkoutID, Workout Name,
                      Workout Type, Exercise Name, Category, Sets, Reps, Default Weight, Notes,
                      Tags`).
                    </p>
                    <textarea
                      rows={5}
                      value={presetSheetCsv}
                      onChange={(e) => {
                        setPresetSheetCsv(e.target.value);
                        handleParsePresetSheet(e.target.value);
                      }}
                      placeholder="WorkoutID, Workout Name, Workout Type, Exercise Name, Category, Sets, Reps, Default Weight, Notes, Tags..."
                      className="w-full p-3 rounded-2xl font-mono text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-orange-500"
                    />

                    {parsedSheetPresets.length > 0 && (
                      <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-bold uppercase tracking-wider text-orange-500">
                            Preview: {parsedSheetPresets.length} Workout Preset(s) Ready
                          </span>
                          <button
                            type="button"
                            onClick={handleCommitPresetSheetImport}
                            className="px-4 py-2 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-md"
                          >
                            <Upload className="w-4 h-4" />
                            Save {parsedSheetPresets.length} Preset(s)
                          </button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          {parsedSheetPresets.map((pre, idx) => (
                            <div
                              key={idx}
                              className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-1.5">
                                <span className="font-display font-bold text-xs truncate">
                                  {pre.title}
                                </span>
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-orange-500/15 text-orange-600 dark:text-orange-400 shrink-0">
                                  {pre.workoutType}
                                </span>
                              </div>
                              <div className="space-y-0.5">
                                {pre.exercises.map((ex, i) => (
                                  <div
                                    key={i}
                                    className="text-[11px] flex items-center justify-between text-slate-600 dark:text-slate-300"
                                  >
                                    <span>
                                      {i + 1}. {ex.exerciseName}
                                    </span>
                                    <span className="font-mono text-[10px]">
                                      {ex.defaultSets}×{ex.defaultReps} @{' '}
                                      {formatLoadBadge(ex.loadType, ex.defaultWeight)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Paste exported Google Sheet log rows. Summary `"Total"` rows are ignored
                      automatically.
                    </p>
                    <textarea
                      rows={5}
                      value={csvInputText}
                      onChange={(e) => {
                        setCsvInputText(e.target.value);
                        handleParseCsv(e.target.value);
                      }}
                      placeholder="Paste exported Google Sheet log CSV rows here..."
                      className="w-full p-3 rounded-2xl font-mono text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-orange-500"
                    />

                    {parsedLegacyRows.length > 0 && (
                      <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-800">
                        <h4 className="font-display font-bold text-sm">
                          Match Workouts &amp; Exercises ({parsedLegacyRows.length} rows parsed)
                        </h4>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-2.5">
                            <div className="text-xs font-bold uppercase tracking-wider text-orange-500">
                              1. Match Sheet Workout Names
                            </div>
                            {Object.keys(workoutNameMap).map((wName) => (
                              <div key={wName} className="space-y-1">
                                <div className="text-xs font-semibold">"{wName}"</div>
                                <select
                                  value={workoutNameMap[wName]}
                                  onChange={(e) =>
                                    setWorkoutNameMap({
                                      ...workoutNameMap,
                                      [wName]: e.target.value,
                                    })
                                  }
                                  className="w-full px-2.5 py-1.5 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                                >
                                  <option value={workoutNameMap[wName]}>
                                    {presets.some((p) => p.presetUuid === workoutNameMap[wName])
                                      ? `Link to Library: ${
                                          presets.find(
                                            (p) => p.presetUuid === workoutNameMap[wName]
                                          )?.title
                                        }`
                                      : `Create New Workout ("${wName}")`}
                                  </option>
                                  {presets.map((p) => (
                                    <option key={p.presetUuid} value={p.presetUuid}>
                                      Link to: {p.title}
                                      {p.legacyWorkoutId ? ` (${p.legacyWorkoutId})` : ''}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ))}
                          </div>

                          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-2.5">
                            <div className="text-xs font-bold uppercase tracking-wider text-orange-500">
                              2. Match Sheet Exercise Names
                            </div>
                            {Object.keys(exerciseNameMap).map((eName) => (
                              <div key={eName} className="space-y-1">
                                <div className="text-xs font-semibold">"{eName}"</div>
                                <select
                                  value={exerciseNameMap[eName]}
                                  onChange={(e) =>
                                    setExerciseNameMap({
                                      ...exerciseNameMap,
                                      [eName]: e.target.value,
                                    })
                                  }
                                  className="w-full px-2.5 py-1.5 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                                >
                                  <option value={exerciseNameMap[eName]}>
                                    {globalExercises.some(
                                      (g) => g.exerciseUuid === exerciseNameMap[eName]
                                    )
                                      ? `Link to: ${
                                          globalExercises.find(
                                            (g) => g.exerciseUuid === exerciseNameMap[eName]
                                          )?.exerciseName
                                        }`
                                      : `Create New Exercise ("${eName}")`}
                                  </option>
                                  {globalExercises.map((ge) => (
                                    <option key={ge.exerciseUuid} value={ge.exerciseUuid}>
                                      Link to existing: {ge.exerciseName}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="flex justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              const reconciled = buildLogsFromReconciledRows(
                                parsedLegacyRows,
                                workoutNameMap,
                                exerciseNameMap,
                                presets,
                                globalExercises
                              );
                              commitReconciledLegacyImport(reconciled);
                              setCsvInputText('');
                              setParsedLegacyRows([]);
                              showNotice(
                                `Imported ${reconciled.newLogs.length} historical workout logs!`
                              );
                            }}
                            className="px-5 py-2.5 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-md"
                          >
                            <Database className="w-4 h-4" />
                            Import Historical Logs
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          TAB 2: AI COACH & DATA (3 PURPOSE-BUILT CARDS)
         ===================================================================== */}
      {activeSettingsTab === 'ai_coach' && (
        <div className="space-y-4">
          {/* CARD A: Export Training Data for AI Coach Review */}
          <section className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-orange-500 mb-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  Card A · Weekly Review Export
                </div>
                <h2 className="font-display font-bold text-base sm:text-lg">
                  Export Training Data for AI Coach Review
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Copies completed workouts (sets, reps, weight, RIR, duration, notes, and total
                  volume) for your chosen window in clean coaching JSON.
                </p>
              </div>
            </div>

            {/* Period Selector */}
            <div className="space-y-2">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Review Period
              </label>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: '7d', label: 'Last 7 Days' },
                    { id: '14d', label: 'Last 14 Days' },
                    { id: '30d', label: 'Last 30 Days' },
                    { id: 'program_block', label: 'Current Program Block' },
                    { id: 'custom', label: 'Custom Dates' },
                  ] as Array<{ id: CoachReviewPeriod; label: string }>
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setReviewPeriod(opt.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all ${
                      reviewPeriod === opt.id
                        ? 'bg-orange-500 text-white border-orange-500 shadow-xs'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-orange-400'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              {reviewPeriod === 'custom' && (
                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-500">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={customStartDate}
                      onChange={(e) => setCustomStartDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-slate-500">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={customEndDate}
                      onChange={(e) => setCustomEndDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Export Inclusion Checkboxes (All Checked by Default) */}
            <div className="space-y-2">
              <label className="flex items-center justify-between gap-2 p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
                <div>
                  <div className="text-xs font-bold">Include Upcoming 7-Day Schedule</div>
                  <div className="text-[11px] text-slate-500">
                    Exports scheduled slots (`wt_schedule`) for today + 6 days ({reviewStats.upcomingCount} slot
                    {reviewStats.upcomingCount === 1 ? '' : 's'})
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={includeUpcoming7Days}
                  onChange={(e) => setIncludeUpcoming7Days(e.target.checked)}
                  className="rounded accent-orange-500 w-4 h-4 shrink-0"
                />
              </label>

              <label className="flex items-center justify-between gap-2 p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
                <div>
                  <div className="text-xs font-bold">
                    Include Mitigating Factors / Injury &amp; Travel Flags
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Includes `wt_context` flags overlapping this window ({reviewStats.contextCount}{' '}
                    flag{reviewStats.contextCount === 1 ? '' : 's'})
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={includeContextFlags}
                  onChange={(e) => setIncludeContextFlags(e.target.checked)}
                  className="rounded accent-orange-500 w-4 h-4 shrink-0"
                />
              </label>

              <label className="flex items-center justify-between gap-2 p-2.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
                <div>
                  <div className="text-xs font-bold">Sunday Night Check-In Prompt Wrapper</div>
                  <div className="text-[11px] text-slate-500">
                    Prepends coaching instructions for JSON notes patches or program cycles + your{' '}
                    `workoutId` directory ({presets.filter((p) => !p.isArchived).length} workouts)
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={includeSundayCheckInPrompt}
                  onChange={(e) => setIncludeSundayCheckInPrompt(e.target.checked)}
                  className="rounded accent-orange-500 w-4 h-4 shrink-0"
                />
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <span className="text-xs text-slate-500 inline-flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-orange-500" />
                {reviewWindow.startDate} → {reviewWindow.endDate} ·{' '}
                <strong className="text-slate-700 dark:text-slate-200">
                  {reviewStats.completedCount} completed workout
                  {reviewStats.completedCount === 1 ? '' : 's'}
                </strong>
              </span>
              <button
                type="button"
                onClick={() => void handleCopyCoachReviewJson()}
                className="px-4 py-2.5 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-md shadow-orange-500/20 transition-colors"
              >
                <Copy className="w-4 h-4" />
                Copy Coach Review JSON
              </button>
            </div>
          </section>

          {/* CARD B: Apply Coach Notes Patch (Non-Destructive) */}
          <section className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 space-y-4">
            <div>
              <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-1">
                <ClipboardPaste className="w-3.5 h-3.5" />
                Card B · Surgical Notes Update (Non-Destructive)
              </div>
              <h2 className="font-display font-bold text-base sm:text-lg">
                Apply Coach Notes Patch
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Updates coaching notes &amp; target cues by `scheduleId` or `date` +
                `slot`/`workoutId` without altering workout structure, exercise lists, or program
                cycles.
              </p>
            </div>

            <textarea
              rows={5}
              value={notesPatchText}
              onChange={(e) => setNotesPatchText(e.target.value)}
              placeholder='Paste Coach Notes Patch JSON (e.g. { "upcomingSchedule": [{ "date": "2026-11-30", "slot": "Primary", "notes": "Target 18 rounds @ 2x16kg" }] })...'
              className="w-full p-3.5 rounded-2xl font-mono text-xs bg-slate-950 text-emerald-400 border border-slate-800 focus:outline-none focus:border-orange-500"
            />

            {notesPatchError && (
              <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400">
                JSON Error: {notesPatchError}
              </div>
            )}

            {notesPatchDiff && (
              <div className="p-3.5 rounded-2xl bg-emerald-500/[0.06] border border-emerald-500/25 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold text-emerald-700 dark:text-emerald-300">
                    Preview: {notesScheduledSessionsCount} scheduled session
                    {notesScheduledSessionsCount === 1 ? '' : 's'} will be updated
                    {notesTotalUpdatesCount > notesPatchDiff.scheduleNoteDiffs.length
                      ? ` (+${notesTotalUpdatesCount - notesPatchDiff.scheduleNoteDiffs.length} week/workout note cue(s))`
                      : ''}
                  </div>
                  {notesPatchDiff.structuralChangesCount > 0 && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                      {notesPatchDiff.structuralChangesCount} structural edit(s) ignored safely
                    </span>
                  )}
                </div>

                {notesPatchDiff.scheduleNoteDiffs.length > 0 && (
                  <div className="space-y-1 max-h-32 overflow-y-auto pr-1">
                    {notesPatchDiff.scheduleNoteDiffs.slice(0, 6).map((diff, idx) => (
                      <div
                        key={`${diff.scheduleItemUuid}-${idx}`}
                        className="text-[11px] p-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/70 dark:border-slate-800"
                      >
                        <div className="font-bold text-slate-800 dark:text-slate-100">
                          {diff.date} · {diff.presetName}
                        </div>
                        <div className="text-emerald-600 dark:text-emerald-400 truncate">
                          → {diff.newNote}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                disabled={!parsedNotesPatch || notesTotalUpdatesCount === 0}
                onClick={() => setApplyNotesConfirmOpen(true)}
                className="px-4 py-2.5 rounded-2xl bg-slate-900 dark:bg-orange-500 hover:opacity-95 disabled:opacity-40 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition-all"
              >
                <ClipboardPaste className="w-4 h-4" />
                Apply Notes Patch
                {notesScheduledSessionsCount > 0 ? ` (${notesScheduledSessionsCount})` : ''}
              </button>
            </div>
          </section>

          {/* CARD C: Import Full Program & Weekly Cycle from AI Coach */}
          <section className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-orange-500 mb-1">
                  <Layers className="w-3.5 h-3.5" />
                  Card C · Multi-Week Program Builder
                </div>
                <h2 className="font-display font-bold text-base sm:text-lg">
                  Import Full Program &amp; Weekly Cycle from AI Coach
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Paste JSON with `programName`, `cycleWeeks`, `weeks` rotating slots (`Primary` /
                  `Secondary`, `workoutId`, `notes`), optional `presets`, and optional `autoFill`.
                </p>
              </div>
              <button
                type="button"
                onClick={handleLoadSampleProgramJson}
                className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold hover:text-orange-500 shrink-0"
              >
                Load Sample JSON
              </button>
            </div>

            {/* Mode Selector: Create as New Program (default) vs Replace Active Program Template */}
            <div className="space-y-1.5">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Import Mode
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setProgramImportMode('create_new')}
                  className={`p-3 rounded-2xl text-left border transition-all ${
                    programImportMode === 'create_new'
                      ? 'bg-orange-500/10 border-orange-500 text-slate-900 dark:text-slate-100'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <div className="text-xs font-bold">Create as New Program</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Adds to `wt_programs` &amp; switches active without overwriting existing ones.
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setProgramImportMode('replace_active')}
                  className={`p-3 rounded-2xl text-left border transition-all ${
                    programImportMode === 'replace_active'
                      ? 'bg-orange-500/10 border-orange-500 text-slate-900 dark:text-slate-100'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                  }`}
                >
                  <div className="text-xs font-bold">Replace Active Program Template</div>
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Updates {activeProgram ? `"${activeProgram.title}"` : 'active program'}'s
                    rotating cycle in place.
                  </div>
                </button>
              </div>
            </div>

            <textarea
              rows={7}
              value={programImportText}
              onChange={(e) => setProgramImportText(e.target.value)}
              placeholder='{ "programName": "...", "cycleWeeks": 2, "weeks": [...], "presets": [...], "autoFill": { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" } }'
              className="w-full p-3.5 rounded-2xl font-mono text-xs bg-slate-950 text-emerald-400 border border-slate-800 focus:outline-none focus:border-orange-500"
            />

            {programImportError && (
              <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400">
                JSON Error: {programImportError}
              </div>
            )}

            {parsedProgramImport && (
              <div className="p-4 rounded-2xl bg-orange-500/[0.06] border border-orange-500/30 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-xs font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider">
                    Program Preview · {parsedProgramImport.programName}
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-900/10 dark:bg-white/10">
                    Auto-saves safety snapshot before import
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <strong>{parsedProgramImport.cycleWeeks}</strong> Week Cycle
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <strong>{parsedProgramImport.totalSlots}</strong> Template Slot(s)
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                    <strong>{parsedProgramImport.presets.length}</strong> New Preset(s)
                  </div>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 truncate">
                    {parsedProgramImport.autoFill
                      ? `Auto-Fill: ${parsedProgramImport.autoFill.startDate}`
                      : 'No Auto-Fill'}
                  </div>
                </div>

                {parsedProgramImport.unresolvedWorkoutRefs.length > 0 && (
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-700 dark:text-amber-300 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      Unrecognized workout ID(s):{' '}
                      <strong>{parsedProgramImport.unresolvedWorkoutRefs.join(', ')}</strong>. Make
                      sure they match your `workoutDirectory` or are defined in `presets`.
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                disabled={!parsedProgramImport}
                onClick={handleImportProgramCycle}
                className="px-5 py-2.5 rounded-2xl bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-md shadow-orange-500/20 transition-colors"
              >
                <Upload className="w-4 h-4" />
                Import Program &amp; Cycle
              </button>
            </div>
          </section>
        </div>
      )}

      <div className="pt-2 pb-4 text-center text-[11px] font-mono text-[var(--text-muted)]">
        Build: {__APP_BUILD__} ({__APP_BUILD_TIME__})
      </div>

      {/* Portaled Confirmation Modal: Restore Safety Snapshot */}
      <ModalPortal
        open={restoreSnapshotConfirmOpen && Boolean(safetySnapshotMeta)}
        onClose={() => !isRestoringSnapshot && setRestoreSnapshotConfirmOpen(false)}
        tier="primary"
      >
        {safetySnapshotMeta && (
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-5 h-5 text-orange-500 shrink-0" />
                <h3 className="font-display font-bold text-base">Restore Safety Snapshot?</h3>
              </div>
              <button
                type="button"
                disabled={isRestoringSnapshot}
                onClick={() => setRestoreSnapshotConfirmOpen(false)}
                aria-label="Close restore confirmation"
                className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              This will restore your schedule ({safetySnapshotMeta.scheduleDaysCount} days), workout
              logs ({safetySnapshotMeta.logsCount}), programs ({safetySnapshotMeta.programsCount}),
              and mitigating factors ({safetySnapshotMeta.contextCount}) back to the automatic
              snapshot saved on{' '}
              <strong>{formatSnapshotTimestamp(safetySnapshotMeta.timestamp)}</strong> (before{' '}
              <strong>{safetySnapshotMeta.reason}</strong>).
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={isRestoringSnapshot}
                onClick={() => setRestoreSnapshotConfirmOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isRestoringSnapshot}
                onClick={async () => {
                  setIsRestoringSnapshot(true);
                  const res = await restoreSafetySnapshot();
                  setIsRestoringSnapshot(false);
                  setRestoreSnapshotConfirmOpen(false);
                  if (res.ok) {
                    showNotice(
                      `Restored safety snapshot from ${formatSnapshotTimestamp(
                        res.timestamp || safetySnapshotMeta.timestamp
                      )}`
                    );
                  } else {
                    showNotice(res.error || 'Failed to restore safety snapshot');
                  }
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white shadow-sm disabled:opacity-50"
              >
                {isRestoringSnapshot ? 'Restoring...' : 'Restore Snapshot'}
              </button>
            </div>
          </div>
        )}
      </ModalPortal>

      {/* Portaled Confirmation Modal: Apply Coach Notes Patch */}
      <ModalPortal
        open={applyNotesConfirmOpen && Boolean(notesPatchDiff)}
        onClose={() => !isApplyingNotes && setApplyNotesConfirmOpen(false)}
        tier="primary"
      >
        {notesPatchDiff && (
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <ClipboardPaste className="w-5 h-5 text-emerald-500 shrink-0" />
                <h3 className="font-display font-bold text-base">Apply Coach Notes Patch?</h3>
              </div>
              <button
                type="button"
                disabled={isApplyingNotes}
                onClick={() => setApplyNotesConfirmOpen(false)}
                aria-label="Close apply notes confirmation"
                className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
              This will surgically update notes on{' '}
              <strong>
                {notesScheduledSessionsCount} scheduled session
                {notesScheduledSessionsCount === 1 ? '' : 's'}
              </strong>
              {notesPatchDiff.programWeekDiffs.length > 0
                ? `, ${notesPatchDiff.programWeekDiffs.length} week focus note(s)`
                : ''}
              {notesPatchDiff.presetNoteDiffs.length + notesPatchDiff.exerciseNoteDiffs.length > 0
                ? `, and ${
                    notesPatchDiff.presetNoteDiffs.length +
                    notesPatchDiff.exerciseNoteDiffs.length
                  } preset/exercise cue(s)`
                : ''}
              . Workout structure, exercise lists, and program cycles will remain untouched.
            </p>

            <div className="flex justify-end gap-2">
              <button
                type="button"
                disabled={isApplyingNotes}
                onClick={() => setApplyNotesConfirmOpen(false)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isApplyingNotes}
                onClick={() => void handleConfirmApplyNotesPatch()}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white shadow-sm disabled:opacity-50"
              >
                {isApplyingNotes ? 'Applying...' : 'Confirm & Apply Notes'}
              </button>
            </div>
          </div>
        )}
      </ModalPortal>
    </div>
  );
};

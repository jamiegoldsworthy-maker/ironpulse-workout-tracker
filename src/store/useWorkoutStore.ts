import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  AIImportPayload,
  DailySchedule,
  DistanceUnit,
  GhostExerciseData,
  GlobalExercise,
  LogStatus,
  LoggedExercise,
  PresetExercise,
  ScheduledItem,
  SetEntry,
  ThemeMode,
  UserMeta,
  WorkoutLog,
  WorkoutPreset,
  WorkoutProgram,
} from '../types/workout';
import {
  SEED_EXERCISES,
  SEED_LOGS,
  SEED_META,
  SEED_PRESETS,
  SEED_PROGRAMS,
  SEED_SCHEDULES,
} from '../data/seedData';
import {
  expandLadderSequence,
  formatDisplayId,
  getTodayIsoDate,
  recalculateLoggedExercise,
  shiftIsoDate,
  slugify,
  uuidv4,
} from '../utils/calculations';
import {
  pullAllUserCollections,
  pushAllLocalDataToFirestore,
  removeFirestoreDoc,
  subscribeToUserCollections,
  upsertFirestoreDoc,
} from '../services/firebase';

export interface DraftWorkoutCard extends WorkoutLog {
  isSaved: boolean;
  coachNotes?: string;
  slotRole?: string;
  updatePresetOnSave?: boolean;
}

export interface LiveTimerState {
  isOpen: boolean;
  isExpanded: boolean;
  isRunning: boolean;
  mode: 'rest' | 'circuit';
  phase: 'work' | 'rest';
  remainingSec: number;
  totalPhaseSec: number;
  currentRound: number;
  totalRounds: number;
  workSec: number;
  restSec: number;
}

interface WorkoutStoreState {
  exercises: GlobalExercise[];
  presets: WorkoutPreset[];
  programs: WorkoutProgram[];
  schedules: Record<string, DailySchedule>;
  logs: WorkoutLog[];
  meta: UserMeta;

  // Auth & Sync state
  authUser: { uid: string; email: string | null; displayName: string | null; photoURL: string | null } | null;
  syncStatus: 'local' | 'syncing' | 'synced' | 'error';
  lastSyncError?: string;
  hasSeeded: boolean;
  hasCompletedCloudBootstrap: boolean;

  // Active Navigation & Log Floor state
  activeTab: 'log' | 'plan' | 'library' | 'history' | 'settings';
  viewportMode: 'auto' | 'mobile' | 'desktop';
  logLayoutMode: 'list' | 'cards';
  logDensityMode: 'compact' | 'detailed';
  activeDate: string;
  activeSessionGroupUuid: string;
  draftWorkouts: DraftWorkoutCard[];

  // Live Timer
  timer: LiveTimerState;

  // Navigation & Theme
  setActiveTab: (tab: 'log' | 'plan' | 'library' | 'history' | 'settings') => void;
  setViewportMode: (mode: 'auto' | 'mobile' | 'desktop') => void;
  setLogLayoutMode: (mode: 'list' | 'cards') => void;
  setLogDensityMode: (mode: 'compact' | 'detailed') => void;
  clearSyncError: () => void;
  setTheme: (theme: ThemeMode) => void;
  setDefaultAutoStartRestTimer: (enabled: boolean) => void;
  setDefaultDistanceUnit: (unit: DistanceUnit) => void;
  setActiveProgram: (programUuid: string) => void;

  // Date & Gym Floor Session Actions
  setActiveDate: (date: string) => void;
  loadProgrammedForDate: (date?: string) => number;
  addWorkoutToSession: (
    presetUuid: string,
    options?: {
      replaceDraftLogUuid?: string;
      scheduleItemUuid?: string;
      coachNotes?: string;
      slotRole?: string;
    }
  ) => void;
  updateDraftWorkout: (
    logUuid: string,
    updater: (draft: DraftWorkoutCard) => DraftWorkoutCard
  ) => void;
  removeDraftWorkout: (logUuid: string) => void;
  saveDraftWorkout: (
    logUuid: string,
    status?: 'completed' | 'did_not_complete',
    alsoUpdatePreset?: boolean
  ) => Promise<{ ok: boolean; error?: string }>;
  syncDraftToFirestore: (logUuid: string) => Promise<{ ok: boolean; error?: string }>;
  saveAllDraftWorkouts: () => Promise<void>;

  // Ghost Text & History Lookup
  getGhostExerciseData: (
    presetUuid: string,
    exerciseUuid: string,
    excludeLogUuid?: string
  ) => GhostExerciseData | null;
  getExerciseHistory: (
    exerciseUuid: string,
    limit?: number
  ) => Array<{
    logUuid: string;
    displayId: string;
    date: string;
    workoutTitle: string;
    presetUuid: string;
    exercise: LoggedExercise;
    sessionNotes?: string;
  }>;

  // Timer Actions
  startRestTimer: (seconds: number) => void;
  startCircuitTimer: (rounds: number, workSec: number, restSec: number) => void;
  setTimerRounds: (rounds: number) => void;
  toggleTimerRunning: () => void;
  resetTimer: () => void;
  setTimerExpanded: (expanded: boolean) => void;
  closeTimer: () => void;
  tickTimer: () => { phaseChanged: boolean; finished: boolean; nextPhase?: 'work' | 'rest' };

  // Preset & Exercise CRUD
  upsertPreset: (preset: WorkoutPreset) => void;
  duplicatePreset: (presetUuid: string) => WorkoutPreset | null;
  deletePreset: (presetUuid: string) => void;
  upsertGlobalExercise: (exercise: GlobalExercise) => void;

  // Program & Schedule CRUD + Auto-Fill
  upsertProgram: (program: WorkoutProgram) => void;
  deleteProgram: (programUuid: string) => void;
  updateDailySchedule: (date: string, items: ScheduledItem[]) => void;
  addScheduledItemToDate: (
    date: string,
    presetUuid: string,
    slotRole?: string,
    coachNotes?: string,
    programUuid?: string
  ) => void;
  removeScheduledItemFromDate: (date: string, scheduleItemUuid: string) => void;
  autoFillSchedule: (
    programUuid: string,
    startDate: string,
    endDate: string,
    conflictMode: 'replace' | 'update_matching' | 'skip'
  ) => { daysModified: number; itemsCreated: number };

  // History Log Management
  deleteWorkoutLog: (logUuid: string) => Promise<void>;
  deleteLog: (logUuid: string) => Promise<void>;

  // Bulk Imports (AI JSON & Reconciled Legacy Google Sheet)
  applyAiImportPayload: (payload: AIImportPayload) => {
    presetsCount: number;
    programsCount: number;
    scheduleDaysCount: number;
  };
  commitReconciledLegacyImport: (payload: {
    newExercises: GlobalExercise[];
    newPresets: WorkoutPreset[];
    newLogs: WorkoutLog[];
  }) => void;

  // Firebase Sync
  setAuthUser: (
    user: { uid: string; email: string | null; displayName: string | null; photoURL: string | null } | null
  ) => void;
  startRealtimeSync: (uid: string) => () => void;
  syncWithFirestore: () => Promise<void>;
  pushLocalToCloud: () => Promise<{ ok: boolean; pushedLogs: number; error?: string }>;
  resetToDemoSeed: () => void;
}

function buildLoggedExerciseFromPreset(
  pe: PresetExercise,
  defaultDistanceUnit: DistanceUnit,
  presetFormatMode?: 'standard' | 'circuit' | 'emom_complex',
  presetRounds?: number
): LoggedExercise {
  const effectiveRounds = presetRounds || Number(pe.defaultSets) || 3;
  const numSets =
    presetFormatMode === 'circuit'
      ? effectiveRounds
      : presetFormatMode === 'emom_complex'
      ? 0
      : Math.max(1, Number(pe.defaultSets) || 3);
  const parsedDefaultRep = parseInt(String(pe.defaultReps).replace(/[^0-9]/g, ''), 10) || 0;
  const sets: SetEntry[] =
    pe.trackingType === 'cardio' || numSets === 0
      ? []
      : Array.from({ length: numSets }, (_, idx) => ({
          setNumber: idx + 1,
          reps: 0, // Starts empty so Ghost Text shows cleanly in the input placeholder!
        }));

  const base: LoggedExercise = {
    exerciseUuid: pe.exerciseUuid,
    exerciseName: pe.exerciseName,
    category: pe.category || 'General',
    trackingType: pe.trackingType,
    loadType: pe.loadType,
    weight: Number(pe.defaultWeight) || 0,
    side: pe.side,
    isPerSide: pe.isPerSide,
    repScheme: pe.repScheme,
    repsPerRound: parsedDefaultRep || 1,
    targetRepsLabel: pe.defaultReps,
    sets,
    totalSets: 0,
    totalReps: 0,
    totalLoadKg: 0,
    roundsCompleted: pe.trackingType === 'circuit' ? effectiveRounds : undefined,
    workSecPerRound: pe.trackingType === 'circuit' ? 45 : undefined,
    restSecPerRound: pe.trackingType === 'circuit' ? 15 : undefined,
    totalDurationSec: pe.trackingType === 'circuit' ? effectiveRounds * 60 : undefined,
    mode: pe.cardioMode || (pe.trackingType === 'cardio' ? 'Ruck' : undefined),
    distanceUnit: pe.defaultDistanceUnit || defaultDistanceUnit || 'mi',
    ruckLoadKg: pe.loadType === 'ruck_kg' ? Number(pe.defaultWeight) || 20 : undefined,
    exerciseNotes:
      pe.baseNotes || (parsedDefaultRep ? `Target: ${effectiveRounds}x${pe.defaultReps}` : ''),
  };

  return recalculateLoggedExercise(base);
}

function createDraftFromPreset(
  preset: WorkoutPreset,
  date: string,
  sessionGroupUuid: string,
  chainOrderIndex: number,
  seqNumber: number,
  defaultDistanceUnit: DistanceUnit,
  options?: {
    scheduleItemUuid?: string;
    programUuid?: string;
    coachNotes?: string;
    slotRole?: string;
  }
): DraftWorkoutCard {
  const now = new Date().toISOString();
  const formatMode =
    preset.formatMode ||
    (preset.defaultTimer?.mode === 'circuit'
      ? preset.defaultTimer.restSec === 0
        ? 'emom_complex'
        : 'circuit'
      : 'standard');
  const ladderEx = preset.exercises.find(
    (e) => e.repScheme && e.repScheme.schemeType !== 'fixed'
  );
  const ladderRungCount = ladderEx
    ? expandLadderSequence(
        ladderEx.repScheme!.ladderStart ?? 10,
        ladderEx.repScheme!.ladderEnd ?? 1,
        ladderEx.repScheme!.ladderStep ?? 1,
        ladderEx.repScheme!.schemeType
      ).length
    : undefined;

  const targetRounds =
    formatMode !== 'standard'
      ? preset.defaultTimer?.rounds || ladderRungCount || preset.exercises[0]?.defaultSets || 10
      : ladderRungCount;

  const exercises = preset.exercises.map((pe) =>
    buildLoggedExerciseFromPreset(pe, defaultDistanceUnit, formatMode, targetRounds)
  );
  return {
    logUuid: `log-${uuidv4()}`,
    displayId: formatDisplayId(seqNumber),
    sessionGroupUuid,
    chainOrderIndex,
    date,
    presetUuid: preset.presetUuid,
    workoutTitleSnapshot: preset.title,
    workoutType: preset.workoutType,
    formatMode,
    targetRounds,
    completedRounds: formatMode === 'emom_complex' ? 0 : undefined,
    programUuid: options?.programUuid || preset.programIds?.[0],
    scheduleItemUuid: options?.scheduleItemUuid,
    status: 'in_progress',
    sessionNotes: '',
    totalSessionVolumeKg: 0,
    exerciseUuids: exercises.map((e) => e.exerciseUuid),
    exercises,
    createdAt: now,
    updatedAt: now,
    isSaved: false,
    coachNotes: options?.coachNotes,
    slotRole: options?.slotRole || (chainOrderIndex === 0 ? 'Primary' : `Chained #${chainOrderIndex + 1}`),
    updatePresetOnSave: false,
  };
}

function buildInitialDraftsForDate(
  date: string,
  logs: WorkoutLog[],
  schedules: Record<string, DailySchedule>,
  presets: WorkoutPreset[],
  meta: UserMeta
): { sessionGroupUuid: string; drafts: DraftWorkoutCard[] } {
  const existingLogsForDate = logs
    .filter((l) => l.date === date)
    .sort((a, b) => (a.chainOrderIndex ?? 0) - (b.chainOrderIndex ?? 0));

  if (existingLogsForDate.length > 0) {
    const groupUuid = existingLogsForDate[0].sessionGroupUuid || `ses-${uuidv4()}`;
    const daySchedule = schedules[date];
    const drafts: DraftWorkoutCard[] = existingLogsForDate.map((l, idx) => {
      const linkedSched = daySchedule?.items.find(
        (it) => it.linkedLogUuid === l.logUuid || it.scheduleItemUuid === l.scheduleItemUuid
      );
      return {
        ...JSON.parse(JSON.stringify(l)),
        isSaved: l.status === 'completed' || l.status === 'did_not_complete',
        coachNotes: linkedSched?.coachNotes,
        slotRole: linkedSched?.slotRole || (idx === 0 ? 'Primary' : `Chained #${idx + 1}`),
        updatePresetOnSave: false,
      };
    });
    return { sessionGroupUuid: groupUuid, drafts };
  }

  // If no logs exist for this date, check if there are scheduled items for today
  const daySchedule = schedules[date];
  const groupUuid = `ses-${uuidv4()}`;
  if (daySchedule && daySchedule.items.length > 0) {
    let seq = meta.nextLogSequenceNumber;
    const drafts: DraftWorkoutCard[] = [];
    daySchedule.items
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .forEach((item, idx) => {
        if (item.status === 'skipped') return;
        const preset = presets.find((p) => p.presetUuid === item.presetUuid);
        if (preset) {
          drafts.push(
            createDraftFromPreset(preset, date, groupUuid, idx, seq++, meta.defaultDistanceUnit, {
              scheduleItemUuid: item.scheduleItemUuid,
              programUuid: item.programUuid,
              coachNotes: item.coachNotes,
              slotRole: item.slotRole,
            })
          );
        }
      });
    return { sessionGroupUuid: groupUuid, drafts };
  }

  return { sessionGroupUuid: groupUuid, drafts: [] };
}

const pendingDraftSyncTimers: Record<string, ReturnType<typeof setTimeout>> = {};
const pendingDraftLogUuids = new Set<string>();

function clearPendingDraftSync(logUuid: string) {
  if (pendingDraftSyncTimers[logUuid]) {
    clearTimeout(pendingDraftSyncTimers[logUuid]);
    delete pendingDraftSyncTimers[logUuid];
  }
  pendingDraftLogUuids.delete(logUuid);
}

function isUserActivelyTyping(): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName?.toUpperCase();
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

function draftToWorkoutLog(
  draft: DraftWorkoutCard,
  uid: string,
  fallbackIdx = 0
): WorkoutLog {
  const now = new Date().toISOString();
  const recalcedExercises = draft.exercises.map((ex) => recalculateLoggedExercise(ex));
  const totalSessionVolumeKg =
    Math.round(
      recalcedExercises.reduce((acc, ex) => acc + (Number(ex.totalLoadKg) || 0), 0) * 10
    ) / 10;

  const effectiveStatus: LogStatus = draft.isSaved
    ? draft.status === 'did_not_complete'
      ? 'did_not_complete'
      : 'completed'
    : 'in_progress';

  return {
    logUuid: draft.logUuid,
    uid,
    displayId: draft.displayId,
    legacyId: draft.legacyId,
    sessionGroupUuid: draft.sessionGroupUuid,
    chainOrderIndex: draft.chainOrderIndex ?? fallbackIdx,
    date: draft.date,
    presetUuid: draft.presetUuid,
    workoutTitleSnapshot: draft.workoutTitleSnapshot,
    workoutType: draft.workoutType,
    formatMode: draft.formatMode,
    targetRounds: draft.targetRounds,
    completedRounds: draft.completedRounds,
    laddersCompleted: draft.laddersCompleted,
    extraRungs: draft.extraRungs,
    programUuid: draft.programUuid,
    scheduleItemUuid: draft.scheduleItemUuid,
    status: effectiveStatus,
    sessionNotes: draft.sessionNotes,
    totalSessionVolumeKg,
    durationSec: draft.durationSec,
    exerciseUuids: recalcedExercises.map((e) => e.exerciseUuid),
    exercises: recalcedExercises,
    createdAt: draft.createdAt || now,
    updatedAt: draft.updatedAt || now,
  };
}

function upsertLogInArray(logs: WorkoutLog[], record: WorkoutLog): WorkoutLog[] {
  const idx = logs.findIndex((l) => l.logUuid === record.logUuid);
  if (idx === -1) return [record, ...logs];
  return logs.map((l, i) => (i === idx ? record : l));
}

const EMPTY_SESSION_UUID = 'ses-initial';

export const useWorkoutStore = create<WorkoutStoreState>()(
  persist(
    (set, get) => ({
      exercises: [],
      presets: [],
      programs: [],
      schedules: {},
      logs: [],
      meta: SEED_META,

      authUser: null,
      syncStatus: 'local',
      hasSeeded: false,
      hasCompletedCloudBootstrap: false,

      activeTab: 'log',
      viewportMode: 'auto',
      logLayoutMode: 'list',
      logDensityMode: 'detailed',
      activeDate: getTodayIsoDate(),
      activeSessionGroupUuid: EMPTY_SESSION_UUID,
      draftWorkouts: [],

      timer: {
        isOpen: true,
        isExpanded: false,
        isRunning: false,
        mode: 'rest',
        phase: 'work',
        remainingSec: 60,
        totalPhaseSec: 60,
        currentRound: 1,
        totalRounds: 10,
        workSec: 60,
        restSec: 0,
      },

      setActiveTab: (tab) => set({ activeTab: tab }),
      setViewportMode: (mode) => set({ viewportMode: mode }),
      setLogLayoutMode: (mode) => set({ logLayoutMode: mode }),
      setLogDensityMode: (mode) => set({ logDensityMode: mode }),
      clearSyncError: () => set({ lastSyncError: undefined, syncStatus: get().authUser ? 'synced' : 'local' }),

      setTheme: (theme) => {
        const nextMeta = { ...get().meta, theme, updatedAt: new Date().toISOString() };
        set({ meta: nextMeta });
        if (get().authUser) {
          upsertFirestoreDoc('wt_meta', get().authUser!.uid, nextMeta, get().authUser!.uid).catch((err) => {
            console.error('[Sync] Failed to save theme to Firestore:', err);
            set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to sync preferences' });
          });
        }
      },

      setDefaultAutoStartRestTimer: (enabled) => {
        const nextMeta = {
          ...get().meta,
          defaultAutoStartRestTimer: enabled,
          updatedAt: new Date().toISOString(),
        };
        set({ meta: nextMeta });
        if (get().authUser) {
          upsertFirestoreDoc('wt_meta', get().authUser!.uid, nextMeta, get().authUser!.uid).catch((err) => {
            console.error('[Sync] Failed to save timer pref to Firestore:', err);
            set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to sync preferences' });
          });
        }
      },

      setDefaultDistanceUnit: (unit) => {
        const nextMeta = {
          ...get().meta,
          defaultDistanceUnit: unit,
          updatedAt: new Date().toISOString(),
        };
        set({ meta: nextMeta });
        if (get().authUser) {
          upsertFirestoreDoc('wt_meta', get().authUser!.uid, nextMeta, get().authUser!.uid).catch((err) => {
            console.error('[Sync] Failed to save distance unit to Firestore:', err);
            set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to sync preferences' });
          });
        }
      },

      setActiveProgram: (programUuid) => {
        const nextMeta = {
          ...get().meta,
          activeProgramUuid: programUuid,
          updatedAt: new Date().toISOString(),
        };
        set({ meta: nextMeta });
        if (get().authUser) {
          upsertFirestoreDoc('wt_meta', get().authUser!.uid, nextMeta, get().authUser!.uid).catch((err) => {
            console.error('[Sync] Failed to save active program to Firestore:', err);
            set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to sync active program' });
          });
        }
      },

      setActiveDate: (date) => {
        const state = get();
        const { sessionGroupUuid, drafts } = buildInitialDraftsForDate(
          date,
          state.logs,
          state.schedules,
          state.presets,
          state.meta
        );
        const primaryPreset = drafts[0]
          ? state.presets.find((p) => p.presetUuid === drafts[0].presetUuid)
          : undefined;
        let nextTimer = state.timer;
        if (!state.timer.isRunning && primaryPreset?.defaultTimer) {
          if (primaryPreset.defaultTimer.mode === 'circuit') {
            const w = primaryPreset.defaultTimer.workSec ?? 60;
            const r = primaryPreset.defaultTimer.restSec ?? 0;
            const rnd = primaryPreset.defaultTimer.rounds ?? 10;
            nextTimer = {
              ...state.timer,
              isOpen: true,
              mode: 'circuit',
              phase: 'work',
              workSec: w,
              restSec: r,
              totalRounds: rnd,
              currentRound: 1,
              remainingSec: w,
              totalPhaseSec: w,
            };
          } else {
            const r = Number(primaryPreset.defaultTimer.restSec ?? 0);
            if (r > 0) {
              nextTimer = {
                ...state.timer,
                isOpen: true,
                mode: 'rest',
                remainingSec: r,
                totalPhaseSec: r,
              };
            }
          }
        }

        set({
          activeDate: date,
          activeSessionGroupUuid: sessionGroupUuid,
          draftWorkouts: drafts,
          timer: nextTimer,
        });
      },

      loadProgrammedForDate: (targetDate) => {
        const state = get();
        const date = targetDate || state.activeDate;
        const daySchedule = state.schedules[date];
        if (!daySchedule || daySchedule.items.length === 0) return 0;

        const existingScheduleIds = new Set(
          state.draftWorkouts.map((d) => d.scheduleItemUuid).filter(Boolean)
        );
        let seq = state.meta.nextLogSequenceNumber + state.draftWorkouts.filter((d) => !d.isSaved).length;
        const addedDrafts: DraftWorkoutCard[] = [];

        daySchedule.items
          .slice()
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .forEach((item) => {
            if (existingScheduleIds.has(item.scheduleItemUuid)) return;
            const preset = state.presets.find((p) => p.presetUuid === item.presetUuid);
            if (!preset) return;
            addedDrafts.push(
              createDraftFromPreset(
                preset,
                date,
                state.activeSessionGroupUuid,
                state.draftWorkouts.length + addedDrafts.length,
                seq++,
                state.meta.defaultDistanceUnit,
                {
                  scheduleItemUuid: item.scheduleItemUuid,
                  programUuid: item.programUuid,
                  coachNotes: item.coachNotes,
                  slotRole: item.slotRole,
                }
              )
            );
          });

        if (addedDrafts.length > 0) {
          const primaryPreset = state.presets.find(
            (p) => p.presetUuid === addedDrafts[0].presetUuid
          );
          let nextTimer = state.timer;
          if (!state.timer.isRunning && primaryPreset?.defaultTimer) {
            if (primaryPreset.defaultTimer.mode === 'circuit') {
              const w = primaryPreset.defaultTimer.workSec ?? 60;
              const r = primaryPreset.defaultTimer.restSec ?? 0;
              const rnd = primaryPreset.defaultTimer.rounds ?? 10;
              nextTimer = {
                ...state.timer,
                isOpen: true,
                mode: 'circuit',
                phase: 'work',
                workSec: w,
                restSec: r,
                totalRounds: rnd,
                currentRound: 1,
                remainingSec: w,
                totalPhaseSec: w,
              };
            } else {
              const r = Number(primaryPreset.defaultTimer.restSec ?? 0);
              if (r > 0) {
                nextTimer = {
                  ...state.timer,
                  isOpen: true,
                  mode: 'rest',
                  remainingSec: r,
                  totalPhaseSec: r,
                };
              }
            }
          }

          let nextLogs = state.logs;
          const uid = state.authUser?.uid || state.meta.uid;
          const newRecords = addedDrafts.map((d, i) =>
            draftToWorkoutLog(d, uid, state.draftWorkouts.length + i)
          );
          for (const rec of newRecords) {
            nextLogs = upsertLogInArray(nextLogs, rec);
          }

          set({
            activeDate: date,
            draftWorkouts: [...state.draftWorkouts, ...addedDrafts],
            logs: nextLogs,
            timer: nextTimer,
          });

          if (state.authUser) {
            const authUid = state.authUser.uid;
            set({ syncStatus: 'syncing', lastSyncError: undefined });
            Promise.all(
              newRecords.map((rec) => upsertFirestoreDoc('wt_logs', rec.logUuid, rec, authUid))
            )
              .then(() => {
                set({ syncStatus: 'synced', lastSyncError: undefined });
              })
              .catch((err) => {
                console.error('[Sync] Failed to upsert started scheduled workout(s):', err);
                set({
                  syncStatus: 'error',
                  lastSyncError: err?.message || 'Failed to sync started workout',
                });
              });
          }
        }
        return addedDrafts.length;
      },

      addWorkoutToSession: (presetUuid, options) => {
        const state = get();
        const preset = state.presets.find((p) => p.presetUuid === presetUuid);
        if (!preset) return;

        // Configure timer default if preset defines one
        if (preset.defaultTimer) {
          if (preset.defaultTimer.mode === 'circuit') {
            const w = preset.defaultTimer.workSec ?? 60;
            const r = preset.defaultTimer.restSec ?? 0;
            const rnd = preset.defaultTimer.rounds ?? 10;
            set({
              timer: {
                ...state.timer,
                isOpen: true,
                mode: 'circuit',
                phase: 'work',
                workSec: w,
                restSec: r,
                totalRounds: rnd,
                currentRound: 1,
                remainingSec: w,
                totalPhaseSec: w,
                isRunning: false,
              },
            });
          } else {
            const r = Number(preset.defaultTimer.restSec ?? 0);
            if (r > 0) {
              set({
                timer: {
                  ...state.timer,
                  isOpen: true,
                  mode: 'rest',
                  remainingSec: r,
                  totalPhaseSec: r,
                  isRunning: false,
                },
              });
            }
          }
        }

        if (options?.replaceDraftLogUuid) {
          const idx = state.draftWorkouts.findIndex(
            (d) => d.logUuid === options.replaceDraftLogUuid
          );
          if (idx !== -1) {
            const existing = state.draftWorkouts[idx];
            const replacement = createDraftFromPreset(
              preset,
              state.activeDate,
              state.activeSessionGroupUuid,
              existing.chainOrderIndex ?? idx,
              parseInt(existing.displayId.replace('ID-', ''), 10) || state.meta.nextLogSequenceNumber,
              state.meta.defaultDistanceUnit,
              {
                scheduleItemUuid: existing.scheduleItemUuid,
                programUuid: preset.programIds?.[0] || state.meta.activeProgramUuid,
                coachNotes: options.coachNotes ?? existing.coachNotes,
                slotRole: options.slotRole ?? existing.slotRole,
              }
            );
            replacement.logUuid = existing.logUuid;
            replacement.displayId = existing.displayId;
            const nextDrafts = [...state.draftWorkouts];
            nextDrafts[idx] = replacement;
            const uid = state.authUser?.uid || state.meta.uid;
            const logRecord = draftToWorkoutLog(replacement, uid, idx);
            set({
              draftWorkouts: nextDrafts,
              logs: upsertLogInArray(state.logs, logRecord),
            });
            if (state.authUser) {
              clearPendingDraftSync(logRecord.logUuid);
              set({ syncStatus: 'syncing', lastSyncError: undefined });
              upsertFirestoreDoc('wt_logs', logRecord.logUuid, logRecord, state.authUser.uid)
                .then(() => set({ syncStatus: 'synced', lastSyncError: undefined }))
                .catch((err) => {
                  console.error('[Sync] Failed to upsert swapped workout to Firestore:', err);
                  set({
                    syncStatus: 'error',
                    lastSyncError: err?.message || 'Failed to sync swapped workout',
                  });
                });
            }
            return;
          }
        }

        const unsavedCount = state.draftWorkouts.filter((d) => !d.isSaved).length;
        const seq = state.meta.nextLogSequenceNumber + unsavedCount;
        const newDraft = createDraftFromPreset(
          preset,
          state.activeDate,
          state.activeSessionGroupUuid,
          state.draftWorkouts.length,
          seq,
          state.meta.defaultDistanceUnit,
          {
            scheduleItemUuid: options?.scheduleItemUuid,
            programUuid: preset.programIds?.[0] || state.meta.activeProgramUuid,
            coachNotes: options?.coachNotes,
            slotRole:
              options?.slotRole ||
              (state.draftWorkouts.length === 0 ? 'Primary' : `Chained #${state.draftWorkouts.length + 1}`),
          }
        );

        const uid = state.authUser?.uid || state.meta.uid;
        const logRecord = draftToWorkoutLog(newDraft, uid, state.draftWorkouts.length);
        set({
          draftWorkouts: [...state.draftWorkouts, newDraft],
          logs: upsertLogInArray(state.logs, logRecord),
        });
        if (state.authUser) {
          clearPendingDraftSync(logRecord.logUuid);
          set({ syncStatus: 'syncing', lastSyncError: undefined });
          upsertFirestoreDoc('wt_logs', logRecord.logUuid, logRecord, state.authUser.uid)
            .then(() => set({ syncStatus: 'synced', lastSyncError: undefined }))
            .catch((err) => {
              console.error('[Sync] Failed to upsert new workout to Firestore:', err);
              set({
                syncStatus: 'error',
                lastSyncError: err?.message || 'Failed to sync started workout',
              });
            });
        }
      },

      syncDraftToFirestore: async (logUuid) => {
        clearPendingDraftSync(logUuid);
        const state = get();
        const draftIdx = state.draftWorkouts.findIndex((d) => d.logUuid === logUuid);
        if (draftIdx === -1) return { ok: true };

        const draft = state.draftWorkouts[draftIdx];
        const uid = state.authUser?.uid || state.meta.uid;
        const logRecord = draftToWorkoutLog(draft, uid, draftIdx);

        set({
          logs: upsertLogInArray(get().logs, logRecord),
        });

        if (!state.authUser) return { ok: true };

        set({ syncStatus: 'syncing', lastSyncError: undefined });
        try {
          await upsertFirestoreDoc('wt_logs', logRecord.logUuid, logRecord, state.authUser.uid);
          set({ syncStatus: 'synced', lastSyncError: undefined });
          return { ok: true };
        } catch (err: any) {
          const msg = err?.message || 'Failed to sync in-progress workout';
          console.error('[Sync] Debounced draft upsert failed:', err);
          set({ syncStatus: 'error', lastSyncError: msg });
          return { ok: false, error: msg };
        }
      },

      updateDraftWorkout: (logUuid, updater) => {
        const state = get();
        let updatedRecord: WorkoutLog | null = null;
        const uid = state.authUser?.uid || state.meta.uid;
        const nextDrafts = state.draftWorkouts.map((d, idx) => {
          if (d.logUuid !== logUuid) return d;
          const updated = updater(d);
          const recalcedExercises = updated.exercises.map((ex) => recalculateLoggedExercise(ex));
          const totalSessionVolumeKg = recalcedExercises.reduce(
            (acc, ex) => acc + (Number(ex.totalLoadKg) || 0),
            0
          );
          const nextDraft: DraftWorkoutCard = {
            ...updated,
            status: updated.isSaved ? updated.status : 'in_progress',
            exercises: recalcedExercises,
            exerciseUuids: recalcedExercises.map((e) => e.exerciseUuid),
            totalSessionVolumeKg: Math.round(totalSessionVolumeKg * 10) / 10,
            updatedAt: new Date().toISOString(),
          };
          updatedRecord = draftToWorkoutLog(nextDraft, uid, idx);
          return nextDraft;
        });

        set({
          draftWorkouts: nextDrafts,
          ...(updatedRecord ? { logs: upsertLogInArray(state.logs, updatedRecord) } : {}),
        });

        // Debounce live Firestore sync (~1.5s after user stops editing sets/reps/weights)
        if (updatedRecord) {
          if (pendingDraftSyncTimers[logUuid]) {
            clearTimeout(pendingDraftSyncTimers[logUuid]);
          }
          pendingDraftLogUuids.add(logUuid);
          pendingDraftSyncTimers[logUuid] = setTimeout(() => {
            delete pendingDraftSyncTimers[logUuid];
            get().syncDraftToFirestore(logUuid);
          }, 1500);
        }
      },

      removeDraftWorkout: (logUuid) => {
        clearPendingDraftSync(logUuid);
        const state = get();
        const target = state.draftWorkouts.find((d) => d.logUuid === logUuid);
        const nextDrafts = state.draftWorkouts.filter((d) => d.logUuid !== logUuid);
        const nextLogs = state.logs.filter((l) => l.logUuid !== logUuid);

        const nextSchedules = { ...state.schedules };
        if (target?.scheduleItemUuid && nextSchedules[state.activeDate]) {
          const daySched = nextSchedules[state.activeDate];
          nextSchedules[state.activeDate] = {
            ...daySched,
            items: daySched.items.map((it) =>
              it.scheduleItemUuid === target.scheduleItemUuid
                ? { ...it, status: 'skipped', linkedLogUuid: null }
                : it
            ),
            updatedAt: new Date().toISOString(),
          };
        }

        set({
          draftWorkouts: nextDrafts,
          logs: nextLogs,
          schedules: nextSchedules,
        });

        if (state.authUser) {
          const uid = state.authUser.uid;
          set({ syncStatus: 'syncing', lastSyncError: undefined });
          const ops: Promise<void>[] = [removeFirestoreDoc('wt_logs', logUuid)];
          if (target?.scheduleItemUuid && nextSchedules[state.activeDate]) {
            ops.push(
              upsertFirestoreDoc(
                'wt_schedule',
                `${uid}_${state.activeDate}`,
                nextSchedules[state.activeDate],
                uid
              )
            );
          }
          Promise.all(ops)
            .then(() => set({ syncStatus: 'synced', lastSyncError: undefined }))
            .catch((err) => {
              console.error('[Sync] Failed to delete log from Firestore:', err);
              set({
                syncStatus: 'error',
                lastSyncError: err?.message || 'Failed to delete log from cloud',
              });
            });
        }
      },

      saveDraftWorkout: async (logUuid, statusOverride, alsoUpdatePreset) => {
        clearPendingDraftSync(logUuid);
        const state = get();
        const draftIdx = state.draftWorkouts.findIndex((d) => d.logUuid === logUuid);
        if (draftIdx === -1) return { ok: false, error: 'Workout card not found' };

        const draft = state.draftWorkouts[draftIdx];
        const finalStatus = statusOverride || (draft.status === 'did_not_complete' ? 'did_not_complete' : 'completed');
        const now = new Date().toISOString();

        const recalcedExercises = draft.exercises.map((ex) => recalculateLoggedExercise(ex));
        const totalSessionVolumeKg =
          Math.round(
            recalcedExercises.reduce((acc, ex) => acc + (Number(ex.totalLoadKg) || 0), 0) * 10
          ) / 10;

        let nextSeq = state.meta.nextLogSequenceNumber;
        let finalDisplayId = draft.displayId;
        const alreadyFinalized = state.logs.some(
          (l) => l.logUuid === logUuid && l.status !== 'in_progress'
        );
        if (!alreadyFinalized) {
          finalDisplayId = formatDisplayId(nextSeq);
          nextSeq += 1;
        }

        const logRecord: WorkoutLog = {
          logUuid: draft.logUuid,
          uid: state.authUser?.uid || state.meta.uid,
          displayId: finalDisplayId,
          legacyId: draft.legacyId,
          sessionGroupUuid: draft.sessionGroupUuid,
          chainOrderIndex: draft.chainOrderIndex ?? draftIdx,
          date: draft.date,
          presetUuid: draft.presetUuid,
          workoutTitleSnapshot: draft.workoutTitleSnapshot,
          workoutType: draft.workoutType,
          formatMode: draft.formatMode,
          targetRounds: draft.targetRounds,
          completedRounds: draft.completedRounds,
          laddersCompleted: draft.laddersCompleted,
          extraRungs: draft.extraRungs,
          programUuid: draft.programUuid,
          scheduleItemUuid: draft.scheduleItemUuid,
          status: finalStatus,
          sessionNotes: draft.sessionNotes,
          totalSessionVolumeKg,
          durationSec: draft.durationSec,
          exerciseUuids: recalcedExercises.map((e) => e.exerciseUuid),
          exercises: recalcedExercises,
          createdAt: draft.createdAt || now,
          updatedAt: now,
        };

        const alreadyInLogs = state.logs.some((l) => l.logUuid === logUuid);
        const nextLogs = alreadyInLogs
          ? state.logs.map((l) => (l.logUuid === logUuid ? logRecord : l))
          : [logRecord, ...state.logs];

        const nextDrafts = [...state.draftWorkouts];
        nextDrafts[draftIdx] = {
          ...draft,
          ...logRecord,
          isSaved: true,
        };

        // Update linked schedule item if present
        const nextSchedules = { ...state.schedules };
        const daySched = nextSchedules[draft.date];
        if (daySched) {
          const updatedItems = daySched.items.map((item) => {
            if (
              item.scheduleItemUuid === draft.scheduleItemUuid ||
              (!draft.scheduleItemUuid && item.presetUuid === draft.presetUuid && item.status === 'pending')
            ) {
              return {
                ...item,
                status: finalStatus,
                linkedLogUuid: logRecord.logUuid,
              };
            }
            return item;
          });
          nextSchedules[draft.date] = {
            ...daySched,
            items: updatedItems,
            updatedAt: now,
          };
        }

        // Optionally update master Preset if user toggled "Update Preset"
        let nextPresets = state.presets;
        if (alsoUpdatePreset || draft.updatePresetOnSave) {
          nextPresets = state.presets.map((p) => {
            if (p.presetUuid !== draft.presetUuid) return p;
            const updatedPresetExercises: PresetExercise[] = recalcedExercises.map((lex) => ({
              exerciseUuid: lex.exerciseUuid,
              exerciseName: lex.exerciseName,
              category: lex.category,
              trackingType: lex.trackingType,
              loadType: lex.loadType,
              defaultWeight: lex.weight,
              defaultSets: Math.max(1, lex.sets.length || lex.roundsCompleted || 1),
              defaultReps:
                lex.sets.length > 0 && lex.sets[0].reps > 0 ? String(lex.sets[0].reps) : '10',
              repScheme: lex.repScheme,
              side: lex.side,
              isPerSide: lex.isPerSide,
              cardioMode: lex.mode,
              defaultDistanceUnit: lex.distanceUnit,
              baseNotes: lex.exerciseNotes,
            }));
            return {
              ...p,
              exercises: updatedPresetExercises,
              updatedAt: now,
            };
          });
        }

        const nextMeta: UserMeta = {
          ...state.meta,
          nextLogSequenceNumber: nextSeq,
          updatedAt: now,
        };

        set({
          logs: nextLogs,
          draftWorkouts: nextDrafts,
          schedules: nextSchedules,
          presets: nextPresets,
          meta: nextMeta,
        });

        if (state.authUser) {
          const uid = state.authUser.uid;
          set({ syncStatus: 'syncing', lastSyncError: undefined });
          try {
            const writes: Promise<void>[] = [
              upsertFirestoreDoc('wt_logs', logRecord.logUuid, logRecord, uid),
              upsertFirestoreDoc('wt_meta', uid, nextMeta, uid),
            ];
            if (nextSchedules[draft.date]) {
              writes.push(
                upsertFirestoreDoc(
                  'wt_schedule',
                  `${uid}_${draft.date}`,
                  nextSchedules[draft.date],
                  uid
                )
              );
            }
            if (alsoUpdatePreset || draft.updatePresetOnSave) {
              const updatedPre = nextPresets.find((p) => p.presetUuid === draft.presetUuid);
              if (updatedPre) {
                writes.push(
                  upsertFirestoreDoc('wt_presets', updatedPre.presetUuid, updatedPre, uid)
                );
              }
            }
            await Promise.all(writes);
            set({ syncStatus: 'synced', lastSyncError: undefined });
            return { ok: true };
          } catch (err: any) {
            const msg = err?.message || 'Cloud sync failed while saving workout log';
            console.error('[Sync] saveDraftWorkout Firestore error:', err);
            set({ syncStatus: 'error', lastSyncError: msg });
            return { ok: false, error: msg };
          }
        }
        return { ok: true };
      },

      saveAllDraftWorkouts: async () => {
        const drafts = get().draftWorkouts;
        for (const d of drafts) {
          await get().saveDraftWorkout(
            d.logUuid,
            d.status === 'did_not_complete' ? 'did_not_complete' : 'completed'
          );
        }
      },

      getGhostExerciseData: (presetUuid, exerciseUuid, excludeLogUuid) => {
        const completedLogs = get()
          .logs.filter(
            (l) =>
              l.status === 'completed' &&
              l.logUuid !== excludeLogUuid &&
              l.exerciseUuids.includes(exerciseUuid)
          )
          .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

        if (completedLogs.length === 0) return null;

        // Priority 1: Match same presetUuid + exerciseUuid
        const samePresetLog = completedLogs.find((l) => l.presetUuid === presetUuid);
        const chosenLog = samePresetLog || completedLogs[0];
        const matchedEx = chosenLog.exercises.find((e) => e.exerciseUuid === exerciseUuid);
        if (!matchedEx) return null;

        return {
          sourceDate: chosenLog.date,
          sourceDisplayId: chosenLog.displayId,
          sourceWorkoutTitle: chosenLog.workoutTitleSnapshot,
          matchedSamePreset: Boolean(samePresetLog),
          exercise: matchedEx,
        };
      },

      getExerciseHistory: (exerciseUuid, limit = 10) => {
        const matchingLogs = get()
          .logs.filter(
            (l) => l.status === 'completed' && l.exerciseUuids.includes(exerciseUuid)
          )
          .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
          .slice(0, limit);

        const result: Array<{
          logUuid: string;
          displayId: string;
          date: string;
          workoutTitle: string;
          presetUuid: string;
          exercise: LoggedExercise;
          sessionNotes?: string;
        }> = [];

        for (const log of matchingLogs) {
          const ex = log.exercises.find((e) => e.exerciseUuid === exerciseUuid);
          if (ex) {
            result.push({
              logUuid: log.logUuid,
              displayId: log.displayId,
              date: log.date,
              workoutTitle: log.workoutTitleSnapshot,
              presetUuid: log.presetUuid,
              exercise: ex,
              sessionNotes: log.sessionNotes,
            });
          }
        }
        return result;
      },

      startRestTimer: (seconds) => {
        const sec = Math.max(5, Number(seconds) || 60);
        set({
          timer: {
            ...get().timer,
            isOpen: true,
            isRunning: true,
            mode: 'rest',
            phase: 'rest',
            remainingSec: sec,
            totalPhaseSec: sec,
          },
        });
      },

      startCircuitTimer: (rounds, workSec, restSec) => {
        const cleanRounds = Math.max(1, Number(rounds) || 10);
        const cleanWork = Math.max(5, Number(workSec) || 60);
        const cleanRest = Math.max(0, Number(restSec) || 0);
        set({
          timer: {
            isOpen: true,
            isExpanded: true,
            isRunning: true,
            mode: 'circuit',
            phase: 'work',
            remainingSec: cleanWork,
            totalPhaseSec: cleanWork,
            currentRound: 1,
            totalRounds: cleanRounds,
            workSec: cleanWork,
            restSec: cleanRest,
          },
        });
      },

      setTimerRounds: (rounds) => {
        const cleanRounds = Math.max(1, Number(rounds) || 1);
        const t = get().timer;
        set({
          timer: {
            ...t,
            totalRounds: cleanRounds,
            currentRound: Math.min(t.currentRound, cleanRounds),
          },
        });
      },

      toggleTimerRunning: () => {
        const t = get().timer;
        set({ timer: { ...t, isRunning: !t.isRunning } });
      },

      resetTimer: () => {
        const t = get().timer;
        if (t.mode === 'rest') {
          set({
            timer: {
              ...t,
              isRunning: false,
              remainingSec: t.totalPhaseSec,
            },
          });
        } else {
          set({
            timer: {
              ...t,
              isRunning: false,
              phase: 'work',
              currentRound: 1,
              remainingSec: t.workSec,
              totalPhaseSec: t.workSec,
            },
          });
        }
      },

      setTimerExpanded: (expanded) => {
        set({ timer: { ...get().timer, isExpanded: expanded } });
      },

      closeTimer: () => {
        set({ timer: { ...get().timer, isOpen: false, isRunning: false } });
      },

      tickTimer: () => {
        const t = get().timer;
        if (!t.isRunning) return { phaseChanged: false, finished: false };

        if (t.remainingSec > 1) {
          set({ timer: { ...t, remainingSec: t.remainingSec - 1 } });
          return { phaseChanged: false, finished: false };
        }

        // Remaining reached 0
        if (t.mode === 'rest') {
          set({ timer: { ...t, remainingSec: 0, isRunning: false } });
          return { phaseChanged: true, finished: true };
        }

        // Circuit mode transitions
        if (t.phase === 'work') {
          if (t.restSec > 0 && t.currentRound <= t.totalRounds) {
            set({
              timer: {
                ...t,
                phase: 'rest',
                remainingSec: t.restSec,
                totalPhaseSec: t.restSec,
              },
            });
            return { phaseChanged: true, finished: false, nextPhase: 'rest' };
          }
          // 0s rest (EMOM / continuous circuit)
          if (t.currentRound < t.totalRounds) {
            set({
              timer: {
                ...t,
                phase: 'work',
                currentRound: t.currentRound + 1,
                remainingSec: t.workSec,
                totalPhaseSec: t.workSec,
              },
            });
            return { phaseChanged: true, finished: false, nextPhase: 'work' };
          }
          // Completed all rounds
          set({ timer: { ...t, remainingSec: 0, isRunning: false } });
          return { phaseChanged: true, finished: true };
        } else {
          // Finished rest phase -> advance round
          if (t.currentRound < t.totalRounds) {
            set({
              timer: {
                ...t,
                phase: 'work',
                currentRound: t.currentRound + 1,
                remainingSec: t.workSec,
                totalPhaseSec: t.workSec,
              },
            });
            return { phaseChanged: true, finished: false, nextPhase: 'work' };
          }
          set({ timer: { ...t, remainingSec: 0, isRunning: false } });
          return { phaseChanged: true, finished: true };
        }
      },

      upsertPreset: (preset) => {
        const state = get();
        const exists = state.presets.some((p) => p.presetUuid === preset.presetUuid);
        const now = new Date().toISOString();
        const cleanPreset: WorkoutPreset = {
          ...preset,
          slug: preset.slug || slugify(preset.title, 'wkt'),
          updatedAt: now,
          createdAt: preset.createdAt || now,
        };

        // Ensure all exercises in the preset also exist in the global exercises dictionary
        const nextExercises = [...state.exercises];
        for (const pe of cleanPreset.exercises) {
          const exIdx = nextExercises.findIndex((ge) => ge.exerciseUuid === pe.exerciseUuid);
          if (exIdx === -1) {
            nextExercises.push({
              exerciseUuid: pe.exerciseUuid,
              slug: slugify(pe.exerciseName, 'ex'),
              exerciseName: pe.exerciseName,
              category: pe.category || 'General',
              trackingType: pe.trackingType,
              defaultLoadType: pe.loadType,
              defaultWeight: pe.defaultWeight,
              cardioMode: pe.cardioMode || null,
              baseNotes: pe.baseNotes,
              createdAt: now,
              updatedAt: now,
            });
          }
        }

        const nextPresets = exists
          ? state.presets.map((p) => (p.presetUuid === cleanPreset.presetUuid ? cleanPreset : p))
          : [cleanPreset, ...state.presets];

        set({ presets: nextPresets, exercises: nextExercises });
        if (state.authUser) {
          const uid = state.authUser.uid;
          upsertFirestoreDoc('wt_presets', cleanPreset.presetUuid, cleanPreset, uid).catch((err) => {
            console.error('[Sync] Failed to save preset:', err);
            set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to sync preset' });
          });
        }
      },

      duplicatePreset: (presetUuid) => {
        const orig = get().presets.find((p) => p.presetUuid === presetUuid);
        if (!orig) return null;
        const now = new Date().toISOString();
        const copy: WorkoutPreset = {
          ...JSON.parse(JSON.stringify(orig)),
          presetUuid: `pre-${uuidv4()}`,
          title: `${orig.title} (Copy)`,
          slug: `${orig.slug}_copy_${Math.floor(Math.random() * 900 + 100)}`,
          createdAt: now,
          updatedAt: now,
        };
        get().upsertPreset(copy);
        return copy;
      },

      deletePreset: (presetUuid) => {
        const state = get();
        set({ presets: state.presets.filter((p) => p.presetUuid !== presetUuid) });
        if (state.authUser) {
          removeFirestoreDoc('wt_presets', presetUuid).catch((err) => {
            console.error('[Sync] Failed to delete preset:', err);
            set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to delete preset' });
          });
        }
      },

      upsertGlobalExercise: (exercise) => {
        const state = get();
        const exists = state.exercises.some((e) => e.exerciseUuid === exercise.exerciseUuid);
        const now = new Date().toISOString();
        const clean: GlobalExercise = {
          ...exercise,
          slug: exercise.slug || slugify(exercise.exerciseName, 'ex'),
          updatedAt: now,
          createdAt: exercise.createdAt || now,
        };
        const nextExercises = exists
          ? state.exercises.map((e) => (e.exerciseUuid === clean.exerciseUuid ? clean : e))
          : [clean, ...state.exercises];
        set({ exercises: nextExercises });
        if (state.authUser) {
          upsertFirestoreDoc('wt_exercises', clean.exerciseUuid, clean, state.authUser.uid).catch((err) => {
            console.error('[Sync] Failed to save exercise:', err);
            set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to sync exercise' });
          });
        }
      },

      upsertProgram: (program) => {
        const state = get();
        const exists = state.programs.some((p) => p.programUuid === program.programUuid);
        const now = new Date().toISOString();
        const clean: WorkoutProgram = {
          ...program,
          slug: program.slug || slugify(program.title, 'prg'),
          updatedAt: now,
          createdAt: program.createdAt || now,
        };
        const nextPrograms = exists
          ? state.programs.map((p) => (p.programUuid === clean.programUuid ? clean : p))
          : [clean, ...state.programs];
        set({ programs: nextPrograms });
        if (state.authUser) {
          upsertFirestoreDoc('wt_programs', clean.programUuid, clean, state.authUser.uid).catch((err) => {
            console.error('[Sync] Failed to save program:', err);
            set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to sync program' });
          });
        }
      },

      deleteProgram: (programUuid) => {
        const state = get();
        set({ programs: state.programs.filter((p) => p.programUuid !== programUuid) });
        if (state.authUser) {
          removeFirestoreDoc('wt_programs', programUuid).catch((err) => {
            console.error('[Sync] Failed to delete program:', err);
            set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to delete program' });
          });
        }
      },

      updateDailySchedule: (date, items) => {
        const state = get();
        const now = new Date().toISOString();
        const docId = state.authUser ? `${state.authUser.uid}_${date}` : `local_${date}`;
        const nextSched: DailySchedule = {
          scheduleId: docId,
          uid: state.authUser?.uid,
          date,
          items: items.map((it, idx) => ({ ...it, orderIndex: idx })),
          updatedAt: now,
        };
        const nextSchedules = {
          ...state.schedules,
          [date]: nextSched,
        };
        set({ schedules: nextSchedules });
        if (state.authUser) {
          upsertFirestoreDoc('wt_schedule', docId, nextSched, state.authUser.uid).catch((err) => {
            console.error('[Sync] Failed to save daily schedule:', err);
            set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to sync schedule' });
          });
        }
      },

      addScheduledItemToDate: (date, presetUuid, slotRole = 'Primary', coachNotes = '', programUuid) => {
        const state = get();
        const existing = state.schedules[date]?.items || [];
        const newItem: ScheduledItem = {
          scheduleItemUuid: `sch-${uuidv4()}`,
          orderIndex: existing.length,
          slotRole,
          presetUuid,
          programUuid: programUuid || state.meta.activeProgramUuid,
          coachNotes,
          status: 'pending',
          linkedLogUuid: null,
        };
        get().updateDailySchedule(date, [...existing, newItem]);
      },

      removeScheduledItemFromDate: (date, scheduleItemUuid) => {
        const state = get();
        const existing = state.schedules[date]?.items || [];
        get().updateDailySchedule(
          date,
          existing.filter((i) => i.scheduleItemUuid !== scheduleItemUuid)
        );
      },

      autoFillSchedule: (programUuid, startDate, endDate, conflictMode) => {
        const state = get();
        const program = state.programs.find((p) => p.programUuid === programUuid);
        if (!program) return { daysModified: 0, itemsCreated: 0 };

        const nextSchedules = { ...state.schedules };
        const now = new Date().toISOString();
        let current = startDate;
        let dayCounter = 0;
        let daysModified = 0;
        let itemsCreated = 0;

        while (current <= endDate && dayCounter < 366) {
          const [y, m, d] = current.split('-').map(Number);
          const dt = new Date(y, m - 1, d);
          const dayOfWeek = dt.getDay(); // 0..6
          const cycleWeek = (Math.floor(dayCounter / 7) % Math.max(1, program.cycleLengthWeeks)) + 1;

          const templateDay = program.scheduleTemplate.find(
            (t) => t.weekNumber === cycleWeek && t.dayOfWeek === dayOfWeek
          );

          if (templateDay && templateDay.items.length > 0) {
            const existingDay = nextSchedules[current];
            const existingItems = existingDay?.items || [];

            if (conflictMode === 'skip' && existingItems.length > 0) {
              // Skip this date entirely
            } else {
              const weekNotePrefix = program.weekProgressionNotes?.[String(cycleWeek)]
                ? `[W${cycleWeek}] ${program.weekProgressionNotes[String(cycleWeek)]}`
                : '';

              const generatedItems: ScheduledItem[] = templateDay.items.map((ti, idx) => {
                const combinedNotes = [ti.defaultNotes, weekNotePrefix]
                  .filter(Boolean)
                  .join(' — ');
                return {
                  scheduleItemUuid: `sch-${uuidv4()}`,
                  orderIndex: idx,
                  slotRole: ti.slotRole || 'Primary',
                  presetUuid: ti.presetUuid,
                  programUuid: program.programUuid,
                  coachNotes: combinedNotes,
                  status: 'pending',
                  linkedLogUuid: null,
                };
              });

              let finalItems: ScheduledItem[] = [];
              if (conflictMode === 'replace' || existingItems.length === 0) {
                finalItems = generatedItems;
                itemsCreated += generatedItems.length;
              } else if (conflictMode === 'update_matching') {
                finalItems = [...existingItems];
                for (const gen of generatedItems) {
                  const matchIdx = finalItems.findIndex(
                    (ex) => ex.slotRole.toLowerCase() === gen.slotRole.toLowerCase()
                  );
                  if (matchIdx !== -1 && finalItems[matchIdx].status === 'pending') {
                    finalItems[matchIdx] = {
                      ...finalItems[matchIdx],
                      presetUuid: gen.presetUuid,
                      programUuid: gen.programUuid,
                      coachNotes: gen.coachNotes,
                    };
                  } else if (matchIdx === -1) {
                    finalItems.push({ ...gen, orderIndex: finalItems.length });
                    itemsCreated += 1;
                  }
                }
              }

              const docId = state.authUser ? `${state.authUser.uid}_${current}` : `local_${current}`;
              nextSchedules[current] = {
                scheduleId: docId,
                uid: state.authUser?.uid,
                date: current,
                items: finalItems,
                updatedAt: now,
              };
              daysModified += 1;
            }
          }

          current = shiftIsoDate(current, 1);
          dayCounter += 1;
        }

        set({ schedules: nextSchedules });
        if (state.authUser) {
          const uid = state.authUser.uid;
          Promise.all(
            Object.values(nextSchedules).map((sch) =>
              upsertFirestoreDoc('wt_schedule', `${uid}_${sch.date}`, sch, uid)
            )
          ).catch((err) => {
            console.error('[Sync] Auto-fill schedule cloud write failed:', err);
            set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to sync auto-filled schedule' });
          });
        }
        return { daysModified, itemsCreated };
      },

      deleteWorkoutLog: async (logUuid) => {
        clearPendingDraftSync(logUuid);
        const state = get();
        const targetLog = state.logs.find((l) => l.logUuid === logUuid);
        const nextSchedules = { ...state.schedules };
        if (targetLog?.scheduleItemUuid && nextSchedules[targetLog.date]) {
          const daySched = nextSchedules[targetLog.date];
          nextSchedules[targetLog.date] = {
            ...daySched,
            items: daySched.items.map((it) =>
              it.linkedLogUuid === logUuid || it.scheduleItemUuid === targetLog.scheduleItemUuid
                ? { ...it, status: 'pending', linkedLogUuid: null }
                : it
            ),
            updatedAt: new Date().toISOString(),
          };
        }

        set({
          logs: state.logs.filter((l) => l.logUuid !== logUuid),
          draftWorkouts: state.draftWorkouts.filter((d) => d.logUuid !== logUuid),
          schedules: nextSchedules,
        });

        if (state.authUser) {
          const uid = state.authUser.uid;
          set({ syncStatus: 'syncing', lastSyncError: undefined });
          try {
            await removeFirestoreDoc('wt_logs', logUuid);
            if (targetLog?.scheduleItemUuid && nextSchedules[targetLog.date]) {
              await upsertFirestoreDoc(
                'wt_schedule',
                `${uid}_${targetLog.date}`,
                nextSchedules[targetLog.date],
                uid
              );
            }
            set({ syncStatus: 'synced', lastSyncError: undefined });
          } catch (err: any) {
            console.error('[Sync] Failed to delete log from Firestore:', err);
            set({
              syncStatus: 'error',
              lastSyncError: err?.message || 'Failed to delete log from cloud',
            });
          }
        }
      },

      deleteLog: async (logUuid) => {
        return get().deleteWorkoutLog(logUuid);
      },

      applyAiImportPayload: (payload) => {
        const state = get();
        const mode = payload.mode || 'update';
        const now = new Date().toISOString();

        let nextPresets = mode === 'replace' && payload.presets ? [] : [...state.presets];
        let nextPrograms = mode === 'replace' && payload.programs ? [] : [...state.programs];
        const nextSchedules = { ...state.schedules };
        const nextExercises = [...state.exercises];

        let presetsCount = 0;
        let programsCount = 0;
        let scheduleDaysCount = 0;

        if (payload.presets) {
          for (const rawPre of payload.presets) {
            const slug = rawPre.slug || slugify(rawPre.title, 'wkt');
            const existing = nextPresets.find(
              (p) => p.presetUuid === rawPre.presetUuid || p.slug === slug
            );

            if (existing && mode === 'add') continue;

            const presetUuid = existing?.presetUuid || rawPre.presetUuid || `pre-${uuidv4()}`;
            const exercises: PresetExercise[] = (rawPre.exercises || existing?.exercises || []).map(
              (ex) => {
                const matchedGlobal = nextExercises.find(
                  (ge) =>
                    ge.exerciseUuid === ex.exerciseUuid ||
                    ge.exerciseName.toLowerCase() === ex.exerciseName.toLowerCase()
                );
                const exerciseUuid = matchedGlobal?.exerciseUuid || ex.exerciseUuid || `ex-${uuidv4()}`;
                if (!matchedGlobal) {
                  nextExercises.push({
                    exerciseUuid,
                    slug: slugify(ex.exerciseName, 'ex'),
                    exerciseName: ex.exerciseName,
                    category: ex.category || 'General',
                    trackingType: ex.trackingType || 'strength',
                    defaultLoadType: ex.loadType || 'single_kg',
                    defaultWeight: Number(ex.defaultWeight) || 0,
                    cardioMode: ex.cardioMode || null,
                    baseNotes: ex.baseNotes,
                    createdAt: now,
                    updatedAt: now,
                  });
                }
                return {
                  exerciseUuid,
                  exerciseName: ex.exerciseName,
                  category: ex.category || 'General',
                  trackingType: ex.trackingType || 'strength',
                  loadType: ex.loadType || 'single_kg',
                  defaultWeight: Number(ex.defaultWeight) || 0,
                  defaultSets: Number(ex.defaultSets) || 3,
                  defaultReps: String(ex.defaultReps || '10'),
                  cardioMode: ex.cardioMode,
                  defaultDistanceUnit: ex.defaultDistanceUnit || 'mi',
                  baseNotes: ex.baseNotes,
                };
              }
            );

            const fullPreset: WorkoutPreset = {
              presetUuid,
              slug,
              title: rawPre.title || existing?.title || 'Untitled Workout',
              workoutType: rawPre.workoutType || existing?.workoutType || 'Strength',
              programIds: rawPre.programIds || existing?.programIds || [],
              tags: rawPre.tags || existing?.tags || [],
              defaultTimer: rawPre.defaultTimer || existing?.defaultTimer,
              exercises,
              createdAt: existing?.createdAt || now,
              updatedAt: now,
            };

            if (existing) {
              nextPresets = nextPresets.map((p) =>
                p.presetUuid === existing.presetUuid ? fullPreset : p
              );
            } else {
              nextPresets.push(fullPreset);
            }
            presetsCount += 1;
          }
        }

        if (payload.programs) {
          for (const rawProg of payload.programs) {
            const slug = rawProg.slug || slugify(rawProg.title, 'prg');
            const existing = nextPrograms.find(
              (p) => p.programUuid === rawProg.programUuid || p.slug === slug
            );
            if (existing && mode === 'add') continue;

            const programUuid = existing?.programUuid || rawProg.programUuid || `prog-${uuidv4()}`;
            const fullProg: WorkoutProgram = {
              programUuid,
              slug,
              title: rawProg.title || existing?.title || 'AI Program',
              description: rawProg.description ?? existing?.description,
              cycleLengthWeeks: Number(rawProg.cycleLengthWeeks) || existing?.cycleLengthWeeks || 1,
              scheduleTemplate: rawProg.scheduleTemplate || existing?.scheduleTemplate || [],
              weekProgressionNotes:
                rawProg.weekProgressionNotes || existing?.weekProgressionNotes || {},
              createdAt: existing?.createdAt || now,
              updatedAt: now,
            };

            if (existing) {
              nextPrograms = nextPrograms.map((p) =>
                p.programUuid === existing.programUuid ? fullProg : p
              );
            } else {
              nextPrograms.push(fullProg);
            }
            programsCount += 1;
          }
        }

        if (payload.schedule) {
          for (const dayEntry of payload.schedule) {
            const date = dayEntry.date;
            if (!date) continue;
            const existingDay = nextSchedules[date];
            if (existingDay && existingDay.items.length > 0 && mode === 'add') continue;

            const resolvedItems: ScheduledItem[] = [];
            (dayEntry.items || []).forEach((it, idx) => {
              const matchedPreset = nextPresets.find(
                (p) => p.presetUuid === it.presetUuid || p.slug === it.presetSlug
              );
              if (!matchedPreset) return;
              const matchedProg = nextPrograms.find(
                (pg) => pg.programUuid === it.programUuid || pg.slug === it.programSlug
              );
              resolvedItems.push({
                scheduleItemUuid: `sch-${uuidv4()}`,
                orderIndex: idx,
                slotRole: it.slotRole || (idx === 0 ? 'Primary' : 'Secondary'),
                presetUuid: matchedPreset.presetUuid,
                programUuid: matchedProg?.programUuid || state.meta.activeProgramUuid,
                coachNotes: it.coachNotes || '',
                status: 'pending',
                linkedLogUuid: null,
              });
            });

            const docId = state.authUser ? `${state.authUser.uid}_${date}` : `local_${date}`;
            nextSchedules[date] = {
              scheduleId: docId,
              uid: state.authUser?.uid,
              date,
              items:
                mode === 'update' && existingDay
                  ? [...existingDay.items, ...resolvedItems].map((x, i) => ({
                      ...x,
                      orderIndex: i,
                    }))
                  : resolvedItems,
              updatedAt: now,
            };
            scheduleDaysCount += 1;
          }
        }

        set({
          exercises: nextExercises,
          presets: nextPresets,
          programs: nextPrograms,
          schedules: nextSchedules,
        });

        if (state.authUser) {
          pushAllLocalDataToFirestore(state.authUser.uid, {
            exercises: nextExercises,
            presets: nextPresets,
            programs: nextPrograms,
            schedules: nextSchedules,
            logs: state.logs,
            meta: state.meta,
          }).catch((err) => {
            console.error('[Sync] Failed to push AI import to Firestore:', err);
            set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to sync AI import' });
          });
        }

        return { presetsCount, programsCount, scheduleDaysCount };
      },

      commitReconciledLegacyImport: ({ newExercises, newPresets, newLogs }) => {
        const state = get();
        const existingExIds = new Set(state.exercises.map((e) => e.exerciseUuid));
        const mergedExercises = [
          ...state.exercises,
          ...newExercises.filter((e) => !existingExIds.has(e.exerciseUuid)),
        ];

        const existingPreIds = new Set(state.presets.map((p) => p.presetUuid));
        const mergedPresets = [
          ...state.presets,
          ...newPresets.filter((p) => !existingPreIds.has(p.presetUuid)),
        ];

        const existingLogIds = new Set(state.logs.map((l) => l.logUuid));
        const mergedLogs = [
          ...newLogs.filter((l) => !existingLogIds.has(l.logUuid)),
          ...state.logs,
        ].sort((a, b) => b.date.localeCompare(a.date));

        let maxSeq = state.meta.nextLogSequenceNumber;
        for (const l of mergedLogs) {
          const m = l.displayId.match(/ID-(\d+)/);
          if (m) {
            const n = parseInt(m[1], 10);
            if (n >= maxSeq) maxSeq = n + 1;
          }
        }

        const nextMeta = {
          ...state.meta,
          nextLogSequenceNumber: maxSeq,
          updatedAt: new Date().toISOString(),
        };

        set({
          exercises: mergedExercises,
          presets: mergedPresets,
          logs: mergedLogs,
          meta: nextMeta,
        });

        if (state.authUser) {
          pushAllLocalDataToFirestore(state.authUser.uid, {
            exercises: mergedExercises,
            presets: mergedPresets,
            programs: state.programs,
            schedules: state.schedules,
            logs: mergedLogs,
            meta: nextMeta,
          }).catch((err) => {
            console.error('[Sync] Failed to push legacy import to Firestore:', err);
            set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to sync imported logs' });
          });
        }
      },

      setAuthUser: (user) => {
        set({
          authUser: user,
          syncStatus: user ? 'syncing' : 'local',
          lastSyncError: undefined,
          hasCompletedCloudBootstrap: false,
        });
        if (user) {
          get().syncWithFirestore();
        }
      },

      startRealtimeSync: (uid) => {
        return subscribeToUserCollections(uid, {
          onExercises: (remoteExercises) => {
            if (remoteExercises.length > 0 || get().hasCompletedCloudBootstrap) {
              set({ exercises: remoteExercises, syncStatus: 'synced' });
            }
          },
          onPresets: (remotePresets) => {
            if (remotePresets.length > 0 || get().hasCompletedCloudBootstrap) {
              set({ presets: remotePresets, syncStatus: 'synced' });
            }
          },
          onPrograms: (remotePrograms) => {
            if (remotePrograms.length > 0 || get().hasCompletedCloudBootstrap) {
              set({ programs: remotePrograms, syncStatus: 'synced' });
            }
          },
          onSchedules: (remoteSchedules) => {
            if (remoteSchedules.length > 0) {
              const scheduleMap: Record<string, DailySchedule> = { ...get().schedules };
              for (const sch of remoteSchedules) {
                if (sch.date) scheduleMap[sch.date] = sch;
              }
              set({ schedules: scheduleMap, syncStatus: 'synced' });
            }
          },
          onLogs: (remoteLogs) => {
            const state = get();
            const uid = state.authUser?.uid || state.meta.uid;

            // Only guard against wiping local logs BEFORE initial cloud bootstrap has finished
            // (e.g., cached empty snapshot firing before first push). Once bootstrapped, remote
            // empty array legitimately means all logs were deleted in Firestore.
            if (remoteLogs.length === 0 && state.logs.length > 0 && !state.hasCompletedCloudBootstrap) {
              return;
            }

            const mergedLogsMap = new Map<string, WorkoutLog>();
            for (const r of remoteLogs) {
              mergedLogsMap.set(r.logUuid, r);
            }

            // Preserve any local drafts that have pending debounced syncs not yet committed
            for (const pendingId of pendingDraftLogUuids) {
              const localDraft = state.draftWorkouts.find((d) => d.logUuid === pendingId);
              if (localDraft) {
                mergedLogsMap.set(
                  pendingId,
                  draftToWorkoutLog(localDraft, uid, localDraft.chainOrderIndex ?? 0)
                );
              }
            }

            const sortedMergedLogs = Array.from(mergedLogsMap.values()).sort(
              (a, b) =>
                (b.date || '').localeCompare(a.date || '') ||
                (b.updatedAt || b.createdAt || '').localeCompare(
                  a.updatedAt || a.createdAt || ''
                )
            );

            // Hydrate LogView drafts for activeDate when remote updates arrive,
            // provided the user isn't actively typing or holding a pending debounced edit.
            const shouldSkipDraftHydration =
              isUserActivelyTyping() || pendingDraftLogUuids.size > 0;

            if (shouldSkipDraftHydration) {
              set({
                logs: sortedMergedLogs,
                syncStatus: 'synced',
                lastSyncError: undefined,
              });
              return;
            }

            const remoteForActiveDate = sortedMergedLogs
              .filter((l) => l.date === state.activeDate)
              .sort((a, b) => (a.chainOrderIndex ?? 0) - (b.chainOrderIndex ?? 0))
              .map((l, idx) => {
                const daySchedule = state.schedules[state.activeDate];
                const linkedSched = daySchedule?.items.find(
                  (it) => it.linkedLogUuid === l.logUuid || it.scheduleItemUuid === l.scheduleItemUuid
                );
                return {
                  ...l,
                  isSaved: l.status === 'completed' || l.status === 'did_not_complete',
                  coachNotes: linkedSched?.coachNotes,
                  slotRole: linkedSched?.slotRole || (idx === 0 ? 'Primary' : `Workout #${idx + 1}`),
                  updatePresetOnSave: false,
                } as DraftWorkoutCard;
              });

            const remoteIds = new Set(remoteForActiveDate.map((d) => d.logUuid));
            const previouslySyncedIds = new Set(state.logs.map((l) => l.logUuid));
            const localOnlyDrafts = state.draftWorkouts.filter(
              (d) =>
                d.date === state.activeDate &&
                !d.isSaved &&
                !remoteIds.has(d.logUuid) &&
                !previouslySyncedIds.has(d.logUuid)
            );
            const mergedDrafts = [...remoteForActiveDate, ...localOnlyDrafts];

            set({
              logs: sortedMergedLogs,
              draftWorkouts: mergedDrafts,
              syncStatus: 'synced',
              lastSyncError: undefined,
            });
          },
          onMeta: (remoteMeta) => {
            if (remoteMeta) {
              set({ meta: { ...get().meta, ...remoteMeta }, syncStatus: 'synced' });
            }
          },
          onError: (col, err) => {
            console.error(`[Sync] Realtime subscription error on ${col}:`, err);
            set({
              syncStatus: 'error',
              lastSyncError: `Realtime sync error (${col}): ${err.message}`,
            });
          },
        });
      },

      syncWithFirestore: async () => {
        const user = get().authUser;
        if (!user) return;
        set({ syncStatus: 'syncing', lastSyncError: undefined });
        try {
          const remote = await pullAllUserCollections(user.uid);
          if (!remote) {
            set({ syncStatus: 'local' });
            return;
          }

          const hasRemoteAccountData = Boolean(
            remote.meta ||
              remote.presets.length > 0 ||
              remote.logs.length > 0 ||
              remote.programs.length > 0 ||
              remote.exercises.length > 0 ||
              remote.schedules.length > 0
          );

          if (!hasRemoteAccountData) {
            await pushAllLocalDataToFirestore(user.uid, {
              exercises: get().exercises,
              presets: get().presets,
              programs: get().programs,
              schedules: get().schedules,
              logs: get().logs,
              meta: { ...get().meta, uid: user.uid },
            });
            set({
              syncStatus: 'synced',
              hasSeeded: true,
              hasCompletedCloudBootstrap: true,
            });
            return;
          }

          const scheduleMap: Record<string, DailySchedule> = {};
          for (const sch of remote.schedules) {
            if (sch.date) {
              scheduleMap[sch.date] = sch;
            }
          }

          const sortedLogs = [...remote.logs].sort(
            (a, b) =>
              (b.date || '').localeCompare(a.date || '') ||
              (b.updatedAt || b.createdAt || '').localeCompare(
                a.updatedAt || a.createdAt || ''
              )
          );

          const state = get();
          const nextExercises = remote.exercises.length > 0 ? remote.exercises : state.exercises;
          const nextPresets = remote.presets.length > 0 ? remote.presets : state.presets;
          const nextPrograms = remote.programs.length > 0 ? remote.programs : state.programs;
          // NEVER fall back to local/seed logs when the cloud account exists —
          // if cloud wt_logs is empty, all logs were deleted!
          const nextLogs = sortedLogs;
          const nextMeta = remote.meta ? { ...state.meta, ...remote.meta } : state.meta;

          // Refresh drafts for activeDate from pulled remote logs unless user is actively typing
          const refreshedFloor = !isUserActivelyTyping()
            ? buildInitialDraftsForDate(
                state.activeDate,
                nextLogs,
                scheduleMap,
                nextPresets,
                nextMeta
              )
            : null;
          const nextIds = new Set((refreshedFloor?.drafts || []).map((d) => d.logUuid));
          const previouslySyncedIds = new Set(state.logs.map((l) => l.logUuid));
          const preservedLocalOnlyDrafts = state.draftWorkouts.filter(
            (d) =>
              d.date === state.activeDate &&
              !d.isSaved &&
              !nextIds.has(d.logUuid) &&
              !previouslySyncedIds.has(d.logUuid)
          );
          const mergedActiveDrafts = refreshedFloor
            ? [...refreshedFloor.drafts, ...preservedLocalOnlyDrafts]
            : null;

          set({
            exercises: nextExercises,
            presets: nextPresets,
            programs: nextPrograms,
            schedules: scheduleMap,
            logs: nextLogs,
            meta: nextMeta,
            ...(refreshedFloor && mergedActiveDrafts
              ? {
                  activeSessionGroupUuid: refreshedFloor.sessionGroupUuid,
                  draftWorkouts: mergedActiveDrafts,
                }
              : {}),
            syncStatus: 'synced',
            lastSyncError: undefined,
            hasSeeded: true,
            hasCompletedCloudBootstrap: true,
          });
        } catch (err: any) {
          console.error('[Sync] syncWithFirestore error:', err);
          set({
            syncStatus: 'error',
            lastSyncError: err?.message || 'Firestore sync failed',
          });
        }
      },

      pushLocalToCloud: async () => {
        const state = get();
        if (!state.authUser) {
          return { ok: false, pushedLogs: 0, error: 'Sign in with Google first.' };
        }
        const uid = state.authUser.uid;
        set({ syncStatus: 'syncing', lastSyncError: undefined });

        try {
          // Cancel any pending debounces since we are pushing all drafts immediately
          for (const d of state.draftWorkouts) {
            clearPendingDraftSync(d.logUuid);
          }

          // Collect ALL logs from Zustand AND any active draftWorkouts / localStorage persisted entries
          const combinedLogsMap = new Map<string, WorkoutLog>();
          for (const log of state.logs) {
            combinedLogsMap.set(log.logUuid, { ...log, uid });
          }

          // Check raw localStorage persisted drafts/logs as fallback so zero device-only drafts are missed
          try {
            const raw = localStorage.getItem('ironpulse-workout-tracker-storage-v1');
            if (raw) {
              const parsed = JSON.parse(raw);
              const persistedState = parsed?.state;
              if (Array.isArray(persistedState?.logs)) {
                for (const pLog of persistedState.logs as WorkoutLog[]) {
                  if (pLog?.logUuid && !combinedLogsMap.has(pLog.logUuid)) {
                    combinedLogsMap.set(pLog.logUuid, { ...pLog, uid });
                  }
                }
              }
              if (Array.isArray(persistedState?.draftWorkouts)) {
                (persistedState.draftWorkouts as DraftWorkoutCard[]).forEach((pDraft, idx) => {
                  if (pDraft?.logUuid && !combinedLogsMap.has(pDraft.logUuid)) {
                    combinedLogsMap.set(
                      pDraft.logUuid,
                      draftToWorkoutLog(pDraft, uid, idx)
                    );
                  }
                });
              }
            }
          } catch {
            // Ignore malformed localStorage read
          }

          // Active in-memory draftWorkouts always hold the freshest edits for those cards
          state.draftWorkouts.forEach((draft, idx) => {
            combinedLogsMap.set(draft.logUuid, draftToWorkoutLog(draft, uid, idx));
          });

          const allLocalLogs = Array.from(combinedLogsMap.values()).sort(
            (a, b) =>
              (b.date || '').localeCompare(a.date || '') ||
              (b.updatedAt || b.createdAt || '').localeCompare(
                a.updatedAt || a.createdAt || ''
              )
          );

          const nowIso = new Date().toISOString();
          const stampedExercises = state.exercises.map((ex) => ({ ...ex, uid }));
          const stampedPresets = state.presets.map((p) => ({ ...p, uid }));
          const stampedPrograms = state.programs.map((prog) => ({ ...prog, uid }));
          const stampedSchedules: Record<string, DailySchedule> = {};
          for (const [dateKey, sch] of Object.entries(state.schedules)) {
            stampedSchedules[dateKey] = {
              ...sch,
              scheduleId: `${uid}_${dateKey}`,
              uid,
              updatedAt: sch.updatedAt || nowIso,
            };
          }

          // Update local store with uid-stamped entries before pushing so local & cloud stay aligned
          set({
            exercises: stampedExercises,
            presets: stampedPresets,
            programs: stampedPrograms,
            schedules: stampedSchedules,
            logs: allLocalLogs,
            hasSeeded: true,
          });

          await pushAllLocalDataToFirestore(uid, {
            exercises: stampedExercises,
            presets: stampedPresets,
            programs: stampedPrograms,
            schedules: stampedSchedules,
            logs: allLocalLogs,
            meta: { ...state.meta, uid, updatedAt: nowIso },
          });

          // Pull & merge remote updates after pushing so cross-device entries converge cleanly
          await get().syncWithFirestore();

          return { ok: true, pushedLogs: allLocalLogs.length };
        } catch (err: any) {
          const msg = err?.message || 'Push to Firestore failed';
          console.error('[Sync] pushLocalToCloud error:', err);
          set({
            syncStatus: 'error',
            lastSyncError: msg,
          });
          return { ok: false, pushedLogs: 0, error: msg };
        }
      },

      resetToDemoSeed: () => {
        const today = getTodayIsoDate();
        const state = get();
        const uid = state.authUser?.uid || 'local-user';
        const seededMeta: UserMeta = { ...SEED_META, uid };
        const floor = buildInitialDraftsForDate(
          today,
          SEED_LOGS,
          SEED_SCHEDULES,
          SEED_PRESETS,
          seededMeta
        );
        set({
          exercises: SEED_EXERCISES,
          presets: SEED_PRESETS,
          programs: SEED_PROGRAMS,
          schedules: SEED_SCHEDULES,
          logs: SEED_LOGS,
          meta: seededMeta,
          hasSeeded: true,
          activeDate: today,
          activeSessionGroupUuid: floor.sessionGroupUuid,
          draftWorkouts: floor.drafts,
        });
        if (state.authUser) {
          pushAllLocalDataToFirestore(state.authUser.uid, {
            exercises: SEED_EXERCISES,
            presets: SEED_PRESETS,
            programs: SEED_PROGRAMS,
            schedules: SEED_SCHEDULES,
            logs: SEED_LOGS,
            meta: seededMeta,
          }).catch((err) => {
            console.error('[Sync] Failed to push sample data to Firestore:', err);
            set({
              syncStatus: 'error',
              lastSyncError: err?.message || 'Failed to sync sample data',
            });
          });
        }
      },
    }),
    {
      name: 'ironpulse-workout-tracker-storage-v1',
      partialize: (state) => ({
        exercises: state.exercises,
        presets: state.presets,
        programs: state.programs,
        schedules: state.schedules,
        logs: state.logs,
        meta: state.meta,
        hasSeeded: state.hasSeeded,
        viewportMode: state.viewportMode,
        logLayoutMode: state.logLayoutMode,
        logDensityMode: state.logDensityMode,
        activeDate: state.activeDate,
        activeSessionGroupUuid: state.activeSessionGroupUuid,
        draftWorkouts: state.draftWorkouts,
      }),
      onRehydrateStorage: () => (rehydratedState, error) => {
        if (error || !rehydratedState) return;
        if (rehydratedState.hasSeeded) return;

        // If user already had persisted presets/programs/logs from before `hasSeeded` existed,
        // mark seeded without overwriting their logs (e.g. if they deleted seed logs).
        const hasPriorUserData =
          rehydratedState.presets.length > 0 ||
          rehydratedState.programs.length > 0 ||
          rehydratedState.logs.length > 0 ||
          rehydratedState.exercises.length > 0;

        if (hasPriorUserData) {
          queueMicrotask(() => {
            useWorkoutStore.setState({ hasSeeded: true });
          });
          return;
        }

        // Brand-new offline profile: seed starter data once and mark hasSeeded = true.
        queueMicrotask(() => {
          rehydratedState.resetToDemoSeed();
        });
      },
    }
  )
);

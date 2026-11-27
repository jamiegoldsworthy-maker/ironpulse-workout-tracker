import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  AIImportPayload,
  ContextBlock,
  DEFAULT_WORKOUT_CATEGORIES,
  DailySchedule,
  DistanceUnit,
  GhostExerciseData,
  GlobalExercise,
  LogStatus,
  LoggedExercise,
  PresetExercise,
  PresetFormatMode,
  ProgramTemplateItem,
  ScheduleStatus,
  ScheduledItem,
  SetEntry,
  ThemeMode,
  UserMeta,
  WorkoutLog,
  WorkoutPreset,
  WorkoutProgram,
} from '../types/workout';
import {
  DEFAULT_BITE_SIZE_PRESETS,
  SEED_EXERCISES,
  SEED_LOGS,
  SEED_META,
  SEED_PRESETS,
  SEED_PROGRAMS,
  SEED_SCHEDULES,
} from '../data/seedData';
import { AiNotesPatchPayload, ParsedProgramCycleImport } from '../utils/aiCoachPatch';
import {
  GoogleSyncStatus,
  GoogleTasksRuntimeState,
  PendingTaskCompletion,
  SingleScheduleTaskInput,
  SingleTaskSyncAction,
  TasksActionResult,
  checkCompletedTasksInbound as fetchCompletedTasksInbound,
  flushQueuedSingleTaskOps,
  getCachedGoogleTasksToken,
  getGoogleTasksRuntimeState,
  getPendingSingleTaskOpsCount,
  isDateWithinGoogleTasksSyncWindow,
  syncGoogleTasksTwoWay,
  syncSingleScheduleTask,
} from '../lib/googleTasks';
import {
  mergeDailyScheduleByTimestamp,
  normalizeDailySchedule,
  normalizeLogStatus,
  normalizeScheduleStatus,
  normalizeWorkoutLog,
} from '../utils/scheduleStatus';
import {
  computeAmrapExercises,
  expandLadderSequence,
  formatDisplayId,
  getTodayIsoDate,
  inferDefaultMetricType,
  recalculateLoggedExercise,
  resolveMobilityDurationSeconds,
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

export type AppTab = 'log' | 'plan' | 'library' | 'history' | 'settings';

export const SAFETY_SNAPSHOT_STORAGE_KEY = 'wt_safety_snapshot';
export const LAST_LOG_INTERACTION_KEY = 'ironpulse_last_log_interaction_at';
export const LOG_INACTIVITY_RESET_MS = 60 * 60 * 1000; // 60 minutes

export function recordLogInteraction(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      LAST_LOG_INTERACTION_KEY,
      JSON.stringify({
        ts: Date.now(),
        calendarDate: getTodayIsoDate(),
      })
    );
  } catch {
    // Ignore storage access errors
  }
}

export function shouldAutoResetLogDateToToday(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(LAST_LOG_INTERACTION_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { ts?: number; calendarDate?: string } | number;
    const today = getTodayIsoDate();
    if (typeof parsed === 'number') {
      const lastDay = new Date(parsed).toISOString().slice(0, 10);
      return Date.now() - parsed >= LOG_INACTIVITY_RESET_MS || lastDay !== today;
    }
    if (!parsed || typeof parsed.ts !== 'number') return true;
    if (parsed.calendarDate && parsed.calendarDate !== today) return true;
    return Date.now() - parsed.ts >= LOG_INACTIVITY_RESET_MS;
  } catch {
    return true;
  }
}

export interface SafetySnapshot {
  timestamp: string;
  reason: string;
  wt_schedule: Record<string, DailySchedule>;
  wt_logs: WorkoutLog[];
  wt_programs: WorkoutProgram[];
  wt_context: ContextBlock[];
}

export interface SafetySnapshotMeta {
  timestamp: string;
  reason: string;
  scheduleDaysCount: number;
  logsCount: number;
  programsCount: number;
  contextCount: number;
}

export interface OfflineSyncQueue {
  firestoreSyncNeeded: boolean;
  googleTasksSyncNeeded: boolean;
  pendingCount: number;
  queuedAt?: string;
}

export interface BulkPresetPatch {
  programsMode?: 'no_change' | 'add' | 'remove' | 'replace';
  programIds?: string[];
  addTags?: string[];
  removeTags?: string[];
  category?: string;
  durationMode?: 'no_change' | 'set' | 'clear';
  durationMinutes?: number;
  biteSizeMode?: 'no_change' | 'on' | 'off';
  structureMode?:
    | 'no_change'
    | 'standard'
    | 'circuit'
    | 'emom_rotating'
    | 'emom_complex'
    | 'amrap';
  timeCapMinutes?: number;
  defaultRestSec?: number;
  defaultRounds?: number;
  defaultWorkSec?: number;
}

function isNavigatorOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function readSafetySnapshotMetaFromStorage(): SafetySnapshotMeta | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SAFETY_SNAPSHOT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SafetySnapshot>;
    if (!parsed || typeof parsed.timestamp !== 'string') return null;
    return {
      timestamp: parsed.timestamp,
      reason: parsed.reason || 'Automatic Pre-Reset Backup',
      scheduleDaysCount: Object.keys(parsed.wt_schedule || {}).length,
      logsCount: Array.isArray(parsed.wt_logs) ? parsed.wt_logs.length : 0,
      programsCount: Array.isArray(parsed.wt_programs) ? parsed.wt_programs.length : 0,
      contextCount: Array.isArray(parsed.wt_context) ? parsed.wt_context.length : 0,
    };
  } catch {
    return null;
  }
}

const ACTIVE_TAB_STORAGE_KEY = 'ironpulse_active_tab';
const VALID_APP_TABS: readonly AppTab[] = ['log', 'plan', 'library', 'history', 'settings'];

export function parseAppTab(raw: string | null | undefined): AppTab | null {
  if (!raw) return null;
  const normalized = raw.replace(/^#/, '').trim().toLowerCase();
  return (VALID_APP_TABS as readonly string[]).includes(normalized)
    ? (normalized as AppTab)
    : null;
}

function getInitialActiveTab(): AppTab {
  if (typeof window !== 'undefined') {
    const fromHash = parseAppTab(window.location.hash);
    if (fromHash) return fromHash;
    try {
      const fromStorage = parseAppTab(window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY));
      if (fromStorage) return fromStorage;
    } catch {
      // Ignore storage access errors
    }
  }
  return 'log';
}

export function persistActiveTab(tab: AppTab): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tab);
  } catch {
    // Ignore storage access errors
  }
  const targetHash = `#${tab}`;
  if (window.location.hash !== targetHash) {
    try {
      window.history.replaceState(
        null,
        '',
        `${window.location.pathname}${window.location.search}${targetHash}`
      );
    } catch {
      window.location.hash = targetHash;
    }
  }
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}

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
  contextBlocks: ContextBlock[];
  meta: UserMeta;
  categories: string[];

  // Auth & Sync state
  authUser: { uid: string; email: string | null; displayName: string | null; photoURL: string | null } | null;
  syncStatus: 'local' | 'syncing' | 'synced' | 'error';
  lastSyncError?: string;
  hasSeeded: boolean;
  hasSeededBiteSizePresets: boolean;
  hasCompletedCloudBootstrap: boolean;

  // Active Navigation & Log Floor state
  activeTab: AppTab;
  editingPresetUuid: string | null;
  presetEditorReturnTab: AppTab | null;
  viewportMode: 'auto' | 'mobile' | 'desktop';
  logLayoutMode: 'list' | 'cards';
  logDensityMode: 'compact' | 'detailed';
  activeDate: string;
  activeSessionGroupUuid: string;
  draftWorkouts: DraftWorkoutCard[];

  // Live Timer & Session Stopwatch
  timer: LiveTimerState;
  sessionStopwatchStartMs: number | null;
  sessionStopwatchAccumulatedMs: number;

  // Google Tasks Sync
  googleSyncStatus: GoogleSyncStatus;
  googleTokenExpiresAt: number | null;
  pendingGoogleTasksCount: number;
  pendingTaskCompletions: PendingTaskCompletion[];
  excludedFromTasksIds: string[];
  dismissedTaskCompletionIds: string[];
  tasksActionToast: { status: 'synced' | 'no-token'; message: string } | null;
  lastTasksSync: {
    timestamp: string;
    status: 'success' | 'failed';
    message?: string;
  } | null;

  // Offline Resilience & Pre-Reset Safety Snapshot
  isOnline: boolean;
  offlineSyncQueue: OfflineSyncQueue;
  safetySnapshotMeta: SafetySnapshotMeta | null;

  setOnlineStatus: (online: boolean) => void;
  queueOfflineSync: (kind: 'firestore' | 'tasks' | 'both') => void;
  flushOfflineSyncQueue: () => Promise<{ flushedFirestore: boolean; flushedTasks: boolean }>;
  saveSafetySnapshot: (reason: string) => SafetySnapshotMeta | null;
  restoreSafetySnapshot: () => Promise<{
    ok: boolean;
    reason?: string;
    timestamp?: string;
    error?: string;
  }>;
  importProgramCycle: (
    parsed: ParsedProgramCycleImport,
    mode: 'create_new' | 'replace_active'
  ) => {
    programTitle: string;
    cycleWeeks: number;
    presetsCount: number;
    autoFillResult?: { daysModified: number; itemsCreated: number };
  };

  // Navigation & Theme
  setActiveTab: (tab: AppTab) => void;
  openPresetEditor: (presetUuid: string, returnTab?: AppTab) => void;
  clearPresetEditor: () => void;
  setViewportMode: (mode: 'auto' | 'mobile' | 'desktop') => void;
  setLogLayoutMode: (mode: 'list' | 'cards') => void;
  setLogDensityMode: (mode: 'compact' | 'detailed') => void;
  clearSyncError: () => void;
  setTheme: (theme: ThemeMode) => void;
  setDefaultAutoStartRestTimer: (enabled: boolean) => void;
  setKeepScreenAwake: (enabled: boolean) => void;
  setTimerSoundEnabled: (enabled: boolean) => void;
  setDefaultDistanceUnit: (unit: DistanceUnit) => void;
  setActiveProgram: (programUuid?: string) => void;

  // Date & Gym Floor Session Actions
  setActiveDate: (date: string) => void;
  loadProgrammedForDate: (date?: string) => number;
  getProgramTemplatePreviewForDate: (date?: string) => {
    program: WorkoutProgram;
    cycleWeek: number;
    dayOfWeek: number;
    items: ProgramTemplateItem[];
  } | null;
  resetDateToProgramTemplate: (date?: string) => Promise<{
    ok: boolean;
    count: number;
    programTitle?: string;
    error?: string;
  }>;
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
    status?: 'completed' | 'skipped',
    alsoUpdatePreset?: boolean
  ) => Promise<{ ok: boolean; error?: string }>;
  setDraftWorkoutStatus: (logUuid: string, status: ScheduleStatus) => Promise<void>;
  resetDraftWorkoutToNotStarted: (logUuid: string) => Promise<void>;
  syncDraftToFirestore: (logUuid: string) => Promise<{ ok: boolean; error?: string }>;
  saveAllDraftWorkouts: () => Promise<void>;
  logBiteSizeWorkout: (
    presetUuid: string,
    options?: {
      date?: string;
      durationMinutes?: number;
      elapsedSeconds?: number;
      sessionNotes?: string;
      amrapRounds?: number;
      amrapExtraReps?: Record<string, number>;
      amrapTimeCapMinutes?: number;
    }
  ) => Promise<{ ok: boolean; log?: WorkoutLog }>;

  // Ghost Text & History Lookup
  getGhostExerciseData: (
    presetUuid: string,
    exerciseUuid: string,
    excludeLogUuid?: string,
    exerciseName?: string,
    trackingType?: string
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
  selectTimerMode: (
    mode: 'rest' | 'circuit',
    options?: {
      restSec?: number;
      rounds?: number;
      workSec?: number;
      circuitRestSec?: number;
    }
  ) => void;
  startRestTimer: (seconds: number) => void;
  startCircuitTimer: (rounds: number, workSec: number, restSec: number) => void;
  finishCircuitWorkRound: () => void;
  setTimerRounds: (rounds: number) => void;
  toggleTimerRunning: () => void;
  resetTimer: () => void;
  setTimerExpanded: (expanded: boolean) => void;
  closeTimer: () => void;
  tickTimer: () => { phaseChanged: boolean; finished: boolean; nextPhase?: 'work' | 'rest' };
  startSessionStopwatch: () => void;
  pauseSessionStopwatch: () => void;
  resetSessionStopwatch: () => void;

  // Google Tasks Sync Actions
  syncGoogleTasksRuntimeState: (runtime: GoogleTasksRuntimeState) => void;
  flushGoogleTasksQueue: () => Promise<number>;
  reconnectAndFlushGoogleTasks: () => Promise<{
    ok: boolean;
    pulled: number;
    pushed: number;
    rescheduled: number;
    error?: string;
  }>;
  checkCompletedTasksInbound: () => Promise<void>;
  runGoogleTasksSync: (interactive: boolean) => Promise<{
    ok: boolean;
    pulled: number;
    pushed: number;
    rescheduled: number;
    error?: string;
  }>;
  dismissPendingTaskCompletion: (scheduleItemUuid: string) => void;
  openPendingTaskInLog: (pending: PendingTaskCompletion) => void;
  quickCompletePendingTask: (pending: PendingTaskCompletion) => Promise<void>;

  // Preset & Exercise CRUD
  upsertPreset: (preset: WorkoutPreset) => void;
  bulkUpdatePresets: (
    presetUuids: string[],
    patch: BulkPresetPatch
  ) => Promise<{ updatedCount: number }>;
  duplicatePreset: (presetUuid: string) => WorkoutPreset | null;
  deletePreset: (presetUuid: string) => void;
  upsertGlobalExercise: (exercise: GlobalExercise) => void;
  addCategory: (name: string) => void;
  renameCategory: (oldName: string, newName: string) => void;
  deleteCategory: (name: string) => void;

  // Program & Schedule CRUD + Auto-Fill
  upsertProgram: (program: WorkoutProgram) => void;
  deleteProgram: (programUuid: string) => void;
  clearFutureScheduledWorkoutsForProgram: (programUuid: string) => {
    daysModified: number;
    itemsRemoved: number;
  };
  updateDailySchedule: (date: string, items: ScheduledItem[]) => void;
  setScheduledItemStatus: (
    date: string,
    scheduleItemUuid: string,
    status: ScheduleStatus
  ) => Promise<void>;
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
    conflictMode: 'replace' | 'update_matching' | 'skip',
    options?: { skipSafetySnapshot?: boolean }
  ) => { daysModified: number; itemsCreated: number };

  // Mitigating Factors / Schedule Context CRUD
  addContextBlock: (
    input: Omit<ContextBlock, 'id' | 'createdAt' | 'uid' | 'updatedAt'>,
    options?: { skipOverlappingPending?: boolean }
  ) => { block: ContextBlock; skippedCount: number };
  updateContextBlock: (
    id: string,
    patch: Partial<Omit<ContextBlock, 'id' | 'createdAt'>>,
    options?: { skipOverlappingPending?: boolean }
  ) => { skippedCount: number };
  deleteContextBlock: (id: string) => void;
  importContextBlocks: (blocks: ContextBlock[]) => void;

  // History Log Management
  deleteWorkoutLog: (logUuid: string) => Promise<void>;
  deleteLog: (logUuid: string) => Promise<void>;

  // Bulk Imports (AI JSON & Reconciled Legacy Google Sheet)
  applyAiImportPayload: (
    payload: AIImportPayload,
    options?: { skipSafetySnapshot?: boolean }
  ) => {
    presetsCount: number;
    programsCount: number;
    scheduleDaysCount: number;
  };
  applyAiNotesPatch: (
    patch: AiNotesPatchPayload,
    options?: { allowStructuralChanges?: boolean }
  ) => Promise<{
    ok: boolean;
    weeksUpdated: number;
    presetsUpdated: number;
    exercisesUpdated: number;
    schedulesUpdated: number;
    error?: string;
  }>;
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
  presetFormatMode?: PresetFormatMode,
  presetRounds?: number,
  emomMode?: 'rotating' | 'complex'
): LoggedExercise {
  const effectiveRounds = presetRounds || Number(pe.defaultSets) || 3;
  const isComplexAllMovesPerRound =
    presetFormatMode === 'emom_complex' && emomMode !== 'rotating';
  const numSets =
    isComplexAllMovesPerRound || presetFormatMode === 'amrap'
      ? 0
      : presetFormatMode === 'circuit'
      ? Math.max(1, Number(pe.defaultSets) || effectiveRounds)
      : presetFormatMode === 'emom_complex' && emomMode === 'rotating'
      ? Math.max(1, Number(pe.defaultSets) || 1)
      : Math.max(1, Number(pe.defaultSets) || 3);
  const parsedDefaultRep = parseInt(String(pe.defaultReps).replace(/[^0-9]/g, ''), 10) || 0;
  const sets: SetEntry[] =
    pe.trackingType === 'cardio' || pe.trackingType === 'mobility' || numSets === 0
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
    metricType: pe.metricType || inferDefaultMetricType(pe.exerciseName),
    weight: Number(pe.defaultWeight) || 0,
    secondaryWeightKg:
      pe.secondaryWeightKg !== undefined ? Number(pe.secondaryWeightKg) || 0 : undefined,
    side: pe.side,
    isPerSide: pe.isPerSide,
    targetRir: pe.targetRir,
    restSecOverride: pe.restSecOverride,
    groupId: pe.groupId,
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
    durationSec:
      pe.trackingType === 'mobility'
        ? resolveMobilityDurationSeconds(pe) || undefined
        : undefined,
    isCompleted: pe.trackingType === 'mobility' ? false : undefined,
    distanceUnit: pe.defaultDistanceUnit || defaultDistanceUnit || 'mi',
    ruckLoadKg: pe.loadType === 'ruck_kg' ? Number(pe.defaultWeight) || 20 : undefined,
    exerciseNotes:
      pe.baseNotes ||
      (pe.trackingType === 'mobility'
        ? ''
        : parsedDefaultRep
        ? `Target: ${effectiveRounds}x${pe.defaultReps}`
        : ''),
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
    exerciseNotesByUid?: Record<string, string>;
    exerciseNotesByIndex?: Record<string, string>;
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

  const emomMode =
    formatMode === 'emom_complex'
      ? preset.defaultTimer?.emomMode || 'complex'
      : undefined;

  const targetRounds =
    formatMode !== 'standard'
      ? preset.defaultTimer?.rounds ||
        ladderRungCount ||
        (emomMode === 'rotating' ? Math.max(1, preset.exercises.length) : preset.exercises[0]?.defaultSets || 10)
      : ladderRungCount;

  const exercises = preset.exercises.map((pe, idx) => {
    const built = buildLoggedExerciseFromPreset(
      pe,
      defaultDistanceUnit,
      formatMode,
      targetRounds,
      emomMode
    );
    const sessionExNote =
      options?.exerciseNotesByUid?.[pe.exerciseUuid] ??
      options?.exerciseNotesByIndex?.[String(idx)];
    return sessionExNote ? { ...built, exerciseNotes: sessionExNote } : built;
  });
  const isAmrapPreset = formatMode === 'amrap';
  const amrapTimeCapMinutes = isAmrapPreset
    ? preset.defaultTimer?.timeCapMinutes || preset.durationMinutes || 10
    : undefined;

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
    emomMode,
    targetRounds,
    completedRounds: formatMode === 'emom_complex' && emomMode !== 'rotating' ? 0 : undefined,
    amrapRounds: isAmrapPreset ? 0 : undefined,
    amrapExtraReps: isAmrapPreset ? {} : undefined,
    amrapTimeCapMinutes,
    programUuid: options?.programUuid || preset.programIds?.[0],
    scheduleItemUuid: options?.scheduleItemUuid,
    videoUrl: preset.videoUrl,
    durationMinutes: amrapTimeCapMinutes ?? preset.durationMinutes,
    isBiteSize: preset.isBiteSize,
    status: 'pending',
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

function hasLoggedWorkoutData(
  log: Pick<
    WorkoutLog,
    'exercises' | 'completedRounds' | 'amrapRounds' | 'amrapExtraReps' | 'durationSec' | 'elapsedSeconds'
  >
): boolean {
  if ((log.completedRounds ?? 0) > 0) return true;
  if ((log.amrapRounds ?? 0) > 0) return true;
  if (
    log.amrapExtraReps &&
    Object.values(log.amrapExtraReps).some((v) => (Number(v) || 0) > 0)
  ) {
    return true;
  }
  if ((log.durationSec ?? 0) > 0 || (log.elapsedSeconds ?? 0) > 0) return true;
  return (log.exercises || []).some(
    (ex) =>
      ex.sets?.some((s) => (Number(s.reps) || 0) > 0) ||
      ex.isCompleted === true ||
      (Number(ex.distance) || 0) > 0 ||
      (Number(ex.durationSec) || 0) > 0
  );
}

function rebuildLogFromScheduledPreset(
  existingLog: WorkoutLog,
  item: ScheduledItem,
  preset: WorkoutPreset,
  defaultDistanceUnit: DistanceUnit,
  now: string
): WorkoutLog {
  const freshDraft = createDraftFromPreset(
    preset,
    existingLog.date,
    existingLog.sessionGroupUuid,
    item.orderIndex,
    parseInt(existingLog.displayId.replace('ID-', ''), 10) || 1,
    defaultDistanceUnit,
    {
      scheduleItemUuid: item.scheduleItemUuid,
      programUuid: item.programUuid || preset.programIds?.[0],
      coachNotes: item.coachNotes,
      slotRole: item.slotRole,
      exerciseNotesByUid: item.exerciseNotesByUid,
      exerciseNotesByIndex: item.exerciseNotesByIndex,
    }
  );
  const status = normalizeScheduleStatus(item.status);
  return {
    ...freshDraft,
    logUuid: existingLog.logUuid,
    uid: existingLog.uid,
    displayId: existingLog.displayId,
    legacyId: existingLog.legacyId,
    status,
    createdAt: existingLog.createdAt || now,
    updatedAt: item.updatedAt || now,
  };
}

function scoreLogForDedup(log: WorkoutLog): [number, number, string] {
  const status = normalizeLogStatus(log.status);
  const hasData = hasLoggedWorkoutData(log);
  const statusRank =
    status === 'completed'
      ? 4
      : status === 'in_progress' && hasData
      ? 3
      : status === 'in_progress' || hasData
      ? 2
      : status === 'skipped'
      ? 1
      : 0;

  let loggedPoints = (log.completedRounds ?? 0) + (log.durationSec ? 1 : 0);
  for (const ex of log.exercises || []) {
    loggedPoints += (ex.sets || []).filter((s) => (Number(s.reps) || 0) > 0).length;
    if (ex.isCompleted) loggedPoints += 1;
    if ((Number(ex.distance) || 0) > 0) loggedPoints += 1;
    if ((Number(ex.durationSec) || 0) > 0) loggedPoints += 1;
  }

  return [statusRank, loggedPoints, log.updatedAt || log.createdAt || ''];
}

function isBetterLogCandidate(a: WorkoutLog, b: WorkoutLog): boolean {
  const [rankA, ptsA, tsA] = scoreLogForDedup(a);
  const [rankB, ptsB, tsB] = scoreLogForDedup(b);
  if (rankA !== rankB) return rankA > rankB;
  if (ptsA !== ptsB) return ptsA > ptsB;
  return tsA > tsB;
}

/**
 * Deduplicates duplicate staged/logged wt_logs entries on the same date sharing the same
 * scheduleItemUuid or (date + presetUuid / normalized workout title), keeping the single
 * highest-progress entry (`completed` > `in_progress` with logged data > latest `updatedAt`).
 */
function deduplicateLogs(
  logs: WorkoutLog[],
  schedules: Record<string, DailySchedule>
): { logs: WorkoutLog[]; removedDuplicateLogUuids: string[] } {
  const normalized = (logs || []).map((l) => normalizeWorkoutLog(l));
  const removed = new Set<string>();

  // Pass 1: Deduplicate identical (date, scheduleItemUuid)
  const byScheduleKey = new Map<string, WorkoutLog>();
  const afterPass1: WorkoutLog[] = [];
  for (const log of normalized) {
    if (log.scheduleItemUuid) {
      const key = `${log.date}::sched::${log.scheduleItemUuid}`;
      const existing = byScheduleKey.get(key);
      if (existing) {
        if (isBetterLogCandidate(log, existing)) {
          removed.add(existing.logUuid);
          byScheduleKey.set(key, log);
        } else {
          removed.add(log.logUuid);
        }
        continue;
      }
      byScheduleKey.set(key, log);
    }
    afterPass1.push(log);
  }
  const pass1List = afterPass1.map((l) => {
    if (l.scheduleItemUuid) {
      return byScheduleKey.get(`${l.date}::sched::${l.scheduleItemUuid}`) || l;
    }
    return l;
  });

  // Pass 2: Deduplicate repeated copies of the same workout (date + presetUuid/title)
  // while respecting intentional multi-slot duplicates if a date's schedule literally lists
  // the same presetUuid more than once, and preserving all Bite-Size movement snacks.
  const groupedByDateWorkout = new Map<string, WorkoutLog[]>();
  const keepIds = new Set<string>();
  for (const log of pass1List) {
    if (removed.has(log.logUuid)) continue;
    if (log.isBiteSize || log.slotRole === 'Bite-Size') {
      keepIds.add(log.logUuid);
      continue;
    }
    const workoutKey =
      log.presetUuid || (log.workoutTitleSnapshot || '').trim().toLowerCase() || log.logUuid;
    const key = `${log.date}::wkt::${workoutKey}`;
    const list = groupedByDateWorkout.get(key);
    if (list) {
      list.push(log);
    } else {
      groupedByDateWorkout.set(key, [log]);
    }
  }

  for (const [key, group] of groupedByDateWorkout.entries()) {
    if (group.length === 1) {
      keepIds.add(group[0].logUuid);
      continue;
    }
    const [date, , workoutKey] = key.split('::');
    const scheduledCount = (schedules[date]?.items || []).filter(
      (it) => it.presetUuid === workoutKey
    ).length;
    const maxAllowed = Math.max(1, scheduledCount);
    const activeSchedIds = new Set(
      (schedules[date]?.items || []).map((it) => it.scheduleItemUuid)
    );

    const sorted = [...group].sort((a, b) => {
      if (isBetterLogCandidate(a, b)) return -1;
      if (isBetterLogCandidate(b, a)) return 1;
      // Tie-breaker: prefer a log whose scheduleItemUuid still exists in today's schedule
      const aInSched = a.scheduleItemUuid && activeSchedIds.has(a.scheduleItemUuid) ? 1 : 0;
      const bInSched = b.scheduleItemUuid && activeSchedIds.has(b.scheduleItemUuid) ? 1 : 0;
      return bInSched - aInSched;
    });

    sorted.forEach((entry, idx) => {
      if (idx < maxAllowed) {
        keepIds.add(entry.logUuid);
      } else {
        removed.add(entry.logUuid);
      }
    });
  }

  const dedupedLogs = pass1List.filter(
    (l) => keepIds.has(l.logUuid) && !removed.has(l.logUuid)
  );
  return {
    logs: dedupedLogs,
    removedDuplicateLogUuids: Array.from(removed),
  };
}

function reconcileSchedulesAndLogs(
  schedules: Record<string, DailySchedule>,
  logs: WorkoutLog[],
  presets: WorkoutPreset[],
  defaultDistanceUnit: DistanceUnit
): {
  schedules: Record<string, DailySchedule>;
  logs: WorkoutLog[];
  modifiedScheduleDates: string[];
  modifiedLogUuids: string[];
  removedDuplicateLogUuids: string[];
} {
  const now = new Date().toISOString();
  const nextSchedules: Record<string, DailySchedule> = {};
  for (const [dateKey, sch] of Object.entries(schedules || {})) {
    if (sch) nextSchedules[dateKey] = normalizeDailySchedule(sch);
  }
  const deduped = deduplicateLogs(logs || [], nextSchedules);
  const nextLogs = deduped.logs;
  const modifiedScheduleDates = new Set<string>();
  const modifiedLogUuids = new Set<string>();

  for (const [date, daySched] of Object.entries(nextSchedules)) {
    const matchedLogIndices = new Set<number>();
    let dayChanged = false;

    const updatedItems = daySched.items.map((item) => {
      // Match log by scheduleItemUuid -> linkedLogUuid -> same date + presetUuid (even if stale scheduleItemUuid)
      let logIdx = nextLogs.findIndex(
        (l, idx) => !matchedLogIndices.has(idx) && l.scheduleItemUuid === item.scheduleItemUuid
      );
      if (logIdx === -1 && item.linkedLogUuid) {
        logIdx = nextLogs.findIndex(
          (l, idx) => !matchedLogIndices.has(idx) && l.logUuid === item.linkedLogUuid
        );
      }
      if (logIdx === -1) {
        logIdx = nextLogs.findIndex(
          (l, idx) =>
            !matchedLogIndices.has(idx) &&
            l.date === date &&
            l.presetUuid === item.presetUuid
        );
      }
      if (logIdx === -1) return item;
      matchedLogIndices.add(logIdx);

      let log = nextLogs[logIdx];
      let nextItem = item;
      let logChanged = false;

      if (log.scheduleItemUuid !== item.scheduleItemUuid) {
        log = { ...log, scheduleItemUuid: item.scheduleItemUuid };
        logChanged = true;
      }
      if (nextItem.linkedLogUuid !== log.logUuid) {
        nextItem = { ...nextItem, linkedLogUuid: log.logUuid };
        dayChanged = true;
      }

      const logHasData = hasLoggedWorkoutData(log);
      let logStatus = normalizeLogStatus(log.status);
      let schedStatus = normalizeScheduleStatus(nextItem.status);

      // If log is still an empty 'pending' draft whose preset differs from wt_schedule, align to wt_schedule
      if (logStatus === 'pending' && !logHasData && log.presetUuid !== nextItem.presetUuid) {
        const scheduledPreset = presets.find((p) => p.presetUuid === nextItem.presetUuid);
        if (scheduledPreset) {
          log = rebuildLogFromScheduledPreset(
            log,
            nextItem,
            scheduledPreset,
            defaultDistanceUnit,
            now
          );
          logStatus = normalizeLogStatus(log.status);
          logChanged = true;
        }
      }

      // If log has actual logged sets/duration while both sides are still 'pending', promote to 'in_progress'
      if (logHasData && logStatus === 'pending' && schedStatus === 'pending') {
        const ts = log.updatedAt || now;
        log = { ...log, status: 'in_progress', updatedAt: ts };
        nextItem = { ...nextItem, status: 'in_progress', completed: false, updatedAt: ts };
        logStatus = 'in_progress';
        schedStatus = 'in_progress';
        logChanged = true;
        dayChanged = true;
      }

      if (logStatus !== schedStatus) {
        const logTs = log.updatedAt || log.createdAt || '';
        const schedTs = nextItem.updatedAt || daySched.updatedAt || '';

        if (logHasData && logStatus === 'in_progress' && schedStatus === 'pending' && schedTs <= logTs) {
          nextItem = {
            ...nextItem,
            status: 'in_progress',
            completed: false,
            updatedAt: logTs || now,
          };
          dayChanged = true;
        } else if (schedTs > logTs) {
          log = { ...log, status: schedStatus, updatedAt: schedTs };
          logChanged = true;
        } else {
          nextItem = {
            ...nextItem,
            status: logStatus,
            completed: logStatus === 'completed',
            updatedAt: logTs || now,
          };
          dayChanged = true;
        }
      }

      if (logChanged) {
        nextLogs[logIdx] = log;
        modifiedLogUuids.add(log.logUuid);
      }
      return nextItem;
    });

    if (dayChanged) {
      nextSchedules[date] = {
        ...daySched,
        items: updatedItems,
        updatedAt: daySched.updatedAt || now,
      };
      modifiedScheduleDates.add(date);
    }
  }

  return {
    schedules: nextSchedules,
    logs: nextLogs,
    modifiedScheduleDates: Array.from(modifiedScheduleDates),
    modifiedLogUuids: Array.from(modifiedLogUuids),
    removedDuplicateLogUuids: deduped.removedDuplicateLogUuids,
  };
}

function buildInitialDraftsForDate(
  date: string,
  logs: WorkoutLog[],
  schedules: Record<string, DailySchedule>,
  presets: WorkoutPreset[],
  meta: UserMeta
): { sessionGroupUuid: string; drafts: DraftWorkoutCard[] } {
  const dedupedForDate = deduplicateLogs(
    logs.filter((l) => l.date === date),
    schedules
  ).logs;
  const existingLogsForDate = dedupedForDate.sort(
    (a, b) => (a.chainOrderIndex ?? 0) - (b.chainOrderIndex ?? 0)
  );

  const daySchedule = schedules[date];
  const sortedScheduledItems = (daySchedule?.items || [])
    .slice()
    .sort((a, b) => a.orderIndex - b.orderIndex);

  if (existingLogsForDate.length > 0) {
    const groupUuid = existingLogsForDate[0].sessionGroupUuid || `ses-${uuidv4()}`;
    const matchedSchedIds = new Set<string>();

    const drafts: DraftWorkoutCard[] = existingLogsForDate.map((l, idx) => {
      const normalizedStatus = normalizeLogStatus(l.status);
      const isBiteSizeLog = Boolean(l.isBiteSize || l.slotRole === 'Bite-Size');
      const linkedSched = isBiteSizeLog
        ? undefined
        : sortedScheduledItems.find(
            (it) =>
              !matchedSchedIds.has(it.scheduleItemUuid) &&
              (it.linkedLogUuid === l.logUuid || it.scheduleItemUuid === l.scheduleItemUuid)
          ) ||
          sortedScheduledItems.find(
            (it) =>
              !matchedSchedIds.has(it.scheduleItemUuid) &&
              (it.presetUuid === l.presetUuid || it.orderIndex === (l.chainOrderIndex ?? idx))
          );

      if (linkedSched) {
        matchedSchedIds.add(linkedSched.scheduleItemUuid);
      }

      // If this log is an empty 'pending' draft (0 sets/duration) and wt_schedule now points
      // to a different preset (e.g. swapped Easy Cycle -> Easy Ruck in Plan), keep it aligned.
      const logHasData = hasLoggedWorkoutData(l);
      if (
        linkedSched &&
        normalizedStatus === 'pending' &&
        !logHasData &&
        l.presetUuid !== linkedSched.presetUuid
      ) {
        const schedPreset = presets.find((p) => p.presetUuid === linkedSched.presetUuid);
        if (schedPreset) {
          const rebuilt = createDraftFromPreset(
            schedPreset,
            date,
            groupUuid,
            linkedSched.orderIndex,
            parseInt(l.displayId.replace('ID-', ''), 10) || meta.nextLogSequenceNumber,
            meta.defaultDistanceUnit,
            {
              scheduleItemUuid: linkedSched.scheduleItemUuid,
              programUuid: linkedSched.programUuid,
              coachNotes: linkedSched.coachNotes,
              slotRole: linkedSched.slotRole,
              exerciseNotesByUid: linkedSched.exerciseNotesByUid,
              exerciseNotesByIndex: linkedSched.exerciseNotesByIndex,
            }
          );
          const schedStatus = normalizeScheduleStatus(linkedSched.status);
          return {
            ...rebuilt,
            logUuid: l.logUuid,
            displayId: l.displayId,
            status: schedStatus,
            isSaved: schedStatus === 'completed' || schedStatus === 'skipped',
          };
        }
      }

      // If linkedSched has a strictly newer status timestamp, reflect it cleanly
      let effectiveStatus = normalizedStatus;
      if (linkedSched) {
        const schedStatus = normalizeScheduleStatus(linkedSched.status);
        const schedTs = linkedSched.updatedAt || daySchedule?.updatedAt || '';
        const logTs = l.updatedAt || l.createdAt || '';
        if (schedStatus !== normalizedStatus && schedTs > logTs) {
          effectiveStatus = schedStatus;
        }
      }

      const matchedPresetForDraft = presets.find((p) => p.presetUuid === l.presetUuid);
      return {
        ...JSON.parse(JSON.stringify(l)),
        scheduleItemUuid: linkedSched?.scheduleItemUuid || l.scheduleItemUuid,
        status: effectiveStatus,
        isSaved: effectiveStatus === 'completed' || effectiveStatus === 'skipped',
        coachNotes: linkedSched?.coachNotes,
        slotRole:
          l.slotRole || linkedSched?.slotRole || (idx === 0 ? 'Primary' : `Chained #${idx + 1}`),
        isBiteSize: isBiteSizeLog || undefined,
        emomMode: l.emomMode || matchedPresetForDraft?.defaultTimer?.emomMode,
        videoUrl: l.videoUrl || matchedPresetForDraft?.videoUrl,
        durationMinutes: l.durationMinutes ?? matchedPresetForDraft?.durationMinutes,
        updatePresetOnSave: false,
      };
    });

    // Also include any newly added scheduled items on this date that do not have a log yet
    let seq = meta.nextLogSequenceNumber + drafts.length;
    sortedScheduledItems.forEach((item, idx) => {
      if (matchedSchedIds.has(item.scheduleItemUuid)) return;
      const preset = presets.find((p) => p.presetUuid === item.presetUuid);
      if (!preset) return;
      const itemStatus = normalizeScheduleStatus(item.status);
      const built = createDraftFromPreset(
        preset,
        date,
        groupUuid,
        idx,
        seq++,
        meta.defaultDistanceUnit,
        {
          scheduleItemUuid: item.scheduleItemUuid,
          programUuid: item.programUuid,
          coachNotes: item.coachNotes,
          slotRole: item.slotRole,
          exerciseNotesByUid: item.exerciseNotesByUid,
          exerciseNotesByIndex: item.exerciseNotesByIndex,
        }
      );
      drafts.push({
        ...built,
        status: itemStatus,
        isSaved: itemStatus === 'completed' || itemStatus === 'skipped',
      });
    });

    return { sessionGroupUuid: groupUuid, drafts };
  }

  // If no logs exist for this date, check if there are scheduled items for today
  const groupUuid = `ses-${uuidv4()}`;
  if (sortedScheduledItems.length > 0) {
    let seq = meta.nextLogSequenceNumber;
    const drafts: DraftWorkoutCard[] = [];
    sortedScheduledItems.forEach((item, idx) => {
      const itemStatus = normalizeScheduleStatus(item.status);
      const preset = presets.find((p) => p.presetUuid === item.presetUuid);
      if (preset) {
        const built = createDraftFromPreset(
          preset,
          date,
          groupUuid,
          idx,
          seq++,
          meta.defaultDistanceUnit,
          {
            scheduleItemUuid: item.scheduleItemUuid,
            programUuid: item.programUuid,
            coachNotes: item.coachNotes,
            slotRole: item.slotRole,
            exerciseNotesByUid: item.exerciseNotesByUid,
            exerciseNotesByIndex: item.exerciseNotesByIndex,
          }
        );
        drafts.push({
          ...built,
          status: itemStatus,
          isSaved: itemStatus === 'completed' || itemStatus === 'skipped',
        });
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
  const isAmrapDraft =
    draft.formatMode === 'amrap' ||
    draft.amrapRounds !== undefined ||
    draft.amrapTimeCapMinutes !== undefined;
  const amrapComputed = isAmrapDraft
    ? computeAmrapExercises(draft.exercises, draft.amrapRounds ?? 0, draft.amrapExtraReps || {})
    : null;
  const recalcedExercises = amrapComputed
    ? amrapComputed.exercises
    : draft.exercises.map((ex) => recalculateLoggedExercise(ex));
  const totalSessionVolumeKg = amrapComputed
    ? amrapComputed.totalSessionVolumeKg
    : Math.round(
        recalcedExercises.reduce((acc, ex) => acc + (Number(ex.totalLoadKg) || 0), 0) * 10
      ) / 10;

  const normalized = normalizeLogStatus(draft.status);
  const effectiveStatus: LogStatus = draft.isSaved
    ? normalized === 'skipped'
      ? 'skipped'
      : 'completed'
    : normalized === 'in_progress'
    ? 'in_progress'
    : 'pending';

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
    emomMode: draft.emomMode,
    targetRounds: draft.targetRounds,
    completedRounds: draft.completedRounds,
    amrapRounds: draft.amrapRounds,
    amrapExtraReps: draft.amrapExtraReps,
    amrapTimeCapMinutes: draft.amrapTimeCapMinutes,
    laddersCompleted: draft.laddersCompleted,
    extraRungs: draft.extraRungs,
    programUuid: draft.programUuid,
    scheduleItemUuid: draft.scheduleItemUuid,
    slotRole: draft.slotRole,
    isBiteSize: draft.isBiteSize,
    videoUrl: draft.videoUrl,
    status: effectiveStatus,
    sessionNotes: draft.sessionNotes,
    totalSessionVolumeKg,
    durationSec: draft.durationSec,
    durationMinutes: draft.durationMinutes,
    elapsedSeconds: draft.elapsedSeconds,
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

function collectUsedCategories(
  baseCategories: string[],
  presets: WorkoutPreset[],
  logs: WorkoutLog[],
  metaCategories?: string[]
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  const pushUnique = (cat?: string) => {
    const trimmed = (cat || '').trim();
    if (!trimmed) return;
    if (!seen.has(trimmed.toLowerCase())) {
      seen.add(trimmed.toLowerCase());
      result.push(trimmed);
    }
  };
  for (const c of metaCategories && metaCategories.length > 0
    ? metaCategories
    : baseCategories.length > 0
    ? baseCategories
    : DEFAULT_WORKOUT_CATEGORIES) {
    pushUnique(c);
  }
  for (const p of presets) pushUnique(p.workoutType);
  for (const l of logs) pushUnique(l.workoutType);
  return result.length > 0 ? result : [...DEFAULT_WORKOUT_CATEGORIES];
}

const EMPTY_SESSION_UUID = 'ses-initial';

function normalizePresetMobilityDurations(preset: WorkoutPreset): WorkoutPreset {
  if (!Array.isArray(preset.exercises) || preset.exercises.length === 0) return preset;
  let changed = false;
  const normalizedExercises = preset.exercises.map((ex) => {
    if (ex.trackingType !== 'mobility') return ex;
    if (ex.durationSeconds === undefined && typeof ex.defaultDurationMin === 'number') {
      changed = true;
      const convertedSec = resolveMobilityDurationSeconds(ex);
      const { defaultDurationMin: _legacyMin, ...rest } = ex;
      void _legacyMin;
      return {
        ...rest,
        durationSeconds: convertedSec,
      };
    }
    return ex;
  });
  return changed ? { ...preset, exercises: normalizedExercises } : preset;
}

function sortPresetsAlphabetically(presets: WorkoutPreset[]): WorkoutPreset[] {
  return [...presets]
    .map((p) => normalizePresetMobilityDurations(p))
    .sort((a, b) =>
      (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
    );
}

/**
 * Ensures the 5 default Bite-Size / Movement Snack presets exist (matched by normalized title)
 * without overwriting or duplicating any user-customized presets.
 */
function mergeDefaultBiteSizePresets(existingPresets: WorkoutPreset[]): {
  presets: WorkoutPreset[];
  added: WorkoutPreset[];
} {
  const existingTitles = new Set(
    (existingPresets || []).map((p) => (p.title || '').trim().toLowerCase())
  );
  const existingIds = new Set((existingPresets || []).map((p) => p.presetUuid));
  const added: WorkoutPreset[] = [];
  for (const seed of DEFAULT_BITE_SIZE_PRESETS) {
    const normTitle = seed.title.trim().toLowerCase();
    if (!existingTitles.has(normTitle) && !existingIds.has(seed.presetUuid)) {
      added.push(seed);
    }
  }
  if (added.length === 0) {
    return { presets: existingPresets, added: [] };
  }
  return {
    presets: sortPresetsAlphabetically([...existingPresets, ...added]),
    added,
  };
}

export const useWorkoutStore = create<WorkoutStoreState>()(
  persist(
    (set, get) => ({
      exercises: [],
      presets: [],
      programs: [],
      schedules: {},
      logs: [],
      contextBlocks: [],
      meta: SEED_META,
      categories: [...DEFAULT_WORKOUT_CATEGORIES],

      authUser: null,
      syncStatus: 'local',
      hasSeeded: false,
      hasSeededBiteSizePresets: false,
      hasCompletedCloudBootstrap: false,

      activeTab: getInitialActiveTab(),
      editingPresetUuid: null,
      presetEditorReturnTab: null,
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
      sessionStopwatchStartMs: null,
      sessionStopwatchAccumulatedMs: 0,
      googleSyncStatus: getGoogleTasksRuntimeState().googleSyncStatus,
      googleTokenExpiresAt: getGoogleTasksRuntimeState().googleTokenExpiresAt,
      pendingGoogleTasksCount: getGoogleTasksRuntimeState().pendingOpsCount,
      pendingTaskCompletions: [],
      excludedFromTasksIds: [],
      dismissedTaskCompletionIds: [],
      tasksActionToast: null,
      lastTasksSync: null,

      isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
      offlineSyncQueue: {
        firestoreSyncNeeded: false,
        googleTasksSyncNeeded: false,
        pendingCount: 0,
      },
      safetySnapshotMeta: readSafetySnapshotMetaFromStorage(),

      setOnlineStatus: (online) => {
        set({ isOnline: online });
      },

      queueOfflineSync: (kind) => {
        const prev = get().offlineSyncQueue;
        const nowIso = new Date().toISOString();
        set({
          offlineSyncQueue: {
            firestoreSyncNeeded:
              prev.firestoreSyncNeeded || kind === 'firestore' || kind === 'both',
            googleTasksSyncNeeded:
              prev.googleTasksSyncNeeded || kind === 'tasks' || kind === 'both',
            pendingCount: prev.pendingCount + 1,
            queuedAt: prev.queuedAt || nowIso,
          },
        });
      },

      flushOfflineSyncQueue: async () => {
        if (isNavigatorOffline()) {
          return { flushedFirestore: false, flushedTasks: false };
        }
        const state = get();
        const queue = state.offlineSyncQueue;
        const hasPendingTaskOps = getPendingSingleTaskOpsCount() > 0;
        if (
          !queue.firestoreSyncNeeded &&
          !queue.googleTasksSyncNeeded &&
          queue.pendingCount === 0 &&
          !hasPendingTaskOps
        ) {
          return { flushedFirestore: false, flushedTasks: false };
        }

        let flushedFirestore = false;
        let flushedTasks = false;

        if (queue.firestoreSyncNeeded && state.authUser) {
          const pushRes = await get().pushLocalToCloud();
          if (pushRes.ok) {
            await get().syncWithFirestore();
            flushedFirestore = true;
          }
        } else if (!state.authUser) {
          flushedFirestore = true;
        }

        if (queue.googleTasksSyncNeeded || hasPendingTaskOps) {
          const flushedOpsCount = await flushQueuedSingleTaskOps();
          if (getCachedGoogleTasksToken()) {
            const tasksRes = await get().runGoogleTasksSync(false);
            if (tasksRes.ok) {
              flushedTasks = true;
            }
          } else if (flushedOpsCount > 0 && getPendingSingleTaskOpsCount() === 0) {
            flushedTasks = true;
          }
        }

        const stillNeedsFirestore = queue.firestoreSyncNeeded && !flushedFirestore;
        const stillNeedsTasks =
          (queue.googleTasksSyncNeeded || getPendingSingleTaskOpsCount() > 0) && !flushedTasks;

        set({
          offlineSyncQueue: {
            firestoreSyncNeeded: stillNeedsFirestore,
            googleTasksSyncNeeded: stillNeedsTasks,
            pendingCount: stillNeedsFirestore || stillNeedsTasks ? queue.pendingCount : 0,
            queuedAt: stillNeedsFirestore || stillNeedsTasks ? queue.queuedAt : undefined,
          },
          ...(flushedFirestore || flushedTasks
            ? {
                tasksActionToast: {
                  status: 'synced',
                  message: '✓ Back online — synced queued offline changes',
                },
              }
            : {}),
        });
        if (flushedFirestore || flushedTasks) {
          setTimeout(() => set({ tasksActionToast: null }), 3500);
        }

        return { flushedFirestore, flushedTasks };
      },

      saveSafetySnapshot: (reason) => {
        if (typeof window === 'undefined') return null;
        try {
          const state = get();
          const snapshot: SafetySnapshot = {
            timestamp: new Date().toISOString(),
            reason,
            wt_schedule: state.schedules,
            wt_logs: state.logs,
            wt_programs: state.programs,
            wt_context: state.contextBlocks,
          };
          window.localStorage.setItem(SAFETY_SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
          const meta: SafetySnapshotMeta = {
            timestamp: snapshot.timestamp,
            reason: snapshot.reason,
            scheduleDaysCount: Object.keys(snapshot.wt_schedule).length,
            logsCount: snapshot.wt_logs.length,
            programsCount: snapshot.wt_programs.length,
            contextCount: snapshot.wt_context.length,
          };
          set({ safetySnapshotMeta: meta });
          return meta;
        } catch (err) {
          console.error('[SafetySnapshot] Failed to save snapshot to localStorage:', err);
          return null;
        }
      },

      restoreSafetySnapshot: async () => {
        if (typeof window === 'undefined') {
          return { ok: false, error: 'Storage unavailable.' };
        }
        try {
          const raw = window.localStorage.getItem(SAFETY_SNAPSHOT_STORAGE_KEY);
          if (!raw) {
            return { ok: false, error: 'No safety snapshot found.' };
          }
          const parsed = JSON.parse(raw) as Partial<SafetySnapshot>;
          if (!parsed || typeof parsed.timestamp !== 'string') {
            return { ok: false, error: 'Safety snapshot is corrupted.' };
          }

          const state = get();
          const restoredSchedules = parsed.wt_schedule || {};
          const restoredLogs = Array.isArray(parsed.wt_logs) ? parsed.wt_logs : [];
          const restoredPrograms = Array.isArray(parsed.wt_programs)
            ? parsed.wt_programs
            : state.programs;
          const restoredContext = Array.isArray(parsed.wt_context)
            ? parsed.wt_context
            : state.contextBlocks;

          const reconciled = reconcileSchedulesAndLogs(
            restoredSchedules,
            restoredLogs,
            state.presets,
            state.meta.defaultDistanceUnit
          );
          const refreshedFloor = buildInitialDraftsForDate(
            state.activeDate,
            reconciled.logs,
            reconciled.schedules,
            state.presets,
            state.meta
          );

          const activeStillExists = restoredPrograms.some(
            (p) => p.programUuid === state.meta.activeProgramUuid
          );
          const nextMeta: UserMeta = activeStillExists
            ? state.meta
            : {
                ...state.meta,
                activeProgramUuid: restoredPrograms[0]?.programUuid,
                updatedAt: new Date().toISOString(),
              };

          set({
            schedules: reconciled.schedules,
            logs: reconciled.logs,
            programs: restoredPrograms,
            contextBlocks: restoredContext,
            meta: nextMeta,
            activeSessionGroupUuid: refreshedFloor.sessionGroupUuid,
            draftWorkouts: refreshedFloor.drafts,
          });

          if (isNavigatorOffline()) {
            get().queueOfflineSync('both');
          } else if (state.authUser) {
            await get().pushLocalToCloud();
          }

          return {
            ok: true,
            reason: parsed.reason,
            timestamp: parsed.timestamp,
          };
        } catch (err) {
          return {
            ok: false,
            error: getErrorMessage(err, 'Failed to restore safety snapshot.'),
          };
        }
      },

      importProgramCycle: (parsed, mode) => {
        get().saveSafetySnapshot('Import Program & Cycle');
        const now = new Date().toISOString();

        // 1. Upsert any optional new/updated preset workouts first
        let presetsCount = 0;
        if (parsed.presets.length > 0) {
          const presetPayload: AIImportPayload = {
            mode: 'update',
            presets: parsed.presets,
          };
          const res = get().applyAiImportPayload(presetPayload, { skipSafetySnapshot: true });
          presetsCount = res.presetsCount;
        }

        const latestState = get();
        const activeProgram =
          latestState.programs.find(
            (p) => p.programUuid === latestState.meta.activeProgramUuid
          ) || null;

        let targetProgram: WorkoutProgram;
        if (mode === 'replace_active' && activeProgram) {
          targetProgram = {
            ...activeProgram,
            title: parsed.programName || activeProgram.title,
            description:
              parsed.description !== undefined ? parsed.description : activeProgram.description,
            cycleLengthWeeks: parsed.cycleWeeks,
            scheduleTemplate: parsed.scheduleTemplate,
            weekProgressionNotes: {
              ...(activeProgram.weekProgressionNotes || {}),
              ...parsed.weekProgressionNotes,
            },
            updatedAt: now,
          };
        } else {
          targetProgram = {
            programUuid: `prog-${uuidv4()}`,
            slug: slugify(parsed.programName, 'prog'),
            title: parsed.programName,
            description: parsed.description || 'Imported via AI Coach',
            cycleLengthWeeks: parsed.cycleWeeks,
            scheduleTemplate: parsed.scheduleTemplate,
            weekProgressionNotes: parsed.weekProgressionNotes,
            createdAt: now,
            updatedAt: now,
          };
        }

        get().upsertProgram(targetProgram);
        get().setActiveProgram(targetProgram.programUuid);

        let autoFillResult: { daysModified: number; itemsCreated: number } | undefined;
        if (parsed.autoFill) {
          autoFillResult = get().autoFillSchedule(
            targetProgram.programUuid,
            parsed.autoFill.startDate,
            parsed.autoFill.endDate,
            parsed.autoFill.conflictMode || 'replace',
            { skipSafetySnapshot: true }
          );
          try {
            window.localStorage.setItem(
              `ironpulse_autofill_range_${targetProgram.programUuid}`,
              JSON.stringify({
                start: parsed.autoFill.startDate,
                end: parsed.autoFill.endDate,
              })
            );
          } catch {
            // Ignore localStorage restrictions
          }
        }

        if (isNavigatorOffline()) {
          get().queueOfflineSync('both');
        }

        return {
          programTitle: targetProgram.title,
          cycleWeeks: targetProgram.cycleLengthWeeks,
          presetsCount,
          autoFillResult,
        };
      },

      setActiveTab: (tab) => {
        persistActiveTab(tab);
        set({ activeTab: tab });
      },
      openPresetEditor: (presetUuid, returnTab) => {
        persistActiveTab('library');
        set({
          editingPresetUuid: presetUuid,
          presetEditorReturnTab: returnTab || null,
          activeTab: 'library',
        });
      },
      clearPresetEditor: () =>
        set({
          editingPresetUuid: null,
          presetEditorReturnTab: null,
        }),
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

      setKeepScreenAwake: (enabled) => {
        const nextMeta = {
          ...get().meta,
          keepScreenAwake: enabled,
          updatedAt: new Date().toISOString(),
        };
        set({ meta: nextMeta });
        if (get().authUser) {
          upsertFirestoreDoc('wt_meta', get().authUser!.uid, nextMeta, get().authUser!.uid).catch((err) => {
            console.error('[Sync] Failed to save wake lock pref to Firestore:', err);
            set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to sync preferences' });
          });
        }
      },

      setTimerSoundEnabled: (enabled) => {
        const nextMeta = {
          ...get().meta,
          timerSoundEnabled: enabled,
          updatedAt: new Date().toISOString(),
        };
        set({ meta: nextMeta });
        if (get().authUser) {
          upsertFirestoreDoc('wt_meta', get().authUser!.uid, nextMeta, get().authUser!.uid).catch((err) => {
            console.error('[Sync] Failed to save timer sound pref to Firestore:', err);
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
        recordLogInteraction();
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
        if (!state.timer.isRunning && primaryPreset) {
          if (primaryPreset.formatMode === 'amrap') {
            const capMin =
              primaryPreset.defaultTimer?.timeCapMinutes || primaryPreset.durationMinutes || 10;
            const capSec = Math.max(60, Math.round(capMin * 60));
            nextTimer = {
              ...state.timer,
              isOpen: true,
              mode: 'rest',
              phase: 'work',
              remainingSec: capSec,
              totalPhaseSec: capSec,
              isRunning: false,
            };
          } else if (primaryPreset.defaultTimer?.mode === 'circuit') {
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
              isRunning: false,
            };
          } else {
            const r = Number(primaryPreset.defaultTimer?.restSec ?? 0);
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

        const existingDraftsForDate =
          state.activeDate === date
            ? state.draftWorkouts.filter((d) => d.date === date)
            : [];
        const existingLogsForDate = state.logs.filter((l) => l.date === date);

        const existingScheduleIds = new Set<string>([
          ...existingDraftsForDate.map((d) => d.scheduleItemUuid).filter((id): id is string => Boolean(id)),
          ...existingLogsForDate.map((l) => l.scheduleItemUuid).filter((id): id is string => Boolean(id)),
        ]);
        const existingPresetCounts = new Map<string, number>();
        for (const entry of existingDraftsForDate.length > 0 ? existingDraftsForDate : existingLogsForDate) {
          existingPresetCounts.set(
            entry.presetUuid,
            (existingPresetCounts.get(entry.presetUuid) || 0) + 1
          );
        }
        const consumedPresetCounts = new Map<string, number>();

        let seq =
          state.meta.nextLogSequenceNumber + state.draftWorkouts.filter((d) => !d.isSaved).length;
        const addedDrafts: DraftWorkoutCard[] = [];

        daySchedule.items
          .slice()
          .sort((a, b) => a.orderIndex - b.orderIndex)
          .forEach((item) => {
            if (existingScheduleIds.has(item.scheduleItemUuid)) return;
            // Prevent duplicate staged card if a log/draft for this date+preset already exists
            const alreadyForPreset = existingPresetCounts.get(item.presetUuid) || 0;
            const consumed = consumedPresetCounts.get(item.presetUuid) || 0;
            if (consumed < alreadyForPreset) {
              consumedPresetCounts.set(item.presetUuid, consumed + 1);
              return;
            }
            const preset = state.presets.find((p) => p.presetUuid === item.presetUuid);
            if (!preset) return;
            const itemStatus = normalizeScheduleStatus(item.status);
            const built = createDraftFromPreset(
              preset,
              date,
              state.activeSessionGroupUuid,
              existingDraftsForDate.length + addedDrafts.length,
              seq++,
              state.meta.defaultDistanceUnit,
              {
                scheduleItemUuid: item.scheduleItemUuid,
                programUuid: item.programUuid,
                coachNotes: item.coachNotes,
                slotRole: item.slotRole,
                exerciseNotesByUid: item.exerciseNotesByUid,
                exerciseNotesByIndex: item.exerciseNotesByIndex,
              }
            );
            addedDrafts.push({
              ...built,
              status: itemStatus,
              isSaved: itemStatus === 'completed' || itemStatus === 'skipped',
            });
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

      getProgramTemplatePreviewForDate: (targetDate) => {
        const state = get();
        const date = targetDate || state.activeDate;
        const activeProgram =
          state.programs.find((p) => p.programUuid === state.meta.activeProgramUuid) ||
          state.programs[0] ||
          null;
        if (!activeProgram || !activeProgram.scheduleTemplate || activeProgram.scheduleTemplate.length === 0) {
          return null;
        }

        const parseIsoLocal = (iso: string) => {
          const [y, m, d] = iso.split('-').map(Number);
          return new Date(y, m - 1, d);
        };
        const getMondayOfWeek = (dt: Date) => {
          const offset = (dt.getDay() + 6) % 7; // Mon=0..Sun=6
          return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() - offset);
        };

        // Determine program anchor date: saved autofill start -> earliest scheduled date -> target week's Monday
        let anchorIso: string | null = null;
        if (typeof window !== 'undefined') {
          try {
            const raw = window.localStorage.getItem('ironpulse_program_autofill_dates');
            if (raw) {
              const map = JSON.parse(raw) as Record<string, { start?: string }>;
              if (map[activeProgram.programUuid]?.start) {
                anchorIso = map[activeProgram.programUuid].start!;
              }
            }
          } catch {
            // ignore storage errors
          }
        }
        if (!anchorIso) {
          const progDates = Object.keys(state.schedules)
            .filter((d) =>
              state.schedules[d]?.items?.some(
                (it) => it.programUuid === activeProgram.programUuid
              )
            )
            .sort();
          if (progDates.length > 0) {
            anchorIso = progDates[0];
          }
        }

        const targetDt = parseIsoLocal(date);
        const targetMonday = getMondayOfWeek(targetDt);
        const anchorMonday = anchorIso ? getMondayOfWeek(parseIsoLocal(anchorIso)) : targetMonday;
        const diffDays = Math.round(
          (targetMonday.getTime() - anchorMonday.getTime()) / 86400000
        );
        const diffWeeks = Math.floor(diffDays / 7);
        const cycleLen = Math.max(1, activeProgram.cycleLengthWeeks || 1);
        const cycleWeek = (((diffWeeks % cycleLen) + cycleLen) % cycleLen) + 1;
        const dayOfWeek = targetDt.getDay();

        const templateDay = activeProgram.scheduleTemplate.find(
          (t) => t.weekNumber === cycleWeek && t.dayOfWeek === dayOfWeek
        );

        return {
          program: activeProgram,
          cycleWeek,
          dayOfWeek,
          items: templateDay?.items ? [...templateDay.items].sort((a, b) => a.orderIndex - b.orderIndex) : [],
        };
      },

      resetDateToProgramTemplate: async (targetDate) => {
        const state = get();
        const date = targetDate || state.activeDate;
        const preview = get().getProgramTemplatePreviewForDate(date);
        if (!preview) {
          return {
            ok: false,
            count: 0,
            error: 'No active program template covers this date.',
          };
        }

        const { program, cycleWeek, items: templateItems } = preview;
        get().saveSafetySnapshot('Reset to Program Plan');
        const now = new Date().toISOString();
        const uid = state.authUser?.uid || state.meta.uid;
        const weekNotePrefix = program.weekProgressionNotes?.[String(cycleWeek)]
          ? `[W${cycleWeek}] ${program.weekProgressionNotes[String(cycleWeek)]}`
          : '';

        // Collect existing items/logs on this date to clean up cleanly
        const oldSchedItems = state.schedules[date]?.items || [];
        const oldLogsForDate = state.logs.filter((l) => l.date === date);
        for (const oldLog of oldLogsForDate) {
          clearPendingDraftSync(oldLog.logUuid);
        }

        const sessionGroupUuid = `ses-${uuidv4()}`;
        let seq = state.meta.nextLogSequenceNumber;
        const newScheduledItems: ScheduledItem[] = [];
        const newDrafts: DraftWorkoutCard[] = [];
        const newLogRecords: WorkoutLog[] = [];

        templateItems.forEach((ti, idx) => {
          const preset = state.presets.find((p) => p.presetUuid === ti.presetUuid);
          if (!preset) return;
          const scheduleItemUuid = `sch-${uuidv4()}`;
          const combinedNotes = [ti.defaultNotes, weekNotePrefix].filter(Boolean).join(' — ');
          const draft = createDraftFromPreset(
            preset,
            date,
            sessionGroupUuid,
            idx,
            seq++,
            state.meta.defaultDistanceUnit,
            {
              scheduleItemUuid,
              programUuid: program.programUuid,
              coachNotes: combinedNotes,
              slotRole: ti.slotRole || (idx === 0 ? 'Primary' : 'Secondary'),
            }
          );
          const logRec = draftToWorkoutLog(draft, uid, idx);
          newDrafts.push(draft);
          newLogRecords.push(logRec);
          newScheduledItems.push({
            scheduleItemUuid,
            orderIndex: idx,
            slotRole: ti.slotRole || (idx === 0 ? 'Primary' : 'Secondary'),
            presetUuid: ti.presetUuid,
            programUuid: program.programUuid,
            coachNotes: combinedNotes,
            status: 'pending',
            completed: false,
            updatedAt: now,
            linkedLogUuid: logRec.logUuid,
          });
        });

        const nextSchedules = { ...state.schedules };
        const schedDocId = state.authUser ? `${state.authUser.uid}_${date}` : `local_${date}`;
        if (newScheduledItems.length > 0) {
          nextSchedules[date] = {
            scheduleId: schedDocId,
            uid: state.authUser?.uid,
            date,
            items: newScheduledItems,
            updatedAt: now,
          };
        } else {
          delete nextSchedules[date];
        }

        const remainingLogs = state.logs.filter((l) => l.date !== date);
        const nextLogs = [...newLogRecords, ...remainingLogs];
        const oldSchedIdSet = new Set(oldSchedItems.map((it) => it.scheduleItemUuid));

        set({
          schedules: nextSchedules,
          logs: nextLogs,
          ...(state.activeDate === date
            ? {
                activeSessionGroupUuid: sessionGroupUuid,
                draftWorkouts: newDrafts,
              }
            : {}),
          excludedFromTasksIds: state.excludedFromTasksIds.filter((id) => !oldSchedIdSet.has(id)),
          dismissedTaskCompletionIds: state.dismissedTaskCompletionIds.filter(
            (id) => !oldSchedIdSet.has(id)
          ),
          pendingTaskCompletions: state.pendingTaskCompletions.filter(
            (p) => !oldSchedIdSet.has(p.scheduleItemUuid)
          ),
        });

        // Sync Google Tasks via unified single-task helper (delete replaced tasks, upsert fresh pending template tasks within [today, maxSyncDate])
        const todayIsoForTasks = getTodayIsoDate();
        const isInTasksWindow = isDateWithinGoogleTasksSyncWindow(date, todayIsoForTasks);
        if (isNavigatorOffline()) {
          get().queueOfflineSync(isInTasksWindow ? 'both' : 'firestore');
        }
        for (const oldItem of oldSchedItems) {
          const oldPreset = state.presets.find((p) => p.presetUuid === oldItem.presetUuid);
          void syncSingleScheduleTask(
            {
              scheduleItemUuid: oldItem.scheduleItemUuid,
              date,
              workoutName: oldPreset?.title,
            },
            'delete'
          );
        }
        if (isInTasksWindow) {
          for (const freshItem of newScheduledItems) {
            const freshPreset = state.presets.find((p) => p.presetUuid === freshItem.presetUuid);
            void syncSingleScheduleTask(
              {
                scheduleItemUuid: freshItem.scheduleItemUuid,
                date,
                item: freshItem,
                preset: freshPreset,
              },
              'pending'
            );
          }
        }

        // Persist replacement to Firestore
        if (state.authUser) {
          const authUid = state.authUser.uid;
          const ops: Promise<void>[] = [
            ...oldLogsForDate.map((l) => removeFirestoreDoc('wt_logs', l.logUuid)),
            ...newLogRecords.map((l) => upsertFirestoreDoc('wt_logs', l.logUuid, l, authUid)),
            newScheduledItems.length > 0
              ? upsertFirestoreDoc('wt_schedule', `${authUid}_${date}`, nextSchedules[date], authUid)
              : removeFirestoreDoc('wt_schedule', `${authUid}_${date}`),
          ];
          await Promise.all(ops).catch((err) => {
            console.error('[Sync] Failed to reset date to program template in Firestore:', err);
          });
        }

        return {
          ok: true,
          count: newScheduledItems.length,
          programTitle: program.title,
        };
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
            const now = new Date().toISOString();
            const schedId = existing.scheduleItemUuid || `sch-${uuidv4()}`;
            const replacement = createDraftFromPreset(
              preset,
              state.activeDate,
              state.activeSessionGroupUuid,
              existing.chainOrderIndex ?? idx,
              parseInt(existing.displayId.replace('ID-', ''), 10) || state.meta.nextLogSequenceNumber,
              state.meta.defaultDistanceUnit,
              {
                scheduleItemUuid: schedId,
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

            // Sync swapped workout into wt_schedule for activeDate
            const existingDaySched = state.schedules[state.activeDate];
            const schedDocId = state.authUser
              ? `${state.authUser.uid}_${state.activeDate}`
              : `local_${state.activeDate}`;
            let matchedSched = false;
            const updatedItems: ScheduledItem[] = (existingDaySched?.items || []).map((it) => {
              if (
                it.scheduleItemUuid === existing.scheduleItemUuid ||
                it.linkedLogUuid === existing.logUuid ||
                (!existing.scheduleItemUuid && it.orderIndex === (existing.chainOrderIndex ?? idx))
              ) {
                matchedSched = true;
                return {
                  ...it,
                  scheduleItemUuid: schedId,
                  presetUuid: preset.presetUuid,
                  programUuid: replacement.programUuid,
                  slotRole: replacement.slotRole || it.slotRole,
                  coachNotes: replacement.coachNotes ?? it.coachNotes,
                  status: 'pending',
                  completed: false,
                  updatedAt: now,
                  linkedLogUuid: logRecord.logUuid,
                };
              }
              return it;
            });
            if (!matchedSched) {
              updatedItems.push({
                scheduleItemUuid: schedId,
                orderIndex: updatedItems.length,
                slotRole: replacement.slotRole || (idx === 0 ? 'Primary' : 'Secondary'),
                presetUuid: preset.presetUuid,
                programUuid: replacement.programUuid,
                coachNotes: replacement.coachNotes,
                status: 'pending',
                completed: false,
                updatedAt: now,
                linkedLogUuid: logRecord.logUuid,
              });
            }
            const nextDaySched: DailySchedule = {
              scheduleId: existingDaySched?.scheduleId || schedDocId,
              uid: state.authUser?.uid || existingDaySched?.uid,
              date: state.activeDate,
              items: updatedItems.map((it, i) => ({ ...it, orderIndex: i })),
              updatedAt: now,
            };
            const nextSchedules = {
              ...state.schedules,
              [state.activeDate]: nextDaySched,
            };

            set({
              draftWorkouts: nextDrafts,
              logs: upsertLogInArray(state.logs, logRecord),
              schedules: nextSchedules,
              excludedFromTasksIds: state.excludedFromTasksIds.filter((id) => id !== schedId),
              dismissedTaskCompletionIds: state.dismissedTaskCompletionIds.filter(
                (id) => id !== schedId
              ),
            });

            const syncedSchedItem = nextDaySched.items.find(
              (it) => it.scheduleItemUuid === schedId
            );
            if (syncedSchedItem) {
              void syncSingleScheduleTask(
                {
                  scheduleItemUuid: syncedSchedItem.scheduleItemUuid,
                  date: state.activeDate,
                  item: syncedSchedItem,
                  preset,
                },
                'pending'
              );
            }

            if (state.authUser) {
              const authUid = state.authUser.uid;
              clearPendingDraftSync(logRecord.logUuid);
              set({ syncStatus: 'syncing', lastSyncError: undefined });
              Promise.all([
                upsertFirestoreDoc('wt_logs', logRecord.logUuid, logRecord, authUid),
                upsertFirestoreDoc('wt_schedule', `${authUid}_${state.activeDate}`, nextDaySched, authUid),
              ])
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

        const now = new Date().toISOString();
        const unsavedCount = state.draftWorkouts.filter((d) => !d.isSaved).length;
        const seq = state.meta.nextLogSequenceNumber + unsavedCount;
        const newSchedId = options?.scheduleItemUuid || `sch-${uuidv4()}`;
        const slotRole =
          options?.slotRole ||
          (state.draftWorkouts.length === 0 ? 'Primary' : 'Secondary');
        const newDraft = createDraftFromPreset(
          preset,
          state.activeDate,
          state.activeSessionGroupUuid,
          state.draftWorkouts.length,
          seq,
          state.meta.defaultDistanceUnit,
          {
            scheduleItemUuid: newSchedId,
            programUuid: preset.programIds?.[0] || state.meta.activeProgramUuid,
            coachNotes: options?.coachNotes,
            slotRole,
          }
        );

        const uid = state.authUser?.uid || state.meta.uid;
        const logRecord = draftToWorkoutLog(newDraft, uid, state.draftWorkouts.length);

        // Mirror newly added workout into wt_schedule for activeDate
        const existingDaySched = state.schedules[state.activeDate];
        const schedDocId = state.authUser
          ? `${state.authUser.uid}_${state.activeDate}`
          : `local_${state.activeDate}`;
        const alreadyScheduled = (existingDaySched?.items || []).some(
          (it) => it.scheduleItemUuid === newSchedId
        );
        const newSchedItem: ScheduledItem = {
          scheduleItemUuid: newSchedId,
          orderIndex: (existingDaySched?.items || []).length,
          slotRole,
          presetUuid: preset.presetUuid,
          programUuid: newDraft.programUuid,
          coachNotes: options?.coachNotes,
          status: 'pending',
          completed: false,
          updatedAt: now,
          linkedLogUuid: logRecord.logUuid,
        };
        const nextDaySched: DailySchedule = {
          scheduleId: existingDaySched?.scheduleId || schedDocId,
          uid: state.authUser?.uid || existingDaySched?.uid,
          date: state.activeDate,
          items: alreadyScheduled
            ? (existingDaySched?.items || []).map((it) =>
                it.scheduleItemUuid === newSchedId
                  ? { ...it, linkedLogUuid: logRecord.logUuid, updatedAt: now }
                  : it
              )
            : [...(existingDaySched?.items || []), newSchedItem],
          updatedAt: now,
        };
        const nextSchedules = {
          ...state.schedules,
          [state.activeDate]: nextDaySched,
        };

        set({
          draftWorkouts: [...state.draftWorkouts, newDraft],
          logs: upsertLogInArray(state.logs, logRecord),
          schedules: nextSchedules,
        });

        void syncSingleScheduleTask(
          {
            scheduleItemUuid: newSchedItem.scheduleItemUuid,
            date: state.activeDate,
            item: newSchedItem,
            preset,
          },
          'pending'
        );

        if (state.authUser) {
          const authUid = state.authUser.uid;
          clearPendingDraftSync(logRecord.logUuid);
          set({ syncStatus: 'syncing', lastSyncError: undefined });
          Promise.all([
            upsertFirestoreDoc('wt_logs', logRecord.logUuid, logRecord, authUid),
            upsertFirestoreDoc('wt_schedule', `${authUid}_${state.activeDate}`, nextDaySched, authUid),
          ])
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
        if (isNavigatorOffline()) {
          get().queueOfflineSync('firestore');
          return { ok: true };
        }

        set({ syncStatus: 'syncing', lastSyncError: undefined });
        try {
          await upsertFirestoreDoc('wt_logs', logRecord.logUuid, logRecord, state.authUser.uid);
          set({ syncStatus: 'synced', lastSyncError: undefined });
          return { ok: true };
        } catch (err: unknown) {
          const msg = getErrorMessage(err, 'Failed to sync in-progress workout');
          console.error('[Sync] Debounced draft upsert failed:', err);
          set({ syncStatus: 'error', lastSyncError: msg });
          return { ok: false, error: msg };
        }
      },

      updateDraftWorkout: (logUuid, updater) => {
        recordLogInteraction();
        const state = get();
        let updatedRecord: WorkoutLog | null = null;
        let transitionedScheduleDate: string | null = null;
        const now = new Date().toISOString();
        const uid = state.authUser?.uid || state.meta.uid;
        let nextSchedules = state.schedules;

        const nextDrafts = state.draftWorkouts.map((d, idx) => {
          if (d.logUuid !== logUuid) return d;
          const updated = updater(d);
          const recalcedExercises = updated.exercises.map((ex) => recalculateLoggedExercise(ex));
          const totalSessionVolumeKg = recalcedExercises.reduce(
            (acc, ex) => acc + (Number(ex.totalLoadKg) || 0),
            0
          );
          const hasLoggedActivity =
            recalcedExercises.some(
              (ex) =>
                ex.sets?.some((s) => s.reps > 0) ||
                ex.isCompleted === true ||
                (ex.distance ?? 0) > 0 ||
                (ex.durationSec ?? 0) > 0
            ) || (updated.completedRounds ?? 0) > 0;

          const currentStatus = normalizeLogStatus(updated.status);
          const nextStatus: LogStatus = updated.isSaved
            ? currentStatus
            : hasLoggedActivity
            ? 'in_progress'
            : currentStatus;

          // Auto-transition linked 'pending' schedule entry to 'in_progress' when user logs a set
          const daySched = state.schedules[updated.date];
          if (hasLoggedActivity && daySched) {
            let changedSched = false;
            const updatedItems = daySched.items.map((it) => {
              const matches =
                it.scheduleItemUuid === updated.scheduleItemUuid ||
                it.linkedLogUuid === updated.logUuid ||
                (!updated.scheduleItemUuid &&
                  it.presetUuid === updated.presetUuid &&
                  normalizeScheduleStatus(it.status) === 'pending');
              if (matches && normalizeScheduleStatus(it.status) === 'pending') {
                changedSched = true;
                return {
                  ...it,
                  status: 'in_progress' as const,
                  completed: false,
                  updatedAt: now,
                  linkedLogUuid: updated.logUuid,
                };
              }
              return it;
            });
            if (changedSched) {
              transitionedScheduleDate = updated.date;
              nextSchedules = {
                ...state.schedules,
                [updated.date]: {
                  ...daySched,
                  items: updatedItems,
                  updatedAt: now,
                },
              };
            }
          }

          const nextDraft: DraftWorkoutCard = {
            ...updated,
            status: nextStatus,
            exercises: recalcedExercises,
            exerciseUuids: recalcedExercises.map((e) => e.exerciseUuid),
            totalSessionVolumeKg: Math.round(totalSessionVolumeKg * 10) / 10,
            updatedAt: now,
          };
          updatedRecord = draftToWorkoutLog(nextDraft, uid, idx);
          return nextDraft;
        });

        set({
          draftWorkouts: nextDrafts,
          ...(transitionedScheduleDate ? { schedules: nextSchedules } : {}),
          ...(updatedRecord ? { logs: upsertLogInArray(state.logs, updatedRecord) } : {}),
        });

        if (transitionedScheduleDate && state.authUser && nextSchedules[transitionedScheduleDate]) {
          upsertFirestoreDoc(
            'wt_schedule',
            `${state.authUser.uid}_${transitionedScheduleDate}`,
            nextSchedules[transitionedScheduleDate],
            state.authUser.uid
          ).catch((err) => {
            console.error('[Sync] Failed to sync auto in_progress status:', err);
          });
        }

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
        const removeNow = new Date().toISOString();
        const targetDate = target?.date || state.activeDate;
        const daySched = nextSchedules[targetDate];
        let modifiedDaySched = false;
        if (target && daySched) {
          const isCompletedTarget = normalizeLogStatus(target.status) === 'completed';
          const remainingItems = daySched.items
            .filter((it) => {
              const matches =
                (target.scheduleItemUuid && it.scheduleItemUuid === target.scheduleItemUuid) ||
                it.linkedLogUuid === target.logUuid;
              if (!matches) return true;
              // If removing a non-completed workout from Log, remove it from wt_schedule too
              return isCompletedTarget;
            })
            .map((it, idx) => {
              const matches =
                (target.scheduleItemUuid && it.scheduleItemUuid === target.scheduleItemUuid) ||
                it.linkedLogUuid === target.logUuid;
              if (matches && isCompletedTarget) {
                return {
                  ...it,
                  orderIndex: idx,
                  status: 'pending' as const,
                  completed: false,
                  updatedAt: removeNow,
                  linkedLogUuid: null,
                };
              }
              return { ...it, orderIndex: idx };
            });

          if (remainingItems.length !== daySched.items.length || isCompletedTarget) {
            modifiedDaySched = true;
            nextSchedules[targetDate] = {
              ...daySched,
              items: remainingItems,
              updatedAt: removeNow,
            };
          }
        }

        const targetSchedId = target?.scheduleItemUuid;
        set({
          draftWorkouts: nextDrafts,
          logs: nextLogs,
          schedules: nextSchedules,
          ...(targetSchedId && !state.excludedFromTasksIds.includes(targetSchedId)
            ? { excludedFromTasksIds: [...state.excludedFromTasksIds, targetSchedId] }
            : {}),
        });

        if (target) {
          void syncSingleScheduleTask(
            {
              scheduleItemUuid: targetSchedId,
              date: target.date || state.activeDate,
              workoutName: target.workoutTitleSnapshot,
            },
            'delete'
          ).then((res) => {
            if (res.status === 'no-token' || res.status === 'error') {
              get().queueOfflineSync('tasks');
            }
            if (res.status === 'synced' || res.status === 'no-token') {
              const nowIso = new Date().toISOString();
              set({
                tasksActionToast:
                  res.status === 'synced'
                    ? { status: 'synced', message: '✓ Synced to Tasks' }
                    : {
                        status: 'no-token',
                        message: '⚠ Queued for Tasks sync (tap Master Sync to authorize)',
                      },
                ...(res.status === 'synced'
                  ? { lastTasksSync: { timestamp: nowIso, status: 'success', message: 'Task removed' } }
                  : {}),
              });
              setTimeout(() => set({ tasksActionToast: null }), 3500);
            }
          });
        }

        if (state.authUser) {
          const uid = state.authUser.uid;
          set({ syncStatus: 'syncing', lastSyncError: undefined });
          const ops: Promise<void>[] = [removeFirestoreDoc('wt_logs', logUuid)];
          if (modifiedDaySched && nextSchedules[targetDate]) {
            ops.push(
              upsertFirestoreDoc(
                'wt_schedule',
                `${uid}_${targetDate}`,
                nextSchedules[targetDate],
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
        const finalStatus: 'completed' | 'skipped' =
          statusOverride || (normalizeLogStatus(draft.status) === 'skipped' ? 'skipped' : 'completed');
        const now = new Date().toISOString();

        const matchedPresetForSave = state.presets.find(
          (p) => p.presetUuid === draft.presetUuid
        );
        const isAmrapSave =
          draft.formatMode === 'amrap' ||
          matchedPresetForSave?.formatMode === 'amrap' ||
          draft.amrapRounds !== undefined;
        const amrapSaveComputed = isAmrapSave
          ? computeAmrapExercises(
              draft.exercises,
              draft.amrapRounds ?? 0,
              draft.amrapExtraReps || {}
            )
          : null;
        const recalcedExercises = amrapSaveComputed
          ? amrapSaveComputed.exercises
          : draft.exercises.map((ex) => recalculateLoggedExercise(ex));
        const totalSessionVolumeKg = amrapSaveComputed
          ? amrapSaveComputed.totalSessionVolumeKg
          : Math.round(
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

        const totalStopwatchMs =
          finalStatus === 'completed' &&
          (state.sessionStopwatchStartMs !== null || state.sessionStopwatchAccumulatedMs > 0)
            ? state.sessionStopwatchAccumulatedMs +
              (state.sessionStopwatchStartMs ? Date.now() - state.sessionStopwatchStartMs : 0)
            : 0;
        const computedElapsedSec =
          totalStopwatchMs > 0 ? Math.max(1, Math.round(totalStopwatchMs / 1000)) : undefined;
        const computedDurationMin =
          totalStopwatchMs > 0 ? Math.max(1, Math.round(totalStopwatchMs / 60000)) : undefined;

        const resolvedAmrapTimeCap = isAmrapSave
          ? draft.amrapTimeCapMinutes ||
            matchedPresetForSave?.defaultTimer?.timeCapMinutes ||
            matchedPresetForSave?.durationMinutes ||
            10
          : undefined;
        const resolvedDurationMinutes =
          computedDurationMin ??
          draft.durationMinutes ??
          resolvedAmrapTimeCap ??
          matchedPresetForSave?.durationMinutes;
        const resolvedDurationSec =
          computedElapsedSec ??
          draft.durationSec ??
          (resolvedDurationMinutes && resolvedDurationMinutes > 0
            ? Math.round(resolvedDurationMinutes * 60)
            : undefined);

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
          formatMode: isAmrapSave ? 'amrap' : draft.formatMode,
          emomMode: draft.emomMode || matchedPresetForSave?.defaultTimer?.emomMode,
          targetRounds: draft.targetRounds,
          completedRounds: draft.completedRounds,
          amrapRounds: isAmrapSave ? Math.max(0, Math.round(Number(draft.amrapRounds) || 0)) : undefined,
          amrapExtraReps: isAmrapSave ? draft.amrapExtraReps || {} : undefined,
          amrapTimeCapMinutes: resolvedAmrapTimeCap,
          laddersCompleted: draft.laddersCompleted,
          extraRungs: draft.extraRungs,
          programUuid: draft.programUuid,
          scheduleItemUuid: draft.scheduleItemUuid,
          slotRole: draft.slotRole,
          isBiteSize: draft.isBiteSize,
          videoUrl: draft.videoUrl || matchedPresetForSave?.videoUrl,
          status: finalStatus,
          sessionNotes: draft.sessionNotes,
          totalSessionVolumeKg,
          durationSec: resolvedDurationSec,
          durationMinutes: resolvedDurationMinutes,
          elapsedSeconds: computedElapsedSec ?? draft.elapsedSeconds ?? resolvedDurationSec,
          exerciseUuids: recalcedExercises.map((e) => e.exerciseUuid),
          exercises: recalcedExercises,
          createdAt: draft.createdAt || now,
          updatedAt: now,
        };
        recordLogInteraction();

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
        let matchedScheduleIdForTasks = draft.scheduleItemUuid;
        if (daySched) {
          const updatedItems = daySched.items.map((item) => {
            if (
              item.scheduleItemUuid === draft.scheduleItemUuid ||
              (!draft.scheduleItemUuid &&
                item.presetUuid === draft.presetUuid &&
                (normalizeScheduleStatus(item.status) === 'pending' ||
                  normalizeScheduleStatus(item.status) === 'in_progress'))
            ) {
              matchedScheduleIdForTasks = item.scheduleItemUuid;
              return {
                ...item,
                status: finalStatus,
                completed: finalStatus === 'completed',
                updatedAt: now,
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
              metricType: lex.metricType,
              defaultWeight: lex.weight,
              secondaryWeightKg: lex.secondaryWeightKg,
              defaultSets: Math.max(1, lex.sets.length || lex.roundsCompleted || 1),
              defaultReps:
                lex.sets.length > 0 && lex.sets[0].reps > 0 ? String(lex.sets[0].reps) : '10',
              repScheme: lex.repScheme,
              side: lex.side,
              isPerSide: lex.isPerSide,
              groupId: lex.groupId,
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

        let nextExcludedIds = state.excludedFromTasksIds;
        if (matchedScheduleIdForTasks) {
          if (finalStatus === 'completed' || finalStatus === 'skipped') {
            nextExcludedIds = nextExcludedIds.filter((id) => id !== matchedScheduleIdForTasks);
          }
        }

        set({
          logs: nextLogs,
          draftWorkouts: nextDrafts,
          schedules: nextSchedules,
          presets: nextPresets,
          meta: nextMeta,
          excludedFromTasksIds: nextExcludedIds,
          pendingTaskCompletions: state.pendingTaskCompletions.filter(
            (p) => p.scheduleItemUuid !== matchedScheduleIdForTasks
          ),
          ...(finalStatus === 'completed'
            ? {
                sessionStopwatchStartMs: null,
                sessionStopwatchAccumulatedMs: 0,
                dismissedTaskCompletionIds: state.dismissedTaskCompletionIds.filter(
                  (id) => id !== matchedScheduleIdForTasks
                ),
              }
            : {}),
        });

        const handleTasksFeedback = (res: TasksActionResult) => {
          if (res.status === 'no-token' || res.status === 'error') {
            get().queueOfflineSync('tasks');
          }
          if (res.status === 'synced' || res.status === 'no-token') {
            const nowIso = new Date().toISOString();
            set({
              tasksActionToast:
                res.status === 'synced'
                  ? { status: 'synced', message: '✓ Synced to Tasks' }
                  : {
                      status: 'no-token',
                      message: '⚠ Queued for Tasks sync (tap Master Sync to authorize)',
                    },
              ...(res.status === 'synced'
                ? {
                    lastTasksSync: {
                      timestamp: nowIso,
                      status: 'success',
                      message:
                        finalStatus === 'completed' ? 'Task completed' : 'Task completed (skipped)',
                    },
                  }
                : {}),
            });
            setTimeout(() => set({ tasksActionToast: null }), 3500);
          }
        };

        const isBiteSizeWorkout = Boolean(draft.isBiteSize || draft.slotRole === 'Bite-Size');
        if (!isBiteSizeWorkout) {
          if (isNavigatorOffline()) {
            get().queueOfflineSync('both');
          }
          if (finalStatus === 'completed' || finalStatus === 'skipped') {
            void syncSingleScheduleTask(
              {
                scheduleItemUuid: matchedScheduleIdForTasks,
                date: draft.date,
                workoutName: draft.workoutTitleSnapshot,
              },
              finalStatus === 'completed' ? 'complete' : 'skip'
            ).then(handleTasksFeedback);
          }
        } else if (isNavigatorOffline()) {
          get().queueOfflineSync('firestore');
        }

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
          } catch (err: unknown) {
            const msg = getErrorMessage(err, 'Cloud sync failed while saving workout log');
            console.error('[Sync] saveDraftWorkout Firestore error:', err);
            set({ syncStatus: 'error', lastSyncError: msg });
            return { ok: false, error: msg };
          }
        }
        return { ok: true };
      },

      setDraftWorkoutStatus: async (logUuid, nextStatus) => {
        const state = get();
        const draft = state.draftWorkouts.find((d) => d.logUuid === logUuid);
        if (!draft) return;

        if (nextStatus === 'completed') {
          await get().saveDraftWorkout(logUuid, 'completed', draft.updatePresetOnSave);
          return;
        }
        if (nextStatus === 'skipped') {
          await get().saveDraftWorkout(logUuid, 'skipped', draft.updatePresetOnSave);
          return;
        }
        if (nextStatus === 'pending') {
          await get().resetDraftWorkoutToNotStarted(logUuid);
          return;
        }

        // 'in_progress'
        const now = new Date().toISOString();
        const uid = state.authUser?.uid || state.meta.uid;
        let updatedLogRecord: WorkoutLog | null = null;
        const nextDrafts = state.draftWorkouts.map((d, idx) => {
          if (d.logUuid !== logUuid) return d;
          const nextDraft: DraftWorkoutCard = {
            ...d,
            isSaved: false,
            status: 'in_progress',
            updatedAt: now,
          };
          updatedLogRecord = draftToWorkoutLog(nextDraft, uid, idx);
          return nextDraft;
        });
        const nextSchedules = { ...state.schedules };
        let matchedSchedItem: ScheduledItem | undefined;
        const daySched = nextSchedules[draft.date];
        if (daySched) {
          nextSchedules[draft.date] = {
            ...daySched,
            items: daySched.items.map((it) => {
              if (
                it.scheduleItemUuid === draft.scheduleItemUuid ||
                it.linkedLogUuid === logUuid ||
                (!draft.scheduleItemUuid && it.presetUuid === draft.presetUuid)
              ) {
                matchedSchedItem = {
                  ...it,
                  status: 'in_progress',
                  completed: false,
                  updatedAt: now,
                  linkedLogUuid: logUuid,
                };
                return matchedSchedItem;
              }
              return it;
            }),
            updatedAt: now,
          };
        }
        const schedId = matchedSchedItem?.scheduleItemUuid || draft.scheduleItemUuid;
        set({
          draftWorkouts: nextDrafts,
          ...(updatedLogRecord ? { logs: upsertLogInArray(state.logs, updatedLogRecord) } : {}),
          schedules: nextSchedules,
          excludedFromTasksIds: schedId
            ? state.excludedFromTasksIds.filter((id) => id !== schedId)
            : state.excludedFromTasksIds,
          dismissedTaskCompletionIds: schedId
            ? state.dismissedTaskCompletionIds.filter((id) => id !== schedId)
            : state.dismissedTaskCompletionIds,
        });

        if (matchedSchedItem) {
          const preset = state.presets.find((p) => p.presetUuid === matchedSchedItem!.presetUuid);
          void syncSingleScheduleTask(
            {
              scheduleItemUuid: matchedSchedItem.scheduleItemUuid,
              date: draft.date,
              item: matchedSchedItem,
              preset,
            },
            'pending'
          );
        }
        if (state.authUser) {
          const authUid = state.authUser.uid;
          const ops: Promise<void>[] = [];
          if (updatedLogRecord) {
            ops.push(
              upsertFirestoreDoc('wt_logs', (updatedLogRecord as WorkoutLog).logUuid, updatedLogRecord, authUid)
            );
          }
          if (nextSchedules[draft.date]) {
            ops.push(
              upsertFirestoreDoc(
                'wt_schedule',
                `${authUid}_${draft.date}`,
                nextSchedules[draft.date],
                authUid
              )
            );
          }
          await Promise.all(ops).catch(() => {});
        }
      },

      resetDraftWorkoutToNotStarted: async (logUuid) => {
        clearPendingDraftSync(logUuid);
        const state = get();
        const draft = state.draftWorkouts.find((d) => d.logUuid === logUuid);
        if (!draft) return;

        const now = new Date().toISOString();
        const clearedExercises = draft.exercises.map((ex) => ({
          ...ex,
          isCompleted: false,
          totalSets: 0,
          totalReps: 0,
          totalLoadKg: 0,
          sets: (ex.sets || []).map((s) => ({ ...s, reps: 0 })),
        }));

        const nextDrafts = state.draftWorkouts.map((d) =>
          d.logUuid === logUuid
            ? {
                ...d,
                isSaved: false,
                status: 'pending' as const,
                exercises: clearedExercises,
                totalSessionVolumeKg: 0,
                updatedAt: now,
              }
            : d
        );

        const nextLogs = state.logs.filter((l) => l.logUuid !== logUuid);
        const nextSchedules = { ...state.schedules };
        let matchedSchedItem: ScheduledItem | undefined;
        let matchedSchedId = draft.scheduleItemUuid;

        const daySched = nextSchedules[draft.date];
        if (daySched) {
          nextSchedules[draft.date] = {
            ...daySched,
            items: daySched.items.map((it) => {
              if (
                it.scheduleItemUuid === draft.scheduleItemUuid ||
                it.linkedLogUuid === logUuid ||
                (!draft.scheduleItemUuid && it.presetUuid === draft.presetUuid)
              ) {
                matchedSchedId = it.scheduleItemUuid;
                matchedSchedItem = {
                  ...it,
                  status: 'pending',
                  completed: false,
                  updatedAt: now,
                  linkedLogUuid: null,
                };
                return matchedSchedItem;
              }
              return it;
            }),
            updatedAt: now,
          };
        }

        set({
          draftWorkouts: nextDrafts,
          logs: nextLogs,
          schedules: nextSchedules,
          excludedFromTasksIds: matchedSchedId
            ? state.excludedFromTasksIds.filter((id) => id !== matchedSchedId)
            : state.excludedFromTasksIds,
          dismissedTaskCompletionIds: matchedSchedId
            ? state.dismissedTaskCompletionIds.filter((id) => id !== matchedSchedId)
            : state.dismissedTaskCompletionIds,
        });

        if (matchedSchedItem) {
          const preset = state.presets.find((p) => p.presetUuid === matchedSchedItem!.presetUuid);
          void syncSingleScheduleTask(
            {
              scheduleItemUuid: matchedSchedItem.scheduleItemUuid,
              date: draft.date,
              item: matchedSchedItem,
              preset,
            },
            'pending'
          );
        }

        if (state.authUser) {
          const uid = state.authUser.uid;
          await removeFirestoreDoc('wt_logs', logUuid).catch(() => {});
          if (nextSchedules[draft.date]) {
            await upsertFirestoreDoc(
              'wt_schedule',
              `${uid}_${draft.date}`,
              nextSchedules[draft.date],
              uid
            ).catch(() => {});
          }
        }
      },

      saveAllDraftWorkouts: async () => {
        const drafts = get().draftWorkouts;
        for (const d of drafts) {
          await get().saveDraftWorkout(
            d.logUuid,
            normalizeLogStatus(d.status) === 'skipped' ? 'skipped' : 'completed'
          );
        }
      },

      logBiteSizeWorkout: async (presetUuid, options) => {
        recordLogInteraction();
        const state = get();
        const preset = state.presets.find((p) => p.presetUuid === presetUuid);
        if (!preset) return { ok: false };

        const date = options?.date || state.activeDate;
        const now = new Date().toISOString();
        const uid = state.authUser?.uid || state.meta.uid;
        const durationMin = Math.max(
          1,
          Math.round(options?.durationMinutes ?? preset.durationMinutes ?? 5)
        );
        const elapsedSec =
          options?.elapsedSeconds !== undefined && options.elapsedSeconds > 0
            ? Math.round(options.elapsedSeconds)
            : durationMin * 60;

        const seq = state.meta.nextLogSequenceNumber;
        const displayId = formatDisplayId(seq);
        const sessionGroupUuid = `ses-bite-${uuidv4()}`;

        const built = createDraftFromPreset(
          preset,
          date,
          sessionGroupUuid,
          state.draftWorkouts.length,
          seq,
          state.meta.defaultDistanceUnit,
          { slotRole: 'Bite-Size' }
        );

        const isAmrapBite =
          preset.formatMode === 'amrap' || options?.amrapRounds !== undefined;
        const amrapBiteRounds = isAmrapBite
          ? Math.max(0, Math.round(Number(options?.amrapRounds) || 0))
          : undefined;
        const amrapBiteExtra = isAmrapBite ? options?.amrapExtraReps || {} : undefined;
        const amrapBiteTimeCap = isAmrapBite
          ? options?.amrapTimeCapMinutes ||
            preset.defaultTimer?.timeCapMinutes ||
            durationMin
          : undefined;

        let completedExercises: LoggedExercise[];
        let totalSessionVolumeKg: number;

        if (isAmrapBite) {
          const computed = computeAmrapExercises(
            built.exercises,
            amrapBiteRounds ?? 0,
            amrapBiteExtra || {}
          );
          completedExercises = computed.exercises;
          totalSessionVolumeKg = computed.totalSessionVolumeKg;
        } else {
          completedExercises = built.exercises.map((ex) => {
            if (ex.trackingType === 'mobility') {
              return { ...ex, isCompleted: true };
            }
            if (ex.trackingType === 'cardio') {
              return {
                ...ex,
                durationSec: ex.durationSec || elapsedSec,
                isCompleted: true,
              };
            }
            const parsedRep = Number((ex.targetRepsLabel || '').match(/\d+/)?.[0] || 0);
            const sets = (ex.sets || []).map((s) => ({
              ...s,
              reps: s.reps > 0 ? s.reps : parsedRep,
            }));
            return recalculateLoggedExercise({ ...ex, sets });
          });

          totalSessionVolumeKg =
            Math.round(
              completedExercises.reduce((acc, e) => acc + (Number(e.totalLoadKg) || 0), 0) * 10
            ) / 10;
        }

        const logRecord: WorkoutLog = {
          logUuid: built.logUuid,
          uid,
          displayId,
          sessionGroupUuid,
          chainOrderIndex: state.draftWorkouts.length,
          date,
          presetUuid: preset.presetUuid,
          workoutTitleSnapshot: preset.title,
          workoutType: preset.workoutType,
          formatMode: isAmrapBite ? 'amrap' : preset.formatMode,
          amrapRounds: amrapBiteRounds,
          amrapExtraReps: amrapBiteExtra,
          amrapTimeCapMinutes: amrapBiteTimeCap,
          slotRole: 'Bite-Size',
          isBiteSize: true,
          videoUrl: preset.videoUrl,
          status: 'completed',
          sessionNotes: options?.sessionNotes || '',
          totalSessionVolumeKg,
          durationMinutes: durationMin,
          durationSec: elapsedSec,
          elapsedSeconds: elapsedSec,
          exerciseUuids: completedExercises.map((e) => e.exerciseUuid),
          exercises: completedExercises,
          createdAt: now,
          updatedAt: now,
        };

        const draftCard: DraftWorkoutCard = {
          ...logRecord,
          isSaved: true,
          slotRole: 'Bite-Size',
          isBiteSize: true,
          updatePresetOnSave: false,
        };

        const nextMeta: UserMeta = {
          ...state.meta,
          nextLogSequenceNumber: seq + 1,
          updatedAt: now,
        };

        // Intentionally does NOT create a wt_schedule slot or push to Google Tasks
        set((s) => ({
          logs: [logRecord, ...s.logs],
          meta: nextMeta,
          ...(s.activeDate === date
            ? { draftWorkouts: [...s.draftWorkouts, draftCard] }
            : {}),
        }));

        if (isNavigatorOffline()) {
          get().queueOfflineSync('firestore');
        } else if (state.authUser) {
          const authUid = state.authUser.uid;
          await Promise.all([
            upsertFirestoreDoc('wt_logs', logRecord.logUuid, logRecord, authUid),
            upsertFirestoreDoc('wt_meta', authUid, nextMeta, authUid),
          ]).catch((err) => {
            console.error('[Sync] Failed to save bite-size log to Firestore:', err);
            get().queueOfflineSync('firestore');
          });
        }

        return { ok: true, log: logRecord };
      },

      getGhostExerciseData: (
        presetUuid,
        exerciseUuid,
        excludeLogUuid,
        exerciseName,
        trackingType
      ) => {
        if (trackingType === 'mobility') return null;

        const normalizedName = (exerciseName || '').trim().toLowerCase();
        const completedLogs = get()
          .logs.filter((l) => {
            if (l.status !== 'completed' || l.logUuid === excludeLogUuid) return false;
            if (normalizedName) {
              return l.exercises.some(
                (e) =>
                  e.trackingType !== 'mobility' &&
                  (e.exerciseName || '').trim().toLowerCase() === normalizedName
              );
            }
            return l.exerciseUuids.includes(exerciseUuid);
          })
          .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

        if (completedLogs.length === 0) return null;

        // Priority 1: Match same presetUuid + normalized name
        const samePresetLog = completedLogs.find((l) => l.presetUuid === presetUuid);
        const chosenLog = samePresetLog || completedLogs[0];
        const matchedEx = normalizedName
          ? chosenLog.exercises.find(
              (e) =>
                e.trackingType !== 'mobility' &&
                (e.exerciseName || '').trim().toLowerCase() === normalizedName
            )
          : chosenLog.exercises.find((e) => e.exerciseUuid === exerciseUuid);
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

      selectTimerMode: (mode, options) => {
        const t = get().timer;
        if (mode === 'rest') {
          const parsedRest = Number(options?.restSec ?? 60);
          const cleanRest = Number.isNaN(parsedRest) || parsedRest <= 0 ? 60 : parsedRest;
          set({
            timer: {
              ...t,
              isOpen: true,
              isRunning: false,
              mode: 'rest',
              phase: 'rest',
              remainingSec: cleanRest,
              totalPhaseSec: cleanRest,
            },
          });
        } else {
          const pRounds = Number(options?.rounds ?? t.totalRounds ?? 15);
          const cleanRounds = Number.isNaN(pRounds) ? 0 : Math.max(0, pRounds);
          const pWork = Number(options?.workSec ?? t.workSec ?? 60);
          const cleanWork = Number.isNaN(pWork) ? 0 : Math.max(0, pWork);
          const pRest = Number(options?.circuitRestSec ?? t.restSec ?? 0);
          const cleanRest = Number.isNaN(pRest) ? 0 : Math.max(0, pRest);
          set({
            timer: {
              ...t,
              isOpen: true,
              isRunning: false,
              mode: 'circuit',
              phase: 'work',
              currentRound: 1,
              totalRounds: cleanRounds,
              workSec: cleanWork,
              restSec: cleanRest,
              remainingSec: cleanWork,
              totalPhaseSec: cleanWork,
            },
          });
        }
      },

      startRestTimer: (seconds) => {
        const parsed = Number(seconds);
        const sec = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
        if (sec <= 0) return;
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
        const pRounds = Number(rounds);
        const cleanRounds = Number.isNaN(pRounds) ? 0 : Math.max(0, pRounds);
        const pWork = Number(workSec);
        const cleanWork = Number.isNaN(pWork) ? 0 : Math.max(0, pWork);
        const pRest = Number(restSec);
        const cleanRest = Number.isNaN(pRest) ? 0 : Math.max(0, pRest);
        set({
          timer: {
            isOpen: true,
            isExpanded: true,
            isRunning: cleanWork > 0,
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

      finishCircuitWorkRound: () => {
        const t = get().timer;
        if (t.mode !== 'circuit') return;
        if (t.restSec > 0 && t.currentRound <= t.totalRounds) {
          set({
            timer: {
              ...t,
              phase: 'rest',
              isRunning: true,
              remainingSec: t.restSec,
              totalPhaseSec: t.restSec,
            },
          });
          return;
        }
        if (t.currentRound < t.totalRounds) {
          set({
            timer: {
              ...t,
              phase: 'work',
              isRunning: t.workSec > 0,
              currentRound: t.currentRound + 1,
              remainingSec: t.workSec,
              totalPhaseSec: t.workSec,
            },
          });
          return;
        }
        set({
          timer: {
            ...t,
            isRunning: false,
            remainingSec: 0,
          },
        });
      },

      setTimerRounds: (rounds) => {
        const parsed = Number(rounds);
        const cleanRounds = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
        const t = get().timer;
        set({
          timer: {
            ...t,
            totalRounds: cleanRounds,
            currentRound: cleanRounds > 0 ? Math.min(t.currentRound, cleanRounds) : 0,
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
                isRunning: t.workSec > 0,
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

      startSessionStopwatch: () => {
        if (get().sessionStopwatchStartMs !== null) return;
        set({ sessionStopwatchStartMs: Date.now() });
      },

      pauseSessionStopwatch: () => {
        const { sessionStopwatchStartMs, sessionStopwatchAccumulatedMs } = get();
        if (sessionStopwatchStartMs === null) return;
        set({
          sessionStopwatchAccumulatedMs:
            sessionStopwatchAccumulatedMs + Math.max(0, Date.now() - sessionStopwatchStartMs),
          sessionStopwatchStartMs: null,
        });
      },

      resetSessionStopwatch: () => {
        set({ sessionStopwatchStartMs: null, sessionStopwatchAccumulatedMs: 0 });
      },

      syncGoogleTasksRuntimeState: (runtime) => {
        set({
          googleSyncStatus: runtime.googleSyncStatus,
          googleTokenExpiresAt: runtime.googleTokenExpiresAt,
          pendingGoogleTasksCount: runtime.pendingOpsCount,
        });
      },

      flushGoogleTasksQueue: async () => {
        if (isNavigatorOffline()) return 0;
        const flushed = await flushQueuedSingleTaskOps();
        if (flushed > 0) {
          const remaining = getPendingSingleTaskOpsCount();
          const prevQueue = get().offlineSyncQueue;
          set({
            pendingGoogleTasksCount: remaining,
            offlineSyncQueue: {
              ...prevQueue,
              googleTasksSyncNeeded: remaining > 0 ? prevQueue.googleTasksSyncNeeded : false,
              pendingCount:
                remaining > 0 || prevQueue.firestoreSyncNeeded ? prevQueue.pendingCount : 0,
              queuedAt:
                remaining > 0 || prevQueue.firestoreSyncNeeded ? prevQueue.queuedAt : undefined,
            },
            lastTasksSync: {
              timestamp: new Date().toISOString(),
              status: 'success',
              message: `Flushed ${flushed} queued task${flushed === 1 ? '' : 's'}`,
            },
          });
        }
        return flushed;
      },

      reconnectAndFlushGoogleTasks: async () => {
        // Trigger interactive OAuth login (which caches fresh token + clears needs_reauth),
        // drains all queued wt_gtasks_pending_ops, and runs full Master Sync.
        return get().runGoogleTasksSync(true);
      },

      checkCompletedTasksInbound: async () => {
        const state = get();
        const todayIso = getTodayIsoDate();
        const res = await fetchCompletedTasksInbound({
          todayIso,
          schedules: state.schedules,
          presets: state.presets,
          excludedFromTasksIds: state.excludedFromTasksIds,
          hasCompletedLogFor: (date, item) =>
            get().logs.some(
              (l) =>
                l.status === 'completed' &&
                (l.scheduleItemUuid === item.scheduleItemUuid ||
                  (l.date === date && l.presetUuid === item.presetUuid))
            ),
        });
        if (res.ok) {
          const dismissedSet = new Set(get().dismissedTaskCompletionIds);
          set({
            pendingTaskCompletions: res.pulledCompleted.filter(
              (p) => !dismissedSet.has(p.scheduleItemUuid)
            ),
          });
        }
      },

      runGoogleTasksSync: async (interactive) => {
        if (isNavigatorOffline()) {
          get().queueOfflineSync('tasks');
          return {
            ok: false,
            pulled: 0,
            pushed: 0,
            rescheduled: 0,
            error: 'Offline — Google Tasks sync queued for when you reconnect.',
          };
        }
        const state = get();
        const todayIso = getTodayIsoDate();
        const res = await syncGoogleTasksTwoWay({
          interactive,
          todayIso,
          schedules: state.schedules,
          presets: state.presets,
          excludedFromTasksIds: state.excludedFromTasksIds,
          dismissedTaskCompletionIds: state.dismissedTaskCompletionIds,
          isScheduleAuthoritative: state.hasCompletedCloudBootstrap || !state.authUser,
          hasCompletedLogFor: (date, item) =>
            get().logs.some(
              (l) =>
                l.status === 'completed' &&
                (l.scheduleItemUuid === item.scheduleItemUuid ||
                  (l.date === date && l.presetUuid === item.presetUuid))
            ),
        });

        const nowIso = new Date().toISOString();
        if (res.skipped) {
          return { ok: false, pulled: 0, pushed: 0, rescheduled: 0 };
        }
        if (!res.ok) {
          set({
            lastTasksSync: {
              timestamp: nowIso,
              status: 'failed',
              message: res.error || 'Sync failed',
            },
          });
          return {
            ok: false,
            pulled: 0,
            pushed: 0,
            rescheduled: 0,
            error: res.error,
          };
        }

        let nextSchedules = { ...get().schedules };
        const modifiedDates = new Set<string>();
        for (const r of res.pulledReschedules) {
          const fromDay = nextSchedules[r.fromDate];
          if (!fromDay) continue;
          const item = fromDay.items.find((it) => it.scheduleItemUuid === r.scheduleItemUuid);
          if (!item) continue;

          nextSchedules[r.fromDate] = {
            ...fromDay,
            items: fromDay.items.filter((it) => it.scheduleItemUuid !== r.scheduleItemUuid),
            updatedAt: nowIso,
          };
          const toDay = nextSchedules[r.toDate];
          const uid = get().authUser?.uid;
          const existingToItems = toDay?.items || [];
          nextSchedules[r.toDate] = {
            scheduleId: toDay?.scheduleId || (uid ? `${uid}_${r.toDate}` : `local_${r.toDate}`),
            uid,
            date: r.toDate,
            items: [
              ...existingToItems,
              { ...item, orderIndex: existingToItems.length },
            ],
            updatedAt: nowIso,
          };
          modifiedDates.add(r.fromDate);
          modifiedDates.add(r.toDate);
        }

        const dismissedSet = new Set(get().dismissedTaskCompletionIds);
        const prevQueue = get().offlineSyncQueue;
        set({
          schedules: nextSchedules,
          pendingTaskCompletions: res.pulledCompleted.filter(
            (p) => !dismissedSet.has(p.scheduleItemUuid)
          ),
          offlineSyncQueue: {
            ...prevQueue,
            googleTasksSyncNeeded: false,
            pendingCount: prevQueue.firestoreSyncNeeded ? prevQueue.pendingCount : 0,
            queuedAt: prevQueue.firestoreSyncNeeded ? prevQueue.queuedAt : undefined,
          },
          lastTasksSync: {
            timestamp: nowIso,
            status: 'success',
            message: `${res.pushedCount} pushed, ${res.pulledCompleted.length} completed, ${res.pulledReschedules.length} moved, ${res.deletedStaleCount} cleaned`,
          },
        });

        if (get().authUser && modifiedDates.size > 0) {
          const uid = get().authUser!.uid;
          Promise.all(
            Array.from(modifiedDates).map((d) =>
              upsertFirestoreDoc('wt_schedule', `${uid}_${d}`, nextSchedules[d], uid)
            )
          ).catch((err) => {
            console.error('[Sync] Failed to sync rescheduled tasks to Firestore:', err);
          });
        }

        return {
          ok: true,
          pulled: res.pulledCompleted.length,
          pushed: res.pushedCount,
          rescheduled: res.pulledReschedules.length,
        };
      },

      dismissPendingTaskCompletion: (scheduleItemUuid) => {
        set((s) => ({
          pendingTaskCompletions: s.pendingTaskCompletions.filter(
            (p) => p.scheduleItemUuid !== scheduleItemUuid
          ),
          dismissedTaskCompletionIds: s.dismissedTaskCompletionIds.includes(scheduleItemUuid)
            ? s.dismissedTaskCompletionIds
            : [...s.dismissedTaskCompletionIds, scheduleItemUuid],
        }));
      },

      openPendingTaskInLog: (pending) => {
        const state = get();
        state.setActiveDate(pending.date);
        const alreadyLoaded = get().draftWorkouts.some(
          (d) =>
            d.scheduleItemUuid === pending.scheduleItemUuid ||
            d.presetUuid === pending.presetUuid
        );
        if (!alreadyLoaded) {
          get().loadProgrammedForDate(pending.date);
        }
        set((s) => ({
          activeTab: 'log',
          pendingTaskCompletions: s.pendingTaskCompletions.filter(
            (p) => p.scheduleItemUuid !== pending.scheduleItemUuid
          ),
        }));
      },

      quickCompletePendingTask: async (pending) => {
        const state = get();
        const preset = state.presets.find((p) => p.presetUuid === pending.presetUuid);
        const now = new Date().toISOString();
        const daySched = state.schedules[pending.date];
        const schedItem = daySched?.items.find(
          (it) => it.scheduleItemUuid === pending.scheduleItemUuid
        );

        let logRecord: WorkoutLog | null = null;
        let nextSeq = state.meta.nextLogSequenceNumber;

        if (preset) {
          const draft = createDraftFromPreset(
            preset,
            pending.date,
            `ses-${uuidv4()}`,
            0,
            nextSeq++,
            state.meta.defaultDistanceUnit,
            {
              scheduleItemUuid: pending.scheduleItemUuid,
              programUuid: schedItem?.programUuid,
              coachNotes: schedItem?.coachNotes,
              slotRole: schedItem?.slotRole || pending.slotRole,
              exerciseNotesByUid: schedItem?.exerciseNotesByUid,
              exerciseNotesByIndex: schedItem?.exerciseNotesByIndex,
            }
          );
          const filledExercises = draft.exercises.map((ex) => {
            const ghost = state.getGhostExerciseData(
              preset.presetUuid,
              ex.exerciseUuid,
              undefined,
              ex.exerciseName,
              ex.trackingType
            );
            if (ex.trackingType === 'mobility') {
              return { ...ex, isCompleted: true };
            }
            if (ex.trackingType === 'cardio') {
              return ghost
                ? { ...ex, distance: ghost.exercise.distance, durationSec: ghost.exercise.durationSec }
                : ex;
            }
            const rawTarget = (ex.targetRepsLabel || '').match(/\d+/)?.[0];
            const fallbackRep = rawTarget ? Number(rawTarget) : 0;
            const filledSets = ex.sets.map((s, idx) => ({
              ...s,
              reps:
                ghost?.exercise.sets?.[idx]?.reps ??
                ghost?.exercise.sets?.[0]?.reps ??
                fallbackRep,
            }));
            return recalculateLoggedExercise({
              ...ex,
              weight: ghost?.exercise.weight ?? ex.weight,
              sets: filledSets,
            });
          });
          const totalVol =
            Math.round(
              filledExercises.reduce((acc, e) => acc + (Number(e.totalLoadKg) || 0), 0) * 10
            ) / 10;
          logRecord = {
            logUuid: draft.logUuid,
            uid: state.authUser?.uid || state.meta.uid,
            displayId: draft.displayId,
            sessionGroupUuid: draft.sessionGroupUuid,
            chainOrderIndex: 0,
            date: pending.date,
            presetUuid: preset.presetUuid,
            workoutTitleSnapshot: preset.title,
            workoutType: preset.workoutType,
            formatMode: draft.formatMode,
            targetRounds: draft.targetRounds,
            programUuid: draft.programUuid,
            scheduleItemUuid: pending.scheduleItemUuid,
            status: 'completed',
            totalSessionVolumeKg: totalVol,
            exerciseUuids: filledExercises.map((e) => e.exerciseUuid),
            exercises: filledExercises,
            createdAt: now,
            updatedAt: now,
          };
        }

        const nextSchedules = { ...state.schedules };
        if (daySched) {
          nextSchedules[pending.date] = {
            ...daySched,
            items: daySched.items.map((it) =>
              it.scheduleItemUuid === pending.scheduleItemUuid
                ? {
                    ...it,
                    status: 'completed' as const,
                    completed: true,
                    updatedAt: now,
                    linkedLogUuid: logRecord?.logUuid || it.linkedLogUuid,
                  }
                : it
            ),
            updatedAt: now,
          };
        }

        const nextMeta: UserMeta = {
          ...state.meta,
          nextLogSequenceNumber: nextSeq,
          updatedAt: now,
        };

        set((s) => ({
          logs: logRecord ? [logRecord, ...s.logs] : s.logs,
          schedules: nextSchedules,
          meta: nextMeta,
          excludedFromTasksIds: s.excludedFromTasksIds.filter(
            (id) => id !== pending.scheduleItemUuid
          ),
          dismissedTaskCompletionIds: s.dismissedTaskCompletionIds.filter(
            (id) => id !== pending.scheduleItemUuid
          ),
          pendingTaskCompletions: s.pendingTaskCompletions.filter(
            (p) => p.scheduleItemUuid !== pending.scheduleItemUuid
          ),
        }));

        if (isNavigatorOffline()) {
          get().queueOfflineSync('both');
        }
        void syncSingleScheduleTask(
          {
            scheduleItemUuid: pending.scheduleItemUuid,
            date: pending.date,
            workoutName: preset?.title || pending.workoutTitle,
          },
          'complete'
        ).then((res) => {
          if (res.status === 'no-token' || res.status === 'error') {
            get().queueOfflineSync('tasks');
          }
        });

        if (state.authUser) {
          const uid = state.authUser.uid;
          const writes: Promise<void>[] = [upsertFirestoreDoc('wt_meta', uid, nextMeta, uid)];
          if (logRecord) writes.push(upsertFirestoreDoc('wt_logs', logRecord.logUuid, logRecord, uid));
          if (nextSchedules[pending.date]) {
            writes.push(
              upsertFirestoreDoc('wt_schedule', `${uid}_${pending.date}`, nextSchedules[pending.date], uid)
            );
          }
          await Promise.all(writes).catch((err) => {
            console.error('[Sync] Quick-complete cloud write failed:', err);
          });
        }
      },

      upsertPreset: (preset) => {
        const state = get();
        const exists = state.presets.some((p) => p.presetUuid === preset.presetUuid);
        const now = new Date().toISOString();
        const cleanPreset: WorkoutPreset = normalizePresetMobilityDurations({
          ...preset,
          slug: preset.slug || slugify(preset.title, 'wkt'),
          updatedAt: now,
          createdAt: preset.createdAt || now,
        });

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

        const nextPresets = sortPresetsAlphabetically(
          exists
            ? state.presets.map((p) => (p.presetUuid === cleanPreset.presetUuid ? cleanPreset : p))
            : [cleanPreset, ...state.presets]
        );

        set({ presets: nextPresets, exercises: nextExercises });
        if (state.authUser) {
          const uid = state.authUser.uid;
          upsertFirestoreDoc('wt_presets', cleanPreset.presetUuid, cleanPreset, uid).catch((err) => {
            console.error('[Sync] Failed to save preset:', err);
            set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to sync preset' });
          });
        }
      },

      bulkUpdatePresets: async (presetUuids, patch) => {
        const targetSet = new Set(presetUuids);
        if (targetSet.size === 0) return { updatedCount: 0 };

        const state = get();
        const now = new Date().toISOString();
        const modifiedPresets: WorkoutPreset[] = [];

        const cleanAddTags = (patch.addTags || [])
          .map((t) => t.trim())
          .filter(Boolean);
        const cleanRemoveTagsLower = new Set(
          (patch.removeTags || []).map((t) => t.trim().toLowerCase()).filter(Boolean)
        );
        const targetProgramIds = patch.programIds || [];

        const nextPresets = sortPresetsAlphabetically(
          state.presets.map((preset) => {
            if (!targetSet.has(preset.presetUuid)) return preset;
            const next: WorkoutPreset = { ...preset };

            // 1. Programs
            if (patch.programsMode === 'add' && targetProgramIds.length > 0) {
              const merged = Array.from(
                new Set([...(preset.programIds || []), ...targetProgramIds])
              );
              next.programIds = merged;
            } else if (patch.programsMode === 'remove' && targetProgramIds.length > 0) {
              const rmSet = new Set(targetProgramIds);
              next.programIds = (preset.programIds || []).filter((id) => !rmSet.has(id));
            } else if (patch.programsMode === 'replace') {
              next.programIds = [...targetProgramIds];
            }

            // 2. Tags (Add & Remove)
            if (cleanAddTags.length > 0 || cleanRemoveTagsLower.size > 0) {
              let tagsList = [...(preset.tags || [])];
              if (cleanRemoveTagsLower.size > 0) {
                tagsList = tagsList.filter((t) => !cleanRemoveTagsLower.has(t.toLowerCase()));
              }
              const existingLower = new Set(tagsList.map((t) => t.toLowerCase()));
              for (const tag of cleanAddTags) {
                if (!existingLower.has(tag.toLowerCase())) {
                  tagsList.push(tag);
                  existingLower.add(tag.toLowerCase());
                }
              }
              next.tags = tagsList;
            }

            // 3. Category
            if (patch.category && patch.category.trim()) {
              next.workoutType = patch.category.trim();
            }

            // 4. Target Duration (mins)
            if (patch.durationMode === 'set' && typeof patch.durationMinutes === 'number' && patch.durationMinutes > 0) {
              next.durationMinutes = Math.round(patch.durationMinutes);
            } else if (patch.durationMode === 'clear') {
              next.durationMinutes = undefined;
            }

            // 5. Bite-Size Flag
            if (patch.biteSizeMode === 'on') {
              next.isBiteSize = true;
            } else if (patch.biteSizeMode === 'off') {
              next.isBiteSize = false;
            }

            // 6. Default Structure & Timer
            if (patch.structureMode && patch.structureMode !== 'no_change') {
              if (patch.structureMode === 'standard') {
                next.formatMode = 'standard';
                next.defaultTimer = {
                  mode: 'rest',
                  restSec:
                    typeof patch.defaultRestSec === 'number'
                      ? Math.max(0, Math.round(patch.defaultRestSec))
                      : 60,
                };
              } else if (patch.structureMode === 'circuit') {
                next.formatMode = 'circuit';
                next.defaultTimer = {
                  mode: 'circuit',
                  rounds:
                    typeof patch.defaultRounds === 'number' && patch.defaultRounds > 0
                      ? Math.round(patch.defaultRounds)
                      : preset.defaultTimer?.rounds || 12,
                  workSec:
                    typeof patch.defaultWorkSec === 'number' && patch.defaultWorkSec >= 0
                      ? Math.round(patch.defaultWorkSec)
                      : preset.defaultTimer?.workSec || 40,
                  restSec:
                    typeof patch.defaultRestSec === 'number' && patch.defaultRestSec >= 0
                      ? Math.round(patch.defaultRestSec)
                      : 20,
                  targetRange: preset.defaultTimer?.targetRange,
                };
              } else if (patch.structureMode === 'emom_rotating') {
                next.formatMode = 'emom_complex';
                next.defaultTimer = {
                  mode: 'circuit',
                  emomMode: 'rotating',
                  rounds:
                    typeof patch.defaultRounds === 'number' && patch.defaultRounds > 0
                      ? Math.round(patch.defaultRounds)
                      : Math.max(1, preset.exercises.length || 3),
                  workSec:
                    typeof patch.defaultWorkSec === 'number' && patch.defaultWorkSec > 0
                      ? Math.round(patch.defaultWorkSec)
                      : 60,
                  restSec: 0,
                  targetRange: preset.defaultTimer?.targetRange,
                };
              } else if (patch.structureMode === 'emom_complex') {
                next.formatMode = 'emom_complex';
                next.defaultTimer = {
                  mode: 'circuit',
                  emomMode: 'complex',
                  rounds:
                    typeof patch.defaultRounds === 'number' && patch.defaultRounds > 0
                      ? Math.round(patch.defaultRounds)
                      : preset.defaultTimer?.rounds || 15,
                  workSec:
                    typeof patch.defaultWorkSec === 'number' && patch.defaultWorkSec > 0
                      ? Math.round(patch.defaultWorkSec)
                      : 60,
                  restSec: 0,
                  targetRange: preset.defaultTimer?.targetRange,
                };
              } else if (patch.structureMode === 'amrap') {
                const capMin =
                  typeof patch.timeCapMinutes === 'number' && patch.timeCapMinutes > 0
                    ? Math.round(patch.timeCapMinutes)
                    : preset.durationMinutes || 10;
                next.formatMode = 'amrap';
                next.durationMinutes = capMin;
                next.defaultTimer = {
                  mode: 'rest',
                  timeCapMinutes: capMin,
                  restSec: capMin * 60,
                };
              }
            }

            next.updatedAt = now;
            const normalized = normalizePresetMobilityDurations(next);
            modifiedPresets.push(normalized);
            return normalized;
          })
        );

        const nextCategories = collectUsedCategories(
          state.categories,
          nextPresets,
          state.logs,
          state.meta.categories
        );

        set({
          presets: nextPresets,
          categories: nextCategories,
        });

        if (isNavigatorOffline()) {
          get().queueOfflineSync('firestore');
        } else if (state.authUser && modifiedPresets.length > 0) {
          const uid = state.authUser.uid;
          await Promise.all(
            modifiedPresets.map((p) =>
              upsertFirestoreDoc('wt_presets', p.presetUuid, p, uid)
            )
          ).catch((err) => {
            console.error('[Sync] Failed to bulk-update presets in Firestore:', err);
            set({
              syncStatus: 'error',
              lastSyncError: getErrorMessage(err, 'Failed to sync bulk preset edits'),
            });
          });
        }

        return { updatedCount: modifiedPresets.length };
      },

      duplicatePreset: (presetUuid) => {
        const orig = get().presets.find((p) => p.presetUuid === presetUuid);
        if (!orig) return null;
        const now = new Date().toISOString();
        const copy: WorkoutPreset = {
          ...JSON.parse(JSON.stringify(orig)),
          presetUuid: `pre-${uuidv4()}`,
          legacyWorkoutId: undefined,
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

      addCategory: (name) => {
        const trimmed = name.trim();
        if (!trimmed) return;
        const state = get();
        if (state.categories.some((c) => c.toLowerCase() === trimmed.toLowerCase())) return;
        const nextCategories = [...state.categories, trimmed];
        const nextMeta: UserMeta = {
          ...state.meta,
          categories: nextCategories,
          updatedAt: new Date().toISOString(),
        };
        set({ categories: nextCategories, meta: nextMeta });
        if (state.authUser) {
          upsertFirestoreDoc('wt_meta', state.authUser.uid, nextMeta, state.authUser.uid).catch(
            (err) => {
              console.error('[Sync] Failed to save categories:', err);
              set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to sync categories' });
            }
          );
        }
      },

      renameCategory: (oldName, newName) => {
        const trimmed = newName.trim();
        if (!trimmed || oldName === trimmed) return;
        const state = get();
        const now = new Date().toISOString();
        const nextCategories = state.categories.map((c) => (c === oldName ? trimmed : c));
        const affectedPresets = state.presets.filter((p) => p.workoutType === oldName);
        const nextPresets = state.presets.map((p) =>
          p.workoutType === oldName ? { ...p, workoutType: trimmed, updatedAt: now } : p
        );
        const affectedLogs = state.logs.filter((l) => l.workoutType === oldName);
        const nextLogs = state.logs.map((l) =>
          l.workoutType === oldName ? { ...l, workoutType: trimmed, updatedAt: now } : l
        );
        const nextDrafts = state.draftWorkouts.map((d) =>
          d.workoutType === oldName ? { ...d, workoutType: trimmed, updatedAt: now } : d
        );
        const nextMeta: UserMeta = {
          ...state.meta,
          categories: nextCategories,
          updatedAt: now,
        };
        set({
          categories: nextCategories,
          presets: nextPresets,
          logs: nextLogs,
          draftWorkouts: nextDrafts,
          meta: nextMeta,
        });
        if (state.authUser) {
          const uid = state.authUser.uid;
          Promise.all([
            upsertFirestoreDoc('wt_meta', uid, nextMeta, uid),
            ...affectedPresets.map((p) =>
              upsertFirestoreDoc(
                'wt_presets',
                p.presetUuid,
                { ...p, workoutType: trimmed, updatedAt: now },
                uid
              )
            ),
            ...affectedLogs.map((l) =>
              upsertFirestoreDoc(
                'wt_logs',
                l.logUuid,
                { ...l, workoutType: trimmed, updatedAt: now },
                uid
              )
            ),
          ]).catch((err) => {
            console.error('[Sync] Failed to rename category in Firestore:', err);
            set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to sync renamed category' });
          });
        }
      },

      deleteCategory: (name) => {
        const state = get();
        if (state.categories.length <= 1) return;
        const nextCategories = state.categories.filter((c) => c !== name);
        const nextMeta: UserMeta = {
          ...state.meta,
          categories: nextCategories,
          updatedAt: new Date().toISOString(),
        };
        set({ categories: nextCategories, meta: nextMeta });
        if (state.authUser) {
          upsertFirestoreDoc('wt_meta', state.authUser.uid, nextMeta, state.authUser.uid).catch(
            (err) => {
              console.error('[Sync] Failed to delete category:', err);
              set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to sync categories' });
            }
          );
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
        get().saveSafetySnapshot('Delete Program');
        const state = get();
        const today = getTodayIsoDate();
        const now = new Date().toISOString();
        const remaining = state.programs.filter((p) => p.programUuid !== programUuid);
        const needNewActive = state.meta.activeProgramUuid === programUuid;
        const nextActiveUuid = needNewActive
          ? remaining[0]?.programUuid || ''
          : state.meta.activeProgramUuid;
        const nextMeta: UserMeta = {
          ...state.meta,
          activeProgramUuid: nextActiveUuid || undefined,
          updatedAt: now,
        };

        // Clean up uncompleted future schedule entries belonging to the deleted program
        // while preserving all completed workout history logs untouched.
        const nextSchedules = { ...state.schedules };
        const updatedScheduleDates: string[] = [];
        const removedScheduleDates: string[] = [];
        for (const [date, daySched] of Object.entries(state.schedules)) {
          if (date < today) continue;
          const hasMatchingUncompleted = daySched.items.some(
            (it) => it.programUuid === programUuid && it.status !== 'completed'
          );
          if (!hasMatchingUncompleted) continue;

          const remainingItems = daySched.items
            .filter((it) => !(it.programUuid === programUuid && it.status !== 'completed'))
            .map((it, idx) => ({ ...it, orderIndex: idx }));

          if (remainingItems.length === 0) {
            delete nextSchedules[date];
            removedScheduleDates.push(date);
          } else {
            nextSchedules[date] = {
              ...daySched,
              items: remainingItems,
              updatedAt: now,
            };
            updatedScheduleDates.push(date);
          }
        }

        set({
          programs: remaining,
          schedules: nextSchedules,
          ...(needNewActive ? { meta: nextMeta } : {}),
        });

        if (state.authUser) {
          const uid = state.authUser.uid;
          removeFirestoreDoc('wt_programs', programUuid).catch((err) => {
            console.error('[Sync] Failed to delete program:', err);
            set({
              syncStatus: 'error',
              lastSyncError: getErrorMessage(err, 'Failed to delete program'),
            });
          });
          if (needNewActive) {
            // Persist empty string when no programs remain so merge:true clears activeProgramUuid
            upsertFirestoreDoc(
              'wt_meta',
              uid,
              { ...nextMeta, activeProgramUuid: nextActiveUuid || '' },
              uid
            ).catch((err) => {
              console.error('[Sync] Failed to update active program in meta:', err);
            });
          }
          if (updatedScheduleDates.length > 0 || removedScheduleDates.length > 0) {
            const ops: Promise<void>[] = [
              ...updatedScheduleDates.map((d) =>
                upsertFirestoreDoc('wt_schedule', `${uid}_${d}`, nextSchedules[d], uid)
              ),
              ...removedScheduleDates.map((d) => removeFirestoreDoc('wt_schedule', `${uid}_${d}`)),
            ];
            Promise.all(ops).catch((err) => {
              console.error('[Sync] Failed to clean up schedule for deleted program:', err);
            });
          }
        }
      },

      clearFutureScheduledWorkoutsForProgram: (programUuid) => {
        const state = get();
        const today = getTodayIsoDate();
        const now = new Date().toISOString();
        const nextSchedules = { ...state.schedules };
        let daysModified = 0;
        let itemsRemoved = 0;
        const updatedDates: string[] = [];
        const removedDates: string[] = [];
        const removedTaskTargets: SingleScheduleTaskInput[] = [];

        for (const [date, daySched] of Object.entries(state.schedules)) {
          if (date < today) continue;
          const removedForDay = daySched.items.filter((it) => it.programUuid === programUuid);
          if (removedForDay.length === 0) continue;

          for (const rem of removedForDay) {
            const preset = state.presets.find((p) => p.presetUuid === rem.presetUuid);
            removedTaskTargets.push({
              scheduleItemUuid: rem.scheduleItemUuid,
              date,
              workoutName: preset?.title,
            });
          }

          itemsRemoved += removedForDay.length;
          daysModified += 1;
          const remainingItems = daySched.items
            .filter((it) => it.programUuid !== programUuid)
            .map((it, idx) => ({ ...it, orderIndex: idx }));

          if (remainingItems.length === 0) {
            delete nextSchedules[date];
            removedDates.push(date);
          } else {
            nextSchedules[date] = {
              ...daySched,
              items: remainingItems,
              updatedAt: now,
            };
            updatedDates.push(date);
          }
        }

        if (daysModified > 0) {
          set({ schedules: nextSchedules });
          for (const target of removedTaskTargets) {
            void syncSingleScheduleTask(target, 'delete');
          }
          if (state.authUser) {
            const uid = state.authUser.uid;
            const ops: Promise<void>[] = [
              ...updatedDates.map((d) =>
                upsertFirestoreDoc('wt_schedule', `${uid}_${d}`, nextSchedules[d], uid)
              ),
              ...removedDates.map((d) => removeFirestoreDoc('wt_schedule', `${uid}_${d}`)),
            ];
            Promise.all(ops).catch((err) => {
              console.error('[Sync] Failed to clear future scheduled workouts:', err);
              set({
                syncStatus: 'error',
                lastSyncError: err?.message || 'Failed to sync cleared schedule workouts',
              });
            });
          }
        }

        return { daysModified, itemsRemoved };
      },

      updateDailySchedule: (date, items) => {
        if (isNavigatorOffline()) {
          get().queueOfflineSync('both');
        }
        const state = get();
        const now = new Date().toISOString();
        const docId = state.authUser ? `${state.authUser.uid}_${date}` : `local_${date}`;
        const normalizedItems: ScheduledItem[] = items.map((it, idx) => {
          const status = normalizeScheduleStatus(it.status);
          return {
            ...it,
            orderIndex: idx,
            status,
            completed: status === 'completed',
            updatedAt: it.updatedAt || now,
          };
        });
        const nextSched: DailySchedule = {
          scheduleId: docId,
          uid: state.authUser?.uid,
          date,
          items: normalizedItems,
          updatedAt: now,
        };
        const nextSchedules = {
          ...state.schedules,
          [date]: nextSched,
        };

        // Immediately sync any non-completed wt_logs on this date with the edited schedule
        const prevItems = state.schedules[date]?.items || [];
        const nextItemIds = new Set(normalizedItems.map((it) => it.scheduleItemUuid));
        const removedItemIds = new Set(
          prevItems
            .filter((it) => !nextItemIds.has(it.scheduleItemUuid))
            .map((it) => it.scheduleItemUuid)
        );
        const removedLinkedLogIds = new Set(
          prevItems
            .filter((it) => !nextItemIds.has(it.scheduleItemUuid) && it.linkedLogUuid)
            .map((it) => it.linkedLogUuid as string)
        );

        const logsToDeleteFromCloud: string[] = [];
        const logsToUpsertToCloud: WorkoutLog[] = [];
        const nextLogs: WorkoutLog[] = [];

        for (const log of state.logs) {
          if (log.date !== date) {
            nextLogs.push(log);
            continue;
          }
          const logStatus = normalizeLogStatus(log.status);
          // Never overwrite or delete a completed log from schedule edits
          if (logStatus === 'completed') {
            nextLogs.push(log);
            continue;
          }

          const wasRemovedFromSchedule =
            (log.scheduleItemUuid && removedItemIds.has(log.scheduleItemUuid)) ||
            removedLinkedLogIds.has(log.logUuid);
          if (wasRemovedFromSchedule) {
            clearPendingDraftSync(log.logUuid);
            logsToDeleteFromCloud.push(log.logUuid);
            continue;
          }

          const matchedItem = normalizedItems.find(
            (it) =>
              it.scheduleItemUuid === log.scheduleItemUuid ||
              it.linkedLogUuid === log.logUuid ||
              (!log.scheduleItemUuid && it.orderIndex === (log.chainOrderIndex ?? 0))
          );
          if (matchedItem) {
            if (log.presetUuid !== matchedItem.presetUuid) {
              // Swapped workout on this date/slot -> update non-completed wt_logs entry immediately
              const newPreset = state.presets.find(
                (p) => p.presetUuid === matchedItem.presetUuid
              );
              if (newPreset) {
                const rebuilt = rebuildLogFromScheduledPreset(
                  log,
                  matchedItem,
                  newPreset,
                  state.meta.defaultDistanceUnit,
                  now
                );
                clearPendingDraftSync(log.logUuid);
                nextLogs.push(rebuilt);
                logsToUpsertToCloud.push(rebuilt);
                continue;
              }
            }
            const nextStatus = normalizeScheduleStatus(matchedItem.status);
            if (
              logStatus !== nextStatus ||
              log.chainOrderIndex !== matchedItem.orderIndex ||
              log.scheduleItemUuid !== matchedItem.scheduleItemUuid
            ) {
              const updatedLog: WorkoutLog = {
                ...log,
                scheduleItemUuid: matchedItem.scheduleItemUuid,
                chainOrderIndex: matchedItem.orderIndex,
                status: nextStatus,
                updatedAt: now,
              };
              nextLogs.push(updatedLog);
              logsToUpsertToCloud.push(updatedLog);
              continue;
            }
          }

          nextLogs.push(log);
        }

        const refreshedFloor =
          state.activeDate === date
            ? buildInitialDraftsForDate(date, nextLogs, nextSchedules, state.presets, state.meta)
            : null;

        set({
          schedules: nextSchedules,
          logs: nextLogs,
          ...(refreshedFloor
            ? {
                activeSessionGroupUuid: refreshedFloor.sessionGroupUuid,
                draftWorkouts: refreshedFloor.drafts,
              }
            : {}),
        });

        // Sync single-day schedule edits (`Edit Day`, `Clear Day`, remove/swap/add) via unified single-task helper
        const todayIsoForEdit = getTodayIsoDate();
        const isEditInTasksWindow = isDateWithinGoogleTasksSyncWindow(date, todayIsoForEdit);
        const prevById = new Map(prevItems.map((it) => [it.scheduleItemUuid, it]));

        const handleSingleTaskToast = (res: TasksActionResult, actionLabel: string) => {
          if (res.status === 'no-token' || res.status === 'error') {
            get().queueOfflineSync('tasks');
          }
          if (res.status === 'synced' || res.status === 'no-token') {
            const ts = new Date().toISOString();
            set({
              tasksActionToast:
                res.status === 'synced'
                  ? { status: 'synced', message: '✓ Synced to Tasks' }
                  : {
                      status: 'no-token',
                      message: '⚠ Queued for Tasks sync (tap Master Sync to authorize)',
                    },
              ...(res.status === 'synced'
                ? { lastTasksSync: { timestamp: ts, status: 'success', message: actionLabel } }
                : {}),
            });
            setTimeout(() => set({ tasksActionToast: null }), 3500);
          }
        };

        for (const removedItem of prevItems.filter((it) => !nextItemIds.has(it.scheduleItemUuid))) {
          const removedPreset = state.presets.find(
            (p) => p.presetUuid === removedItem.presetUuid
          );
          void syncSingleScheduleTask(
            {
              scheduleItemUuid: removedItem.scheduleItemUuid,
              date,
              workoutName: removedPreset?.title,
            },
            'delete'
          ).then((res) => handleSingleTaskToast(res, 'Task removed'));
        }

        const excludedSet = new Set(get().excludedFromTasksIds);
        for (const item of normalizedItems) {
          const prevItem = prevById.get(item.scheduleItemUuid);
          const st = normalizeScheduleStatus(item.status);
          const prevSt = prevItem ? normalizeScheduleStatus(prevItem.status) : null;
          const isStructurallyChanged =
            !prevItem ||
            prevItem.presetUuid !== item.presetUuid ||
            prevItem.slotRole !== item.slotRole ||
            prevSt !== st;
          if (!isStructurallyChanged) continue;

          const preset = state.presets.find((p) => p.presetUuid === item.presetUuid);
          if (st === 'completed') {
            void syncSingleScheduleTask(
              {
                scheduleItemUuid: item.scheduleItemUuid,
                date,
                item,
                preset,
                workoutName: preset?.title,
              },
              'complete'
            ).then((res) => handleSingleTaskToast(res, 'Task completed'));
          } else if (st === 'skipped') {
            void syncSingleScheduleTask(
              {
                scheduleItemUuid: item.scheduleItemUuid,
                date,
                item,
                preset,
                workoutName: preset?.title,
              },
              'skip'
            ).then((res) => handleSingleTaskToast(res, 'Task completed (skipped)'));
          } else if (isEditInTasksWindow && !excludedSet.has(item.scheduleItemUuid)) {
            void syncSingleScheduleTask(
              {
                scheduleItemUuid: item.scheduleItemUuid,
                date,
                item,
                preset,
                workoutName: preset?.title,
              },
              'pending'
            ).then((res) => handleSingleTaskToast(res, 'Task updated'));
          }
        }

        if (state.authUser) {
          const uid = state.authUser.uid;
          const ops: Promise<void>[] = [
            upsertFirestoreDoc('wt_schedule', docId, nextSched, uid),
            ...logsToUpsertToCloud.map((l) => upsertFirestoreDoc('wt_logs', l.logUuid, l, uid)),
            ...logsToDeleteFromCloud.map((id) => removeFirestoreDoc('wt_logs', id)),
          ];
          Promise.all(ops).catch((err) => {
            console.error('[Sync] Failed to save daily schedule:', err);
            set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to sync schedule' });
          });
        }
      },

      setScheduledItemStatus: async (date, scheduleItemUuid, nextStatus) => {
        const state = get();
        const daySched = state.schedules[date];
        if (!daySched) return;
        const targetItem = daySched.items.find((it) => it.scheduleItemUuid === scheduleItemUuid);
        if (!targetItem) return;

        const now = new Date().toISOString();
        const canonicalStatus = normalizeScheduleStatus(nextStatus);
        const updatedItem: ScheduledItem = {
          ...targetItem,
          status: canonicalStatus,
          completed: canonicalStatus === 'completed',
          updatedAt: now,
        };

        const docId = state.authUser ? `${state.authUser.uid}_${date}` : `local_${date}`;
        const nextDaySched: DailySchedule = {
          ...daySched,
          scheduleId: daySched.scheduleId || docId,
          uid: state.authUser?.uid || daySched.uid,
          items: daySched.items.map((it) =>
            it.scheduleItemUuid === scheduleItemUuid ? updatedItem : it
          ),
          updatedAt: now,
        };
        const nextSchedules = {
          ...state.schedules,
          [date]: nextDaySched,
        };

        // Immediately propagate status + updatedAt to any matching wt_logs entry on that date
        const updatedLogsForCloud: WorkoutLog[] = [];
        const nextLogs = state.logs.map((l) => {
          const matchesLog =
            l.scheduleItemUuid === scheduleItemUuid ||
            (updatedItem.linkedLogUuid && l.logUuid === updatedItem.linkedLogUuid) ||
            (l.date === date && !l.scheduleItemUuid && l.presetUuid === updatedItem.presetUuid);
          if (!matchesLog) return l;
          const patched: WorkoutLog = {
            ...l,
            scheduleItemUuid,
            status: canonicalStatus,
            updatedAt: now,
          };
          updatedLogsForCloud.push(patched);
          return patched;
        });

        // Keep active LogView draft in sync if the user is viewing this date
        const nextDrafts =
          state.activeDate === date
            ? state.draftWorkouts.map((d) =>
                d.scheduleItemUuid === scheduleItemUuid ||
                (updatedItem.linkedLogUuid && d.logUuid === updatedItem.linkedLogUuid) ||
                (!d.scheduleItemUuid && d.presetUuid === updatedItem.presetUuid)
                  ? {
                      ...d,
                      scheduleItemUuid,
                      status: canonicalStatus,
                      isSaved: canonicalStatus === 'completed' || canonicalStatus === 'skipped',
                      updatedAt: now,
                    }
                  : d
              )
            : state.draftWorkouts;

        let nextExcludedIds = state.excludedFromTasksIds;
        let nextDismissedIds = state.dismissedTaskCompletionIds;
        let nextPendingCompletions = state.pendingTaskCompletions;

        if (canonicalStatus === 'pending' || canonicalStatus === 'in_progress') {
          nextExcludedIds = nextExcludedIds.filter((id) => id !== scheduleItemUuid);
          nextDismissedIds = nextDismissedIds.filter((id) => id !== scheduleItemUuid);
        } else if (canonicalStatus === 'completed') {
          nextExcludedIds = nextExcludedIds.filter((id) => id !== scheduleItemUuid);
          nextDismissedIds = nextDismissedIds.filter((id) => id !== scheduleItemUuid);
          nextPendingCompletions = nextPendingCompletions.filter(
            (p) => p.scheduleItemUuid !== scheduleItemUuid
          );
        } else if (canonicalStatus === 'skipped') {
          nextExcludedIds = nextExcludedIds.filter((id) => id !== scheduleItemUuid);
          nextPendingCompletions = nextPendingCompletions.filter(
            (p) => p.scheduleItemUuid !== scheduleItemUuid
          );
        }

        set({
          schedules: nextSchedules,
          logs: nextLogs,
          draftWorkouts: nextDrafts,
          excludedFromTasksIds: nextExcludedIds,
          dismissedTaskCompletionIds: nextDismissedIds,
          pendingTaskCompletions: nextPendingCompletions,
        });

        const matchedPreset = state.presets.find((p) => p.presetUuid === updatedItem.presetUuid);
        const handleTasksFeedback = (res: TasksActionResult, actionLabel: string) => {
          if (res.status === 'no-token' || res.status === 'error') {
            get().queueOfflineSync('tasks');
          }
          if (res.status === 'synced' || res.status === 'no-token') {
            const ts = new Date().toISOString();
            set({
              tasksActionToast:
                res.status === 'synced'
                  ? { status: 'synced', message: '✓ Synced to Tasks' }
                  : {
                      status: 'no-token',
                      message: '⚠ Queued for Tasks sync (tap Master Sync to authorize)',
                    },
              ...(res.status === 'synced'
                ? { lastTasksSync: { timestamp: ts, status: 'success', message: actionLabel } }
                : {}),
            });
            setTimeout(() => set({ tasksActionToast: null }), 3500);
          }
        };

        const todayIsoForStatus = getTodayIsoDate();
        const isStatusDateInTasksWindow = isDateWithinGoogleTasksSyncWindow(
          date,
          todayIsoForStatus
        );
        if (isNavigatorOffline()) {
          get().queueOfflineSync(
            canonicalStatus === 'completed' ||
              canonicalStatus === 'skipped' ||
              isStatusDateInTasksWindow
              ? 'both'
              : 'firestore'
          );
        }
        const taskAction: SingleTaskSyncAction =
          canonicalStatus === 'completed'
            ? 'complete'
            : canonicalStatus === 'skipped'
            ? 'skip'
            : 'pending';
        const taskActionLabel =
          canonicalStatus === 'completed'
            ? 'Task completed'
            : canonicalStatus === 'skipped'
            ? 'Task completed (skipped)'
            : 'Task active';
        if (taskAction !== 'pending' || isStatusDateInTasksWindow) {
          void syncSingleScheduleTask(
            {
              scheduleItemUuid,
              date,
              item: updatedItem,
              preset: matchedPreset,
              workoutName: matchedPreset?.title,
            },
            taskAction
          ).then((res) => handleTasksFeedback(res, taskActionLabel));
        }

        if (state.authUser) {
          const uid = state.authUser.uid;
          await Promise.all([
            upsertFirestoreDoc('wt_schedule', `${uid}_${date}`, nextDaySched, uid),
            ...updatedLogsForCloud.map((l) => upsertFirestoreDoc('wt_logs', l.logUuid, l, uid)),
          ]).catch((err) => {
            console.error('[Sync] Failed to sync schedule status:', err);
            set({
              syncStatus: 'error',
              lastSyncError: getErrorMessage(err, 'Failed to sync workout status'),
            });
          });
        }
      },

      addScheduledItemToDate: (date, presetUuid, slotRole = 'Primary', coachNotes = '', programUuid) => {
        const state = get();
        const existing = state.schedules[date]?.items || [];
        const now = new Date().toISOString();
        const newItem: ScheduledItem = {
          scheduleItemUuid: `sch-${uuidv4()}`,
          orderIndex: existing.length,
          slotRole,
          presetUuid,
          programUuid: programUuid || state.meta.activeProgramUuid,
          coachNotes,
          status: 'pending',
          completed: false,
          updatedAt: now,
          linkedLogUuid: null,
        };
        get().updateDailySchedule(date, [...existing, newItem]);
      },

      removeScheduledItemFromDate: (date, scheduleItemUuid) => {
        const state = get();
        const existing = state.schedules[date]?.items || [];
        if (!state.excludedFromTasksIds.includes(scheduleItemUuid)) {
          set({ excludedFromTasksIds: [...state.excludedFromTasksIds, scheduleItemUuid] });
        }
        // updateDailySchedule diffs removed items and invokes syncSingleScheduleTask(..., 'delete') once
        get().updateDailySchedule(
          date,
          existing.filter((i) => i.scheduleItemUuid !== scheduleItemUuid)
        );
      },

      autoFillSchedule: (programUuid, startDate, endDate, conflictMode, options) => {
        const state = get();
        const program = state.programs.find((p) => p.programUuid === programUuid);
        if (!program) return { daysModified: 0, itemsCreated: 0 };

        if (!options?.skipSafetySnapshot && conflictMode === 'replace') {
          get().saveSafetySnapshot('Auto-Fill Calendar Overwrite');
        }
        if (isNavigatorOffline()) {
          get().queueOfflineSync('both');
        }

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
                  completed: false,
                  updatedAt: now,
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

        // Reconcile any empty 'pending' wt_logs on affected dates (never overwriting completed/in_progress logs)
        const reconciled = reconcileSchedulesAndLogs(
          nextSchedules,
          state.logs,
          state.presets,
          state.meta.defaultDistanceUnit
        );
        const refreshedFloor =
          state.activeDate >= startDate && state.activeDate <= endDate
            ? buildInitialDraftsForDate(
                state.activeDate,
                reconciled.logs,
                reconciled.schedules,
                state.presets,
                state.meta
              )
            : null;

        set({
          schedules: reconciled.schedules,
          logs: reconciled.logs,
          ...(refreshedFloor
            ? {
                activeSessionGroupUuid: refreshedFloor.sessionGroupUuid,
                draftWorkouts: refreshedFloor.drafts,
              }
            : {}),
        });
        if (state.authUser) {
          const uid = state.authUser.uid;
          const modifiedLogs = reconciled.logs.filter((l) =>
            reconciled.modifiedLogUuids.includes(l.logUuid)
          );
          Promise.all([
            ...Object.values(reconciled.schedules).map((sch) =>
              upsertFirestoreDoc('wt_schedule', `${uid}_${sch.date}`, sch, uid)
            ),
            ...modifiedLogs.map((l) => upsertFirestoreDoc('wt_logs', l.logUuid, l, uid)),
          ]).catch((err) => {
            console.error('[Sync] Auto-fill schedule cloud write failed:', err);
            set({ syncStatus: 'error', lastSyncError: err?.message || 'Failed to sync auto-filled schedule' });
          });
        }
        return { daysModified, itemsCreated };
      },

      addContextBlock: (input, options) => {
        const state = get();
        const now = new Date().toISOString();
        const startDate = input.startDate <= (input.endDate || input.startDate)
          ? input.startDate
          : input.endDate;
        const endDate = input.endDate >= startDate ? input.endDate : startDate;
        const block: ContextBlock = {
          id: `ctx-${uuidv4()}`,
          uid: state.authUser?.uid || state.meta.uid,
          startDate,
          endDate,
          category: input.category,
          title: input.title.trim(),
          notes: input.notes?.trim() || undefined,
          createdAt: now,
          updatedAt: now,
        };

        let nextSchedules = state.schedules;
        let nextExcludedIds = state.excludedFromTasksIds;
        let nextPendingCompletions = state.pendingTaskCompletions;
        const skippedTargets: Array<{ date: string; scheduleId: string; workoutName?: string }> = [];
        const modifiedDates: string[] = [];

        if (options?.skipOverlappingPending) {
          nextSchedules = { ...state.schedules };
          for (const [date, daySched] of Object.entries(state.schedules)) {
            if (date < startDate || date > endDate) continue;
            let dayChanged = false;
            const updatedItems = daySched.items.map((it) => {
              if (normalizeScheduleStatus(it.status) === 'pending') {
                dayChanged = true;
                if (!nextExcludedIds.includes(it.scheduleItemUuid)) {
                  nextExcludedIds = [...nextExcludedIds, it.scheduleItemUuid];
                }
                nextPendingCompletions = nextPendingCompletions.filter(
                  (p) => p.scheduleItemUuid !== it.scheduleItemUuid
                );
                const preset = state.presets.find((p) => p.presetUuid === it.presetUuid);
                skippedTargets.push({
                  date,
                  scheduleId: it.scheduleItemUuid,
                  workoutName: preset?.title,
                });
                return {
                  ...it,
                  status: 'skipped' as const,
                  completed: false,
                  updatedAt: now,
                };
              }
              return it;
            });
            if (dayChanged) {
              modifiedDates.push(date);
              nextSchedules[date] = {
                ...daySched,
                items: updatedItems,
                updatedAt: now,
              };
            }
          }
        }

        const nextBlocks = [...state.contextBlocks, block].sort((a, b) =>
          b.startDate.localeCompare(a.startDate) || b.createdAt.localeCompare(a.createdAt)
        );

        set({
          contextBlocks: nextBlocks,
          schedules: nextSchedules,
          excludedFromTasksIds: nextExcludedIds,
          pendingTaskCompletions: nextPendingCompletions,
        });

        for (const target of skippedTargets) {
          void syncSingleScheduleTask(
            {
              scheduleItemUuid: target.scheduleId,
              date: target.date,
              workoutName: target.workoutName,
            },
            'skip'
          );
        }

        if (state.authUser) {
          const uid = state.authUser.uid;
          const ops: Promise<void>[] = [
            upsertFirestoreDoc('wt_context', block.id, block, uid),
            ...modifiedDates.map((d) =>
              upsertFirestoreDoc('wt_schedule', `${uid}_${d}`, nextSchedules[d], uid)
            ),
          ];
          Promise.all(ops).catch((err) => {
            console.error('[Sync] Failed to sync context block:', err);
            set({
              syncStatus: 'error',
              lastSyncError: getErrorMessage(err, 'Failed to sync schedule context'),
            });
          });
        }

        return { block, skippedCount: skippedTargets.length };
      },

      updateContextBlock: (id, patch, options) => {
        const state = get();
        const existing = state.contextBlocks.find((b) => b.id === id);
        if (!existing) return { skippedCount: 0 };

        const now = new Date().toISOString();
        const rawStart = patch.startDate ?? existing.startDate;
        const rawEnd = patch.endDate ?? existing.endDate;
        const startDate = rawStart <= rawEnd ? rawStart : rawEnd;
        const endDate = rawEnd >= startDate ? rawEnd : startDate;

        const updated: ContextBlock = {
          ...existing,
          ...patch,
          startDate,
          endDate,
          title: (patch.title ?? existing.title).trim(),
          notes:
            patch.notes !== undefined ? patch.notes.trim() || undefined : existing.notes,
          updatedAt: now,
        };

        let nextSchedules = state.schedules;
        let nextExcludedIds = state.excludedFromTasksIds;
        let nextPendingCompletions = state.pendingTaskCompletions;
        const skippedTargets: Array<{ date: string; scheduleId: string; workoutName?: string }> = [];
        const modifiedDates: string[] = [];

        if (options?.skipOverlappingPending) {
          nextSchedules = { ...state.schedules };
          for (const [date, daySched] of Object.entries(state.schedules)) {
            if (date < startDate || date > endDate) continue;
            let dayChanged = false;
            const updatedItems = daySched.items.map((it) => {
              if (normalizeScheduleStatus(it.status) === 'pending') {
                dayChanged = true;
                if (!nextExcludedIds.includes(it.scheduleItemUuid)) {
                  nextExcludedIds = [...nextExcludedIds, it.scheduleItemUuid];
                }
                nextPendingCompletions = nextPendingCompletions.filter(
                  (p) => p.scheduleItemUuid !== it.scheduleItemUuid
                );
                const preset = state.presets.find((p) => p.presetUuid === it.presetUuid);
                skippedTargets.push({
                  date,
                  scheduleId: it.scheduleItemUuid,
                  workoutName: preset?.title,
                });
                return {
                  ...it,
                  status: 'skipped' as const,
                  completed: false,
                  updatedAt: now,
                };
              }
              return it;
            });
            if (dayChanged) {
              modifiedDates.push(date);
              nextSchedules[date] = {
                ...daySched,
                items: updatedItems,
                updatedAt: now,
              };
            }
          }
        }

        const nextBlocks = state.contextBlocks
          .map((b) => (b.id === id ? updated : b))
          .sort(
            (a, b) =>
              b.startDate.localeCompare(a.startDate) || b.createdAt.localeCompare(a.createdAt)
          );

        set({
          contextBlocks: nextBlocks,
          schedules: nextSchedules,
          excludedFromTasksIds: nextExcludedIds,
          pendingTaskCompletions: nextPendingCompletions,
        });

        for (const target of skippedTargets) {
          void syncSingleScheduleTask(
            {
              scheduleItemUuid: target.scheduleId,
              date: target.date,
              workoutName: target.workoutName,
            },
            'skip'
          );
        }

        if (state.authUser) {
          const uid = state.authUser.uid;
          const ops: Promise<void>[] = [
            upsertFirestoreDoc('wt_context', updated.id, updated, uid),
            ...modifiedDates.map((d) =>
              upsertFirestoreDoc('wt_schedule', `${uid}_${d}`, nextSchedules[d], uid)
            ),
          ];
          Promise.all(ops).catch((err) => {
            console.error('[Sync] Failed to update context block:', err);
          });
        }

        return { skippedCount: skippedTargets.length };
      },

      deleteContextBlock: (id) => {
        const state = get();
        const nextBlocks = state.contextBlocks.filter((b) => b.id !== id);
        set({ contextBlocks: nextBlocks });
        if (state.authUser) {
          removeFirestoreDoc('wt_context', id).catch((err) => {
            console.error('[Sync] Failed to delete context block:', err);
          });
        }
      },

      importContextBlocks: (blocks) => {
        if (!Array.isArray(blocks) || blocks.length === 0) return;
        const state = get();
        const now = new Date().toISOString();
        const mergedMap = new Map(state.contextBlocks.map((b) => [b.id, b]));
        const addedOrUpdated: ContextBlock[] = [];
        for (const raw of blocks) {
          if (!raw || !raw.startDate || !raw.title) continue;
          const id = raw.id || `ctx-${uuidv4()}`;
          const clean: ContextBlock = {
            id,
            uid: state.authUser?.uid || state.meta.uid,
            startDate: raw.startDate,
            endDate: raw.endDate || raw.startDate,
            category: raw.category || 'life',
            title: String(raw.title).trim(),
            notes: raw.notes ? String(raw.notes).trim() : undefined,
            createdAt: raw.createdAt || now,
            updatedAt: raw.updatedAt || now,
          };
          mergedMap.set(id, clean);
          addedOrUpdated.push(clean);
        }
        const nextBlocks = Array.from(mergedMap.values()).sort(
          (a, b) =>
            b.startDate.localeCompare(a.startDate) || b.createdAt.localeCompare(a.createdAt)
        );
        set({ contextBlocks: nextBlocks });
        if (state.authUser && addedOrUpdated.length > 0) {
          const uid = state.authUser.uid;
          Promise.all(
            addedOrUpdated.map((b) => upsertFirestoreDoc('wt_context', b.id, b, uid))
          ).catch((err) => {
            console.error('[Sync] Failed to push imported context blocks:', err);
          });
        }
      },

      deleteWorkoutLog: async (logUuid) => {
        clearPendingDraftSync(logUuid);
        const state = get();
        const targetLog = state.logs.find((l) => l.logUuid === logUuid);
        const nextSchedules = { ...state.schedules };
        const delNow = new Date().toISOString();
        if (targetLog?.scheduleItemUuid && nextSchedules[targetLog.date]) {
          const daySched = nextSchedules[targetLog.date];
          nextSchedules[targetLog.date] = {
            ...daySched,
            items: daySched.items.map((it) =>
              it.linkedLogUuid === logUuid || it.scheduleItemUuid === targetLog.scheduleItemUuid
                ? {
                    ...it,
                    status: 'pending' as const,
                    completed: false,
                    updatedAt: delNow,
                    linkedLogUuid: null,
                  }
                : it
            ),
            updatedAt: delNow,
          };
        }

        set({
          logs: state.logs.filter((l) => l.logUuid !== logUuid),
          draftWorkouts: state.draftWorkouts.filter((d) => d.logUuid !== logUuid),
          schedules: nextSchedules,
          ...(targetLog?.scheduleItemUuid &&
          !state.excludedFromTasksIds.includes(targetLog.scheduleItemUuid)
            ? {
                excludedFromTasksIds: [
                  ...state.excludedFromTasksIds,
                  targetLog.scheduleItemUuid,
                ],
              }
            : {}),
        });

        if (targetLog) {
          void syncSingleScheduleTask(
            {
              scheduleItemUuid: targetLog.scheduleItemUuid,
              date: targetLog.date,
              workoutName: targetLog.workoutTitleSnapshot,
            },
            'delete'
          ).then((res) => {
            if (res.status === 'no-token' || res.status === 'error') {
              get().queueOfflineSync('tasks');
            }
            if (res.status === 'synced' || res.status === 'no-token') {
              const nowIso = new Date().toISOString();
              set({
                tasksActionToast:
                  res.status === 'synced'
                    ? { status: 'synced', message: '✓ Synced to Tasks' }
                    : {
                        status: 'no-token',
                        message: '⚠ Queued for Tasks sync (tap Master Sync to authorize)',
                      },
                ...(res.status === 'synced'
                  ? { lastTasksSync: { timestamp: nowIso, status: 'success', message: 'Task removed' } }
                  : {}),
              });
              setTimeout(() => set({ tasksActionToast: null }), 3500);
            }
          });
        }

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
          } catch (err: unknown) {
            console.error('[Sync] Failed to delete log from Firestore:', err);
            set({
              syncStatus: 'error',
              lastSyncError: getErrorMessage(err, 'Failed to delete log from cloud'),
            });
          }
        }
      },

      deleteLog: async (logUuid) => {
        return get().deleteWorkoutLog(logUuid);
      },

      applyAiImportPayload: (payload, options) => {
        if (!options?.skipSafetySnapshot) {
          get().saveSafetySnapshot('Import Program & Cycle');
        }
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
          presets: sortPresetsAlphabetically(nextPresets),
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

      applyAiNotesPatch: async (patch, options) => {
        const allowStructural = Boolean(options?.allowStructuralChanges);
        const state = get();
        const now = new Date().toISOString();

        let weeksUpdated = 0;
        let presetsUpdated = 0;
        let exercisesUpdated = 0;
        let schedulesUpdated = 0;

        const modifiedPrograms: WorkoutProgram[] = [];
        const modifiedPresets: WorkoutPreset[] = [];
        const modifiedSchedules: DailySchedule[] = [];

        let nextPrograms = [...state.programs];
        let nextPresets = [...state.presets];
        const nextSchedules = { ...state.schedules };

        // 1. Program week focus notes
        if (patch.program) {
          const progId =
            patch.program.programId || patch.program.programUuid || patch.program.id;
          const weekNotes =
            patch.program.weekFocusNotes || patch.program.weekProgressionNotes || {};
          const targetIdx = progId
            ? nextPrograms.findIndex((p) => p.programUuid === progId || p.slug === progId)
            : nextPrograms.findIndex((p) => p.programUuid === state.meta.activeProgramUuid);

          if (targetIdx !== -1 && Object.keys(weekNotes).length > 0) {
            const target = nextPrograms[targetIdx];
            const mergedWeeks = { ...(target.weekProgressionNotes || {}) };
            let changed = false;
            for (const [wk, note] of Object.entries(weekNotes)) {
              if (typeof note !== 'string') continue;
              if ((mergedWeeks[wk] || '') !== note) {
                mergedWeeks[wk] = note;
                weeksUpdated += 1;
                changed = true;
              }
            }
            if (changed) {
              const updatedProg: WorkoutProgram = {
                ...target,
                weekProgressionNotes: mergedWeeks,
                updatedAt: now,
              };
              nextPrograms[targetIdx] = updatedProg;
              modifiedPrograms.push(updatedProg);
            }
          }
        }

        // 2. Preset notes & per-exercise notes (plus optional structural edits)
        const presetExerciseNoteMap = new Map<string, Map<number, string>>();
        const presetNoteMap = new Map<string, string>();

        for (const pPatch of patch.presets || []) {
          const pid = pPatch.presetId || pPatch.presetUuid || pPatch.id;
          const pIdx = nextPresets.findIndex(
            (p) =>
              (pid && (p.presetUuid === pid || p.slug === pid)) ||
              (pPatch.name && p.title.toLowerCase() === pPatch.name.toLowerCase())
          );
          if (pIdx === -1) continue;

          const existingPreset = nextPresets[pIdx];
          let presetChanged = false;

          const nextPresetNote =
            typeof pPatch.workoutNotes === 'string'
              ? pPatch.workoutNotes
              : typeof pPatch.notes === 'string'
              ? pPatch.notes
              : undefined;

          let updatedWorkoutNotes = existingPreset.workoutNotes;
          if (nextPresetNote !== undefined && nextPresetNote !== (existingPreset.workoutNotes || '')) {
            updatedWorkoutNotes = nextPresetNote;
            presetsUpdated += 1;
            presetChanged = true;
            presetNoteMap.set(existingPreset.presetUuid, nextPresetNote);
          }

          let updatedExercises = [...existingPreset.exercises];
          if (Array.isArray(pPatch.exercises) && pPatch.exercises.length > 0) {
            updatedExercises = existingPreset.exercises.map((ex, idx) => {
              const exPatch = pPatch.exercises!.find((ep) => {
                const epIdx = ep.exerciseIndex ?? ep.index;
                if (typeof epIdx === 'number' && epIdx === idx) return true;
                const epUid = ep.exerciseUid || ep.exerciseUuid;
                if (epUid && epUid === ex.exerciseUuid) return true;
                if (ep.name && ep.name.toLowerCase() === ex.exerciseName.toLowerCase()) return true;
                return false;
              });
              if (!exPatch) return ex;

              let nextEx = { ...ex };
              let exChanged = false;

              const nextExNote =
                typeof exPatch.notes === 'string'
                  ? exPatch.notes
                  : typeof exPatch.exerciseNotes === 'string'
                  ? exPatch.exerciseNotes
                  : typeof exPatch.baseNotes === 'string'
                  ? exPatch.baseNotes
                  : undefined;

              if (nextExNote !== undefined && nextExNote !== (ex.baseNotes || '')) {
                nextEx.baseNotes = nextExNote;
                exercisesUpdated += 1;
                exChanged = true;
                const mapForPreset =
                  presetExerciseNoteMap.get(existingPreset.presetUuid) || new Map<number, string>();
                mapForPreset.set(idx, nextExNote);
                presetExerciseNoteMap.set(existingPreset.presetUuid, mapForPreset);
              }

              if (allowStructural) {
                if (typeof exPatch.sets === 'number' && exPatch.sets > 0 && exPatch.sets !== ex.defaultSets) {
                  nextEx.defaultSets = exPatch.sets;
                  exChanged = true;
                }
                if (typeof exPatch.weightKg === 'number' && exPatch.weightKg >= 0 && exPatch.weightKg !== ex.defaultWeight) {
                  nextEx.defaultWeight = exPatch.weightKg;
                  exChanged = true;
                }
                if (
                  typeof exPatch.secondaryWeightKg === 'number' &&
                  exPatch.secondaryWeightKg >= 0 &&
                  exPatch.secondaryWeightKg !== ex.secondaryWeightKg
                ) {
                  nextEx.secondaryWeightKg = exPatch.secondaryWeightKg;
                  exChanged = true;
                }
                if (exPatch.loadType && exPatch.loadType !== ex.loadType) {
                  nextEx.loadType = exPatch.loadType;
                  exChanged = true;
                }
                if (typeof exPatch.targetReps === 'string' && exPatch.targetReps !== ex.defaultReps) {
                  nextEx.defaultReps = exPatch.targetReps;
                  exChanged = true;
                }
                if (typeof exPatch.name === 'string' && exPatch.name.trim() && exPatch.name !== ex.exerciseName) {
                  nextEx.exerciseName = exPatch.name.trim();
                  exChanged = true;
                }
              }

              if (exChanged) presetChanged = true;
              return nextEx;
            });
          }

          if (presetChanged) {
            const updatedPreset: WorkoutPreset = {
              ...existingPreset,
              workoutNotes: updatedWorkoutNotes,
              exercises: updatedExercises,
              updatedAt: now,
            };
            nextPresets[pIdx] = updatedPreset;
            modifiedPresets.push(updatedPreset);
          }
        }

        // 3. Upcoming schedule coachNotes & session-specific exercise notes
        const schedulePatches =
          patch.upcomingSchedule || patch.schedule || patch.updates || patch.notesPatch || [];
        const scheduleNoteMap = new Map<string, string>();
        const scheduleExUidMap = new Map<string, Record<string, string>>();
        const scheduleExIdxMap = new Map<string, Record<string, string>>();
        for (const sPatch of schedulePatches) {
          const nextNote =
            typeof sPatch.coachNotes === 'string'
              ? sPatch.coachNotes
              : typeof sPatch.notes === 'string'
              ? sPatch.notes
              : typeof sPatch.targetCues === 'string'
              ? sPatch.targetCues
              : undefined;
          const hasExUid = Boolean(sPatch.exerciseNotesByUid && Object.keys(sPatch.exerciseNotesByUid).length > 0);
          const hasExIdx = Boolean(sPatch.exerciseNotesByIndex && Object.keys(sPatch.exerciseNotesByIndex).length > 0);
          const hasExList = Boolean(Array.isArray(sPatch.exercises) && sPatch.exercises.length > 0);
          if (nextNote === undefined && !hasExUid && !hasExIdx && !hasExList) continue;

          const itemId = sPatch.scheduleItemUuid || sPatch.scheduleId || sPatch.id;
          const targetWorkoutRef = sPatch.workoutId || sPatch.presetId || sPatch.presetUuid;
          const targetSlot = (sPatch.slot || sPatch.slotRole || '').trim().toLowerCase();
          const resolvedPresetUuid = targetWorkoutRef
            ? nextPresets.find(
                (p) =>
                  p.presetUuid === targetWorkoutRef ||
                  p.slug === targetWorkoutRef ||
                  p.legacyWorkoutId === targetWorkoutRef ||
                  p.title.toLowerCase() === targetWorkoutRef.toLowerCase()
              )?.presetUuid || targetWorkoutRef
            : undefined;
          const candidateDates = sPatch.date && nextSchedules[sPatch.date] ? [sPatch.date] : Object.keys(nextSchedules);

          for (const d of candidateDates) {
            const daySch = nextSchedules[d];
            if (!daySch) continue;
            let dayChanged = false;
            const nextItems = daySch.items.map((item) => {
              const matchesId = itemId && item.scheduleItemUuid === itemId;
              const matchesDateSlotOrWorkout =
                !itemId &&
                Boolean(sPatch.date) &&
                (() => {
                  const slotMatch = targetSlot
                    ? (item.slotRole || '').trim().toLowerCase() === targetSlot
                    : false;
                  const workoutMatch = resolvedPresetUuid
                    ? item.presetUuid === resolvedPresetUuid
                    : false;
                  if (targetSlot && resolvedPresetUuid) return slotMatch && workoutMatch;
                  if (workoutMatch) return true;
                  if (slotMatch) return true;
                  return false;
                })();
              if (!matchesId && !matchesDateSlotOrWorkout) return item;

              let updatedItem = { ...item };
              let itemChanged = false;

              if (nextNote !== undefined && (item.coachNotes || '') !== nextNote) {
                updatedItem.coachNotes = nextNote;
                scheduleNoteMap.set(item.scheduleItemUuid, nextNote);
                itemChanged = true;
              }

              if (hasExUid || hasExList) {
                const mergedUid: Record<string, string> = { ...(item.exerciseNotesByUid || {}) };
                if (sPatch.exerciseNotesByUid) {
                  for (const [k, v] of Object.entries(sPatch.exerciseNotesByUid)) {
                    if (typeof v === 'string' && mergedUid[k] !== v) {
                      mergedUid[k] = v;
                      itemChanged = true;
                    }
                  }
                }
                if (sPatch.exercises) {
                  for (const ep of sPatch.exercises) {
                    const uidKey = ep.exerciseUid || ep.exerciseUuid;
                    const noteVal = ep.notes ?? ep.exerciseNotes ?? ep.baseNotes;
                    if (uidKey && typeof noteVal === 'string' && mergedUid[uidKey] !== noteVal) {
                      mergedUid[uidKey] = noteVal;
                      itemChanged = true;
                    }
                  }
                }
                updatedItem.exerciseNotesByUid = mergedUid;
                scheduleExUidMap.set(item.scheduleItemUuid, mergedUid);
              }

              if (hasExIdx || hasExList) {
                const mergedIdx: Record<string, string> = { ...(item.exerciseNotesByIndex || {}) };
                if (sPatch.exerciseNotesByIndex) {
                  for (const [k, v] of Object.entries(sPatch.exerciseNotesByIndex)) {
                    if (typeof v === 'string' && mergedIdx[k] !== v) {
                      mergedIdx[k] = v;
                      itemChanged = true;
                    }
                  }
                }
                if (sPatch.exercises) {
                  for (const ep of sPatch.exercises) {
                    const idxKey = ep.exerciseIndex ?? ep.index;
                    const noteVal = ep.notes ?? ep.exerciseNotes ?? ep.baseNotes;
                    if (typeof idxKey === 'number' && typeof noteVal === 'string' && mergedIdx[String(idxKey)] !== noteVal) {
                      mergedIdx[String(idxKey)] = noteVal;
                      itemChanged = true;
                    }
                  }
                }
                updatedItem.exerciseNotesByIndex = mergedIdx;
                scheduleExIdxMap.set(item.scheduleItemUuid, mergedIdx);
              }

              if (itemChanged) {
                dayChanged = true;
                schedulesUpdated += 1;
                return updatedItem;
              }
              return item;
            });
            if (dayChanged) {
              const updatedDay: DailySchedule = {
                ...daySch,
                items: nextItems,
                updatedAt: now,
              };
              nextSchedules[d] = updatedDay;
              const existingModIdx = modifiedSchedules.findIndex((ms) => ms.date === d);
              if (existingModIdx >= 0) modifiedSchedules[existingModIdx] = updatedDay;
              else modifiedSchedules.push(updatedDay);
            }
          }
        }

        // 4. Refresh active draftWorkouts in memory so cues appear immediately on LogView
        const nextDraftWorkouts = state.draftWorkouts.map((draft) => {
          let nextDraft = draft;
          let draftChanged = false;

          if (draft.scheduleItemUuid && scheduleNoteMap.has(draft.scheduleItemUuid)) {
            nextDraft = {
              ...nextDraft,
              coachNotes: scheduleNoteMap.get(draft.scheduleItemUuid)!,
            };
            draftChanged = true;
          } else if (draft.presetUuid && presetNoteMap.has(draft.presetUuid) && !draft.coachNotes) {
            nextDraft = {
              ...nextDraft,
              coachNotes: presetNoteMap.get(draft.presetUuid)!,
            };
            draftChanged = true;
          }

          const schedUidNotes = draft.scheduleItemUuid
            ? scheduleExUidMap.get(draft.scheduleItemUuid)
            : undefined;
          const schedIdxNotes = draft.scheduleItemUuid
            ? scheduleExIdxMap.get(draft.scheduleItemUuid)
            : undefined;
          const presetExMap = draft.presetUuid
            ? presetExerciseNoteMap.get(draft.presetUuid)
            : undefined;

          if (schedUidNotes || schedIdxNotes || presetExMap) {
            const nextDraftExercises = nextDraft.exercises.map((ex, idx) => {
              const sessionNote =
                schedUidNotes?.[ex.exerciseUuid] ?? schedIdxNotes?.[String(idx)];
              const nextExNote = sessionNote ?? presetExMap?.get(idx);
              if (nextExNote === undefined) return ex;
              return { ...ex, exerciseNotes: nextExNote };
            });
            nextDraft = { ...nextDraft, exercises: nextDraftExercises };
            draftChanged = true;
          }

          return draftChanged ? nextDraft : draft;
        });

        set({
          programs: nextPrograms,
          presets: nextPresets,
          schedules: nextSchedules,
          draftWorkouts: nextDraftWorkouts,
        });

        if (state.authUser) {
          const uid = state.authUser.uid;
          try {
            await Promise.all([
              ...modifiedPrograms.map((p) =>
                upsertFirestoreDoc('wt_programs', p.programUuid, p, uid)
              ),
              ...modifiedPresets.map((p) =>
                upsertFirestoreDoc('wt_presets', p.presetUuid, p, uid)
              ),
              ...modifiedSchedules.map((sch) =>
                upsertFirestoreDoc('wt_schedule', `${uid}_${sch.date}`, sch, uid)
              ),
            ]);
          } catch (err: unknown) {
            console.error('[Sync] Failed to sync AI notes patch:', err);
            set({
              syncStatus: 'error',
              lastSyncError: getErrorMessage(err, 'Failed to sync AI notes patch'),
            });
            return {
              ok: false,
              weeksUpdated,
              presetsUpdated,
              exercisesUpdated,
              schedulesUpdated,
              error: getErrorMessage(err, 'Saved locally, but cloud sync failed.'),
            };
          }
        }

        return {
          ok: true,
          weeksUpdated,
          presetsUpdated,
          exercisesUpdated,
          schedulesUpdated,
        };
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
          // Flush any pending wt_gtasks_pending_ops automatically upon Google sign-in
          if (getPendingSingleTaskOpsCount() > 0 && getCachedGoogleTasksToken()) {
            void get().flushGoogleTasksQueue();
          }
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
              set({ presets: sortPresetsAlphabetically(remotePresets), syncStatus: 'synced' });
            }
          },
          onPrograms: (remotePrograms) => {
            if (remotePrograms.length > 0 || get().hasCompletedCloudBootstrap) {
              set({ programs: remotePrograms, syncStatus: 'synced' });
            }
          },
          onSchedules: (remoteSchedules) => {
            if (remoteSchedules.length > 0) {
              const state = get();
              const scheduleMap: Record<string, DailySchedule> = { ...state.schedules };
              for (const sch of remoteSchedules) {
                if (sch.date) {
                  scheduleMap[sch.date] = mergeDailyScheduleByTimestamp(scheduleMap[sch.date], sch);
                }
              }
              const reconciled = reconcileSchedulesAndLogs(
                scheduleMap,
                state.logs,
                state.presets,
                state.meta.defaultDistanceUnit
              );
              const refreshedFloor =
                !isUserActivelyTyping() && pendingDraftLogUuids.size === 0
                  ? buildInitialDraftsForDate(
                      state.activeDate,
                      reconciled.logs,
                      reconciled.schedules,
                      state.presets,
                      state.meta
                    )
                  : null;
              set({
                schedules: reconciled.schedules,
                logs: reconciled.logs,
                ...(refreshedFloor
                  ? {
                      activeSessionGroupUuid: refreshedFloor.sessionGroupUuid,
                      draftWorkouts: refreshedFloor.drafts,
                    }
                  : {}),
                syncStatus: 'synced',
              });
              if (state.authUser && reconciled.removedDuplicateLogUuids.length > 0) {
                Promise.all(
                  reconciled.removedDuplicateLogUuids.map((dupId) =>
                    removeFirestoreDoc('wt_logs', dupId).catch((err) =>
                      console.error('[Sync] Failed to remove duplicate log in Firestore:', err)
                    )
                  )
                );
              }
            }
          },
          onContextBlocks: (remoteBlocks) => {
            if (remoteBlocks.length > 0 || get().hasCompletedCloudBootstrap) {
              const sorted = [...remoteBlocks].sort(
                (a, b) =>
                  (b.startDate || '').localeCompare(a.startDate || '') ||
                  (b.createdAt || '').localeCompare(a.createdAt || '')
              );
              set({ contextBlocks: sorted, syncStatus: 'synced' });
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
              mergedLogsMap.set(r.logUuid, normalizeWorkoutLog(r));
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

            const reconciled = reconcileSchedulesAndLogs(
              state.schedules,
              sortedMergedLogs,
              state.presets,
              state.meta.defaultDistanceUnit
            );

            // Hydrate LogView drafts for activeDate when remote updates arrive,
            // provided the user isn't actively typing or holding a pending debounced edit.
            const shouldSkipDraftHydration =
              isUserActivelyTyping() || pendingDraftLogUuids.size > 0;

            if (shouldSkipDraftHydration) {
              set({
                schedules: reconciled.schedules,
                logs: reconciled.logs,
                syncStatus: 'synced',
                lastSyncError: undefined,
              });
              return;
            }

            const rebuiltFloor = buildInitialDraftsForDate(
              state.activeDate,
              reconciled.logs,
              reconciled.schedules,
              state.presets,
              state.meta
            );
            const remoteIds = new Set(rebuiltFloor.drafts.map((d) => d.logUuid));
            const previouslySyncedIds = new Set(state.logs.map((l) => l.logUuid));
            const localOnlyDrafts = state.draftWorkouts.filter(
              (d) =>
                d.date === state.activeDate &&
                !d.isSaved &&
                !remoteIds.has(d.logUuid) &&
                !previouslySyncedIds.has(d.logUuid)
            );
            const mergedDrafts = [...rebuiltFloor.drafts, ...localOnlyDrafts];

            set({
              schedules: reconciled.schedules,
              logs: reconciled.logs,
              activeSessionGroupUuid: rebuiltFloor.sessionGroupUuid,
              draftWorkouts: mergedDrafts,
              syncStatus: 'synced',
              lastSyncError: undefined,
            });

            if (state.authUser && reconciled.removedDuplicateLogUuids.length > 0) {
              Promise.all(
                reconciled.removedDuplicateLogUuids.map((dupId) =>
                  removeFirestoreDoc('wt_logs', dupId)
                )
              ).catch((err) => {
                console.error('[Sync] Failed to clean duplicate wt_logs in Firestore:', err);
              });
            }
          },
          onMeta: (remoteMeta) => {
            if (remoteMeta) {
              const state = get();
              const mergedCategories = collectUsedCategories(
                state.categories,
                state.presets,
                state.logs,
                remoteMeta.categories
              );
              set({
                meta: { ...state.meta, ...remoteMeta },
                categories: mergedCategories,
                syncStatus: 'synced',
              });
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
              remote.schedules.length > 0 ||
              (remote.contextBlocks && remote.contextBlocks.length > 0)
          );

          if (!hasRemoteAccountData) {
            await pushAllLocalDataToFirestore(user.uid, {
              exercises: get().exercises,
              presets: get().presets,
              programs: get().programs,
              schedules: get().schedules,
              logs: get().logs,
              contextBlocks: get().contextBlocks,
              meta: { ...get().meta, uid: user.uid },
            });
            set({
              syncStatus: 'synced',
              hasSeeded: true,
              hasCompletedCloudBootstrap: true,
            });
            return;
          }

          const state = get();
          const scheduleMap: Record<string, DailySchedule> = {};
          for (const sch of remote.schedules) {
            if (sch.date) {
              scheduleMap[sch.date] = mergeDailyScheduleByTimestamp(
                state.schedules[sch.date],
                sch
              );
            }
          }

          const sortedLogs = [...remote.logs]
            .map((l) => normalizeWorkoutLog(l))
            .sort(
              (a, b) =>
                (b.date || '').localeCompare(a.date || '') ||
                (b.updatedAt || b.createdAt || '').localeCompare(
                  a.updatedAt || a.createdAt || ''
                )
            );

          const nextContextBlocks =
            Array.isArray(remote.contextBlocks)
              ? [...remote.contextBlocks].sort(
                  (a, b) =>
                    (b.startDate || '').localeCompare(a.startDate || '') ||
                    (b.createdAt || '').localeCompare(a.createdAt || '')
                )
              : state.contextBlocks;
          const nextExercises = remote.exercises.length > 0 ? remote.exercises : state.exercises;
          const basePresets = remote.presets.length > 0 ? remote.presets : state.presets;
          const biteSeed = state.hasSeededBiteSizePresets
            ? { presets: basePresets, added: [] as WorkoutPreset[] }
            : mergeDefaultBiteSizePresets(basePresets);
          const nextPresets = biteSeed.presets;
          if (biteSeed.added.length > 0 && state.authUser) {
            const authUid = state.authUser.uid;
            Promise.all(
              biteSeed.added.map((pre) =>
                upsertFirestoreDoc('wt_presets', pre.presetUuid, pre, authUid)
              )
            ).catch((err) => {
              console.error('[Sync] Failed to seed default Bite-Size presets in Firestore:', err);
            });
          }
          const nextPrograms = remote.programs.length > 0 ? remote.programs : state.programs;
          // NEVER fall back to local/seed logs when the cloud account exists —
          // if cloud wt_logs is empty, all logs were deleted!
          const nextMeta = remote.meta ? { ...state.meta, ...remote.meta } : state.meta;
          const reconciled = reconcileSchedulesAndLogs(
            scheduleMap,
            sortedLogs,
            nextPresets,
            nextMeta.defaultDistanceUnit
          );
          const nextSchedules = reconciled.schedules;
          const nextLogs = reconciled.logs;

          // Refresh drafts for activeDate from pulled remote logs unless user is actively typing
          const refreshedFloor = !isUserActivelyTyping()
            ? buildInitialDraftsForDate(
                state.activeDate,
                nextLogs,
                nextSchedules,
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
            presets: sortPresetsAlphabetically(nextPresets),
            programs: nextPrograms,
            schedules: nextSchedules,
            logs: nextLogs,
            contextBlocks: nextContextBlocks,
            meta: nextMeta,
            categories: collectUsedCategories(
              state.categories,
              nextPresets,
              nextLogs,
              nextMeta.categories
            ),
            ...(refreshedFloor && mergedActiveDrafts
              ? {
                  activeSessionGroupUuid: refreshedFloor.sessionGroupUuid,
                  draftWorkouts: mergedActiveDrafts,
                }
              : {}),
            syncStatus: 'synced',
            lastSyncError: undefined,
            hasSeeded: true,
            hasSeededBiteSizePresets: true,
            hasCompletedCloudBootstrap: true,
          });

          if (reconciled.removedDuplicateLogUuids.length > 0) {
            Promise.all(
              reconciled.removedDuplicateLogUuids.map((dupId) =>
                removeFirestoreDoc('wt_logs', dupId)
              )
            ).catch((err) => {
              console.error('[Sync] Failed to clean duplicate logs during syncWithFirestore:', err);
            });
          }
        } catch (err: unknown) {
          console.error('[Sync] syncWithFirestore error:', err);
          set({
            syncStatus: 'error',
            lastSyncError: getErrorMessage(err, 'Firestore sync failed'),
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
            contextBlocks: state.contextBlocks.map((b) => ({ ...b, uid })),
            meta: { ...state.meta, uid, updatedAt: nowIso },
          });

          // Pull & merge remote updates after pushing so cross-device entries converge cleanly
          await get().syncWithFirestore();

          return { ok: true, pushedLogs: allLocalLogs.length };
        } catch (err: unknown) {
          const msg = getErrorMessage(err, 'Push to Firestore failed');
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
          presets: sortPresetsAlphabetically(SEED_PRESETS),
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
            presets: sortPresetsAlphabetically(SEED_PRESETS),
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
        contextBlocks: state.contextBlocks,
        meta: state.meta,
        categories: state.categories,
        hasSeeded: state.hasSeeded,
        hasSeededBiteSizePresets: state.hasSeededBiteSizePresets,
        viewportMode: state.viewportMode,
        logLayoutMode: state.logLayoutMode,
        logDensityMode: state.logDensityMode,
        activeDate: state.activeDate,
        activeSessionGroupUuid: state.activeSessionGroupUuid,
        draftWorkouts: state.draftWorkouts,
        sessionStopwatchStartMs: state.sessionStopwatchStartMs,
        sessionStopwatchAccumulatedMs: state.sessionStopwatchAccumulatedMs,
        lastTasksSync: state.lastTasksSync,
        excludedFromTasksIds: state.excludedFromTasksIds,
        dismissedTaskCompletionIds: state.dismissedTaskCompletionIds,
        offlineSyncQueue: state.offlineSyncQueue,
      }),
      onRehydrateStorage: () => (rehydratedState, error) => {
        if (error || !rehydratedState) return;

        const migratedRehydratedPresets = (rehydratedState.presets || []).map((p) =>
          normalizePresetMobilityDurations(p)
        );
        const seededPresetsResult = rehydratedState.hasSeededBiteSizePresets
          ? { presets: migratedRehydratedPresets, added: [] as WorkoutPreset[] }
          : mergeDefaultBiteSizePresets(migratedRehydratedPresets);
        const nextPresetsList = seededPresetsResult.presets;

        // Migrate any legacy 'did_not_complete' / 'incomplete' statuses and reconcile wt_schedule <-> wt_logs
        const reconciled = reconcileSchedulesAndLogs(
          rehydratedState.schedules || {},
          rehydratedState.logs || [],
          nextPresetsList,
          rehydratedState.meta?.defaultDistanceUnit || 'mi'
        );
        const normalizedSchedules = reconciled.schedules;
        const normalizedLogs = reconciled.logs;
        const todayIso = getTodayIsoDate();
        const shouldResetDate = shouldAutoResetLogDateToToday();
        const targetActiveDate = shouldResetDate
          ? todayIso
          : rehydratedState.activeDate || todayIso;
        if (shouldResetDate) {
          recordLogInteraction();
        }
        const refreshedFloor = buildInitialDraftsForDate(
          targetActiveDate,
          normalizedLogs,
          normalizedSchedules,
          nextPresetsList,
          rehydratedState.meta || SEED_META
        );
        const normalizedDrafts = refreshedFloor.drafts;

        if (rehydratedState.hasSeeded) {
          queueMicrotask(() => {
            useWorkoutStore.setState({
              activeDate: targetActiveDate,
              presets: nextPresetsList,
              hasSeededBiteSizePresets: true,
              schedules: normalizedSchedules,
              logs: normalizedLogs,
              draftWorkouts: normalizedDrafts,
              contextBlocks: rehydratedState.contextBlocks || [],
              categories: collectUsedCategories(
                rehydratedState.categories,
                nextPresetsList,
                normalizedLogs,
                rehydratedState.meta?.categories
              ),
            });
          });
          return;
        }

        // If user already had persisted presets/programs/logs from before `hasSeeded` existed,
        // mark seeded without overwriting their logs (e.g. if they deleted seed logs).
        const hasPriorUserData =
          rehydratedState.presets.length > 0 ||
          rehydratedState.programs.length > 0 ||
          rehydratedState.logs.length > 0 ||
          rehydratedState.exercises.length > 0;

        if (hasPriorUserData) {
          queueMicrotask(() => {
            useWorkoutStore.setState({
              hasSeeded: true,
              schedules: normalizedSchedules,
              logs: normalizedLogs,
              draftWorkouts: normalizedDrafts,
              contextBlocks: rehydratedState.contextBlocks || [],
              categories: collectUsedCategories(
                rehydratedState.categories,
                rehydratedState.presets,
                normalizedLogs,
                rehydratedState.meta?.categories
              ),
            });
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

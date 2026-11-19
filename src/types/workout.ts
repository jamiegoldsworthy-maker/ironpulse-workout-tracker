export type WorkoutType = string;

export const DEFAULT_WORKOUT_CATEGORIES: string[] = [
  'Strength',
  'Cardio',
  'Conditioning',
  'Mobility',
  'Complex',
  'Circuit/HIIT',
  'Core',
];

export type ExerciseMetricType = 'reps' | 'distance' | 'time';

export type TrackingType = 'strength' | 'circuit' | 'cardio';

export type LoadType =
  | 'single_kg'
  | 'double_kg'
  | 'bodyweight'
  | 'bw_plus_kg'
  | 'ruck_kg'
  | 'none';

export type CardioMode = 'Ruck' | 'Cycle' | 'Run' | 'Row' | 'Swim' | 'Other';

export type DistanceUnit = 'mi' | 'km';

export type ThemeMode = 'light' | 'dark' | 'system';

export type PresetFormatMode = 'standard' | 'circuit' | 'emom_complex';

export interface DefaultTimerConfig {
  mode: 'rest' | 'circuit';
  workSec?: number;
  restSec: number;
  rounds?: number;
  targetRange?: string; // e.g., "15–30 mins"
}

export interface GlobalExercise {
  exerciseUuid: string;
  uid?: string;
  slug: string;
  exerciseName: string;
  aliases?: string[];
  category: string;
  trackingType: TrackingType;
  defaultLoadType: LoadType;
  defaultWeight: number;
  metricType?: ExerciseMetricType;
  cardioMode?: CardioMode | null;
  baseNotes?: string;
  createdAt: string;
  updatedAt: string;
}

export type ExerciseSide = 'L' | 'R' | 'L/R';

export type RepSchemeType =
  | 'fixed'
  | 'descending_ladder'
  | 'ascending_ladder'
  | 'pyramid';

export interface RepSchemeConfig {
  schemeType: RepSchemeType;
  ladderStart?: number;
  ladderEnd?: number;
  ladderStep?: number;
}

export interface PresetExercise {
  exerciseUuid: string;
  exerciseName: string;
  category: string;
  trackingType: TrackingType;
  loadType: LoadType;
  metricType?: ExerciseMetricType;
  defaultWeight: number;
  defaultSets: number;
  defaultReps: string;
  repScheme?: RepSchemeConfig;
  side?: ExerciseSide;
  isPerSide?: boolean;
  groupId?: string;
  cardioMode?: CardioMode;
  defaultDistanceUnit?: DistanceUnit;
  baseNotes?: string;
}

export interface WorkoutPreset {
  presetUuid: string;
  uid?: string;
  slug: string;
  legacyWorkoutId?: string; // Optional legacy Workout ID (e.g. "ID-0037") for Google Sheet alignment
  title: string;
  workoutType: WorkoutType;
  formatMode?: PresetFormatMode;
  workoutNotes?: string;
  programIds: string[];
  tags: string[];
  defaultTimer?: DefaultTimerConfig;
  exercises: PresetExercise[];
  isArchived?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProgramTemplateItem {
  orderIndex: number;
  slotRole: string; // e.g., "Primary", "Secondary", "Mobility", "Finisher", "Core"
  presetUuid: string;
  defaultNotes?: string;
}

export interface ProgramDayTemplate {
  weekNumber: number; // 1..cycleLengthWeeks
  dayOfWeek: number; // 0 (Sun) .. 6 (Sat)
  items: ProgramTemplateItem[];
}

export interface WorkoutProgram {
  programUuid: string;
  uid?: string;
  slug: string;
  title: string;
  description?: string;
  cycleLengthWeeks: number;
  scheduleTemplate: ProgramDayTemplate[];
  weekProgressionNotes?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export type ScheduleStatus = 'pending' | 'completed' | 'did_not_complete' | 'skipped';

export interface ScheduledItem {
  scheduleItemUuid: string;
  orderIndex: number;
  slotRole: string;
  presetUuid: string;
  programUuid?: string;
  coachNotes?: string;
  status: ScheduleStatus;
  linkedLogUuid?: string | null;
}

export interface DailySchedule {
  scheduleId: string; // `${uid}_${date}` or `${date}`
  uid?: string;
  date: string; // YYYY-MM-DD
  items: ScheduledItem[];
  updatedAt: string;
}

export interface SetEntry {
  setNumber: number;
  reps: number;
  weightOverride?: number; // Optional per-set weight override for pyramiding/drop sets
}

export interface LoggedExercise {
  exerciseUuid: string;
  exerciseName: string;
  category: string;
  trackingType: TrackingType;
  loadType: LoadType;
  metricType?: ExerciseMetricType;
  weight: number; // Base weight in kg
  side?: ExerciseSide;
  isPerSide?: boolean;
  groupId?: string;
  repScheme?: RepSchemeConfig;
  repsPerRound?: number; // Fixed reps per round in EMOM/Complex mode
  targetRepsLabel?: string; // e.g., "AMRAP" or "8-12"
  // Strength / Complex fields
  sets: SetEntry[];
  rir?: number; // Reps in Reserve at end of final set
  totalSets: number;
  totalReps: number;
  totalLoadKg: number;
  estimated1RmKg?: number;
  // Circuit / HIIT fields
  roundsCompleted?: number;
  workSecPerRound?: number;
  restSecPerRound?: number;
  totalDurationSec?: number;
  // Cardio / Endurance fields
  mode?: CardioMode;
  durationSec?: number;
  distance?: number; // Primary distance value in distanceUnit
  distanceUnit?: DistanceUnit; // Defaults to "mi"
  paceSecPerUnit?: number; // Auto-calculated pace in seconds per mi or km
  distanceKm?: number; // Normalized km equivalent for cross-unit comparisons
  paceSecPerKm?: number;
  ruckLoadKg?: number;
  avgHr?: number;
  splits?: string;
  exerciseNotes?: string;
}

export type LogStatus = 'in_progress' | 'completed' | 'did_not_complete';

export interface WorkoutLog {
  logUuid: string;
  uid?: string;
  displayId: string; // Sequential e.g. "ID-0085"
  legacyId?: string; // Imported from Google Sheet e.g. "ID-0070"
  sessionGroupUuid: string; // Shared across chained workouts in the same gym session
  chainOrderIndex?: number;
  date: string; // YYYY-MM-DD
  presetUuid: string;
  workoutTitleSnapshot: string;
  workoutType: WorkoutType;
  formatMode?: PresetFormatMode;
  targetRounds?: number;
  completedRounds?: number;
  laddersCompleted?: number;
  extraRungs?: number;
  programUuid?: string;
  scheduleItemUuid?: string;
  status: LogStatus;
  sessionNotes?: string;
  totalSessionVolumeKg: number;
  durationSec?: number;
  exerciseUuids: string[];
  exercises: LoggedExercise[];
  createdAt: string;
  updatedAt: string;
}

export interface UserMeta {
  uid: string;
  nextLogSequenceNumber: number;
  activeProgramUuid?: string;
  theme: ThemeMode;
  defaultAutoStartRestTimer: boolean;
  defaultDistanceUnit: DistanceUnit;
  categories?: string[];
  updatedAt: string;
}

export interface GhostExerciseData {
  sourceDate: string;
  sourceDisplayId: string;
  sourceWorkoutTitle: string;
  matchedSamePreset: boolean;
  exercise: LoggedExercise;
}

export interface AIImportPayload {
  mode?: 'add' | 'update' | 'replace';
  presets?: Array<Partial<WorkoutPreset> & { slug?: string; title: string }>;
  programs?: Array<Partial<WorkoutProgram> & { slug?: string; title: string }>;
  schedule?: Array<{
    date: string;
    items: Array<{
      slotRole?: string;
      presetUuid?: string;
      presetSlug?: string;
      programUuid?: string;
      programSlug?: string;
      coachNotes?: string;
    }>;
  }>;
}

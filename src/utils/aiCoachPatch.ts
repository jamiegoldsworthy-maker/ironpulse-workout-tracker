import {
  ContextBlock,
  DailySchedule,
  LoadType,
  ProgramDayTemplate,
  ProgramTemplateItem,
  WorkoutLog,
  WorkoutPreset,
  WorkoutProgram,
} from '../types/workout';
import { getTodayIsoDate, shiftIsoDate, uuidv4 } from './calculations';

export interface AiCoachPresetExercisePatch {
  index?: number;
  exerciseIndex?: number;
  exerciseUid?: string;
  exerciseUuid?: string;
  name?: string;
  loadType?: LoadType;
  weightKg?: number;
  secondaryWeightKg?: number;
  sets?: number;
  targetReps?: string;
  notes?: string;
  exerciseNotes?: string;
  baseNotes?: string;
}

export interface AiCoachPresetPatch {
  id?: string;
  presetId?: string;
  presetUuid?: string;
  name?: string;
  notes?: string;
  workoutNotes?: string;
  exercises?: AiCoachPresetExercisePatch[];
}

export interface AiCoachSchedulePatch {
  id?: string;
  scheduleId?: string;
  scheduleItemUuid?: string;
  date?: string;
  slot?: string;
  slotRole?: string;
  workoutId?: string;
  presetId?: string;
  presetUuid?: string;
  notes?: string;
  coachNotes?: string;
  targetCues?: string;
  exerciseNotesByUid?: Record<string, string>;
  exerciseNotesByIndex?: Record<string, string>;
  exercises?: AiCoachPresetExercisePatch[];
}

export interface AiNotesPatchPayload {
  program?: {
    programId?: string;
    programUuid?: string;
    id?: string;
    weekFocusNotes?: Record<string, string>;
    weekProgressionNotes?: Record<string, string>;
  } | null;
  presets?: AiCoachPresetPatch[];
  upcomingSchedule?: AiCoachSchedulePatch[];
  schedule?: AiCoachSchedulePatch[];
  updates?: AiCoachSchedulePatch[];
  notesPatch?: AiCoachSchedulePatch[];
}

export interface AiNotesDiffPreview {
  programWeekDiffs: Array<{
    programUuid: string;
    programTitle: string;
    week: string;
    oldNote: string;
    newNote: string;
  }>;
  presetNoteDiffs: Array<{
    presetUuid: string;
    presetTitle: string;
    oldNote: string;
    newNote: string;
  }>;
  exerciseNoteDiffs: Array<{
    presetUuid: string;
    presetTitle: string;
    exerciseIndex: number;
    exerciseName: string;
    oldNote: string;
    newNote: string;
  }>;
  scheduleNoteDiffs: Array<{
    date: string;
    scheduleItemUuid: string;
    presetName: string;
    oldNote: string;
    newNote: string;
  }>;
  structuralChangesCount: number;
}

export function buildAiCoachExportPayload(params: {
  program: WorkoutProgram | null;
  presets: WorkoutPreset[];
  schedules: Record<string, DailySchedule>;
}) {
  const { program, presets, schedules } = params;
  const today = getTodayIsoDate();

  const referencedPresetIds = new Set<string>();
  if (program) {
    for (const day of program.scheduleTemplate || []) {
      for (const item of day.items || []) {
        if (item.presetUuid) referencedPresetIds.add(item.presetUuid);
      }
    }
    for (const p of presets) {
      if (p.programIds?.includes(program.programUuid)) {
        referencedPresetIds.add(p.presetUuid);
      }
    }
  }

  const upcomingItems: Array<{
    scheduleItemUuid: string;
    date: string;
    presetUuid: string;
    presetName: string;
    coachNotes: string;
  }> = [];

  const sortedDates = Object.keys(schedules)
    .filter((d) => d >= today)
    .sort();

  for (const date of sortedDates) {
    const daySched = schedules[date];
    for (const item of daySched?.items || []) {
      if (program && item.programUuid && item.programUuid !== program.programUuid) {
        continue;
      }
      if (item.presetUuid) referencedPresetIds.add(item.presetUuid);
      const matchedPreset = presets.find((p) => p.presetUuid === item.presetUuid);
      upcomingItems.push({
        scheduleItemUuid: item.scheduleItemUuid,
        date,
        presetUuid: item.presetUuid,
        presetName: matchedPreset?.title || 'Workout',
        coachNotes: item.coachNotes || '',
      });
    }
  }

  const referencedPresets =
    referencedPresetIds.size > 0
      ? presets.filter((p) => referencedPresetIds.has(p.presetUuid))
      : presets;

  return {
    _instructions: [
      'Return ONLY a JSON object matching this exact patch structure.',
      'Keep exact programId, presetId (id), scheduleId (id), date, and exerciseIndex / exerciseUid keys.',
      'Put week-specific or date-specific targets (e.g. W1, W2, W3 progressions) ONLY on upcomingSchedule (scheduleId) entries—NEVER write multi-week W1 | W2 | W3 schedules into reusable presetId notes.',
      'Keep presetId notes strictly for universal cues that apply to every session.',
      'On upcomingSchedule entries you may set notes (session target) and optional exerciseNotesByUid or exerciseNotesByIndex for session-specific exercise cues.',
      'Update ONLY weekFocusNotes, notes, and exercise notes unless structural edits are explicitly requested. Do NOT alter sets, weights, dates, or add/remove exercises unless asked.',
    ].join(' '),
    program: program
      ? {
          programId: program.programUuid,
          name: program.title,
          weeks: program.cycleLengthWeeks,
          weekFocusNotes: program.weekProgressionNotes || {},
        }
      : null,
    presets: referencedPresets.map((p) => ({
      id: p.presetUuid,
      name: p.title,
      category: p.workoutType,
      notes: p.workoutNotes || '',
      exercises: p.exercises.map((ex, idx) => ({
        index: idx,
        exerciseUid: ex.exerciseUuid,
        name: ex.exerciseName,
        loadType: ex.loadType,
        weightKg: ex.defaultWeight,
        ...(ex.secondaryWeightKg !== undefined
          ? { secondaryWeightKg: ex.secondaryWeightKg }
          : {}),
        sets: ex.defaultSets,
        targetReps: ex.defaultReps,
        notes: ex.baseNotes || '',
      })),
    })),
    upcomingSchedule: upcomingItems.map((u) => ({
      id: u.scheduleItemUuid,
      date: u.date,
      presetId: u.presetUuid,
      presetName: u.presetName,
      notes: u.coachNotes,
    })),
  };
}

export function parseAiNotesPatch(rawText: string): {
  patch: AiNotesPatchPayload | null;
  error: string | null;
} {
  if (!rawText.trim()) {
    return { patch: null, error: null };
  }
  try {
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      return {
        patch: { upcomingSchedule: parsed as AiCoachSchedulePatch[] },
        error: null,
      };
    }
    if (!parsed || typeof parsed !== 'object') {
      return { patch: null, error: 'Patch must be a JSON object or array of schedule note updates.' };
    }
    const obj = parsed as AiNotesPatchPayload;
    if (!obj.upcomingSchedule && !obj.schedule && (obj.updates || obj.notesPatch)) {
      return {
        patch: {
          ...obj,
          upcomingSchedule: obj.updates || obj.notesPatch,
        },
        error: null,
      };
    }
    return { patch: obj, error: null };
  } catch (err: any) {
    return { patch: null, error: err?.message || 'Invalid JSON syntax' };
  }
}

export function buildAiNotesDiffPreview(
  patch: AiNotesPatchPayload,
  state: {
    programs: WorkoutProgram[];
    presets: WorkoutPreset[];
    schedules: Record<string, DailySchedule>;
  }
): AiNotesDiffPreview {
  const programWeekDiffs: AiNotesDiffPreview['programWeekDiffs'] = [];
  const presetNoteDiffs: AiNotesDiffPreview['presetNoteDiffs'] = [];
  const exerciseNoteDiffs: AiNotesDiffPreview['exerciseNoteDiffs'] = [];
  const scheduleNoteDiffs: AiNotesDiffPreview['scheduleNoteDiffs'] = [];
  let structuralChangesCount = 0;

  if (patch.program) {
    const targetProgId =
      patch.program.programId || patch.program.programUuid || patch.program.id;
    const prog = state.programs.find((p) => p.programUuid === targetProgId);
    const incomingWeeks =
      patch.program.weekFocusNotes || patch.program.weekProgressionNotes;
    if (prog && incomingWeeks && typeof incomingWeeks === 'object') {
      for (const [week, rawNote] of Object.entries(incomingWeeks)) {
        if (typeof rawNote !== 'string') continue;
        const oldNote = prog.weekProgressionNotes?.[week] || '';
        if (rawNote.trim() !== oldNote.trim()) {
          programWeekDiffs.push({
            programUuid: prog.programUuid,
            programTitle: prog.title,
            week,
            oldNote,
            newNote: rawNote,
          });
        }
      }
    }
  }

  for (const pPatch of patch.presets || []) {
    const targetPresetId = pPatch.id || pPatch.presetId || pPatch.presetUuid;
    const preset = state.presets.find((p) => p.presetUuid === targetPresetId);
    if (!preset) continue;

    const incomingPresetNote =
      pPatch.notes !== undefined ? pPatch.notes : pPatch.workoutNotes;
    if (typeof incomingPresetNote === 'string') {
      const oldNote = preset.workoutNotes || '';
      if (incomingPresetNote.trim() !== oldNote.trim()) {
        presetNoteDiffs.push({
          presetUuid: preset.presetUuid,
          presetTitle: preset.title,
          oldNote,
          newNote: incomingPresetNote,
        });
      }
    }

    for (const exPatch of pPatch.exercises || []) {
      const idx =
        exPatch.index !== undefined
          ? exPatch.index
          : exPatch.exerciseIndex !== undefined
          ? exPatch.exerciseIndex
          : preset.exercises.findIndex(
              (e) =>
                e.exerciseUuid === (exPatch.exerciseUid || exPatch.exerciseUuid)
            );
      if (idx < 0 || idx >= preset.exercises.length) {
        structuralChangesCount += 1;
        continue;
      }
      const existingEx = preset.exercises[idx];

      if (
        (exPatch.sets !== undefined && exPatch.sets !== existingEx.defaultSets) ||
        (exPatch.weightKg !== undefined && exPatch.weightKg !== existingEx.defaultWeight) ||
        (exPatch.targetReps !== undefined && exPatch.targetReps !== existingEx.defaultReps) ||
        (exPatch.loadType !== undefined && exPatch.loadType !== existingEx.loadType)
      ) {
        structuralChangesCount += 1;
      }

      const incomingExNote =
        exPatch.notes !== undefined
          ? exPatch.notes
          : exPatch.exerciseNotes !== undefined
          ? exPatch.exerciseNotes
          : exPatch.baseNotes;

      if (typeof incomingExNote === 'string') {
        const oldNote = existingEx.baseNotes || '';
        if (incomingExNote.trim() !== oldNote.trim()) {
          exerciseNoteDiffs.push({
            presetUuid: preset.presetUuid,
            presetTitle: preset.title,
            exerciseIndex: idx,
            exerciseName: existingEx.exerciseName,
            oldNote,
            newNote: incomingExNote,
          });
        }
      }
    }
  }

  const schedPatches =
    patch.upcomingSchedule || patch.schedule || patch.updates || patch.notesPatch || [];
  for (const sPatch of schedPatches) {
    const targetDate = sPatch.date;
    const targetItemId = sPatch.id || sPatch.scheduleId || sPatch.scheduleItemUuid;
    const targetWorkoutRef = sPatch.workoutId || sPatch.presetId || sPatch.presetUuid;
    const targetSlot = (sPatch.slot || sPatch.slotRole || '').trim().toLowerCase();

    const matchedPresetByRef = targetWorkoutRef
      ? state.presets.find(
          (p) =>
            p.presetUuid === targetWorkoutRef ||
            p.slug === targetWorkoutRef ||
            p.legacyWorkoutId === targetWorkoutRef ||
            p.title.toLowerCase() === targetWorkoutRef.toLowerCase()
        )
      : undefined;
    const resolvedPresetUuid = matchedPresetByRef?.presetUuid || targetWorkoutRef;

    const candidateDates = targetDate
      ? [targetDate]
      : Object.keys(state.schedules);

    for (const d of candidateDates) {
      const daySched = state.schedules[d];
      if (!daySched) continue;
      const item = daySched.items.find((it) => {
        if (targetItemId && it.scheduleItemUuid === targetItemId) return true;
        if (!targetItemId && targetDate) {
          const slotMatch = targetSlot
            ? (it.slotRole || '').trim().toLowerCase() === targetSlot
            : false;
          const workoutMatch = resolvedPresetUuid
            ? it.presetUuid === resolvedPresetUuid
            : false;
          if (targetSlot && resolvedPresetUuid) return slotMatch && workoutMatch;
          if (workoutMatch) return true;
          if (slotMatch) return true;
        }
        return false;
      });
      if (!item) continue;

      const incomingNote =
        sPatch.notes !== undefined
          ? sPatch.notes
          : sPatch.coachNotes !== undefined
          ? sPatch.coachNotes
          : sPatch.targetCues;
      const matchedPreset = state.presets.find(
        (p) => p.presetUuid === item.presetUuid
      );
      if (typeof incomingNote === 'string') {
        const oldNote = item.coachNotes || '';
        if (incomingNote.trim() !== oldNote.trim()) {
          scheduleNoteDiffs.push({
            date: d,
            scheduleItemUuid: item.scheduleItemUuid,
            presetName: matchedPreset?.title || 'Scheduled Workout',
            oldNote,
            newNote: incomingNote,
          });
        }
      }
      if (sPatch.exerciseNotesByUid) {
        for (const [uid, exNote] of Object.entries(sPatch.exerciseNotesByUid)) {
          if (typeof exNote !== 'string') continue;
          const oldExNote = item.exerciseNotesByUid?.[uid] || '';
          if (exNote.trim() !== oldExNote.trim()) {
            const exName =
              matchedPreset?.exercises.find((e) => e.exerciseUuid === uid)
                ?.exerciseName || uid;
            scheduleNoteDiffs.push({
              date: d,
              scheduleItemUuid: item.scheduleItemUuid,
              presetName: `${matchedPreset?.title || 'Scheduled'} · ${exName}`,
              oldNote: oldExNote,
              newNote: exNote,
            });
          }
        }
      }
      if (sPatch.exerciseNotesByIndex) {
        for (const [idxKey, exNote] of Object.entries(sPatch.exerciseNotesByIndex)) {
          if (typeof exNote !== 'string') continue;
          const oldExNote = item.exerciseNotesByIndex?.[idxKey] || '';
          if (exNote.trim() !== oldExNote.trim()) {
            const exName =
              matchedPreset?.exercises[Number(idxKey)]?.exerciseName ||
              `Exercise #${Number(idxKey) + 1}`;
            scheduleNoteDiffs.push({
              date: d,
              scheduleItemUuid: item.scheduleItemUuid,
              presetName: `${matchedPreset?.title || 'Scheduled'} · ${exName}`,
              oldNote: oldExNote,
              newNote: exNote,
            });
          }
        }
      }
      break;
    }
  }

  return {
    programWeekDiffs,
    presetNoteDiffs,
    exerciseNoteDiffs,
    scheduleNoteDiffs,
    structuralChangesCount,
  };
}

/**
 * Fallback filter for legacy pipe-separated multi-week notes (e.g. "W1: ... | W2: ... | W3: ...").
 * When the active workout belongs to a known program week, extracts only that week's segment.
 */
export function filterNoteForWeek(note: string | undefined | null, weekNumber?: number | null): string {
  if (!note) return '';
  if (!weekNumber || !note.includes('|')) return note;

  const segments = note
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  if (segments.length < 2) return note;

  const weekRegex = /^(?:W|Week\s*)(\d+)\b/i;
  const taggedCount = segments.filter((s) => weekRegex.test(s)).length;
  if (taggedCount < 2) return note;

  const match = segments.find((s) => {
    const m = s.match(weekRegex);
    return m && Number(m[1]) === weekNumber;
  });
  return match || note;
}

export interface CoachReviewExportParams {
  startDate: string;
  endDate: string;
  periodLabel: string;
  logs: WorkoutLog[];
  schedules: Record<string, DailySchedule>;
  contextBlocks: ContextBlock[];
  presets: WorkoutPreset[];
  programs: WorkoutProgram[];
  activeProgramUuid?: string;
  includeUpcoming7Days: boolean;
  includeContextFlags: boolean;
  includeSundayCheckInPrompt: boolean;
}

export function buildCoachReviewExport(params: CoachReviewExportParams): {
  payload: Record<string, unknown>;
  completedCount: number;
  upcomingCount: number;
  contextCount: number;
} {
  const {
    startDate,
    endDate,
    periodLabel,
    logs,
    schedules,
    contextBlocks,
    presets,
    programs,
    activeProgramUuid,
    includeUpcoming7Days,
    includeContextFlags,
    includeSundayCheckInPrompt,
  } = params;

  const today = getTodayIsoDate();
  const next7End = shiftIsoDate(today, 6);
  const activeProgram =
    programs.find((p) => p.programUuid === activeProgramUuid) || programs[0] || null;

  const completedLogs = logs
    .filter(
      (log) =>
        log.status === 'completed' &&
        log.date >= startDate &&
        log.date <= endDate
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const completedWorkouts = completedLogs.map((log) => {
    const durationMin =
      log.durationMinutes ??
      (log.durationSec
        ? Math.round((log.durationSec / 60) * 10) / 10
        : log.elapsedSeconds
        ? Math.round((log.elapsedSeconds / 60) * 10) / 10
        : undefined);

    return {
      date: log.date,
      workoutId: log.presetUuid,
      workoutTitle: log.workoutTitleSnapshot,
      workoutType: log.workoutType,
      ...(log.isBiteSize || log.slotRole === 'Bite-Size'
        ? { isBiteSize: true, slot: 'Bite-Size' }
        : log.slotRole
        ? { slot: log.slotRole }
        : {}),
      ...(durationMin !== undefined ? { durationMin } : {}),
      totalVolumeKg: Math.round((log.totalSessionVolumeKg || 0) * 10) / 10,
      ...(log.amrapRounds !== undefined || log.formatMode === 'amrap'
        ? {
            formatMode: 'amrap',
            amrapRounds: log.amrapRounds ?? 0,
            amrapExtraReps: log.amrapExtraReps || {},
            amrapTimeCapMinutes: log.amrapTimeCapMinutes || durationMin,
          }
        : {}),
      ...(log.completedRounds !== undefined
        ? {
            roundsCompleted: log.completedRounds,
            ...(log.targetRounds !== undefined ? { targetRounds: log.targetRounds } : {}),
          }
        : {}),
      ...(log.sessionNotes ? { notes: log.sessionNotes } : {}),
      exercises: (log.exercises || []).map((ex) => ({
        exerciseName: ex.exerciseName,
        loadType: ex.loadType,
        weightKg: ex.weight,
        ...(ex.secondaryWeightKg !== undefined
          ? { secondaryWeightKg: ex.secondaryWeightKg }
          : {}),
        ...(ex.sets && ex.sets.length > 0
          ? {
              sets: ex.sets.map((s) => ({
                set: s.setNumber,
                reps: s.reps,
                weightKg: s.weightOverride ?? ex.weight,
              })),
            }
          : {}),
        totalReps: ex.totalReps,
        totalLoadKg: Math.round((ex.totalLoadKg || 0) * 10) / 10,
        ...(ex.rir !== undefined ? { rir: ex.rir } : {}),
        ...(ex.roundsCompleted !== undefined ? { roundsCompleted: ex.roundsCompleted } : {}),
        ...(ex.durationSec !== undefined ? { durationSec: ex.durationSec } : {}),
        ...(ex.distance !== undefined
          ? { distance: ex.distance, distanceUnit: ex.distanceUnit || 'mi' }
          : {}),
        ...(ex.paceSecPerUnit !== undefined ? { paceSecPerUnit: ex.paceSecPerUnit } : {}),
        ...(ex.avgHr !== undefined ? { avgHr: ex.avgHr } : {}),
        ...(ex.exerciseNotes ? { notes: ex.exerciseNotes } : {}),
      })),
    };
  });

  const upcomingSchedule7Days: Array<{
    scheduleId: string;
    date: string;
    slot: string;
    workoutId: string;
    workoutTitle: string;
    status: string;
    notes: string;
  }> = [];

  if (includeUpcoming7Days) {
    const sortedDates = Object.keys(schedules)
      .filter((d) => d >= today && d <= next7End)
      .sort();
    for (const date of sortedDates) {
      for (const item of schedules[date]?.items || []) {
        const preset = presets.find((p) => p.presetUuid === item.presetUuid);
        upcomingSchedule7Days.push({
          scheduleId: item.scheduleItemUuid,
          date,
          slot: item.slotRole || 'Primary',
          workoutId: item.presetUuid,
          workoutTitle: preset?.title || 'Scheduled Workout',
          status: item.status || 'pending',
          notes: item.coachNotes || '',
        });
      }
    }
  }

  const relevantContextBlocks = includeContextFlags
    ? contextBlocks
        .filter((b) => b.endDate >= startDate && b.startDate <= next7End)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
        .map((b) => ({
          startDate: b.startDate,
          endDate: b.endDate,
          category: b.category,
          title: b.title,
          ...(b.notes ? { notes: b.notes } : {}),
        }))
    : [];

  const payload: Record<string, unknown> = {};

  if (includeSundayCheckInPrompt) {
    payload._coachPrompt = [
      'Sunday Night Check-In: Review my completed workouts (volume, weight, reps, RIR, duration, notes), mitigating factors/injury/travel flags, and upcoming 7-day schedule below.',
      'Provide concise coaching feedback and return EITHER:',
      '(1) A non-destructive Notes Patch JSON updating next-week targets/injury cues: { "upcomingSchedule": [{ "scheduleId": "...", "date": "YYYY-MM-DD", "slot": "Primary", "workoutId": "...", "notes": "..." }] }, OR',
      '(2) A full Program & Weekly Cycle JSON if programming changes are needed: { "programName": "...", "cycleWeeks": 2, "weeks": [{ "weekNumber": 1, "days": [{ "dayOfWeek": 1, "slots": [{ "slotRole": "Primary", "workoutId": "...", "notes": "..." }] }] }], "autoFill": { "startDate": "YYYY-MM-DD", "endDate": "YYYY-MM-DD" } }.',
      'Use exact workoutId values from workoutDirectory below whenever referencing existing workouts.',
    ].join(' ');
  }

  payload.reviewWindow = {
    period: periodLabel,
    startDate,
    endDate,
    exportedAt: new Date().toISOString(),
  };

  if (activeProgram) {
    payload.activeProgram = {
      programId: activeProgram.programUuid,
      name: activeProgram.title,
      cycleWeeks: activeProgram.cycleLengthWeeks,
    };
  }

  payload.completedWorkouts = completedWorkouts;

  if (includeUpcoming7Days) {
    payload.upcomingSchedule7Days = upcomingSchedule7Days;
  }

  if (includeContextFlags) {
    payload.mitigatingFactors = relevantContextBlocks;
  }

  if (includeSundayCheckInPrompt) {
    payload.workoutDirectory = presets
      .filter((p) => !p.isArchived)
      .map((p) => ({
        workoutId: p.presetUuid,
        slug: p.slug,
        title: p.title,
        workoutType: p.workoutType,
        ...(p.durationMinutes !== undefined ? { durationMinutes: p.durationMinutes } : {}),
        ...(p.isBiteSize ? { isBiteSize: true } : {}),
      }));
  }

  return {
    payload,
    completedCount: completedWorkouts.length,
    upcomingCount: upcomingSchedule7Days.length,
    contextCount: relevantContextBlocks.length,
  };
}

export interface ParsedProgramCycleImport {
  programName: string;
  description?: string;
  cycleWeeks: number;
  scheduleTemplate: ProgramDayTemplate[];
  weekProgressionNotes: Record<string, string>;
  presets: Array<Partial<WorkoutPreset> & { slug?: string; title: string }>;
  autoFill?: {
    startDate: string;
    endDate: string;
    conflictMode?: 'replace' | 'update_matching' | 'skip';
  };
  totalSlots: number;
  unresolvedWorkoutRefs: string[];
}

const DAY_NAME_TO_INDEX: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

function parseDayOfWeekValue(val: unknown): number | null {
  if (typeof val === 'number' && Number.isInteger(val) && val >= 0 && val <= 6) {
    return val;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim().toLowerCase();
    if (/^[0-6]$/.test(trimmed)) return Number(trimmed);
    if (trimmed in DAY_NAME_TO_INDEX) return DAY_NAME_TO_INDEX[trimmed];
  }
  return null;
}

export function parseAiProgramCycleImport(
  rawText: string,
  existingPresets: WorkoutPreset[]
): {
  parsed: ParsedProgramCycleImport | null;
  error: string | null;
} {
  if (!rawText.trim()) {
    return { parsed: null, error: null };
  }

  try {
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const raw = JSON.parse(cleaned);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { parsed: null, error: 'Program import must be a JSON object.' };
    }

    const obj = raw as Record<string, any>;

    // Allow legacy { programs: [...] } wrapper
    const programSource =
      !obj.programName && !obj.weeks && Array.isArray(obj.programs) && obj.programs[0]
        ? (obj.programs[0] as Record<string, any>)
        : obj;

    const programName = String(
      programSource.programName || programSource.title || programSource.name || ''
    ).trim();

    if (!programName) {
      return {
        parsed: null,
        error: 'Missing "programName" (or "title") in program JSON.',
      };
    }

    const incomingPresets: Array<Partial<WorkoutPreset> & { slug?: string; title: string }> =
      Array.isArray(obj.presets)
        ? obj.presets
            .filter((p: any) => p && typeof p === 'object' && (p.title || p.name))
            .map((p: any) => {
              const title = String(p.title || p.name).trim();
              const presetUuid = p.presetUuid || p.workoutId || p.id || `pre-${uuidv4()}`;
              return {
                ...p,
                presetUuid,
                title,
                slug:
                  p.slug ||
                  `wkt_${title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`,
              };
            })
        : [];

    const allPresetLookup = [
      ...incomingPresets.map((p) => ({
        presetUuid: p.presetUuid || '',
        slug: p.slug || '',
        legacyWorkoutId: p.legacyWorkoutId || '',
        title: p.title || '',
      })),
      ...existingPresets.map((p) => ({
        presetUuid: p.presetUuid,
        slug: p.slug,
        legacyWorkoutId: p.legacyWorkoutId || '',
        title: p.title,
      })),
    ];

    const unresolvedSet = new Set<string>();
    const resolveWorkoutId = (ref: unknown): string => {
      const str = String(ref || '').trim();
      if (!str) return '';
      const exact = allPresetLookup.find(
        (p) =>
          p.presetUuid === str ||
          p.slug === str ||
          (p.legacyWorkoutId && p.legacyWorkoutId.toLowerCase() === str.toLowerCase()) ||
          p.title.toLowerCase() === str.toLowerCase()
      );
      if (exact) return exact.presetUuid;
      unresolvedSet.add(str);
      return str;
    };

    const weekProgressionNotes: Record<string, string> = {};
    const rawWeekNotes =
      programSource.weekFocusNotes || programSource.weekProgressionNotes || obj.weekFocusNotes;
    if (rawWeekNotes && typeof rawWeekNotes === 'object') {
      for (const [k, v] of Object.entries(rawWeekNotes)) {
        if (typeof v === 'string' && v.trim()) {
          weekProgressionNotes[String(k)] = v.trim();
        }
      }
    }

    const templateMap = new Map<string, ProgramDayTemplate>();
    const upsertDaySlots = (
      weekNumber: number,
      dayOfWeek: number,
      rawSlots: any[]
    ) => {
      const items: ProgramTemplateItem[] = [];
      for (const slot of rawSlots || []) {
        if (!slot || typeof slot !== 'object') continue;
        const ref =
          slot.workoutId ||
          slot.presetUuid ||
          slot.presetId ||
          slot.presetSlug ||
          slot.workoutTitle ||
          slot.title;
        const presetUuid = resolveWorkoutId(ref);
        if (!presetUuid) continue;
        items.push({
          orderIndex: items.length,
          slotRole: String(slot.slotRole || slot.slot || (items.length === 0 ? 'Primary' : 'Secondary')),
          presetUuid,
          defaultNotes:
            typeof slot.notes === 'string'
              ? slot.notes
              : typeof slot.defaultNotes === 'string'
              ? slot.defaultNotes
              : typeof slot.coachNotes === 'string'
              ? slot.coachNotes
              : '',
        });
      }
      if (items.length > 0) {
        const key = `${weekNumber}-${dayOfWeek}`;
        templateMap.set(key, { weekNumber, dayOfWeek, items });
      }
    };

    let maxWeekSeen = 0;

    // Format 1: scheduleTemplate array directly [{ weekNumber, dayOfWeek, items }]
    const directTemplate = programSource.scheduleTemplate;
    if (Array.isArray(directTemplate)) {
      for (const entry of directTemplate) {
        if (!entry || typeof entry !== 'object') continue;
        const wk = Number(entry.weekNumber || entry.week || 1);
        const dow = parseDayOfWeekValue(entry.dayOfWeek ?? entry.day);
        if (!Number.isInteger(wk) || wk < 1 || dow === null) continue;
        maxWeekSeen = Math.max(maxWeekSeen, wk);
        upsertDaySlots(wk, dow, entry.items || entry.slots || []);
      }
    }

    // Format 2: weeks array or object
    const rawWeeks = programSource.weeks;
    if (Array.isArray(rawWeeks)) {
      rawWeeks.forEach((wkEntry: any, idx: number) => {
        if (!wkEntry || typeof wkEntry !== 'object') return;
        const wkNum = Number(wkEntry.weekNumber || wkEntry.week || idx + 1);
        if (!Number.isInteger(wkNum) || wkNum < 1) return;
        maxWeekSeen = Math.max(maxWeekSeen, wkNum);

        const wkFocus = wkEntry.focusNote || wkEntry.notes || wkEntry.focus;
        if (typeof wkFocus === 'string' && wkFocus.trim()) {
          weekProgressionNotes[String(wkNum)] = wkFocus.trim();
        }

        if (Array.isArray(wkEntry.days)) {
          for (const dEntry of wkEntry.days) {
            if (!dEntry || typeof dEntry !== 'object') continue;
            const dow = parseDayOfWeekValue(dEntry.dayOfWeek ?? dEntry.day);
            if (dow === null) continue;
            upsertDaySlots(wkNum, dow, dEntry.slots || dEntry.items || dEntry.workouts || []);
          }
        } else if (wkEntry.days && typeof wkEntry.days === 'object') {
          for (const [dayKey, slotsVal] of Object.entries(wkEntry.days)) {
            const dow = parseDayOfWeekValue(dayKey);
            if (dow === null || !Array.isArray(slotsVal)) continue;
            upsertDaySlots(wkNum, dow, slotsVal);
          }
        } else if (wkEntry.dayOfWeek !== undefined || wkEntry.day !== undefined) {
          const dow = parseDayOfWeekValue(wkEntry.dayOfWeek ?? wkEntry.day);
          if (dow !== null) {
            upsertDaySlots(wkNum, dow, wkEntry.slots || wkEntry.items || []);
          }
        }
      });
    } else if (rawWeeks && typeof rawWeeks === 'object') {
      for (const [wkKey, wkVal] of Object.entries(rawWeeks)) {
        const wkNum = Number(wkKey.replace(/\D+/g, '')) || 1;
        maxWeekSeen = Math.max(maxWeekSeen, wkNum);
        if (wkVal && typeof wkVal === 'object' && !Array.isArray(wkVal)) {
          for (const [dayKey, slotsVal] of Object.entries(wkVal as Record<string, any>)) {
            const dow = parseDayOfWeekValue(dayKey);
            if (dow === null || !Array.isArray(slotsVal)) continue;
            upsertDaySlots(wkNum, dow, slotsVal);
          }
        }
      }
    }

    const declaredCycleWeeks = Number(
      programSource.cycleWeeks || programSource.cycleLengthWeeks || maxWeekSeen || 1
    );
    const cycleWeeks = Math.max(
      1,
      Math.min(16, Math.round(Math.max(declaredCycleWeeks, maxWeekSeen)))
    );

    const scheduleTemplate = Array.from(templateMap.values()).sort(
      (a, b) => a.weekNumber - b.weekNumber || a.dayOfWeek - b.dayOfWeek
    );
    const totalSlots = scheduleTemplate.reduce((acc, d) => acc + d.items.length, 0);

    let autoFill: ParsedProgramCycleImport['autoFill'];
    const rawAutoFill = obj.autoFill || programSource.autoFill;
    if (
      rawAutoFill &&
      typeof rawAutoFill === 'object' &&
      typeof rawAutoFill.startDate === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(rawAutoFill.startDate) &&
      typeof rawAutoFill.endDate === 'string' &&
      /^\d{4}-\d{2}-\d{2}$/.test(rawAutoFill.endDate)
    ) {
      autoFill = {
        startDate: rawAutoFill.startDate,
        endDate: rawAutoFill.endDate,
        conflictMode:
          rawAutoFill.conflictMode === 'skip' ||
          rawAutoFill.conflictMode === 'update_matching' ||
          rawAutoFill.conflictMode === 'replace'
            ? rawAutoFill.conflictMode
            : 'replace',
      };
    }

    return {
      parsed: {
        programName,
        description:
          typeof programSource.description === 'string'
            ? programSource.description.trim()
            : undefined,
        cycleWeeks,
        scheduleTemplate,
        weekProgressionNotes,
        presets: incomingPresets,
        autoFill,
        totalSlots,
        unresolvedWorkoutRefs: Array.from(unresolvedSet),
      },
      error: null,
    };
  } catch (err: any) {
    return { parsed: null, error: err?.message || 'Invalid JSON syntax' };
  }
}

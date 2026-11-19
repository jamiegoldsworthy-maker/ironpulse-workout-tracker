import {
  DailySchedule,
  LoadType,
  WorkoutPreset,
  WorkoutProgram,
} from '../types/workout';
import { getTodayIsoDate } from './calculations';

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
  presetId?: string;
  presetUuid?: string;
  notes?: string;
  coachNotes?: string;
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
      'Update ONLY weekFocusNotes, workoutNotes / notes, and exercise notes unless structural edits are explicitly requested.',
      'Do NOT alter sets, weights, dates, or add/remove exercises unless asked.',
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
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { patch: null, error: 'Patch must be a JSON object.' };
    }
    return { patch: parsed as AiNotesPatchPayload, error: null };
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

  const schedPatches = patch.upcomingSchedule || patch.schedule || [];
  for (const sPatch of schedPatches) {
    const targetDate = sPatch.date;
    const targetItemId = sPatch.id || sPatch.scheduleId || sPatch.scheduleItemUuid;
    const targetPresetId = sPatch.presetId || sPatch.presetUuid;

    const candidateDates = targetDate
      ? [targetDate]
      : Object.keys(state.schedules);

    for (const d of candidateDates) {
      const daySched = state.schedules[d];
      if (!daySched) continue;
      const item = daySched.items.find(
        (it) =>
          (targetItemId && it.scheduleItemUuid === targetItemId) ||
          (!targetItemId && targetPresetId && it.presetUuid === targetPresetId)
      );
      if (!item) continue;

      const incomingNote =
        sPatch.notes !== undefined ? sPatch.notes : sPatch.coachNotes;
      if (typeof incomingNote === 'string') {
        const oldNote = item.coachNotes || '';
        if (incomingNote.trim() !== oldNote.trim()) {
          const matchedPreset = state.presets.find(
            (p) => p.presetUuid === item.presetUuid
          );
          scheduleNoteDiffs.push({
            date: d,
            scheduleItemUuid: item.scheduleItemUuid,
            presetName: matchedPreset?.title || 'Scheduled Workout',
            oldNote,
            newNote: incomingNote,
          });
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

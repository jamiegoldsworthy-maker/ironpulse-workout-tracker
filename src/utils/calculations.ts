import {
  DistanceUnit,
  ExerciseMetricType,
  LoadType,
  LoggedExercise,
  RepSchemeType,
  SetEntry,
} from '../types/workout';

export function uuidv4(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

export function slugify(text: string, prefix = ''): string {
  const core = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return prefix ? `${prefix}_${core}` : core;
}

export function formatDisplayId(seq: number): string {
  return `ID-${String(seq).padStart(4, '0')}`;
}

/**
 * Expands a ladder / pyramid rep scheme into its exact per-round rep array.
 * Examples:
 * - descending_ladder (10 -> 1, step 1) => [10, 9, 8, 7, 6, 5, 4, 3, 2, 1] (55 reps)
 * - ascending_ladder (1 -> 5, step 1) => [1, 2, 3, 4, 5] (15 reps)
 * - pyramid (1 -> 5, step 1) => [1, 2, 3, 4, 5, 4, 3, 2, 1] (25 reps)
 */
export function expandLadderSequence(
  start: number,
  end: number,
  step = 1,
  schemeType: RepSchemeType = 'fixed'
): number[] {
  if (schemeType === 'fixed') return [];
  const cleanStep = Math.max(1, Math.round(Number(step) || 1));
  const cleanStart = Math.max(1, Math.round(Number(start) || 1));
  const cleanEnd = Math.max(1, Math.round(Number(end) || 1));
  const MAX_RUNGS = 100;

  if (schemeType === 'descending_ladder') {
    const hi = Math.max(cleanStart, cleanEnd);
    const lo = Math.min(cleanStart, cleanEnd);
    const seq: number[] = [];
    for (let r = hi; r >= lo && seq.length < MAX_RUNGS; r -= cleanStep) {
      seq.push(r);
    }
    return seq;
  }

  if (schemeType === 'ascending_ladder') {
    const lo = Math.min(cleanStart, cleanEnd);
    const hi = Math.max(cleanStart, cleanEnd);
    const seq: number[] = [];
    for (let r = lo; r <= hi && seq.length < MAX_RUNGS; r += cleanStep) {
      seq.push(r);
    }
    return seq;
  }

  // pyramid: start -> end -> start
  const seq: number[] = [];
  if (cleanStart <= cleanEnd) {
    for (let r = cleanStart; r <= cleanEnd && seq.length < MAX_RUNGS; r += cleanStep) {
      seq.push(r);
    }
    for (let r = cleanEnd - cleanStep; r >= cleanStart && seq.length < MAX_RUNGS; r -= cleanStep) {
      seq.push(r);
    }
  } else {
    for (let r = cleanStart; r >= cleanEnd && seq.length < MAX_RUNGS; r -= cleanStep) {
      seq.push(r);
    }
    for (let r = cleanEnd + cleanStep; r <= cleanStart && seq.length < MAX_RUNGS; r += cleanStep) {
      seq.push(r);
    }
  }
  return seq;
}

/**
 * Generates the exact SetEntry[] array for an exercise in a ladder/complex workout,
 * supporting both single-pass rung slicing (e.g. 7 of 10 rungs) and repeating multi-ladders
 * (e.g. 4 full 1->5 ladders + 2 extra rungs).
 */
export function buildLadderWorkoutSets(
  ex: LoggedExercise,
  options: {
    completedRungs?: number;
    laddersCompleted?: number;
    extraRungs?: number;
    ladderLength?: number;
  }
): SetEntry[] {
  const {
    completedRungs = 0,
    laddersCompleted = 0,
    extraRungs = 0,
    ladderLength = 5,
  } = options;

  const isMultiLadder = laddersCompleted > 0 || extraRungs > 0;

  if (!ex.repScheme || ex.repScheme.schemeType === 'fixed') {
    const totalRounds = isMultiLadder
      ? laddersCompleted * ladderLength + extraRungs
      : Math.max(0, completedRungs);
    const rpr = Math.max(1, ex.repsPerRound || 1);
    return Array.from({ length: totalRounds }, (_, i) => ({
      setNumber: i + 1,
      reps: rpr,
    }));
  }

  const seq = expandLadderSequence(
    ex.repScheme.ladderStart ?? 10,
    ex.repScheme.ladderEnd ?? 1,
    ex.repScheme.ladderStep ?? 1,
    ex.repScheme.schemeType
  );

  if (seq.length === 0) return [];

  let expandedReps: number[] = [];
  if (isMultiLadder) {
    for (let l = 0; l < laddersCompleted; l++) {
      expandedReps = expandedReps.concat(seq);
    }
    if (extraRungs > 0) {
      expandedReps = expandedReps.concat(seq.slice(0, extraRungs));
    }
  } else {
    expandedReps = seq.slice(0, Math.max(0, completedRungs));
  }

  return expandedReps.map((reps, i) => ({
    setNumber: i + 1,
    reps,
  }));
}

/**
 * Calculates the effective load in kg for a single set, respecting per-set weightOverride
 * and loadType multipliers (e.g. double_kg = 2x weight * reps).
 */
export function calculateSetLoadKg(
  loadType: LoadType,
  baseWeight: number,
  reps: number,
  weightOverride?: number,
  secondaryWeightKg = 0
): number {
  const cleanReps = Math.max(0, Number(reps) || 0);
  const hasOverride =
    weightOverride !== undefined && weightOverride !== null && !Number.isNaN(Number(weightOverride));
  const effectiveWeight = hasOverride
    ? Math.max(0, Number(weightOverride))
    : Math.max(0, Number(baseWeight) || 0);

  if (cleanReps === 0) return 0;

  switch (loadType) {
    case 'double_kg':
      return 2 * effectiveWeight * cleanReps;
    case 'offset_kg': {
      const combined = hasOverride
        ? effectiveWeight
        : effectiveWeight + Math.max(0, Number(secondaryWeightKg) || 0);
      return combined * cleanReps;
    }
    case 'single_kg':
    case 'bw_plus_kg':
    case 'ruck_kg':
      return effectiveWeight * cleanReps;
    case 'bodyweight':
    case 'none':
    default:
      return 0;
  }
}

/**
 * Returns the effective single-rep system weight in kg for 1RM estimation.
 */
export function getEffectiveImplementWeightKg(
  loadType: LoadType,
  baseWeight: number,
  weightOverride?: number,
  secondaryWeightKg = 0
): number {
  const hasOverride =
    weightOverride !== undefined && weightOverride !== null && !Number.isNaN(Number(weightOverride));
  const w = hasOverride
    ? Math.max(0, Number(weightOverride))
    : Math.max(0, Number(baseWeight) || 0);
  if (loadType === 'double_kg') return 2 * w;
  if (loadType === 'offset_kg') {
    return hasOverride ? w : w + Math.max(0, Number(secondaryWeightKg) || 0);
  }
  if (loadType === 'single_kg' || loadType === 'bw_plus_kg' || loadType === 'ruck_kg') return w;
  return 0;
}

/**
 * Computes totalSets, totalReps, totalLoadKg, and Epley estimated1RmKg across all sets.
 */
export function calculateExerciseTotals(
  loadType: LoadType,
  baseWeight: number,
  sets: SetEntry[],
  isPerSide = false,
  metricType: ExerciseMetricType = 'reps',
  secondaryWeightKg = 0
): {
  totalSets: number;
  totalReps: number;
  totalLoadKg: number;
  estimated1RmKg: number;
} {
  const validSets = sets.filter((s) => (Number(s.reps) || 0) > 0);
  const totalSets = validSets.length;
  const sideMultiplier = isPerSide ? 2 : 1;
  const isRepMetric = metricType === 'reps';
  let totalReps = 0;
  let totalLoadKg = 0;
  let best1Rm = 0;

  for (const s of validSets) {
    const reps = Math.max(0, Number(s.reps) || 0);
    const effectiveReps = reps * sideMultiplier;
    totalReps += effectiveReps;

    if (isRepMetric) {
      const setLoad = calculateSetLoadKg(
        loadType,
        baseWeight,
        effectiveReps,
        s.weightOverride,
        secondaryWeightKg
      );
      totalLoadKg += setLoad;

      const effectiveKg = getEffectiveImplementWeightKg(
        loadType,
        baseWeight,
        s.weightOverride,
        secondaryWeightKg
      );
      if (effectiveKg > 0 && reps > 0) {
        // Epley formula: weight * (1 + reps / 30)
        const epley = effectiveKg * (1 + Math.min(reps, 30) / 30);
        if (epley > best1Rm) {
          best1Rm = epley;
        }
      }
    }
  }

  return {
    totalSets,
    totalReps,
    totalLoadKg: Math.round(totalLoadKg * 10) / 10,
    estimated1RmKg: Math.round(best1Rm * 10) / 10,
  };
}

export function recalculateLoggedExercise(ex: LoggedExercise): LoggedExercise {
  if (ex.trackingType === 'cardio') {
    const unit: DistanceUnit = ex.distanceUnit || 'mi';
    const distance =
      ex.distance !== undefined
        ? Number(ex.distance)
        : ex.distanceKm !== undefined
        ? unit === 'mi'
          ? Math.round((Number(ex.distanceKm) / 1.60934) * 100) / 100
          : Number(ex.distanceKm)
        : 0;
    const durationSec = Number(ex.durationSec) || 0;
    const paceSecPerUnit =
      distance > 0 && durationSec > 0 ? Math.round(durationSec / distance) : undefined;
    const distanceKm =
      distance > 0
        ? unit === 'mi'
          ? Math.round(distance * 1.60934 * 100) / 100
          : distance
        : 0;
    const paceSecPerKm =
      distanceKm > 0 && durationSec > 0 ? Math.round(durationSec / distanceKm) : undefined;

    return {
      ...ex,
      distance,
      distanceUnit: unit,
      paceSecPerUnit,
      distanceKm,
      paceSecPerKm,
      totalLoadKg: ex.ruckLoadKg ? Number(ex.ruckLoadKg) : 0,
    };
  }

  if (ex.trackingType === 'circuit') {
    const totals = calculateExerciseTotals(
      ex.loadType,
      ex.weight,
      ex.sets || [],
      Boolean(ex.isPerSide),
      ex.metricType || 'reps',
      ex.secondaryWeightKg || 0
    );
    const rounds = Number(ex.roundsCompleted) || totals.totalSets || 0;
    const workSec = Number(ex.workSecPerRound) || 0;
    const restSec = Number(ex.restSecPerRound) || 0;
    const computedDuration =
      rounds > 0 && (workSec > 0 || restSec > 0)
        ? rounds * (workSec + restSec)
        : Number(ex.totalDurationSec) || 0;

    return {
      ...ex,
      ...totals,
      totalSets: rounds || totals.totalSets,
      totalDurationSec: computedDuration,
    };
  }

  const totals = calculateExerciseTotals(
    ex.loadType,
    ex.weight,
    ex.sets || [],
    Boolean(ex.isPerSide),
    ex.metricType || 'reps',
    ex.secondaryWeightKg || 0
  );
  return {
    ...ex,
    ...totals,
  };
}

export function inferDefaultMetricType(name: string): ExerciseMetricType {
  const lower = (name || '').toLowerCase();
  if (lower.includes('carry') || lower.includes('farmer') || lower.includes('sled')) {
    return 'distance';
  }
  return 'reps';
}

export function formatExerciseMetricSummary(ex: {
  metricType?: ExerciseMetricType;
  totalReps: number;
  totalLoadKg: number;
  loadType: LoadType;
  weight: number;
  secondaryWeightKg?: number;
}): string {
  const metric = ex.metricType || 'reps';
  if (metric === 'distance') {
    if (ex.loadType === 'offset_kg') {
      return `${ex.totalReps}m @ ${ex.weight}+${ex.secondaryWeightKg ?? 0}kg`;
    }
    const effKg = getEffectiveImplementWeightKg(ex.loadType, ex.weight, undefined, ex.secondaryWeightKg);
    return effKg > 0 ? `${ex.totalReps}m @ ${effKg}kg` : `${ex.totalReps}m`;
  }
  if (metric === 'time') {
    if (ex.loadType === 'offset_kg') {
      return `${ex.totalReps}s @ ${ex.weight}+${ex.secondaryWeightKg ?? 0}kg`;
    }
    const effKg = getEffectiveImplementWeightKg(ex.loadType, ex.weight, undefined, ex.secondaryWeightKg);
    return effKg > 0 ? `${ex.totalReps}s @ ${effKg}kg` : `${ex.totalReps}s`;
  }
  return `${ex.totalLoadKg.toLocaleString()} kg`;
}

export function formatLoadBadge(
  loadType: LoadType,
  weight: number,
  ruckLoadKg?: number,
  secondaryWeightKg?: number
): string {
  switch (loadType) {
    case 'double_kg':
      return `2x ${weight}kg`;
    case 'offset_kg':
      return `${weight}+${secondaryWeightKg ?? 0} kg`;
    case 'single_kg':
      return `${weight}kg`;
    case 'bw_plus_kg':
      return weight > 0 ? `BW + ${weight}kg` : 'BW';
    case 'ruck_kg':
      return `${ruckLoadKg ?? weight}kg Ruck`;
    case 'bodyweight':
      return 'BW';
    case 'none':
    default:
      return 'No Load';
  }
}

export function formatSecondsAsMmSs(totalSeconds?: number): string {
  if (!totalSeconds || totalSeconds <= 0 || Number.isNaN(totalSeconds)) return '00:00';
  const sec = Math.round(totalSeconds);
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const remSec = sec % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(remSec).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(remSec).padStart(2, '0')}`;
}

export function parseMmSsToSeconds(value: string): number {
  const clean = value.trim();
  if (!clean) return 0;
  if (/^\d+(\.\d+)?$/.test(clean)) {
    // Plain minutes if user types "45"
    return Math.round( parseFloat(clean) * 60 );
  }
  const parts = clean.split(':').map((p) => parseInt(p, 10) || 0);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
}

export function formatPace(paceSecPerUnit?: number, unit: DistanceUnit = 'mi'): string {
  if (!paceSecPerUnit || paceSecPerUnit <= 0) return `--:-- /${unit}`;
  const mins = Math.floor(paceSecPerUnit / 60);
  const secs = Math.round(paceSecPerUnit % 60);
  return `${mins}:${String(secs).padStart(2, '0')} /${unit}`;
}

/**
 * Parses legacy Google Sheet Column AA ("20kg", "2x 16kg", "BW", "BW+12kg") into loadType & weight.
 */
export function parsePrintedWeight(raw: string): { loadType: LoadType; weight: number } {
  const s = (raw || '').trim().toLowerCase();
  if (!s || s === 'bw' || s === 'bodyweight' || s === '-') {
    return { loadType: 'bodyweight', weight: 0 };
  }
  const doubleMatch = s.match(/2\s*x\s*(\d+(?:\.\d+)?)/i);
  if (doubleMatch) {
    return { loadType: 'double_kg', weight: parseFloat(doubleMatch[1]) };
  }
  const bwPlusMatch = s.match(/bw\s*\+\s*(\d+(?:\.\d+)?)/i);
  if (bwPlusMatch) {
    return { loadType: 'bw_plus_kg', weight: parseFloat(bwPlusMatch[1]) };
  }
  const ruckMatch = s.match(/(\d+(?:\.\d+)?)\s*(?:kg)?\s*ruck/i);
  if (ruckMatch) {
    return { loadType: 'ruck_kg', weight: parseFloat(ruckMatch[1]) };
  }
  const singleMatch = s.match(/(\d+(?:\.\d+)?)/);
  if (singleMatch) {
    return { loadType: 'single_kg', weight: parseFloat(singleMatch[1]) };
  }
  return { loadType: 'bodyweight', weight: 0 };
}

export type ExerciseGroupChunk<T> =
  | {
      type: 'single';
      item: T;
      originalIdx: number;
    }
  | {
      type: 'group';
      groupId: string;
      label: 'SUPERSET' | 'TRI-SET' | 'GIANT SET';
      groupLetter: string;
      items: Array<{ item: T; originalIdx: number; stepCode: string }>;
    };

/**
 * Groups consecutive exercises sharing the same non-empty `groupId` (length >= 2)
 * into SUPERSET (2), TRI-SET (3), or GIANT SET (4+) chunks with A1/A2/A3... step codes.
 */
export function groupConsecutiveExercises<T extends { groupId?: string }>(
  exercises: T[]
): Array<ExerciseGroupChunk<T>> {
  const chunks: Array<ExerciseGroupChunk<T>> = [];
  let groupCounter = 0;
  let i = 0;

  while (i < exercises.length) {
    const curr = exercises[i];
    const gid = curr.groupId;

    if (gid) {
      let j = i + 1;
      while (j < exercises.length && exercises[j].groupId === gid) {
        j += 1;
      }
      const runLen = j - i;
      if (runLen >= 2) {
        const letter = String.fromCharCode(65 + (groupCounter % 26));
        groupCounter += 1;
        const label =
          runLen === 2 ? 'SUPERSET' : runLen === 3 ? 'TRI-SET' : 'GIANT SET';
        const items = [];
        for (let k = i; k < j; k++) {
          items.push({
            item: exercises[k],
            originalIdx: k,
            stepCode: `${letter}${k - i + 1}`,
          });
        }
        chunks.push({
          type: 'group',
          groupId: gid,
          label,
          groupLetter: letter,
          items,
        });
        i = j;
        continue;
      }
    }

    chunks.push({
      type: 'single',
      item: curr,
      originalIdx: i,
    });
    i += 1;
  }

  return chunks;
}

export function getTodayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + deltaDays);
  const year = dt.getFullYear();
  const month = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function formatReadableDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

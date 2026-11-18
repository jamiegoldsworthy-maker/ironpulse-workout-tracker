import {
  CardioMode,
  GlobalExercise,
  LoadType,
  LoggedExercise,
  SetEntry,
  TrackingType,
  WorkoutLog,
  WorkoutPreset,
  WorkoutType,
} from '../types/workout';
import {
  parseMmSsToSeconds,
  parsePrintedWeight,
  recalculateLoggedExercise,
  slugify,
  uuidv4,
} from './calculations';

export interface ParsedLegacyRow {
  legacyId: string; // Col A (0)
  date: string; // Col B (1)
  workoutName: string; // Col C (2)
  workoutType: WorkoutType; // Col D (3)
  exerciseName: string; // Col E (4)
  category: string; // Col H (7)
  target: string; // Col I (8)
  setReps: number[]; // Col M:V (12..21)
  avgHr?: number; // Col Z (25)
  printedWeight: string; // Col AA (26)
  notes: string; // Col AE (30)
  cardioMode?: CardioMode; // Col AF (31)
  distance?: number; // Col AG (32)
  paceRaw?: string; // Col AH (33)
}

function splitCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizeIsoDate(raw: string): string {
  const clean = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) return clean;
  const slashParts = clean.split('/');
  if (slashParts.length === 3) {
    const m = slashParts[0].padStart(2, '0');
    const d = slashParts[1].padStart(2, '0');
    const y = slashParts[2].length === 2 ? `20${slashParts[2]}` : slashParts[2];
    return `${y}-${m}-${d}`;
  }
  const dt = new Date(clean);
  if (!Number.isNaN(dt.getTime())) {
    return dt.toISOString().slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

function normalizeWorkoutType(raw: string): WorkoutType {
  const s = (raw || '').toLowerCase();
  if (s.includes('complex')) return 'Complex';
  if (s.includes('circuit') || s.includes('hiit')) return 'Circuit/HIIT';
  if (s.includes('cardio') || s.includes('ruck') || s.includes('endurance')) return 'Cardio';
  if (s.includes('mobility')) return 'Mobility';
  if (s.includes('core')) return 'Core';
  if (s.includes('cond')) return 'Conditioning';
  return 'Strength';
}

export function parseLegacyGoogleSheetCsv(csvText: string): ParsedLegacyRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const rows: ParsedLegacyRow[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const cols = splitCsvLine(lines[idx]);
    const colA = cols[0] || '';
    const colB = cols[1] || '';
    const colC = cols[2] || '';
    const colD = cols[3] || '';
    const colE = cols[4] || '';

    // Skip header row or "Total" summary rows
    if (
      idx === 0 &&
      (colA.toLowerCase().includes('id') || colB.toLowerCase().includes('date')) &&
      !colA.startsWith('ID-')
    ) {
      continue;
    }
    if (!colC || !colE) continue;
    if (colE.toLowerCase() === 'total' || colE.toLowerCase().startsWith('total ')) {
      continue;
    }

    const setReps: number[] = [];
    for (let sCol = 12; sCol <= 21; sCol++) {
      const val = parseInt(cols[sCol] || '', 10);
      if (!Number.isNaN(val) && val > 0) {
        setReps.push(val);
      }
    }

    const avgHrVal = parseInt(cols[25] || '', 10);
    const distVal = parseFloat((cols[32] || '').replace(/[^0-9.]/g, ''));
    const rawCardioMode = (cols[31] || '').trim();

    rows.push({
      legacyId: colA || `ID-IMP-${idx}`,
      date: normalizeIsoDate(colB),
      workoutName: colC,
      workoutType: normalizeWorkoutType(colD),
      exerciseName: colE,
      category: cols[7] || 'General',
      target: cols[8] || '',
      setReps,
      avgHr: !Number.isNaN(avgHrVal) && avgHrVal > 0 ? avgHrVal : undefined,
      printedWeight: cols[26] || 'BW',
      notes: cols[30] || '',
      cardioMode: rawCardioMode ? (rawCardioMode as CardioMode) : undefined,
      distance: !Number.isNaN(distVal) && distVal > 0 ? distVal : undefined,
      paceRaw: cols[33] || undefined,
    });
  }

  return rows;
}

export function generateSampleLegacyCsv(): string {
  // Creates a realistic 34-column CSV matching Col A .. Col AH
  const makeRow = (fields: Record<number, string>): string => {
    const arr = Array.from({ length: 34 }, (_, i) => fields[i] || '');
    return arr.map((v) => (v.includes(',') ? `"${v}"` : v)).join(',');
  };

  const header = makeRow({
    0: 'Log ID',
    1: 'Date',
    2: 'Workout Name',
    3: 'Type',
    4: 'Exercise Name',
    7: 'Category',
    8: 'Target',
    12: 'Set 1',
    13: 'Set 2',
    14: 'Set 3',
    15: 'Set 4',
    16: 'Set 5',
    25: 'Avg HR',
    26: 'Printed Weight',
    30: 'Notes',
    31: 'Cardio Mode',
    32: 'Distance',
    33: 'Pace',
  });

  const r1 = makeRow({
    0: 'ID-0070',
    1: '2026-11-05',
    2: 'ABC - Double KB (Old Name)',
    3: 'Complex',
    4: 'KB Double Clean',
    7: 'Complex',
    8: '5x6',
    12: '6',
    13: '6',
    14: '6',
    15: '6',
    16: '6',
    26: '2x 16kg',
    30: 'Imported from Google Sheet tab',
  });

  const r2 = makeRow({
    0: 'ID-0070',
    1: '2026-11-05',
    2: 'ABC - Double KB (Old Name)',
    3: 'Complex',
    4: 'KB Clean & Press',
    7: 'Complex',
    8: '5x3',
    12: '3',
    13: '3',
    14: '3',
    15: '3',
    16: '3',
    26: '2x 16kg',
    30: 'Strong overhead lockout',
  });

  const rTotalIgnored = makeRow({
    0: 'ID-0070',
    1: '2026-11-05',
    2: 'ABC - Double KB (Old Name)',
    3: 'Complex',
    4: 'Total',
    26: '1440kg',
  });

  const r3 = makeRow({
    0: 'ID-0071',
    1: '2026-11-07',
    2: 'CIP - High Efficiency Ruck',
    3: 'Cardio',
    4: 'High-Efficiency Ruck',
    7: 'Cardio',
    8: '4.0 mi',
    25: '139',
    26: '20kg Ruck',
    30: 'Steady trail loop',
    31: 'Ruck',
    32: '4.0',
    33: '14:45',
  });

  return [header, r1, r2, rTotalIgnored, r3].join('\n');
}

export function buildLogsFromReconciledRows(
  rows: ParsedLegacyRow[],
  workoutNameToPresetUuid: Record<string, string>,
  exerciseNameToExerciseUuid: Record<string, string>,
  existingPresets: WorkoutPreset[],
  existingExercises: GlobalExercise[]
): {
  newExercises: GlobalExercise[];
  newPresets: WorkoutPreset[];
  newLogs: WorkoutLog[];
} {
  const now = new Date().toISOString();
  const newExercises: GlobalExercise[] = [];
  const newPresets: WorkoutPreset[] = [];

  // Group rows by legacyId + date + workoutName
  const grouped = new Map<string, ParsedLegacyRow[]>();
  for (const r of rows) {
    const key = `${r.legacyId}__${r.date}__${r.workoutName}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(r);
  }

  // Group sessions on the same date to share a sessionGroupUuid
  const dateSessionGroups = new Map<string, string>();

  const newLogs: WorkoutLog[] = [];

  for (const [, groupRows] of grouped.entries()) {
    const first = groupRows[0];
    const targetPresetUuid =
      workoutNameToPresetUuid[first.workoutName] || `pre-${uuidv4()}`;

    if (!dateSessionGroups.has(first.date)) {
      dateSessionGroups.set(first.date, `ses-${uuidv4()}`);
    }
    const sessionGroupUuid = dateSessionGroups.get(first.date)!;

    const loggedExercises: LoggedExercise[] = groupRows.map((row) => {
      const exUuid =
        exerciseNameToExerciseUuid[row.exerciseName] || `ex-${uuidv4()}`;
      const matchedGlobal =
        existingExercises.find((e) => e.exerciseUuid === exUuid) ||
        newExercises.find((e) => e.exerciseUuid === exUuid);

      const { loadType, weight } = parsePrintedWeight(row.printedWeight);
      const isCardio =
        Boolean(row.cardioMode) ||
        Boolean(row.distance && row.distance > 0) ||
        row.category.toLowerCase() === 'cardio';
      const trackingType: TrackingType = isCardio ? 'cardio' : 'strength';

      if (!matchedGlobal) {
        newExercises.push({
          exerciseUuid: exUuid,
          slug: slugify(row.exerciseName, 'ex'),
          exerciseName: row.exerciseName,
          category: row.category || 'General',
          trackingType,
          defaultLoadType: isCardio ? 'ruck_kg' : loadType,
          defaultWeight: weight,
          cardioMode: row.cardioMode || null,
          createdAt: now,
          updatedAt: now,
        });
      }

      const sets: SetEntry[] = row.setReps.map((reps, i) => ({
        setNumber: i + 1,
        reps,
      }));

      const paceSec = row.paceRaw ? parseMmSsToSeconds(row.paceRaw) : undefined;
      const durationSec =
        isCardio && row.distance && paceSec ? Math.round(row.distance * paceSec) : undefined;

      return recalculateLoggedExercise({
        exerciseUuid: exUuid,
        exerciseName: matchedGlobal?.exerciseName || row.exerciseName,
        category: row.category || 'General',
        trackingType,
        loadType: isCardio && weight > 0 ? 'ruck_kg' : loadType,
        weight,
        sets,
        totalSets: sets.length,
        totalReps: 0,
        totalLoadKg: 0,
        mode: row.cardioMode || (isCardio ? 'Ruck' : undefined),
        distance: row.distance,
        distanceUnit: 'mi',
        durationSec,
        ruckLoadKg: isCardio && weight > 0 ? weight : undefined,
        avgHr: row.avgHr,
        exerciseNotes: row.notes,
      });
    });

    // Ensure Preset exists if mapped to a newly generated presetUuid
    const presetExists =
      existingPresets.find((p) => p.presetUuid === targetPresetUuid) ||
      newPresets.find((p) => p.presetUuid === targetPresetUuid);

    if (!presetExists) {
      newPresets.push({
        presetUuid: targetPresetUuid,
        slug: slugify(first.workoutName, 'wkt'),
        legacyWorkoutId: first.legacyId || undefined,
        title: first.workoutName,
        workoutType: first.workoutType,
        programIds: [],
        tags: ['Imported'],
        exercises: loggedExercises.map((lex) => ({
          exerciseUuid: lex.exerciseUuid,
          exerciseName: lex.exerciseName,
          category: lex.category,
          trackingType: lex.trackingType,
          loadType: lex.loadType,
          defaultWeight: lex.weight,
          defaultSets: Math.max(1, lex.sets.length),
          defaultReps: lex.sets[0]?.reps ? String(lex.sets[0].reps) : '10',
          cardioMode: lex.mode,
          defaultDistanceUnit: 'mi',
        })),
        createdAt: now,
        updatedAt: now,
      });
    }

    const totalVolume = loggedExercises.reduce(
      (sum, e) => sum + (Number(e.totalLoadKg) || 0),
      0
    );

    newLogs.push({
      logUuid: `log-${uuidv4()}`,
      displayId: first.legacyId.startsWith('ID-') ? first.legacyId : `ID-${first.legacyId}`,
      legacyId: first.legacyId,
      sessionGroupUuid,
      chainOrderIndex: 0,
      date: first.date,
      presetUuid: targetPresetUuid,
      workoutTitleSnapshot: presetExists?.title || first.workoutName,
      workoutType: presetExists?.workoutType || first.workoutType,
      status: 'completed',
      sessionNotes: groupRows.map((r) => r.notes).filter(Boolean).join(' | '),
      totalSessionVolumeKg: Math.round(totalVolume * 10) / 10,
      exerciseUuids: loggedExercises.map((e) => e.exerciseUuid),
      exercises: loggedExercises,
      createdAt: `${first.date}T12:00:00.000Z`,
      updatedAt: now,
    });
  }

  return { newExercises, newPresets, newLogs };
}

/**
 * Generates a sample Preset Workouts Google Sheet CSV with Legacy WorkoutID support.
 * Format: WorkoutID, Workout Name, Workout Type, Exercise Name, Category, Sets, Reps, Default Weight, Notes, Tags
 */
export function generateSamplePresetSheetCsv(): string {
  return [
    'WorkoutID,Workout Name,Workout Type,Exercise Name,Category,Sets,Reps,Default Weight,Notes,Tags',
    'ID-0037,KB Armor & Carry,Complex,KB Double Clean,Complex,5,6,2x 16kg,Tight rack position,"Kettlebell, Double KB"',
    'ID-0037,KB Armor & Carry,Complex,KB Clean & Press,Complex,5,3,2x 16kg,Strict lockout,"Kettlebell, Double KB"',
    'ID-0037,KB Armor & Carry,Complex,KB Suitcase Carry,Anti-Rotation,3,40,24kg,40 paces per arm,"Kettlebell, Carries"',
    'ID-0038,Trail Ruck & Swings,Cardio,High-Efficiency Ruck,Cardio,1,1,20kg Ruck,Sub-15:00/mi target,"Ruck, Outdoor"',
    'ID-0038,Trail Ruck & Swings,Cardio,KB Swing,Hinge / Conditioning,4,20,24kg,Explosive hip snap,"Ruck, Kettlebell"',
  ].join('\n');
}

/**
 * Parses a Google Sheet Preset Workouts CSV into WorkoutPreset objects.
 * Supports:
 * 1. 10-column Preset Sheet with leading WorkoutID (`ID-0037`):
 *    Col A = WorkoutID, Col B = Workout Name, Col C = Workout Type, Col D = Exercise Name, Col E = Category,
 *    Col F = Sets, Col G = Reps, Col H = Weight, Col I = Notes, Col J = Tags
 * 2. 9-column Preset Sheet (without WorkoutID):
 *    Col A = Workout Name, Col B = Workout Type, Col C = Exercise Name, ...
 * 3. 34-column Log Sheet (Col A = ID-xxxx, Col B = Date) — extracts unique Presets and preserves WorkoutID.
 */
export function parsePresetSheetCsv(
  csvText: string,
  existingPresets: WorkoutPreset[],
  existingExercises: GlobalExercise[],
  activeProgramUuid?: string
): WorkoutPreset[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return [];

  const now = new Date().toISOString();
  const grouped = new Map<
    string,
    {
      legacyWorkoutId?: string;
      title: string;
      workoutType: WorkoutType;
      tags: Set<string>;
      exercises: Array<{
        exerciseUuid: string;
        exerciseName: string;
        category: string;
        trackingType: TrackingType;
        loadType: LoadType;
        defaultWeight: number;
        defaultSets: number;
        defaultReps: string;
        cardioMode?: CardioMode;
        defaultDistanceUnit?: 'mi' | 'km';
        baseNotes?: string;
      }>;
    }
  >();

  for (let idx = 0; idx < lines.length; idx++) {
    const cols = splitCsvLine(lines[idx]);
    if (cols.length < 3) continue;

    // Detect header row
    const c0 = (cols[0] || '').toLowerCase();
    const c1 = (cols[1] || '').toLowerCase();
    if (
      idx === 0 &&
      (c0.includes('workout') || c0.includes('log id') || c1.includes('workout') || c1.includes('type') || c1.includes('date'))
    ) {
      continue;
    }

    // Check if this is a 34-column log row (Col B is a date)
    const isLogFormat = /^\d{4}-\d{2}-\d{2}$/.test(cols[1] || '') || /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(cols[1] || '');
    // Check if this is a 10-column Preset row with leading WorkoutID (e.g. ID-0037)
    const hasLeadingIdCol = !isLogFormat && /^ID-\d+/i.test(cols[0] || '');

    const legacyWorkoutId = (isLogFormat || hasLeadingIdCol) ? (cols[0] || '').trim() : undefined;
    const offset = hasLeadingIdCol ? 1 : 0;

    const workoutName = isLogFormat ? cols[2] || '' : cols[offset] || '';
    const rawType = isLogFormat ? cols[3] || '' : cols[offset + 1] || '';
    const exerciseName = isLogFormat ? cols[4] || '' : cols[offset + 2] || '';

    if (!workoutName || !exerciseName) continue;
    if (
      exerciseName.toLowerCase() === 'total' ||
      exerciseName.toLowerCase().startsWith('total ')
    ) {
      continue;
    }

    const category = isLogFormat ? cols[7] || 'General' : cols[offset + 3] || 'General';
    let sets = 3;
    let reps = '10';

    if (isLogFormat) {
      const targetStr = cols[8] || '';
      const targetMatch = targetStr.match(/(\d+)\s*[x×]\s*(\d+)/i);
      if (targetMatch) {
        sets = parseInt(targetMatch[1], 10) || 3;
        reps = targetMatch[2];
      }
    } else {
      sets = Math.max(1, parseInt(cols[offset + 4] || '3', 10) || 3);
      reps = cols[offset + 5] || '10';
    }

    const rawWeight = isLogFormat ? cols[26] || 'BW' : cols[offset + 6] || 'BW';
    const notes = isLogFormat ? cols[30] || '' : cols[offset + 7] || '';
    const rawTags = isLogFormat ? '' : cols[offset + 8] || '';

    const { loadType, weight } = parsePrintedWeight(rawWeight);
    const isCardio =
      category.toLowerCase().includes('cardio') ||
      loadType === 'ruck_kg' ||
      exerciseName.toLowerCase().includes('ruck');
    const trackingType: TrackingType = isCardio ? 'cardio' : 'strength';

    const matchedGlobal = existingExercises.find(
      (ge) => ge.exerciseName.toLowerCase() === exerciseName.toLowerCase()
    );

    const groupKey = legacyWorkoutId ? `${legacyWorkoutId}::${workoutName}` : workoutName;

    if (!grouped.has(groupKey)) {
      grouped.set(groupKey, {
        legacyWorkoutId,
        title: workoutName,
        workoutType: normalizeWorkoutType(rawType),
        tags: new Set<string>(),
        exercises: [],
      });
    }

    const bucket = grouped.get(groupKey)!;
    if (rawTags) {
      rawTags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean)
        .forEach((t) => bucket.tags.add(t));
    }

    if (
      !bucket.exercises.some(
        (e) => e.exerciseName.toLowerCase() === exerciseName.toLowerCase()
      )
    ) {
      bucket.exercises.push({
        exerciseUuid: matchedGlobal?.exerciseUuid || `ex-${uuidv4()}`,
        exerciseName: matchedGlobal?.exerciseName || exerciseName,
        category,
        trackingType,
        loadType: isCardio && weight > 0 ? 'ruck_kg' : loadType,
        defaultWeight: weight,
        defaultSets: sets,
        defaultReps: reps,
        cardioMode: isCardio ? 'Ruck' : undefined,
        defaultDistanceUnit: isCardio ? 'mi' : undefined,
        baseNotes: notes,
      });
    }
  }

  const results: WorkoutPreset[] = [];
  for (const [, item] of grouped.entries()) {
    const existing = existingPresets.find(
      (p) =>
        (item.legacyWorkoutId &&
          p.legacyWorkoutId?.toLowerCase() === item.legacyWorkoutId.toLowerCase()) ||
        p.title.toLowerCase() === item.title.toLowerCase()
    );
    results.push({
      presetUuid: existing?.presetUuid || `pre-${uuidv4()}`,
      slug: existing?.slug || slugify(item.title, 'wkt'),
      legacyWorkoutId: item.legacyWorkoutId || existing?.legacyWorkoutId,
      title: item.title,
      workoutType: item.workoutType,
      programIds:
        existing?.programIds || (activeProgramUuid ? [activeProgramUuid] : []),
      tags:
        item.tags.size > 0
          ? Array.from(item.tags)
          : existing?.tags || [item.workoutType],
      exercises: item.exercises,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    });
  }

  return results;
}

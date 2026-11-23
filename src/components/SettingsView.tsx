import React, { useMemo, useState } from 'react';
import {
  Cloud,
  Code2,
  Copy,
  Database,
  Download,
  FileSpreadsheet,
  LogIn,
  LogOut,
  Moon,
  RefreshCw,
  CheckCircle2,
  Sparkles,
  Sun,
  Monitor,
  Upload,
  BookOpen,
  ClipboardPaste,
} from 'lucide-react';
import { ImportAiNotesPatchModal } from './ImportAiNotesPatchModal';
import { buildAiCoachExportPayload } from '../utils/aiCoachPatch';
import {
  GOOGLE_TASKS_TARGET_LIST_ID,
  getCachedGoogleTasksToken,
} from '../lib/googleTasks';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { AIImportPayload, DistanceUnit, ThemeMode, WorkoutPreset } from '../types/workout';
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

export const SettingsView: React.FC = () => {
  const {
    presets,
    programs,
    schedules,
    exercises: globalExercises,
    logs,
    meta,
    logDensityMode,
    setLogDensityMode,
    authUser,
    syncStatus,
    lastSyncError,
    setTheme,
    setDefaultDistanceUnit,
    setDefaultAutoStartRestTimer,
    setKeepScreenAwake,
    setTimerSoundEnabled,
    upsertPreset,
    applyAiImportPayload,
    commitReconciledLegacyImport,
    syncWithFirestore,
    pushLocalToCloud,
    resetToDemoSeed,
    setActiveTab,
    lastTasksSync,
    runGoogleTasksSync,
  } = useWorkoutStore();

  const [isSyncingTasks, setIsSyncingTasks] = useState(false);

  const [activeSection, setActiveSection] = useState<
    'sheet_import' | 'ai_drawer' | 'cloud_prefs'
  >('sheet_import');

  // Sub-mode inside Google Sheet Importer: 'presets' vs 'logs'
  const [sheetImportMode, setSheetImportMode] = useState<'presets' | 'logs'>('presets');
  const [aiNotesModalOpen, setAiNotesModalOpen] = useState(false);

  const [notice, setNotice] = useState<string | null>(null);
  const showNotice = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3200);
  };

  // =========================================================================
  // 1A. GOOGLE SHEET PRESET WORKOUTS IMPORTER STATE
  // =========================================================================
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

  // =========================================================================
  // 1B. GOOGLE SHEET HISTORICAL LOGS IMPORTER STATE
  // =========================================================================
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
  // 2. AI CODE BLOCK IMPORT / EXPORT DRAWER STATE
  // =========================================================================
  const [aiJsonText, setAiJsonText] = useState<string>('');
  const [aiConflictMode, setAiConflictMode] = useState<'add' | 'update' | 'replace'>('update');
  const [aiParseError, setAiParseError] = useState<string | null>(null);

  const parsedAiPreview = useMemo((): AIImportPayload | null => {
    if (!aiJsonText.trim()) return null;
    try {
      const cleaned = aiJsonText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
      const obj = JSON.parse(cleaned);
      setAiParseError(null);
      return obj as AIImportPayload;
    } catch (e: any) {
      setAiParseError(e?.message || 'Invalid JSON syntax');
      return null;
    }
  }, [aiJsonText]);

  const handleCopyAiSchemaAndIds = () => {
    const schemaDirectory = {
      _instructions:
        'Generate a JSON code block matching the AIImportPayload contract below. Reference existing presetUuid/slug and programUuid values whenever scheduling or updating existing workouts.',
      contract: {
        mode: 'update | add | replace',
        presets: [
          {
            presetUuid: 'optional-existing-uuid',
            slug: 'wkt_example_slug',
            title: 'Example Workout Title',
            workoutType:
              'Strength | Conditioning | Complex | Circuit/HIIT | Cardio | Mobility | Core',
            programIds: ['prog-hybrid-kb-ruck'],
            tags: ['Kettlebell', 'Double KB'],
            defaultTimer: { mode: 'circuit', rounds: 15, workSec: 60, restSec: 0 },
            exercises: [
              {
                exerciseUuid: 'ex-kb-clean-and-press',
                exerciseName: 'KB Clean & Press',
                category: 'Complex',
                trackingType: 'strength | circuit | cardio',
                loadType: 'single_kg | double_kg | bodyweight | bw_plus_kg | ruck_kg | none',
                defaultWeight: 16,
                defaultSets: 5,
                defaultReps: '5',
                defaultDistanceUnit: 'mi | km',
                baseNotes: 'Optional coaching cue',
              },
            ],
          },
        ],
        schedule: [
          {
            date: getTodayIsoDate(),
            items: [
              {
                slotRole: 'Primary',
                presetUuid: 'pre-abc-double',
                presetSlug: 'wkt_abc_double',
                programUuid: 'prog-hybrid-kb-ruck',
                coachNotes: 'Target 16 rounds EMOM @ 2x16kg',
              },
            ],
          },
        ],
      },
      currentDirectory: {
        activeProgramUuid: meta.activeProgramUuid,
        programs: programs.map((p) => ({
          programUuid: p.programUuid,
          slug: p.slug,
          title: p.title,
        })),
        presets: presets.map((p) => ({
          presetUuid: p.presetUuid,
          slug: p.slug,
          title: p.title,
          workoutType: p.workoutType,
        })),
        exercises: globalExercises.map((e) => ({
          exerciseUuid: e.exerciseUuid,
          slug: e.slug,
          exerciseName: e.exerciseName,
          trackingType: e.trackingType,
          defaultLoadType: e.defaultLoadType,
        })),
      },
    };

    navigator.clipboard?.writeText(JSON.stringify(schemaDirectory, null, 2));
    showNotice('Copied AI Schema & Workout Directory to clipboard!');
  };

  const handleLoadSampleAiBlock = () => {
    const sample: AIImportPayload = {
      mode: 'update',
      presets: [
        {
          slug: 'wkt_dan_john_humane_burpee',
          title: 'Humane Burpee Conditioning',
          workoutType: 'Conditioning',
          programIds: ['prog-hybrid-kb-ruck'],
          tags: ['Kettlebell', 'Conditioning'],
          defaultTimer: { mode: 'rest', restSec: 45 },
          exercises: [
            {
              exerciseUuid: 'ex-kb-swing',
              exerciseName: 'KB Swing',
              category: 'Hinge / Conditioning',
              trackingType: 'strength',
              loadType: 'single_kg',
              defaultWeight: 24,
              defaultSets: 5,
              defaultReps: '15',
              baseNotes: '15 swings every round; ladder down goblet squats & pushups 5-4-3-2-1',
            },
          ],
        },
      ],
      schedule: [
        {
          date: shiftIsoDate(getTodayIsoDate(), 2),
          items: [
            {
              slotRole: 'Primary',
              presetSlug: 'wkt_dan_john_humane_burpee',
              coachNotes: 'AI Scheduled: 5 ladders @ 24kg bell, nasal recovery breathing',
            },
            {
              slotRole: 'Core',
              presetUuid: 'pre-core-finisher',
              coachNotes: 'Chained finisher: 3x40 paces Suitcase Carry',
            },
          ],
        },
      ],
    };
    setAiJsonText(JSON.stringify(sample, null, 2));
  };

  // =========================================================================
  // 3. FIREBASE RUNTIME CONFIG & AUTH STATE
  // =========================================================================
  const [firebaseJsonInput, setFirebaseJsonInput] = useState<string>('');
  const effectiveFbConfig = getEffectiveFirebaseConfig();

  return (
    <div className="space-y-4 pb-24">
      {notice && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-slate-900 dark:bg-orange-500 text-white text-xs font-bold shadow-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-orange-400 dark:text-white" />
          {notice}
        </div>
      )}

      {/* Sub-navigation Pills */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-3 border border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {[
            {
              id: 'sheet_import',
              label: 'Google Sheet Importer',
              tooltip: 'Import Preset Workouts or Past Logs from Google Sheets',
              icon: FileSpreadsheet,
            },
            {
              id: 'ai_drawer',
              label: 'AI Assistant Import',
              tooltip: 'Paste JSON from Gemini to add workouts & schedule dates',
              icon: Code2,
            },
            {
              id: 'cloud_prefs',
              label: 'Cloud Sync & Preferences',
              tooltip: 'Google Sign-In, theme & app preferences',
              icon: Cloud,
            },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeSection === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                data-tooltip={tab.tooltip}
                title={tab.tooltip}
                onClick={() => setActiveSection(tab.id as any)}
                className={`px-3.5 py-2 rounded-2xl text-xs font-bold inline-flex items-center gap-1.5 transition-all ${
                  active
                    ? 'bg-orange-500 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          data-tooltip="Go to the Workout Library tab"
          title="Go to the Workout Library tab"
          onClick={() => setActiveTab('library')}
          className="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-orange-600 dark:text-orange-400 inline-flex items-center gap-1.5 hover:bg-orange-500 hover:text-white transition-colors"
        >
          <BookOpen className="w-3.5 h-3.5" />
          Open Workout Library
        </button>
      </div>

      {/* =====================================================================
          SECTION 1: GOOGLE SHEET IMPORTER (PRESETS & HISTORICAL LOGS)
         ===================================================================== */}
      {activeSection === 'sheet_import' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 space-y-5">
          {/* Switcher between Preset Import and Historical Log Import */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div className="inline-flex rounded-2xl bg-slate-100 dark:bg-slate-800 p-1">
              <button
                type="button"
                onClick={() => setSheetImportMode('presets')}
                data-tooltip="Import Workout Templates / Presets from a Google Sheet CSV"
                title="Import Workout Templates / Presets from a Google Sheet CSV"
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  sheetImportMode === 'presets'
                    ? 'bg-orange-500 text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                1. Import Preset Workouts
              </button>
              <button
                type="button"
                onClick={() => setSheetImportMode('logs')}
                data-tooltip="Import Past Completed Workout Logs from a Google Sheet CSV"
                title="Import Past Completed Workout Logs from a Google Sheet CSV"
                className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                  sheetImportMode === 'logs'
                    ? 'bg-orange-500 text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                2. Import Past Workout Logs
              </button>
            </div>

            {sheetImportMode === 'presets' ? (
              <button
                type="button"
                data-tooltip="Fill with sample Preset Workouts CSV to test"
                title="Fill with sample Preset Workouts CSV to test"
                onClick={() => {
                  const sample = generateSamplePresetSheetCsv();
                  setPresetSheetCsv(sample);
                  handleParsePresetSheet(sample);
                }}
                className="px-3.5 py-2 rounded-2xl bg-orange-500/10 text-orange-600 dark:text-orange-400 text-xs font-bold hover:bg-orange-500 hover:text-white transition-colors"
              >
                Load Sample Preset CSV
              </button>
            ) : (
              <button
                type="button"
                data-tooltip="Fill with sample Historical Log CSV to test"
                title="Fill with sample Historical Log CSV to test"
                onClick={() => {
                  const sample = generateSampleLegacyCsv();
                  setCsvInputText(sample);
                  handleParseCsv(sample);
                }}
                className="px-3.5 py-2 rounded-2xl bg-orange-500/10 text-orange-600 dark:text-orange-400 text-xs font-bold hover:bg-orange-500 hover:text-white transition-colors"
              >
                Load Sample Log CSV
              </button>
            )}
          </div>

          {/* SUB-MODE A: IMPORT PRESET WORKOUTS FROM GOOGLE SHEET */}
          {sheetImportMode === 'presets' ? (
            <div className="space-y-4">
              <div>
                <h3 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                  Import Preset Workouts from Google Sheet (CSV)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Paste rows from your Google Sheet Preset tab (`WorkoutID, Workout Name, Workout
                  Type, Exercise Name, Category, Sets, Reps, Default Weight, Notes, Tags` — or
                  without `WorkoutID`) to automatically preserve legacy IDs like `ID-0037` for
                  historical log matching.
                </p>
              </div>

              <textarea
                rows={6}
                value={presetSheetCsv}
                onChange={(e) => {
                  setPresetSheetCsv(e.target.value);
                  handleParsePresetSheet(e.target.value);
                }}
                placeholder="WorkoutID, Workout Name, Workout Type, Exercise Name, Category, Sets, Reps, Default Weight, Notes, Tags..."
                className="w-full p-3.5 rounded-2xl font-mono text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-orange-500"
              />

              {parsedSheetPresets.length > 0 && (
                <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-orange-500">
                      Preview: {parsedSheetPresets.length} Workout Preset(s) Ready to Import
                    </span>
                    <button
                      type="button"
                      onClick={handleCommitPresetSheetImport}
                      className="px-5 py-2 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-md"
                    >
                      <Upload className="w-4 h-4" />
                      Save {parsedSheetPresets.length} Preset(s) to Library
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {parsedSheetPresets.map((pre, idx) => (
                      <div
                        key={idx}
                        className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-1.5">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {pre.legacyWorkoutId && (
                              <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200 shrink-0">
                                {pre.legacyWorkoutId}
                              </span>
                            )}
                            <span className="font-display font-bold text-sm truncate">
                              {pre.title}
                            </span>
                          </div>
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-orange-500/15 text-orange-600 dark:text-orange-400 shrink-0">
                            {pre.workoutType}
                          </span>
                        </div>
                        <div className="space-y-1">
                          {pre.exercises.map((ex, i) => (
                            <div
                              key={i}
                              className="text-xs flex items-center justify-between text-slate-600 dark:text-slate-300"
                            >
                              <span>
                                {i + 1}. {ex.exerciseName}
                              </span>
                              <span className="font-mono text-[11px]">
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
            /* SUB-MODE B: IMPORT HISTORICAL LOGS FROM GOOGLE SHEET */
            <div className="space-y-4">
              <div>
                <h3 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                  Import Past Workout Logs from Google Sheet (CSV)
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Paste your exported Google Sheet log rows. Summary `"Total"` rows are
                  automatically ignored, and you can match renamed workouts to your current
                  Library before saving.
                </p>
              </div>

              <textarea
                rows={6}
                value={csvInputText}
                onChange={(e) => {
                  setCsvInputText(e.target.value);
                  handleParseCsv(e.target.value);
                }}
                placeholder="Paste exported Google Sheet log CSV rows here..."
                className="w-full p-3.5 rounded-2xl font-mono text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-orange-500"
              />

              {parsedLegacyRows.length > 0 && (
                <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <h4 className="font-display font-bold text-sm text-slate-900 dark:text-slate-100">
                      Match Workouts & Exercises ({parsedLegacyRows.length} rows parsed)
                    </h4>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Workout Name Matching */}
                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-2.5">
                      <div className="text-xs font-bold uppercase tracking-wider text-orange-500">
                        1. Match Sheet Workout Names
                      </div>
                      {Object.keys(workoutNameMap).map((wName) => {
                        const rowIds = Array.from(
                          new Set(
                            parsedLegacyRows
                              .filter((r) => r.workoutName === wName)
                              .map((r) => r.legacyId)
                          )
                        );
                        return (
                          <div key={wName} className="space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
                              <span>"{wName}"</span>
                              {rowIds.map((rid) => (
                                <span
                                  key={rid}
                                  className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                                >
                                  {rid}
                                </span>
                              ))}
                            </div>
                            <select
                              value={workoutNameMap[wName]}
                              onChange={(e) =>
                                setWorkoutNameMap({ ...workoutNameMap, [wName]: e.target.value })
                              }
                              className="w-full px-2.5 py-1.5 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                            >
                              <option value={workoutNameMap[wName]}>
                                {presets.some((p) => p.presetUuid === workoutNameMap[wName])
                                  ? `Link to Library: ${
                                      presets.find((p) => p.presetUuid === workoutNameMap[wName])
                                        ?.title
                                    }`
                                  : `Create New Workout in Library ("${wName}")`}
                              </option>
                              {presets.map((p) => (
                                <option key={p.presetUuid} value={p.presetUuid}>
                                  Link to: {p.title}
                                  {p.legacyWorkoutId ? ` (${p.legacyWorkoutId})` : ''}
                                </option>
                              ))}
                            </select>
                          </div>
                        );
                      })}
                    </div>

                    {/* Exercise Name Matching */}
                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-2.5">
                      <div className="text-xs font-bold uppercase tracking-wider text-orange-500">
                        2. Match Sheet Exercise Names
                      </div>
                      {Object.keys(exerciseNameMap).map((eName) => (
                        <div key={eName} className="space-y-1">
                          <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                            "{eName}"
                          </div>
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

      {/* =====================================================================
          SECTION 2: AI ASSISTANT IMPORT / EXPORT DRAWER
         ===================================================================== */}
      {activeSection === 'ai_drawer' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-display font-bold text-base sm:text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-orange-500" />
                AI Assistant Workout & Schedule Import
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 max-w-2xl">
                Copy your workout directory for Gemini, then paste the AI's JSON block below to
                add or update workouts, programs, and calendar dates in one click.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                data-tooltip="Copy your workout list & JSON format for Gemini"
                title="Copy your workout list & JSON format for Gemini"
                onClick={handleCopyAiSchemaAndIds}
                className="px-3.5 py-2 rounded-2xl bg-slate-900 dark:bg-orange-500 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm"
              >
                <Copy className="w-4 h-4" />
                Copy AI Prompt & Workout IDs
              </button>
              <button
                type="button"
                data-tooltip="Load a sample AI response to preview how import works"
                title="Load a sample AI response to preview how import works"
                onClick={handleLoadSampleAiBlock}
                className="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold hover:text-orange-500"
              >
                Load Sample AI JSON
              </button>
              <button
                type="button"
                onClick={async () => {
                  const activeProg =
                    programs.find((p) => p.programUuid === meta.activeProgramUuid) ||
                    programs[0] ||
                    null;
                  const payload = buildAiCoachExportPayload({
                    program: activeProg,
                    presets,
                    schedules,
                  });
                  try {
                    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                    showNotice('Copied AI Coaching Context');
                  } catch {
                    showNotice('Clipboard write blocked by browser.');
                  }
                }}
                className="px-3 py-2 rounded-2xl bg-orange-500/15 text-orange-600 dark:text-orange-400 text-xs font-bold inline-flex items-center gap-1.5 hover:bg-orange-500/20"
              >
                <Sparkles className="w-3.5 h-3.5" />
                Export for AI Coach
              </button>
              <button
                type="button"
                onClick={() => setAiNotesModalOpen(true)}
                className="px-3 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold hover:text-orange-500 inline-flex items-center gap-1.5"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                Import AI Notes Patch
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Import Mode:</span>
            {(['add', 'update', 'replace'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setAiConflictMode(m)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize ${
                  aiConflictMode === m
                    ? 'bg-orange-500 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                }`}
              >
                {m}
              </button>
            ))}
          </div>

          <textarea
            rows={10}
            value={aiJsonText}
            onChange={(e) => setAiJsonText(e.target.value)}
            placeholder='Paste Gemini JSON block here...'
            className="w-full p-4 rounded-2xl font-mono text-xs bg-slate-950 text-emerald-400 border border-slate-800 focus:outline-none focus:border-orange-500"
          />

          {aiParseError && (
            <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400">
              JSON Error: {aiParseError}
            </div>
          )}

          {parsedAiPreview && (
            <div className="p-4 rounded-2xl bg-orange-500/[0.06] border border-orange-500/30 space-y-2">
              <div className="text-xs font-bold text-orange-600 dark:text-orange-400 uppercase tracking-wider">
                Preview Changes
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <strong>{parsedAiPreview.presets?.length || 0}</strong> Workout Preset(s)
                </div>
                <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <strong>{parsedAiPreview.programs?.length || 0}</strong> Program(s)
                </div>
                <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                  <strong>{parsedAiPreview.schedule?.length || 0}</strong> Calendar Date(s)
                </div>
              </div>
              <div className="flex justify-end pt-2">
                <button
                  type="button"
                  onClick={() => {
                    const res = applyAiImportPayload({
                      ...parsedAiPreview,
                      mode: aiConflictMode,
                    });
                    setAiJsonText('');
                    showNotice(
                      `Applied ${res.presetsCount} presets, ${res.programsCount} programs, and ${res.scheduleDaysCount} calendar dates!`
                    );
                  }}
                  className="px-5 py-2.5 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-md"
                >
                  <Upload className="w-4 h-4" />
                  Apply AI Changes
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =====================================================================
          SECTION 3: CLOUD SYNC & APP PREFERENCES
         ===================================================================== */}
      {activeSection === 'cloud_prefs' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cloud className="w-5 h-5 text-orange-500" />
                <h3 className="font-display font-bold text-base">
                  Google Sign-In & Cloud Sync
                </h3>
              </div>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                  syncStatus === 'synced'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : syncStatus === 'syncing'
                    ? 'bg-orange-500/15 text-orange-500'
                    : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                }`}
              >
                {syncStatus === 'local' ? 'Saved on Device' : syncStatus}
              </span>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sign in with Google to sync your workouts, schedule, and logs across your phone and
              laptop, with full offline gym support.
            </p>

            {authUser ? (
              <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold">{authUser.displayName || 'Signed In'}</div>
                    <div className="text-[11px] text-slate-500">{authUser.email}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => signOutFirebase()}
                    className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-xs font-semibold inline-flex items-center gap-1"
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
                    } catch (e: any) {
                      showNotice(e?.message || 'Configure Firebase project below first');
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
                    rows={4}
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

          {/* App Preferences & Backup */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 space-y-4">
            <h3 className="font-display font-bold text-base">Preferences & Data Backup</h3>

            {/* Theme Mode */}
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-500">
                Appearance
              </label>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    { id: 'light', label: 'Light Sand', icon: Sun },
                    { id: 'dark', label: 'Dark Charcoal', icon: Moon },
                    { id: 'system', label: 'System', icon: Monitor },
                  ] as Array<{ id: ThemeMode; label: string; icon: any }>
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
                      <Icon className="w-4 h-4" />
                      {t.label}
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

            {/* Default View Density */}
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

            {/* Keep Screen Awake Toggle */}
            <label className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
              <div>
                <div className="text-xs font-bold">Keep Screen Awake</div>
                <div className="text-[11px] text-slate-500">
                  Prevent display sleep while logging workouts
                </div>
              </div>
              <input
                type="checkbox"
                checked={meta.keepScreenAwake !== false}
                onChange={(e) => setKeepScreenAwake(e.target.checked)}
                className="rounded accent-orange-500 w-4 h-4"
              />
            </label>

            {/* Timer Countdown Beeps Toggle */}
            <label className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
              <div>
                <div className="text-xs font-bold">Timer Countdown Beeps</div>
                <div className="text-[11px] text-slate-500">
                  Play 3-2-1 countdown &amp; completion chimes
                </div>
              </div>
              <input
                type="checkbox"
                checked={meta.timerSoundEnabled !== false}
                onChange={(e) => setTimerSoundEnabled(e.target.checked)}
                className="rounded accent-orange-500 w-4 h-4"
              />
            </label>

            {/* Auto-Start Rest Timer Toggle */}
            <label className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 cursor-pointer">
              <div>
                <div className="text-xs font-bold">Auto-Start Rest Timer</div>
                <div className="text-[11px] text-slate-500">
                  Start rest countdown automatically when logging a set
                </div>
              </div>
              <input
                type="checkbox"
                checked={meta.defaultAutoStartRestTimer}
                onChange={(e) => setDefaultAutoStartRestTimer(e.target.checked)}
                className="rounded text-orange-500 focus:ring-orange-500 w-4 h-4"
              />
            </label>

            {/* Full JSON Backup Export & Demo Reset */}
            <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap gap-2">
              <button
                type="button"
                data-tooltip="Download all workouts, schedules, and logs as a JSON backup file"
                title="Download all workouts, schedules, and logs as a JSON backup file"
                onClick={() => {
                  const backup = {
                    exportedAt: new Date().toISOString(),
                    meta,
                    exercises: globalExercises,
                    presets,
                    programs,
                    logs,
                  };
                  const blob = new Blob([JSON.stringify(backup, null, 2)], {
                    type: 'application/json',
                  });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `ironpulse-backup-${getTodayIsoDate()}.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="px-3.5 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Download className="w-4 h-4 text-orange-500" />
                Export Backup
              </button>

              <button
                type="button"
                data-tooltip="Load sample demo workouts & sample history"
                title="Load sample demo workouts & sample history"
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
                    showNotice(`Google Tasks sync failed: ${res.error}`);
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
      )}

      <div className="pt-2 pb-4 text-center text-[11px] font-mono text-[var(--text-muted)]">
        Build: {__APP_BUILD__} ({__APP_BUILD_TIME__})
      </div>

      <ImportAiNotesPatchModal
        open={aiNotesModalOpen}
        onClose={() => setAiNotesModalOpen(false)}
        onApplied={(summary) => showNotice(summary)}
      />
    </div>
  );
};

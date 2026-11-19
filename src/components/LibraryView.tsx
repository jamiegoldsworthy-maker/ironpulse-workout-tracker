import React, { useMemo, useState } from 'react';
import {
  Search,
  Plus,
  Edit3,
  Copy,
  Trash2,
  Play,
  Timer,
  Dumbbell,
  Tag,
  CheckCircle2,
  X,
  ArrowUp,
  ArrowDown,
  Flame,
} from 'lucide-react';
import { useWorkoutStore } from '../store/useWorkoutStore';
import {
  CardioMode,
  DistanceUnit,
  ExerciseSide,
  LoadType,
  PresetExercise,
  PresetFormatMode,
  RepSchemeType,
  TrackingType,
  WorkoutPreset,
  WorkoutType,
} from '../types/workout';
import {
  expandLadderSequence,
  formatLoadBadge,
  slugify,
  uuidv4,
} from '../utils/calculations';
import { useIsMobileView } from '../utils/useIsMobileView';

const WORKOUT_TYPES: WorkoutType[] = [
  'Strength',
  'Conditioning',
  'Complex',
  'Circuit/HIIT',
  'Cardio',
  'Mobility',
  'Core',
];

const CARDIO_MODES: CardioMode[] = ['Ruck', 'Cycle', 'Run', 'Row', 'Swim', 'Other'];

export const LibraryView: React.FC = () => {
  const {
    presets,
    programs,
    exercises: globalExercises,
    meta,
    upsertPreset,
    duplicatePreset,
    deletePreset,
    addWorkoutToSession,
    setActiveTab,
  } = useWorkoutStore();

  const isMobile = useIsMobileView();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProgramFilter, setSelectedProgramFilter] = useState<string>('ALL');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'ALL' | WorkoutType>('ALL');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('ALL');

  const [editingPreset, setEditingPreset] = useState<WorkoutPreset | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    presets.forEach((p) => p.tags?.forEach((t) => tags.add(t)));
    return ['ALL', ...Array.from(tags)];
  }, [presets]);

  const filteredPresets = useMemo(() => {
    return presets.filter((p) => {
      if (
        selectedProgramFilter !== 'ALL' &&
        !p.programIds?.includes(selectedProgramFilter)
      ) {
        return false;
      }
      if (selectedTypeFilter !== 'ALL' && p.workoutType !== selectedTypeFilter) {
        return false;
      }
      if (selectedTagFilter !== 'ALL' && !p.tags?.includes(selectedTagFilter)) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = p.title.toLowerCase().includes(q);
        const matchLegacyId = (p.legacyWorkoutId || '').toLowerCase().includes(q);
        const matchType = p.workoutType.toLowerCase().includes(q);
        const matchTag = p.tags?.some((t) => t.toLowerCase().includes(q));
        const matchEx = p.exercises.some((e) => e.exerciseName.toLowerCase().includes(q));
        return matchTitle || matchLegacyId || matchType || matchTag || matchEx;
      }
      return true;
    });
  }, [presets, selectedProgramFilter, selectedTypeFilter, selectedTagFilter, searchQuery]);

  const handleCreateNewPreset = () => {
    const now = new Date().toISOString();
    setEditingPreset({
      presetUuid: `pre-${uuidv4()}`,
      slug: 'wkt_custom_workout',
      title: 'New Workout',
      workoutType: 'Strength',
      programIds: meta.activeProgramUuid ? [meta.activeProgramUuid] : [],
      tags: ['Kettlebell'],
      defaultTimer: { mode: 'rest', restSec: 60 },
      exercises: [
        {
          exerciseUuid: globalExercises[0]?.exerciseUuid || `ex-${uuidv4()}`,
          exerciseName: globalExercises[0]?.exerciseName || 'KB Clean & Press',
          category: 'Strength',
          trackingType: 'strength',
          loadType: 'double_kg',
          defaultWeight: 16,
          defaultSets: 4,
          defaultReps: '8',
        },
      ],
      createdAt: now,
      updatedAt: now,
    });
  };

  const handleMoveExercise = (idx: number, dir: -1 | 1) => {
    if (!editingPreset) return;
    const target = idx + dir;
    if (target < 0 || target >= editingPreset.exercises.length) return;
    const next = [...editingPreset.exercises];
    const tmp = next[idx];
    next[idx] = next[target];
    next[target] = tmp;
    setEditingPreset({ ...editingPreset, exercises: next });
  };

  return (
    <div className="space-y-4 pb-24">
      {toast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-slate-900 dark:bg-orange-500 text-white text-xs font-bold shadow-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-orange-400 dark:text-white" />
          {toast}
        </div>
      )}

      {/* Top Search & Filter Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 space-y-3.5 shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display font-bold text-base sm:text-lg text-slate-900 dark:text-slate-100">
              Preset Workouts ({filteredPresets.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Search, filter, customize, or launch any workout directly onto the gym floor
            </p>
          </div>

          <button
            type="button"
            onClick={handleCreateNewPreset}
            data-tooltip="Create a new workout template"
            title="Create a new workout template"
            className="px-4 py-2.5 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm shadow-orange-500/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            New Workout
          </button>
        </div>

        {/* Search + Program + Workout Type Filters */}
        <div className={`grid gap-2.5 ${isMobile ? 'grid-cols-1' : 'grid-cols-3'}`}>
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search workouts, exercises, or ID..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-2xl bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-orange-500 focus:outline-none"
            />
          </div>

          <select
            value={selectedProgramFilter}
            onChange={(e) => setSelectedProgramFilter(e.target.value)}
            title="Filter by Training Program"
            className="px-3.5 py-2 text-xs font-semibold rounded-2xl bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-orange-500 focus:outline-none"
          >
            <option value="ALL">All Programs</option>
            {programs.map((prog) => (
              <option key={prog.programUuid} value={prog.programUuid}>
                {prog.title}
              </option>
            ))}
          </select>

          <select
            value={selectedTypeFilter}
            onChange={(e) => setSelectedTypeFilter(e.target.value as any)}
            title="Filter by Workout Category"
            className="px-3.5 py-2 text-xs font-semibold rounded-2xl bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-orange-500 focus:outline-none"
          >
            <option value="ALL">All Categories</option>
            {WORKOUT_TYPES.map((wt) => (
              <option key={wt} value={wt}>
                {wt}
              </option>
            ))}
          </select>
        </div>

        {/* Tag Filter Pills */}
        {allTags.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            {allTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setSelectedTagFilter(tag)}
                className={`px-3 py-1 rounded-xl text-[11px] font-semibold whitespace-nowrap transition-colors ${
                  selectedTagFilter === tag
                    ? 'bg-slate-900 dark:bg-orange-500 text-white'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {tag === 'ALL' ? 'All Tags' : `#${tag}`}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Preset Cards Grid */}
      {filteredPresets.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-10 border border-slate-200/80 dark:border-slate-800 text-center space-y-2">
          <Dumbbell className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
          <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
            No workouts match your current filters
          </p>
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setSelectedProgramFilter('ALL');
              setSelectedTypeFilter('ALL');
              setSelectedTagFilter('ALL');
            }}
            className="text-xs font-bold text-orange-500 hover:underline"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className={`grid gap-3.5 ${isMobile ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'}`}>
          {filteredPresets.map((preset) => {
            const linkedPrograms = programs.filter((pg) =>
              preset.programIds?.includes(pg.programUuid)
            );

            return (
              <div
                key={preset.presetUuid}
                className="bg-white dark:bg-slate-900 rounded-3xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 hover:border-orange-500/40 transition-all flex flex-col justify-between gap-4 shadow-2xs"
              >
                <div className="space-y-3">
                  {/* Top Badges & Action Buttons Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-orange-500/15 text-orange-600 dark:text-orange-400">
                        {preset.workoutType}
                      </span>
                      {preset.legacyWorkoutId && (
                        <span className="font-mono text-[10px] font-bold px-2 py-0.5 rounded-lg bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          {preset.legacyWorkoutId}
                        </span>
                      )}
                      {preset.defaultTimer &&
                        (preset.defaultTimer.mode === 'circuit' ||
                          (Number(preset.defaultTimer.restSec) || 0) > 0) && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            <Timer className="w-3 h-3 text-orange-500" />
                            {preset.defaultTimer.mode === 'circuit'
                              ? `${preset.defaultTimer.rounds || 10}× ${
                                  preset.defaultTimer.workSec || 60
                                }s/${preset.defaultTimer.restSec ?? 0}s`
                              : `${preset.defaultTimer.restSec}s Rest`}
                          </span>
                        )}
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        data-tooltip="Start workout on Gym Floor"
                        title="Start workout on Gym Floor"
                        onClick={() => {
                          addWorkoutToSession(preset.presetUuid);
                          setActiveTab('log');
                        }}
                        className="px-3 py-1.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-1 shadow-2xs transition-colors"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        Start
                      </button>

                      <button
                        type="button"
                        data-tooltip="Edit workout"
                        title="Edit workout"
                        onClick={() => setEditingPreset(JSON.parse(JSON.stringify(preset)))}
                        className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-orange-500 transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        data-tooltip="Duplicate workout"
                        title="Duplicate workout"
                        onClick={() => {
                          duplicatePreset(preset.presetUuid);
                          showToast(`Duplicated "${preset.title}"`);
                        }}
                        className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-orange-500 transition-colors"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>

                      <button
                        type="button"
                        data-tooltip="Delete workout"
                        title="Delete workout"
                        onClick={() => {
                          deletePreset(preset.presetUuid);
                          showToast(`Deleted "${preset.title}"`);
                        }}
                        className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-rose-500 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Full-Width Workout Title (Never Squished!) */}
                  <h3 className="font-display font-extrabold text-base sm:text-lg text-slate-900 dark:text-slate-100 leading-snug">
                    {preset.title}
                  </h3>

                  {/* Clean Exercises List */}
                  <div className="space-y-1.5">
                    {preset.exercises.map((ex, i) => (
                      <div
                        key={i}
                        className="text-xs flex flex-wrap items-center justify-between gap-2 py-2 px-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800/80"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-5 h-5 rounded-full bg-slate-200 dark:bg-slate-700 text-[10px] font-bold flex items-center justify-center shrink-0 tabular-nums">
                            {i + 1}
                          </span>
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {ex.side ? (
                              <span className="mr-1.5 px-1.5 py-0.2 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 text-[10px] font-bold">
                                {ex.side}
                              </span>
                            ) : null}
                            {ex.exerciseName}
                          </span>
                        </div>
                        <span className="font-mono text-[11px] font-semibold text-orange-600 dark:text-orange-400 tabular-nums ml-auto">
                          {ex.trackingType === 'cardio'
                            ? `${ex.cardioMode || 'Cardio'} (${ex.defaultDistanceUnit || 'mi'})`
                            : `${ex.defaultSets} × ${ex.defaultReps}${
                                ex.isPerSide ? '/side' : ''
                              } @ ${formatLoadBadge(ex.loadType, ex.defaultWeight)}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Tags & Program Pills Footer */}
                <div className="flex flex-wrap items-center justify-between gap-2 pt-2.5 border-t border-slate-100 dark:border-slate-800 text-[11px]">
                  <div className="flex flex-wrap gap-1">
                    {preset.tags?.map((t) => (
                      <span
                        key={t}
                        className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-medium"
                      >
                        #{t}
                      </span>
                    ))}
                  </div>
                  {linkedPrograms.length > 0 && (
                    <span className="text-slate-400 font-medium truncate">
                      {linkedPrograms.map((p) => p.title).join(', ')}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* PRESET EDITOR MODAL */}
      {editingPreset && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/65 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-base sm:text-lg text-slate-900 dark:text-slate-100">
                  {presets.some((p) => p.presetUuid === editingPreset.presetUuid)
                    ? 'Edit Workout Preset'
                    : 'Create Workout Preset'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Configure exercises, default weights, sets, and timer settings
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingPreset(null)}
                title="Close editor"
                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Workout Name
                  </label>
                  <input
                    type="text"
                    value={editingPreset.title}
                    placeholder="e.g. ABC - Double Kettlebell"
                    onChange={(e) =>
                      setEditingPreset({
                        ...editingPreset,
                        title: e.target.value,
                        slug: slugify(e.target.value, 'wkt'),
                      })
                    }
                    className="w-full px-3.5 py-2.5 text-sm font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Category
                  </label>
                  <select
                    value={editingPreset.workoutType}
                    onChange={(e) =>
                      setEditingPreset({
                        ...editingPreset,
                        workoutType: e.target.value as WorkoutType,
                      })
                    }
                    className="w-full px-3.5 py-2.5 text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:border-orange-500"
                  >
                    {WORKOUT_TYPES.map((wt) => (
                      <option key={wt} value={wt}>
                        {wt}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    Included in Programs
                  </label>
                  <div className="flex flex-wrap gap-2">
                    {programs.map((prog) => {
                      const checked = editingPreset.programIds?.includes(prog.programUuid);
                      return (
                        <label
                          key={prog.programUuid}
                          className={`px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-2 cursor-pointer transition-colors ${
                            checked
                              ? 'bg-orange-500/15 border-orange-500 text-orange-600 dark:text-orange-400'
                              : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const nextIds = e.target.checked
                                ? [...(editingPreset.programIds || []), prog.programUuid]
                                : (editingPreset.programIds || []).filter(
                                    (id) => id !== prog.programUuid
                                  );
                              setEditingPreset({ ...editingPreset, programIds: nextIds });
                            }}
                            className="rounded text-orange-500 focus:ring-orange-500"
                          />
                          {prog.title}
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5">
                    Tags
                  </label>
                  <div className="flex flex-wrap items-center gap-1.5 mb-2">
                    {editingPreset.tags?.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                      >
                        <Tag className="w-3 h-3 text-orange-500" />
                        {t}
                        <button
                          type="button"
                          onClick={() =>
                            setEditingPreset({
                              ...editingPreset,
                              tags: editingPreset.tags.filter((x) => x !== t),
                            })
                          }
                          className="text-slate-400 hover:text-rose-500 ml-0.5"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && tagInput.trim()) {
                          e.preventDefault();
                          if (!editingPreset.tags?.includes(tagInput.trim())) {
                            setEditingPreset({
                              ...editingPreset,
                              tags: [...(editingPreset.tags || []), tagInput.trim()],
                            });
                          }
                          setTagInput('');
                        }
                      }}
                      placeholder="Add tag..."
                      className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!tagInput.trim()) return;
                        if (!editingPreset.tags?.includes(tagInput.trim())) {
                          setEditingPreset({
                            ...editingPreset,
                            tags: [...(editingPreset.tags || []), tagInput.trim()],
                          });
                        }
                        setTagInput('');
                      }}
                      className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-xs font-bold"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>

              {/* Workout Guidance & Default Structure / Timer */}
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Workout Guidance / Progression Notes
                  </label>
                  <textarea
                    rows={2}
                    value={editingPreset.workoutNotes || ''}
                    placeholder="e.g. Perform 2 Cleans -> 1 Press -> 3 Front Squats EMOM. Add 1-2 rounds weekly up to 30 mins..."
                    onChange={(e) =>
                      setEditingPreset({ ...editingPreset, workoutNotes: e.target.value })
                    }
                    className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:border-orange-500"
                  />
                </div>

                {(() => {
                  const activeFormat: PresetFormatMode =
                    editingPreset.formatMode ||
                    (editingPreset.defaultTimer?.mode === 'circuit'
                      ? editingPreset.defaultTimer.restSec === 0
                        ? 'emom_complex'
                        : 'circuit'
                      : 'standard');
                  const isIntervalFormat =
                    activeFormat === 'circuit' || activeFormat === 'emom_complex';

                  const switchFormat = (nextFormat: PresetFormatMode) => {
                    if (nextFormat === 'standard') {
                      setEditingPreset({
                        ...editingPreset,
                        formatMode: 'standard',
                        defaultTimer: {
                          mode: 'rest',
                          restSec:
                            editingPreset.defaultTimer?.restSec !== undefined
                              ? editingPreset.defaultTimer.restSec
                              : editingPreset.workoutType === 'Cardio'
                              ? 0
                              : 60,
                        },
                      });
                    } else if (nextFormat === 'circuit') {
                      const rounds = editingPreset.defaultTimer?.rounds || 12;
                      setEditingPreset({
                        ...editingPreset,
                        formatMode: 'circuit',
                        defaultTimer: {
                          mode: 'circuit',
                          rounds,
                          workSec: editingPreset.defaultTimer?.workSec || 40,
                          restSec:
                            editingPreset.defaultTimer?.restSec !== undefined &&
                            editingPreset.defaultTimer.restSec > 0
                              ? editingPreset.defaultTimer.restSec
                              : 20,
                          targetRange: editingPreset.defaultTimer?.targetRange || '12–20 mins',
                        },
                      });
                    } else {
                      const rounds = editingPreset.defaultTimer?.rounds || 15;
                      setEditingPreset({
                        ...editingPreset,
                        formatMode: 'emom_complex',
                        defaultTimer: {
                          mode: 'circuit',
                          rounds,
                          workSec: 60,
                          restSec: 0,
                          targetRange: editingPreset.defaultTimer?.targetRange || '15–30 mins',
                        },
                      });
                    }
                  };

                  return (
                    <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                          <Timer className="w-4 h-4 text-orange-500" />
                          Default Structure & Timer
                        </span>

                        <div className="inline-flex rounded-xl bg-slate-200/80 dark:bg-slate-900 p-0.5">
                          {(
                            [
                              { id: 'standard', label: 'Standard' },
                              { id: 'circuit', label: 'Circuit' },
                              { id: 'emom_complex', label: 'EMOM / Complex' },
                            ] as Array<{ id: PresetFormatMode; label: string }>
                          ).map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => switchFormat(opt.id)}
                              className={`px-2.5 py-1 rounded-lg text-[11px] font-bold transition-all ${
                                activeFormat === opt.id
                                  ? 'bg-orange-500 text-white shadow-2xs'
                                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {isIntervalFormat ? (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                              Default Rounds
                            </label>
                            <input
                              type="number"
                              min={1}
                              max={100}
                              value={editingPreset.defaultTimer?.rounds ?? 15}
                              onChange={(e) => {
                                const rounds = Math.max(1, parseInt(e.target.value, 10) || 1);
                                setEditingPreset({
                                  ...editingPreset,
                                  defaultTimer: {
                                    ...(editingPreset.defaultTimer || {
                                      mode: 'circuit',
                                      workSec: 60,
                                      restSec: 0,
                                    }),
                                    mode: 'circuit',
                                    rounds,
                                  },
                                  exercises: editingPreset.exercises.map((ex) => ({
                                    ...ex,
                                    defaultSets: rounds,
                                  })),
                                });
                              }}
                              className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-semibold text-orange-600 dark:text-orange-400 mb-0.5">
                              Work (sec)
                            </label>
                            <input
                              type="number"
                              min={5}
                              max={3600}
                              value={editingPreset.defaultTimer?.workSec ?? 60}
                              onChange={(e) => {
                                const workSec = Math.max(5, parseInt(e.target.value, 10) || 60);
                                setEditingPreset({
                                  ...editingPreset,
                                  defaultTimer: {
                                    ...(editingPreset.defaultTimer || {
                                      mode: 'circuit',
                                      restSec: 0,
                                      rounds: 15,
                                    }),
                                    mode: 'circuit',
                                    workSec,
                                  },
                                });
                              }}
                              className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                              Rest (sec, 0=EMOM)
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={3600}
                              value={editingPreset.defaultTimer?.restSec ?? 0}
                              onChange={(e) => {
                                const restSec = Math.max(0, parseInt(e.target.value, 10) || 0);
                                setEditingPreset({
                                  ...editingPreset,
                                  defaultTimer: {
                                    ...(editingPreset.defaultTimer || {
                                      mode: 'circuit',
                                      workSec: 60,
                                      rounds: 15,
                                    }),
                                    mode: 'circuit',
                                    restSec,
                                  },
                                });
                              }}
                              className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                          </div>

                          <div>
                            <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                              Target Range
                            </label>
                            <input
                              type="text"
                              value={editingPreset.defaultTimer?.targetRange || ''}
                              placeholder="e.g. 15–30 mins"
                              onChange={(e) =>
                                setEditingPreset({
                                  ...editingPreset,
                                  defaultTimer: {
                                    ...(editingPreset.defaultTimer || {
                                      mode: 'circuit',
                                      workSec: 60,
                                      restSec: 0,
                                      rounds: 15,
                                    }),
                                    mode: 'circuit',
                                    targetRange: e.target.value,
                                  },
                                })
                              }
                              className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="w-36">
                            <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                              Default Rest (sec)
                            </label>
                            <input
                              type="number"
                              min={0}
                              max={600}
                              placeholder="0 (No Rest)"
                              value={
                                editingPreset.defaultTimer?.restSec === undefined ||
                                editingPreset.defaultTimer?.restSec === null
                                  ? ''
                                  : editingPreset.defaultTimer.restSec
                              }
                              onChange={(e) => {
                                const raw = e.target.value;
                                const restSec =
                                  raw === '' ? 0 : Math.max(0, parseInt(raw, 10) || 0);
                                setEditingPreset({
                                  ...editingPreset,
                                  defaultTimer: { mode: 'rest', restSec },
                                });
                              }}
                              className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                          </div>

                          <button
                            type="button"
                            onClick={() => {
                              const currentRest = editingPreset.defaultTimer?.restSec ?? 60;
                              setEditingPreset({
                                ...editingPreset,
                                defaultTimer: {
                                  mode: 'rest',
                                  restSec: currentRest === 0 ? 60 : 0,
                                },
                              });
                            }}
                            className={`mt-4 px-2.5 py-1.5 rounded-xl text-[11px] font-bold border transition-colors ${
                              (editingPreset.defaultTimer?.restSec ?? 60) === 0
                                ? 'bg-orange-500 text-white border-orange-500'
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-orange-500'
                            }`}
                          >
                            No Rest (0s)
                          </button>

                          <span className="text-[11px] text-slate-400 pt-3">
                            {(editingPreset.defaultTimer?.restSec ?? 60) === 0
                              ? 'Rest timer pill & auto-countdown disabled (ideal for steady-state cardio).'
                              : 'Standard straight-set logging with rest countdown between sets.'}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              {/* Exercises List */}
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Exercises ({editingPreset.exercises.length})
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      const newEx: PresetExercise = {
                        exerciseUuid: `ex-${uuidv4()}`,
                        exerciseName: 'New Exercise',
                        category: 'Strength',
                        trackingType: 'strength',
                        loadType: 'single_kg',
                        defaultWeight: 16,
                        defaultSets: 3,
                        defaultReps: '10',
                      };
                      setEditingPreset({
                        ...editingPreset,
                        exercises: [...editingPreset.exercises, newEx],
                      });
                    }}
                    className="px-3 py-1.5 rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400 text-xs font-bold hover:bg-orange-500 hover:text-white transition-colors"
                  >
                    + Add Exercise
                  </button>
                </div>

                {(() => {
                  const isSequenceMode =
                    editingPreset.formatMode === 'circuit' ||
                    editingPreset.formatMode === 'emom_complex' ||
                    editingPreset.defaultTimer?.mode === 'circuit';
                  const syncedRounds = editingPreset.defaultTimer?.rounds || 15;

                  return (
                    <div
                      className={
                        isSequenceMode
                          ? 'p-3 rounded-2xl border-2 border-orange-500/40 bg-orange-500/[0.03] space-y-2.5'
                          : 'space-y-2.5'
                      }
                    >
                      {isSequenceMode && (
                        <div className="flex flex-wrap items-center justify-between gap-2 pb-1">
                          <span className="text-[11px] font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400 flex items-center gap-1.5">
                            <Flame className="w-3.5 h-3.5" />
                            Complex / Circuit Sequence ({syncedRounds} Rounds)
                          </span>
                          <span className="text-[11px] font-mono text-slate-500">
                            {editingPreset.exercises.map((_, i) => i + 1).join(' → ')}
                          </span>
                        </div>
                      )}

                      {editingPreset.exercises.map((pe, idx) => (
                        <div
                          key={idx}
                          className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 space-y-3"
                        >
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shrink-0 tabular-nums ${
                                isSequenceMode
                                  ? 'bg-orange-500 text-white'
                                  : 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                              }`}
                            >
                              {idx + 1}
                            </span>

                        <input
                          type="text"
                          list="global-exercises-datalist"
                          value={pe.exerciseName}
                          placeholder="Exercise Name"
                          onChange={(e) => {
                            const name = e.target.value;
                            const matchedGlobal = globalExercises.find(
                              (ge) => ge.exerciseName.toLowerCase() === name.toLowerCase()
                            );
                            const next = [...editingPreset.exercises];
                            next[idx] = {
                              ...pe,
                              exerciseName: name,
                              exerciseUuid: matchedGlobal?.exerciseUuid || pe.exerciseUuid,
                              category: matchedGlobal?.category || pe.category,
                            };
                            setEditingPreset({ ...editingPreset, exercises: next });
                          }}
                          className="min-w-0 w-full sm:w-auto sm:flex-1 px-3 py-2 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:border-orange-500"
                        />

                        <select
                          value={pe.trackingType}
                          title="Exercise Tracking Format"
                          onChange={(e) => {
                            const next = [...editingPreset.exercises];
                            next[idx] = {
                              ...pe,
                              trackingType: e.target.value as TrackingType,
                            };
                            setEditingPreset({ ...editingPreset, exercises: next });
                          }}
                          className="px-2.5 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                        >
                          <option value="strength">Strength / Sets</option>
                          <option value="circuit">Circuit / Timed</option>
                          <option value="cardio">Cardio / Distance</option>
                        </select>

                        <div className="flex items-center gap-0.5 ml-auto">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => handleMoveExercise(idx, -1)}
                            title="Move exercise up"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white disabled:opacity-30"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === editingPreset.exercises.length - 1}
                            onClick={() => handleMoveExercise(idx, 1)}
                            title="Move exercise down"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 dark:hover:text-white disabled:opacity-30"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setEditingPreset({
                                ...editingPreset,
                                exercises: editingPreset.exercises.filter((_, i) => i !== idx),
                              })
                            }
                            title="Remove exercise"
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      {pe.trackingType === 'cardio' ? (
                        <div className="grid grid-cols-3 gap-2.5">
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">
                              Cardio Mode
                            </label>
                            <select
                              value={pe.cardioMode || 'Ruck'}
                              onChange={(e) => {
                                const next = [...editingPreset.exercises];
                                next[idx] = {
                                  ...pe,
                                  cardioMode: e.target.value as CardioMode,
                                };
                                setEditingPreset({ ...editingPreset, exercises: next });
                              }}
                              className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            >
                              {CARDIO_MODES.map((m) => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">
                              Unit
                            </label>
                            <select
                              value={pe.defaultDistanceUnit || 'mi'}
                              onChange={(e) => {
                                const next = [...editingPreset.exercises];
                                next[idx] = {
                                  ...pe,
                                  defaultDistanceUnit: e.target.value as DistanceUnit,
                                };
                                setEditingPreset({ ...editingPreset, exercises: next });
                              }}
                              className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            >
                              <option value="mi">Miles (mi)</option>
                              <option value="km">Kilometers (km)</option>
                            </select>
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">
                              Ruck / Load (kg)
                            </label>
                            <input
                              type="number"
                              value={pe.defaultWeight}
                              onChange={(e) => {
                                const next = [...editingPreset.exercises];
                                next[idx] = {
                                  ...pe,
                                  loadType: 'ruck_kg',
                                  defaultWeight: parseFloat(e.target.value) || 0,
                                };
                                setEditingPreset({ ...editingPreset, exercises: next });
                              }}
                              className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                          <div>
                            <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">
                              Load Style
                            </label>
                            <select
                              value={pe.loadType}
                              onChange={(e) => {
                                const next = [...editingPreset.exercises];
                                next[idx] = { ...pe, loadType: e.target.value as LoadType };
                                setEditingPreset({ ...editingPreset, exercises: next });
                              }}
                              className="w-full px-2.5 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            >
                              <option value="single_kg">1x Single (kg)</option>
                              <option value="double_kg">2x Double (kg)</option>
                              <option value="bw_plus_kg">BW + Weight (kg)</option>
                              <option value="bodyweight">Bodyweight (BW)</option>
                              <option value="none">No Load</option>
                            </select>
                          </div>

                          <div>
                            <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">
                              Default Weight (kg)
                            </label>
                            <input
                              type="number"
                              step="0.5"
                              disabled={pe.loadType === 'bodyweight' || pe.loadType === 'none'}
                              value={pe.defaultWeight}
                              onChange={(e) => {
                                const next = [...editingPreset.exercises];
                                next[idx] = {
                                  ...pe,
                                  defaultWeight: parseFloat(e.target.value) || 0,
                                };
                                setEditingPreset({ ...editingPreset, exercises: next });
                              }}
                              className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40"
                            />
                          </div>

                          {isSequenceMode ? (
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">
                                Rounds (Synced)
                              </label>
                              <div className="px-2.5 py-1.5 text-xs font-mono font-bold rounded-xl border border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400 text-center">
                                {syncedRounds} rds
                              </div>
                            </div>
                          ) : (
                            <div>
                              <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">
                                Sets
                              </label>
                              <input
                                type="number"
                                min={1}
                                value={pe.defaultSets}
                                onChange={(e) => {
                                  const next = [...editingPreset.exercises];
                                  next[idx] = {
                                    ...pe,
                                    defaultSets: Math.max(1, parseInt(e.target.value, 10) || 1),
                                  };
                                  setEditingPreset({ ...editingPreset, exercises: next });
                                }}
                                className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                              />
                            </div>
                          )}

                          <div>
                            <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">
                              {isSequenceMode ? 'Reps / Round' : 'Target Reps'}
                            </label>
                            <input
                              type="text"
                              value={pe.defaultReps}
                              placeholder={isSequenceMode ? 'e.g. 2' : 'e.g. 10 or AMRAP'}
                              onChange={(e) => {
                                const next = [...editingPreset.exercises];
                                next[idx] = { ...pe, defaultReps: e.target.value };
                                setEditingPreset({ ...editingPreset, exercises: next });
                              }}
                              className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                            />
                          </div>
                        </div>
                      )}

                      {/* Rep Scheme (Fixed vs Ladder / Pyramid) + Side Badge & Per Side (x2) */}
                      {pe.trackingType !== 'cardio' && (() => {
                        const schemeType: RepSchemeType = pe.repScheme?.schemeType || 'fixed';
                        const lStart =
                          pe.repScheme?.ladderStart ??
                          (schemeType === 'descending_ladder' ? 10 : 1);
                        const lEnd =
                          pe.repScheme?.ladderEnd ??
                          (schemeType === 'descending_ladder' ? 1 : 5);
                        const lStep = pe.repScheme?.ladderStep ?? 1;
                        const expandedSeq =
                          schemeType !== 'fixed'
                            ? expandLadderSequence(lStart, lEnd, lStep, schemeType)
                            : [];
                        const totalLadderReps = expandedSeq.reduce((a, b) => a + b, 0);

                        const updateScheme = (
                          nextType: RepSchemeType,
                          nextStart = nextType === 'descending_ladder' ? 10 : 1,
                          nextEnd = nextType === 'descending_ladder' ? 1 : 5,
                          nextStep = 1
                        ) => {
                          const next = [...editingPreset.exercises];
                          if (nextType === 'fixed') {
                            next[idx] = {
                              ...pe,
                              repScheme: { schemeType: 'fixed' },
                              defaultReps:
                                pe.defaultReps.includes('->') || pe.defaultReps.includes('→')
                                  ? '10'
                                  : pe.defaultReps,
                            };
                          } else {
                            const seq = expandLadderSequence(
                              nextStart,
                              nextEnd,
                              nextStep,
                              nextType
                            );
                            next[idx] = {
                              ...pe,
                              defaultSets: seq.length || pe.defaultSets,
                              defaultReps:
                                nextType === 'pyramid'
                                  ? `${nextStart}->${nextEnd}->${nextStart}`
                                  : `${nextStart}->${nextEnd}`,
                              repScheme: {
                                schemeType: nextType,
                                ladderStart: nextStart,
                                ladderEnd: nextEnd,
                                ladderStep: nextStep,
                              },
                            };
                          }
                          setEditingPreset({ ...editingPreset, exercises: next });
                        };

                        return (
                          <div className="space-y-2.5 pt-2 border-t border-slate-200/50 dark:border-slate-700/50">
                            {/* Rep Scheme Selector */}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                                Rep Scheme:
                              </span>
                              <div className="inline-flex flex-wrap rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 p-0.5 gap-0.5">
                                {(
                                  [
                                    { id: 'fixed', label: 'Fixed' },
                                    { id: 'descending_ladder', label: 'Descending' },
                                    { id: 'ascending_ladder', label: 'Ascending' },
                                    { id: 'pyramid', label: 'Pyramid' },
                                  ] as Array<{ id: RepSchemeType; label: string }>
                                ).map((opt) => (
                                  <button
                                    key={opt.id}
                                    type="button"
                                    onClick={() => updateScheme(opt.id)}
                                    className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-colors ${
                                      schemeType === opt.id
                                        ? 'bg-orange-500 text-white'
                                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                                    }`}
                                  >
                                    {opt.label}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Ladder Start / End / Step + Live Preview */}
                            {schemeType !== 'fixed' && (
                              <div className="p-2.5 rounded-xl bg-orange-500/[0.06] border border-orange-500/20 flex flex-wrap items-end gap-2.5">
                                <div className="w-16">
                                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                    Start
                                  </label>
                                  <input
                                    type="number"
                                    min={1}
                                    value={lStart}
                                    onChange={(e) =>
                                      updateScheme(
                                        schemeType,
                                        Math.max(1, parseInt(e.target.value, 10) || 1),
                                        lEnd,
                                        lStep
                                      )
                                    }
                                    className="w-full px-2 py-1 text-xs font-mono font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center"
                                  />
                                </div>

                                <div className="w-16">
                                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                    End
                                  </label>
                                  <input
                                    type="number"
                                    min={1}
                                    value={lEnd}
                                    onChange={(e) =>
                                      updateScheme(
                                        schemeType,
                                        lStart,
                                        Math.max(1, parseInt(e.target.value, 10) || 1),
                                        lStep
                                      )
                                    }
                                    className="w-full px-2 py-1 text-xs font-mono font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center"
                                  />
                                </div>

                                <div className="w-14">
                                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                                    Step
                                  </label>
                                  <input
                                    type="number"
                                    min={1}
                                    value={lStep}
                                    onChange={(e) =>
                                      updateScheme(
                                        schemeType,
                                        lStart,
                                        lEnd,
                                        Math.max(1, parseInt(e.target.value, 10) || 1)
                                      )
                                    }
                                    className="w-full px-2 py-1 text-xs font-mono font-bold rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center"
                                  />
                                </div>

                                <div className="ml-auto text-right">
                                  <span className="inline-block px-2.5 py-1 rounded-lg bg-orange-500/15 text-orange-600 dark:text-orange-400 text-[11px] font-mono font-bold tabular-nums">
                                    {expandedSeq.length} rungs • {totalLadderReps} total reps
                                  </span>
                                </div>
                              </div>
                            )}

                            {/* Side Badge & Per Side (x2) */}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-semibold text-slate-400">
                                  Side:
                                </span>
                                {(['', 'L', 'R', 'L/R'] as Array<'' | ExerciseSide>).map((sOpt) => (
                                  <button
                                    key={sOpt || 'none'}
                                    type="button"
                                    onClick={() => {
                                      const next = [...editingPreset.exercises];
                                      next[idx] = {
                                        ...pe,
                                        side: sOpt ? sOpt : undefined,
                                      };
                                      setEditingPreset({ ...editingPreset, exercises: next });
                                    }}
                                    className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-colors ${
                                      (pe.side || '') === sOpt
                                        ? 'bg-orange-500 text-white'
                                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500'
                                    }`}
                                  >
                                    {sOpt || 'None'}
                                  </button>
                                ))}
                              </div>

                              <label
                                title="Multiply reps by 2 (Left + Right) when calculating total reps & volume"
                                className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 cursor-pointer"
                              >
                                <input
                                  type="checkbox"
                                  checked={Boolean(pe.isPerSide)}
                                  onChange={(e) => {
                                    const next = [...editingPreset.exercises];
                                    next[idx] = { ...pe, isPerSide: e.target.checked };
                                    setEditingPreset({ ...editingPreset, exercises: next });
                                  }}
                                  className="rounded text-orange-500 focus:ring-orange-500"
                                />
                                Per Side (×2 L+R)
                              </label>
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  ))}
                    </div>
                  );
                })()}

                <datalist id="global-exercises-datalist">
                  {globalExercises.map((ge) => (
                    <option key={ge.exerciseUuid} value={ge.exerciseName} />
                  ))}
                </datalist>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingPreset(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  upsertPreset(editingPreset);
                  setEditingPreset(null);
                  showToast(`Saved "${editingPreset.title}"!`);
                }}
                className="px-5 py-2 rounded-xl text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white shadow-sm"
              >
                Save Workout
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useMemo, useState } from 'react';
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
  Link2,
  ChevronDown,
  ChevronUp,
  Pencil,
  Check,
} from 'lucide-react';
import { useWorkoutStore } from '../store/useWorkoutStore';
import {
  CardioMode,
  DistanceUnit,
  ExerciseMetricType,
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
  groupConsecutiveExercises,
  inferDefaultMetricType,
  slugify,
  uuidv4,
} from '../utils/calculations';
import { useIsMobileView } from '../utils/useIsMobileView';

const CARDIO_MODES: CardioMode[] = ['Ruck', 'Cycle', 'Run', 'Row', 'Swim', 'Other'];

export const LibraryView: React.FC = () => {
  const {
    presets,
    programs,
    exercises: globalExercises,
    categories,
    meta,
    upsertPreset,
    duplicatePreset,
    deletePreset,
    addWorkoutToSession,
    setActiveTab,
    editingPresetUuid,
    presetEditorReturnTab,
    clearPresetEditor,
    addCategory,
    renameCategory,
    deleteCategory,
  } = useWorkoutStore();

  const isMobile = useIsMobileView();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedProgramFilter, setSelectedProgramFilter] = useState<string>('ALL');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'ALL' | WorkoutType>('ALL');
  const [selectedTagFilter, setSelectedTagFilter] = useState<string>('ALL');

  const [editingPreset, setEditingPreset] = useState<WorkoutPreset | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [activeMetaPanel, setActiveMetaPanel] = useState<
    'programs' | 'tags' | 'timer' | 'notes' | null
  >(null);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [renamingCategory, setRenamingCategory] = useState<{
    oldName: string;
    value: string;
  } | null>(null);
  const [expandedExerciseMore, setExpandedExerciseMore] = useState<Record<number, boolean>>({});
  const [timerDraftInputs, setTimerDraftInputs] = useState<{
    rounds?: string;
    workSec?: string;
    restSec?: string;
  }>({});
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!editingPresetUuid) return;
    const matched = presets.find((p) => p.presetUuid === editingPresetUuid);
    if (matched) {
      setEditingPreset(JSON.parse(JSON.stringify(matched)));
    }
  }, [editingPresetUuid, presets]);

  useEffect(() => {
    if (!editingPreset) return;
    // Always start with Programs, Tags, Timer & Notes collapsed into summary pills
    setActiveMetaPanel(null);
    setCategoryManagerOpen(false);
    setRenamingCategory(null);
    setExpandedExerciseMore({});
    setTimerDraftInputs({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingPreset?.presetUuid]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  const closePresetEditorModal = () => {
    const returnTab = presetEditorReturnTab;
    setEditingPreset(null);
    clearPresetEditor();
    if (returnTab && returnTab !== 'library') {
      setActiveTab(returnTab);
    }
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
            {categories.map((wt) => (
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
                              ? (preset.defaultTimer.workSec ?? 60) === 0
                                ? `${preset.defaultTimer.rounds ?? 0} rnds · ${
                                    (preset.defaultTimer.restSec ?? 0) === 0
                                      ? 'No Rest'
                                      : `${preset.defaultTimer.restSec}s rest`
                                  }`
                                : `${preset.defaultTimer.rounds ?? 10}× ${
                                    preset.defaultTimer.workSec ?? 60
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
                          {ex.trackingType === 'mobility'
                            ? ex.defaultDurationMin
                              ? `${ex.defaultDurationMin} min`
                              : 'Flow'
                            : ex.trackingType === 'cardio'
                            ? `${ex.cardioMode || 'Cardio'} (${ex.defaultDistanceUnit || 'mi'})`
                            : `${ex.defaultSets} × ${ex.defaultReps}${
                                ex.isPerSide ? '/side' : ''
                              } @ ${formatLoadBadge(ex.loadType, ex.defaultWeight, undefined, ex.secondaryWeightKg)}`}
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
                onClick={closePresetEditorModal}
                title="Close editor"
                className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {/* Row 1: Workout Name + Category (with +/Edit Manager) */}
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
                    className="w-full px-3.5 py-2 text-sm font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:border-orange-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1">
                    Category
                  </label>
                  <div className="flex items-center gap-1.5">
                    <select
                      value={editingPreset.workoutType}
                      onChange={(e) => {
                        if (e.target.value === '__manage__') {
                          setCategoryManagerOpen(true);
                          return;
                        }
                        const nextCategory = e.target.value as WorkoutType;
                        const isMobCat = /^(mobility|yoga)$/i.test(nextCategory.trim());
                        setEditingPreset({
                          ...editingPreset,
                          workoutType: nextCategory,
                          exercises: isMobCat
                            ? editingPreset.exercises.map((ex) =>
                                ex.exerciseName === 'New Exercise' && ex.trackingType === 'strength'
                                  ? {
                                      ...ex,
                                      trackingType: 'mobility',
                                      loadType: 'none',
                                      defaultWeight: 0,
                                      defaultDurationMin: ex.defaultDurationMin ?? 0,
                                    }
                                  : ex
                              )
                            : editingPreset.exercises,
                        });
                      }}
                      className="flex-1 min-w-0 px-3 py-2 text-sm font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:border-orange-500"
                    >
                      {categories.map((wt) => (
                        <option key={wt} value={wt}>
                          {wt}
                        </option>
                      ))}
                      <option value="__manage__">+ Manage Categories...</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setCategoryManagerOpen((prev) => !prev)}
                      data-tooltip="Add or edit custom categories"
                      title="Add or edit custom categories"
                      className={`p-2 rounded-xl border transition-colors shrink-0 ${
                        categoryManagerOpen
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 hover:text-orange-500'
                      }`}
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Custom Categories Manager Mini-Panel */}
              {categoryManagerOpen && (
                <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/70 border border-orange-500/30 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                      Manage Categories
                    </span>
                    <button
                      type="button"
                      onClick={() => setCategoryManagerOpen(false)}
                      className="text-[11px] font-bold text-orange-500 hover:underline"
                    >
                      Done
                    </button>
                  </div>

                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={newCategoryInput}
                      onChange={(e) => setNewCategoryInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newCategoryInput.trim()) {
                          e.preventDefault();
                          const val = newCategoryInput.trim();
                          addCategory(val);
                          setEditingPreset({ ...editingPreset, workoutType: val });
                          setNewCategoryInput('');
                        }
                      }}
                      placeholder="New category name (e.g. Loaded Carry)..."
                      className="flex-1 min-w-0 px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const val = newCategoryInput.trim();
                        if (!val) return;
                        addCategory(val);
                        setEditingPreset({ ...editingPreset, workoutType: val });
                        setNewCategoryInput('');
                      }}
                      className="px-3 py-1.5 rounded-xl bg-orange-500 text-white text-xs font-bold shrink-0"
                    >
                      + Add
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {categories.map((cat) =>
                      renamingCategory?.oldName === cat ? (
                        <div
                          key={cat}
                          className="inline-flex items-center gap-1 bg-white dark:bg-slate-900 border border-orange-500 rounded-xl px-2 py-1"
                        >
                          <input
                            type="text"
                            autoFocus
                            value={renamingCategory.value}
                            onChange={(e) =>
                              setRenamingCategory({
                                ...renamingCategory,
                                value: e.target.value,
                              })
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                const trimmed = renamingCategory.value.trim();
                                if (trimmed) {
                                  renameCategory(cat, trimmed);
                                  if (editingPreset.workoutType === cat) {
                                    setEditingPreset({
                                      ...editingPreset,
                                      workoutType: trimmed,
                                    });
                                  }
                                }
                                setRenamingCategory(null);
                              }
                            }}
                            className="w-28 text-xs font-semibold bg-transparent focus:outline-none"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const trimmed = renamingCategory.value.trim();
                              if (trimmed) {
                                renameCategory(cat, trimmed);
                                if (editingPreset.workoutType === cat) {
                                  setEditingPreset({
                                    ...editingPreset,
                                    workoutType: trimmed,
                                  });
                                }
                              }
                              setRenamingCategory(null);
                            }}
                            className="text-emerald-600 hover:text-emerald-500"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span
                          key={cat}
                          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-xl text-xs font-semibold border ${
                            editingPreset.workoutType === cat
                              ? 'bg-orange-500/15 border-orange-500/40 text-orange-600 dark:text-orange-400'
                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setEditingPreset({ ...editingPreset, workoutType: cat })
                            }
                          >
                            {cat}
                          </button>
                          <button
                            type="button"
                            title="Rename category"
                            onClick={() =>
                              setRenamingCategory({ oldName: cat, value: cat })
                            }
                            className="text-slate-400 hover:text-orange-500 ml-0.5"
                          >
                            <Pencil className="w-3 h-3" />
                          </button>
                          {categories.length > 1 && (
                            <button
                              type="button"
                              title="Delete category"
                              onClick={() => {
                                deleteCategory(cat);
                                if (editingPreset.workoutType === cat) {
                                  const fallback = categories.find((c) => c !== cat) || 'Strength';
                                  setEditingPreset({
                                    ...editingPreset,
                                    workoutType: fallback,
                                  });
                                }
                              }}
                              className="text-slate-400 hover:text-rose-500"
                            >
                              ×
                            </button>
                          )}
                        </span>
                      )
                    )}
                  </div>
                </div>
              )}

              {/* Row 2: Always-Collapsed Summary Chips (Programs, Tags, Timer, Notes) */}
              {(() => {
                const selectedProgNames = programs
                  .filter((p) => editingPreset.programIds?.includes(p.programUuid))
                  .map((p) => p.title);
                const progSummary =
                  selectedProgNames.length > 0 ? selectedProgNames.join(', ') : 'None';
                const tagsSummary =
                  (editingPreset.tags?.length || 0) > 0
                    ? editingPreset.tags.join(', ')
                    : 'None';

                const activeFormat: PresetFormatMode =
                  editingPreset.formatMode ||
                  (editingPreset.defaultTimer?.mode === 'circuit'
                    ? editingPreset.defaultTimer.restSec === 0
                      ? 'emom_complex'
                      : 'circuit'
                    : 'standard');
                const rndVal = editingPreset.defaultTimer?.rounds ?? (activeFormat === 'emom_complex' ? 15 : 12);
                const wrkVal = editingPreset.defaultTimer?.workSec ?? (activeFormat === 'emom_complex' ? 60 : 40);
                const rstVal = editingPreset.defaultTimer?.restSec ?? (activeFormat === 'circuit' ? 20 : activeFormat === 'emom_complex' ? 0 : 60);
                const formatPrefix = activeFormat === 'emom_complex' ? 'EMOM' : 'Circuit';

                const timerSummary =
                  activeFormat === 'standard'
                    ? `Standard · ${rstVal === 0 ? 'No Rest' : `${rstVal}s`}`
                    : wrkVal === 0 && rstVal > 0
                    ? `${formatPrefix} · ${rndVal} rnds · ${rstVal}s rest`
                    : wrkVal === 0 && rstVal === 0
                    ? `${formatPrefix} · ${rndVal} rnds · No Rest`
                    : rstVal === 0
                    ? `${formatPrefix} · ${rndVal}×${wrkVal}s · No Rest`
                    : `${formatPrefix} · ${rndVal}×${wrkVal}s/${rstVal}s`;

                const hasNotes = Boolean(editingPreset.workoutNotes?.trim());
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
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setActiveMetaPanel((p) => (p === 'programs' ? null : 'programs'))
                        }
                        className={`max-w-full px-2.5 py-1 rounded-xl text-[11px] font-semibold inline-flex items-center gap-1 border transition-colors ${
                          activeMetaPanel === 'programs'
                            ? 'bg-orange-500 text-white border-orange-500'
                            : 'bg-slate-100 dark:bg-slate-800 border-slate-200/70 dark:border-slate-700/70 text-slate-700 dark:text-slate-200 hover:border-orange-500'
                        }`}
                      >
                        <span className="truncate max-w-[170px]">
                          Programs: {progSummary}
                        </span>
                        {activeMetaPanel === 'programs' ? (
                          <ChevronUp className="w-3 h-3 shrink-0" />
                        ) : (
                          <ChevronDown className="w-3 h-3 shrink-0" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setActiveMetaPanel((p) => (p === 'tags' ? null : 'tags'))
                        }
                        className={`max-w-full px-2.5 py-1 rounded-xl text-[11px] font-semibold inline-flex items-center gap-1 border transition-colors ${
                          activeMetaPanel === 'tags'
                            ? 'bg-orange-500 text-white border-orange-500'
                            : 'bg-slate-100 dark:bg-slate-800 border-slate-200/70 dark:border-slate-700/70 text-slate-700 dark:text-slate-200 hover:border-orange-500'
                        }`}
                      >
                        <span className="truncate max-w-[150px]">Tags: {tagsSummary}</span>
                        {activeMetaPanel === 'tags' ? (
                          <ChevronUp className="w-3 h-3 shrink-0" />
                        ) : (
                          <ChevronDown className="w-3 h-3 shrink-0" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setActiveMetaPanel((p) => (p === 'timer' ? null : 'timer'))
                        }
                        className={`max-w-full px-2.5 py-1 rounded-xl text-[11px] font-semibold inline-flex items-center gap-1 border transition-colors ${
                          activeMetaPanel === 'timer'
                            ? 'bg-orange-500 text-white border-orange-500'
                            : 'bg-slate-100 dark:bg-slate-800 border-slate-200/70 dark:border-slate-700/70 text-slate-700 dark:text-slate-200 hover:border-orange-500'
                        }`}
                      >
                        <Timer className="w-3 h-3 text-orange-500 shrink-0" />
                        <span className="truncate">Timer: {timerSummary}</span>
                        {activeMetaPanel === 'timer' ? (
                          <ChevronUp className="w-3 h-3 shrink-0" />
                        ) : (
                          <ChevronDown className="w-3 h-3 shrink-0" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          setActiveMetaPanel((p) => (p === 'notes' ? null : 'notes'))
                        }
                        className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                          activeMetaPanel === 'notes'
                            ? 'bg-orange-500 text-white border-orange-500'
                            : 'bg-slate-100 dark:bg-slate-800 border-slate-200/70 dark:border-slate-700/70 text-slate-700 dark:text-slate-200 hover:border-orange-500'
                        }`}
                      >
                        <span>Notes</span>
                        {hasNotes && activeMetaPanel !== 'notes' && (
                          <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                        )}
                        {activeMetaPanel === 'notes' ? (
                          <ChevronUp className="w-3 h-3 shrink-0" />
                        ) : (
                          <ChevronDown className="w-3 h-3 shrink-0" />
                        )}
                      </button>
                    </div>

                    {activeMetaPanel === 'programs' && (
                      <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            Included in Programs
                          </label>
                          <button
                            type="button"
                            onClick={() => setActiveMetaPanel(null)}
                            className="text-[11px] font-bold text-orange-500 hover:underline"
                          >
                            Done
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {programs.map((prog) => {
                            const checked = editingPreset.programIds?.includes(prog.programUuid);
                            return (
                              <label
                                key={prog.programUuid}
                                className={`px-2.5 py-1 rounded-xl border text-xs font-semibold flex items-center gap-1.5 cursor-pointer transition-colors ${
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
                    )}

                    {activeMetaPanel === 'tags' && (
                      <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            Tags
                          </label>
                          <button
                            type="button"
                            onClick={() => setActiveMetaPanel(null)}
                            className="text-[11px] font-bold text-orange-500 hover:underline"
                          >
                            Done
                          </button>
                        </div>
                        {(editingPreset.tags?.length || 0) > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5">
                            {editingPreset.tags?.map((t) => (
                              <span
                                key={t}
                                className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300"
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
                        )}
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
                            className="flex-1 min-w-0 px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
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
                            className="px-3 py-1.5 rounded-xl bg-slate-200 dark:bg-slate-700 text-xs font-bold"
                          >
                            Add
                          </button>
                        </div>
                      </div>
                    )}

                    {activeMetaPanel === 'notes' && (
                      <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-800 space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                            Workout Guidance / Progression Notes
                          </label>
                          <button
                            type="button"
                            onClick={() => setActiveMetaPanel(null)}
                            className="text-[11px] font-bold text-orange-500 hover:underline"
                          >
                            Done
                          </button>
                        </div>
                        <textarea
                          rows={2}
                          value={editingPreset.workoutNotes || ''}
                          placeholder="e.g. Perform 2 Cleans -> 1 Press -> 3 Front Squats EMOM. Add 1-2 rounds weekly up to 30 mins..."
                          onChange={(e) =>
                            setEditingPreset({ ...editingPreset, workoutNotes: e.target.value })
                          }
                          className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:border-orange-500"
                        />
                      </div>
                    )}

                    {activeMetaPanel === 'timer' && (
                      <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-700/80 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center gap-1.5">
                            <Timer className="w-4 h-4 text-orange-500" />
                            Default Structure & Timer
                          </span>

                          <div className="flex items-center gap-2">
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
                            <button
                              type="button"
                              onClick={() => setActiveMetaPanel(null)}
                              className="text-[11px] font-bold text-orange-500 hover:underline"
                            >
                              Done
                            </button>
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
                                min={0}
                                max={100}
                                value={
                                  timerDraftInputs.rounds !== undefined
                                    ? timerDraftInputs.rounds
                                    : String(editingPreset.defaultTimer?.rounds ?? 15)
                                }
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  setTimerDraftInputs((prev) => ({ ...prev, rounds: raw }));
                                  if (raw !== '') {
                                    const parsed = parseInt(raw, 10);
                                    const rounds = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
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
                                        defaultSets: Math.max(1, rounds),
                                      })),
                                    });
                                  }
                                }}
                                onBlur={() => {
                                  const parsed = parseInt(timerDraftInputs.rounds ?? '', 10);
                                  if (timerDraftInputs.rounds !== undefined) {
                                    const rounds = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
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
                                    });
                                    setTimerDraftInputs((prev) => ({ ...prev, rounds: undefined }));
                                  }
                                }}
                                className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                              />
                            </div>

                            <div>
                              <label className="block text-[10px] font-semibold text-orange-600 dark:text-orange-400 mb-0.5">
                                Work (sec, 0=Reps)
                              </label>
                              <input
                                type="number"
                                min={0}
                                max={3600}
                                value={
                                  timerDraftInputs.workSec !== undefined
                                    ? timerDraftInputs.workSec
                                    : String(editingPreset.defaultTimer?.workSec ?? 60)
                                }
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  setTimerDraftInputs((prev) => ({ ...prev, workSec: raw }));
                                  if (raw !== '') {
                                    const parsed = parseInt(raw, 10);
                                    const workSec = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
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
                                  }
                                }}
                                onBlur={() => {
                                  if (timerDraftInputs.workSec !== undefined) {
                                    const parsed = parseInt(timerDraftInputs.workSec, 10);
                                    const workSec = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
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
                                    setTimerDraftInputs((prev) => ({ ...prev, workSec: undefined }));
                                  }
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
                                value={
                                  timerDraftInputs.restSec !== undefined
                                    ? timerDraftInputs.restSec
                                    : String(editingPreset.defaultTimer?.restSec ?? 0)
                                }
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  setTimerDraftInputs((prev) => ({ ...prev, restSec: raw }));
                                  if (raw !== '') {
                                    const parsed = parseInt(raw, 10);
                                    const restSec = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
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
                                  }
                                }}
                                onBlur={() => {
                                  if (timerDraftInputs.restSec !== undefined) {
                                    const parsed = parseInt(timerDraftInputs.restSec, 10);
                                    const restSec = Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
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
                                    setTimerDraftInputs((prev) => ({ ...prev, restSec: undefined }));
                                  }
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
                                ? 'Rest timer pill & auto-countdown disabled.'
                                : 'Standard straight-set logging with rest countdown between sets.'}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Exercises List */}
              <div className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                {(() => {
                  const isMobCategory = /^(mobility|yoga)$/i.test(
                    (editingPreset.workoutType || '').trim()
                  );
                  const addExerciseToPreset = () => {
                    const newEx: PresetExercise = isMobCategory
                      ? {
                          exerciseUuid: `ex-${uuidv4()}`,
                          exerciseName: '',
                          category: editingPreset.workoutType || 'Mobility',
                          trackingType: 'mobility',
                          loadType: 'none',
                          defaultWeight: 0,
                          defaultSets: 1,
                          defaultReps: '',
                          defaultDurationMin: 0,
                        }
                      : {
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
                  };

                  return (
                    <>
                      <div className="sticky top-0 z-10 flex items-center justify-between py-2 -mx-1 px-1 bg-white/95 dark:bg-slate-900/95 backdrop-blur-sm border-b border-slate-100/80 dark:border-slate-800/80">
                        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                          Exercises ({editingPreset.exercises.length})
                        </label>
                        <button
                          type="button"
                          onClick={addExerciseToPreset}
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

                  const toggleGroupWithAbove = (idx: number) => {
                    if (idx <= 0) return;
                    const next = [...editingPreset.exercises];
                    const curr = next[idx];
                    const prev = next[idx - 1];
                    const alreadyGrouped = Boolean(
                      curr.groupId && prev.groupId && curr.groupId === prev.groupId
                    );

                    if (alreadyGrouped) {
                      const oldGid = curr.groupId;
                      next[idx] = { ...curr, groupId: undefined };
                      // Clean up orphan groupId if only 1 consecutive item remains in that run
                      const remainingWithOldGid = next.filter((e) => e.groupId === oldGid);
                      if (remainingWithOldGid.length < 2) {
                        for (let k = 0; k < next.length; k++) {
                          if (next[k].groupId === oldGid) {
                            next[k] = { ...next[k], groupId: undefined };
                          }
                        }
                      }
                    } else {
                      const gid = prev.groupId || `grp-${uuidv4().slice(0, 8)}`;
                      next[idx - 1] = { ...prev, groupId: gid };
                      next[idx] = { ...curr, groupId: gid };
                    }
                    setEditingPreset({ ...editingPreset, exercises: next });
                  };

                  const renderPresetExerciseCard = (
                    pe: PresetExercise,
                    idx: number,
                    stepBadge?: string
                  ) => {
                    const prevEx = idx > 0 ? editingPreset.exercises[idx - 1] : undefined;
                    const isGroupedWithAbove = Boolean(
                      pe.groupId && prevEx?.groupId && pe.groupId === prevEx.groupId
                    );
                    const hasNonDefaultMore = Boolean(
                      (pe.repScheme && pe.repScheme.schemeType !== 'fixed') ||
                        pe.side ||
                        pe.isPerSide
                    );
                    const isMoreOpen =
                      expandedExerciseMore[idx] !== undefined
                        ? expandedExerciseMore[idx]
                        : hasNonDefaultMore;

                    return (
                      <div
                        key={idx}
                        className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`min-w-[1.5rem] h-6 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 tabular-nums ${
                              stepBadge || isSequenceMode
                                ? 'bg-orange-500 text-white'
                                : 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                            }`}
                          >
                            {stepBadge || idx + 1}
                          </span>

                          {pe.trackingType === 'mobility' ? (
                            <textarea
                              rows={2}
                              value={pe.exerciseName}
                              placeholder="Flow / Movement Sequence (e.g. 90/90 Hip Switch → Shin Box Reach)"
                              onChange={(e) => {
                                const name = e.target.value;
                                const next = [...editingPreset.exercises];
                                next[idx] = {
                                  ...pe,
                                  exerciseName: name,
                                };
                                setEditingPreset({ ...editingPreset, exercises: next });
                              }}
                              className="min-w-0 w-full sm:flex-1 px-3 py-2 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:border-orange-500 resize-y"
                            />
                          ) : (
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
                                const inferredMetric =
                                  matchedGlobal?.metricType || inferDefaultMetricType(name);
                                const next = [...editingPreset.exercises];
                                next[idx] = {
                                  ...pe,
                                  exerciseName: name,
                                  exerciseUuid: matchedGlobal?.exerciseUuid || pe.exerciseUuid,
                                  category: matchedGlobal?.category || pe.category,
                                  metricType:
                                    inferredMetric !== 'reps'
                                      ? inferredMetric
                                      : pe.metricType || 'reps',
                                };
                                setEditingPreset({ ...editingPreset, exercises: next });
                              }}
                              className="min-w-0 w-full sm:w-auto sm:flex-1 px-3 py-2 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 focus:outline-none focus:border-orange-500"
                            />
                          )}

                          <select
                            value={pe.trackingType}
                            title="Exercise Tracking Format"
                            onChange={(e) => {
                              const nextType = e.target.value as TrackingType;
                              const next = [...editingPreset.exercises];
                              next[idx] = {
                                ...pe,
                                trackingType: nextType,
                                ...(nextType === 'mobility'
                                  ? {
                                      loadType: 'none',
                                      defaultWeight: 0,
                                      defaultDurationMin: pe.defaultDurationMin ?? 0,
                                    }
                                  : {}),
                              };
                              setEditingPreset({ ...editingPreset, exercises: next });
                            }}
                            className="px-2.5 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                          >
                            <option value="strength">Strength / Sets</option>
                            <option value="circuit">Circuit / Timed</option>
                            <option value="cardio">Cardio / Distance</option>
                            <option value="mobility">Mobility / Flow</option>
                          </select>

                          <div className="flex items-center gap-0.5 ml-auto">
                            {idx > 0 && (
                              <button
                                type="button"
                                onClick={() => toggleGroupWithAbove(idx)}
                                data-tooltip={
                                  isGroupedWithAbove
                                    ? 'Ungroup from exercise above'
                                    : 'Group with exercise above (Superset / Tri-Set / Giant Set)'
                                }
                                title={
                                  isGroupedWithAbove
                                    ? 'Ungroup from exercise above'
                                    : 'Group with exercise above'
                                }
                                className={`px-2 py-1 rounded-lg text-[10px] font-bold inline-flex items-center gap-1 border transition-colors ${
                                  isGroupedWithAbove
                                    ? 'bg-orange-500 text-white border-orange-500'
                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-orange-500 hover:text-orange-500'
                                }`}
                              >
                                <Link2 className="w-3 h-3" />
                                <span>{isGroupedWithAbove ? 'Ungroup' : 'Group'}</span>
                              </button>
                            )}
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

                        {pe.trackingType === 'mobility' ? (
                          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 items-end">
                            <div className="sm:col-span-3">
                              <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">
                                Duration (min)
                              </label>
                              <input
                                type="number"
                                min={0}
                                value={pe.defaultDurationMin === undefined ? '' : pe.defaultDurationMin}
                                placeholder="0 (un-timed)"
                                onChange={(e) => {
                                  const raw = e.target.value;
                                  const parsed = raw === '' ? undefined : Math.max(0, parseInt(raw, 10) || 0);
                                  const next = [...editingPreset.exercises];
                                  next[idx] = { ...pe, defaultDurationMin: parsed };
                                  setEditingPreset({ ...editingPreset, exercises: next });
                                }}
                                onBlur={() => {
                                  if (pe.defaultDurationMin === undefined) {
                                    const next = [...editingPreset.exercises];
                                    next[idx] = { ...pe, defaultDurationMin: 0 };
                                    setEditingPreset({ ...editingPreset, exercises: next });
                                  }
                                }}
                                className="w-full px-2.5 py-1.5 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                              />
                            </div>
                            <div className="sm:col-span-3">
                              <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">
                                Side
                              </label>
                              <div className="flex items-center gap-1">
                                {(['', 'L/R'] as Array<'' | ExerciseSide>).map((sOpt) => (
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
                                    className={`flex-1 px-2 py-1.5 rounded-xl text-[11px] font-bold transition-colors ${
                                      (pe.side || '') === sOpt
                                        ? 'bg-orange-500 text-white'
                                        : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500'
                                    }`}
                                  >
                                    {sOpt || 'None'}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <div className="sm:col-span-6">
                              <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">
                                Flow Cues / Sequence Notes
                              </label>
                              <input
                                type="text"
                                value={pe.baseNotes || ''}
                                placeholder="e.g. 5 slow breaths per side, keep ribs down..."
                                onChange={(e) => {
                                  const next = [...editingPreset.exercises];
                                  next[idx] = { ...pe, baseNotes: e.target.value };
                                  setEditingPreset({ ...editingPreset, exercises: next });
                                }}
                                className="w-full px-2.5 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                              />
                            </div>
                          </div>
                        ) : pe.trackingType === 'cardio' ? (
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
                          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
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
                                className="w-full px-2 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                              >
                                <option value="single_kg">1x Single (kg)</option>
                                <option value="double_kg">2x Double (kg)</option>
                                <option value="offset_kg">Offset / Uneven (kg)</option>
                                <option value="bw_plus_kg">BW + Weight (kg)</option>
                                <option value="bodyweight">Bodyweight (BW)</option>
                                <option value="none">No Load</option>
                              </select>
                            </div>

                            <div>
                              <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">
                                Metric
                              </label>
                              <select
                                value={pe.metricType || 'reps'}
                                onChange={(e) => {
                                  const next = [...editingPreset.exercises];
                                  next[idx] = {
                                    ...pe,
                                    metricType: e.target.value as ExerciseMetricType,
                                  };
                                  setEditingPreset({ ...editingPreset, exercises: next });
                                }}
                                className="w-full px-2 py-1.5 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                              >
                                <option value="reps">Reps</option>
                                <option value="distance">Distance (m)</option>
                                <option value="time">Time (s)</option>
                              </select>
                            </div>

                            {pe.loadType === 'offset_kg' ? (
                              <div className="col-span-2 sm:col-span-1 grid grid-cols-2 gap-1.5">
                                <div>
                                  <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">
                                    Weight A (kg)
                                  </label>
                                  <input
                                    type="number"
                                    step="0.5"
                                    min={0}
                                    value={pe.defaultWeight}
                                    onChange={(e) => {
                                      const next = [...editingPreset.exercises];
                                      next[idx] = {
                                        ...pe,
                                        defaultWeight: parseFloat(e.target.value) || 0,
                                      };
                                      setEditingPreset({ ...editingPreset, exercises: next });
                                    }}
                                    className="w-full px-1.5 py-1.5 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center"
                                  />
                                </div>
                                <div>
                                  <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">
                                    Weight B (kg)
                                  </label>
                                  <input
                                    type="number"
                                    step="0.5"
                                    min={0}
                                    value={pe.secondaryWeightKg ?? 0}
                                    onChange={(e) => {
                                      const next = [...editingPreset.exercises];
                                      next[idx] = {
                                        ...pe,
                                        secondaryWeightKg: parseFloat(e.target.value) || 0,
                                      };
                                      setEditingPreset({ ...editingPreset, exercises: next });
                                    }}
                                    className="w-full px-1.5 py-1.5 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center"
                                  />
                                </div>
                              </div>
                            ) : (
                              <div>
                                <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">
                                  Weight (kg)
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
                                  className="w-full px-2 py-1.5 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-40"
                                />
                              </div>
                            )}

                            {isSequenceMode ? (
                              <div>
                                <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">
                                  Rounds (Synced)
                                </label>
                                <div className="px-2 py-1.5 text-xs font-mono font-bold rounded-xl border border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400 text-center">
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
                                  className="w-full px-2 py-1.5 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                                />
                              </div>
                            )}

                            <div>
                              <label className="block text-[10px] font-semibold text-slate-400 mb-0.5">
                                {(pe.metricType || 'reps') === 'distance'
                                  ? 'Target Distance (m)'
                                  : (pe.metricType || 'reps') === 'time'
                                  ? 'Target Time (s)'
                                  : isSequenceMode
                                  ? 'Reps / Round'
                                  : 'Target Reps'}
                              </label>
                              <input
                                type="text"
                                value={pe.defaultReps}
                                placeholder={
                                  (pe.metricType || 'reps') === 'distance'
                                    ? 'e.g. 40'
                                    : (pe.metricType || 'reps') === 'time'
                                    ? 'e.g. 45'
                                    : isSequenceMode
                                    ? 'e.g. 2'
                                    : 'e.g. 10 or AMRAP'
                                }
                                onChange={(e) => {
                                  const next = [...editingPreset.exercises];
                                  next[idx] = { ...pe, defaultReps: e.target.value };
                                  setEditingPreset({ ...editingPreset, exercises: next });
                                }}
                                className="w-full px-2 py-1.5 text-xs font-mono font-bold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                              />
                            </div>
                          </div>
                        )}

                        {/* Compact "More" Disclosure for Rep Scheme, Side & Per Side */}
                        {pe.trackingType !== 'cardio' && pe.trackingType !== 'mobility' && (() => {
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
                            <div className="pt-1">
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedExerciseMore((prev) => ({
                                    ...prev,
                                    [idx]: !isMoreOpen,
                                  }))
                                }
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-orange-500 transition-colors"
                              >
                                {isMoreOpen ? (
                                  <ChevronUp className="w-3.5 h-3.5" />
                                ) : (
                                  <ChevronDown className="w-3.5 h-3.5" />
                                )}
                                <span>More</span>
                                {hasNonDefaultMore && !isMoreOpen && (
                                  <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                                )}
                              </button>

                              {isMoreOpen && (
                                <div className="mt-2 space-y-2.5 pt-2 border-t border-slate-200/50 dark:border-slate-700/50">
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
                                      {(['', 'L', 'R', 'L/R'] as Array<'' | ExerciseSide>).map(
                                        (sOpt) => (
                                          <button
                                            key={sOpt || 'none'}
                                            type="button"
                                            onClick={() => {
                                              const next = [...editingPreset.exercises];
                                              next[idx] = {
                                                ...pe,
                                                side: sOpt ? sOpt : undefined,
                                              };
                                              setEditingPreset({
                                                ...editingPreset,
                                                exercises: next,
                                              });
                                            }}
                                            className={`px-2 py-0.5 rounded-lg text-[10px] font-bold transition-colors ${
                                              (pe.side || '') === sOpt
                                                ? 'bg-orange-500 text-white'
                                                : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-500'
                                            }`}
                                          >
                                            {sOpt || 'None'}
                                          </button>
                                        )
                                      )}
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
                              )}
                            </div>
                          );
                        })()}
                      </div>
                    );
                  };

                  const groupedChunks = groupConsecutiveExercises(editingPreset.exercises);

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

                      {groupedChunks.map((chunk, cIdx) => {
                        if (chunk.type === 'single') {
                          return renderPresetExerciseCard(chunk.item, chunk.originalIdx);
                        }
                        return (
                          <div
                            key={`${chunk.groupId}-${cIdx}`}
                            className="rounded-2xl border border-orange-500/30 border-l-4 border-l-orange-500 bg-orange-500/[0.03] p-3 space-y-2.5"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <span className="px-2 py-0.5 rounded-md bg-orange-500 text-white text-[10px] font-extrabold tracking-wider uppercase">
                                {chunk.label}
                              </span>
                              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                                No rest between exercises — rest after final exercise
                              </span>
                            </div>
                            <div className="space-y-2.5">
                              {chunk.items.map(({ item, originalIdx, stepCode }) =>
                                renderPresetExerciseCard(item, originalIdx, stepCode)
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}

                      <button
                        type="button"
                        onClick={addExerciseToPreset}
                        className="w-full py-2.5 rounded-2xl border-2 border-dashed border-orange-500/35 bg-orange-500/[0.04] hover:bg-orange-500/10 hover:border-orange-500/60 text-orange-600 dark:text-orange-400 text-xs font-bold transition-colors"
                      >
                        + Add Exercise
                      </button>
                    </>
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
                onClick={closePresetEditorModal}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  upsertPreset(editingPreset);
                  const savedTitle = editingPreset.title;
                  closePresetEditorModal();
                  showToast(`Saved "${savedTitle}"!`);
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

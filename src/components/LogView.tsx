import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Plus,
  Minus,
  Check,
  History,
  Sparkles,
  Link2,
  RefreshCw,
  Trash2,
  Dumbbell,
  Timer,
  Flame,
  CheckCircle2,
  XCircle,
  Search,
  SlidersHorizontal,
  ArrowRightLeft,
  Save,
  MoreHorizontal,
  AlertTriangle,
  Pencil,
} from 'lucide-react';
import { DraftWorkoutCard, useWorkoutStore } from '../store/useWorkoutStore';
import {
  CardioMode,
  DistanceUnit,
  LoadType,
  LoggedExercise,
  TrackingType,
} from '../types/workout';
import {
  buildLadderWorkoutSets,
  expandLadderSequence,
  formatExerciseMetricSummary,
  formatLoadBadge,
  formatPace,
  formatReadableDate,
  formatSecondsAsMmSs,
  getTodayIsoDate,
  groupConsecutiveExercises,
  inferDefaultMetricType,
  parseMmSsToSeconds,
  recalculateLoggedExercise,
  shiftIsoDate,
  slugify,
  uuidv4,
} from '../utils/calculations';
import { ExerciseHistoryModal } from './ExerciseHistoryModal';

const LOAD_TYPE_OPTIONS: Array<{ value: LoadType; label: string }> = [
  { value: 'single_kg', label: '1x Single (kg)' },
  { value: 'double_kg', label: '2x Double (kg)' },
  { value: 'offset_kg', label: 'Offset / Uneven (kg)' },
  { value: 'bw_plus_kg', label: 'BW + Load (kg)' },
  { value: 'ruck_kg', label: 'Ruck Load (kg)' },
  { value: 'bodyweight', label: 'Bodyweight (BW)' },
  { value: 'none', label: 'No Load' },
];

const CARDIO_MODES: CardioMode[] = ['Ruck', 'Cycle', 'Run', 'Row', 'Swim', 'Other'];

export const LogView: React.FC = () => {
  const {
    activeDate,
    draftWorkouts,
    logLayoutMode,
    logDensityMode,
    presets,
    exercises: globalExercises,
    schedules,
    meta,
    setActiveDate,
    loadProgrammedForDate,
    addWorkoutToSession,
    updateDraftWorkout,
    removeDraftWorkout,
    saveDraftWorkout,
    getGhostExerciseData,
    startRestTimer,
    startCircuitTimer,
    setTimerRounds,
    upsertGlobalExercise,
  } = useWorkoutStore();

  const [collapsedCards, setCollapsedCards] = useState<Record<string, boolean>>({});
  const [collapsedGuidance, setCollapsedGuidance] = useState<Record<string, boolean>>({});
  const [expandedCompactExercises, setExpandedCompactExercises] = useState<
    Record<string, boolean>
  >({});
  const [activeCardIdx, setActiveCardIdx] = useState<number>(0);
  const [editMenuOpen, setEditMenuOpen] = useState<boolean>(false);
  const editMenuRef = useRef<HTMLDivElement>(null);
  const touchStartXRef = useRef<number | null>(null);

  useEffect(() => {
    if (!editMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (editMenuRef.current && !editMenuRef.current.contains(e.target as Node)) {
        setEditMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [editMenuOpen]);

  // Keep activeCardIdx in bounds when draftWorkouts length changes
  useEffect(() => {
    if (activeCardIdx >= draftWorkouts.length && draftWorkouts.length > 0) {
      setActiveCardIdx(draftWorkouts.length - 1);
    }
  }, [draftWorkouts.length, activeCardIdx]);

  const [presetPickerModal, setPresetPickerModal] = useState<{
    open: boolean;
    mode: 'add' | 'chain' | 'swap';
    replaceLogUuid?: string;
  }>({ open: false, mode: 'add' });

  const [filterByActiveProgram, setFilterByActiveProgram] = useState<boolean>(true);
  const [selectedTag, setSelectedTag] = useState<string>('ALL');
  const [presetSearch, setPresetSearch] = useState<string>('');

  const [historyModalState, setHistoryModalState] = useState<{
    exerciseUuid: string | null;
    exerciseName: string;
    presetUuid?: string;
  }>({ exerciseUuid: null, exerciseName: '' });

  const [exercisePickerModal, setExercisePickerModal] = useState<{
    open: boolean;
    logUuid: string;
    swapExerciseIndex?: number;
  }>({ open: false, logUuid: '' });
  const [exerciseSearch, setExerciseSearch] = useState('');
  const [newCustomExerciseName, setNewCustomExerciseName] = useState('');
  const [newCustomTrackingType, setNewCustomTrackingType] = useState<TrackingType>('strength');

  const [activeSetOverrideKey, setActiveSetOverrideKey] = useState<string | null>(null);

  const [toastState, setToastState] = useState<{ msg: string; isError?: boolean } | null>(null);
  const triggerToast = (msg: string, isError = false) => {
    setToastState({ msg, isError });
    setTimeout(() => setToastState(null), isError ? 4500 : 2600);
  };

  const todayIso = getTodayIsoDate();
  const isToday = activeDate === todayIso;
  const scheduledForActiveDate = schedules[activeDate]?.items || [];

  const allTags = useMemo(() => {
    const set = new Set<string>();
    presets.forEach((p) => p.tags?.forEach((t) => set.add(t)));
    return ['ALL', ...Array.from(set)];
  }, [presets]);

  const filteredPresets = useMemo(() => {
    return presets.filter((p) => {
      if (
        filterByActiveProgram &&
        meta.activeProgramUuid &&
        p.programIds?.length > 0 &&
        !p.programIds.includes(meta.activeProgramUuid)
      ) {
        return false;
      }
      if (selectedTag !== 'ALL' && !p.tags?.includes(selectedTag)) {
        return false;
      }
      if (presetSearch.trim()) {
        const q = presetSearch.toLowerCase();
        const matchTitle = p.title.toLowerCase().includes(q);
        const matchType = p.workoutType.toLowerCase().includes(q);
        const matchEx = p.exercises.some((e) => e.exerciseName.toLowerCase().includes(q));
        return matchTitle || matchType || matchEx;
      }
      return true;
    });
  }, [presets, filterByActiveProgram, meta.activeProgramUuid, selectedTag, presetSearch]);

  const isWorkoutMinimized = (d: DraftWorkoutCard): boolean => {
    if (collapsedCards[d.logUuid] !== undefined) {
      return collapsedCards[d.logUuid];
    }
    return Boolean(d.isSaved && d.status === 'completed');
  };

  const toggleCollapse = (logUuid: string, currentlyMinimized: boolean) => {
    setCollapsedCards((prev) => ({ ...prev, [logUuid]: !currentlyMinimized }));
  };

  const getWorkoutSummaryMetric = (d: DraftWorkoutCard): string => {
    if (d.totalSessionVolumeKg > 0) {
      return `${d.totalSessionVolumeKg.toLocaleString()} kg total`;
    }
    const cardioDur = d.exercises.reduce(
      (sum, ex) => sum + (Number(ex.durationSec) || Number(ex.totalDurationSec) || 0),
      0
    );
    const durSec = cardioDur > 0 ? cardioDur : Number(d.durationSec) || 0;
    if (durSec > 0) {
      return `${formatSecondsAsMmSs(durSec)} total`;
    }
    return '0 kg total';
  };

  const openSwitchWorkoutPicker = () => {
    if (draftWorkouts.length === 0) {
      setPresetPickerModal({ open: true, mode: 'add' });
      return;
    }
    const targetDraft =
      logLayoutMode === 'cards'
        ? draftWorkouts[Math.min(activeCardIdx, draftWorkouts.length - 1)]
        : draftWorkouts.find((d) => !isWorkoutMinimized(d)) || draftWorkouts[0];
    setPresetPickerModal({
      open: true,
      mode: 'swap',
      replaceLogUuid: targetDraft.logUuid,
    });
  };

  const handleSetRepChange = (
    draft: DraftWorkoutCard,
    exIdx: number,
    setIdx: number,
    rawVal: string
  ) => {
    const reps = rawVal === '' ? 0 : Math.max(0, parseInt(rawVal, 10) || 0);
    updateDraftWorkout(draft.logUuid, (curr) => {
      const nextExs = [...curr.exercises];
      const targetEx = { ...nextExs[exIdx] };
      const nextSets = [...(targetEx.sets || [])];
      nextSets[setIdx] = {
        ...nextSets[setIdx],
        setNumber: setIdx + 1,
        reps,
      };
      targetEx.sets = nextSets;
      nextExs[exIdx] = targetEx;
      return { ...curr, exercises: nextExs };
    });

    const currentEx = draft.exercises[exIdx];
    const nextEx = draft.exercises[exIdx + 1];
    const isIntermediateInGroup = Boolean(
      currentEx?.groupId && nextEx?.groupId && currentEx.groupId === nextEx.groupId
    );
    if (reps > 0 && meta.defaultAutoStartRestTimer && !isIntermediateInGroup) {
      const preset = presets.find((p) => p.presetUuid === draft.presetUuid);
      const restSec = preset?.defaultTimer
        ? Math.max(0, Number(preset.defaultTimer.restSec ?? 0))
        : 60;
      if (restSec > 0) {
        startRestTimer(restSec);
      }
    }
  };

  const handleSetWeightOverrideChange = (
    draft: DraftWorkoutCard,
    exIdx: number,
    setIdx: number,
    rawVal: string
  ) => {
    const parsed = rawVal.trim() === '' ? undefined : Math.max(0, parseFloat(rawVal));
    updateDraftWorkout(draft.logUuid, (curr) => {
      const nextExs = [...curr.exercises];
      const targetEx = { ...nextExs[exIdx] };
      const nextSets = [...(targetEx.sets || [])];
      nextSets[setIdx] = {
        ...nextSets[setIdx],
        weightOverride: parsed !== undefined && !Number.isNaN(parsed) ? parsed : undefined,
      };
      targetEx.sets = nextSets;
      nextExs[exIdx] = targetEx;
      return { ...curr, exercises: nextExs };
    });
  };

  const handleAddSetBox = (draft: DraftWorkoutCard, exIdx: number, ghostRepFallback = 0) => {
    updateDraftWorkout(draft.logUuid, (curr) => {
      const nextExs = [...curr.exercises];
      const targetEx = { ...nextExs[exIdx] };
      const existingSets = targetEx.sets || [];
      const lastSet = existingSets[existingSets.length - 1];
      targetEx.sets = [
        ...existingSets,
        {
          setNumber: existingSets.length + 1,
          reps: lastSet?.reps || ghostRepFallback || 0,
          weightOverride: lastSet?.weightOverride,
        },
      ];
      nextExs[exIdx] = targetEx;
      return { ...curr, exercises: nextExs };
    });
  };

  const handleRemoveLastSetBox = (draft: DraftWorkoutCard, exIdx: number) => {
    updateDraftWorkout(draft.logUuid, (curr) => {
      const nextExs = [...curr.exercises];
      const targetEx = { ...nextExs[exIdx] };
      if ((targetEx.sets || []).length <= 1) return curr;
      targetEx.sets = targetEx.sets.slice(0, -1);
      nextExs[exIdx] = targetEx;
      return { ...curr, exercises: nextExs };
    });
  };

  const handleAcceptGhostForExercise = (
    draft: DraftWorkoutCard,
    exIdx: number,
    ghostEx: LoggedExercise
  ) => {
    updateDraftWorkout(draft.logUuid, (curr) => {
      const nextExs = [...curr.exercises];
      const targetEx = { ...nextExs[exIdx] };

      if (targetEx.trackingType === 'cardio') {
        targetEx.mode = ghostEx.mode || targetEx.mode;
        targetEx.durationSec = ghostEx.durationSec;
        targetEx.distance = ghostEx.distance;
        targetEx.distanceUnit = ghostEx.distanceUnit || targetEx.distanceUnit || 'mi';
        targetEx.ruckLoadKg = ghostEx.ruckLoadKg ?? targetEx.ruckLoadKg;
        targetEx.avgHr = ghostEx.avgHr;
      } else {
        targetEx.weight = ghostEx.weight;
        targetEx.secondaryWeightKg = ghostEx.secondaryWeightKg;
        targetEx.loadType = ghostEx.loadType;
        targetEx.rir = ghostEx.rir;
        targetEx.roundsCompleted = ghostEx.roundsCompleted ?? targetEx.roundsCompleted;
        targetEx.workSecPerRound = ghostEx.workSecPerRound ?? targetEx.workSecPerRound;
        targetEx.restSecPerRound = ghostEx.restSecPerRound ?? targetEx.restSecPerRound;
        if (ghostEx.sets && ghostEx.sets.length > 0) {
          targetEx.sets = ghostEx.sets.map((gs, idx) => ({
            setNumber: idx + 1,
            reps: gs.reps,
            weightOverride: gs.weightOverride,
          }));
        }
      }

      nextExs[exIdx] = targetEx;
      return { ...curr, exercises: nextExs };
    });
    triggerToast(`Filled ghost targets from last ${ghostEx.exerciseName} session`);
  };

  // Determine which workout cards to render based on List vs Swipeable Cards mode
  const visibleWorkouts = useMemo(() => {
    if (logLayoutMode === 'list' || draftWorkouts.length === 0) {
      return draftWorkouts.map((d, idx) => ({ draft: d, originalIdx: idx }));
    }
    const safeIdx = Math.min(activeCardIdx, draftWorkouts.length - 1);
    return [{ draft: draftWorkouts[safeIdx], originalIdx: safeIdx }];
  }, [logLayoutMode, draftWorkouts, activeCardIdx]);

  return (
    <div className="space-y-4 pb-40 md:pb-24 min-w-0 max-w-full">
      {/* Toast Notification */}
      {toastState && (
        <div
          className={`fixed top-16 left-1/2 -translate-x-1/2 z-50 max-w-[92vw] px-4 py-2 rounded-2xl text-white text-xs font-bold shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-top-2 ${
            toastState.isError
              ? 'bg-rose-600 dark:bg-rose-600'
              : 'bg-slate-900 dark:bg-orange-500'
          }`}
        >
          {toastState.isError ? (
            <AlertTriangle className="w-4 h-4 shrink-0 text-white" />
          ) : (
            <CheckCircle2 className="w-4 h-4 shrink-0 text-orange-400 dark:text-white" />
          )}
          <span className="truncate">{toastState.msg}</span>
        </div>
      )}

      {/* Top Date & Session Control Bar */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-3 sm:px-4 sm:py-3 border border-slate-200/70 dark:border-slate-800/80">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* Date Stepper + Today + Minimal Edit Popover */}
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <button
              type="button"
              onClick={() => setActiveDate(shiftIsoDate(activeDate, -1))}
              data-tooltip="Previous Day"
              title="Previous Day"
              className="p-2 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <label
              title="Click to pick another date"
              className="relative flex items-center gap-2 px-3 py-2 rounded-2xl bg-slate-100/80 hover:bg-slate-200/70 dark:bg-slate-800 dark:hover:bg-slate-700 cursor-pointer transition-colors"
            >
              <Calendar className="w-4 h-4 text-orange-500 shrink-0" />
              <div className="text-left">
                <div className="text-xs font-display font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                  {formatReadableDate(activeDate)}
                  {isToday && (
                    <span className="px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded-md bg-orange-500 text-white">
                      Today
                    </span>
                  )}
                </div>
              </div>
              <input
                type="date"
                value={activeDate}
                onChange={(e) => e.target.value && setActiveDate(e.target.value)}
                className="sr-only"
              />
            </label>

            <button
              type="button"
              onClick={() => setActiveDate(shiftIsoDate(activeDate, 1))}
              data-tooltip="Next Day"
              title="Next Day"
              className="p-2 rounded-2xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            {!isToday && (
              <button
                type="button"
                data-tooltip="Jump back to Today"
                title="Jump back to Today"
                onClick={() => setActiveDate(todayIso)}
                className="px-2.5 py-1.5 rounded-xl text-xs font-semibold text-orange-600 dark:text-orange-400 bg-orange-500/10 hover:bg-orange-500/20 transition-colors"
              >
                Today
              </button>
            )}

            {/* Compact Edit Session Popover matching Today pill height */}
            <div ref={editMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setEditMenuOpen((prev) => !prev)}
                aria-label="Edit Workout Session"
                aria-expanded={editMenuOpen}
                data-tooltip="Load, switch, or add workouts"
                title="Load, switch, or add workouts"
                className={`px-2.5 py-1.5 rounded-xl border transition-colors inline-flex items-center gap-1 text-xs font-semibold ${
                  editMenuOpen
                    ? 'bg-orange-500 text-white border-orange-500'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border-slate-200/60 dark:border-slate-700/60 text-slate-700 dark:text-slate-200'
                }`}
              >
                <Pencil className="w-3.5 h-3.5" />
                <span>Edit</span>
              </button>

              {editMenuOpen && (
                <div className="absolute left-0 top-full mt-2 w-56 max-w-[calc(100vw-2rem)] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xl p-1.5 space-y-1 z-40">
                  <button
                    type="button"
                    onClick={() => {
                      setEditMenuOpen(false);
                      const count = loadProgrammedForDate(activeDate);
                      if (count > 0) {
                        triggerToast(`Loaded ${count} scheduled workout(s)`);
                      } else if (scheduledForActiveDate.length > 0) {
                        triggerToast('Today’s scheduled workouts are already loaded');
                      } else {
                        triggerToast('No workouts scheduled on this date — pick a workout!');
                        setPresetPickerModal({ open: true, mode: 'add' });
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl text-left text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-orange-500/10 hover:text-orange-600 dark:hover:text-orange-400 flex items-center justify-between gap-2 transition-colors"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                      Load Today&apos;s Plan
                    </span>
                    {scheduledForActiveDate.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-600 dark:text-orange-400 text-[10px] font-mono tabular-nums">
                        {scheduledForActiveDate.length}
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEditMenuOpen(false);
                      openSwitchWorkoutPicker();
                    }}
                    className="w-full px-3 py-2 rounded-xl text-left text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                    Switch Workout
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setEditMenuOpen(false);
                      setPresetPickerModal({
                        open: true,
                        mode: draftWorkouts.length > 0 ? 'chain' : 'add',
                      });
                    }}
                    className="w-full px-3 py-2 rounded-xl text-left text-xs font-semibold text-orange-600 dark:text-orange-400 hover:bg-orange-500/10 flex items-center gap-2 transition-colors"
                  >
                    <Link2 className="w-3.5 h-3.5 shrink-0" />
                    + Add Workout
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Compact inline action only when date has zero workouts AND no plan scheduled */}
          {draftWorkouts.length === 0 && scheduledForActiveDate.length === 0 && (
            <button
              type="button"
              onClick={() => setPresetPickerModal({ open: true, mode: 'add' })}
              className="px-3 py-1.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold inline-flex items-center gap-1 transition-colors shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Workout
            </button>
          )}
        </div>
      </div>

      {/* Empty State */}
      {draftWorkouts.length === 0 ? (
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-200/80 dark:border-slate-800 text-center space-y-4">
          <div className="w-14 h-14 rounded-3xl bg-orange-500/10 text-orange-500 flex items-center justify-center mx-auto">
            <Dumbbell className="w-7 h-7" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h2 className="font-display font-bold text-lg text-slate-900 dark:text-slate-100">
              Ready on the Gym Floor
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Load your scheduled training for {formatReadableDate(activeDate)}, or launch any
              workout from your library.
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2 pt-1">
            {scheduledForActiveDate.length > 0 && (
              <button
                type="button"
                onClick={() => loadProgrammedForDate(activeDate)}
                className="px-4 py-2.5 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm"
              >
                <Sparkles className="w-4 h-4" />
                Load {scheduledForActiveDate.length} Scheduled Workout(s)
              </button>
            )}
            <button
              type="button"
              onClick={() => setPresetPickerModal({ open: true, mode: 'add' })}
              className="px-4 py-2.5 rounded-2xl bg-slate-900 dark:bg-slate-800 hover:bg-slate-800 text-white text-xs font-bold flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4 text-orange-400" />
              Choose Workout
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* SWIPEABLE CARDS DECK HEADER (Shown when logLayoutMode === 'cards') */}
          {logLayoutMode === 'cards' && (
            <div className="bg-white dark:bg-slate-900 rounded-2xl px-3 py-2 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={activeCardIdx === 0}
                onClick={() => setActiveCardIdx((i) => Math.max(0, i - 1))}
                data-tooltip="Previous Workout Card"
                title="Previous Workout Card"
                className="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold flex items-center gap-1 disabled:opacity-35 hover:bg-orange-500 hover:text-white transition-colors shrink-0"
              >
                <ChevronLeft className="w-4 h-4" /> Prev
              </button>

              <div className="flex items-center gap-1.5 overflow-x-auto py-0.5 min-w-0 flex-1">
                {draftWorkouts.map((d, idx) => (
                  <button
                    key={d.logUuid}
                    type="button"
                    onClick={() => setActiveCardIdx(idx)}
                    className={`px-2.5 py-1 rounded-xl text-xs font-bold whitespace-nowrap transition-all flex items-center gap-1 shrink-0 ${
                      idx === activeCardIdx
                        ? 'bg-orange-500 text-white shadow-2xs'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    <span className="truncate max-w-[130px]">
                      {idx + 1}. {d.workoutTitleSnapshot}
                    </span>
                    {d.isSaved && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                ))}
              </div>

              <button
                type="button"
                disabled={activeCardIdx >= draftWorkouts.length - 1}
                onClick={() =>
                  setActiveCardIdx((i) => Math.min(draftWorkouts.length - 1, i + 1))
                }
                data-tooltip="Next Workout Card"
                title="Next Workout Card"
                className="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold flex items-center gap-1 disabled:opacity-35 hover:bg-orange-500 hover:text-white transition-colors shrink-0"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Workout Cards Container (Supports horizontal swipe in Cards mode) */}
          <div
            onTouchStart={(e) => {
              if (logLayoutMode !== 'cards') return;
              touchStartXRef.current = e.touches[0].clientX;
            }}
            onTouchEnd={(e) => {
              if (logLayoutMode !== 'cards' || touchStartXRef.current === null) return;
              const deltaX = e.changedTouches[0].clientX - touchStartXRef.current;
              if (deltaX < -60 && activeCardIdx < draftWorkouts.length - 1) {
                setActiveCardIdx((i) => i + 1);
              } else if (deltaX > 60 && activeCardIdx > 0) {
                setActiveCardIdx((i) => i - 1);
              }
              touchStartXRef.current = null;
            }}
            className="space-y-4"
          >
            {visibleWorkouts.map(({ draft, originalIdx: cardIdx }) => {
              const isCollapsed = isWorkoutMinimized(draft);
              const preset = presets.find((p) => p.presetUuid === draft.presetUuid);

              if (isCollapsed) {
                return (
                  <div
                    key={draft.logUuid}
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleCollapse(draft.logUuid, true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleCollapse(draft.logUuid, true);
                      }
                    }}
                    title="Tap to expand workout details & sets"
                    className={`rounded-3xl bg-white dark:bg-slate-900 border transition-all overflow-hidden cursor-pointer ${
                      draft.isSaved && draft.status === 'completed'
                        ? 'border-emerald-500/35 dark:border-emerald-500/25 hover:border-emerald-500/60'
                        : 'border-slate-200/70 dark:border-slate-800/80 hover:border-orange-500/50'
                    }`}
                  >
                    <div className="p-3.5 sm:px-5 bg-slate-50/50 dark:bg-slate-800/30 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                          <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg bg-orange-500/12 text-orange-600 dark:text-orange-400">
                            {draft.slotRole || `Workout #${cardIdx + 1}`}
                          </span>
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            {draft.workoutType}
                          </span>
                          <span className="font-mono text-[10px] font-medium px-1.5 py-0.5 rounded-md text-slate-400 dark:text-slate-500 tabular-nums">
                            #{draft.displayId.replace(/^ID-/i, '')}
                          </span>
                          {draft.isSaved ? (
                            <span
                              className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg ${
                                draft.status === 'completed'
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              }`}
                            >
                              <CheckCircle2 className="w-3 h-3" />
                              {draft.status === 'completed' ? 'Saved' : 'Incomplete'}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                              <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                              In Progress
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <span
                            className="p-1.5 rounded-xl text-slate-500 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                            aria-label="Expand workout"
                          >
                            <ChevronDown className="w-4 h-4" />
                          </span>
                          <button
                            type="button"
                            data-tooltip="Remove workout from today's session"
                            title="Remove workout from today's session"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeDraftWorkout(draft.logUuid);
                            }}
                            className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h2 className="font-display font-extrabold text-base sm:text-lg text-slate-900 dark:text-slate-100 truncate">
                          {draft.workoutTitleSnapshot}
                        </h2>
                        <span className="text-xs font-mono font-bold text-orange-600 dark:text-orange-400 tabular-nums shrink-0">
                          {getWorkoutSummaryMetric(draft)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={draft.logUuid}
                  className={`rounded-3xl bg-white dark:bg-slate-900 border transition-all overflow-hidden ${
                    draft.isSaved
                      ? draft.status === 'completed'
                        ? 'border-emerald-500/35 dark:border-emerald-500/25'
                        : 'border-amber-500/35'
                      : 'border-slate-200/70 dark:border-slate-800/80'
                  }`}
                >
                  {/* Workout Card Header */}
                  <div className="p-3.5 sm:px-5 bg-slate-50/50 dark:bg-slate-800/30 border-b border-slate-200/50 dark:border-slate-800/70 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                        <span className="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-lg bg-orange-500/12 text-orange-600 dark:text-orange-400">
                          {draft.slotRole || `Workout #${cardIdx + 1}`}
                        </span>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-lg bg-slate-200/60 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                          {draft.workoutType}
                        </span>
                        <span className="font-mono text-[10px] font-medium px-1.5 py-0.5 rounded-md text-slate-400 dark:text-slate-500 tabular-nums">
                          #{draft.displayId.replace(/^ID-/i, '')}
                        </span>
                        {draft.isSaved ? (
                          <span
                            className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-lg ${
                              draft.status === 'completed'
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {draft.status === 'completed' ? 'Saved' : 'Incomplete'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                            In Progress
                          </span>
                        )}
                      </div>

                      {/* Header Right Actions */}
                      <div className="flex items-center gap-1">
                        {preset?.defaultTimer &&
                          (preset.defaultTimer.mode === 'circuit' ||
                            (Number(preset.defaultTimer.restSec) || 0) > 0) && (
                            <button
                              type="button"
                              data-tooltip="Load preset timer settings into live timer"
                              title="Load preset timer settings into live timer"
                              onClick={() => {
                                if (preset.defaultTimer?.mode === 'circuit') {
                                  startCircuitTimer(
                                    preset.defaultTimer.rounds ?? 15,
                                    preset.defaultTimer.workSec ?? 60,
                                    preset.defaultTimer.restSec ?? 0
                                  );
                                } else {
                                  startRestTimer(preset.defaultTimer?.restSec || 0);
                                }
                                triggerToast(`Loaded ${preset.title} timer`);
                              }}
                              className="px-2.5 py-1.5 rounded-xl bg-orange-500/10 hover:bg-orange-500 hover:text-white text-orange-600 dark:text-orange-400 text-[11px] font-bold inline-flex items-center gap-1 transition-colors"
                            >
                              <Timer className="w-3.5 h-3.5" />
                              <span>
                                {preset.defaultTimer.mode === 'circuit'
                                  ? (preset.defaultTimer.workSec ?? 60) === 0
                                    ? `${preset.defaultTimer.rounds ?? 0} rnds · ${
                                        (preset.defaultTimer.restSec ?? 0) === 0
                                          ? 'No Rest'
                                          : `${preset.defaultTimer.restSec}s rest`
                                      }`
                                    : `${preset.defaultTimer.rounds ?? 15}×${
                                        preset.defaultTimer.workSec ?? 60
                                      }s/${preset.defaultTimer.restSec ?? 0}s`
                                  : `${preset.defaultTimer.restSec}s Rest`}
                              </span>
                            </button>
                          )}

                        <button
                          type="button"
                          data-tooltip="Swap this workout with another preset"
                          title="Swap this workout with another preset"
                          onClick={() =>
                            setPresetPickerModal({
                              open: true,
                              mode: 'swap',
                              replaceLogUuid: draft.logUuid,
                            })
                          }
                          className="p-1.5 rounded-xl text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
                        >
                          <ArrowRightLeft className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          data-tooltip="Remove workout from today's session"
                          title="Remove workout from today's session"
                          onClick={() => removeDraftWorkout(draft.logUuid)}
                          className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>

                        <button
                          type="button"
                          data-tooltip="Minimize workout card"
                          title="Minimize workout card"
                          onClick={() => toggleCollapse(draft.logUuid, false)}
                          className="p-1.5 rounded-xl text-slate-500 hover:bg-slate-200/60 dark:hover:bg-slate-800"
                        >
                          <ChevronUp className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    {/* Full-Width Workout Title Row */}
                    <div
                      onClick={() => toggleCollapse(draft.logUuid, false)}
                      className="flex flex-wrap items-baseline justify-between gap-2 cursor-pointer select-none"
                    >
                      <h2 className="font-display font-extrabold text-lg sm:text-xl text-slate-900 dark:text-slate-100">
                        {draft.workoutTitleSnapshot}
                      </h2>
                      <span className="text-xs font-mono font-bold text-orange-600 dark:text-orange-400 tabular-nums">
                        {getWorkoutSummaryMetric(draft)}
                      </span>
                    </div>

                    {/* Collapsible Workout Guidance, Target Range & Scheduled Coach Notes Banner */}
                    {(preset?.workoutNotes ||
                      draft.coachNotes ||
                      preset?.defaultTimer?.targetRange) && (
                      <div className="rounded-2xl bg-orange-500/10 border border-orange-500/20 text-xs text-orange-950 dark:text-orange-200 overflow-hidden">
                        <button
                          type="button"
                          onClick={() =>
                            setCollapsedGuidance((prev) => ({
                              ...prev,
                              [draft.logUuid]: !prev[draft.logUuid],
                            }))
                          }
                          className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left font-bold"
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <Sparkles className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                            <span className="truncate">Workout Guidance & Target</span>
                            {preset?.defaultTimer?.targetRange && (
                              <span className="px-1.5 py-0.5 rounded-md bg-orange-500/20 text-orange-700 dark:text-orange-300 text-[10px] font-mono shrink-0">
                                {preset.defaultTimer.targetRange}
                              </span>
                            )}
                          </div>
                          {collapsedGuidance[draft.logUuid] ? (
                            <ChevronDown className="w-4 h-4 text-orange-500 shrink-0" />
                          ) : (
                            <ChevronUp className="w-4 h-4 text-orange-500 shrink-0" />
                          )}
                        </button>

                        {!collapsedGuidance[draft.logUuid] && (
                          <div className="px-3 pb-2.5 space-y-1.5 text-xs border-t border-orange-500/15 pt-1.5">
                            {preset?.workoutNotes && (
                              <p className="leading-relaxed opacity-90">{preset.workoutNotes}</p>
                            )}
                            {draft.coachNotes && (
                              <p className="leading-relaxed">
                                <span className="font-bold text-orange-700 dark:text-orange-300">
                                  Session Target:{' '}
                                </span>
                                {draft.coachNotes}
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Collapsible Body */}
                  {!isCollapsed && (
                    <div className="p-4 sm:p-5 space-y-4">
                      {/* WORKOUT-LEVEL ROUNDS / LADDER BAR */}
                      {(() => {
                        const hasLadderExercises = draft.exercises.some(
                          (ex) => ex.repScheme && ex.repScheme.schemeType !== 'fixed'
                        );
                        const isRoundsWorkout =
                          hasLadderExercises ||
                          draft.formatMode === 'emom_complex' ||
                          draft.formatMode === 'circuit' ||
                          preset?.formatMode === 'emom_complex' ||
                          preset?.formatMode === 'circuit';

                        if (!isRoundsWorkout) return null;

                        const mode =
                          draft.formatMode ||
                          preset?.formatMode ||
                          (hasLadderExercises
                            ? 'emom_complex'
                            : preset?.defaultTimer?.restSec === 0
                            ? 'emom_complex'
                            : 'circuit');

                        const ladderEx = draft.exercises.find(
                          (ex) => ex.repScheme && ex.repScheme.schemeType !== 'fixed'
                        );
                        const refSeq = ladderEx
                          ? expandLadderSequence(
                              ladderEx.repScheme!.ladderStart ?? 10,
                              ladderEx.repScheme!.ladderEnd ?? 1,
                              ladderEx.repScheme!.ladderStep ?? 1,
                              ladderEx.repScheme!.schemeType
                            )
                          : [];
                        const refRungCount = refSeq.length || 10;
                        const refTotalReps = refSeq.reduce((a, b) => a + b, 0);

                        const targetRounds =
                          draft.targetRounds ??
                          (hasLadderExercises
                            ? refRungCount
                            : preset?.defaultTimer?.rounds ?? 10);
                        const completedRounds = draft.completedRounds ?? 0;
                        const isMultiLadderMode =
                          draft.laddersCompleted !== undefined ||
                          draft.extraRungs !== undefined;
                        const laddersCompleted = draft.laddersCompleted ?? 0;
                        const extraRungs = draft.extraRungs ?? 0;

                        const syncComplexCompletedRounds = (nextCompleted: number) => {
                          const clamped = Math.max(0, nextCompleted);
                          updateDraftWorkout(draft.logUuid, (curr) => ({
                            ...curr,
                            completedRounds: clamped,
                            laddersCompleted: undefined,
                            extraRungs: undefined,
                            exercises: curr.exercises.map((ex) => {
                              if (ex.trackingType === 'cardio') return ex;
                              return {
                                ...ex,
                                roundsCompleted: clamped,
                                sets: buildLadderWorkoutSets(ex, {
                                  completedRungs: clamped,
                                  ladderLength: refRungCount,
                                }),
                              };
                            }),
                          }));
                        };

                        const syncMultiLadder = (nextLadders: number, nextExtra: number) => {
                          const cleanLadders = Math.max(0, nextLadders);
                          const cleanExtra = Math.max(
                            0,
                            Math.min(refRungCount - 1, nextExtra)
                          );
                          updateDraftWorkout(draft.logUuid, (curr) => ({
                            ...curr,
                            laddersCompleted: cleanLadders,
                            extraRungs: cleanExtra,
                            completedRounds: cleanLadders * refRungCount + cleanExtra,
                            exercises: curr.exercises.map((ex) => {
                              if (ex.trackingType === 'cardio') return ex;
                              return {
                                ...ex,
                                roundsCompleted: cleanLadders * refRungCount + cleanExtra,
                                sets: buildLadderWorkoutSets(ex, {
                                  laddersCompleted: cleanLadders,
                                  extraRungs: cleanExtra,
                                  ladderLength: refRungCount,
                                }),
                              };
                            }),
                          }));
                        };

                        const updateTargetRounds = (nextTarget: number) => {
                          const clamped = Math.max(1, Math.min(100, nextTarget));
                          setTimerRounds(clamped);
                          updateDraftWorkout(draft.logUuid, (curr) => ({
                            ...curr,
                            targetRounds: clamped,
                            exercises:
                              mode === 'circuit'
                                ? curr.exercises.map((ex) => {
                                    if (ex.trackingType === 'cardio') return ex;
                                    const existing = ex.sets || [];
                                    const resized = Array.from(
                                      { length: clamped },
                                      (_, i) => ({
                                        setNumber: i + 1,
                                        reps: existing[i]?.reps || 0,
                                        weightOverride: existing[i]?.weightOverride,
                                      })
                                    );
                                    return {
                                      ...ex,
                                      roundsCompleted: clamped,
                                      sets: resized,
                                    };
                                  })
                                : curr.exercises,
                          }));
                        };

                        return (
                          <div className="p-3.5 rounded-2xl bg-slate-900 dark:bg-slate-800/80 text-white border border-slate-700/80 space-y-2.5">
                            {/* Top Ladder Info + Single vs Multi-Ladder Switch */}
                            {hasLadderExercises && (
                              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-700/70">
                                <span className="text-[11px] font-mono font-bold text-orange-400">
                                  Ladder: {refSeq[0]} → {refSeq[refSeq.length - 1]} •{' '}
                                  {refRungCount} rungs ({refTotalReps} reps/ladder)
                                </span>
                                <div className="inline-flex rounded-lg bg-slate-800 dark:bg-slate-900 p-0.5 border border-slate-700">
                                  <button
                                    type="button"
                                    onClick={() => syncComplexCompletedRounds(completedRounds)}
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-colors ${
                                      !isMultiLadderMode
                                        ? 'bg-orange-500 text-white'
                                        : 'text-slate-400 hover:text-white'
                                    }`}
                                  >
                                    Single Ladder
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => syncMultiLadder(laddersCompleted || 1, 0)}
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold transition-colors ${
                                      isMultiLadderMode
                                        ? 'bg-orange-500 text-white'
                                        : 'text-slate-400 hover:text-white'
                                    }`}
                                  >
                                    Multi-Ladder (AMRAP)
                                  </button>
                                </div>
                              </div>
                            )}

                            <div className="flex flex-wrap items-center justify-between gap-3">
                              {/* Target Rounds Stepper (hidden in Multi-Ladder AMRAP) */}
                              {!isMultiLadderMode && (
                                <div className="flex items-center gap-2">
                                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                    {hasLadderExercises ? 'Target Rungs' : 'Target Rounds'}
                                  </span>
                                  <div className="inline-flex items-center rounded-xl bg-slate-800 dark:bg-slate-900 border border-slate-700 p-0.5">
                                    <button
                                      type="button"
                                      onClick={() => updateTargetRounds(targetRounds - 1)}
                                      className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-300"
                                    >
                                      <Minus className="w-3.5 h-3.5" />
                                    </button>
                                    <span className="px-2.5 font-mono text-sm font-bold tabular-nums">
                                      {targetRounds}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() => updateTargetRounds(targetRounds + 1)}
                                      className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-300"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              )}

                              {/* Multi-Ladder Counter OR Single-Pass Rungs/Rounds Counter */}
                              {hasLadderExercises && isMultiLadderMode ? (
                                <div className="flex flex-wrap items-center gap-3 w-full justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[11px] font-bold uppercase tracking-wider text-orange-400">
                                      Ladders Completed
                                    </span>
                                    <div className="inline-flex items-center rounded-xl bg-slate-800 dark:bg-slate-900 border border-orange-500/40 p-0.5">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          syncMultiLadder(laddersCompleted - 1, extraRungs)
                                        }
                                        className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-300"
                                      >
                                        <Minus className="w-3.5 h-3.5" />
                                      </button>
                                      <span className="px-3 font-mono text-sm font-extrabold tabular-nums text-orange-400">
                                        {laddersCompleted}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          syncMultiLadder(laddersCompleted + 1, extraRungs)
                                        }
                                        className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-300"
                                      >
                                        <Plus className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2">
                                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                                      + Extra Rungs
                                    </span>
                                    <div className="inline-flex items-center rounded-xl bg-slate-800 dark:bg-slate-900 border border-slate-700 p-0.5">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          syncMultiLadder(laddersCompleted, extraRungs - 1)
                                        }
                                        className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-300"
                                      >
                                        <Minus className="w-3.5 h-3.5" />
                                      </button>
                                      <span className="px-2.5 font-mono text-sm font-bold tabular-nums">
                                        {extraRungs}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          syncMultiLadder(laddersCompleted, extraRungs + 1)
                                        }
                                        className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-300"
                                      >
                                        <Plus className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                    {extraRungs > 0 && (
                                      <span className="text-[10px] font-mono text-orange-300">
                                        (+{refSeq.slice(0, extraRungs).join(', ')})
                                      </span>
                                    )}
                                  </div>
                                </div>
                              ) : mode === 'emom_complex' || hasLadderExercises ? (
                                <div className="flex flex-wrap items-center gap-2 ml-auto">
                                  <span className="text-[11px] font-bold uppercase tracking-wider text-orange-400">
                                    {hasLadderExercises ? 'Rungs Completed' : 'Completed'}
                                  </span>
                                  <div className="inline-flex items-center rounded-xl bg-slate-800 dark:bg-slate-900 border border-orange-500/40 p-0.5">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        syncComplexCompletedRounds(completedRounds - 1)
                                      }
                                      className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-300"
                                    >
                                      <Minus className="w-3.5 h-3.5" />
                                    </button>
                                    <span className="px-3 font-mono text-sm font-extrabold tabular-nums text-orange-400">
                                      {completedRounds} / {targetRounds}
                                    </span>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        syncComplexCompletedRounds(completedRounds + 1)
                                      }
                                      className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-300"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                    </button>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() => syncComplexCompletedRounds(targetRounds)}
                                    className="px-3 py-1.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-1 shadow-sm transition-colors"
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                    {hasLadderExercises ? 'Complete Ladder' : 'Complete All'}
                                  </button>
                                </div>
                              ) : (
                                <div className="text-xs font-semibold text-orange-400 ml-auto flex items-center gap-1.5">
                                  <Flame className="w-4 h-4" />
                                  AMRAP Circuit ({targetRounds} Rounds)
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Exercise List */}
                      <div className="space-y-3.5">
                        {(() => {
                          const renderLoggedExerciseCard = (
                            ex: LoggedExercise,
                            exIdx: number,
                            stepBadge?: string
                          ) => {
                            const ghost = getGhostExerciseData(
                              draft.presetUuid,
                              ex.exerciseUuid,
                              draft.logUuid
                            );
                            const ghostEx = ghost?.exercise;
                            const workoutHasLadder = draft.exercises.some(
                              (e) => e.repScheme && e.repScheme.schemeType !== 'fixed'
                            );
                            const effectiveFormatMode =
                              draft.formatMode ||
                              preset?.formatMode ||
                              (workoutHasLadder
                                ? 'emom_complex'
                                : preset?.defaultTimer?.mode === 'circuit'
                                ? preset.defaultTimer.restSec === 0
                                  ? 'emom_complex'
                                  : 'circuit'
                                : 'standard');
                            const isComplexMode =
                              (effectiveFormatMode === 'emom_complex' || workoutHasLadder) &&
                              ex.trackingType !== 'cardio';
                            const isCircuitMode =
                              effectiveFormatMode === 'circuit' &&
                              !workoutHasLadder &&
                              ex.trackingType !== 'cardio';
                            const exKey = `${draft.logUuid}_${exIdx}`;
                            const isCompactCard =
                              logDensityMode === 'compact' &&
                              !expandedCompactExercises[exKey] &&
                              ex.trackingType !== 'cardio';

                            if (isCompactCard) {
                              return (
                                <div
                                  key={`${ex.exerciseUuid}-${exIdx}`}
                                  className="p-2.5 sm:p-3 rounded-2xl bg-slate-50/60 dark:bg-slate-800/25 border border-slate-200/60 dark:border-slate-800/70 space-y-2 min-w-0"
                                >
                                  {/* Single-Line Compact Header */}
                                  <div className="flex items-center justify-between gap-1.5 min-w-0">
                                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                      <span
                                        className={`min-w-[1.25rem] h-5 px-1 rounded-full text-[10px] font-bold flex items-center justify-center shrink-0 tabular-nums ${
                                          stepBadge
                                            ? 'bg-orange-500 text-white'
                                            : 'bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100'
                                        }`}
                                      >
                                        {stepBadge || exIdx + 1}
                                      </span>
                                    {ex.side && (
                                      <span className="px-1.5 py-0.5 rounded bg-orange-500 text-white text-[9px] font-bold shrink-0">
                                        {ex.side}
                                      </span>
                                    )}
                                    <h3 className="font-display font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                                      {ex.exerciseName}
                                    </h3>
                                    {ex.isPerSide && (
                                      <span className="text-[10px] font-mono font-bold text-orange-500 shrink-0">
                                        ×2
                                      </span>
                                    )}
                                  </div>

                                  <div className="flex items-center gap-1 shrink-0">
                                    {/* Inline Weight Pill */}
                                    {ex.loadType === 'bodyweight' || ex.loadType === 'none' ? (
                                      <span className="px-2 py-0.5 rounded-lg bg-slate-200/70 dark:bg-slate-800 text-[11px] font-mono font-semibold text-slate-600 dark:text-slate-300">
                                        {ex.loadType === 'bodyweight' ? 'BW' : '—'}
                                      </span>
                                    ) : ex.loadType === 'offset_kg' ? (
                                      <div className="inline-flex items-center px-1.5 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 text-[11px] font-mono font-bold">
                                        <input
                                          type="number"
                                          step="0.5"
                                          min={0}
                                          title="Weight A (kg)"
                                          value={ex.weight || ''}
                                          placeholder={String(ghostEx?.weight ?? 16)}
                                          onChange={(e) => {
                                            const val = parseFloat(e.target.value) || 0;
                                            updateDraftWorkout(draft.logUuid, (curr) => {
                                              const next = [...curr.exercises];
                                              next[exIdx] = { ...next[exIdx], weight: val };
                                              return { ...curr, exercises: next };
                                            });
                                          }}
                                          className="w-8 bg-transparent text-center text-slate-900 dark:text-slate-100 focus:outline-none tabular-nums"
                                        />
                                        <span className="text-orange-500">+</span>
                                        <input
                                          type="number"
                                          step="0.5"
                                          min={0}
                                          title="Weight B (kg)"
                                          value={ex.secondaryWeightKg ?? ''}
                                          placeholder={String(ghostEx?.secondaryWeightKg ?? 20)}
                                          onChange={(e) => {
                                            const val = parseFloat(e.target.value) || 0;
                                            updateDraftWorkout(draft.logUuid, (curr) => {
                                              const next = [...curr.exercises];
                                              next[exIdx] = {
                                                ...next[exIdx],
                                                secondaryWeightKg: val,
                                              };
                                              return { ...curr, exercises: next };
                                            });
                                          }}
                                          className="w-8 bg-transparent text-center text-slate-900 dark:text-slate-100 focus:outline-none tabular-nums"
                                        />
                                        <span className="text-slate-400 text-[10px]">kg</span>
                                      </div>
                                    ) : (
                                      <label className="inline-flex items-center px-1.5 py-0.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-700 text-[11px] font-mono font-bold">
                                        {ex.loadType === 'double_kg' && (
                                          <span className="text-orange-500 mr-0.5">2×</span>
                                        )}
                                        <input
                                          type="number"
                                          step="0.5"
                                          min={0}
                                          title="Weight (kg)"
                                          value={ex.weight || ''}
                                          placeholder={String(ghostEx?.weight ?? 16)}
                                          onChange={(e) => {
                                            const val = parseFloat(e.target.value) || 0;
                                            updateDraftWorkout(draft.logUuid, (curr) => {
                                              const next = [...curr.exercises];
                                              next[exIdx] = { ...next[exIdx], weight: val };
                                              return { ...curr, exercises: next };
                                            });
                                          }}
                                          className="w-9 bg-transparent text-center text-slate-900 dark:text-slate-100 focus:outline-none tabular-nums"
                                        />
                                        <span className="text-slate-400 text-[10px]">kg</span>
                                      </label>
                                    )}

                                    {ghostEx && (
                                      <button
                                        type="button"
                                        data-tooltip="Fill sets & weight from your last session"
                                        title="Fill sets & weight from your last session"
                                        onClick={() =>
                                          handleAcceptGhostForExercise(draft, exIdx, ghostEx)
                                        }
                                        className="px-1.5 py-1 rounded-lg bg-orange-500/10 hover:bg-orange-500 text-orange-600 dark:text-orange-400 hover:text-white text-[10px] font-bold inline-flex items-center gap-0.5 transition-colors"
                                      >
                                        <Check className="w-3 h-3" />
                                        <span className="hidden sm:inline">Fill Last</span>
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      data-tooltip="View past performances of this exercise"
                                      title="View past performances of this exercise"
                                      onClick={() =>
                                        setHistoryModalState({
                                          exerciseUuid: ex.exerciseUuid,
                                          exerciseName: ex.exerciseName,
                                          presetUuid: draft.presetUuid,
                                        })
                                      }
                                      className="p-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700 text-slate-500 hover:text-orange-500 transition-colors"
                                    >
                                      <History className="w-3.5 h-3.5" />
                                    </button>

                                    <button
                                      type="button"
                                      data-tooltip="Expand exercise details & notes"
                                      title="Expand exercise details & notes"
                                      onClick={() =>
                                        setExpandedCompactExercises((prev) => ({
                                          ...prev,
                                          [exKey]: true,
                                        }))
                                      }
                                      className="p-1 rounded-lg bg-white dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700 text-slate-500 hover:text-orange-500 transition-colors"
                                    >
                                      <MoreHorizontal className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                {/* Compact Sets / Complex / Ladder Row */}
                                {isComplexMode ? (
                                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                    {ex.repScheme && ex.repScheme.schemeType !== 'fixed' ? (
                                      <div className="flex items-center gap-1.5 font-mono text-[11px]">
                                        <span className="px-1.5 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 font-bold">
                                          {ex.repScheme.schemeType === 'pyramid'
                                            ? `${ex.repScheme.ladderStart}→${ex.repScheme.ladderEnd}→${ex.repScheme.ladderStart}`
                                            : `${ex.repScheme.ladderStart}→${ex.repScheme.ladderEnd}`}
                                        </span>
                                        <span className="text-slate-500">
                                          {ex.sets.length} rungs •{' '}
                                          <strong className="text-slate-900 dark:text-slate-100">
                                            {ex.totalReps} reps
                                          </strong>
                                        </span>
                                      </div>
                                    ) : (
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-[11px] text-slate-500">Reps/rd:</span>
                                        <input
                                          type="number"
                                          min={1}
                                          value={ex.repsPerRound ?? 1}
                                          onChange={(e) => {
                                            const rpr = Math.max(
                                              1,
                                              parseInt(e.target.value, 10) || 1
                                            );
                                            const completed = draft.completedRounds ?? 0;
                                            updateDraftWorkout(draft.logUuid, (curr) => {
                                              const next = [...curr.exercises];
                                              next[exIdx] = {
                                                ...next[exIdx],
                                                repsPerRound: rpr,
                                                sets: Array.from(
                                                  { length: completed },
                                                  (_, i) => ({
                                                    setNumber: i + 1,
                                                    reps: rpr,
                                                  })
                                                ),
                                              };
                                              return { ...curr, exercises: next };
                                            });
                                          }}
                                          className="w-11 h-8 text-xs font-mono font-bold text-center rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                                        />
                                        <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                                          = {ex.totalReps}r
                                        </span>
                                      </div>
                                    )}

                                    {(ex.metricType === 'distance' || ex.metricType === 'time') && (
                                      <span className="text-[10px] font-mono font-bold text-orange-600 dark:text-orange-400 px-1.5 py-0.5 rounded bg-orange-500/10">
                                        {ex.totalReps > 0
                                          ? formatExerciseMetricSummary(ex)
                                          : ex.metricType === 'distance'
                                          ? 'm'
                                          : 's'}
                                      </span>
                                    )}

                                    <div className="flex items-center gap-1 ml-auto">
                                      <span className="text-[10px] font-mono text-slate-400">
                                        RIR
                                      </span>
                                      <input
                                        type="number"
                                        min={0}
                                        max={10}
                                        value={ex.rir ?? ''}
                                        placeholder={
                                          ghostEx?.rir !== undefined ? String(ghostEx.rir) : '2'
                                        }
                                        onChange={(e) => {
                                          const val =
                                            e.target.value === ''
                                              ? undefined
                                              : Math.max(0, parseInt(e.target.value, 10) || 0);
                                          updateDraftWorkout(draft.logUuid, (curr) => {
                                            const next = [...curr.exercises];
                                            next[exIdx] = { ...next[exIdx], rir: val };
                                            return { ...curr, exercises: next };
                                          });
                                        }}
                                        className="w-9 h-8 rounded-lg text-center font-mono text-xs font-bold tabular-nums bg-amber-500/10 border border-amber-500/25 text-amber-800 dark:text-amber-300 focus:outline-none focus:ring-1 focus:ring-orange-500"
                                      />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    {(ex.sets || []).map((setObj, sIdx) => {
                                      const ghostSet = ghostEx?.sets?.[sIdx];
                                      const ghostRepPlaceholder = ghostSet
                                        ? String(ghostSet.reps)
                                        : ghostEx?.sets?.[0]
                                        ? String(ghostEx.sets[0].reps)
                                        : String(sIdx + 1);
                                      const metricUnit =
                                        ex.metricType === 'distance'
                                          ? 'm'
                                          : ex.metricType === 'time'
                                          ? 's'
                                          : 'reps';
                                      return (
                                        <input
                                          key={sIdx}
                                          type="number"
                                          inputMode="numeric"
                                          min={0}
                                          title={`${isCircuitMode ? 'Round' : 'Set'} ${sIdx + 1} (${metricUnit})`}
                                          value={setObj.reps === 0 ? '' : setObj.reps}
                                          placeholder={ghostRepPlaceholder}
                                          onChange={(e) =>
                                            handleSetRepChange(draft, exIdx, sIdx, e.target.value)
                                          }
                                          className={`w-10 h-9 rounded-xl text-center font-mono text-xs font-bold tabular-nums border transition-all focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                                            setObj.reps > 0
                                              ? 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100'
                                              : 'bg-slate-100/80 dark:bg-slate-900/50 border-dashed border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400/60'
                                          }`}
                                        />
                                      );
                                    })}

                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleAddSetBox(
                                          draft,
                                          exIdx,
                                          ghostEx?.sets?.[0]?.reps || 0
                                        )
                                      }
                                      title="Add Set"
                                      className="w-8 h-9 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-orange-500 hover:text-orange-500 flex items-center justify-center text-slate-400"
                                    >
                                      <Plus className="w-3.5 h-3.5" />
                                    </button>
                                    {(ex.sets || []).length > 1 && (
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveLastSetBox(draft, exIdx)}
                                        title="Remove Last Set"
                                        className="w-7 h-9 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 hover:border-rose-400 hover:text-rose-500 flex items-center justify-center text-slate-400"
                                      >
                                        <Minus className="w-3 h-3" />
                                      </button>
                                    )}

                                    {(ex.metricType === 'distance' || ex.metricType === 'time') && (
                                      <span className="text-[10px] font-mono font-bold text-orange-600 dark:text-orange-400 px-1.5 py-0.5 rounded bg-orange-500/10">
                                        {ex.totalReps > 0
                                          ? formatExerciseMetricSummary(ex)
                                          : ex.metricType === 'distance'
                                          ? 'm'
                                          : 's'}
                                      </span>
                                    )}

                                    <div className="flex items-center gap-1 ml-auto">
                                      <span className="text-[10px] font-mono text-slate-400">
                                        RIR
                                      </span>
                                      <input
                                        type="number"
                                        min={0}
                                        max={10}
                                        title="Reps in Reserve"
                                        value={ex.rir ?? ''}
                                        placeholder={
                                          ghostEx?.rir !== undefined ? String(ghostEx.rir) : '2'
                                        }
                                        onChange={(e) => {
                                          const val =
                                            e.target.value === ''
                                              ? undefined
                                              : Math.max(0, parseInt(e.target.value, 10) || 0);
                                          updateDraftWorkout(draft.logUuid, (curr) => {
                                            const next = [...curr.exercises];
                                            next[exIdx] = { ...next[exIdx], rir: val };
                                            return { ...curr, exercises: next };
                                          });
                                        }}
                                        className="w-9 h-9 rounded-xl text-center font-mono text-xs font-bold tabular-nums bg-amber-500/10 border border-amber-500/25 text-amber-800 dark:text-amber-300 focus:outline-none focus:ring-2 focus:ring-orange-500"
                                      />
                                    </div>
                                  </div>
                                )}
                              </div>
                            );
                          }

                          return (
                            <div
                              key={`${ex.exerciseUuid}-${exIdx}`}
                              className="p-3.5 sm:p-4 rounded-2xl bg-slate-50/70 dark:bg-slate-800/30 border border-slate-200/70 dark:border-slate-800/80 space-y-3"
                            >
                              {/* Exercise Row Header */}
                              <div className="space-y-1.5">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="flex items-center gap-2">
                                    <span
                                      className={`min-w-[1.25rem] h-5 px-1.5 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 tabular-nums ${
                                        stepBadge
                                          ? 'bg-orange-500 text-white'
                                          : 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900'
                                      }`}
                                    >
                                      {stepBadge || exIdx + 1}
                                    </span>
                                    <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-200/80 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                                      {ex.category}
                                    </span>
                                  </div>

                                  {/* Exercise Action Icons */}
                                  <div className="flex items-center gap-1">
                                    {ghostEx && (
                                      <button
                                        type="button"
                                        data-tooltip="Fill sets & weight from your last session"
                                        title="Fill sets & weight from your last session"
                                        onClick={() =>
                                          handleAcceptGhostForExercise(draft, exIdx, ghostEx)
                                        }
                                        className="px-2.5 py-1 rounded-xl bg-orange-500/10 hover:bg-orange-500 text-orange-600 dark:text-orange-400 hover:text-white text-[11px] font-bold inline-flex items-center gap-1 transition-colors"
                                      >
                                        <Check className="w-3.5 h-3.5" />
                                        Fill Last
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      data-tooltip="View past performances of this exercise"
                                      title="View past performances of this exercise"
                                      onClick={() =>
                                        setHistoryModalState({
                                          exerciseUuid: ex.exerciseUuid,
                                          exerciseName: ex.exerciseName,
                                          presetUuid: draft.presetUuid,
                                        })
                                      }
                                      className="p-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-orange-500 hover:text-orange-500 transition-colors"
                                    >
                                      <History className="w-4 h-4" />
                                    </button>

                                    <button
                                      type="button"
                                      data-tooltip="Swap this exercise"
                                      title="Swap this exercise"
                                      onClick={() =>
                                        setExercisePickerModal({
                                          open: true,
                                          logUuid: draft.logUuid,
                                          swapExerciseIndex: exIdx,
                                        })
                                      }
                                      className="p-1.5 rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-slate-900 dark:hover:text-white transition-colors"
                                    >
                                      <ArrowRightLeft className="w-3.5 h-3.5" />
                                    </button>

                                    <button
                                      type="button"
                                      data-tooltip="Remove exercise from this workout"
                                      title="Remove exercise from this workout"
                                      onClick={() =>
                                        updateDraftWorkout(draft.logUuid, (curr) => ({
                                          ...curr,
                                          exercises: curr.exercises.filter((_, i) => i !== exIdx),
                                        }))
                                      }
                                      className="p-1.5 rounded-xl text-slate-400 hover:text-rose-500 transition-colors"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>

                                    {logDensityMode === 'compact' && (
                                      <button
                                        type="button"
                                        data-tooltip="Collapse back to compact row"
                                        title="Collapse back to compact row"
                                        onClick={() =>
                                          setExpandedCompactExercises((prev) => ({
                                            ...prev,
                                            [exKey]: false,
                                          }))
                                        }
                                        className="px-2 py-1 rounded-xl bg-slate-200/70 dark:bg-slate-700/70 text-[10px] font-bold text-slate-600 dark:text-slate-300 hover:text-orange-500 transition-colors"
                                      >
                                        Compact
                                      </button>
                                    )}
                                  </div>
                                </div>

                                <h3 className="font-display font-bold text-base text-slate-900 dark:text-slate-100 flex items-center gap-1.5 flex-wrap">
                                  {ex.side && (
                                    <span className="px-2 py-0.5 rounded-md bg-orange-500 text-white text-[10px] font-bold">
                                      {ex.side}
                                    </span>
                                  )}
                                  <span>{ex.exerciseName}</span>
                                  {ex.isPerSide && (
                                    <span className="px-1.5 py-0.5 rounded-md bg-orange-500/15 text-orange-600 dark:text-orange-400 text-[10px] font-mono font-bold">
                                      ×2 L+R
                                    </span>
                                  )}
                                </h3>

                                {/* Ghost Benchmark Subtitle */}
                                {ghost && ghostEx && (
                                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                                    <span className="font-mono">Last ({ghost.sourceDate}):</span>
                                    {ghostEx.trackingType === 'cardio' ? (
                                      <span className="font-mono font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                                        {ghostEx.distance ?? 0} {ghostEx.distanceUnit || 'mi'} in{' '}
                                        {formatSecondsAsMmSs(ghostEx.durationSec)} (
                                        {formatPace(
                                          ghostEx.paceSecPerUnit,
                                          ghostEx.distanceUnit || 'mi'
                                        )}
                                        )
                                      </span>
                                    ) : (
                                      <span className="font-mono font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                                        {formatLoadBadge(
                                          ghostEx.loadType,
                                          ghostEx.weight,
                                          ghostEx.ruckLoadKg,
                                          ghostEx.secondaryWeightKg
                                        )}{' '}
                                        • [{ghostEx.sets.map((s) => s.reps).join(', ')}]
                                        {ghostEx.rir !== undefined ? ` @ RIR ${ghostEx.rir}` : ''}
                                      </span>
                                    )}
                                  </div>
                                )}
                              </div>

                              {/* STRENGTH / COMPLEX / CIRCUIT ENTRY */}
                              {ex.trackingType !== 'cardio' ? (
                                <div className="space-y-3">
                                  {ex.trackingType === 'circuit' && (
                                    <div className="p-2.5 rounded-xl bg-orange-500/[0.06] border border-orange-500/20 flex flex-wrap items-center gap-3">
                                      <div className="flex items-center gap-1.5 text-xs font-bold text-orange-600 dark:text-orange-400">
                                        <Flame className="w-4 h-4" />
                                        Intervals
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <label className="text-[11px] text-slate-500">Rounds</label>
                                        <input
                                          type="number"
                                          min={1}
                                          value={ex.roundsCompleted || ''}
                                          placeholder={String(ghostEx?.roundsCompleted || 10)}
                                          onChange={(e) => {
                                            const val = parseInt(e.target.value, 10) || 0;
                                            updateDraftWorkout(draft.logUuid, (curr) => {
                                              const next = [...curr.exercises];
                                              next[exIdx] = { ...next[exIdx], roundsCompleted: val };
                                              return { ...curr, exercises: next };
                                            });
                                          }}
                                          className="w-14 px-2 py-1 text-xs font-mono font-bold tabular-nums rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center"
                                        />
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <label className="text-[11px] text-slate-500">Work(s)</label>
                                        <input
                                          type="number"
                                          min={5}
                                          value={ex.workSecPerRound || ''}
                                          placeholder={String(ghostEx?.workSecPerRound || 45)}
                                          onChange={(e) => {
                                            const val = parseInt(e.target.value, 10) || 0;
                                            updateDraftWorkout(draft.logUuid, (curr) => {
                                              const next = [...curr.exercises];
                                              next[exIdx] = { ...next[exIdx], workSecPerRound: val };
                                              return { ...curr, exercises: next };
                                            });
                                          }}
                                          className="w-14 px-2 py-1 text-xs font-mono font-bold tabular-nums rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center"
                                        />
                                      </div>
                                      <div className="flex items-center gap-1.5">
                                        <label className="text-[11px] text-slate-500">Rest(s)</label>
                                        <input
                                          type="number"
                                          min={0}
                                          value={ex.restSecPerRound ?? ''}
                                          placeholder={String(ghostEx?.restSecPerRound ?? 15)}
                                          onChange={(e) => {
                                            const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                                            updateDraftWorkout(draft.logUuid, (curr) => {
                                              const next = [...curr.exercises];
                                              next[exIdx] = { ...next[exIdx], restSecPerRound: val };
                                              return { ...curr, exercises: next };
                                            });
                                          }}
                                          className="w-14 px-2 py-1 text-xs font-mono font-bold tabular-nums rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-center"
                                        />
                                      </div>
                                      <button
                                        type="button"
                                        data-tooltip="Send rounds & intervals to the live timer"
                                        title="Send rounds & intervals to the live timer"
                                        onClick={() =>
                                          startCircuitTimer(
                                            ex.roundsCompleted || 10,
                                            ex.workSecPerRound || 45,
                                            ex.restSecPerRound ?? 15
                                          )
                                        }
                                        className="ml-auto px-2.5 py-1 rounded-lg bg-orange-500 text-white text-[11px] font-bold flex items-center gap-1"
                                      >
                                        <Timer className="w-3 h-3" /> Start Timer
                                      </button>
                                    </div>
                                  )}

                                  <div className="space-y-2.5">
                                    {/* Top Row: Load & Base Weight + RIR Box */}
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                      <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 p-1.5 rounded-2xl border border-slate-200 dark:border-slate-700">
                                        <select
                                          value={ex.loadType}
                                          title="Change load style"
                                          onChange={(e) => {
                                            const newLoadType = e.target.value as LoadType;
                                            updateDraftWorkout(draft.logUuid, (curr) => {
                                              const next = [...curr.exercises];
                                              next[exIdx] = {
                                                ...next[exIdx],
                                                loadType: newLoadType,
                                                weight:
                                                  newLoadType === 'bodyweight' ||
                                                  newLoadType === 'none'
                                                    ? 0
                                                    : next[exIdx].weight,
                                              };
                                              return { ...curr, exercises: next };
                                            });
                                          }}
                                          className="text-xs font-semibold bg-transparent text-slate-700 dark:text-slate-200 focus:outline-none pr-1"
                                        >
                                          {LOAD_TYPE_OPTIONS.map((opt) => (
                                            <option
                                              key={opt.value}
                                              value={opt.value}
                                              className="bg-white dark:bg-slate-900"
                                            >
                                              {opt.label}
                                            </option>
                                          ))}
                                        </select>

                                        {ex.loadType === 'offset_kg' ? (
                                          <div className="relative flex items-center gap-1">
                                            <input
                                              type="number"
                                              step="0.5"
                                              min={0}
                                              title="Weight A (kg)"
                                              value={ex.weight || ''}
                                              placeholder={String(ghostEx?.weight ?? 16)}
                                              onChange={(e) => {
                                                const val = parseFloat(e.target.value) || 0;
                                                updateDraftWorkout(draft.logUuid, (curr) => {
                                                  const next = [...curr.exercises];
                                                  next[exIdx] = { ...next[exIdx], weight: val };
                                                  return { ...curr, exercises: next };
                                                });
                                              }}
                                              className="w-12 px-1.5 py-1 text-xs font-mono font-bold tabular-nums text-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400/70 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                                            />
                                            <span className="text-[11px] font-mono font-bold text-orange-500">
                                              +
                                            </span>
                                            <input
                                              type="number"
                                              step="0.5"
                                              min={0}
                                              title="Weight B (kg)"
                                              value={ex.secondaryWeightKg ?? ''}
                                              placeholder={String(
                                                ghostEx?.secondaryWeightKg ?? 20
                                              )}
                                              onChange={(e) => {
                                                const val = parseFloat(e.target.value) || 0;
                                                updateDraftWorkout(draft.logUuid, (curr) => {
                                                  const next = [...curr.exercises];
                                                  next[exIdx] = {
                                                    ...next[exIdx],
                                                    secondaryWeightKg: val,
                                                  };
                                                  return { ...curr, exercises: next };
                                                });
                                              }}
                                              className="w-12 px-1.5 py-1 text-xs font-mono font-bold tabular-nums text-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400/70 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                                            />
                                            <span className="text-[11px] font-mono text-slate-400 pr-1">
                                              kg
                                            </span>
                                          </div>
                                        ) : (
                                          ex.loadType !== 'bodyweight' &&
                                          ex.loadType !== 'none' && (
                                            <div className="relative flex items-center">
                                              {ex.loadType === 'double_kg' && (
                                                <span className="text-[11px] font-mono font-bold text-orange-500 mr-1">
                                                  2×
                                                </span>
                                              )}
                                              <input
                                                type="number"
                                                step="0.5"
                                                min={0}
                                                title="Base exercise weight (kg)"
                                                value={ex.weight || ''}
                                                placeholder={String(ghostEx?.weight ?? 16)}
                                                onChange={(e) => {
                                                  const val = parseFloat(e.target.value) || 0;
                                                  updateDraftWorkout(draft.logUuid, (curr) => {
                                                    const next = [...curr.exercises];
                                                    next[exIdx] = { ...next[exIdx], weight: val };
                                                    return { ...curr, exercises: next };
                                                  });
                                                }}
                                                className="w-14 px-1.5 py-1 text-xs font-mono font-bold tabular-nums text-center rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400/70 focus:ring-2 focus:ring-orange-500 focus:outline-none"
                                              />
                                              <span className="text-[11px] font-mono text-slate-400 ml-1 pr-1">
                                                kg
                                              </span>
                                            </div>
                                          )
                                        )}
                                      </div>

                                      {/* Compact RIR & Per-Side (x2) Toggle */}
                                      <div className="flex items-center gap-2 ml-auto">
                                        <button
                                          type="button"
                                          data-tooltip="Unilateral Per Side (×2 L+R)"
                                          title="Toggle Per Side (×2 L+R) calculation"
                                          onClick={() => {
                                            updateDraftWorkout(draft.logUuid, (curr) => {
                                              const next = [...curr.exercises];
                                              next[exIdx] = {
                                                ...next[exIdx],
                                                isPerSide: !next[exIdx].isPerSide,
                                              };
                                              return { ...curr, exercises: next };
                                            });
                                          }}
                                          className={`px-2 py-1.5 rounded-xl text-[11px] font-bold border transition-colors ${
                                            ex.isPerSide
                                              ? 'bg-orange-500 text-white border-orange-500 shadow-2xs'
                                              : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-500 hover:border-orange-500'
                                          }`}
                                        >
                                          ×2 L+R
                                        </button>

                                        <div className="flex items-center gap-1.5">
                                          <span
                                            title="Reps in Reserve after your last set"
                                            className="text-[11px] font-mono font-semibold text-slate-400"
                                          >
                                            RIR
                                          </span>
                                          <input
                                            type="number"
                                            min={0}
                                            max={10}
                                            title="Reps in Reserve (how many more reps you could have done)"
                                            value={ex.rir ?? ''}
                                            placeholder={
                                              ghostEx?.rir !== undefined ? String(ghostEx.rir) : '2'
                                            }
                                            onChange={(e) => {
                                              const val =
                                                e.target.value === ''
                                                  ? undefined
                                                  : Math.max(0, parseInt(e.target.value, 10) || 0);
                                              updateDraftWorkout(draft.logUuid, (curr) => {
                                                const next = [...curr.exercises];
                                                next[exIdx] = { ...next[exIdx], rir: val };
                                                return { ...curr, exercises: next };
                                              });
                                            }}
                                            className="w-12 h-9 rounded-xl text-center font-mono text-xs font-bold tabular-nums bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-300 placeholder:text-amber-500/50 focus:outline-none focus:ring-2 focus:ring-orange-500"
                                          />
                                        </div>
                                      </div>
                                    </div>

                                    {/* COMPLEX / LADDER SINGLE ROW vs DYNAMIC SET BOXES */}
                                    {isComplexMode ? (
                                      ex.repScheme && ex.repScheme.schemeType !== 'fixed' ? (
                                        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-orange-500/30">
                                          <div className="flex flex-wrap items-center gap-1.5">
                                            <span className="px-2 py-0.5 rounded-md bg-orange-500/15 text-orange-600 dark:text-orange-400 text-[11px] font-mono font-bold">
                                              {ex.repScheme.schemeType === 'pyramid'
                                                ? `${ex.repScheme.ladderStart}→${ex.repScheme.ladderEnd}→${ex.repScheme.ladderStart}`
                                                : `${ex.repScheme.ladderStart}→${ex.repScheme.ladderEnd}`}
                                            </span>
                                            <span className="text-[11px] font-mono text-slate-500 truncate max-w-[200px]">
                                              {ex.sets.length > 0
                                                ? `[${ex.sets.map((s) => s.reps).join(', ')}]`
                                                : '0 rungs logged'}
                                            </span>
                                          </div>

                                          <span className="text-xs font-mono text-slate-500 tabular-nums ml-auto">
                                            {ex.sets.length} rungs ={' '}
                                            <strong className="text-slate-900 dark:text-slate-100">
                                              {ex.totalReps} reps
                                            </strong>
                                          </span>
                                        </div>
                                      ) : (
                                        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                                          <div className="flex items-center gap-2">
                                            <span className="text-xs font-semibold text-slate-500">
                                              Reps / Round:
                                            </span>
                                            <input
                                              type="number"
                                              min={1}
                                              value={ex.repsPerRound ?? 1}
                                              onChange={(e) => {
                                                const rpr = Math.max(
                                                  1,
                                                  parseInt(e.target.value, 10) || 1
                                                );
                                                const completed = draft.completedRounds ?? 0;
                                                updateDraftWorkout(draft.logUuid, (curr) => {
                                                  const next = [...curr.exercises];
                                                  next[exIdx] = {
                                                    ...next[exIdx],
                                                    repsPerRound: rpr,
                                                    sets: Array.from(
                                                      { length: completed },
                                                      (_, i) => ({
                                                        setNumber: i + 1,
                                                        reps: rpr,
                                                      })
                                                    ),
                                                  };
                                                  return { ...curr, exercises: next };
                                                });
                                              }}
                                              className="w-14 px-2 py-1 text-xs font-mono font-bold text-center rounded-lg bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                                            />
                                            {ex.isPerSide && (
                                              <span className="text-[11px] font-mono font-bold text-orange-500">
                                                /side (×2)
                                              </span>
                                            )}
                                          </div>

                                          <span className="text-xs font-mono text-slate-500 tabular-nums">
                                            {draft.completedRounds ?? 0} rds ×{' '}
                                            {ex.repsPerRound ?? 1}
                                            {ex.isPerSide ? '×2' : ''} ={' '}
                                            <strong className="text-slate-900 dark:text-slate-100">
                                              {ex.totalReps} reps
                                            </strong>
                                          </span>
                                        </div>
                                      )
                                    ) : (
                                      /* Full-Width Dynamic Set Boxes Row (Standard & AMRAP Circuit) */
                                      <div className="flex flex-wrap items-start gap-1.5">
                                        {(ex.sets || []).map((setObj, sIdx) => {
                                          const ghostSet = ghostEx?.sets?.[sIdx];
                                          const isAmrap =
                                            isCircuitMode &&
                                            (ex.targetRepsLabel?.toUpperCase() === 'AMRAP' ||
                                              !ghostSet?.reps);
                                          const ghostRepPlaceholder = isAmrap
                                            ? 'AMRAP'
                                            : ghostSet
                                            ? String(ghostSet.reps)
                                            : ghostEx?.sets?.[0]
                                            ? String(ghostEx.sets[0].reps)
                                            : '0';
                                          const overrideKey = `${draft.logUuid}_${exIdx}_${sIdx}`;
                                          const hasWeightOverride =
                                            setObj.weightOverride !== undefined &&
                                            setObj.weightOverride !== null;
                                          const ghostHasOverride =
                                            ghostSet?.weightOverride !== undefined &&
                                            ghostSet?.weightOverride !== null;

                                          return (
                                            <div
                                              key={sIdx}
                                              className="flex flex-col items-center group relative"
                                            >
                                              <span className="text-[10px] font-mono font-semibold text-slate-400 mb-0.5 tabular-nums">
                                                {isCircuitMode ? `R${sIdx + 1}` : `S${sIdx + 1}`}
                                                {ex.metricType === 'distance'
                                                  ? ' (m)'
                                                  : ex.metricType === 'time'
                                                  ? ' (s)'
                                                  : ''}
                                                {ex.isPerSide ? ' ea' : ''}
                                              </span>
                                              <input
                                                type="number"
                                                inputMode="numeric"
                                                min={0}
                                                title={`${
                                                  isCircuitMode ? 'Round' : 'Set'
                                                } ${sIdx + 1} ${
                                                  ex.metricType === 'distance'
                                                    ? 'meters'
                                                    : ex.metricType === 'time'
                                                    ? 'seconds'
                                                    : 'reps'
                                                }${
                                                  ex.isPerSide ? ' per side' : ''
                                                }`}
                                                value={setObj.reps === 0 ? '' : setObj.reps}
                                                placeholder={ghostRepPlaceholder}
                                                onChange={(e) =>
                                                  handleSetRepChange(
                                                    draft,
                                                    exIdx,
                                                    sIdx,
                                                    e.target.value
                                                  )
                                                }
                                                onDoubleClick={() => {
                                                  if (setObj.reps === 0 && ghostSet?.reps) {
                                                    handleSetRepChange(
                                                      draft,
                                                      exIdx,
                                                      sIdx,
                                                      String(ghostSet.reps)
                                                    );
                                                  }
                                                }}
                                                className={`${
                                                  isAmrap ? 'w-14 text-xs' : 'w-12 text-sm'
                                                } h-11 rounded-xl text-center font-mono font-bold tabular-nums border transition-all focus:outline-none focus:ring-2 focus:ring-orange-500 ${
                                                  setObj.reps > 0
                                                    ? hasWeightOverride
                                                      ? 'bg-orange-500/10 border-orange-500 text-orange-700 dark:text-orange-300'
                                                      : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 shadow-2xs'
                                                    : 'bg-slate-100/70 dark:bg-slate-900/50 border-dashed border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 placeholder:text-slate-400/60 dark:placeholder:text-slate-500/60'
                                                }`}
                                              />

                                            {/* Per-Set Weight Override Trigger Pill */}
                                            {ex.loadType !== 'bodyweight' &&
                                              ex.loadType !== 'none' && (
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    setActiveSetOverrideKey(
                                                      activeSetOverrideKey === overrideKey
                                                        ? null
                                                        : overrideKey
                                                    )
                                                  }
                                                  data-tooltip="Override weight for this set"
                                                  title="Override weight for this specific set"
                                                  className={`mt-1 px-1.5 py-0.5 rounded text-[10px] font-mono tabular-nums transition-colors ${
                                                    hasWeightOverride
                                                      ? 'bg-orange-500 text-white font-bold'
                                                      : ghostHasOverride
                                                      ? 'text-orange-500/70 hover:bg-orange-500/10'
                                                      : 'text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                                  }`}
                                                >
                                                  {hasWeightOverride
                                                    ? `@${setObj.weightOverride}kg`
                                                    : ghostHasOverride
                                                    ? `(@${ghostSet?.weightOverride})`
                                                    : `@${ex.weight}kg`}
                                                </button>
                                              )}

                                            {activeSetOverrideKey === overrideKey && (
                                              <div className="absolute top-20 z-20 p-2 rounded-2xl bg-slate-900 text-white shadow-xl border border-slate-700 flex items-center gap-1.5 w-40">
                                                <input
                                                  type="number"
                                                  step="0.5"
                                                  min={0}
                                                  autoFocus
                                                  value={setObj.weightOverride ?? ''}
                                                  placeholder={String(
                                                    ghostSet?.weightOverride ?? ex.weight
                                                  )}
                                                  onChange={(e) =>
                                                    handleSetWeightOverrideChange(
                                                      draft,
                                                      exIdx,
                                                      sIdx,
                                                      e.target.value
                                                    )
                                                  }
                                                  className="w-16 px-2 py-1 text-xs font-mono font-bold tabular-nums rounded-lg bg-slate-800 text-white text-center focus:outline-none focus:ring-1 focus:ring-orange-500"
                                                />
                                                <span className="text-[10px] font-mono text-slate-300">
                                                  kg
                                                </span>
                                                <button
                                                  type="button"
                                                  onClick={() => setActiveSetOverrideKey(null)}
                                                  className="ml-auto px-2 py-1 rounded-lg bg-orange-500 text-[10px] font-bold"
                                                >
                                                  OK
                                                </button>
                                              </div>
                                            )}
                                          </div>
                                        );
                                      })}

                                      {/* [ + ] and [ - ] Set Box Buttons */}
                                      <div className="flex items-center gap-1 pt-4">
                                        <button
                                          type="button"
                                          onClick={() =>
                                            handleAddSetBox(
                                              draft,
                                              exIdx,
                                              ghostEx?.sets?.[0]?.reps || 0
                                            )
                                          }
                                          data-tooltip="Add Set"
                                          title="Add Set"
                                          className="w-9 h-11 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-orange-500 hover:text-orange-500 flex items-center justify-center text-slate-400 transition-colors"
                                        >
                                          <Plus className="w-4 h-4" />
                                        </button>
                                        {(ex.sets || []).length > 1 && (
                                          <button
                                            type="button"
                                            onClick={() => handleRemoveLastSetBox(draft, exIdx)}
                                            data-tooltip="Remove Last Set"
                                            title="Remove Last Set"
                                            className="w-8 h-11 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 hover:border-rose-400 hover:text-rose-500 flex items-center justify-center text-slate-400 transition-colors"
                                          >
                                            <Minus className="w-3.5 h-3.5" />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                    )}
                                  </div>

                                  {/* Totals Bar */}
                                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/80 text-xs">
                                    <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
                                      <span className="text-slate-500 dark:text-slate-400">
                                        Sets:{' '}
                                        <strong className="text-slate-900 dark:text-slate-100">
                                          {ex.totalSets}
                                        </strong>
                                      </span>
                                      {ex.metricType === 'distance' ? (
                                        <span className="text-slate-500 dark:text-slate-400">
                                          Distance:{' '}
                                          <strong className="text-orange-600 dark:text-orange-400">
                                            {formatExerciseMetricSummary(ex)}
                                          </strong>
                                        </span>
                                      ) : ex.metricType === 'time' ? (
                                        <span className="text-slate-500 dark:text-slate-400">
                                          Time:{' '}
                                          <strong className="text-orange-600 dark:text-orange-400">
                                            {formatExerciseMetricSummary(ex)}
                                          </strong>
                                        </span>
                                      ) : (
                                        <>
                                          <span className="text-slate-500 dark:text-slate-400">
                                            Reps:{' '}
                                            <strong className="text-slate-900 dark:text-slate-100">
                                              {ex.totalReps}
                                            </strong>
                                          </span>
                                          <span className="text-slate-500 dark:text-slate-400">
                                            Volume:{' '}
                                            <strong className="text-orange-600 dark:text-orange-400">
                                              {ex.totalLoadKg.toLocaleString()} kg
                                            </strong>
                                          </span>
                                        </>
                                      )}
                                    </div>

                                    <input
                                      type="text"
                                      value={ex.exerciseNotes || ''}
                                      placeholder="Exercise note..."
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        updateDraftWorkout(draft.logUuid, (curr) => {
                                          const next = [...curr.exercises];
                                          next[exIdx] = { ...next[exIdx], exerciseNotes: val };
                                          return { ...curr, exercises: next };
                                        });
                                      }}
                                      className="w-full sm:w-64 px-2.5 py-1 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:border-orange-500"
                                    />
                                  </div>
                                </div>
                              ) : (
                                /* CARDIO ENTRY */
                                <div className="space-y-3">
                                  <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
                                    <div>
                                      <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">
                                        Mode
                                      </label>
                                      <select
                                        value={ex.mode || 'Ruck'}
                                        onChange={(e) => {
                                          const mode = e.target.value as CardioMode;
                                          updateDraftWorkout(draft.logUuid, (curr) => {
                                            const next = [...curr.exercises];
                                            next[exIdx] = { ...next[exIdx], mode };
                                            return { ...curr, exercises: next };
                                          });
                                        }}
                                        className="w-full px-2.5 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                                      >
                                        {CARDIO_MODES.map((m) => (
                                          <option key={m} value={m}>
                                            {m}
                                          </option>
                                        ))}
                                      </select>
                                    </div>

                                    <div className="col-span-1 sm:col-span-2">
                                      <div className="flex items-center justify-between mb-1">
                                        <label className="text-[10px] font-semibold uppercase text-slate-400">
                                          Distance ({ex.distanceUnit || 'mi'})
                                        </label>
                                        <div className="inline-flex rounded-md bg-slate-200 dark:bg-slate-800 p-0.5">
                                          {(['mi', 'km'] as DistanceUnit[]).map((u) => (
                                            <button
                                              key={u}
                                              type="button"
                                              title={`Switch distance unit to ${u}`}
                                              onClick={() =>
                                                updateDraftWorkout(draft.logUuid, (curr) => {
                                                  const next = [...curr.exercises];
                                                  next[exIdx] = {
                                                    ...next[exIdx],
                                                    distanceUnit: u,
                                                  };
                                                  return { ...curr, exercises: next };
                                                })
                                              }
                                              className={`px-1.5 py-0.2 text-[10px] font-bold uppercase rounded ${
                                                (ex.distanceUnit || 'mi') === u
                                                  ? 'bg-orange-500 text-white'
                                                  : 'text-slate-500'
                                              }`}
                                            >
                                              {u}
                                            </button>
                                          ))}
                                        </div>
                                      </div>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min={0}
                                        value={ex.distance ?? ''}
                                        placeholder={String(ghostEx?.distance ?? 4.0)}
                                        onChange={(e) => {
                                          const val =
                                            e.target.value === ''
                                              ? undefined
                                              : parseFloat(e.target.value) || 0;
                                          updateDraftWorkout(draft.logUuid, (curr) => {
                                            const next = [...curr.exercises];
                                            next[exIdx] = { ...next[exIdx], distance: val };
                                            return { ...curr, exercises: next };
                                          });
                                        }}
                                        className="w-full px-3 py-2 text-xs font-mono font-bold tabular-nums rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                                      />
                                    </div>

                                    <div>
                                      <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">
                                        Time (mm:ss)
                                      </label>
                                      <input
                                        type="text"
                                        defaultValue={
                                          ex.durationSec ? formatSecondsAsMmSs(ex.durationSec) : ''
                                        }
                                        placeholder={
                                          ghostEx?.durationSec
                                            ? formatSecondsAsMmSs(ghostEx.durationSec)
                                            : '45:00'
                                        }
                                        onBlur={(e) => {
                                          const sec = parseMmSsToSeconds(e.target.value);
                                          updateDraftWorkout(draft.logUuid, (curr) => {
                                            const next = [...curr.exercises];
                                            next[exIdx] = { ...next[exIdx], durationSec: sec };
                                            return { ...curr, exercises: next };
                                          });
                                        }}
                                        className="w-full px-3 py-2 text-xs font-mono font-bold tabular-nums rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                                      />
                                    </div>

                                    <div>
                                      <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">
                                        Ruck Load (kg)
                                      </label>
                                      <input
                                        type="number"
                                        step="0.5"
                                        min={0}
                                        value={ex.ruckLoadKg ?? ''}
                                        placeholder={String(ghostEx?.ruckLoadKg ?? 20)}
                                        onChange={(e) => {
                                          const val =
                                            e.target.value === ''
                                              ? undefined
                                              : parseFloat(e.target.value) || 0;
                                          updateDraftWorkout(draft.logUuid, (curr) => {
                                            const next = [...curr.exercises];
                                            next[exIdx] = { ...next[exIdx], ruckLoadKg: val };
                                            return { ...curr, exercises: next };
                                          });
                                        }}
                                        className="w-full px-3 py-2 text-xs font-mono font-bold tabular-nums rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                                      />
                                    </div>

                                    <div>
                                      <label className="block text-[10px] font-semibold uppercase text-slate-400 mb-1">
                                        Avg HR (bpm)
                                      </label>
                                      <input
                                        type="number"
                                        min={40}
                                        max={230}
                                        value={ex.avgHr ?? ''}
                                        placeholder={String(ghostEx?.avgHr ?? 138)}
                                        onChange={(e) => {
                                          const val =
                                            e.target.value === ''
                                              ? undefined
                                              : parseInt(e.target.value, 10) || 0;
                                          updateDraftWorkout(draft.logUuid, (curr) => {
                                            const next = [...curr.exercises];
                                            next[exIdx] = { ...next[exIdx], avgHr: val };
                                            return { ...curr, exercises: next };
                                          });
                                        }}
                                        className="w-full px-3 py-2 text-xs font-mono font-bold tabular-nums rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                                      />
                                    </div>
                                  </div>

                                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/80">
                                    <div className="flex items-center gap-3 text-xs font-mono tabular-nums">
                                      <span className="px-2.5 py-1 rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400 font-bold">
                                        Pace: {formatPace(ex.paceSecPerUnit, ex.distanceUnit || 'mi')}
                                      </span>
                                    </div>

                                    <input
                                      type="text"
                                      value={ex.splits || ''}
                                      placeholder="Splits / Terrain notes..."
                                      onChange={(e) => {
                                        const val = e.target.value;
                                        updateDraftWorkout(draft.logUuid, (curr) => {
                                          const next = [...curr.exercises];
                                          next[exIdx] = { ...next[exIdx], splits: val };
                                          return { ...curr, exercises: next };
                                        });
                                      }}
                                      className="w-full sm:w-80 px-2.5 py-1 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                                    />
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                          };

                          const groupedChunks = groupConsecutiveExercises(draft.exercises);
                          return groupedChunks.map((chunk, cIdx) => {
                            if (chunk.type === 'single') {
                              return renderLoggedExerciseCard(chunk.item, chunk.originalIdx);
                            }
                            return (
                              <div
                                key={`${chunk.groupId}-${cIdx}`}
                                className="rounded-2xl border border-orange-500/30 border-l-4 border-l-orange-500 bg-orange-500/[0.025] p-2.5 sm:p-3 space-y-2.5"
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
                                    renderLoggedExerciseCard(item, originalIdx, stepCode)
                                  )}
                                </div>
                              </div>
                            );
                          });
                        })()}
                      </div>

                      {/* Add Exercise On-the-Fly Button & Update Preset Toggle */}
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button
                          type="button"
                          data-tooltip="Add another exercise to this workout"
                          title="Add another exercise to this workout"
                          onClick={() =>
                            setExercisePickerModal({ open: true, logUuid: draft.logUuid })
                          }
                          className="px-3.5 py-2 rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-orange-500 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-orange-500 inline-flex items-center gap-1.5 transition-colors"
                        >
                          <Plus className="w-4 h-4" />
                          Add Exercise
                        </button>

                        {logDensityMode !== 'compact' && (
                          <label
                            title="Also save any added/changed exercises back to your Library template"
                            className="flex items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={Boolean(draft.updatePresetOnSave)}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                updateDraftWorkout(draft.logUuid, (curr) => ({
                                  ...curr,
                                  updatePresetOnSave: checked,
                                }));
                              }}
                              className="rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                            />
                            Save changes to Library template
                          </label>
                        )}
                      </div>

                      {/* Workout Session Notes & Completion Controls */}
                      <div className="pt-3 border-t border-slate-200/60 dark:border-slate-800/80 space-y-3">
                        <textarea
                          rows={logDensityMode === 'compact' ? 1 : 2}
                          value={draft.sessionNotes || ''}
                          placeholder="Workout notes (how it felt, energy, grip, weather, etc.)..."
                          onChange={(e) => {
                            const val = e.target.value;
                            updateDraftWorkout(draft.logUuid, (curr) => ({
                              ...curr,
                              sessionNotes: val,
                            }));
                          }}
                          className="w-full px-3.5 py-2 text-xs rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/80 dark:border-slate-700/80 text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-orange-500"
                        />

                        <div className="flex flex-wrap items-center justify-end gap-2">
                          <button
                            type="button"
                            data-tooltip="Log workout as incomplete"
                            title="Log workout as incomplete"
                            onClick={async () => {
                              const res = await saveDraftWorkout(
                                draft.logUuid,
                                'did_not_complete',
                                draft.updatePresetOnSave
                              );
                              if (res.ok) {
                                triggerToast('Saved as Incomplete');
                              } else {
                                triggerToast(
                                  `Cloud sync error: ${res.error || 'Saved locally only'}`,
                                  true
                                );
                              }
                            }}
                            className="px-3.5 py-2 rounded-2xl bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-semibold text-xs inline-flex items-center gap-1.5 transition-colors"
                          >
                            <XCircle className="w-4 h-4" />
                            Incomplete
                          </button>

                          <button
                            type="button"
                            data-tooltip="Save completed workout to History"
                            title="Save completed workout to History"
                            onClick={async () => {
                              const res = await saveDraftWorkout(
                                draft.logUuid,
                                'completed',
                                draft.updatePresetOnSave
                              );
                              setCollapsedCards((prev) => ({
                                ...prev,
                                [draft.logUuid]: true,
                              }));
                              if (res.ok) {
                                triggerToast(`Completed & Saved "${draft.workoutTitleSnapshot}"!`);
                              } else {
                                triggerToast(
                                  `Cloud sync error: ${res.error || 'Saved locally only'}`,
                                  true
                                );
                              }
                            }}
                            className="px-5 py-2.5 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs inline-flex items-center gap-1.5 transition-all"
                          >
                            <Save className="w-4 h-4" />
                            {draft.isSaved ? 'Update Saved Log' : 'Complete Workout'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MODAL 1: Searchable Preset Picker */}
      {presetPickerModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full max-w-xl bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                  {presetPickerModal.mode === 'swap'
                    ? 'Switch Workout'
                    : presetPickerModal.mode === 'chain'
                    ? 'Add Workout'
                    : 'Choose Workout'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Filter by your active program, tags, or search all workouts
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPresetPickerModal({ open: false, mode: 'add' })}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
              >
                Close
              </button>
            </div>

            <div className="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative flex-1 min-w-0 w-full sm:w-auto">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={presetSearch}
                    onChange={(e) => setPresetSearch(e.target.value)}
                    placeholder="Search workout or exercise..."
                    className="w-full pl-9 pr-3 py-2 text-xs rounded-2xl bg-slate-100 dark:bg-slate-800 border border-transparent focus:border-orange-500 focus:outline-none"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setFilterByActiveProgram(!filterByActiveProgram)}
                  className={`px-3 py-2 rounded-2xl text-xs font-semibold inline-flex items-center gap-1.5 border transition-colors ${
                    filterByActiveProgram
                      ? 'bg-orange-500/10 border-orange-500/40 text-orange-600 dark:text-orange-400'
                      : 'bg-slate-100 dark:bg-slate-800 border-transparent text-slate-600 dark:text-slate-400'
                  }`}
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  {filterByActiveProgram ? 'Active Program' : 'All Workouts'}
                </button>
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                {allTags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSelectedTag(tag)}
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-semibold whitespace-nowrap transition-colors ${
                      selectedTag === tag
                        ? 'bg-slate-900 dark:bg-orange-500 text-white'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 overflow-y-auto space-y-2.5 flex-1">
              {filteredPresets.length === 0 ? (
                <div className="py-10 text-center space-y-2">
                  <p className="text-sm font-medium text-slate-500">
                    No matching workouts found.
                  </p>
                  {filterByActiveProgram && (
                    <button
                      type="button"
                      onClick={() => setFilterByActiveProgram(false)}
                      className="text-xs font-bold text-orange-500 underline"
                    >
                      Show All Workouts
                    </button>
                  )}
                </div>
              ) : (
                filteredPresets.map((preset) => (
                  <div
                    key={preset.presetUuid}
                    onClick={() => {
                      addWorkoutToSession(preset.presetUuid, {
                        replaceDraftLogUuid: presetPickerModal.replaceLogUuid,
                        slotRole:
                          presetPickerModal.mode === 'chain'
                            ? `Workout #${draftWorkouts.length + 1}`
                            : undefined,
                      });
                      if (presetPickerModal.replaceLogUuid) {
                        const swappedId = presetPickerModal.replaceLogUuid;
                        setCollapsedCards((prev) => ({ ...prev, [swappedId]: false }));
                      }
                      if (presetPickerModal.mode === 'chain') {
                        setActiveCardIdx(draftWorkouts.length);
                      }
                      setPresetPickerModal({ open: false, mode: 'add' });
                      triggerToast(
                        presetPickerModal.mode === 'swap'
                          ? `Switched to ${preset.title}`
                          : `Loaded ${preset.title}`
                      );
                    }}
                    className="p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 hover:border-orange-500 dark:hover:border-orange-500 bg-slate-50/50 dark:bg-slate-800/40 cursor-pointer transition-all flex items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-display font-bold text-sm text-slate-900 dark:text-slate-100">
                          {preset.title}
                        </span>
                        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-md bg-orange-500/15 text-orange-600 dark:text-orange-400">
                          {preset.workoutType}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {preset.exercises.map((e) => e.exerciseName).join(' • ')}
                      </p>
                    </div>
                    <span className="px-3 py-1.5 rounded-xl bg-orange-500 text-white text-xs font-bold shrink-0">
                      Select
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: On-the-Fly Exercise Picker */}
      {exercisePickerModal.open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
          <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
            <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <h3 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                {exercisePickerModal.swapExerciseIndex !== undefined
                  ? 'Swap Exercise'
                  : 'Add Exercise'}
              </h3>
              <button
                type="button"
                onClick={() => setExercisePickerModal({ open: false, logUuid: '' })}
                className="px-3 py-1 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800"
              >
                Close
              </button>
            </div>

            <div className="p-4 border-b border-slate-100 dark:border-slate-800 space-y-3">
              <input
                type="text"
                value={exerciseSearch}
                onChange={(e) => setExerciseSearch(e.target.value)}
                placeholder="Search exercises..."
                className="w-full px-3.5 py-2 text-xs rounded-2xl bg-slate-100 dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-orange-500"
              />

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newCustomExerciseName}
                  onChange={(e) => setNewCustomExerciseName(e.target.value)}
                  placeholder="Or create new exercise..."
                  className="flex-1 px-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
                <select
                  value={newCustomTrackingType}
                  onChange={(e) => setNewCustomTrackingType(e.target.value as TrackingType)}
                  className="px-2 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"
                >
                  <option value="strength">Strength</option>
                  <option value="circuit">Circuit</option>
                  <option value="cardio">Cardio</option>
                </select>
                <button
                  type="button"
                  onClick={() => {
                    if (!newCustomExerciseName.trim()) return;
                    const now = new Date().toISOString();
                    const newExUuid = `ex-${uuidv4()}`;
                    const created = {
                      exerciseUuid: newExUuid,
                      slug: slugify(newCustomExerciseName, 'ex'),
                      exerciseName: newCustomExerciseName.trim(),
                      category:
                        newCustomTrackingType === 'cardio' ? 'Cardio' : 'General',
                      trackingType: newCustomTrackingType,
                      metricType: inferDefaultMetricType(newCustomExerciseName.trim()),
                      defaultLoadType:
                        newCustomTrackingType === 'cardio'
                          ? ('ruck_kg' as LoadType)
                          : ('single_kg' as LoadType),
                      defaultWeight: 16,
                      createdAt: now,
                      updatedAt: now,
                    };
                    upsertGlobalExercise(created);
                    setNewCustomExerciseName('');

                    const newLogged: LoggedExercise = recalculateLoggedExercise({
                      exerciseUuid: created.exerciseUuid,
                      exerciseName: created.exerciseName,
                      category: created.category,
                      trackingType: created.trackingType,
                      loadType: created.defaultLoadType,
                      metricType: created.metricType,
                      weight: created.defaultWeight,
                      sets:
                        created.trackingType === 'cardio'
                          ? []
                          : [
                              { setNumber: 1, reps: 0 },
                              { setNumber: 2, reps: 0 },
                              { setNumber: 3, reps: 0 },
                            ],
                      totalSets: 0,
                      totalReps: 0,
                      totalLoadKg: 0,
                      distanceUnit: meta.defaultDistanceUnit || 'mi',
                    });

                    updateDraftWorkout(exercisePickerModal.logUuid, (curr) => {
                      const next = [...curr.exercises];
                      if (exercisePickerModal.swapExerciseIndex !== undefined) {
                        next[exercisePickerModal.swapExerciseIndex] = newLogged;
                      } else {
                        next.push(newLogged);
                      }
                      return { ...curr, exercises: next };
                    });
                    setExercisePickerModal({ open: false, logUuid: '' });
                  }}
                  className="px-3 py-1.5 rounded-xl bg-orange-500 text-white text-xs font-bold"
                >
                  + Create
                </button>
              </div>
            </div>

            <div className="p-4 overflow-y-auto space-y-2 flex-1">
              {globalExercises
                .filter(
                  (ge) =>
                    !exerciseSearch.trim() ||
                    ge.exerciseName.toLowerCase().includes(exerciseSearch.toLowerCase()) ||
                    ge.category.toLowerCase().includes(exerciseSearch.toLowerCase())
                )
                .map((ge) => (
                  <div
                    key={ge.exerciseUuid}
                    onClick={() => {
                      const newLogged: LoggedExercise = recalculateLoggedExercise({
                        exerciseUuid: ge.exerciseUuid,
                        exerciseName: ge.exerciseName,
                        category: ge.category,
                        trackingType: ge.trackingType,
                        loadType: ge.defaultLoadType,
                        metricType: ge.metricType || inferDefaultMetricType(ge.exerciseName),
                        weight: ge.defaultWeight,
                        sets:
                          ge.trackingType === 'cardio'
                            ? []
                            : [
                                { setNumber: 1, reps: 0 },
                                { setNumber: 2, reps: 0 },
                                { setNumber: 3, reps: 0 },
                              ],
                        totalSets: 0,
                        totalReps: 0,
                        totalLoadKg: 0,
                        mode: ge.cardioMode || undefined,
                        distanceUnit: meta.defaultDistanceUnit || 'mi',
                        ruckLoadKg:
                          ge.defaultLoadType === 'ruck_kg' ? ge.defaultWeight : undefined,
                      });

                      updateDraftWorkout(exercisePickerModal.logUuid, (curr) => {
                        const next = [...curr.exercises];
                        if (exercisePickerModal.swapExerciseIndex !== undefined) {
                          next[exercisePickerModal.swapExerciseIndex] = newLogged;
                        } else {
                          next.push(newLogged);
                        }
                        return { ...curr, exercises: next };
                      });
                      setExercisePickerModal({ open: false, logUuid: '' });
                    }}
                    className="p-3 rounded-2xl border border-slate-200/80 dark:border-slate-800 hover:border-orange-500 flex items-center justify-between cursor-pointer"
                  >
                    <div>
                      <div className="font-bold text-xs text-slate-900 dark:text-slate-100">
                        {ge.exerciseName}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        {ge.category} • {formatLoadBadge(ge.defaultLoadType, ge.defaultWeight)}
                      </div>
                    </div>
                    <span className="text-xs font-bold text-orange-500">Add</span>
                  </div>
                ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Exercise Previous History Drawer */}
      <ExerciseHistoryModal
        exerciseUuid={historyModalState.exerciseUuid}
        exerciseName={historyModalState.exerciseName}
        currentPresetUuid={historyModalState.presetUuid}
        onClose={() => setHistoryModalState({ exerciseUuid: null, exerciseName: '' })}
      />
    </div>
  );
};

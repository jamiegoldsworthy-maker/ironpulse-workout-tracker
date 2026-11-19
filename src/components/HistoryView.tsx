import React, { useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import {
  Activity,
  Award,
  Calendar,
  Dumbbell,
  Filter,
  Flame,
  Layers,
  Search,
  Timer,
  Trash2,
  TrendingUp,
} from 'lucide-react';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { WorkoutType } from '../types/workout';
import {
  formatExerciseMetricSummary,
  formatLoadBadge,
  formatPace,
  formatReadableDate,
  formatSecondsAsMmSs,
  getEffectiveImplementWeightKg,
} from '../utils/calculations';
import { useIsMobileView } from '../utils/useIsMobileView';

export const HistoryView: React.FC = () => {
  const {
    logs,
    presets,
    programs,
    categories,
    exercises: globalExercises,
    deleteWorkoutLog,
    setActiveDate,
    setActiveTab,
  } = useWorkoutStore();

  const WORKOUT_TYPES: Array<'ALL' | WorkoutType> = ['ALL', ...categories];

  const isMobile = useIsMobileView();
  const [explorerMode, setExplorerMode] = useState<'workouts' | 'exercises'>('workouts');
  const [groupSessions, setGroupSessions] = useState<boolean>(true);
  const [selectedProgramUuid, setSelectedProgramUuid] = useState<string>('ALL');
  const [selectedWorkoutType, setSelectedWorkoutType] = useState<'ALL' | WorkoutType>('ALL');
  const [selectedPresetUuid, setSelectedPresetUuid] = useState<string>('ALL');
  const [selectedExerciseUuid, setSelectedExerciseUuid] = useState<string>(
    globalExercises[0]?.exerciseUuid || 'ex-kb-clean-and-press'
  );
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Filtered Workout Logs (exclude in-progress live drafts until completed/marked incomplete)
  const filteredLogs = useMemo(() => {
    return logs
      .filter((log) => {
        if (log.status === 'in_progress') {
          return false;
        }
        if (selectedProgramUuid !== 'ALL' && log.programUuid !== selectedProgramUuid) {
          return false;
        }
        if (selectedWorkoutType !== 'ALL' && log.workoutType !== selectedWorkoutType) {
          return false;
        }
        if (selectedPresetUuid !== 'ALL' && log.presetUuid !== selectedPresetUuid) {
          return false;
        }
        if (dateFrom && log.date < dateFrom) return false;
        if (dateTo && log.date > dateTo) return false;
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          const matchId = log.displayId.toLowerCase().includes(q);
          const matchLegacy = (log.legacyId || '').toLowerCase().includes(q);
          const matchTitle = log.workoutTitleSnapshot.toLowerCase().includes(q);
          const matchNotes = (log.sessionNotes || '').toLowerCase().includes(q);
          const matchEx = log.exercises.some((e) => e.exerciseName.toLowerCase().includes(q));
          return matchId || matchLegacy || matchTitle || matchNotes || matchEx;
        }
        return true;
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));
  }, [
    logs,
    selectedProgramUuid,
    selectedWorkoutType,
    selectedPresetUuid,
    dateFrom,
    dateTo,
    searchQuery,
  ]);

  // KPI Summary Calculations
  const kpiStats = useMemo(() => {
    const completed = filteredLogs.filter((l) => l.status === 'completed');
    const totalVolumeKg = completed.reduce(
      (sum, l) => sum + (Number(l.totalSessionVolumeKg) || 0),
      0
    );
    const uniqueSessions = new Set(completed.map((l) => l.sessionGroupUuid || l.logUuid)).size;

    let maxSingleWeightKg = 0;
    let maxEst1RmKg = 0;
    let totalDistanceMi = 0;
    let bestPaceSecPerMi = 0;

    for (const log of completed) {
      for (const ex of log.exercises) {
        if (ex.trackingType === 'cardio') {
          const distMi =
            ex.distanceUnit === 'km'
              ? (Number(ex.distance) || 0) / 1.60934
              : Number(ex.distance) || 0;
          totalDistanceMi += distMi;
          if (distMi > 0 && ex.durationSec && ex.durationSec > 0) {
            const paceMi = Math.round(ex.durationSec / distMi);
            if (bestPaceSecPerMi === 0 || paceMi < bestPaceSecPerMi) {
              bestPaceSecPerMi = paceMi;
            }
          }
        } else {
          if ((ex.estimated1RmKg || 0) > maxEst1RmKg) {
            maxEst1RmKg = ex.estimated1RmKg || 0;
          }
          for (const s of ex.sets || []) {
            if (s.reps > 0) {
              const effW = getEffectiveImplementWeightKg(
                ex.loadType,
                ex.weight,
                s.weightOverride,
                ex.secondaryWeightKg
              );
              if (effW > maxSingleWeightKg) maxSingleWeightKg = effW;
            }
          }
        }
      }
    }

    return {
      completedWorkoutsCount: completed.length,
      uniqueSessionsCount: uniqueSessions,
      totalVolumeKg: Math.round(totalVolumeKg),
      maxSingleWeightKg,
      maxEst1RmKg: Math.round(maxEst1RmKg * 10) / 10,
      totalDistanceMi: Math.round(totalDistanceMi * 10) / 10,
      bestPaceSecPerMi,
    };
  }, [filteredLogs]);

  // Chart 1: Session Volume Trend (chronological)
  const workoutVolumeChartData = useMemo(() => {
    const byDate: Record<string, { date: string; volumeKg: number; workouts: number }> = {};
    filteredLogs
      .filter((l) => l.status === 'completed')
      .slice()
      .reverse()
      .forEach((l) => {
        if (!byDate[l.date]) {
          byDate[l.date] = { date: l.date.slice(5), volumeKg: 0, workouts: 0 };
        }
        byDate[l.date].volumeKg += Math.round(l.totalSessionVolumeKg || 0);
        byDate[l.date].workouts += 1;
      });
    return Object.values(byDate);
  }, [filteredLogs]);

  // Individual Exercise Explorer Data & PRs
  const exercisePerformanceSeries = useMemo(() => {
    const matchingLogs = logs
      .filter(
        (l) => l.status === 'completed' && l.exerciseUuids.includes(selectedExerciseUuid)
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));

    return matchingLogs.map((l) => {
      const ex = l.exercises.find((e) => e.exerciseUuid === selectedExerciseUuid)!;
      let topSetWeight = ex.weight;
      let maxRepsInSet = 0;
      for (const s of ex.sets || []) {
        if (s.reps > maxRepsInSet) maxRepsInSet = s.reps;
        if (s.weightOverride !== undefined && s.weightOverride > topSetWeight) {
          topSetWeight = s.weightOverride;
        }
      }
      return {
        logUuid: l.logUuid,
        displayId: l.displayId,
        date: l.date,
        shortDate: l.date.slice(5),
        workoutTitle: l.workoutTitleSnapshot,
        trackingType: ex.trackingType,
        loadType: ex.loadType,
        baseWeight: ex.weight,
        topSetWeight,
        totalReps: ex.totalReps,
        maxRepsInSet,
        totalLoadKg: ex.totalLoadKg,
        estimated1RmKg: ex.estimated1RmKg || 0,
        rir: ex.rir,
        sets: ex.sets || [],
        distance: ex.distance || 0,
        distanceUnit: ex.distanceUnit || 'mi',
        paceMin: ex.paceSecPerUnit ? Math.round((ex.paceSecPerUnit / 60) * 100) / 100 : 0,
        paceSecPerUnit: ex.paceSecPerUnit,
        avgHr: ex.avgHr || 0,
        ruckLoadKg: ex.ruckLoadKg,
        notes: ex.exerciseNotes || l.sessionNotes,
      };
    });
  }, [logs, selectedExerciseUuid]);

  const selectedExerciseMeta = useMemo(
    () => globalExercises.find((e) => e.exerciseUuid === selectedExerciseUuid),
    [globalExercises, selectedExerciseUuid]
  );

  // Grouped Sessions for Full Workouts Explorer
  const groupedWorkoutSessions = useMemo(() => {
    if (!groupSessions) {
      return filteredLogs.map((l) => ({
        groupKey: l.logUuid,
        date: l.date,
        items: [l],
      }));
    }
    const groups: Array<{ groupKey: string; date: string; items: typeof filteredLogs }> = [];
    const map = new Map<string, typeof filteredLogs>();
    for (const l of filteredLogs) {
      const key = `${l.date}_${l.sessionGroupUuid || l.logUuid}`;
      if (!map.has(key)) {
        const arr: typeof filteredLogs = [];
        map.set(key, arr);
        groups.push({ groupKey: key, date: l.date, items: arr });
      }
      map.get(key)!.push(l);
    }
    return groups;
  }, [filteredLogs, groupSessions]);

  return (
    <div className="space-y-4 pb-24">
      {/* Top Dual-Mode Explorer Switcher */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 border border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-2xl bg-slate-100 dark:bg-slate-800 p-1">
          <button
            type="button"
            data-tooltip="Browse full workout logs grouped by date"
            title="Browse full workout logs grouped by date"
            onClick={() => setExplorerMode('workouts')}
            className={`px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all ${
              explorerMode === 'workouts'
                ? 'bg-orange-500 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <Layers className="w-4 h-4" />
            Workouts & Sessions
          </button>
          <button
            type="button"
            data-tooltip="Track weight, reps, and PRs for a specific exercise"
            title="Track weight, reps, and PRs for a specific exercise"
            onClick={() => setExplorerMode('exercises')}
            className={`px-4 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all ${
              explorerMode === 'exercises'
                ? 'bg-orange-500 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400'
            }`}
          >
            <TrendingUp className="w-4 h-4" />
            Exercise Progress
          </button>
        </div>

        {explorerMode === 'workouts' && (
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={groupSessions}
              onChange={(e) => setGroupSessions(e.target.checked)}
              className="rounded border-slate-300 text-orange-500 focus:ring-orange-500"
            />
            Group Chained Sessions Together
          </label>
        )}
      </div>

      {/* KPI Summary Cards */}
      <div className={`grid gap-3 ${isMobile ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-4'}`}>
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 border border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Volume</span>
            <Dumbbell className="w-4 h-4 text-orange-500" />
          </div>
          <div className="font-display font-extrabold text-2xl text-slate-900 dark:text-slate-100 tabular-nums">
            {kpiStats.totalVolumeKg.toLocaleString()}{' '}
            <span className="text-xs font-semibold text-slate-400">kg</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Across {kpiStats.completedWorkoutsCount} workouts ({kpiStats.uniqueSessionsCount}{' '}
            sessions)
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 border border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">All-Time Est 1RM</span>
            <Award className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="font-display font-extrabold text-2xl text-slate-900 dark:text-slate-100 tabular-nums">
            {kpiStats.maxEst1RmKg}{' '}
            <span className="text-xs font-semibold text-slate-400">kg</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Heaviest System Load: {kpiStats.maxSingleWeightKg} kg
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 border border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Ruck & Cardio</span>
            <Timer className="w-4 h-4 text-orange-500" />
          </div>
          <div className="font-display font-extrabold text-2xl text-slate-900 dark:text-slate-100 tabular-nums">
            {kpiStats.totalDistanceMi}{' '}
            <span className="text-xs font-semibold text-slate-400">mi</span>
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">
            Best Pace: {formatPace(kpiStats.bestPaceSecPerMi, 'mi')}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 border border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center justify-between text-slate-400 mb-1">
            <span className="text-[11px] font-bold uppercase tracking-wider">Consistency</span>
            <Flame className="w-4 h-4 text-orange-500" />
          </div>
          <div className="font-display font-extrabold text-2xl text-slate-900 dark:text-slate-100 tabular-nums">
            {filteredLogs.length > 0
              ? Math.round((kpiStats.completedWorkoutsCount / filteredLogs.length) * 100)
              : 100}
            %
          </div>
          <div className="text-[11px] text-slate-500 mt-0.5">Completion Rate</div>
        </div>
      </div>

      {/* MODE 1: FULL WORKOUTS / SESSIONS EXPLORER */}
      {explorerMode === 'workouts' ? (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 border border-slate-200/80 dark:border-slate-800 space-y-3">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
              <Filter className="w-3.5 h-3.5 text-orange-500" />
              Filter Workout History
            </div>

            <div
              className={`grid gap-2.5 ${
                isMobile ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-5'
              }`}
            >
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search ID-0083, title, notes..."
                  className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800"
                />
              </div>

              <select
                value={selectedWorkoutType}
                onChange={(e) => setSelectedWorkoutType(e.target.value as any)}
                className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-800"
              >
                {WORKOUT_TYPES.map((wt) => (
                  <option key={wt} value={wt}>
                    {wt === 'ALL' ? 'All Workout Types' : wt}
                  </option>
                ))}
              </select>

              <select
                value={selectedPresetUuid}
                onChange={(e) => setSelectedPresetUuid(e.target.value)}
                className="px-3 py-2 text-xs font-semibold rounded-xl bg-slate-100 dark:bg-slate-800"
              >
                <option value="ALL">All Workout Presets</option>
                {presets.map((p) => (
                  <option key={p.presetUuid} value={p.presetUuid}>
                    {p.title}
                  </option>
                ))}
              </select>

              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-2 text-xs font-mono rounded-xl bg-slate-100 dark:bg-slate-800"
                title="From Date"
              />

              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-2 text-xs font-mono rounded-xl bg-slate-100 dark:bg-slate-800"
                title="To Date"
              />
            </div>
          </div>

          {/* Volume Progression Chart */}
          {workoutVolumeChartData.length > 0 && (
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-display font-bold text-sm sm:text-base flex items-center gap-2">
                  <Activity className="w-4 h-4 text-orange-500" />
                  Session Tonnage Progression (kg)
                </h3>
              </div>
              <div className="h-56 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={workoutVolumeChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--bg-card)',
                        borderColor: 'var(--border-card)',
                        color: 'var(--text-primary)',
                        borderRadius: '12px',
                        fontSize: '12px',
                      }}
                    />
                    <Bar
                      dataKey="volumeKg"
                      name="Total Volume (kg)"
                      fill="#f97316"
                      radius={[8, 8, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Logged Workouts List */}
          <div className="space-y-3">
            {groupedWorkoutSessions.map((group) => (
              <div
                key={group.groupKey}
                className="bg-white dark:bg-slate-900 rounded-3xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-100 dark:border-slate-800">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-orange-500" />
                    <span className="font-display font-bold text-sm text-slate-900 dark:text-slate-100">
                      {formatReadableDate(group.date)}
                    </span>
                    {group.items.length > 1 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-500/15 text-orange-600 dark:text-orange-400">
                        Chained Session ({group.items.length} Workouts)
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveDate(group.date);
                      setActiveTab('log');
                    }}
                    className="text-xs font-bold text-orange-500 hover:underline"
                  >
                    Open on Gym Floor →
                  </button>
                </div>

                <div className="space-y-3">
                  {group.items.map((log) => (
                    <div
                      key={log.logUuid}
                      className="p-3.5 rounded-2xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-800 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 tabular-nums">
                            {log.displayId}
                          </span>
                          <span className="font-display font-bold text-sm text-slate-900 dark:text-slate-100">
                            {log.workoutTitleSnapshot}
                          </span>
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400">
                            {log.workoutType}
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs font-bold text-orange-600 dark:text-orange-400 tabular-nums">
                            {log.totalSessionVolumeKg.toLocaleString()} kg
                          </span>
                          <button
                            type="button"
                            onClick={() => deleteWorkoutLog(log.logUuid)}
                            className="p-1 text-slate-400 hover:text-rose-500"
                            title="Delete log"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Exercises Summary inside Log */}
                      <div className="space-y-1.5">
                        {log.exercises.map((ex, i) => (
                          <div
                            key={i}
                            className="flex flex-wrap items-center justify-between gap-2 text-xs py-1 border-t border-slate-200/40 dark:border-slate-800/60"
                          >
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                {ex.exerciseName}
                              </span>
                              <span className="font-mono text-[11px] px-1.5 py-0.2 rounded bg-slate-200/70 dark:bg-slate-700 text-slate-700 dark:text-slate-300 tabular-nums">
                                {formatLoadBadge(ex.loadType, ex.weight, ex.ruckLoadKg, ex.secondaryWeightKg)}
                              </span>
                            </div>

                            {ex.trackingType === 'cardio' ? (
                              <div className="font-mono text-xs tabular-nums text-slate-600 dark:text-slate-300">
                                {ex.distance ?? 0} {ex.distanceUnit || 'mi'} in{' '}
                                {formatSecondsAsMmSs(ex.durationSec)} •{' '}
                                <strong className="text-orange-500">
                                  {formatPace(ex.paceSecPerUnit, ex.distanceUnit || 'mi')}
                                </strong>
                                {ex.avgHr ? ` • ${ex.avgHr} bpm` : ''}
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs tabular-nums">
                                <span className="text-slate-500">
                                  [
                                  {ex.sets
                                    .map((s) => {
                                      const unitSuffix =
                                        ex.metricType === 'distance'
                                          ? 'm'
                                          : ex.metricType === 'time'
                                          ? 's'
                                          : '';
                                      return s.weightOverride !== undefined &&
                                        s.weightOverride !== ex.weight
                                        ? `${s.reps}${unitSuffix}@${s.weightOverride}kg`
                                        : `${s.reps}${unitSuffix}`;
                                    })
                                    .join(', ')}
                                  ]
                                </span>
                                {ex.rir !== undefined && (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
                                    RIR {ex.rir}
                                  </span>
                                )}
                                <span className="font-bold text-slate-700 dark:text-slate-300">
                                  = {formatExerciseMetricSummary(ex)}
                                </span>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      {log.sessionNotes && (
                        <div className="text-xs text-slate-500 dark:text-slate-400 italic pt-1">
                          "{log.sessionNotes}"
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* MODE 2: INDIVIDUAL EXERCISE ANALYTICS */
        <div className="space-y-4">
          {/* Exercise Selector Header */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 border border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-display font-bold text-sm sm:text-base">
                Exercise Progress Tracker
              </h3>
              <p className="text-xs text-slate-500">
                View your strength, volume, and pace trends across all workouts
              </p>
            </div>
            <select
              value={selectedExerciseUuid}
              onChange={(e) => setSelectedExerciseUuid(e.target.value)}
              className="px-4 py-2.5 rounded-2xl text-xs font-bold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
            >
              {globalExercises.map((ge) => (
                <option key={ge.exerciseUuid} value={ge.exerciseUuid}>
                  {ge.exerciseName} ({ge.category})
                </option>
              ))}
            </select>
          </div>

          {/* Exercise Progression Chart */}
          {exercisePerformanceSeries.length > 0 ? (
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="font-display font-bold text-sm sm:text-base">
                  {selectedExerciseMeta?.exerciseName} Progression ({exercisePerformanceSeries.length}{' '}
                  Sessions)
                </h4>
              </div>

              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  {selectedExerciseMeta?.trackingType === 'cardio' ? (
                    <LineChart data={exercisePerformanceSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
                      <XAxis dataKey="shortDate" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--bg-card)',
                        borderColor: 'var(--border-card)',
                        color: 'var(--text-primary)',
                          borderRadius: '12px',
                          fontSize: '12px',
                        }}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="distance"
                        name="Distance"
                        stroke="#f97316"
                        strokeWidth={3}
                      />
                      <Line
                        type="monotone"
                        dataKey="avgHr"
                        name="Avg HR (bpm)"
                        stroke="#10b981"
                        strokeWidth={2}
                      />
                    </LineChart>
                  ) : (
                    <LineChart data={exercisePerformanceSeries}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
                      <XAxis dataKey="shortDate" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--bg-card)',
                        borderColor: 'var(--border-card)',
                        color: 'var(--text-primary)',
                          borderRadius: '12px',
                          fontSize: '12px',
                        }}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="estimated1RmKg"
                        name="Est. 1RM (kg)"
                        stroke="#f97316"
                        strokeWidth={3}
                      />
                      <Line
                        type="monotone"
                        dataKey="topSetWeight"
                        name="Top Set Weight (kg)"
                        stroke="#10b981"
                        strokeWidth={2}
                      />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-200 dark:border-slate-800 text-center text-xs text-slate-400">
              No completed logs for this exercise yet.
            </div>
          )}

          {/* Chronological Table of Performances for Selected Exercise */}
          <div className="space-y-2.5">
            {exercisePerformanceSeries
              .slice()
              .reverse()
              .map((item) => (
                <div
                  key={item.logUuid}
                  className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 tabular-nums">
                        {item.displayId}
                      </span>
                      <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                        {formatReadableDate(item.date)}
                      </span>
                      <span className="text-xs text-slate-500">in {item.workoutTitle}</span>
                    </div>
                    {item.notes && (
                      <p className="text-xs text-slate-500 italic">"{item.notes}"</p>
                    )}
                  </div>

                  {item.trackingType === 'cardio' ? (
                    <div className="font-mono text-xs tabular-nums flex items-center gap-3">
                      <span>
                        <strong>{item.distance}</strong> {item.distanceUnit}
                      </span>
                      <span className="text-orange-500 font-bold">
                        {formatPace(item.paceSecPerUnit, item.distanceUnit)}
                      </span>
                      {item.avgHr ? <span>{item.avgHr} bpm</span> : null}
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2 font-mono text-xs tabular-nums">
                      <span className="px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-bold">
                        Top: {item.topSetWeight}kg
                      </span>
                      <span className="text-slate-500">
                        [
                        {item.sets
                          .map((s) =>
                            s.weightOverride !== undefined && s.weightOverride !== item.baseWeight
                              ? `${s.reps}@${s.weightOverride}kg`
                              : s.reps
                          )
                          .join(', ')}
                        ]
                      </span>
                      <span className="font-bold text-orange-600 dark:text-orange-400">
                        {item.totalLoadKg.toLocaleString()} kg
                      </span>
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
};

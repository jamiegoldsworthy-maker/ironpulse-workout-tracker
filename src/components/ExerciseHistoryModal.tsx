import React from 'react';
import { X, History, Award, Dumbbell, Timer, Flame } from 'lucide-react';
import { useWorkoutStore } from '../store/useWorkoutStore';
import {
  formatLoadBadge,
  formatPace,
  formatReadableDate,
  formatSecondsAsMmSs,
} from '../utils/calculations';

interface ExerciseHistoryModalProps {
  exerciseUuid: string | null;
  exerciseName: string;
  currentPresetUuid?: string;
  onClose: () => void;
}

export const ExerciseHistoryModal: React.FC<ExerciseHistoryModalProps> = ({
  exerciseUuid,
  exerciseName,
  currentPresetUuid,
  onClose,
}) => {
  const getExerciseHistory = useWorkoutStore((s) => s.getExerciseHistory);

  if (!exerciseUuid) return null;

  const entries = getExerciseHistory(exerciseUuid, 10);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 animate-in fade-in duration-150">
      <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-orange-500/10 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0">
              <History className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-base text-slate-900 dark:text-slate-100 truncate">
                {exerciseName}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Last {entries.length} Completed Sessions
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            data-tooltip="Close history"
            title="Close history"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 overflow-y-auto space-y-3 flex-1">
          {entries.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <Dumbbell className="w-8 h-8 text-slate-300 dark:text-slate-600 mx-auto" />
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400">
                No completed history found for this exercise yet.
              </p>
              <p className="text-xs text-slate-400">
                Once you log and complete a session, set-by-set history and ghost text will appear here.
              </p>
            </div>
          ) : (
            entries.map((item, idx) => {
              const ex = item.exercise;
              const isSamePreset = currentPresetUuid && item.presetUuid === currentPresetUuid;
              return (
                <div
                  key={`${item.logUuid}-${idx}`}
                  className={`p-3.5 rounded-2xl border transition-all ${
                    idx === 0
                      ? 'border-orange-500/40 bg-orange-500/[0.03] dark:bg-orange-500/[0.06]'
                      : 'border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-md bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200 tabular-nums">
                        {item.displayId}
                      </span>
                      <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                        {formatReadableDate(item.date)}
                      </span>
                      {idx === 0 && (
                        <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-orange-500 text-white">
                          Latest
                        </span>
                      )}
                    </div>
                    <span
                      className={`text-[11px] font-medium px-2 py-0.5 rounded-full truncate ${
                        isSamePreset
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                          : 'bg-slate-200/70 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {item.workoutTitle}
                    </span>
                  </div>

                  {/* Performance Metrics */}
                  {ex.trackingType === 'cardio' ? (
                    <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums text-slate-700 dark:text-slate-200 mt-1">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-semibold">
                        <Timer className="w-3.5 h-3.5 text-orange-500" />
                        {ex.distance ?? 0} {ex.distanceUnit || 'mi'} in{' '}
                        {formatSecondsAsMmSs(ex.durationSec)}
                      </span>
                      <span className="px-2.5 py-1 rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400 font-bold">
                        {formatPace(ex.paceSecPerUnit, ex.distanceUnit || 'mi')}
                      </span>
                      {ex.ruckLoadKg ? (
                        <span className="px-2 py-1 rounded-xl bg-slate-200/70 dark:bg-slate-800">
                          {ex.ruckLoadKg}kg Ruck
                        </span>
                      ) : null}
                      {ex.avgHr ? (
                        <span className="px-2 py-1 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400">
                          {ex.avgHr} bpm
                        </span>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 font-mono tabular-nums">
                            {formatLoadBadge(ex.loadType, ex.weight, ex.ruckLoadKg, ex.secondaryWeightKg)}
                          </span>
                          {ex.trackingType === 'circuit' && ex.roundsCompleted ? (
                            <span className="text-xs font-semibold text-orange-600 dark:text-orange-400 inline-flex items-center gap-1">
                              <Flame className="w-3.5 h-3.5" />
                              {ex.roundsCompleted} rounds ({ex.workSecPerRound}s/{ex.restSecPerRound}s)
                            </span>
                          ) : null}
                          {ex.rir !== undefined && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300 tabular-nums">
                              RIR {ex.rir}
                            </span>
                          )}
                        </div>
                        <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                          <strong className="text-slate-800 dark:text-slate-200">
                            {ex.totalReps}
                          </strong>{' '}
                          reps •{' '}
                          <strong className="text-orange-600 dark:text-orange-400">
                            {ex.totalLoadKg.toLocaleString()} kg
                          </strong>
                          {ex.estimated1RmKg ? (
                            <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] text-emerald-600 dark:text-emerald-400">
                              <Award className="w-3 h-3" /> e1RM {ex.estimated1RmKg}kg
                            </span>
                          ) : null}
                        </div>
                      </div>

                      {/* Set Pills */}
                      {ex.sets && ex.sets.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {ex.sets.map((s, sIdx) => {
                            const hasOverride =
                              s.weightOverride !== undefined &&
                              s.weightOverride !== null &&
                              s.weightOverride !== ex.weight;
                            return (
                              <div
                                key={sIdx}
                                className={`px-2.5 py-1 rounded-lg text-xs font-mono font-bold tabular-nums border flex items-center gap-1 ${
                                  hasOverride
                                    ? 'bg-orange-500/10 border-orange-500/40 text-orange-700 dark:text-orange-300'
                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200'
                                }`}
                              >
                                <span className="text-[10px] font-normal text-slate-400">
                                  S{s.setNumber}:
                                </span>
                                <span>{s.reps}</span>
                                {hasOverride && (
                                  <span className="text-[10px] px-1 rounded bg-orange-500 text-white">
                                    @{s.weightOverride}kg
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {(ex.exerciseNotes || ex.splits) && (
                    <div className="mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 italic">
                      {ex.splits ? `Splits: ${ex.splits} ` : ''}
                      {ex.exerciseNotes}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

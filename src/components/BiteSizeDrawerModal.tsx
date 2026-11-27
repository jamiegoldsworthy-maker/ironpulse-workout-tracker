import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  Clock,
  ExternalLink,
  Pause,
  Play,
  RotateCcw,
  X,
  Zap,
} from 'lucide-react';
import { ModalPortal } from './ModalPortal';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { WorkoutPreset } from '../types/workout';
import { formatLoadBadge, formatReadableDate, formatSecondsAsMmSs } from '../utils/calculations';

interface BiteSizeDrawerModalProps {
  open: boolean;
  onClose: () => void;
  onLogged: (message: string) => void;
}

type BiteTypeFilter = 'All' | 'Mobility' | 'Physio' | 'Strength';
type BiteDurationFilter = 'all' | 3 | 5 | 10;

function playBiteCompletionChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const notes = [587.33, 880];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const start = ctx.currentTime + idx * 0.14;
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.25);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.26);
    });
  } catch {
    // Ignore audio context restrictions
  }
}

function matchesBiteTypeFilter(preset: WorkoutPreset, filter: BiteTypeFilter): boolean {
  if (filter === 'All') return true;
  const wt = (preset.workoutType || '').toLowerCase();
  const tags = (preset.tags || []).map((t) => t.toLowerCase());
  if (filter === 'Mobility') {
    return /mobility|yoga|stretch|decompression/.test(wt) || tags.includes('mobility');
  }
  if (filter === 'Physio') {
    return /physio|rehab|prehab/.test(wt) || tags.includes('physio');
  }
  if (filter === 'Strength') {
    return (
      /strength|conditioning|complex|circuit|core|bodyweight/.test(wt) ||
      tags.includes('strength') ||
      tags.includes('bodyweight') ||
      tags.includes('kettlebell')
    );
  }
  return true;
}

export const BiteSizeDrawerModal: React.FC<BiteSizeDrawerModalProps> = ({
  open,
  onClose,
  onLogged,
}) => {
  const { presets, activeDate, meta, logBiteSizeWorkout } = useWorkoutStore();

  const [typeFilter, setTypeFilter] = useState<BiteTypeFilter>('All');
  const [durationFilter, setDurationFilter] = useState<BiteDurationFilter>('all');
  const [loggingPresetId, setLoggingPresetId] = useState<string | null>(null);

  // Active Guided Timer state
  const [guidedPreset, setGuidedPreset] = useState<WorkoutPreset | null>(null);
  const [totalSec, setTotalSec] = useState<number>(300);
  const [remainingSec, setRemainingSec] = useState<number>(300);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [checkedSteps, setCheckedSteps] = useState<Record<number, boolean>>({});
  const autoCompletedRef = useRef<boolean>(false);

  // Reset transient state when modal opens/closes
  useEffect(() => {
    if (!open) {
      setGuidedPreset(null);
      setIsRunning(false);
      setCheckedSteps({});
      autoCompletedRef.current = false;
    }
  }, [open]);

  // Countdown tick for Guided Timer
  useEffect(() => {
    if (!open || !guidedPreset || !isRunning) return;
    const id = window.setInterval(() => {
      setRemainingSec((prev) => {
        if (prev <= 1) {
          window.clearInterval(id);
          setIsRunning(false);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [open, guidedPreset, isRunning]);

  // Auto-complete when guided timer finishes
  useEffect(() => {
    if (!open || !guidedPreset || remainingSec !== 0 || autoCompletedRef.current) return;
    autoCompletedRef.current = true;
    if (meta.timerSoundEnabled !== false) {
      playBiteCompletionChime();
    }
    const mins = Math.max(1, Math.round(totalSec / 60));
    void (async () => {
      setLoggingPresetId(guidedPreset.presetUuid);
      const res = await logBiteSizeWorkout(guidedPreset.presetUuid, {
        date: activeDate,
        durationMinutes: mins,
        elapsedSeconds: totalSec,
      });
      setLoggingPresetId(null);
      if (res.ok) {
        onLogged(`⚡ Completed ${guidedPreset.title} (${mins}m)`);
        onClose();
      }
    })();
  }, [
    open,
    guidedPreset,
    remainingSec,
    totalSec,
    activeDate,
    meta.timerSoundEnabled,
    logBiteSizeWorkout,
    onLogged,
    onClose,
  ]);

  const biteSizePresets = useMemo(() => {
    return presets
      .filter((p) => {
        if (p.isArchived) return false;
        const isEligible =
          p.isBiteSize === true ||
          (typeof p.durationMinutes === 'number' && p.durationMinutes > 0 && p.durationMinutes <= 10);
        if (!isEligible) return false;
        if (!matchesBiteTypeFilter(p, typeFilter)) return false;
        if (durationFilter !== 'all') {
          const dur = p.durationMinutes ?? 5;
          if (dur > durationFilter) return false;
        }
        return true;
      })
      .sort((a, b) => (a.durationMinutes ?? 5) - (b.durationMinutes ?? 5) || a.title.localeCompare(b.title));
  }, [presets, typeFilter, durationFilter]);

  const handleStartGuidedTimer = (preset: WorkoutPreset) => {
    const mins = Math.max(1, Math.round(preset.durationMinutes ?? 5));
    const secs = mins * 60;
    autoCompletedRef.current = false;
    setGuidedPreset(preset);
    setTotalSec(secs);
    setRemainingSec(secs);
    setCheckedSteps({});
    setIsRunning(true);
  };

  const handleQuickLogDone = async (preset: WorkoutPreset) => {
    setLoggingPresetId(preset.presetUuid);
    const mins = Math.max(1, Math.round(preset.durationMinutes ?? 5));
    const res = await logBiteSizeWorkout(preset.presetUuid, {
      date: activeDate,
      durationMinutes: mins,
      elapsedSeconds: mins * 60,
    });
    setLoggingPresetId(null);
    if (res.ok) {
      onLogged(`⚡ Logged ${preset.title} (${mins}m)`);
      onClose();
    }
  };

  const handleFinishGuidedEarly = async () => {
    if (!guidedPreset || autoCompletedRef.current) return;
    autoCompletedRef.current = true;
    setIsRunning(false);
    const elapsed = Math.max(30, totalSec - remainingSec);
    const mins = Math.max(1, Math.round((guidedPreset.durationMinutes ?? totalSec / 60)));
    setLoggingPresetId(guidedPreset.presetUuid);
    const res = await logBiteSizeWorkout(guidedPreset.presetUuid, {
      date: activeDate,
      durationMinutes: mins,
      elapsedSeconds: elapsed,
    });
    setLoggingPresetId(null);
    if (res.ok) {
      onLogged(`⚡ Completed ${guidedPreset.title} (${mins}m)`);
      onClose();
    }
  };

  const progressPct = totalSec > 0 ? Math.min(100, Math.max(0, ((totalSec - remainingSec) / totalSec) * 100)) : 0;

  return (
    <ModalPortal open={open} onClose={onClose} tier="primary" sheetOnMobile>
      <div className="w-full max-w-lg rounded-t-3xl sm:rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden max-h-[88vh] flex flex-col">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {guidedPreset && (
              <button
                type="button"
                onClick={() => {
                  setIsRunning(false);
                  setGuidedPreset(null);
                }}
                aria-label="Back to Bite-Size list"
                className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-orange-500"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            )}
            <div className="w-8 h-8 rounded-2xl bg-amber-500/15 text-amber-500 flex items-center justify-center shrink-0">
              <Zap className="w-4 h-4 fill-current" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-sm sm:text-base truncate">
                {guidedPreset ? guidedPreset.title : 'Bite-Size Movement Snacks'}
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                {guidedPreset
                  ? `Guided ${Math.round(totalSec / 60)}m countdown · ${formatReadableDate(activeDate)}`
                  : `Quick-log onto ${formatReadableDate(activeDate)} (no schedule or Tasks clutter)`}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Bite-Size drawer"
            className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 hover:text-slate-900 dark:hover:text-white shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* BODY: Guided Timer Mode vs 3-Tap Selection List */}
        {guidedPreset ? (
          <div className="p-4 sm:p-5 overflow-y-auto overscroll-contain space-y-4 flex-1">
            {/* Countdown Display */}
            <div className="p-5 rounded-3xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200/80 dark:border-slate-700/80 text-center space-y-3">
              <div className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                ⚡ Bite-Size Guided Timer
              </div>
              <div className="font-mono font-extrabold text-5xl tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
                {formatSecondsAsMmSs(remainingSec)}
              </div>
              <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden">
                <div
                  className="h-full bg-amber-500 transition-all duration-500"
                  style={{ width: `${progressPct}%` }}
                />
              </div>

              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsRunning((r) => !r)}
                  className="px-5 py-2.5 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-md"
                >
                  {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
                  {isRunning ? 'Pause' : 'Resume'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTotalSec((t) => t + 30);
                    setRemainingSec((r) => r + 30);
                  }}
                  className="px-3 py-2.5 rounded-2xl bg-slate-200/80 dark:bg-slate-700 text-xs font-bold"
                >
                  +30s
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setIsRunning(false);
                    setRemainingSec(totalSec);
                  }}
                  aria-label="Reset timer"
                  className="p-2.5 rounded-2xl bg-slate-200/80 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Prominent Follow-Along YouTube Video CTA inside Guided Timer */}
            {guidedPreset.videoUrl && (
              <a
                href={guidedPreset.videoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full py-2.5 px-4 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center justify-center gap-2 shadow-sm shadow-rose-600/20 transition-colors"
              >
                <Play className="w-4 h-4 fill-current shrink-0" />
                <span>Open Follow-Along Video</span>
                <ExternalLink className="w-3.5 h-3.5 opacity-85 shrink-0" />
              </a>
            )}

            {/* Movement Checklist */}
            {guidedPreset.exercises.length > 0 && (
              <div className="space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Movements ({guidedPreset.exercises.length})
                </div>
                {guidedPreset.exercises.map((ex, idx) => {
                  const done = Boolean(checkedSteps[idx]);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() =>
                        setCheckedSteps((prev) => ({ ...prev, [idx]: !prev[idx] }))
                      }
                      className={`w-full text-left p-3 rounded-2xl border flex items-start gap-2.5 transition-all ${
                        done
                          ? 'bg-emerald-500/10 border-emerald-500/35 opacity-80'
                          : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200/70 dark:border-slate-800'
                      }`}
                    >
                      <span
                        className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold ${
                          done
                            ? 'bg-emerald-500 text-white'
                            : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {done ? <Check className="w-3 h-3" /> : idx + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`text-xs font-bold ${
                              done ? 'line-through text-slate-500' : 'text-slate-900 dark:text-slate-100'
                            }`}
                          >
                            {ex.exerciseName}
                          </span>
                          <span className="font-mono text-[11px] font-semibold text-orange-600 dark:text-orange-400 shrink-0">
                            {ex.trackingType === 'mobility'
                              ? ex.defaultReps || (ex.defaultDurationMin ? `${ex.defaultDurationMin}m` : 'Flow')
                              : `${ex.defaultSets}×${ex.defaultReps}${
                                  ex.loadType !== 'bodyweight' && ex.loadType !== 'none'
                                    ? ` @ ${formatLoadBadge(ex.loadType, ex.defaultWeight)}`
                                    : ''
                                }`}
                          </span>
                        </div>
                        {ex.baseNotes && (
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                            {ex.baseNotes}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="pt-1 flex justify-end">
              <button
                type="button"
                disabled={Boolean(loggingPresetId)}
                onClick={() => void handleFinishGuidedEarly()}
                className="w-full py-2.5 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-sm"
              >
                <CheckCircle2 className="w-4 h-4" />
                {loggingPresetId ? 'Logging...' : 'Finish & Log Done'}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-4 space-y-3.5 overflow-y-auto overscroll-contain flex-1">
            {/* Compact 2-Row Filter Pills (Type + Duration) */}
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                {(['All', 'Mobility', 'Physio', 'Strength'] as BiteTypeFilter[]).map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => setTypeFilter(tf)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                      typeFilter === tf
                        ? 'bg-orange-500 text-white shadow-xs'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {(
                  [
                    { id: 'all', label: 'All Durations' },
                    { id: 3, label: '≤3 min' },
                    { id: 5, label: '≤5 min' },
                    { id: 10, label: '≤10 min' },
                  ] as Array<{ id: BiteDurationFilter; label: string }>
                ).map((df) => (
                  <button
                    key={String(df.id)}
                    type="button"
                    onClick={() => setDurationFilter(df.id)}
                    className={`px-2.5 py-1 rounded-xl text-[11px] font-bold inline-flex items-center gap-1 border transition-all ${
                      durationFilter === df.id
                        ? 'bg-amber-500/15 border-amber-500 text-amber-700 dark:text-amber-300'
                        : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200/80 dark:border-slate-700 text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    <Clock className="w-3 h-3" />
                    {df.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Eligible Bite-Size Presets */}
            {biteSizePresets.length === 0 ? (
              <div className="p-6 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 text-center space-y-1.5">
                <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
                  No Bite-Size routines match these filters
                </p>
                <p className="text-[11px] text-slate-500">
                  Toggle "Bite-Size / Movement Snack" or set duration ≤10m on any preset in Library.
                </p>
              </div>
            ) : (
              <div className="space-y-2.5">
                {biteSizePresets.map((preset) => {
                  const mins = preset.durationMinutes ?? 5;
                  const isBusy = loggingPresetId === preset.presetUuid;
                  return (
                    <div
                      key={preset.presetUuid}
                      className="p-3.5 rounded-2xl bg-slate-50/80 dark:bg-slate-800/50 border border-slate-200/80 dark:border-slate-800 space-y-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5 mb-1">
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-700 dark:text-amber-300">
                              ⚡ {mins}m
                            </span>
                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase bg-orange-500/12 text-orange-600 dark:text-orange-400">
                              {preset.workoutType}
                            </span>
                            {preset.videoUrl && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold bg-rose-500/12 text-rose-600 dark:text-rose-400">
                                <Play className="w-2.5 h-2.5 fill-current" />
                                Video
                              </span>
                            )}
                          </div>
                          <h4 className="font-display font-bold text-sm text-slate-900 dark:text-slate-100 leading-snug">
                            {preset.title}
                          </h4>
                        </div>
                      </div>

                      {preset.videoUrl && (
                        <a
                          href={preset.videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full py-2 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-xs transition-colors"
                        >
                          <Play className="w-3.5 h-3.5 fill-current shrink-0" />
                          <span>Open Follow-Along Video</span>
                          <ExternalLink className="w-3 h-3 opacity-85 shrink-0" />
                        </a>
                      )}

                      {preset.exercises.length > 0 && (
                        <div className="text-[11px] text-slate-600 dark:text-slate-300 leading-relaxed">
                          {preset.exercises.map((ex) => ex.exerciseName).join(' · ')}
                        </div>
                      )}

                      <div className="grid grid-cols-2 gap-2 pt-0.5">
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => handleStartGuidedTimer(preset)}
                          className="py-2 px-3 rounded-xl bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                        >
                          <Play className="w-3.5 h-3.5 fill-current text-amber-400" />
                          Start Guided Timer
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleQuickLogDone(preset)}
                          className="py-2 px-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-xs transition-colors disabled:opacity-50"
                        >
                          <Check className="w-3.5 h-3.5" />
                          {isBusy ? 'Logging...' : 'Quick-Log Done'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </ModalPortal>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import {
  Timer,
  Play,
  Pause,
  RotateCcw,
  ChevronUp,
  ChevronDown,
  Zap,
  Volume2,
  VolumeX,
  Flame,
} from 'lucide-react';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { formatSecondsAsMmSs } from '../utils/calculations';

function playTimerBeep(type: 'countdown' | 'work' | 'rest' | 'finish') {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    if (type === 'countdown') {
      osc.frequency.setValueAtTime(520, now);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      osc.start(now);
      osc.stop(now + 0.12);
    } else if (type === 'work') {
      osc.frequency.setValueAtTime(880, now);
      gain.gain.setValueAtTime(0.25, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.35);
    } else if (type === 'rest') {
      osc.frequency.setValueAtTime(440, now);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.3);
    } else {
      osc.frequency.setValueAtTime(660, now);
      osc.frequency.setValueAtTime(990, now + 0.15);
      gain.gain.setValueAtTime(0.28, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
      osc.start(now);
      osc.stop(now + 0.5);
    }

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(type === 'finish' ? [180, 80, 220] : type === 'countdown' ? 40 : 120);
    }
  } catch {
    // Ignore audio context restrictions if not interacted yet
  }
}

export const LiveTimerBar: React.FC = () => {
  const {
    timer,
    meta,
    viewportMode,
    startRestTimer,
    startCircuitTimer,
    toggleTimerRunning,
    resetTimer,
    setTimerExpanded,
    tickTimer,
    setDefaultAutoStartRestTimer,
  } = useWorkoutStore();

  const [soundEnabled, setSoundEnabled] = useState(true);
  const [customRestSec, setCustomRestSec] = useState(75);
  const [circuitRounds, setCircuitRounds] = useState(timer.totalRounds || 15);
  const [circuitWorkSec, setCircuitWorkSec] = useState(timer.workSec || 60);
  const [circuitRestSec, setCircuitRestSec] = useState(timer.restSec ?? 0);
  const wakeLockRef = useRef<any>(null);

  useEffect(() => {
    setCircuitRounds(timer.totalRounds);
    setCircuitWorkSec(timer.workSec);
    setCircuitRestSec(timer.restSec);
  }, [timer.totalRounds, timer.workSec, timer.restSec]);

  useEffect(() => {
    const requestWakeLock = async () => {
      if (timer.isRunning && 'wakeLock' in navigator) {
        try {
          wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        } catch {
          // ignore
        }
      } else if (!timer.isRunning && wakeLockRef.current) {
        try {
          await wakeLockRef.current.release();
          wakeLockRef.current = null;
        } catch {
          // ignore
        }
      }
    };
    requestWakeLock();
    return () => {
      if (wakeLockRef.current) {
        wakeLockRef.current.release().catch(() => {});
      }
    };
  }, [timer.isRunning]);

  useEffect(() => {
    if (!timer.isRunning) return;
    const interval = setInterval(() => {
      const currentRem = useWorkoutStore.getState().timer.remainingSec;
      if (soundEnabled && currentRem > 1 && currentRem <= 4) {
        playTimerBeep('countdown');
      }
      const res = tickTimer();
      if (soundEnabled && res.phaseChanged) {
        if (res.finished) {
          playTimerBeep('finish');
        } else if (res.nextPhase === 'work') {
          playTimerBeep('work');
        } else {
          playTimerBeep('rest');
        }
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [timer.isRunning, soundEnabled, tickTimer]);

  const progressPct =
    timer.totalPhaseSec > 0
      ? Math.max(0, Math.min(100, ((timer.totalPhaseSec - timer.remainingSec) / timer.totalPhaseSec) * 100))
      : 0;

  const isWorkPhase = timer.mode === 'circuit' && timer.phase === 'work';
  const isForcedMobile = viewportMode === 'mobile';
  const isForcedDesktop = viewportMode === 'desktop';

  const containerPositionClass = isForcedMobile
    ? 'sticky bottom-14 left-0 right-0 z-30 px-2.5 pb-1'
    : isForcedDesktop
    ? 'fixed bottom-4 left-60 right-0 z-30 px-3 pointer-events-none'
    : 'fixed bottom-16 md:bottom-4 left-0 right-0 md:left-60 z-30 px-3 pointer-events-none';

  return (
    <div className={containerPositionClass}>
      <div className="max-w-3xl mx-auto pointer-events-auto">
        <div
          className={`rounded-2xl shadow-xl border transition-all duration-200 overflow-hidden backdrop-blur-md ${
            timer.isRunning
              ? isWorkPhase
                ? 'bg-orange-600/95 text-white border-orange-400 shadow-orange-500/25'
                : 'bg-slate-900/95 text-white border-slate-700 shadow-slate-950/40'
              : 'bg-white/95 dark:bg-slate-900/95 text-slate-900 dark:text-slate-100 border-slate-200/80 dark:border-slate-800'
          }`}
        >
          {/* Progress Strip */}
          <div className="h-1 w-full bg-black/10 dark:bg-white/10">
            <div
              className={`h-full transition-all duration-300 ${
                timer.isRunning
                  ? isWorkPhase
                    ? 'bg-white'
                    : 'bg-orange-500'
                  : 'bg-orange-500'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>

          {/* Compact Bar Header */}
          <div className="flex items-center justify-between px-2.5 sm:px-3.5 py-2 gap-1.5 sm:gap-2">
            <div
              onClick={() => setTimerExpanded(!timer.isExpanded)}
              title="Click to expand or collapse timer controls"
              className="flex items-center gap-2 sm:gap-3 cursor-pointer select-none flex-1 min-w-0"
            >
              <div
                className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center shrink-0 ${
                  timer.isRunning
                    ? isWorkPhase
                      ? 'bg-white/20 text-white'
                      : 'bg-orange-500 text-white'
                    : 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
                }`}
              >
                {timer.mode === 'circuit' ? <Flame className="w-4 h-4 sm:w-5 sm:h-5" /> : <Timer className="w-4 h-4 sm:w-5 sm:h-5" />}
              </div>

              <div className="flex items-baseline gap-2 min-w-0">
                <span className="font-mono text-xl sm:text-2xl font-bold tracking-tight tabular-nums shrink-0">
                  {formatSecondsAsMmSs(timer.remainingSec)}
                </span>

                {timer.mode === 'circuit' ? (
                  <div className="flex items-center gap-1.5 truncate">
                    <span
                      className={`text-[10px] sm:text-[11px] font-bold uppercase tracking-wider px-1.5 sm:px-2 py-0.5 rounded-full shrink-0 ${
                        timer.phase === 'work'
                          ? timer.isRunning
                            ? 'bg-white text-orange-600'
                            : 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
                          : 'bg-slate-700 text-slate-200'
                      }`}
                    >
                      {timer.phase === 'work' ? 'WORK' : 'REST'}
                    </span>
                    <span className="text-[11px] sm:text-xs font-semibold opacity-90 tabular-nums truncate">
                      {timer.currentRound}/{timer.totalRounds}
                    </span>
                  </div>
                ) : (
                  <span className="text-[11px] sm:text-xs font-medium opacity-75 truncate">
                    Rest {meta.defaultAutoStartRestTimer ? '• Auto' : ''}
                  </span>
                )}
              </div>
            </div>

            {/* Quick Bar Controls */}
            <div className="flex items-center gap-1 shrink-0">
              {!timer.isRunning && timer.mode === 'rest' && !isForcedMobile && (
                <div className="hidden sm:flex items-center gap-1 mr-1">
                  {[60, 90, 120].map((sec) => (
                    <button
                      key={sec}
                      type="button"
                      data-tooltip={`Start ${sec}s rest countdown`}
                      title={`Start ${sec}s rest countdown`}
                      onClick={() => startRestTimer(sec)}
                      className="px-2 py-1 text-xs font-semibold tabular-nums rounded-lg bg-slate-100 hover:bg-orange-500 hover:text-white dark:bg-slate-800 dark:hover:bg-orange-500 transition-colors"
                    >
                      {sec === 120 ? '2m' : `${sec}s`}
                    </button>
                  ))}
                </div>
              )}

              <button
                type="button"
                data-tooltip={timer.isRunning ? 'Pause timer' : 'Start timer'}
                title={timer.isRunning ? 'Pause timer' : 'Start timer'}
                onClick={toggleTimerRunning}
                className={`px-3 py-1.5 rounded-xl font-semibold text-xs flex items-center gap-1.5 transition-all ${
                  timer.isRunning
                    ? 'bg-white/20 hover:bg-white/30 text-white'
                    : 'bg-orange-500 hover:bg-orange-600 text-white shadow-sm'
                }`}
              >
                {timer.isRunning ? (
                  <>
                    <Pause className="w-3.5 h-3.5" /> Pause
                  </>
                ) : (
                  <>
                    <Play className="w-3.5 h-3.5 fill-current" /> Start
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={resetTimer}
                data-tooltip="Reset timer"
                title="Reset timer"
                className="p-2 rounded-xl hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={() => setTimerExpanded(!timer.isExpanded)}
                data-tooltip={timer.isExpanded ? 'Collapse timer drawer' : 'Timer presets & EMOM'}
                title={timer.isExpanded ? 'Collapse timer drawer' : 'Expand timer settings'}
                className="p-2 rounded-xl hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
              >
                {timer.isExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronUp className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          {/* Expanded Drawer Content */}
          {timer.isExpanded && (
            <div className="px-4 pb-4 pt-2 border-t border-black/10 dark:border-white/10 bg-slate-50/95 dark:bg-slate-900/95 text-slate-900 dark:text-slate-100 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-xl bg-slate-200/80 dark:bg-slate-800 p-1">
                  <button
                    type="button"
                    onClick={() => startRestTimer(60)}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                      timer.mode === 'rest'
                        ? 'bg-white dark:bg-slate-900 text-orange-600 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Rest Timer
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      startCircuitTimer(circuitRounds, circuitWorkSec, circuitRestSec)
                    }
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                      timer.mode === 'circuit'
                        ? 'bg-white dark:bg-slate-900 text-orange-600 shadow-sm'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Circuit / EMOM
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <label
                    title="Automatically start rest countdown whenever you enter a set's reps"
                    className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={meta.defaultAutoStartRestTimer}
                      onChange={(e) => setDefaultAutoStartRestTimer(e.target.checked)}
                      className="rounded border-slate-300 text-orange-500 focus:ring-orange-500"
                    />
                    Auto-rest on set log
                  </label>

                  <button
                    type="button"
                    onClick={() => setSoundEnabled(!soundEnabled)}
                    data-tooltip={soundEnabled ? 'Mute timer beeps' : 'Unmute timer beeps'}
                    title="Toggle audio & vibration alerts"
                    className="p-1.5 rounded-lg bg-slate-200/70 dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                  >
                    {soundEnabled ? (
                      <Volume2 className="w-4 h-4 text-orange-500" />
                    ) : (
                      <VolumeX className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Rest Presets */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  Quick Rest Presets
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {[
                    { label: '30s', sec: 30 },
                    { label: '45s', sec: 45 },
                    { label: '60s', sec: 60 },
                    { label: '90s', sec: 90 },
                    { label: '2m', sec: 120 },
                    { label: '3m', sec: 180 },
                  ].map((preset) => (
                    <button
                      key={preset.sec}
                      type="button"
                      onClick={() => startRestTimer(preset.sec)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold tabular-nums transition-all ${
                        timer.mode === 'rest' && timer.totalPhaseSec === preset.sec
                          ? 'bg-orange-500 text-white shadow-sm'
                          : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:border-orange-400'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}

                  <div className="flex items-center gap-1 ml-auto">
                    <input
                      type="number"
                      min={5}
                      max={900}
                      value={customRestSec}
                      onChange={(e) => setCustomRestSec(parseInt(e.target.value, 10) || 60)}
                      className="w-16 px-2 py-1 text-xs font-mono tabular-nums rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-center"
                    />
                    <button
                      type="button"
                      onClick={() => startRestTimer(customRestSec)}
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-900 dark:bg-slate-700 text-white hover:bg-orange-500 transition-colors"
                    >
                      Set Sec
                    </button>
                  </div>
                </div>
              </div>

              {/* Circuit / EMOM Builder */}
              <div className="pt-2 border-t border-slate-200/70 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Circuit / EMOM Intervals (0s Rest = Continuous EMOM)
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setCircuitRounds(15);
                        setCircuitWorkSec(60);
                        setCircuitRestSec(0);
                        startCircuitTimer(15, 60, 0);
                      }}
                      className="text-[11px] px-2 py-0.5 rounded bg-orange-500/10 text-orange-600 dark:text-orange-400 font-semibold hover:bg-orange-500/20"
                    >
                      15m EMOM
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCircuitRounds(12);
                        setCircuitWorkSec(40);
                        setCircuitRestSec(20);
                        startCircuitTimer(12, 40, 20);
                      }}
                      className="text-[11px] px-2 py-0.5 rounded bg-orange-500/10 text-orange-600 dark:text-orange-400 font-semibold hover:bg-orange-500/20"
                    >
                      12× 40s/20s
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                      Rounds
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={circuitRounds}
                      onChange={(e) => setCircuitRounds(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-full px-2.5 py-1.5 text-xs font-mono font-bold tabular-nums rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
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
                      value={circuitWorkSec}
                      onChange={(e) =>
                        setCircuitWorkSec(Math.max(5, parseInt(e.target.value, 10) || 60))
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono font-bold tabular-nums rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">
                      Rest (sec)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={3600}
                      value={circuitRestSec}
                      onChange={(e) =>
                        setCircuitRestSec(Math.max(0, parseInt(e.target.value, 10) || 0))
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono font-bold tabular-nums rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      startCircuitTimer(circuitRounds, circuitWorkSec, circuitRestSec)
                    }
                    className="py-1.5 px-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-xs flex items-center justify-center gap-1 shadow-sm transition-colors"
                  >
                    <Zap className="w-3.5 h-3.5" /> Start
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

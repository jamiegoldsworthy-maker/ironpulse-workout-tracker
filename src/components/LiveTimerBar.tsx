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
  Minimize2,
  Maximize2,
} from 'lucide-react';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { formatSecondsAsMmSs } from '../utils/calculations';

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: typeof AudioContext;
}

function playTimerBeep(type: 'countdown' | 'work' | 'rest' | 'finish') {
  try {
    const AudioCtx =
      window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-12, ctx.currentTime);
    compressor.knee.setValueAtTime(12, ctx.currentTime);
    compressor.ratio.setValueAtTime(8, ctx.currentTime);
    compressor.attack.setValueAtTime(0.002, ctx.currentTime);
    compressor.release.setValueAtTime(0.15, ctx.currentTime);
    compressor.connect(ctx.destination);

    const playTone = (
      freq: number,
      startTime: number,
      duration: number,
      peakGain: number,
      wave: OscillatorType = 'triangle'
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq, startTime);
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
      osc.connect(gain);
      gain.connect(compressor);
      osc.start(startTime);
      osc.stop(startTime + duration);
    };

    const now = ctx.currentTime;
    if (type === 'countdown') {
      playTone(880, now, 0.14, 0.55, 'triangle');
    } else if (type === 'work') {
      playTone(1046.5, now, 0.28, 0.65, 'square');
    } else if (type === 'rest') {
      playTone(659.25, now, 0.25, 0.5, 'triangle');
    } else {
      // Loud 1320 Hz double-chime on 0
      playTone(1320, now, 0.18, 0.8, 'triangle');
      playTone(1320, now + 0.2, 0.35, 0.85, 'triangle');
    }

    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate(type === 'finish' ? [180, 80, 220] : type === 'countdown' ? 50 : 120);
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
    finishCircuitWorkRound,
    toggleTimerRunning,
    resetTimer,
    setTimerExpanded,
    tickTimer,
    setDefaultAutoStartRestTimer,
    setTimerSoundEnabled,
    sessionStopwatchStartMs,
    sessionStopwatchAccumulatedMs,
    startSessionStopwatch,
    pauseSessionStopwatch,
    resetSessionStopwatch,
  } = useWorkoutStore();

  const soundEnabled = meta.timerSoundEnabled !== false;
  const [drawerTab, setDrawerTab] = useState<'rest' | 'circuit' | 'stopwatch'>(timer.mode);
  const [stopwatchNowMs, setStopwatchNowMs] = useState(() => Date.now());
  const [customRestInput, setCustomRestInput] = useState('75');
  const [circuitRoundsInput, setCircuitRoundsInput] = useState(String(timer.totalRounds ?? 15));
  const [circuitWorkInput, setCircuitWorkInput] = useState(String(timer.workSec ?? 60));
  const [circuitRestInput, setCircuitRestInput] = useState(String(timer.restSec ?? 0));
  const [isFocusMinimized, setIsFocusMinimized] = useState(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const timerCardRef = useRef<HTMLDivElement>(null);
  const prevRunningRef = useRef<boolean>(timer.isRunning);

  const parseOrZero = (raw: string): number => {
    const parsed = parseInt(raw, 10);
    return Number.isNaN(parsed) ? 0 : Math.max(0, parsed);
  };

  useEffect(() => {
    setDrawerTab((prev) => (prev === 'stopwatch' ? prev : timer.mode));
  }, [timer.mode]);

  // Auto-expand into Focus Mode and smoothly scroll into view whenever timer starts
  useEffect(() => {
    const wasRunning = prevRunningRef.current;
    prevRunningRef.current = timer.isRunning;
    if (timer.isRunning && !wasRunning) {
      setIsFocusMinimized(false);
      if (useWorkoutStore.getState().timer.isExpanded) {
        setTimerExpanded(false);
      }
      requestAnimationFrame(() => {
        const prefersReduced =
          typeof window !== 'undefined' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        timerCardRef.current?.scrollIntoView({
          behavior: prefersReduced ? 'auto' : 'smooth',
          block: 'nearest',
        });
      });
    } else if (!timer.isRunning && wasRunning) {
      setIsFocusMinimized(false);
    }
  }, [timer.isRunning, setTimerExpanded]);

  useEffect(() => {
    if (sessionStopwatchStartMs === null) return;
    setStopwatchNowMs(Date.now());
    const id = setInterval(() => setStopwatchNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [sessionStopwatchStartMs]);

  const totalStopwatchMs =
    sessionStopwatchAccumulatedMs +
    (sessionStopwatchStartMs !== null ? Math.max(0, stopwatchNowMs - sessionStopwatchStartMs) : 0);
  const totalStopwatchSec = Math.floor(totalStopwatchMs / 1000);
  const stopwatchActive = sessionStopwatchStartMs !== null || sessionStopwatchAccumulatedMs > 0;

  const formatStopwatch = (sec: number): string => {
    const hrs = Math.floor(sec / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const rem = sec % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}`;
  };

  useEffect(() => {
    setCircuitRoundsInput(String(timer.totalRounds ?? 0));
    setCircuitWorkInput(String(timer.workSec ?? 0));
    setCircuitRestInput(String(timer.restSec ?? 0));
  }, [timer.totalRounds, timer.workSec, timer.restSec]);

  useEffect(() => {
    const requestWakeLock = async () => {
      if (timer.isRunning && 'wakeLock' in navigator && navigator.wakeLock) {
        try {
          wakeLockRef.current = await navigator.wakeLock.request('screen');
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
  const isCircuitRestPhase = timer.mode === 'circuit' && timer.phase === 'rest';
  const isRepBasedWork = timer.mode === 'circuit' && timer.workSec === 0 && timer.phase === 'work';
  const isFocusedActive = timer.isRunning && !isFocusMinimized;

  const phaseBadgeLabel =
    timer.mode === 'circuit'
      ? timer.phase === 'work'
        ? 'WORK'
        : 'REST'
      : 'COUNTDOWN';
  const phaseAccentVar = isCircuitRestPhase ? 'var(--accent-sage)' : 'var(--accent-orange)';
  const focusGlowClass = isCircuitRestPhase
    ? 'timer-focus-glow-sage'
    : 'timer-focus-glow-orange';

  const ringSize = 156;
  const ringStrokeWidth = 10;
  const ringRadius = (ringSize - ringStrokeWidth) / 2;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const remainingFraction = isRepBasedWork
    ? 1
    : timer.totalPhaseSec > 0
    ? Math.max(0, Math.min(1, timer.remainingSec / timer.totalPhaseSec))
    : 0;
  // Negative strokeDashoffset shifts the start of the arc clockwise from 12 o'clock as time elapses
  const ringDashOffset = -ringCircumference * (1 - remainingFraction);

  const isForcedMobile = viewportMode === 'mobile';
  const isForcedDesktop = viewportMode === 'desktop';

  const containerPositionClass = isForcedMobile
    ? 'sticky bottom-14 left-0 right-0 z-30 px-2.5 pb-1'
    : isForcedDesktop
    ? 'fixed bottom-4 left-60 right-0 z-30 px-3 pointer-events-none'
    : 'fixed bottom-16 md:bottom-4 left-0 right-0 md:left-60 z-30 px-3 pointer-events-none';

  return (
    <div data-no-swipe="true" className={`${containerPositionClass} max-w-full overflow-x-hidden`}>
      <div className="max-w-3xl w-full mx-auto pointer-events-auto">
        <div
          ref={timerCardRef}
          style={{
            backgroundColor: isFocusedActive
              ? 'var(--bg-card)'
              : timer.isRunning
              ? isWorkPhase
                ? 'var(--accent-rust)'
                : 'var(--bg-card)'
              : 'var(--bg-card)',
            borderColor: isFocusedActive
              ? phaseAccentVar
              : timer.isRunning
              ? 'var(--accent-orange)'
              : 'var(--border-card)',
            color:
              !isFocusedActive && timer.isRunning && isWorkPhase
                ? '#F7F3EE'
                : 'var(--text-primary)',
          }}
          className={`rounded-2xl shadow-lg border transition-all duration-200 overflow-hidden backdrop-blur-md ${
            isFocusedActive ? focusGlowClass : ''
          }`}
        >
          {isFocusedActive ? (
            /* Active Timer Focus Mode with Large Circular Countdown */
            <div className="px-4 py-4 sm:px-5 sm:py-5 space-y-3.5">
              {/* Focus Top Bar */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: phaseAccentVar }}
                  />
                  <span className="text-xs font-display font-extrabold tracking-tight text-[var(--text-primary)] truncate">
                    {timer.mode === 'circuit' ? 'Interval / Circuit Timer' : 'Rest Countdown'}
                  </span>
                  {stopwatchActive && (
                    <span
                      title="Workout session stopwatch"
                      className="px-1.5 py-0.5 rounded-md bg-[var(--bg-inset)] border border-[var(--border-subtle)] text-[10px] font-mono font-bold text-[var(--accent-orange)] tabular-nums shrink-0"
                    >
                      ⏱{' '}
                      {totalStopwatchSec >= 60
                        ? `${Math.floor(totalStopwatchSec / 60)}m`
                        : `${totalStopwatchSec}s`}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => setTimerSoundEnabled(!soundEnabled)}
                    aria-label={soundEnabled ? 'Mute timer beeps' : 'Unmute timer beeps'}
                    title={soundEnabled ? 'Mute timer beeps' : 'Unmute timer beeps'}
                    className="tactile-btn p-1.5 rounded-xl bg-[var(--bg-inset)] border border-[var(--border-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    {soundEnabled ? (
                      <Volume2 className="w-3.5 h-3.5 text-orange-500" />
                    ) : (
                      <VolumeX className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsFocusMinimized(true)}
                    title="Minimize to compact bar while timer keeps running"
                    className="tactile-btn px-2.5 py-1.5 rounded-xl bg-[var(--bg-inset)] border border-[var(--border-card)] text-[11px] font-bold text-[var(--text-secondary)] hover:text-[var(--text-primary)] inline-flex items-center gap-1"
                  >
                    <Minimize2 className="w-3.5 h-3.5" />
                    Minimize
                  </button>
                </div>
              </div>

              {/* Center Circular Progress Ring */}
              <div className="flex flex-col items-center justify-center py-1">
                <div
                  className="relative flex items-center justify-center"
                  style={{ width: ringSize, height: ringSize }}
                >
                  <svg
                    width={ringSize}
                    height={ringSize}
                    viewBox={`0 0 ${ringSize} ${ringSize}`}
                    className="block"
                    aria-hidden="true"
                  >
                    {/* Track Ring */}
                    <circle
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={ringRadius}
                      fill="none"
                      stroke="var(--border-subtle)"
                      strokeWidth={ringStrokeWidth}
                    />
                    {/* Clockwise Depleting Progress Arc */}
                    <circle
                      cx={ringSize / 2}
                      cy={ringSize / 2}
                      r={ringRadius}
                      fill="none"
                      stroke={phaseAccentVar}
                      strokeWidth={ringStrokeWidth}
                      strokeLinecap="round"
                      strokeDasharray={ringCircumference}
                      strokeDashoffset={ringDashOffset}
                      transform={`rotate(-90 ${ringSize / 2} ${ringSize / 2})`}
                      style={{
                        transition: 'stroke-dashoffset 0.85s linear, stroke 0.25s ease',
                      }}
                    />
                  </svg>

                  {/* Center Readout */}
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-3 select-none">
                    <span
                      className="text-[12px] font-extrabold uppercase tracking-[0.14em]"
                      style={{ color: phaseAccentVar }}
                    >
                      {phaseBadgeLabel}
                    </span>
                    <span
                      className="font-mono font-extrabold tracking-tight tabular-nums leading-none mt-1 text-[var(--text-primary)]"
                      style={{ fontSize: '38px', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {isRepBasedWork ? 'REPS' : formatSecondsAsMmSs(timer.remainingSec)}
                    </span>
                    {timer.mode === 'circuit' && (
                      <span className="mt-1.5 text-[11px] font-bold tabular-nums text-[var(--text-secondary)]">
                        Round {timer.currentRound} / {timer.totalRounds}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Focus Action Controls */}
              <div className="flex items-center justify-center gap-2">
                {isRepBasedWork ? (
                  <button
                    type="button"
                    onClick={finishCircuitWorkRound}
                    className="tactile-btn px-4 py-2 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs inline-flex items-center gap-1.5 shadow-sm"
                  >
                    <Zap className="w-4 h-4" />
                    {timer.restSec > 0
                      ? `Finish Round (${timer.restSec}s Rest)`
                      : 'Finish Round'}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={toggleTimerRunning}
                    className="tactile-btn px-5 py-2 rounded-2xl font-bold text-xs inline-flex items-center gap-1.5 shadow-sm text-white"
                    style={{ backgroundColor: phaseAccentVar }}
                  >
                    <Pause className="w-4 h-4" />
                    Pause
                  </button>
                )}

                <button
                  type="button"
                  onClick={resetTimer}
                  title="Reset timer"
                  className="tactile-btn px-3.5 py-2 rounded-2xl bg-[var(--bg-inset)] border border-[var(--border-card)] text-[var(--text-primary)] font-bold text-xs inline-flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset
                </button>

                <button
                  type="button"
                  onClick={() => setTimerExpanded(!timer.isExpanded)}
                  title={timer.isExpanded ? 'Hide timer settings' : 'Timer presets & settings'}
                  className="tactile-btn p-2 rounded-2xl bg-[var(--bg-inset)] border border-[var(--border-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                >
                  {timer.isExpanded ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronUp className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>
          ) : (
            <>
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
                    {timer.mode === 'circuit' ? (
                      <Flame className="w-4 h-4 sm:w-5 sm:h-5" />
                    ) : (
                      <Timer className="w-4 h-4 sm:w-5 sm:h-5" />
                    )}
                  </div>

                  <div className="flex items-baseline gap-2 min-w-0">
                    <span className="font-mono text-xl sm:text-2xl font-bold tracking-tight tabular-nums shrink-0">
                      {isRepBasedWork ? 'REPS' : formatSecondsAsMmSs(timer.remainingSec)}
                    </span>

                    {timer.mode === 'circuit' ? (
                      <div className="flex items-center gap-1.5 truncate">
                        <span
                          className={`text-[10px] sm:text-[11px] font-bold uppercase tracking-wider px-1.5 sm:px-2 py-0.5 rounded-full shrink-0 ${
                            timer.phase === 'work'
                              ? timer.isRunning
                                ? 'bg-white text-orange-600'
                                : 'bg-orange-500/15 text-orange-600 dark:text-orange-400'
                              : 'bg-[var(--bg-inset)] text-[var(--text-secondary)]'
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
                        Rest
                        {meta.defaultAutoStartRestTimer && (
                          <span className="hidden sm:inline"> • Auto</span>
                        )}
                      </span>
                    )}

                    {stopwatchActive && (
                      <span
                        title="Workout session stopwatch"
                        className="ml-1 px-1.5 py-0.5 rounded-md bg-[var(--bg-inset)] border border-[var(--border-subtle)] text-[10px] font-mono font-bold text-[var(--accent-orange)] tabular-nums shrink-0"
                      >
                        ⏱{' '}
                        {totalStopwatchSec >= 60
                          ? `${Math.floor(totalStopwatchSec / 60)}m`
                          : `${totalStopwatchSec}s`}
                      </span>
                    )}
                  </div>
                </div>

                {/* Quick Bar Controls */}
                <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                  {!timer.isRunning && timer.mode === 'rest' && !isForcedMobile && (
                    <div className="hidden sm:flex items-center gap-1 mr-1">
                      {[60, 90, 120].map((sec) => (
                        <button
                          key={sec}
                          type="button"
                          data-tooltip={`Start ${sec}s rest countdown`}
                          title={`Start ${sec}s rest countdown`}
                          onClick={() => startRestTimer(sec)}
                          className="tactile-pill px-2 py-1 text-xs font-semibold tabular-nums rounded-lg bg-slate-100 hover:bg-orange-500 hover:text-white dark:bg-slate-800 dark:hover:bg-orange-500 transition-colors"
                        >
                          {sec === 120 ? '2m' : `${sec}s`}
                        </button>
                      ))}
                    </div>
                  )}

                  {timer.isRunning && (
                    <button
                      type="button"
                      onClick={() => setIsFocusMinimized(false)}
                      data-tooltip="Expand Focus Timer"
                      title="Expand Focus Timer"
                      className={`tactile-btn px-2 py-1.5 rounded-xl font-semibold text-xs flex items-center gap-1 transition-all ${
                        isWorkPhase
                          ? 'bg-white/20 hover:bg-white/30 text-white'
                          : 'bg-[var(--bg-inset)] border border-[var(--border-card)] text-[var(--text-primary)]'
                      }`}
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                      <span className="hidden sm:inline">Expand</span>
                    </button>
                  )}

                  {isRepBasedWork ? (
                    <button
                      type="button"
                      data-tooltip={
                        timer.restSec > 0
                          ? `Finish round & start ${timer.restSec}s rest`
                          : 'Advance to next round'
                      }
                      title={
                        timer.restSec > 0
                          ? `Finish round & start ${timer.restSec}s rest`
                          : 'Advance to next round'
                      }
                      onClick={finishCircuitWorkRound}
                      className="px-2.5 sm:px-3 py-1.5 rounded-xl font-semibold text-xs flex items-center gap-1 transition-all bg-orange-500 hover:bg-orange-600 text-white"
                    >
                      <Zap className="w-3.5 h-3.5" />
                      <span>
                        {timer.restSec > 0
                          ? `Finish Round / Start ${timer.restSec}s Rest`
                          : 'Finish Round'}
                      </span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      data-tooltip={timer.isRunning ? 'Pause timer' : 'Start timer'}
                      title={timer.isRunning ? 'Pause timer' : 'Start timer'}
                      onClick={toggleTimerRunning}
                      className={`tactile-btn px-2.5 sm:px-3 py-1.5 rounded-xl font-semibold text-xs flex items-center gap-1 transition-all ${
                        timer.isRunning
                          ? isWorkPhase
                            ? 'bg-white/20 hover:bg-white/30 text-white'
                            : 'bg-orange-500 hover:bg-orange-600 text-white'
                          : 'bg-orange-500 hover:bg-orange-600 text-white'
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
                  )}

                  <button
                    type="button"
                    onClick={resetTimer}
                    data-tooltip="Reset timer"
                    title="Reset timer"
                    className="p-1.5 sm:p-2 rounded-xl hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => setTimerExpanded(!timer.isExpanded)}
                    data-tooltip={
                      timer.isExpanded ? 'Collapse timer drawer' : 'Timer presets & EMOM'
                    }
                    title={timer.isExpanded ? 'Collapse timer drawer' : 'Expand timer settings'}
                    className="p-1.5 sm:p-2 rounded-xl hover:bg-black/10 dark:hover:bg-white/10 transition-colors"
                  >
                    {timer.isExpanded ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronUp className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Expanded Drawer Content */}
          {timer.isExpanded && (
            <div className="px-4 pb-4 pt-2 border-t border-black/10 dark:border-white/10 bg-slate-50/95 dark:bg-slate-900/95 text-slate-900 dark:text-slate-100 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="inline-flex rounded-xl bg-[var(--bg-inset)] border border-[var(--border-subtle)] p-1">
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerTab('rest');
                      startRestTimer(60);
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                      drawerTab === 'rest'
                        ? 'bg-[var(--bg-card)] text-[var(--accent-orange)] shadow-sm'
                        : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    Rest Timer
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDrawerTab('circuit');
                      startCircuitTimer(
                        parseOrZero(circuitRoundsInput),
                        parseOrZero(circuitWorkInput),
                        parseOrZero(circuitRestInput)
                      );
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                      drawerTab === 'circuit'
                        ? 'bg-[var(--bg-card)] text-[var(--accent-orange)] shadow-sm'
                        : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    Circuit / EMOM
                  </button>
                  <button
                    type="button"
                    onClick={() => setDrawerTab('stopwatch')}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all ${
                      drawerTab === 'stopwatch'
                        ? 'bg-[var(--bg-card)] text-[var(--accent-orange)] shadow-sm'
                        : 'text-[var(--text-secondary)]'
                    }`}
                  >
                    Stopwatch
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
                    onClick={() => setTimerSoundEnabled(!soundEnabled)}
                    data-tooltip={soundEnabled ? 'Mute timer beeps' : 'Unmute timer beeps'}
                    title="Toggle audio & vibration alerts"
                    className="p-1.5 rounded-lg bg-[var(--bg-inset)] text-[var(--text-secondary)] border border-[var(--border-subtle)]"
                  >
                    {soundEnabled ? (
                      <Volume2 className="w-4 h-4 text-orange-500" />
                    ) : (
                      <VolumeX className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>

              {/* Stopwatch Panel */}
              {drawerTab === 'stopwatch' && (
                <div className="p-3 rounded-2xl bg-[var(--bg-inset)] border border-[var(--border-card)] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                      Workout Session Elapsed
                    </div>
                    <div className="font-mono text-2xl font-extrabold tabular-nums text-[var(--text-primary)]">
                      {formatStopwatch(totalStopwatchSec)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        sessionStopwatchStartMs !== null
                          ? pauseSessionStopwatch()
                          : startSessionStopwatch()
                      }
                      className="px-3.5 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
                    >
                      {sessionStopwatchStartMs !== null ? (
                        <>
                          <Pause className="w-3.5 h-3.5" />
                          Pause
                        </>
                      ) : (
                        <>
                          <Play className="w-3.5 h-3.5" />
                          Start
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={resetSessionStopwatch}
                      className="px-3 py-2 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] text-xs font-bold inline-flex items-center gap-1 transition-colors"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reset
                    </button>
                  </div>
                </div>
              )}

              {/* Rest Presets (only shown in Rest Timer mode) */}
              {drawerTab === 'rest' && (
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
                      min={0}
                      max={900}
                      value={customRestInput}
                      onChange={(e) => setCustomRestInput(e.target.value)}
                      onBlur={() => setCustomRestInput(String(parseOrZero(customRestInput)))}
                      className="w-16 px-2 py-1 text-xs font-mono tabular-nums rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-center"
                    />
                    <button
                      type="button"
                      onClick={() => startRestTimer(parseOrZero(customRestInput))}
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-[var(--bg-inset)] border border-[var(--border-card)] text-[var(--text-primary)] hover:bg-orange-500 hover:text-white transition-colors"
                    >
                      Set Sec
                    </button>
                  </div>
                </div>
              </div>
              )}

              {/* Circuit / EMOM Builder (only shown in Circuit / EMOM mode) */}
              {drawerTab === 'circuit' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Circuit / EMOM Intervals (0s Work = Rep-Based, 0s Rest = EMOM)
                  </span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setCircuitRoundsInput('15');
                        setCircuitWorkInput('60');
                        setCircuitRestInput('0');
                        startCircuitTimer(15, 60, 0);
                      }}
                      className="text-[11px] px-2 py-0.5 rounded bg-orange-500/10 text-orange-600 dark:text-orange-400 font-semibold hover:bg-orange-500/20"
                    >
                      15m EMOM
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCircuitRoundsInput('12');
                        setCircuitWorkInput('40');
                        setCircuitRestInput('20');
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
                      min={0}
                      max={100}
                      value={circuitRoundsInput}
                      onChange={(e) => setCircuitRoundsInput(e.target.value)}
                      onBlur={() =>
                        setCircuitRoundsInput(String(parseOrZero(circuitRoundsInput)))
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono font-bold tabular-nums rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-orange-600 dark:text-orange-400 mb-0.5">
                      Work (sec)
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={3600}
                      value={circuitWorkInput}
                      onChange={(e) => setCircuitWorkInput(e.target.value)}
                      onBlur={() =>
                        setCircuitWorkInput(String(parseOrZero(circuitWorkInput)))
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
                      value={circuitRestInput}
                      onChange={(e) => setCircuitRestInput(e.target.value)}
                      onBlur={() =>
                        setCircuitRestInput(String(parseOrZero(circuitRestInput)))
                      }
                      className="w-full px-2.5 py-1.5 text-xs font-mono font-bold tabular-nums rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      startCircuitTimer(
                        parseOrZero(circuitRoundsInput),
                        parseOrZero(circuitWorkInput),
                        parseOrZero(circuitRestInput)
                      )
                    }
                    className="py-1.5 px-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold text-xs flex items-center justify-center gap-1 shadow-sm transition-colors"
                  >
                    <Zap className="w-3.5 h-3.5" /> Start
                  </button>
                </div>
              </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

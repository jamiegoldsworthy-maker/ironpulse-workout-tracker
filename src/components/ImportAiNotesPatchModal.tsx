import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardPaste,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { buildAiNotesDiffPreview, parseAiNotesPatch } from '../utils/aiCoachPatch';

interface ImportAiNotesPatchModalProps {
  open: boolean;
  onClose: () => void;
  onApplied?: (summary: string) => void;
}

export const ImportAiNotesPatchModal: React.FC<ImportAiNotesPatchModalProps> = ({
  open,
  onClose,
  onApplied,
}) => {
  const { programs, presets, schedules, applyAiNotesPatch } = useWorkoutStore();
  const [rawJson, setRawJson] = useState('');
  const [allowStructuralChanges, setAllowStructuralChanges] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setApplyError(null);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const parsed = useMemo(() => {
    if (!rawJson.trim()) return { patch: null, error: null };
    return parseAiNotesPatch(rawJson);
  }, [rawJson]);

  const diffPreview = useMemo(() => {
    if (!parsed.patch) return null;
    return buildAiNotesDiffPreview(parsed.patch, { programs, presets, schedules });
  }, [parsed.patch, programs, presets, schedules]);

  if (!open) return null;

  const totalNoteDiffs = diffPreview
    ? diffPreview.programWeekDiffs.length +
      diffPreview.presetNoteDiffs.length +
      diffPreview.exerciseNoteDiffs.length +
      diffPreview.scheduleNoteDiffs.length
    : 0;

  const canApply =
    Boolean(parsed.patch) &&
    !parsed.error &&
    !isApplying &&
    (totalNoteDiffs > 0 ||
      (allowStructuralChanges && (diffPreview?.structuralChangesCount || 0) > 0));

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) setRawJson(text);
    } catch {
      // Clipboard read may be blocked by browser permissions; user can paste manually.
    }
  };

  const handleApply = async () => {
    if (!parsed.patch || !canApply) return;
    setIsApplying(true);
    setApplyError(null);
    const result = await applyAiNotesPatch(parsed.patch, { allowStructuralChanges });
    setIsApplying(false);

    if (!result.ok && result.error) {
      setApplyError(result.error);
      return;
    }

    const parts: string[] = [];
    if (result.weeksUpdated > 0) parts.push(`${result.weeksUpdated} week(s)`);
    if (result.presetsUpdated > 0) parts.push(`${result.presetsUpdated} workout(s)`);
    if (result.exercisesUpdated > 0) parts.push(`${result.exercisesUpdated} exercise(s)`);
    if (result.schedulesUpdated > 0) parts.push(`${result.schedulesUpdated} scheduled day(s)`);

    const summary =
      parts.length > 0
        ? `Updated coaching notes for ${parts.join(', ')}`
        : 'AI patch applied';

    setRawJson('');
    setAllowStructuralChanges(false);
    onApplied?.(summary);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-orange-500/15 text-orange-500 flex items-center justify-center shrink-0">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Import AI Notes Patch
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Safely merge coaching &amp; injury cues without touching workout structure.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto space-y-4">
          {/* Safety Mode Toggle */}
          <div className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 min-w-0">
              <ShieldCheck
                className={`w-4 h-4 mt-0.5 shrink-0 ${
                  !allowStructuralChanges ? 'text-emerald-500' : 'text-amber-500'
                }`}
              />
              <div>
                <div className="text-xs font-bold text-slate-800 dark:text-slate-100">
                  {allowStructuralChanges
                    ? 'Structural / Exercise Edits Enabled'
                    : 'Notes-Only Safety Lock (ON)'}
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {allowStructuralChanges
                    ? 'Sets, weights, reps, and exercise names in the patch will also update matching presets.'
                    : 'Only weekFocusNotes, workoutNotes, exerciseNotes, and coachNotes will be updated.'}
                </p>
              </div>
            </div>
            <label className="inline-flex items-center gap-2 cursor-pointer shrink-0">
              <input
                type="checkbox"
                checked={allowStructuralChanges}
                onChange={(e) => setAllowStructuralChanges(e.target.checked)}
                className="rounded border-slate-300 dark:border-slate-700 text-orange-500 focus:ring-orange-500"
              />
              <span className="text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                Allow Structural / Exercise Changes
              </span>
            </label>
          </div>

          {/* Paste JSON Area */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                AI Coach Patch JSON
              </label>
              <button
                type="button"
                onClick={handlePasteClipboard}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-orange-500 hover:text-orange-600"
              >
                <ClipboardPaste className="w-3.5 h-3.5" />
                Paste from Clipboard
              </button>
            </div>
            <textarea
              value={rawJson}
              onChange={(e) => setRawJson(e.target.value)}
              rows={6}
              placeholder='Paste the JSON patch returned by your AI coach here (e.g. { "program": { ... }, "presets": [ ... ] })'
              className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3.5 py-2.5 text-xs font-mono text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-orange-500/40"
            />
          </div>

          {/* Parse / Apply Errors */}
          {parsed.error && (
            <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{parsed.error}</span>
            </div>
          )}

          {applyError && (
            <div className="p-3 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-xs text-rose-600 dark:text-rose-400 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{applyError}</span>
            </div>
          )}

          {/* Diff Preview */}
          {diffPreview && !parsed.error && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Before-Applying Diff Preview
                </span>
                <span className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  {totalNoteDiffs} note update{totalNoteDiffs === 1 ? '' : 's'}
                </span>
              </div>

              {diffPreview.structuralChangesCount > 0 && !allowStructuralChanges && (
                <div className="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    Detected {diffPreview.structuralChangesCount} structural/exercise field(s) (sets, weights, reps, or names). Notes-Only Mode is ON, so those structural edits will be safely ignored.
                  </span>
                </div>
              )}

              {totalNoteDiffs === 0 ? (
                <div className="p-4 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center text-xs text-slate-500 dark:text-slate-400">
                  No matching note changes detected against your current program, presets, or upcoming schedule.
                </div>
              ) : (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {diffPreview.programWeekDiffs.map((d) => (
                    <div
                      key={`wk-${d.programUuid}-${d.week}`}
                      className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 text-xs space-y-1"
                    >
                      <div className="font-bold text-slate-800 dark:text-slate-100">
                        Program Week {d.week} · {d.programTitle}
                      </div>
                      {d.oldNote && (
                        <div className="text-[11px] text-slate-400 line-through">{d.oldNote}</div>
                      )}
                      <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                        {d.newNote || '(Cleared)'}
                      </div>
                    </div>
                  ))}

                  {diffPreview.presetNoteDiffs.map((d) => (
                    <div
                      key={`pre-${d.presetUuid}`}
                      className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 text-xs space-y-1"
                    >
                      <div className="font-bold text-slate-800 dark:text-slate-100">
                        Workout · {d.presetTitle}
                      </div>
                      {d.oldNote && (
                        <div className="text-[11px] text-slate-400 line-through">{d.oldNote}</div>
                      )}
                      <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                        {d.newNote || '(Cleared)'}
                      </div>
                    </div>
                  ))}

                  {diffPreview.exerciseNoteDiffs.map((d) => (
                    <div
                      key={`ex-${d.presetUuid}-${d.exerciseIndex}`}
                      className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 text-xs space-y-1"
                    >
                      <div className="font-bold text-slate-800 dark:text-slate-100">
                        Exercise · {d.presetTitle} → {d.exerciseName}
                      </div>
                      {d.oldNote && (
                        <div className="text-[11px] text-slate-400 line-through">{d.oldNote}</div>
                      )}
                      <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                        {d.newNote || '(Cleared)'}
                      </div>
                    </div>
                  ))}

                  {diffPreview.scheduleNoteDiffs.map((d) => (
                    <div
                      key={`sch-${d.date}-${d.scheduleItemUuid}`}
                      className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200/80 dark:border-slate-800 text-xs space-y-1"
                    >
                      <div className="font-bold text-slate-800 dark:text-slate-100">
                        Scheduled · {d.date} · {d.presetName}
                      </div>
                      {d.oldNote && (
                        <div className="text-[11px] text-slate-400 line-through">{d.oldNote}</div>
                      )}
                      <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                        {d.newNote || '(Cleared)'}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50/70 dark:bg-slate-950/40">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canApply}
            onClick={handleApply}
            className="px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 disabled:opacity-40 disabled:pointer-events-none text-white text-xs font-bold inline-flex items-center gap-1.5 shadow-sm transition-colors"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            {isApplying ? 'Applying...' : 'Apply Notes Patch'}
          </button>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useMemo, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { ContextBlock, ContextCategory } from '../types/workout';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { CONTEXT_CATEGORY_LIST, normalizeScheduleStatus } from '../utils/scheduleStatus';
import { getTodayIsoDate } from '../utils/calculations';
import { ModalPortal } from './ModalPortal';

export interface ContextBlockModalProps {
  open: boolean;
  editingBlock?: ContextBlock | null;
  initialDate?: string;
  initialCategory?: ContextCategory;
  onClose: () => void;
  onSaved?: (message: string) => void;
}

export const ContextBlockModal: React.FC<ContextBlockModalProps> = ({
  open,
  editingBlock,
  initialDate,
  initialCategory,
  onClose,
  onSaved,
}) => {
  const { schedules, addContextBlock, updateContextBlock, deleteContextBlock } =
    useWorkoutStore();

  const fallbackDate = initialDate || getTodayIsoDate();
  const [category, setCategory] = useState<ContextCategory>(
    editingBlock?.category || initialCategory || 'work_trip'
  );
  const [title, setTitle] = useState<string>(editingBlock?.title || '');
  const [startDate, setStartDate] = useState<string>(editingBlock?.startDate || fallbackDate);
  const [endDate, setEndDate] = useState<string>(editingBlock?.endDate || fallbackDate);
  const [notes, setNotes] = useState<string>(editingBlock?.notes || '');
  const [skipOverlappingPending, setSkipOverlappingPending] = useState<boolean>(false);

  useEffect(() => {
    if (!open) return;
    if (editingBlock) {
      setCategory(editingBlock.category);
      setTitle(editingBlock.title);
      setStartDate(editingBlock.startDate);
      setEndDate(editingBlock.endDate);
      setNotes(editingBlock.notes || '');
      setSkipOverlappingPending(false);
    } else {
      const d = initialDate || getTodayIsoDate();
      setCategory(initialCategory || 'work_trip');
      setTitle('');
      setStartDate(d);
      setEndDate(d);
      setNotes('');
      setSkipOverlappingPending(false);
    }
  }, [open, editingBlock, initialDate, initialCategory]);

  const overlappingPendingCount = useMemo(() => {
    if (!startDate) return 0;
    const effectiveEnd = endDate && endDate >= startDate ? endDate : startDate;
    let count = 0;
    for (const [date, daySched] of Object.entries(schedules)) {
      if (date < startDate || date > effectiveEnd) continue;
      for (const item of daySched?.items || []) {
        if (normalizeScheduleStatus(item.status) === 'pending') {
          count += 1;
        }
      }
    }
    return count;
  }, [schedules, startDate, endDate]);

  const handleSave = () => {
    const trimmed = title.trim();
    if (!trimmed || !startDate) return;
    const effectiveEnd = endDate && endDate >= startDate ? endDate : startDate;

    if (editingBlock) {
      const { skippedCount } = updateContextBlock(
        editingBlock.id,
        {
          category,
          title: trimmed,
          startDate,
          endDate: effectiveEnd,
          notes: notes.trim() || undefined,
        },
        { skipOverlappingPending }
      );
      onSaved?.(
        skippedCount > 0
          ? `Updated "${trimmed}" & skipped ${skippedCount} pending workout${
              skippedCount === 1 ? '' : 's'
            }`
          : `Updated "${trimmed}"`
      );
    } else {
      const { skippedCount } = addContextBlock(
        {
          category,
          title: trimmed,
          startDate,
          endDate: effectiveEnd,
          notes: notes.trim() || undefined,
        },
        { skipOverlappingPending }
      );
      onSaved?.(
        skippedCount > 0
          ? `Saved "${trimmed}" & skipped ${skippedCount} pending workout${
              skippedCount === 1 ? '' : 's'
            }`
          : `Saved "${trimmed}"`
      );
    }
    onClose();
  };

  return (
    <ModalPortal open={open} onClose={onClose} tier="primary">
      <div className="w-full max-w-md max-h-[90vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 shadow-2xl text-[var(--text-primary)] space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="font-display font-bold text-base">
              {editingBlock ? 'Edit Schedule Flag / Note' : 'Add Schedule Flag / Note'}
            </h3>
            <p className="text-[11px] text-[var(--text-muted)]">
              Log trips, holidays, injury/rehab, or life events explaining schedule changes.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Category Selector Pills */}
        <div className="space-y-1.5">
          <label className="block text-xs font-semibold text-slate-500">Category</label>
          <div className="flex flex-wrap gap-1.5">
            {CONTEXT_CATEGORY_LIST.map((cat) => {
              const active = category === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setCategory(cat.id);
                    if (!title.trim()) {
                      setTitle(cat.shortLabel);
                    }
                  }}
                  className={`tactile-pill px-2.5 py-1.5 rounded-xl text-xs font-bold border inline-flex items-center gap-1.5 transition-colors ${
                    active
                      ? 'bg-orange-500 text-white border-orange-500 shadow-xs'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-[var(--text-secondary)] hover:border-orange-500/50'
                  }`}
                >
                  <span>{cat.emoji}</span>
                  <span>{cat.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Title</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Work Trip, Shoulder Rehab, Cornwall Holiday"
            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:border-orange-500"
          />
        </div>

        {/* Side-by-Side Start & End Date */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: '10px',
            minWidth: 0,
          }}
        >
          <div className="min-w-0">
            <label className="block text-xs font-semibold text-slate-500 mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                const nextStart = e.target.value;
                setStartDate(nextStart);
                if (!endDate || endDate < nextStart) {
                  setEndDate(nextStart);
                }
              }}
              className="w-full min-w-0 px-2.5 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
          </div>
          <div className="min-w-0">
            <label className="block text-xs font-semibold text-slate-500 mb-1">End Date</label>
            <input
              type="date"
              min={startDate}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full min-w-0 px-2.5 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
            />
          </div>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">
            Notes (Optional)
          </label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="e.g. Hotel gym only, light mobility & walking..."
            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:border-orange-500"
          />
        </div>

        {/* Mark overlapping Pending workouts as Skipped */}
        <label className="flex items-start gap-2.5 p-3 rounded-2xl bg-[var(--bg-inset)] border border-[var(--border-subtle)] cursor-pointer">
          <input
            type="checkbox"
            checked={skipOverlappingPending}
            onChange={(e) => setSkipOverlappingPending(e.target.checked)}
            className="mt-0.5 rounded accent-orange-500 w-4 h-4 shrink-0"
          />
          <div className="min-w-0">
            <div className="text-xs font-bold text-[var(--text-primary)]">
              Mark overlapping Pending workouts as Skipped
            </div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
              {overlappingPendingCount > 0
                ? `${overlappingPendingCount} pending workout${
                    overlappingPendingCount === 1 ? '' : 's'
                  } in this date range will be marked Skipped and removed from Google Tasks.`
                : 'No pending workouts overlap this date range.'}
            </div>
          </div>
        </label>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 pt-1">
          {editingBlock ? (
            <button
              type="button"
              onClick={() => {
                deleteContextBlock(editingBlock.id);
                onSaved?.(`Removed "${editingBlock.title}"`);
                onClose();
              }}
              className="px-3 py-2 rounded-xl text-xs font-bold bg-rose-500/10 hover:bg-rose-500/20 text-rose-600 dark:text-rose-400 inline-flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Delete
            </button>
          ) : (
            <span />
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!title.trim() || !startDate}
              onClick={handleSave}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white"
            >
              {editingBlock ? 'Save Changes' : 'Save Flag'}
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
};

import React from 'react';
import { Check, CheckCircle2, Clock, Flame, X, XCircle } from 'lucide-react';
import { ScheduleStatus } from '../types/workout';
import {
  SCHEDULE_STATUS_META,
  SCHEDULE_STATUS_OPTIONS,
  normalizeScheduleStatus,
} from '../utils/scheduleStatus';
import { ModalPortal } from './ModalPortal';

export interface StatusSelectorModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  currentStatus: ScheduleStatus;
  onSelect: (nextStatus: ScheduleStatus) => void;
  onClose: () => void;
}

function StatusIcon({ status }: { status: ScheduleStatus }) {
  if (status === 'completed') return <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />;
  if (status === 'in_progress') return <Flame className="w-4 h-4 text-orange-500 shrink-0" />;
  if (status === 'skipped') return <XCircle className="w-4 h-4 text-[var(--text-muted)] shrink-0" />;
  return <Clock className="w-4 h-4 text-amber-500 shrink-0" />;
}

export const StatusSelectorModal: React.FC<StatusSelectorModalProps> = ({
  open,
  title,
  subtitle,
  currentStatus,
  onSelect,
  onClose,
}) => {
  const normalized = normalizeScheduleStatus(currentStatus);

  return (
    <ModalPortal
      open={open}
      onClose={onClose}
      tier="nested"
      backdropClassName="items-center p-4 bg-black/65 backdrop-blur-xs"
    >
      <div className="w-full max-w-xs bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-4 shadow-2xl text-[var(--text-primary)] space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
              Workout Status
            </div>
            <h3 className="font-display font-bold text-sm text-[var(--text-primary)] truncate">
              {title}
            </h3>
            {subtitle && (
              <p className="text-[11px] text-[var(--text-muted)] truncate">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close status selector"
            className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-[var(--text-muted)] hover:text-[var(--text-primary)] shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-1.5">
          {SCHEDULE_STATUS_OPTIONS.map((st) => {
            const meta = SCHEDULE_STATUS_META[st];
            const isSelected = normalized === st;
            return (
              <button
                key={st}
                type="button"
                onClick={() => {
                  onSelect(st);
                  onClose();
                }}
                className={`tactile-btn w-full text-left px-3 py-2.5 rounded-2xl border flex items-center justify-between gap-2.5 transition-colors ${
                  isSelected
                    ? 'bg-orange-500/10 border-orange-500/50'
                    : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200/70 dark:border-slate-700/70 hover:border-orange-500/40'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <StatusIcon status={st} />
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-[var(--text-primary)]">
                      {meta.label}
                    </div>
                    <div className="text-[10px] text-[var(--text-muted)] truncate">
                      {meta.description}
                    </div>
                  </div>
                </div>
                {isSelected && <Check className="w-4 h-4 text-orange-500 shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>
    </ModalPortal>
  );
};

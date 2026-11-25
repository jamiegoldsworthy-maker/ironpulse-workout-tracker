import {
  ContextBlock,
  ContextCategory,
  DailySchedule,
  LogStatus,
  ScheduleStatus,
  ScheduledItem,
  WorkoutLog,
} from '../types/workout';

export const SCHEDULE_STATUS_OPTIONS: readonly ScheduleStatus[] = [
  'pending',
  'in_progress',
  'completed',
  'skipped',
];

export interface StatusDisplayMeta {
  status: ScheduleStatus;
  label: string;
  description: string;
  badgeClass: string;
  dotColor: string;
}

export const SCHEDULE_STATUS_META: Record<ScheduleStatus, StatusDisplayMeta> = {
  pending: {
    status: 'pending',
    label: 'Pending',
    description: 'Scheduled and waiting to start',
    badgeClass:
      'bg-amber-500/12 text-amber-700 dark:text-amber-300 border border-amber-500/25',
    dotColor: 'var(--accent-orange)',
  },
  in_progress: {
    status: 'in_progress',
    label: 'In Progress',
    description: 'Currently active on the gym floor',
    badgeClass:
      'bg-orange-500/15 text-orange-700 dark:text-orange-300 border border-orange-500/35',
    dotColor: 'var(--accent-orange)',
  },
  completed: {
    status: 'completed',
    label: 'Complete',
    description: 'Finished and logged',
    badgeClass:
      'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30',
    dotColor: 'var(--accent-sage)',
  },
  skipped: {
    status: 'skipped',
    label: 'Skipped',
    description: 'Skipped — removed from active tasks',
    badgeClass:
      'bg-[var(--bg-input)] text-[var(--text-muted)] border border-[var(--border-subtle)]',
    dotColor: 'var(--text-muted)',
  },
};

export function normalizeScheduleStatus(raw?: string | null): ScheduleStatus {
  if (raw === 'completed') return 'completed';
  if (raw === 'in_progress') return 'in_progress';
  if (raw === 'skipped' || raw === 'did_not_complete' || raw === 'incomplete') {
    return 'skipped';
  }
  return 'pending';
}

export function normalizeLogStatus(raw?: string | null): LogStatus {
  if (raw === 'completed') return 'completed';
  if (raw === 'in_progress') return 'in_progress';
  if (raw === 'skipped' || raw === 'did_not_complete' || raw === 'incomplete') {
    return 'skipped';
  }
  return 'pending';
}

export function formatScheduleStatusLabel(status?: string | null): string {
  return SCHEDULE_STATUS_META[normalizeScheduleStatus(status)].label;
}

export function normalizeScheduledItem(
  item: ScheduledItem,
  fallbackUpdatedAt?: string
): ScheduledItem {
  const status = normalizeScheduleStatus(item.status);
  return {
    ...item,
    status,
    completed: status === 'completed',
    updatedAt: item.updatedAt || fallbackUpdatedAt,
  };
}

export function normalizeDailySchedule(sch: DailySchedule): DailySchedule {
  return {
    ...sch,
    items: (sch.items || []).map((item) => normalizeScheduledItem(item, sch.updatedAt)),
  };
}

export function normalizeWorkoutLog(log: WorkoutLog): WorkoutLog {
  const status = normalizeLogStatus(log.status);
  return status === log.status ? log : { ...log, status };
}

/**
 * Merges a remote DailySchedule with local state so the newest `updatedAt` timestamp
 * always wins per scheduled item during Firestore / Google Tasks merges.
 */
export function mergeDailyScheduleByTimestamp(
  local: DailySchedule | undefined,
  remote: DailySchedule
): DailySchedule {
  const normalizedRemote = normalizeDailySchedule(remote);
  if (!local) return normalizedRemote;

  const normalizedLocal = normalizeDailySchedule(local);
  const localById = new Map(normalizedLocal.items.map((it) => [it.scheduleItemUuid, it]));

  const mergedItems = normalizedRemote.items.map((remoteItem) => {
    const localItem = localById.get(remoteItem.scheduleItemUuid);
    if (!localItem) return remoteItem;
    const localTs = localItem.updatedAt || normalizedLocal.updatedAt || '';
    const remoteTs = remoteItem.updatedAt || normalizedRemote.updatedAt || '';
    if (localTs && (!remoteTs || localTs > remoteTs)) {
      return localItem;
    }
    return remoteItem;
  });

  const newestUpdatedAt =
    (normalizedLocal.updatedAt || '') > (normalizedRemote.updatedAt || '')
      ? normalizedLocal.updatedAt
      : normalizedRemote.updatedAt;

  return {
    ...normalizedRemote,
    items: mergedItems,
    updatedAt: newestUpdatedAt,
  };
}

export interface ContextCategoryMeta {
  id: ContextCategory;
  label: string;
  shortLabel: string;
  emoji: string;
  color: string;
  bgClass: string;
  borderClass: string;
  textClass: string;
  dotClass: string;
}

export const CONTEXT_CATEGORY_LIST: readonly ContextCategoryMeta[] = [
  {
    id: 'injury',
    label: 'Injury / Rehab',
    shortLabel: 'Injury',
    emoji: '🩹',
    color: '#D15D14',
    bgClass: 'bg-rose-500/10',
    borderClass: 'border-rose-500/30',
    textClass: 'text-rose-700 dark:text-rose-300',
    dotClass: 'bg-rose-500',
  },
  {
    id: 'holiday',
    label: 'Holiday',
    shortLabel: 'Holiday',
    emoji: '🏖️',
    color: '#4F7A6C',
    bgClass: 'bg-emerald-500/10',
    borderClass: 'border-emerald-500/30',
    textClass: 'text-emerald-700 dark:text-emerald-300',
    dotClass: 'bg-emerald-500',
  },
  {
    id: 'work_trip',
    label: 'Work Trip',
    shortLabel: 'Work Trip',
    emoji: '✈️',
    color: '#3B82F6',
    bgClass: 'bg-sky-500/10',
    borderClass: 'border-sky-500/30',
    textClass: 'text-sky-700 dark:text-sky-300',
    dotClass: 'bg-sky-500',
  },
  {
    id: 'illness',
    label: 'Illness',
    shortLabel: 'Illness',
    emoji: '🤒',
    color: '#D97706',
    bgClass: 'bg-amber-500/12',
    borderClass: 'border-amber-500/30',
    textClass: 'text-amber-700 dark:text-amber-300',
    dotClass: 'bg-amber-500',
  },
  {
    id: 'life',
    label: 'Life / Schedule',
    shortLabel: 'Life',
    emoji: '📌',
    color: '#8B5CF6',
    bgClass: 'bg-violet-500/10',
    borderClass: 'border-violet-500/30',
    textClass: 'text-violet-700 dark:text-violet-300',
    dotClass: 'bg-violet-500',
  },
];

export const CONTEXT_CATEGORY_MAP: Record<ContextCategory, ContextCategoryMeta> =
  CONTEXT_CATEGORY_LIST.reduce((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {} as Record<ContextCategory, ContextCategoryMeta>);

export function getContextBlocksForDate(
  blocks: ContextBlock[],
  isoDate: string
): ContextBlock[] {
  return blocks.filter((b) => isoDate >= b.startDate && isoDate <= b.endDate);
}

export function formatContextDateRange(startDate: string, endDate: string): string {
  const parseIso = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const start = parseIso(startDate);
  if (!endDate || startDate === endDate) {
    return start.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
  const end = parseIso(endDate);
  const sameYear = start.getFullYear() === end.getFullYear();
  const startStr = start.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  const endStr = end.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${startStr} – ${endStr}`;
}

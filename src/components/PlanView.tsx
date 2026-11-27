import React, { useEffect, useMemo, useState } from 'react';
import {
  Calendar,
  Sparkles,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ArrowRightLeft,
  Play,
  Check,
  CheckCircle2,
  Clock,
  Layers,
  Wand2,
  ChevronLeft,
  ChevronRight,
  Edit3,
  ListChecks,
  Pencil,
  Copy,
  CalendarX,
  ClipboardPaste,
  RefreshCw,
  Search,
  AlertTriangle,
  X,
  Flag,
  Flame,
  XCircle,
} from 'lucide-react';
import { ImportAiNotesPatchModal } from './ImportAiNotesPatchModal';
import { ModalPortal } from './ModalPortal';
import { StatusSelectorModal } from './StatusSelectorModal';
import { ContextBlockModal } from './ContextBlockModal';
import { buildAiCoachExportPayload } from '../utils/aiCoachPatch';
import { useWorkoutStore } from '../store/useWorkoutStore';
import {
  ContextBlock,
  ContextCategory,
  ProgramDayTemplate,
  ScheduleStatus,
  WorkoutProgram,
} from '../types/workout';
import {
  CONTEXT_CATEGORY_LIST,
  CONTEXT_CATEGORY_MAP,
  SCHEDULE_STATUS_META,
  formatScheduleStatusLabel,
  getContextBlocksForDate,
  normalizeScheduleStatus,
} from '../utils/scheduleStatus';
import {
  formatLocalIsoDate,
  formatReadableDate,
  getTodayIsoDate,
  shiftIsoDate,
  slugify,
  uuidv4,
} from '../utils/calculations';
import { useIsMobileView } from '../utils/useIsMobileView';

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS_MON_FIRST = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const SLOT_ROLES = ['Primary', 'Secondary', 'Core', 'Mobility', 'Finisher', 'Conditioning'];
const AUTOFILL_DATES_STORAGE_KEY = 'ironpulse_program_autofill_dates';

function readSavedProgramAutofillDates(
  programUuid: string
): { start: string; end: string } | null {
  if (typeof window === 'undefined' || !programUuid) return null;
  try {
    const raw = window.localStorage.getItem(AUTOFILL_DATES_STORAGE_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, { start?: string; end?: string }>;
    const entry = map[programUuid];
    if (entry?.start && entry?.end) {
      return { start: entry.start, end: entry.end };
    }
  } catch {
    // Ignore storage errors
  }
  return null;
}

function saveProgramAutofillDates(programUuid: string, start: string, end: string): void {
  if (typeof window === 'undefined' || !programUuid || !start || !end) return;
  try {
    const raw = window.localStorage.getItem(AUTOFILL_DATES_STORAGE_KEY);
    const map: Record<string, { start: string; end: string }> = raw ? JSON.parse(raw) : {};
    map[programUuid] = { start, end };
    window.localStorage.setItem(AUTOFILL_DATES_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore storage errors
  }
}

function formatProgramActiveDateRange(sortedIsoDates: string[]): string {
  if (sortedIsoDates.length === 0) return 'No dates scheduled yet';
  const parseIso = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  };
  const start = parseIso(sortedIsoDates[0]);
  const end = parseIso(sortedIsoDates[sortedIsoDates.length - 1]);
  if (sortedIsoDates[0] === sortedIsoDates[sortedIsoDates.length - 1]) {
    return `Active: ${start.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })}`;
  }
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
  return `Active: ${startStr} – ${endStr}`;
}

function buildMonthCalendarGrid(year: number, monthZeroIndexed: number): Array<{
  isoDate: string;
  dayNum: number;
  inCurrentMonth: boolean;
}> {
  const firstDay = new Date(year, monthZeroIndexed, 1);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const gridStartDate = new Date(year, monthZeroIndexed, 1 - startOffset);

  const cells: Array<{ isoDate: string; dayNum: number; inCurrentMonth: boolean }> = [];
  for (let i = 0; i < 42; i++) {
    const dt = new Date(
      gridStartDate.getFullYear(),
      gridStartDate.getMonth(),
      gridStartDate.getDate() + i
    );
    cells.push({
      isoDate: formatLocalIsoDate(dt),
      dayNum: dt.getDate(),
      inCurrentMonth: dt.getMonth() === monthZeroIndexed,
    });
  }
  return cells;
}

export const PlanView: React.FC = () => {
  const {
    schedules,
    logs,
    presets,
    programs,
    contextBlocks,
    meta,
    setActiveDate,
    setActiveTab,
    setActiveProgram,
    updateDailySchedule,
    setScheduledItemStatus,
    addScheduledItemToDate,
    removeScheduledItemFromDate,
    upsertProgram,
    upsertPreset,
    deleteProgram,
    clearFutureScheduledWorkoutsForProgram,
    autoFillSchedule,
    lastTasksSync,
    tasksActionToast,
    runGoogleTasksSync,
  } = useWorkoutStore();

  const [isSyncingTasks, setIsSyncingTasks] = useState(false);

  const isMobile = useIsMobileView();
  const todayIso = getTodayIsoDate();
  const [subTab, setSubTab] = useState<'upcoming' | 'calendar' | 'programming'>('upcoming');
  const [upcomingRange, setUpcomingRange] = useState<7 | 14 | 30 | 'all'>(14);
  const [hideRestDays, setHideRestDays] = useState<boolean>(false);
  const [editingUpcomingDate, setEditingUpcomingDate] = useState<string | null>(null);
  const [inlinePresetSearch, setInlinePresetSearch] = useState<string>('');

  const initialDateParts = todayIso.split('-').map(Number);
  const [viewYear, setViewYear] = useState<number>(initialDateParts[0]);
  const [viewMonth, setViewMonth] = useState<number>(initialDateParts[1] - 1);
  const [selectedDate, setSelectedDate] = useState<string>(todayIso);

  const [scheduleModal, setScheduleModal] = useState<{
    open: boolean;
    date: string;
    presetUuid: string;
    slotRole: string;
    coachNotes: string;
  }>({
    open: false,
    date: todayIso,
    presetUuid: presets[0]?.presetUuid || '',
    slotRole: 'Primary',
    coachNotes: '',
  });

  const selectedProgram = useMemo(
    () =>
      programs.find((p) => p.programUuid === meta.activeProgramUuid) ||
      programs[0] ||
      null,
    [programs, meta.activeProgramUuid]
  );

  const activeProgramDates = useMemo(() => {
    if (!selectedProgram) return [];
    const explicitDates = Object.keys(schedules)
      .filter((d) =>
        schedules[d]?.items?.some((it) => it.programUuid === selectedProgram.programUuid)
      )
      .sort();
    if (explicitDates.length > 0) return explicitDates;
    const programPresetIds = new Set(
      presets
        .filter((p) => p.programIds?.includes(selectedProgram.programUuid))
        .map((p) => p.presetUuid)
    );
    if (programPresetIds.size === 0) return [];
    return Object.keys(schedules)
      .filter((d) => schedules[d]?.items?.some((it) => programPresetIds.has(it.presetUuid)))
      .sort();
  }, [selectedProgram, schedules, presets]);

  const activeProgramDateRange = useMemo(
    () => formatProgramActiveDateRange(activeProgramDates),
    [activeProgramDates]
  );

  const [activeTemplateWeek, setActiveTemplateWeek] = useState<number>(1);
  const [duplicateWeekModal, setDuplicateWeekModal] = useState<{
    open: boolean;
    targetMode: 'new' | 'existing';
    targetWeek: number;
    modifier: 'exact' | 'build_5' | 'deload';
  }>({
    open: false,
    targetMode: 'new',
    targetWeek: 2,
    modifier: 'exact',
  });
  const [autoFillStart, setAutoFillStart] = useState<string>(() => {
    if (activeProgramDates.length > 0) return activeProgramDates[0];
    const saved = selectedProgram
      ? readSavedProgramAutofillDates(selectedProgram.programUuid)
      : null;
    return saved?.start || todayIso;
  });
  const [autoFillEnd, setAutoFillEnd] = useState<string>(() => {
    if (activeProgramDates.length > 0) {
      return activeProgramDates[activeProgramDates.length - 1];
    }
    const saved = selectedProgram
      ? readSavedProgramAutofillDates(selectedProgram.programUuid)
      : null;
    return saved?.end || shiftIsoDate(todayIso, 27);
  });
  const [conflictMode, setConflictMode] = useState<'replace' | 'update_matching' | 'skip'>(
    'update_matching'
  );
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);

  // Sync autofill start/end dates to the selected program's existing scheduled range (or saved dates)
  const activeProgramStartIso = activeProgramDates[0] || '';
  const activeProgramEndIso = activeProgramDates[activeProgramDates.length - 1] || '';
  useEffect(() => {
    if (!selectedProgram) return;
    const saved = readSavedProgramAutofillDates(selectedProgram.programUuid);
    if (activeProgramStartIso && activeProgramEndIso) {
      setAutoFillStart(activeProgramStartIso);
      setAutoFillEnd(activeProgramEndIso);
    } else if (saved) {
      setAutoFillStart(saved.start);
      setAutoFillEnd(saved.end);
    } else {
      const spanDays = Math.max(6, (selectedProgram.cycleLengthWeeks || 2) * 7 - 1);
      setAutoFillStart(todayIso);
      setAutoFillEnd(shiftIsoDate(todayIso, spanDays));
    }
  }, [selectedProgram?.programUuid, activeProgramStartIso, activeProgramEndIso, todayIso]);

  const [newProgramModal, setNewProgramModal] = useState(false);
  const [newProgTitle, setNewProgTitle] = useState('');
  const [newProgWeeks, setNewProgWeeks] = useState(2);
  const [newProgSelectedPresetUuids, setNewProgSelectedPresetUuids] = useState<string[]>([]);
  const [newProgWorkoutPickerOpen, setNewProgWorkoutPickerOpen] = useState(false);
  const [newProgWorkoutSearch, setNewProgWorkoutSearch] = useState('');

  const [changeProgramModalOpen, setChangeProgramModalOpen] = useState(false);
  const [deleteProgramConfirm, setDeleteProgramConfirm] = useState<WorkoutProgram | null>(null);
  const [statusPickerTarget, setStatusPickerTarget] = useState<{
    date: string;
    scheduleItemUuid: string;
    title: string;
    currentStatus: ScheduleStatus;
  } | null>(null);
  const [contextModalState, setContextModalState] = useState<{
    open: boolean;
    editingBlock?: ContextBlock | null;
    initialDate?: string;
    initialCategory?: ContextCategory;
  }>({ open: false });

  const filteredModalPresets = useMemo(() => {
    const q = newProgWorkoutSearch.trim().toLowerCase();
    if (!q) return presets;
    return presets.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.workoutType || '').toLowerCase().includes(q) ||
        p.tags?.some((t) => t.toLowerCase().includes(q))
    );
  }, [presets, newProgWorkoutSearch]);

  const closeNewProgramModal = () => {
    setNewProgramModal(false);
    setNewProgWorkoutPickerOpen(false);
    setNewProgWorkoutSearch('');
    setNewProgSelectedPresetUuids([]);
    setNewProgTitle('');
    setNewProgWeeks(2);
  };

  const [programEditMenuOpen, setProgramEditMenuOpen] = useState(false);
  const [renameModal, setRenameModal] = useState<{ open: boolean; title: string }>({
    open: false,
    title: '',
  });
  const [aiNotesModalOpen, setAiNotesModalOpen] = useState(false);

  const handleRunTasksSync = async () => {
    setIsSyncingTasks(true);
    const res = await runGoogleTasksSync(true);
    setIsSyncingTasks(false);
    if (res.ok) {
      triggerNotice(
        `Google Tasks synced: ${res.pushed} pushed, ${res.pulled} completed, ${res.rescheduled} moved`
      );
    } else if (res.error) {
      triggerNotice(`Tasks sync failed: ${res.error}`);
    }
  };

  const triggerNotice = (msg: string) => {
    setBannerNotice(msg);
    setTimeout(() => setBannerNotice(null), 3200);
  };

  const calendarCells = useMemo(
    () => buildMonthCalendarGrid(viewYear, viewMonth),
    [viewYear, viewMonth]
  );

  const monthTitle = useMemo(() => {
    return new Date(viewYear, viewMonth, 1).toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
  }, [viewYear, viewMonth]);

  const stepMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  const selectedDayItems = useMemo(() => {
    return (schedules[selectedDate]?.items || [])
      .slice()
      .sort((a, b) => a.orderIndex - b.orderIndex);
  }, [schedules, selectedDate]);

  const selectedDayLogs = useMemo(() => {
    return logs.filter((l) => l.date === selectedDate);
  }, [logs, selectedDate]);

  const upcomingDayList = useMemo(() => {
    let dates: string[] = [];
    if (upcomingRange === 'all') {
      const scheduledDates = Object.keys(schedules)
        .filter((d) => d >= todayIso && (schedules[d]?.items?.length || 0) > 0)
        .sort((a, b) => a.localeCompare(b));
      dates = scheduledDates.includes(todayIso) ? scheduledDates : [todayIso, ...scheduledDates];
    } else {
      dates = Array.from({ length: upcomingRange }, (_, i) => shiftIsoDate(todayIso, i));
    }

    return dates
      .map((date) => ({
        date,
        items: (schedules[date]?.items || [])
          .slice()
          .sort((a, b) => a.orderIndex - b.orderIndex),
      }))
      .filter((entry) => !hideRestDays || entry.items.length > 0 || entry.date === todayIso);
  }, [schedules, todayIso, upcomingRange, hideRestDays]);

  const handleReorderSlot = (date: string, index: number, direction: -1 | 1) => {
    const items = [...(schedules[date]?.items || [])].sort((a, b) => a.orderIndex - b.orderIndex);
    const targetIdx = index + direction;
    if (targetIdx < 0 || targetIdx >= items.length) return;
    const temp = items[index];
    items[index] = items[targetIdx];
    items[targetIdx] = temp;
    updateDailySchedule(date, items);
  };

  const handleUpdateCoachNotes = (date: string, scheduleItemUuid: string, notes: string) => {
    const items = (schedules[date]?.items || []).map((it) =>
      it.scheduleItemUuid === scheduleItemUuid ? { ...it, coachNotes: notes } : it
    );
    updateDailySchedule(date, items);
  };

  const handleAddTemplateSlot = (
    program: WorkoutProgram,
    weekNumber: number,
    dayOfWeek: number,
    presetUuid: string,
    slotRole: string,
    defaultNotes: string
  ) => {
    const existingDays = [...program.scheduleTemplate];
    const dayIdx = existingDays.findIndex(
      (d) => d.weekNumber === weekNumber && d.dayOfWeek === dayOfWeek
    );
    if (dayIdx === -1) {
      const newDay: ProgramDayTemplate = {
        weekNumber,
        dayOfWeek,
        items: [
          {
            orderIndex: 0,
            slotRole,
            presetUuid,
            defaultNotes,
          },
        ],
      };
      existingDays.push(newDay);
    } else {
      const updatedItems = [
        ...existingDays[dayIdx].items,
        {
          orderIndex: existingDays[dayIdx].items.length,
          slotRole,
          presetUuid,
          defaultNotes,
        },
      ];
      existingDays[dayIdx] = { ...existingDays[dayIdx], items: updatedItems };
    }
    upsertProgram({ ...program, scheduleTemplate: existingDays });
  };

  const handleRemoveTemplateSlot = (
    program: WorkoutProgram,
    weekNumber: number,
    dayOfWeek: number,
    itemIndex: number
  ) => {
    const existingDays = program.scheduleTemplate.map((d) => {
      if (d.weekNumber !== weekNumber || d.dayOfWeek !== dayOfWeek) return d;
      return {
        ...d,
        items: d.items
          .filter((_, i) => i !== itemIndex)
          .map((it, idx) => ({ ...it, orderIndex: idx })),
      };
    });
    upsertProgram({ ...program, scheduleTemplate: existingDays });
  };

  return (
    <div className="space-y-4 pb-24">
      {bannerNotice && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-2xl bg-slate-900 dark:bg-orange-500 text-white text-xs font-bold shadow-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-orange-400 dark:text-white" />
          {bannerNotice}
        </div>
      )}

      {/* Sub-Tab Switcher Header */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-2.5 sm:p-4 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-1.5">
        <div
          className="inline-flex items-center rounded-2xl bg-slate-100 dark:bg-slate-800 p-0.5 sm:p-1 min-w-0 shrink-0"
          style={{ gap: '2px' }}
        >
          <button
            type="button"
            onClick={() => setSubTab('upcoming')}
            data-tooltip="Chronological upcoming workout agenda"
            title="Chronological upcoming workout agenda"
            style={{ fontSize: '12px', padding: '6px 8px', gap: '4px' }}
            className={`tactile-pill rounded-xl font-bold inline-flex items-center transition-all whitespace-nowrap shrink-0 ${
              subTab === 'upcoming'
                ? 'bg-orange-500 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ListChecks className="w-3.5 h-3.5 hidden sm:inline-block shrink-0" />
            Upcoming
          </button>
          <button
            type="button"
            onClick={() => setSubTab('calendar')}
            data-tooltip="Monthly training calendar view"
            title="Monthly training calendar view"
            style={{ fontSize: '12px', padding: '6px 8px', gap: '4px' }}
            className={`tactile-pill rounded-xl font-bold inline-flex items-center transition-all whitespace-nowrap shrink-0 ${
              subTab === 'calendar'
                ? 'bg-orange-500 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Calendar className="w-3.5 h-3.5 hidden sm:inline-block shrink-0" />
            Calendar
          </button>
          <button
            type="button"
            onClick={() => setSubTab('programming')}
            data-tooltip="Configure rotating weekly templates & auto-fill schedule"
            title="Configure rotating weekly templates & auto-fill schedule"
            style={{ fontSize: '12px', padding: '6px 8px', gap: '4px' }}
            className={`tactile-pill rounded-xl font-bold inline-flex items-center transition-all whitespace-nowrap shrink-0 ${
              subTab === 'programming'
                ? 'bg-orange-500 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Wand2 className="w-3.5 h-3.5 hidden sm:inline-block shrink-0" />
            Programming
          </button>
        </div>

        {/* Upcoming & Calendar: compact Flag button & icon-only status-colored Sync button */}
        {subTab !== 'programming' && (
          <div className="flex items-center shrink-0" style={{ gap: '4px' }}>
            <button
              type="button"
              onClick={() =>
                setContextModalState({
                  open: true,
                  editingBlock: null,
                  initialDate: subTab === 'calendar' ? selectedDate : todayIso,
                })
              }
              title="Add mitigating factor, trip, holiday, or rehab note"
              style={{ fontSize: '11px', padding: '6px 8px', gap: '4px' }}
              className="tactile-btn rounded-xl bg-[var(--bg-inset)] border border-[var(--border-card)] text-[var(--text-primary)] hover:border-[var(--accent-orange)] font-bold inline-flex items-center transition-colors shrink-0 whitespace-nowrap"
            >
              <Flag className="w-3.5 h-3.5 text-orange-500 shrink-0" />
              <span className="sm:hidden">Flag</span>
              <span className="hidden sm:inline">Flag / Note</span>
            </button>

            <button
              type="button"
              disabled={isSyncingTasks}
              onClick={handleRunTasksSync}
              aria-label="Sync Google Tasks"
              title={
                isSyncingTasks
                  ? 'Syncing Google Tasks...'
                  : lastTasksSync?.status === 'success'
                  ? 'Google Tasks synced — tap to sync again'
                  : lastTasksSync?.status === 'failed'
                  ? 'Google Tasks sync failed — tap to retry'
                  : 'Sync upcoming workouts with Google Tasks'
              }
              style={{
                borderColor: isSyncingTasks
                  ? 'var(--accent-orange)'
                  : lastTasksSync?.status === 'success'
                  ? 'var(--accent-sage)'
                  : lastTasksSync?.status === 'failed'
                  ? 'var(--accent-rust)'
                  : 'var(--border-card)',
                color: isSyncingTasks
                  ? 'var(--accent-orange)'
                  : lastTasksSync?.status === 'success'
                  ? 'var(--accent-sage)'
                  : lastTasksSync?.status === 'failed'
                  ? 'var(--accent-rust)'
                  : 'var(--text-muted)',
              }}
              className="tactile-btn p-2 rounded-xl bg-[var(--bg-inset)] border transition-colors shrink-0 disabled:opacity-60"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isSyncingTasks ? 'animate-spin' : ''}`} />
            </button>
          </div>
        )}
      </div>

      {/* Active Program Header Banner (+ Programming-Only Controls) */}
      {(selectedProgram || subTab === 'programming') && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl px-4 py-3.5 sm:px-5 border border-slate-200/80 dark:border-slate-800 space-y-3">
          {/* Row 1: Title & Active Date Range on left, Cycle Pill aligned top-right */}
          {selectedProgram ? (
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1 space-y-0.5">
                <h2
                  className="font-display font-extrabold leading-tight tracking-tight text-[var(--text-primary)] break-words"
                  style={{ fontSize: '21px' }}
                >
                  {selectedProgram.title}
                </h2>
                <p
                  className="font-medium leading-snug"
                  style={{ fontSize: '13px', color: 'var(--text-muted)' }}
                >
                  {activeProgramDateRange}
                </p>
              </div>
              <span className="mt-0.5 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full bg-orange-500/12 text-orange-600 dark:text-orange-400 shrink-0">
                {selectedProgram.cycleLengthWeeks}-Week Cycle
              </span>
            </div>
          ) : (
            <div className="text-xs font-semibold text-[var(--text-muted)]">
              No active training program yet.
            </div>
          )}

          {/* Programming Sub-Tab Controls */}
          {subTab === 'programming' && (
            <>
              {/* Row 2: Even 3-Button Grid (Change | Edit | + New) */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '8px',
                }}
              >
                <button
                  type="button"
                  onClick={() => setChangeProgramModalOpen(true)}
                  className="tactile-btn h-9 px-2.5 rounded-xl bg-[var(--bg-inset)] border border-[var(--border-card)] text-[var(--text-primary)] hover:border-[var(--accent-orange)] text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors min-w-0"
                >
                  <ArrowRightLeft className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                  <span className="truncate">Change</span>
                </button>
                <button
                  type="button"
                  disabled={!selectedProgram}
                  onClick={() => setProgramEditMenuOpen(true)}
                  aria-label="Edit Active Program"
                  aria-expanded={programEditMenuOpen}
                  title="Rename, duplicate, clear, or delete program"
                  className="tactile-btn h-9 px-2.5 rounded-xl bg-[var(--bg-inset)] border border-[var(--border-card)] text-[var(--text-primary)] hover:border-[var(--accent-orange)] disabled:opacity-40 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors min-w-0"
                >
                  <Pencil className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                  <span className="truncate">Edit</span>
                </button>
                <button
                  type="button"
                  onClick={() => setNewProgramModal(true)}
                  title="Create a new multi-week program"
                  className="tactile-btn h-9 px-2.5 rounded-xl bg-orange-500/12 border border-orange-500/30 hover:bg-orange-500 text-orange-600 dark:text-orange-400 hover:text-white text-xs font-bold inline-flex items-center justify-center gap-1 transition-colors min-w-0"
                >
                  <Plus className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">New</span>
                </button>
              </div>

              {/* Row 3: Sync Strip (Last sync status on left, Sync Tasks button on right) */}
              <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between gap-2 min-w-0">
                <span
                  className="text-[11px] font-medium tabular-nums truncate"
                  style={{
                    color: lastTasksSync
                      ? lastTasksSync.status === 'success'
                        ? 'var(--accent-sage)'
                        : 'var(--accent-rust)'
                      : 'var(--text-muted)',
                  }}
                >
                  {lastTasksSync
                    ? `Last sync: ${new Date(lastTasksSync.timestamp).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })} · ${lastTasksSync.status === 'success' ? 'Success' : 'Failed'}`
                    : 'Google Tasks: Not synced yet'}
                </span>

                <button
                  type="button"
                  disabled={isSyncingTasks}
                  onClick={handleRunTasksSync}
                  title="Two-way sync upcoming 7 days with Google Tasks"
                  className="tactile-btn px-3 py-1.5 rounded-xl bg-[var(--bg-inset)] border border-[var(--border-card)] text-[var(--text-primary)] hover:border-[var(--accent-orange)] text-xs font-bold inline-flex items-center gap-1.5 transition-colors disabled:opacity-50 shrink-0"
                >
                  <RefreshCw
                    className={`w-3.5 h-3.5 text-[var(--accent-sage)] ${
                      isSyncingTasks ? 'animate-spin' : ''
                    }`}
                  />
                  <span>{isSyncingTasks ? 'Syncing...' : 'Sync Tasks'}</span>
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tasksActionToast && (
        <div
          style={{
            borderColor:
              tasksActionToast.status === 'synced'
                ? 'var(--accent-sage)'
                : 'var(--accent-orange)',
            color:
              tasksActionToast.status === 'synced'
                ? 'var(--accent-sage)'
                : 'var(--accent-orange)',
          }}
          className="rounded-2xl bg-[var(--bg-card)] border px-3.5 py-2 text-xs font-bold flex items-center gap-2 shadow-xs"
        >
          <span>{tasksActionToast.message}</span>
        </div>
      )}

      {/* SUB-TAB 0: UPCOMING AGENDA VIEW (DEFAULT) */}
      {subTab === 'upcoming' ? (
        <div className="space-y-4">
          {/* Range Filter & Hide Rest Days Controls */}
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-3.5 sm:p-4 border border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 7, label: 'Next 7 Days' },
                  { id: 14, label: 'Next 14 Days' },
                  { id: 30, label: 'Next 30 Days' },
                  { id: 'all', label: 'All Scheduled' },
                ] as Array<{ id: 7 | 14 | 30 | 'all'; label: string }>
              ).map((rng) => (
                <button
                  key={String(rng.id)}
                  type="button"
                  onClick={() => setUpcomingRange(rng.id)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors ${
                    upcomingRange === rng.id
                      ? 'bg-slate-900 dark:bg-orange-500 text-white'
                      : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {rng.label}
                </button>
              ))}
            </div>

            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={hideRestDays}
                onChange={(e) => setHideRestDays(e.target.checked)}
                className="rounded border-slate-300 text-orange-500 focus:ring-orange-500"
              />
              Hide Rest Days
            </label>
          </div>

          {/* Chronological Day Cards */}
          <div className="space-y-3">
            {upcomingDayList.map(({ date, items }) => {
              const isTodayCard = date === todayIso;
              const isEditingThisDay = editingUpcomingDate === date;

              return (
                <div
                  key={date}
                  className={`rounded-3xl p-4 sm:p-5 bg-white dark:bg-slate-900 border transition-all space-y-3 ${
                    isTodayCard
                      ? 'border-orange-500 ring-1 ring-orange-500/20'
                      : 'border-slate-200/80 dark:border-slate-800'
                  }`}
                >
                  {/* Day Card Header */}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-display font-extrabold text-sm sm:text-base text-slate-900 dark:text-slate-100">
                        {formatReadableDate(date)}
                      </span>
                      {isTodayCard && (
                        <span className="px-2 py-0.5 text-[10px] font-bold uppercase rounded-full bg-orange-500 text-white">
                          Today
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingUpcomingDate(isEditingThisDay ? null : date);
                          setInlinePresetSearch('');
                        }}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold inline-flex items-center gap-1 transition-colors ${
                          isEditingThisDay
                            ? 'bg-slate-900 dark:bg-slate-700 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:border-orange-500'
                        }`}
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        {isEditingThisDay ? 'Done' : 'Edit Day'}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setActiveDate(date);
                          setActiveTab('log');
                        }}
                        className="px-3.5 py-1.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-1 shadow-2xs transition-colors"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        Start / Log
                      </button>
                    </div>
                  </div>

                  {/* Mitigating Factors / Schedule Context Banners for This Day */}
                  {(() => {
                    const dayFlags = getContextBlocksForDate(contextBlocks, date);
                    if (dayFlags.length === 0) return null;
                    return (
                      <div className="space-y-1.5">
                        {dayFlags.map((flag) => {
                          const cat = CONTEXT_CATEGORY_MAP[flag.category];
                          return (
                            <button
                              key={flag.id}
                              type="button"
                              onClick={() =>
                                setContextModalState({
                                  open: true,
                                  editingBlock: flag,
                                  initialDate: date,
                                })
                              }
                              title="Tap to edit or delete schedule flag"
                              className={`w-full text-left px-3 py-2 rounded-2xl border flex items-start justify-between gap-2 transition-opacity hover:opacity-90 ${cat.bgClass} ${cat.borderClass} ${cat.textClass}`}
                            >
                              <div className="min-w-0 flex-1">
                                <div className="text-xs font-bold flex items-center gap-1.5">
                                  <span>{cat.emoji}</span>
                                  <span className="truncate">{flag.title}</span>
                                </div>
                                {flag.notes && (
                                  <p className="text-[11px] opacity-85 mt-0.5 line-clamp-2">
                                    {flag.notes}
                                  </p>
                                )}
                              </div>
                              <Edit3 className="w-3.5 h-3.5 opacity-60 shrink-0 mt-0.5" />
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* Scheduled Workouts or Empty Rest Indicator */}
                  {items.length === 0 ? (
                    <div className="py-3 px-4 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs text-slate-400">
                      <span>Rest / Recovery Day</span>
                      {!isEditingThisDay && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingUpcomingDate(date);
                            setInlinePresetSearch('');
                          }}
                          className="text-xs font-bold text-orange-500 hover:underline"
                        >
                          + Add Workout
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {items.map((item, idx) => {
                        const preset = presets.find((p) => p.presetUuid === item.presetUuid);
                        const itemStatus = normalizeScheduleStatus(item.status);
                        const statusMeta = SCHEDULE_STATUS_META[itemStatus];
                        return (
                          <div
                            key={item.scheduleItemUuid}
                            className={`p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 space-y-2 transition-opacity ${
                              itemStatus === 'skipped' ? 'opacity-55' : ''
                            }`}
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2 min-w-0">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-orange-500/15 text-orange-600 dark:text-orange-400 shrink-0">
                                  {item.slotRole}
                                </span>
                                {isEditingThisDay && itemStatus !== 'completed' ? (
                                  <select
                                    value={item.presetUuid}
                                    onChange={(e) => {
                                      const nextPresetUuid = e.target.value;
                                      const swappedPreset = presets.find(
                                        (p) => p.presetUuid === nextPresetUuid
                                      );
                                      updateDailySchedule(
                                        date,
                                        items.map((it) =>
                                          it.scheduleItemUuid === item.scheduleItemUuid
                                            ? {
                                                ...it,
                                                presetUuid: nextPresetUuid,
                                                updatedAt: new Date().toISOString(),
                                              }
                                            : it
                                        )
                                      );
                                      if (swappedPreset) {
                                        triggerNotice(`Swapped to "${swappedPreset.title}"`);
                                      }
                                    }}
                                    style={{ minWidth: 0, flex: '1 1 0%', width: '100%' }}
                                    className="min-w-0 flex-1 w-full px-2 py-1 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 truncate"
                                  >
                                    {presets.map((p) => (
                                      <option key={p.presetUuid} value={p.presetUuid}>
                                        {p.title}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <span className="font-display font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                                    {preset?.title || 'Workout'}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  title="Tap to change workout status"
                                  onClick={() =>
                                    setStatusPickerTarget({
                                      date,
                                      scheduleItemUuid: item.scheduleItemUuid,
                                      title: preset?.title || 'Workout',
                                      currentStatus: itemStatus,
                                    })
                                  }
                                  className={`tactile-pill text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 cursor-pointer hover:brightness-105 transition-all ${statusMeta.badgeClass}`}
                                >
                                  {itemStatus === 'completed' ? (
                                    <CheckCircle2 className="w-3 h-3" />
                                  ) : itemStatus === 'in_progress' ? (
                                    <Flame className="w-3 h-3" />
                                  ) : itemStatus === 'skipped' ? (
                                    <XCircle className="w-3 h-3" />
                                  ) : (
                                    <Clock className="w-3 h-3" />
                                  )}
                                  {formatScheduleStatusLabel(itemStatus)}
                                </button>

                                {isEditingThisDay && (
                                  <>
                                    {items.length > 1 && (
                                      <>
                                        <button
                                          type="button"
                                          title="Move up"
                                          disabled={idx === 0}
                                          onClick={() => handleReorderSlot(date, idx, -1)}
                                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30"
                                        >
                                          <ArrowUp className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          type="button"
                                          title="Move down"
                                          disabled={idx === items.length - 1}
                                          onClick={() => handleReorderSlot(date, idx, 1)}
                                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30"
                                        >
                                          <ArrowDown className="w-3.5 h-3.5" />
                                        </button>
                                      </>
                                    )}
                                    <button
                                      type="button"
                                      title="Remove workout"
                                      onClick={() =>
                                        removeScheduledItemFromDate(date, item.scheduleItemUuid)
                                      }
                                      className="p-1 rounded text-slate-400 hover:text-rose-500"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>

                            {isEditingThisDay ? (
                              <input
                                type="text"
                                value={item.coachNotes || ''}
                                placeholder="Edit target notes, rep progression, or injury override..."
                                onChange={(e) =>
                                  handleUpdateCoachNotes(
                                    date,
                                    item.scheduleItemUuid,
                                    e.target.value
                                  )
                                }
                                className="w-full px-2.5 py-1.5 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 focus:outline-none focus:border-orange-500"
                              />
                            ) : (
                              item.coachNotes && (
                                <p className="text-xs text-slate-500 dark:text-slate-400">
                                  {item.coachNotes}
                                </p>
                              )
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Inline Add Workout Drawer when Edit Day is active */}
                  {isEditingThisDay && (
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          type="text"
                          value={inlinePresetSearch}
                          onChange={(e) => setInlinePresetSearch(e.target.value)}
                          placeholder="Search preset to add to this day..."
                          className="min-w-0 w-full sm:w-auto sm:flex-1 px-3 py-1.5 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-orange-500"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setScheduleModal({
                              open: true,
                              date,
                              presetUuid: presets[0]?.presetUuid || '',
                              slotRole: items.length === 0 ? 'Primary' : 'Secondary',
                              coachNotes: '',
                            })
                          }
                          className="px-3 py-1.5 rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-400 text-xs font-bold hover:bg-orange-500 hover:text-white transition-colors"
                        >
                          + Custom Slot
                        </button>
                        {items.length > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              updateDailySchedule(date, []);
                              triggerNotice(`Cleared ${items.length} workout(s) on ${formatReadableDate(date)}`);
                            }}
                            title="Remove all scheduled workouts on this day"
                            className="px-3 py-1.5 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-bold hover:bg-rose-500 hover:text-white inline-flex items-center gap-1 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Clear Day
                          </button>
                        )}
                      </div>

                      {inlinePresetSearch.trim() && (
                        <div className="max-h-40 overflow-y-auto space-y-1 p-1.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                          {presets
                            .filter(
                              (p) =>
                                p.title
                                  .toLowerCase()
                                  .includes(inlinePresetSearch.toLowerCase()) ||
                                p.workoutType
                                  .toLowerCase()
                                  .includes(inlinePresetSearch.toLowerCase())
                            )
                            .map((p) => (
                              <button
                                key={p.presetUuid}
                                type="button"
                                onClick={() => {
                                  addScheduledItemToDate(
                                    date,
                                    p.presetUuid,
                                    items.length === 0 ? 'Primary' : 'Secondary',
                                    ''
                                  );
                                  setInlinePresetSearch('');
                                  triggerNotice(`Added "${p.title}" to ${formatReadableDate(date)}`);
                                }}
                                className="w-full text-left px-3 py-2 rounded-xl hover:bg-orange-500/10 text-xs font-semibold flex items-center justify-between"
                              >
                                <span>{p.title}</span>
                                <span className="text-[10px] font-bold text-orange-500">
                                  + Add
                                </span>
                              </button>
                            ))}
                        </div>
                      )}
                      {/* Quick Add Day Flag Section inside Edit Day */}
                      <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-1.5">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--text-muted)]">
                          Add Day Flag (e.g. Work Trip)
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {CONTEXT_CATEGORY_LIST.map((cat) => (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() =>
                                setContextModalState({
                                  open: true,
                                  editingBlock: null,
                                  initialDate: date,
                                  initialCategory: cat.id,
                                })
                              }
                              className="tactile-pill px-2.5 py-1 rounded-xl text-[11px] font-bold bg-[var(--bg-inset)] border border-[var(--border-card)] text-[var(--text-secondary)] hover:border-orange-500/50 hover:text-[var(--text-primary)] inline-flex items-center gap-1 transition-colors"
                            >
                              <span>{cat.emoji}</span>
                              <span>{cat.shortLabel}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : subTab === 'calendar' ? (
        <div
          className={`grid gap-4 items-start ${
            isMobile ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-12'
          }`}
        >
          {/* Calendar Grid Card */}
          <div
            className={`${
              isMobile ? '' : 'lg:col-span-8'
            } bg-white dark:bg-slate-900 rounded-3xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 shadow-2xs space-y-3`}
          >
            {/* Month Navigation Bar */}
            <div className="flex items-center justify-between gap-2 pb-1">
              <div className="flex items-center gap-2">
                <h2 className="font-display font-extrabold text-base sm:text-lg text-slate-900 dark:text-slate-100">
                  {monthTitle}
                </h2>
                <button
                  type="button"
                  data-tooltip="Jump to Today"
                  title="Jump to Today"
                  onClick={() => {
                    const [y, m] = todayIso.split('-').map(Number);
                    setViewYear(y);
                    setViewMonth(m - 1);
                    setSelectedDate(todayIso);
                  }}
                  className="px-2.5 py-1 rounded-xl text-[11px] font-bold bg-orange-500/10 text-orange-600 dark:text-orange-400 hover:bg-orange-500 hover:text-white transition-colors"
                >
                  Today
                </button>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => stepMonth(-1)}
                  data-tooltip="Previous Month"
                  title="Previous Month"
                  className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-orange-500 hover:text-white transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => stepMonth(1)}
                  data-tooltip="Next Month"
                  title="Next Month"
                  className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-orange-500 hover:text-white transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Day-of-Week Column Headers */}
            <div className="grid grid-cols-7 gap-1 text-center">
              {SHORT_DAYS_MON_FIRST.map((dayName) => (
                <div
                  key={dayName}
                  className="text-[11px] font-bold uppercase tracking-wider text-slate-400 py-1"
                >
                  {isMobile ? dayName.slice(0, 1) : dayName}
                </div>
              ))}
            </div>

            {/* 7x6 Calendar Day Cells */}
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {calendarCells.map((cell) => {
                const daySchedItems = schedules[cell.isoDate]?.items || [];
                const dayLogs = logs.filter(
                  (l) => l.date === cell.isoDate && l.status === 'completed'
                );
                const isTodayCell = cell.isoDate === todayIso;
                const isSelectedCell = cell.isoDate === selectedDate;

                return (
                  <div
                    key={cell.isoDate}
                    onClick={() => setSelectedDate(cell.isoDate)}
                    className={`${
                      isMobile
                        ? 'h-13 p-1 rounded-xl items-center justify-between'
                        : 'min-h-[88px] p-2 rounded-2xl justify-between'
                    } border cursor-pointer transition-all flex flex-col select-none ${
                      isSelectedCell
                        ? 'border-orange-500 ring-2 ring-orange-500/25 bg-orange-500/[0.06] dark:bg-orange-500/[0.12]'
                        : isTodayCell
                        ? 'border-orange-500/50 bg-slate-50 dark:bg-slate-800/60'
                        : cell.inCurrentMonth
                        ? 'border-slate-200/70 dark:border-slate-800/90 bg-slate-50/40 dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                        : 'border-transparent bg-slate-100/30 dark:bg-slate-900/30 opacity-40'
                    }`}
                  >
                    {/* Day Number */}
                    <div
                      className={`flex items-center ${
                        isMobile ? 'justify-center' : 'justify-between w-full'
                      }`}
                    >
                      <span
                        className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center tabular-nums ${
                          isTodayCell
                            ? 'bg-orange-500 text-white shadow-2xs'
                            : isSelectedCell
                            ? 'text-orange-600 dark:text-orange-400 font-extrabold'
                            : 'text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {cell.dayNum}
                      </span>

                      {!isMobile && dayLogs.length > 0 && (
                        <span
                          title={`${dayLogs.length} completed workout(s)`}
                          className="w-2 h-2 rounded-full bg-emerald-500"
                        />
                      )}
                    </div>

                    {/* Subtle Context Block Bar on Calendar Date */}
                    {(() => {
                      const cellFlags = getContextBlocksForDate(contextBlocks, cell.isoDate);
                      if (cellFlags.length === 0) return null;
                      return (
                        <div className="flex items-center justify-center gap-0.5 w-full px-0.5 mb-0.5">
                          {cellFlags.slice(0, 3).map((flag) => {
                            const cat = CONTEXT_CATEGORY_MAP[flag.category];
                            return (
                              <span
                                key={flag.id}
                                title={`${cat.emoji} ${flag.title}`}
                                className={`h-1 flex-1 rounded-full ${cat.dotClass}`}
                              />
                            );
                          })}
                        </div>
                      );
                    })()}

                    {/* Mobile: Crisp Indicator Dots | Desktop: Workout Title Chips */}
                    {isMobile ? (
                      <div className="flex items-center justify-center gap-1 pb-0.5">
                        {daySchedItems.map((it) => {
                          const st = normalizeScheduleStatus(it.status);
                          return (
                            <span
                              key={it.scheduleItemUuid}
                              className={`w-1.5 h-1.5 rounded-full ${
                                st === 'completed'
                                  ? 'bg-emerald-500'
                                  : st === 'skipped'
                                  ? 'bg-slate-400 opacity-60'
                                  : 'bg-orange-500'
                              }`}
                            />
                          );
                        })}
                        {daySchedItems.length === 0 && dayLogs.length > 0 && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1 mt-1 overflow-hidden w-full">
                        {daySchedItems.slice(0, 2).map((it) => {
                          const preset = presets.find((p) => p.presetUuid === it.presetUuid);
                          const st = normalizeScheduleStatus(it.status);
                          const isDone = st === 'completed';
                          return (
                            <div
                              key={it.scheduleItemUuid}
                              className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold truncate flex items-center gap-1 ${
                                isDone
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  : st === 'skipped'
                                  ? 'bg-slate-200/70 dark:bg-slate-800 text-slate-400 line-through'
                                  : 'bg-orange-500/15 text-orange-700 dark:text-orange-300'
                              }`}
                            >
                              {isDone && <CheckCircle2 className="w-2.5 h-2.5 shrink-0" />}
                              <span className="truncate">{preset?.title || it.slotRole}</span>
                            </div>
                          );
                        })}
                        {daySchedItems.length > 2 && (
                          <div className="text-[9px] font-bold text-slate-400 pl-1">
                            +{daySchedItems.length - 2} more
                          </div>
                        )}
                        {daySchedItems.length === 0 && dayLogs.length > 0 && (
                          <div className="px-1.5 py-0.5 rounded-md text-[10px] font-semibold truncate bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                            {dayLogs[0].workoutTitleSnapshot}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selected Date Schedule Inspector (Stacks Below on Mobile, Right Column on Desktop) */}
          <div
            className={`${
              isMobile ? '' : 'lg:col-span-4'
            } bg-white dark:bg-slate-900 rounded-3xl p-4 sm:p-5 border border-slate-200/80 dark:border-slate-800 shadow-2xs space-y-4`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-100 dark:border-slate-800">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-orange-500">
                  Selected Date
                </div>
                <h3 className="font-display font-bold text-base text-slate-900 dark:text-slate-100">
                  {formatReadableDate(selectedDate)}
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {selectedDayItems.length > 0 && (
                  <button
                    type="button"
                    data-tooltip="Clear all scheduled workouts on this date"
                    title="Clear all scheduled workouts on this date"
                    onClick={() => {
                      updateDailySchedule(selectedDate, []);
                      triggerNotice(
                        `Cleared ${selectedDayItems.length} workout(s) on ${formatReadableDate(selectedDate)}`
                      );
                    }}
                    className="px-2.5 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500 hover:text-white text-rose-600 dark:text-rose-400 text-xs font-bold inline-flex items-center gap-1 transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Clear Day
                  </button>
                )}

                <button
                  type="button"
                  data-tooltip="Add a workout to this date"
                  title="Add a workout to this date"
                  onClick={() =>
                    setScheduleModal({
                      open: true,
                      date: selectedDate,
                      presetUuid: presets[0]?.presetUuid || '',
                      slotRole: selectedDayItems.length === 0 ? 'Primary' : 'Secondary',
                      coachNotes: '',
                    })
                  }
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-orange-500 hover:text-white dark:bg-slate-800 text-xs font-bold inline-flex items-center gap-1 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>

                <button
                  type="button"
                  data-tooltip="Open this date on the Gym Floor Log"
                  title="Open this date on the Gym Floor Log"
                  onClick={() => {
                    setActiveDate(selectedDate);
                    setActiveTab('log');
                  }}
                  className="px-3 py-1.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-1 shadow-2xs transition-colors"
                >
                  <Play className="w-3 h-3 fill-current" /> Log Day
                </button>
              </div>
            </div>

            {/* Selected Day Context Banners + Quick Add Flag */}
            {(() => {
              const selectedDayFlags = getContextBlocksForDate(contextBlocks, selectedDate);
              if (selectedDayFlags.length === 0) return null;
              return (
                <div className="space-y-1.5">
                  {selectedDayFlags.map((flag) => {
                    const cat = CONTEXT_CATEGORY_MAP[flag.category];
                    return (
                      <button
                        key={flag.id}
                        type="button"
                        onClick={() =>
                          setContextModalState({
                            open: true,
                            editingBlock: flag,
                            initialDate: selectedDate,
                          })
                        }
                        className={`w-full text-left px-3 py-2 rounded-2xl border flex items-start justify-between gap-2 ${cat.bgClass} ${cat.borderClass} ${cat.textClass}`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold flex items-center gap-1.5">
                            <span>{cat.emoji}</span>
                            <span className="truncate">{flag.title}</span>
                          </div>
                          {flag.notes && (
                            <p className="text-[11px] opacity-85 mt-0.5">{flag.notes}</p>
                          )}
                        </div>
                        <Edit3 className="w-3.5 h-3.5 opacity-60 shrink-0 mt-0.5" />
                      </button>
                    );
                  })}
                </div>
              );
            })()}

            {/* Scheduled Workouts List for Selected Day */}
            {selectedDayItems.length === 0 ? (
              <div className="py-8 px-4 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center space-y-2">
                <p className="text-xs font-medium text-slate-500">
                  No workouts scheduled on {formatReadableDate(selectedDate)}.
                </p>
                <button
                  type="button"
                  onClick={() =>
                    setScheduleModal({
                      open: true,
                      date: selectedDate,
                      presetUuid: presets[0]?.presetUuid || '',
                      slotRole: 'Primary',
                      coachNotes: '',
                    })
                  }
                  className="text-xs font-bold text-orange-500 hover:underline"
                >
                  + Schedule a Workout
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                {selectedDayItems.map((item, idx) => {
                  const preset = presets.find((p) => p.presetUuid === item.presetUuid);
                  const itemStatus = normalizeScheduleStatus(item.status);
                  const statusMeta = SCHEDULE_STATUS_META[itemStatus];
                  return (
                    <div
                      key={item.scheduleItemUuid}
                      className={`p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 space-y-2 transition-opacity ${
                        itemStatus === 'skipped' ? 'opacity-55' : ''
                      }`}
                    >
                      {/* Top Badge Row: Slot Role + Status + Actions (Never Overlaps!) */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-orange-500/15 text-orange-600 dark:text-orange-400">
                            {item.slotRole}
                          </span>
                          <button
                            type="button"
                            title="Tap to change workout status"
                            onClick={() =>
                              setStatusPickerTarget({
                                date: selectedDate,
                                scheduleItemUuid: item.scheduleItemUuid,
                                title: preset?.title || 'Workout',
                                currentStatus: itemStatus,
                              })
                            }
                            className={`tactile-pill text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 cursor-pointer hover:brightness-105 transition-all ${statusMeta.badgeClass}`}
                          >
                            {itemStatus === 'completed' ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : itemStatus === 'in_progress' ? (
                              <Flame className="w-3 h-3" />
                            ) : itemStatus === 'skipped' ? (
                              <XCircle className="w-3 h-3" />
                            ) : (
                              <Clock className="w-3 h-3" />
                            )}
                            {formatScheduleStatusLabel(itemStatus)}
                          </button>
                        </div>

                        <div className="flex items-center gap-1">
                          {selectedDayItems.length > 1 && (
                            <>
                              <button
                                type="button"
                                title="Move slot up"
                                onClick={() => handleReorderSlot(selectedDate, idx, -1)}
                                disabled={idx === 0}
                                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                title="Move slot down"
                                onClick={() => handleReorderSlot(selectedDate, idx, 1)}
                                disabled={idx === selectedDayItems.length - 1}
                                className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-30"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            title="Remove scheduled workout"
                            onClick={() =>
                              removeScheduledItemFromDate(selectedDate, item.scheduleItemUuid)
                            }
                            className="p-1 rounded text-slate-400 hover:text-rose-500"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Full-Width Workout Title */}
                      <div className="font-display font-bold text-sm text-slate-900 dark:text-slate-100">
                        {preset?.title || 'Workout'}
                      </div>

                      <div className="flex items-center gap-1.5 pt-0.5">
                        <Edit3 className="w-3 h-3 text-slate-400 shrink-0" />
                        <input
                          type="text"
                          value={item.coachNotes || ''}
                          placeholder="Add target notes or cues..."
                          onChange={(e) =>
                            handleUpdateCoachNotes(
                              selectedDate,
                              item.scheduleItemUuid,
                              e.target.value
                            )
                          }
                          className="w-full text-xs bg-transparent text-slate-600 dark:text-slate-300 placeholder:text-slate-400 focus:outline-none border-b border-transparent focus:border-orange-500"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Completed Logs Summary on Selected Date */}
            {selectedDayLogs.length > 0 && (
              <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
                <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  Logged on This Day ({selectedDayLogs.length})
                </div>
                {selectedDayLogs.map((l) => (
                  <div
                    key={l.logUuid}
                    className="p-2.5 rounded-xl bg-emerald-500/[0.06] border border-emerald-500/20 flex items-center justify-between text-xs"
                  >
                    <span className="font-bold truncate">{l.workoutTitleSnapshot}</span>
                    <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                      {l.totalSessionVolumeKg.toLocaleString()} kg
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        /* SUB-TAB 2: PROGRAMMING & AUTO-FILL ENGINE */
        <div className="space-y-4">
          {!selectedProgram ? (
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-200/80 dark:border-slate-800 text-center space-y-3">
              <p className="text-sm font-semibold text-slate-600 dark:text-slate-300">
                No training program selected.
              </p>
              <button
                type="button"
                onClick={() => setNewProgramModal(true)}
                className="px-4 py-2 rounded-2xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                Create Training Program
              </button>
            </div>
          ) : (
            <>
              <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 space-y-4">
                <div className="space-y-1 min-w-0">
                  <h2 className="font-display font-bold text-base sm:text-lg text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-orange-500 shrink-0" />
                    <span className="break-words">
                      Auto-Fill Calendar from &ldquo;{selectedProgram.title}&rdquo;
                    </span>
                  </h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Populate your calendar between any start and end date using the weekly
                    rotating schedule below.
                  </p>
                </div>

                {/* Portaled Program Actions Sheet (opened from Active Program Header Edit button) */}
                <ModalPortal
                  open={programEditMenuOpen}
                  onClose={() => setProgramEditMenuOpen(false)}
                  sheetOnMobile
                  backdropClassName="items-end sm:items-center p-3 sm:p-4 bg-black/50 backdrop-blur-xs"
                >
                      <div className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-2xl p-3 space-y-1 text-[var(--text-primary)]">
                        <div className="px-2 pb-1.5 mb-1 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
                          <span className="font-display font-bold text-xs uppercase tracking-wider text-[var(--text-muted)] truncate">
                            Program Actions
                          </span>
                          <button
                            type="button"
                            onClick={() => setProgramEditMenuOpen(false)}
                            className="px-2 py-0.5 rounded-lg text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500"
                          >
                            Close
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => {
                            setProgramEditMenuOpen(false);
                            setRenameModal({ open: true, title: selectedProgram.title });
                          }}
                          className="w-full px-3 py-2.5 rounded-xl text-left text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                          Rename Program
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setProgramEditMenuOpen(false);
                            const now = new Date().toISOString();
                            const clonedTitle = `${selectedProgram.title} (Copy)`;
                            const cloned: WorkoutProgram = {
                              ...JSON.parse(JSON.stringify(selectedProgram)),
                              programUuid: `prog-${uuidv4()}`,
                              slug: slugify(clonedTitle, 'prg'),
                              title: clonedTitle,
                              createdAt: now,
                              updatedAt: now,
                            };
                            upsertProgram(cloned);
                            setActiveProgram(cloned.programUuid);
                            triggerNotice(`Duplicated as "${clonedTitle}"`);
                          }}
                          className="w-full px-3 py-2.5 rounded-xl text-left text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
                        >
                          <Copy className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                          Duplicate Program
                        </button>

                        <button
                          type="button"
                          onClick={async () => {
                            setProgramEditMenuOpen(false);
                            const payload = buildAiCoachExportPayload({
                              program: selectedProgram,
                              presets,
                              schedules,
                            });
                            try {
                              await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                              triggerNotice('Copied AI Coaching Context');
                            } catch {
                              triggerNotice('Clipboard blocked — export via Settings > AI Sync');
                            }
                          }}
                          className="w-full px-3 py-2.5 rounded-xl text-left text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
                        >
                          <Sparkles className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                          Export for AI Coach
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setProgramEditMenuOpen(false);
                            setAiNotesModalOpen(true);
                          }}
                          className="w-full px-3 py-2.5 rounded-xl text-left text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
                        >
                          <ClipboardPaste className="w-3.5 h-3.5 text-orange-500 shrink-0" />
                          Import AI Notes Patch
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setProgramEditMenuOpen(false);
                            const confirmed = window.confirm(
                              `Clear all upcoming scheduled workouts (>= today) for "${selectedProgram.title}"?`
                            );
                            if (!confirmed) return;
                            const { itemsRemoved, daysModified } =
                              clearFutureScheduledWorkoutsForProgram(
                                selectedProgram.programUuid
                              );
                            if (itemsRemoved > 0) {
                              triggerNotice(
                                `Cleared ${itemsRemoved} upcoming workout(s) across ${daysModified} day(s)`
                              );
                            } else {
                              triggerNotice('No upcoming scheduled workouts found for this program');
                            }
                          }}
                          className="w-full px-3 py-2.5 rounded-xl text-left text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 flex items-center gap-2 transition-colors"
                        >
                          <CalendarX className="w-3.5 h-3.5 shrink-0" />
                          Clear Future Scheduled Workouts
                        </button>

                        <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
                          <button
                            type="button"
                            onClick={() => {
                              setProgramEditMenuOpen(false);
                              setDeleteProgramConfirm(selectedProgram);
                            }}
                            className="w-full px-3 py-2.5 rounded-xl text-left text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5 shrink-0" />
                            Delete Program
                          </button>
                        </div>
                      </div>
                    </ModalPortal>

                {/* Autofill Controls: Side-by-Side Start/End Dates + Conflict Mode + Button */}
                <div className="space-y-3">
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
                      gap: '10px',
                      minWidth: 0,
                    }}
                  >
                    <div className="min-w-0">
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        Start Date
                      </label>
                      <input
                        type="date"
                        value={autoFillStart}
                        onChange={(e) => {
                          const nextStart = e.target.value;
                          setAutoFillStart(nextStart);
                          if (selectedProgram && nextStart && autoFillEnd) {
                            saveProgramAutofillDates(
                              selectedProgram.programUuid,
                              nextStart,
                              autoFillEnd
                            );
                          }
                        }}
                        className="w-full min-w-0 px-2.5 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                      />
                    </div>
                    <div className="min-w-0">
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        End Date
                      </label>
                      <input
                        type="date"
                        value={autoFillEnd}
                        onChange={(e) => {
                          const nextEnd = e.target.value;
                          setAutoFillEnd(nextEnd);
                          if (selectedProgram && autoFillStart && nextEnd) {
                            saveProgramAutofillDates(
                              selectedProgram.programUuid,
                              autoFillStart,
                              nextEnd
                            );
                          }
                        }}
                        className="w-full min-w-0 px-2.5 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                      />
                    </div>
                  </div>

                  <div
                    className={`grid gap-2.5 items-end ${
                      isMobile ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-2'
                    }`}
                  >
                    <div className="min-w-0">
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                        If Dates Already Have Workouts
                      </label>
                      <select
                        value={conflictMode}
                        onChange={(e) =>
                          setConflictMode(
                            e.target.value as 'replace' | 'update_matching' | 'skip'
                          )
                        }
                        className="w-full min-w-0 truncate px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                      >
                        <option value="update_matching">Update Matching Slots</option>
                        <option value="replace">Replace All</option>
                        <option value="skip">Skip Existing Days</option>
                      </select>
                    </div>
                    <button
                      type="button"
                      data-tooltip="Generate scheduled workouts on the calendar"
                      title="Generate scheduled workouts on the calendar"
                      onClick={() => {
                        saveProgramAutofillDates(
                          selectedProgram.programUuid,
                          autoFillStart,
                          autoFillEnd
                        );
                        const res = autoFillSchedule(
                          selectedProgram.programUuid,
                          autoFillStart,
                          autoFillEnd,
                          conflictMode
                        );
                        triggerNotice(
                          `Auto-filled ${res.daysModified} calendar days (${res.itemsCreated} workouts)!`
                        );
                        setSubTab('calendar');
                      }}
                      className="py-2.5 px-4 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-orange-500/20"
                    >
                      <Wand2 className="w-4 h-4" />
                      Auto-Fill Calendar
                    </button>
                  </div>
                </div>
              </div>

              {/* Rotating Week Tabs & Day Template Grid */}
              <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-5 h-5 text-orange-500" />
                    <h3 className="font-display font-bold text-base">
                      Weekly Schedule Template ({selectedProgram.cycleLengthWeeks} Weeks)
                    </h3>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {Array.from(
                      { length: selectedProgram.cycleLengthWeeks },
                      (_, i) => i + 1
                    ).map((wk) => (
                      <button
                        key={wk}
                        type="button"
                        onClick={() => setActiveTemplateWeek(wk)}
                        className={`px-3 py-1.5 rounded-xl text-xs font-bold ${
                          activeTemplateWeek === wk
                            ? 'bg-orange-500 text-white'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        Week {wk}
                      </button>
                    ))}
                    <button
                      type="button"
                      data-tooltip="Add another rotating week to this program"
                      title="Add another rotating week to this program"
                      onClick={() => {
                        const nextWeeks = selectedProgram.cycleLengthWeeks + 1;
                        upsertProgram({ ...selectedProgram, cycleLengthWeeks: nextWeeks });
                        setActiveTemplateWeek(nextWeeks);
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold text-orange-500"
                    >
                      + Week
                    </button>
                    <button
                      type="button"
                      data-tooltip="Clone this week into a new or existing week with optional progression note"
                      title="Duplicate & Progress Week"
                      onClick={() => {
                        const fallbackExisting =
                          Array.from(
                            { length: selectedProgram.cycleLengthWeeks },
                            (_, i) => i + 1
                          ).find((w) => w !== activeTemplateWeek) ?? 1;
                        setDuplicateWeekModal({
                          open: true,
                          targetMode: 'new',
                          targetWeek: fallbackExisting,
                          modifier: 'exact',
                        });
                      }}
                      className="px-2.5 py-1.5 rounded-xl bg-orange-500/10 hover:bg-orange-500/20 text-xs font-bold text-orange-600 dark:text-orange-400 inline-flex items-center gap-1 transition-colors"
                    >
                      <Copy className="w-3.5 h-3.5" />
                      Duplicate Week
                    </button>
                  </div>
                </div>

                <div className="p-3.5 rounded-2xl bg-orange-500/[0.06] border border-orange-500/20 space-y-1.5">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-orange-600 dark:text-orange-400">
                    Week {activeTemplateWeek} Focus / Progression Note
                  </label>
                  <input
                    type="text"
                    value={
                      selectedProgram.weekProgressionNotes?.[String(activeTemplateWeek)] || ''
                    }
                    placeholder={`e.g. Week ${activeTemplateWeek}: Target 14 reps or step up final sets...`}
                    onChange={(e) => {
                      const nextNotes = {
                        ...(selectedProgram.weekProgressionNotes || {}),
                        [String(activeTemplateWeek)]: e.target.value,
                      };
                      upsertProgram({ ...selectedProgram, weekProgressionNotes: nextNotes });
                    }}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700"
                  />
                </div>

                <div
                  className={`grid gap-3 ${
                    isMobile ? 'grid-cols-1' : 'grid-cols-1 md:grid-cols-2'
                  }`}
                >
                  {DAY_NAMES.map((dayLabel, dayOfWeek) => {
                    const dayTemplate = selectedProgram.scheduleTemplate.find(
                      (t) =>
                        t.weekNumber === activeTemplateWeek && t.dayOfWeek === dayOfWeek
                    );
                    const dayItems = dayTemplate?.items || [];

                    return (
                      <div
                        key={dayOfWeek}
                        className="scroll-target min-w-0 overflow-hidden p-3 sm:p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2.5"
                      >
                        <div className="flex items-center justify-between gap-2 min-w-0">
                          <span className="font-display font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100 truncate">
                            {dayLabel}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              handleAddTemplateSlot(
                                selectedProgram,
                                activeTemplateWeek,
                                dayOfWeek,
                                presets[0]?.presetUuid || '',
                                dayItems.length === 0 ? 'Primary' : 'Secondary',
                                ''
                              )
                            }
                            className="text-xs font-bold text-orange-500 hover:underline flex items-center gap-0.5 shrink-0"
                          >
                            <Plus className="w-3.5 h-3.5" /> Add Workout
                          </button>
                        </div>

                        {dayItems.length === 0 ? (
                          <div className="text-[11px] text-slate-400 italic py-2">
                            Rest Day
                          </div>
                        ) : (
                          <div className="space-y-2 min-w-0">
                            {dayItems.map((slot, slotIdx) => (
                              <div
                                key={slotIdx}
                                className="min-w-0 overflow-hidden p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-2"
                              >
                                <div className="flex items-center gap-1.5 min-w-0 w-full">
                                  <select
                                    value={slot.slotRole}
                                    onChange={(e) => {
                                      const role = e.target.value;
                                      const updatedTemplate =
                                        selectedProgram.scheduleTemplate.map((dt) => {
                                          if (
                                            dt.weekNumber !== activeTemplateWeek ||
                                            dt.dayOfWeek !== dayOfWeek
                                          )
                                            return dt;
                                          return {
                                            ...dt,
                                            items: dt.items.map((it, i) =>
                                              i === slotIdx ? { ...it, slotRole: role } : it
                                            ),
                                          };
                                        });
                                      upsertProgram({
                                        ...selectedProgram,
                                        scheduleTemplate: updatedTemplate,
                                      });
                                    }}
                                    className="shrink-0 max-w-[92px] px-1.5 py-1 text-[11px] font-bold rounded-lg bg-orange-500/10 text-orange-600 dark:text-orange-400 truncate"
                                  >
                                    {SLOT_ROLES.map((r) => (
                                      <option key={r} value={r}>
                                        {r}
                                      </option>
                                    ))}
                                  </select>

                                  <select
                                    value={slot.presetUuid}
                                    onChange={(e) => {
                                      const newPreset = e.target.value;
                                      const updatedTemplate =
                                        selectedProgram.scheduleTemplate.map((dt) => {
                                          if (
                                            dt.weekNumber !== activeTemplateWeek ||
                                            dt.dayOfWeek !== dayOfWeek
                                          )
                                            return dt;
                                          return {
                                            ...dt,
                                            items: dt.items.map((it, i) =>
                                              i === slotIdx
                                                ? { ...it, presetUuid: newPreset }
                                                : it
                                            ),
                                          };
                                        });
                                      upsertProgram({
                                        ...selectedProgram,
                                        scheduleTemplate: updatedTemplate,
                                      });
                                    }}
                                    style={{
                                      minWidth: 0,
                                      flex: '1 1 0%',
                                      width: '100%',
                                      textOverflow: 'ellipsis',
                                    }}
                                    className="min-w-0 flex-1 w-full px-2 py-1 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 truncate"
                                  >
                                    {presets.map((p) => (
                                      <option key={p.presetUuid} value={p.presetUuid}>
                                        {p.title}
                                      </option>
                                    ))}
                                  </select>

                                  <button
                                    type="button"
                                    title="Remove workout slot"
                                    onClick={() =>
                                      handleRemoveTemplateSlot(
                                        selectedProgram,
                                        activeTemplateWeek,
                                        dayOfWeek,
                                        slotIdx
                                      )
                                    }
                                    className="p-1 text-slate-400 hover:text-rose-500 shrink-0"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>

                                <input
                                  type="text"
                                  value={slot.defaultNotes || ''}
                                  placeholder="Default note (e.g. 15 rounds EMOM)..."
                                  onChange={(e) => {
                                    const notes = e.target.value;
                                    const updatedTemplate =
                                      selectedProgram.scheduleTemplate.map((dt) => {
                                        if (
                                          dt.weekNumber !== activeTemplateWeek ||
                                          dt.dayOfWeek !== dayOfWeek
                                        )
                                          return dt;
                                        return {
                                          ...dt,
                                          items: dt.items.map((it, i) =>
                                            i === slotIdx ? { ...it, defaultNotes: notes } : it
                                          ),
                                        };
                                      });
                                    upsertProgram({
                                      ...selectedProgram,
                                      scheduleTemplate: updatedTemplate,
                                    });
                                  }}
                                  className="w-full px-2 py-1 text-[11px] rounded bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300"
                                />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Modal: Add Scheduled Workout Slot to a Date (Portaled z-1000) */}
      <ModalPortal
        open={scheduleModal.open}
        onClose={() => setScheduleModal({ ...scheduleModal, open: false })}
      >
        <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-2xl text-[var(--text-primary)]">
          <h3 className="font-display font-bold text-base">
            Schedule Workout for {formatReadableDate(scheduleModal.date)}
          </h3>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                Slot Type
              </label>
              <select
                value={scheduleModal.slotRole}
                onChange={(e) =>
                  setScheduleModal({ ...scheduleModal, slotRole: e.target.value })
                }
                className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              >
                {SLOT_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                Workout
              </label>
              <select
                value={scheduleModal.presetUuid}
                onChange={(e) =>
                  setScheduleModal({ ...scheduleModal, presetUuid: e.target.value })
                }
                className="w-full px-3 py-2 text-xs font-semibold rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              >
                {presets.map((p) => (
                  <option key={p.presetUuid} value={p.presetUuid}>
                    {p.title} ({p.workoutType})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                Target / Progression Note
              </label>
              <input
                type="text"
                value={scheduleModal.coachNotes}
                onChange={(e) =>
                  setScheduleModal({ ...scheduleModal, coachNotes: e.target.value })
                }
                placeholder="e.g. Target 15 rounds @ 2x16kg..."
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setScheduleModal({ ...scheduleModal, open: false })}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                addScheduledItemToDate(
                  scheduleModal.date,
                  scheduleModal.presetUuid,
                  scheduleModal.slotRole,
                  scheduleModal.coachNotes
                );
                setScheduleModal({ ...scheduleModal, open: false });
                triggerNotice('Scheduled workout added to calendar');
              }}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-orange-500 text-white"
            >
              Save to Calendar
            </button>
          </div>
        </div>
      </ModalPortal>

      {/* Modal: Change Program Overlay with Safe Delete (Portaled z-1000) */}
      <ModalPortal
        open={changeProgramModalOpen}
        onClose={() => setChangeProgramModalOpen(false)}
      >
        <div className="w-full max-w-md max-h-[85vh] flex flex-col bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 shadow-2xl text-[var(--text-primary)] overflow-hidden space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display font-bold text-base">Change Program</h3>
              <p className="text-[11px] text-[var(--text-muted)]">
                Switch active training program or delete unused programs.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setChangeProgramModalOpen(false)}
              aria-label="Close Change Program modal"
              className="p-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-0.5 max-h-[55vh]">
            {programs.length === 0 ? (
              <div className="py-8 text-center text-xs text-[var(--text-muted)]">
                No saved training programs yet.
              </div>
            ) : (
              programs.map((prog) => {
                const isActive = selectedProgram?.programUuid === prog.programUuid;
                return (
                  <div
                    key={prog.programUuid}
                    className={`rounded-2xl border p-3 flex items-center gap-2.5 transition-colors ${
                      isActive
                        ? 'bg-orange-500/10 border-orange-500/50'
                        : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200/80 dark:border-slate-700/80 hover:border-orange-500/40'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveProgram(prog.programUuid);
                        setChangeProgramModalOpen(false);
                        triggerNotice(`Switched to "${prog.title}"`);
                      }}
                      className="flex-1 min-w-0 text-left space-y-0.5"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-display font-bold text-sm text-[var(--text-primary)] truncate">
                          {prog.title}
                        </span>
                        {isActive && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-orange-500 text-white shrink-0">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        {prog.cycleLengthWeeks}-week cycle
                      </div>
                    </button>

                    <button
                      type="button"
                      aria-label={`Delete ${prog.title}`}
                      title={`Delete ${prog.title}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteProgramConfirm(prog);
                      }}
                      className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-500/10 transition-colors shrink-0"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={() => {
                setChangeProgramModalOpen(false);
                setNewProgramModal(true);
              }}
              className="px-3.5 py-2 rounded-xl text-xs font-bold bg-orange-500/12 text-orange-600 dark:text-orange-400 hover:bg-orange-500 hover:text-white inline-flex items-center gap-1 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              New Program
            </button>
            <button
              type="button"
              onClick={() => setChangeProgramModalOpen(false)}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800"
            >
              Done
            </button>
          </div>
        </div>
      </ModalPortal>

      {/* Nested Modal: Delete Program Confirmation (Portaled z-1100) */}
      <ModalPortal
        open={Boolean(deleteProgramConfirm)}
        onClose={() => setDeleteProgramConfirm(null)}
        tier="nested"
        backdropClassName="items-center p-4 bg-black/70 backdrop-blur-xs"
      >
        {deleteProgramConfirm && (
          <div className="w-full max-w-sm bg-white dark:bg-slate-900 rounded-3xl border border-rose-500/30 p-5 space-y-4 shadow-2xl text-[var(--text-primary)]">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-2xl bg-rose-500/15 text-rose-500 flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div className="space-y-1 min-w-0">
                <h3 className="font-display font-bold text-base">Delete Program?</h3>
                <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
                  Permanently delete <strong>&ldquo;{deleteProgramConfirm.title}&rdquo;</strong> and
                  remove its uncompleted future scheduled workouts. All completed workout history
                  logs will be preserved.
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDeleteProgramConfirm(null)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = deleteProgramConfirm;
                  deleteProgram(target.programUuid);
                  setDeleteProgramConfirm(null);
                  triggerNotice(`Deleted "${target.title}"`);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white"
              >
                Delete Permanently
              </button>
            </div>
          </div>
        )}
      </ModalPortal>

      {/* Modal: Create New Program (Portaled z-1000) */}
      <ModalPortal open={newProgramModal} onClose={closeNewProgramModal} tier="primary">
        <div className="w-full max-w-md max-h-[88vh] flex flex-col bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 shadow-2xl text-[var(--text-primary)] overflow-y-auto space-y-4">
          <h3 className="font-display font-bold text-base">Create Training Program</h3>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                Program Name
              </label>
              <input
                type="text"
                value={newProgTitle}
                onChange={(e) => setNewProgTitle(e.target.value)}
                placeholder="e.g. Summer Ruck & Kettlebell Block"
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                Cycle Length (Weeks)
              </label>
              <input
                type="number"
                min={1}
                max={12}
                value={newProgWeeks}
                onChange={(e) =>
                  setNewProgWeeks(Math.max(1, parseInt(e.target.value, 10) || 1))
                }
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                Program Workouts
              </label>
              <button
                type="button"
                onClick={() => setNewProgWorkoutPickerOpen(true)}
                className="tactile-btn w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-orange-500 flex items-center justify-between gap-2 text-xs font-bold transition-colors"
              >
                <span className="inline-flex items-center gap-2 min-w-0">
                  <ListChecks className="w-4 h-4 text-orange-500 shrink-0" />
                  <span className="truncate">
                    Select Workouts ({newProgSelectedPresetUuids.length} selected)
                  </span>
                </span>
                <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
              </button>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={closeNewProgramModal}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                if (!newProgTitle.trim()) return;
                const now = new Date().toISOString();
                const progUuid = `prog-${uuidv4()}`;
                upsertProgram({
                  programUuid: progUuid,
                  slug: slugify(newProgTitle, 'prg'),
                  title: newProgTitle.trim(),
                  cycleLengthWeeks: newProgWeeks,
                  scheduleTemplate: [],
                  weekProgressionNotes: {},
                  createdAt: now,
                  updatedAt: now,
                });
                if (newProgSelectedPresetUuids.length > 0) {
                  for (const presetUuid of newProgSelectedPresetUuids) {
                    const preset = presets.find((p) => p.presetUuid === presetUuid);
                    if (preset) {
                      const nextProgramIds = Array.from(
                        new Set([...(preset.programIds || []), progUuid])
                      );
                      upsertPreset({ ...preset, programIds: nextProgramIds });
                    }
                  }
                }
                setActiveProgram(progUuid);
                const linkedCount = newProgSelectedPresetUuids.length;
                const createdTitle = newProgTitle.trim();
                closeNewProgramModal();
                triggerNotice(
                  linkedCount > 0
                    ? `Created "${createdTitle}" with ${linkedCount} workout${
                        linkedCount === 1 ? '' : 's'
                      }`
                    : `Created "${createdTitle}"`
                );
              }}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-orange-500 text-white"
            >
              Create Program
            </button>
          </div>
        </div>
      </ModalPortal>

      {/* Nested Modal: Select Workouts Tick-List (Portaled z-1100) */}
      <ModalPortal
        open={newProgramModal && newProgWorkoutPickerOpen}
        onClose={() => setNewProgWorkoutPickerOpen(false)}
        tier="nested"
        backdropClassName="items-center p-4 bg-black/70 backdrop-blur-xs"
      >
        <div className="w-full max-w-md max-h-[86vh] flex flex-col bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 shadow-2xl text-[var(--text-primary)] overflow-hidden space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h3 className="font-display font-bold text-base">Select Workouts</h3>
              <p className="text-[11px] text-[var(--text-muted)]">
                {newProgSelectedPresetUuids.length} of {presets.length} selected
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  if (newProgSelectedPresetUuids.length === presets.length) {
                    setNewProgSelectedPresetUuids([]);
                  } else {
                    setNewProgSelectedPresetUuids(presets.map((p) => p.presetUuid));
                  }
                }}
                className="px-2.5 py-1.5 rounded-xl text-[11px] font-bold bg-[var(--bg-inset)] border border-[var(--border-card)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                {newProgSelectedPresetUuids.length === presets.length && presets.length > 0
                  ? 'Clear'
                  : 'Select All'}
              </button>
              <button
                type="button"
                onClick={() => setNewProgWorkoutPickerOpen(false)}
                className="px-3 py-1.5 rounded-xl text-xs font-bold bg-orange-500 text-white"
              >
                Done
              </button>
            </div>
          </div>

          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={newProgWorkoutSearch}
              onChange={(e) => setNewProgWorkoutSearch(e.target.value)}
              placeholder="Filter library workouts..."
              className="w-full pl-8 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:border-orange-500"
            />
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5 pr-0.5 max-h-[55vh]">
            {filteredModalPresets.length === 0 ? (
              <div className="py-8 text-center text-xs text-[var(--text-muted)]">
                No matching workouts in library.
              </div>
            ) : (
              filteredModalPresets.map((preset) => {
                const isChecked = newProgSelectedPresetUuids.includes(preset.presetUuid);
                return (
                  <button
                    key={preset.presetUuid}
                    type="button"
                    onClick={() => {
                      setNewProgSelectedPresetUuids((prev) =>
                        prev.includes(preset.presetUuid)
                          ? prev.filter((id) => id !== preset.presetUuid)
                          : [...prev, preset.presetUuid]
                      );
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-2xl border flex items-center gap-2.5 transition-colors ${
                      isChecked
                        ? 'bg-orange-500/10 border-orange-500/50'
                        : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200/80 dark:border-slate-700/80 hover:border-orange-500/40'
                    }`}
                  >
                    <span
                      data-checked={isChecked ? 'true' : 'false'}
                      className={`tactile-check w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ${
                        isChecked
                          ? 'bg-orange-500 border-orange-500 text-white'
                          : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600 text-transparent'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-[var(--text-primary)] truncate">
                        {preset.title}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                        {preset.exercises.length} exercise
                        {preset.exercises.length === 1 ? '' : 's'}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-[var(--bg-inset)] text-[var(--text-secondary)] border border-[var(--border-subtle)] shrink-0">
                      {preset.workoutType}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      </ModalPortal>

      {/* Modal: Rename Active Program (Portaled z-1000) */}
      <ModalPortal
        open={Boolean(renameModal.open && selectedProgram)}
        onClose={() => setRenameModal({ open: false, title: '' })}
      >
        {selectedProgram && (
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-2xl text-[var(--text-primary)]">
            <h3 className="font-display font-bold text-base">Rename Training Program</h3>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                Program Name
              </label>
              <input
                type="text"
                autoFocus
                value={renameModal.title}
                onChange={(e) => setRenameModal({ ...renameModal, title: e.target.value })}
                placeholder="Enter program name..."
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 focus:outline-none focus:border-orange-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenameModal({ open: false, title: '' })}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const trimmed = renameModal.title.trim();
                  if (!trimmed) return;
                  upsertProgram({
                    ...selectedProgram,
                    title: trimmed,
                    slug: slugify(trimmed, 'prg'),
                  });
                  setRenameModal({ open: false, title: '' });
                  triggerNotice(`Renamed program to "${trimmed}"`);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-orange-500 text-white"
              >
                Save Name
              </button>
            </div>
          </div>
        )}
      </ModalPortal>

      {/* Portaled Duplicate & Progress Week Modal (z-1000) */}
      <ModalPortal
        open={duplicateWeekModal.open && Boolean(selectedProgram)}
        onClose={() => setDuplicateWeekModal((prev) => ({ ...prev, open: false }))}
        tier="primary"
      >
        {selectedProgram && (
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-2xl">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-display font-bold text-base flex items-center gap-2">
                  <Copy className="w-4 h-4 text-orange-500" />
                  Duplicate &amp; Progress Week {activeTemplateWeek}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Clone all Primary/Secondary slots and workouts from Week {activeTemplateWeek}.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDuplicateWeekModal((prev) => ({ ...prev, open: false }))}
                aria-label="Close duplicate week modal"
                className="p-1.5 rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Destination Selection */}
            <div className="space-y-2">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Destination Week
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setDuplicateWeekModal((prev) => ({ ...prev, targetMode: 'new' }))
                  }
                  className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${
                    duplicateWeekModal.targetMode === 'new'
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  New Week (Week {selectedProgram.cycleLengthWeeks + 1})
                </button>
                <button
                  type="button"
                  disabled={selectedProgram.cycleLengthWeeks <= 1}
                  onClick={() =>
                    setDuplicateWeekModal((prev) => ({ ...prev, targetMode: 'existing' }))
                  }
                  className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors disabled:opacity-40 ${
                    duplicateWeekModal.targetMode === 'existing'
                      ? 'bg-orange-500 text-white border-orange-500'
                      : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                  }`}
                >
                  Overwrite Existing
                </button>
              </div>

              {duplicateWeekModal.targetMode === 'existing' &&
                selectedProgram.cycleLengthWeeks > 1 && (
                  <select
                    value={duplicateWeekModal.targetWeek}
                    onChange={(e) =>
                      setDuplicateWeekModal((prev) => ({
                        ...prev,
                        targetWeek: Number(e.target.value),
                      }))
                    }
                    className="w-full px-3 py-2 rounded-xl text-xs font-semibold bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  >
                    {Array.from(
                      { length: selectedProgram.cycleLengthWeeks },
                      (_, i) => i + 1
                    )
                      .filter((wk) => wk !== activeTemplateWeek)
                      .map((wk) => (
                        <option key={wk} value={wk}>
                          Overwrite Week {wk}
                        </option>
                      ))}
                  </select>
                )}
            </div>

            {/* Quick Modifier Options */}
            <div className="space-y-2">
              <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Progression Modifier
              </label>
              <div className="space-y-1.5">
                {(
                  [
                    {
                      id: 'exact',
                      label: 'Exact Copy',
                      desc: 'Keep all slot notes and focus cues identical.',
                    },
                    {
                      id: 'build_5',
                      label: '+5% Build Note',
                      desc: 'Prefixes template slot notes with "+5% Build:" for progressive overload.',
                    },
                    {
                      id: 'deload',
                      label: 'Deload Week',
                      desc: 'Prefixes template slot notes with "Deload:" for recovery/volume drop.',
                    },
                  ] as const
                ).map((opt) => {
                  const active = duplicateWeekModal.modifier === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        setDuplicateWeekModal((prev) => ({ ...prev, modifier: opt.id }))
                      }
                      className={`w-full text-left p-2.5 rounded-2xl border transition-all ${
                        active
                          ? 'bg-orange-500/10 border-orange-500 text-slate-900 dark:text-slate-100'
                          : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:border-orange-400'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">{opt.label}</span>
                        <span
                          className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center ${
                            active ? 'border-orange-500 bg-orange-500' : 'border-slate-400'
                          }`}
                        >
                          {active && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        {opt.desc}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setDuplicateWeekModal((prev) => ({ ...prev, open: false }))}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  const destWeek =
                    duplicateWeekModal.targetMode === 'new'
                      ? selectedProgram.cycleLengthWeeks + 1
                      : duplicateWeekModal.targetWeek;
                  const nextCycleLength = Math.max(selectedProgram.cycleLengthWeeks, destWeek);

                  const applyNoteModifier = (rawNote: string | undefined): string => {
                    const cleaned = (rawNote || '')
                      .replace(/^(?:\+5%\s*Build|Deload)\s*[:—-]\s*/i, '')
                      .trim();
                    if (duplicateWeekModal.modifier === 'build_5') {
                      return cleaned ? `+5% Build: ${cleaned}` : '+5% Build';
                    }
                    if (duplicateWeekModal.modifier === 'deload') {
                      return cleaned ? `Deload: ${cleaned}` : 'Deload';
                    }
                    return rawNote || '';
                  };

                  const sourceDays = selectedProgram.scheduleTemplate.filter(
                    (d) => d.weekNumber === activeTemplateWeek
                  );
                  const clonedDays: ProgramDayTemplate[] = sourceDays.map((day) => ({
                    weekNumber: destWeek,
                    dayOfWeek: day.dayOfWeek,
                    items: day.items.map((slot, idx) => ({
                      ...slot,
                      orderIndex: idx,
                      defaultNotes: applyNoteModifier(slot.defaultNotes),
                    })),
                  }));

                  const remainingDays = selectedProgram.scheduleTemplate.filter(
                    (d) => d.weekNumber !== destWeek
                  );
                  const nextTemplate = [...remainingDays, ...clonedDays].sort(
                    (a, b) => a.weekNumber - b.weekNumber || a.dayOfWeek - b.dayOfWeek
                  );

                  const sourceWeekFocus =
                    selectedProgram.weekProgressionNotes?.[String(activeTemplateWeek)] || '';
                  const nextWeekFocus =
                    duplicateWeekModal.modifier === 'build_5'
                      ? applyNoteModifier(sourceWeekFocus)
                      : duplicateWeekModal.modifier === 'deload'
                      ? applyNoteModifier(sourceWeekFocus)
                      : sourceWeekFocus;

                  upsertProgram({
                    ...selectedProgram,
                    cycleLengthWeeks: nextCycleLength,
                    scheduleTemplate: nextTemplate,
                    weekProgressionNotes: {
                      ...(selectedProgram.weekProgressionNotes || {}),
                      ...(nextWeekFocus ? { [String(destWeek)]: nextWeekFocus } : {}),
                    },
                  });

                  setActiveTemplateWeek(destWeek);
                  setDuplicateWeekModal((prev) => ({ ...prev, open: false }));
                  const modLabel =
                    duplicateWeekModal.modifier === 'build_5'
                      ? ' (+5% Build)'
                      : duplicateWeekModal.modifier === 'deload'
                      ? ' (Deload)'
                      : '';
                  triggerNotice(
                    `Duplicated Week ${activeTemplateWeek} → Week ${destWeek}${modLabel}`
                  );
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-orange-500 hover:bg-orange-600 text-white shadow-sm"
              >
                Duplicate Week
              </button>
            </div>
          </div>
        )}
      </ModalPortal>

      <ImportAiNotesPatchModal
        open={aiNotesModalOpen}
        onClose={() => setAiNotesModalOpen(false)}
        onApplied={(summary) => triggerNotice(summary)}
      />

      {/* Portaled Interactive 4-Status Selector (z-1100) */}
      <StatusSelectorModal
        open={Boolean(statusPickerTarget)}
        title={statusPickerTarget?.title || 'Workout'}
        subtitle={
          statusPickerTarget ? formatReadableDate(statusPickerTarget.date) : undefined
        }
        currentStatus={statusPickerTarget?.currentStatus || 'pending'}
        onSelect={(nextStatus) => {
          if (!statusPickerTarget) return;
          void setScheduledItemStatus(
            statusPickerTarget.date,
            statusPickerTarget.scheduleItemUuid,
            nextStatus
          );
          triggerNotice(
            `Marked "${statusPickerTarget.title}" as ${formatScheduleStatusLabel(nextStatus)}`
          );
        }}
        onClose={() => setStatusPickerTarget(null)}
      />

      {/* Portaled Mitigating Factors / Schedule Context Modal (z-1000) */}
      <ContextBlockModal
        open={contextModalState.open}
        editingBlock={contextModalState.editingBlock}
        initialDate={contextModalState.initialDate}
        initialCategory={contextModalState.initialCategory}
        onClose={() => setContextModalState({ open: false })}
        onSaved={(msg) => triggerNotice(msg)}
      />
    </div>
  );
};

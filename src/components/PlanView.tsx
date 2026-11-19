import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  Sparkles,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  Play,
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
} from 'lucide-react';
import { ImportAiNotesPatchModal } from './ImportAiNotesPatchModal';
import { buildAiCoachExportPayload } from '../utils/aiCoachPatch';
import { useWorkoutStore } from '../store/useWorkoutStore';
import { ProgramDayTemplate, WorkoutProgram } from '../types/workout';
import {
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
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, '0');
    const d = String(dt.getDate()).padStart(2, '0');
    cells.push({
      isoDate: `${y}-${m}-${d}`,
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
    meta,
    setActiveDate,
    loadProgrammedForDate,
    setActiveTab,
    setActiveProgram,
    updateDailySchedule,
    addScheduledItemToDate,
    removeScheduledItemFromDate,
    upsertProgram,
    deleteProgram,
    clearFutureScheduledWorkoutsForProgram,
    autoFillSchedule,
  } = useWorkoutStore();

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

  const [activeTemplateWeek, setActiveTemplateWeek] = useState<number>(1);
  const [autoFillStart, setAutoFillStart] = useState<string>(todayIso);
  const [autoFillEnd, setAutoFillEnd] = useState<string>(shiftIsoDate(todayIso, 27));
  const [conflictMode, setConflictMode] = useState<'replace' | 'update_matching' | 'skip'>(
    'update_matching'
  );
  const [bannerNotice, setBannerNotice] = useState<string | null>(null);

  const [newProgramModal, setNewProgramModal] = useState(false);
  const [newProgTitle, setNewProgTitle] = useState('');
  const [newProgWeeks, setNewProgWeeks] = useState(2);

  const [programEditMenuOpen, setProgramEditMenuOpen] = useState(false);
  const programEditMenuRef = useRef<HTMLDivElement>(null);
  const [renameModal, setRenameModal] = useState<{ open: boolean; title: string }>({
    open: false,
    title: '',
  });
  const [aiNotesModalOpen, setAiNotesModalOpen] = useState(false);

  useEffect(() => {
    if (!programEditMenuOpen) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        programEditMenuRef.current &&
        !programEditMenuRef.current.contains(e.target as Node)
      ) {
        setProgramEditMenuOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setProgramEditMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [programEditMenuOpen]);

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
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-4 border border-slate-200/80 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-2xl bg-slate-100 dark:bg-slate-800 p-1 overflow-x-auto max-w-full">
          <button
            type="button"
            onClick={() => setSubTab('upcoming')}
            data-tooltip="Chronological upcoming workout agenda"
            title="Chronological upcoming workout agenda"
            className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all whitespace-nowrap ${
              subTab === 'upcoming'
                ? 'bg-orange-500 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <ListChecks className="w-4 h-4" />
            Upcoming
          </button>
          <button
            type="button"
            onClick={() => setSubTab('calendar')}
            data-tooltip="Monthly training calendar view"
            title="Monthly training calendar view"
            className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all whitespace-nowrap ${
              subTab === 'calendar'
                ? 'bg-orange-500 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Calendar className="w-4 h-4" />
            Calendar
          </button>
          <button
            type="button"
            onClick={() => setSubTab('programming')}
            data-tooltip="Configure rotating weekly templates & auto-fill schedule"
            title="Configure rotating weekly templates & auto-fill schedule"
            className={`px-3.5 py-2 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 transition-all whitespace-nowrap ${
              subTab === 'programming'
                ? 'bg-orange-500 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            <Wand2 className="w-4 h-4" />
            Programming
          </button>
        </div>

        {/* Active Program Selector + New Program */}
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto min-w-0">
          <span className="text-xs font-semibold text-slate-400 shrink-0">Program:</span>
          <select
            value={selectedProgram?.programUuid || ''}
            onChange={(e) => setActiveProgram(e.target.value)}
            title="Select active training program"
            className="flex-1 min-w-0 max-w-full sm:flex-initial sm:max-w-xs px-3 py-1.5 rounded-xl text-xs font-bold bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 truncate"
          >
            {programs.length === 0 ? (
              <option value="" disabled>
                No Programs
              </option>
            ) : (
              programs.map((prog) => (
                <option key={prog.programUuid} value={prog.programUuid}>
                  {prog.title} ({prog.cycleLengthWeeks}w cycle)
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            onClick={() => setNewProgramModal(true)}
            data-tooltip="Create a new multi-week program"
            title="Create a new multi-week program"
            className="px-2.5 py-1.5 rounded-xl bg-orange-500/10 hover:bg-orange-500 text-orange-600 dark:text-orange-400 hover:text-white text-xs font-bold inline-flex items-center gap-1 transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5" />
            New
          </button>
        </div>
      </div>

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

                    <div className="flex items-center gap-1.5">
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
                          loadProgrammedForDate(date);
                          setActiveTab('log');
                        }}
                        className="px-3.5 py-1.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold inline-flex items-center gap-1 shadow-2xs transition-colors"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        Start / Log
                      </button>
                    </div>
                  </div>

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
                        return (
                          <div
                            key={item.scheduleItemUuid}
                            className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 space-y-2"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-orange-500/15 text-orange-600 dark:text-orange-400 shrink-0">
                                  {item.slotRole}
                                </span>
                                <span className="font-display font-bold text-sm text-slate-900 dark:text-slate-100 truncate">
                                  {preset?.title || 'Workout'}
                                </span>
                              </div>

                              <div className="flex items-center gap-1 shrink-0">
                                <span
                                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 capitalize ${
                                    item.status === 'completed'
                                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                      : item.status === 'skipped'
                                      ? 'bg-slate-200 dark:bg-slate-700 text-slate-500'
                                      : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                  }`}
                                >
                                  {item.status === 'completed' ? (
                                    <CheckCircle2 className="w-3 h-3" />
                                  ) : (
                                    <Clock className="w-3 h-3" />
                                  )}
                                  {item.status}
                                </span>

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

                    {/* Mobile: Crisp Indicator Dots | Desktop: Workout Title Chips */}
                    {isMobile ? (
                      <div className="flex items-center justify-center gap-1 pb-0.5">
                        {daySchedItems.map((it) => (
                          <span
                            key={it.scheduleItemUuid}
                            className={`w-1.5 h-1.5 rounded-full ${
                              it.status === 'completed' ? 'bg-emerald-500' : 'bg-orange-500'
                            }`}
                          />
                        ))}
                        {daySchedItems.length === 0 && dayLogs.length > 0 && (
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        )}
                      </div>
                    ) : (
                      <div className="space-y-1 mt-1 overflow-hidden w-full">
                        {daySchedItems.slice(0, 2).map((it) => {
                          const preset = presets.find((p) => p.presetUuid === it.presetUuid);
                          const isDone = it.status === 'completed';
                          return (
                            <div
                              key={it.scheduleItemUuid}
                              className={`px-1.5 py-0.5 rounded-md text-[10px] font-semibold truncate flex items-center gap-1 ${
                                isDone
                                  ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
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

              <div className="flex items-center gap-1.5">
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
                  return (
                    <div
                      key={item.scheduleItemUuid}
                      className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 space-y-2"
                    >
                      {/* Top Badge Row: Slot Role + Status + Actions (Never Overlaps!) */}
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-orange-500/15 text-orange-600 dark:text-orange-400">
                            {item.slotRole}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${
                              item.status === 'completed'
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            {item.status === 'completed' ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : (
                              <Clock className="w-3 h-3" />
                            )}
                            {item.status}
                          </span>
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
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
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

                  {/* Active Program Edit Popover */}
                  <div ref={programEditMenuRef} className="relative shrink-0">
                    <button
                      type="button"
                      onClick={() => setProgramEditMenuOpen((prev) => !prev)}
                      aria-label="Edit Active Program"
                      aria-expanded={programEditMenuOpen}
                      data-tooltip="Rename, duplicate, clear, or delete program"
                      title="Rename, duplicate, clear, or delete program"
                      className={`px-2.5 py-1.5 rounded-xl border transition-colors inline-flex items-center gap-1 text-xs font-semibold ${
                        programEditMenuOpen
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border-slate-200/60 dark:border-slate-700/60 text-slate-700 dark:text-slate-200'
                      }`}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      <span>Edit</span>
                    </button>

                    {programEditMenuOpen && (
                      <>
                        <div
                          className="fixed inset-0 bg-black/30 z-40 sm:hidden"
                          onClick={() => setProgramEditMenuOpen(false)}
                        />
                        <div className="fixed inset-x-3 bottom-4 z-50 sm:absolute sm:inset-x-auto sm:bottom-auto sm:right-0 sm:top-full sm:mt-2 sm:w-60 max-w-[calc(100vw-1.5rem)] rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 shadow-xl p-1.5 space-y-1">
                        <button
                          type="button"
                          onClick={() => {
                            setProgramEditMenuOpen(false);
                            setRenameModal({ open: true, title: selectedProgram.title });
                          }}
                          className="w-full px-3 py-2 rounded-xl text-left text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
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
                          className="w-full px-3 py-2 rounded-xl text-left text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
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
                          className="w-full px-3 py-2 rounded-xl text-left text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
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
                          className="w-full px-3 py-2 rounded-xl text-left text-xs font-semibold text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center gap-2 transition-colors"
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
                          className="w-full px-3 py-2 rounded-xl text-left text-xs font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/10 flex items-center gap-2 transition-colors"
                        >
                          <CalendarX className="w-3.5 h-3.5 shrink-0" />
                          Clear Future Scheduled Workouts
                        </button>

                        <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
                          <button
                            type="button"
                            onClick={() => {
                              setProgramEditMenuOpen(false);
                              const confirmed = window.confirm(
                                `Delete program "${selectedProgram.title}"? This cannot be undone.`
                              );
                              if (!confirmed) return;
                              deleteProgram(selectedProgram.programUuid);
                              triggerNotice(`Deleted "${selectedProgram.title}"`);
                            }}
                            className="w-full px-3 py-2 rounded-xl text-left text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 flex items-center gap-2 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5 shrink-0" />
                            Delete Program
                          </button>
                        </div>
                      </div>
                      </>
                    )}
                  </div>
                </div>

                <div
                  className={`grid gap-3 items-end ${
                    isMobile ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-4'
                  }`}
                >
                  <div className="min-w-0">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      Start Date
                    </label>
                    <input
                      type="date"
                      value={autoFillStart}
                      onChange={(e) => setAutoFillStart(e.target.value)}
                      className="w-full min-w-0 px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
                  <div className="min-w-0">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                      End Date
                    </label>
                    <input
                      type="date"
                      value={autoFillEnd}
                      onChange={(e) => setAutoFillEnd(e.target.value)}
                      className="w-full min-w-0 px-3 py-2 text-xs font-mono rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                    />
                  </div>
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

              {/* Rotating Week Tabs & Day Template Grid */}
              <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200/80 dark:border-slate-800 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Layers className="w-5 h-5 text-orange-500" />
                    <h3 className="font-display font-bold text-base">
                      Weekly Schedule Template ({selectedProgram.cycleLengthWeeks} Weeks)
                    </h3>
                  </div>

                  <div className="flex items-center gap-1.5">
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
                        className="p-3.5 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 space-y-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-display font-bold text-xs sm:text-sm text-slate-900 dark:text-slate-100">
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
                            className="text-xs font-bold text-orange-500 hover:underline flex items-center gap-0.5"
                          >
                            <Plus className="w-3.5 h-3.5" /> Add Workout
                          </button>
                        </div>

                        {dayItems.length === 0 ? (
                          <div className="text-[11px] text-slate-400 italic py-2">
                            Rest Day
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {dayItems.map((slot, slotIdx) => (
                              <div
                                key={slotIdx}
                                className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 space-y-2"
                              >
                                <div className="flex items-center gap-2">
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
                                    className="px-2 py-1 text-[11px] font-bold rounded-lg bg-orange-500/10 text-orange-600 dark:text-orange-400"
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
                                    className="flex-1 px-2 py-1 text-xs font-semibold rounded-lg bg-slate-100 dark:bg-slate-800 truncate"
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
                                    className="p-1 text-slate-400 hover:text-rose-500"
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

      {/* Modal: Add Scheduled Workout Slot to a Date */}
      {scheduleModal.open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-2xl">
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
        </div>
      )}

      {/* Modal: Create New Program */}
      {newProgramModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-2xl">
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
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
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
                  onChange={(e) => setNewProgWeeks(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNewProgramModal(false)}
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
                  setActiveProgram(progUuid);
                  setNewProgTitle('');
                  setNewProgramModal(false);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold bg-orange-500 text-white"
              >
                Create Program
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Rename Active Program */}
      {renameModal.open && selectedProgram && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 space-y-4 shadow-2xl">
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
        </div>
      )}

      <ImportAiNotesPatchModal
        open={aiNotesModalOpen}
        onClose={() => setAiNotesModalOpen(false)}
        onApplied={(summary) => triggerNotice(summary)}
      />
    </div>
  );
};

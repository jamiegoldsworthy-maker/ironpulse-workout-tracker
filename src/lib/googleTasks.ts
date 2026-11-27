import {
  GoogleAuthProvider,
  reauthenticateWithPopup,
  signInWithPopup,
} from 'firebase/auth';
import { initFirebaseServices } from '../services/firebase';
import { DailySchedule, ScheduledItem, WorkoutPreset } from '../types/workout';
import {
  formatMobilityDurationSeconds,
  getTodayIsoDate,
  resolveMobilityDurationSeconds,
  shiftIsoDate,
} from '../utils/calculations';
import { normalizeScheduleStatus } from '../utils/scheduleStatus';

export const GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
export const GOOGLE_TASKS_TARGET_LIST_ID = 'MDUzMDg2ODk5MjYwNjQzOTk5MzY6MDow';
const PREFERRED_LIST_ID = GOOGLE_TASKS_TARGET_LIST_ID;
const TOKEN_STORAGE_KEY = 'ironpulse_google_tasks_token';
const TOKEN_EXPIRY_KEY = 'ironpulse_google_tasks_token_exp';

export interface TasksActionResult {
  status: 'synced' | 'no-token' | 'not-found' | 'out-of-window' | 'error';
  detail?: string;
}

/**
 * Computes the inclusive Google Tasks sync cutoff date (`maxSyncDate`, YYYY-MM-DD in local time):
 * - Monday–Saturday (`dayOfWeek` 1..6): upcoming Sunday (`today + (7 - dayOfWeek)` days)
 * - Sunday (`dayOfWeek === 0`): next Sunday (`today + 7` days) so Sunday planning populates the new week ahead
 */
export function getGoogleTasksMaxSyncDate(todayIso: string = getTodayIsoDate()): string {
  const [y, m, d] = todayIso.split('-').map(Number);
  const localDate = new Date(y, (m || 1) - 1, d || 1);
  const dayOfWeek = localDate.getDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
  return shiftIsoDate(todayIso, daysUntilSunday);
}

/**
 * Returns true if `dateIso` falls within the inclusive `[todayIso, maxSyncDate]` Google Tasks window.
 */
export function isDateWithinGoogleTasksSyncWindow(
  dateIso: string,
  todayIso: string = getTodayIsoDate()
): boolean {
  const maxSyncDate = getGoogleTasksMaxSyncDate(todayIso);
  return dateIso >= todayIso && dateIso <= maxSyncDate;
}

/**
 * Formats an ISO date (`YYYY-MM-DD`) as a compact human horizon label, e.g. `"Sun, Dec 6"`.
 */
export function formatSyncWindowEndDate(dateIso: string): string {
  const [y, m, d] = dateIso.split('-').map(Number);
  const localDate = new Date(y, (m || 1) - 1, d || 1);
  return localDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

let resolvedListIdCache: string | null = null;
let isSyncingTasks = false;

export interface GoogleTaskItem {
  id: string;
  title?: string;
  notes?: string;
  status?: 'needsAction' | 'completed';
  deleted?: boolean;
  hidden?: boolean;
  due?: string;
  updated?: string;
}

function isActiveCompletedTask(task: GoogleTaskItem): boolean {
  return task.status === 'completed' && !task.deleted && !task.hidden;
}

function getTasksErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return fallback;
}

export interface PendingTaskCompletion {
  scheduleItemUuid: string;
  date: string;
  presetUuid: string;
  workoutTitle: string;
  slotRole: string;
}

export interface TaskReschedulePatch {
  scheduleItemUuid: string;
  fromDate: string;
  toDate: string;
}

export function getCachedGoogleTasksToken(): string | null {
  try {
    const token = sessionStorage.getItem(TOKEN_STORAGE_KEY);
    const expRaw = sessionStorage.getItem(TOKEN_EXPIRY_KEY);
    if (!token) return null;
    if (expRaw && Date.now() > Number(expRaw)) {
      sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

export function cacheGoogleTasksToken(token: string, ttlSeconds = 3300): void {
  try {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(Date.now() + ttlSeconds * 1000));
  } catch {
    // Ignore sessionStorage restrictions
  }
}

export function clearCachedGoogleTasksToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
  } catch {
    // Ignore
  }
}

export async function acquireGoogleTasksToken(interactive: boolean): Promise<string | null> {
  const cached = getCachedGoogleTasksToken();
  if (cached) return cached;
  if (!interactive) return null;

  const { auth } = initFirebaseServices();
  if (!auth) {
    throw new Error('Firebase is not initialized.');
  }

  const provider = new GoogleAuthProvider();
  provider.addScope(GOOGLE_TASKS_SCOPE);

  const result = auth.currentUser
    ? await reauthenticateWithPopup(auth.currentUser, provider)
    : await signInWithPopup(auth, provider);

  const credential = GoogleAuthProvider.credentialFromResult(result);
  const token = credential?.accessToken || null;
  if (!token) {
    throw new Error('Google did not return a Tasks OAuth access token.');
  }
  cacheGoogleTasksToken(token);
  return token;
}

async function tasksFetch(url: string, token: string, init?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
  };
  if (init?.body) {
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(url, {
    ...init,
    headers: {
      ...headers,
      ...(init?.headers || {}),
    },
  });
  if (res.status === 401) {
    clearCachedGoogleTasksToken();
  }
  return res;
}

async function resolveTasksListId(token: string): Promise<string> {
  if (resolvedListIdCache) return resolvedListIdCache;
  const checkRes = await tasksFetch(
    `https://tasks.googleapis.com/tasks/v1/users/@me/lists/${encodeURIComponent(PREFERRED_LIST_ID)}`,
    token
  );
  if (checkRes.ok) {
    resolvedListIdCache = PREFERRED_LIST_ID;
    return PREFERRED_LIST_ID;
  }
  if (checkRes.status === 404) {
    resolvedListIdCache = '@default';
    return '@default';
  }
  throw new Error(`Google Tasks list check failed (${checkRes.status})`);
}

async function fetchAllTasksInList(listId: string, token: string): Promise<GoogleTaskItem[]> {
  const url = `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
    listId
  )}/tasks?showCompleted=true&showHidden=true&maxResults=100`;
  const res = await tasksFetch(url, token);
  if (!res.ok) {
    throw new Error(`Failed to fetch Google Tasks (${res.status})`);
  }
  const json = await res.json();
  return Array.isArray(json.items) ? json.items : [];
}

export function extractIronPulseEntryId(notes?: string): string | null {
  if (!notes) return null;
  const match = notes.match(/\[IronPulse:([^\]]+)\]/);
  return match ? match[1].trim() : null;
}

/**
 * Normalizes a Google Task or IronPulse workout title for resilient fallback matching:
 * strips leading emojis/punctuation and trailing slot suffixes like "(Primary)", "(Secondary)", "(Chained)".
 */
export function normalizeTaskWorkoutTitle(raw?: string): string {
  if (!raw) return '';
  return raw
    .replace(/^[^\p{L}\p{N}]+/u, '')
    .replace(/\s*\((?:primary|secondary|chained|core|mobility|finisher|bite-size)\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function titlesMatchResilient(taskTitle: string | undefined, targetWorkoutName: string | undefined): boolean {
  const normTask = normalizeTaskWorkoutTitle(taskTitle);
  const normTarget = normalizeTaskWorkoutTitle(targetWorkoutName);
  if (!normTask || !normTarget) return false;
  return normTask === normTarget || normTask.includes(normTarget) || normTarget.includes(normTask);
}

function buildTaskTitle(item: ScheduledItem, preset?: WorkoutPreset): string {
  const name = preset?.title || 'Workout';
  const slotLabel =
    item.slotRole?.toLowerCase() === 'primary' || item.orderIndex === 0 ? 'Primary' : 'Chained';
  return `💪 ${name} (${slotLabel})`;
}

function buildTaskNotes(item: ScheduledItem, preset?: WorkoutPreset): string {
  const lines: string[] = [];
  if (item.coachNotes?.trim()) {
    lines.push(item.coachNotes.trim());
    lines.push('');
  }
  if (preset && preset.exercises.length > 0) {
    for (const ex of preset.exercises) {
      if (ex.trackingType === 'cardio') {
        lines.push(`• ${ex.exerciseName} (${ex.cardioMode || 'Cardio'})`);
      } else if (ex.trackingType === 'mobility') {
        const mobLabel = formatMobilityDurationSeconds(resolveMobilityDurationSeconds(ex));
        lines.push(`• ${ex.exerciseName}${mobLabel ? ` (${mobLabel})` : ''}`);
      } else {
        const load = ex.defaultWeight > 0 ? ` @ ${ex.defaultWeight}kg` : '';
        lines.push(`• ${ex.exerciseName}: ${ex.defaultSets}×${ex.defaultReps}${load}`);
      }
    }
    lines.push('');
  }
  lines.push(`[IronPulse:${item.scheduleItemUuid}]`);
  return lines.join('\n');
}

export async function checkCompletedTasksInbound(params: {
  todayIso: string;
  schedules: Record<string, DailySchedule>;
  presets: WorkoutPreset[];
  excludedFromTasksIds?: string[];
  hasCompletedLogFor: (date: string, item: ScheduledItem) => boolean;
}): Promise<{
  ok: boolean;
  skipped?: boolean;
  pulledCompleted: PendingTaskCompletion[];
}> {
  if (isSyncingTasks) {
    return { ok: false, skipped: true, pulledCompleted: [] };
  }
  const token = getCachedGoogleTasksToken();
  if (!token) {
    return { ok: false, skipped: true, pulledCompleted: [] };
  }

  const scheduleByEntryId = new Map<string, { date: string; item: ScheduledItem }>();
  for (const [date, daySch] of Object.entries(params.schedules)) {
    for (const item of daySch?.items || []) {
      scheduleByEntryId.set(item.scheduleItemUuid, { date, item });
    }
  }
  if (scheduleByEntryId.size === 0) {
    return { ok: false, skipped: true, pulledCompleted: [] };
  }

  isSyncingTasks = true;
  try {
    const listId = await resolveTasksListId(token);
    const remoteTasks = await fetchAllTasksInList(listId, token);
    const maxSyncDate = getGoogleTasksMaxSyncDate(params.todayIso);
    const excludedSet = new Set(params.excludedFromTasksIds || []);
    const pulledCompleted: PendingTaskCompletion[] = [];

    for (const task of remoteTasks) {
      if (task.deleted || task.hidden) continue;
      const entryId = extractIronPulseEntryId(task.notes);
      if (!entryId || excludedSet.has(entryId)) continue;
      const localEntry = scheduleByEntryId.get(entryId);
      if (!localEntry) continue;

      const taskDueDate = task.due ? task.due.slice(0, 10) : null;
      const isInWindow =
        (localEntry.date >= params.todayIso && localEntry.date <= maxSyncDate) ||
        (taskDueDate !== null && taskDueDate >= params.todayIso && taskDueDate <= maxSyncDate);

      const localStatus = normalizeScheduleStatus(localEntry.item.status);
      if (
        isInWindow &&
        isActiveCompletedTask(task) &&
        localStatus !== 'completed' &&
        localStatus !== 'skipped' &&
        !params.hasCompletedLogFor(taskDueDate || localEntry.date, localEntry.item)
      ) {
        const matchedPreset = params.presets.find(
          (p) => p.presetUuid === localEntry.item.presetUuid
        );
        pulledCompleted.push({
          scheduleItemUuid: entryId,
          date: taskDueDate || localEntry.date,
          presetUuid: localEntry.item.presetUuid,
          workoutTitle: matchedPreset?.title || 'Scheduled Workout',
          slotRole: localEntry.item.slotRole || 'Primary',
        });
      }
    }

    return { ok: true, pulledCompleted };
  } catch {
    return { ok: false, pulledCompleted: [] };
  } finally {
    isSyncingTasks = false;
  }
}

export async function syncGoogleTasksTwoWay(params: {
  interactive: boolean;
  todayIso: string;
  schedules: Record<string, DailySchedule>;
  presets: WorkoutPreset[];
  excludedFromTasksIds?: string[];
  dismissedTaskCompletionIds?: string[];
  hasCompletedLogFor: (date: string, item: ScheduledItem) => boolean;
}): Promise<{
  ok: boolean;
  skipped?: boolean;
  pulledCompleted: PendingTaskCompletion[];
  pulledReschedules: TaskReschedulePatch[];
  pushedCount: number;
  deletedStaleCount: number;
  error?: string;
}> {
  if (isSyncingTasks) {
    return {
      ok: false,
      skipped: true,
      pulledCompleted: [],
      pulledReschedules: [],
      pushedCount: 0,
      deletedStaleCount: 0,
    };
  }
  isSyncingTasks = true;
  try {
    const token = await acquireGoogleTasksToken(params.interactive);
    if (!token) {
      return {
        ok: false,
        skipped: true,
        pulledCompleted: [],
        pulledReschedules: [],
        pushedCount: 0,
        deletedStaleCount: 0,
      };
    }

    const listId = await resolveTasksListId(token);
    const remoteTasks = await fetchAllTasksInList(listId, token);

    const maxSyncDate = getGoogleTasksMaxSyncDate(params.todayIso);
    const scheduleByEntryId = new Map<string, { date: string; item: ScheduledItem }>();
    const completedDateTitles = new Map<string, string[]>();
    for (const [date, daySch] of Object.entries(params.schedules)) {
      for (const item of daySch?.items || []) {
        scheduleByEntryId.set(item.scheduleItemUuid, { date, item });
        const st = normalizeScheduleStatus(item.status);
        if (st === 'completed' || params.hasCompletedLogFor(date, item)) {
          const preset = params.presets.find((p) => p.presetUuid === item.presetUuid);
          const normTitle = normalizeTaskWorkoutTitle(preset?.title);
          if (normTitle) {
            const list = completedDateTitles.get(date) || [];
            if (!list.includes(normTitle)) list.push(normTitle);
            completedDateTitles.set(date, list);
          }
        }
      }
    }

    const taskByEntryId = new Map<string, GoogleTaskItem>();
    const openTaskByDateTitle = new Map<string, GoogleTaskItem>();
    const pulledCompleted: PendingTaskCompletion[] = [];
    const pulledReschedules: TaskReschedulePatch[] = [];
    let deletedStaleCount = 0;

    const excludedSet = new Set(params.excludedFromTasksIds || []);
    const dismissedSet = new Set(params.dismissedTaskCompletionIds || []);
    const hasHydratedSchedules = scheduleByEntryId.size > 0;

    // 1. Inbound & Completion Sweep across all visible tasks
    for (const task of remoteTasks) {
      if (task.deleted || task.hidden) continue;
      const entryId = extractIronPulseEntryId(task.notes);
      const taskDueDate = task.due ? task.due.slice(0, 10) : null;

      // Sweep any open (needsAction) task whose date + normalized workout title matches a completed local schedule entry,
      // even if its scheduleId changed after a reset/swap or tag was stripped.
      if (task.status !== 'completed' && taskDueDate) {
        const completedTitlesForDate = completedDateTitles.get(taskDueDate) || [];
        const matchesCompletedByTitle = completedTitlesForDate.some((ct) =>
          titlesMatchResilient(task.title, ct)
        );
        if (matchesCompletedByTitle) {
          await tasksFetch(
            `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
              listId
            )}/tasks/${encodeURIComponent(task.id)}`,
            token,
            {
              method: 'PATCH',
              body: JSON.stringify({ status: 'completed' }),
            }
          );
          continue;
        }
      }

      if (!entryId) continue;

      const localEntry = scheduleByEntryId.get(entryId);
      const localStatus = localEntry ? normalizeScheduleStatus(localEntry.item.status) : null;

      if (localEntry && !excludedSet.has(entryId) && localStatus !== 'skipped') {
        const isInWindow =
          (localEntry.date >= params.todayIso && localEntry.date <= maxSyncDate) ||
          (taskDueDate !== null && taskDueDate >= params.todayIso && taskDueDate <= maxSyncDate);

        if (isInWindow) {
          if (
            taskDueDate &&
            taskDueDate !== localEntry.date &&
            localStatus !== 'completed'
          ) {
            pulledReschedules.push({
              scheduleItemUuid: entryId,
              fromDate: localEntry.date,
              toDate: taskDueDate,
            });
          }

          if (
            isActiveCompletedTask(task) &&
            !dismissedSet.has(entryId) &&
            localStatus !== 'completed' &&
            !params.hasCompletedLogFor(taskDueDate || localEntry.date, localEntry.item)
          ) {
            const matchedPreset = params.presets.find(
              (p) => p.presetUuid === localEntry.item.presetUuid
            );
            pulledCompleted.push({
              scheduleItemUuid: entryId,
              date: taskDueDate || localEntry.date,
              presetUuid: localEntry.item.presetUuid,
              workoutTitle: matchedPreset?.title || 'Scheduled Workout',
              slotRole: localEntry.item.slotRole || 'Primary',
            });
          }
        }
      }

      // 2. Deterministic status alignment on Master Sync:
      // - Skipped / excluded / past-due tasks -> DELETE
      // - Completed locally while still needsAction in Google Tasks -> PATCH to 'completed'
      // - Open (needsAction) [IronPulse:...] tasks due after maxSyncDate -> DELETE (prune out-of-window future weeks)
      const isExcluded = excludedSet.has(entryId);
      const isSkippedLocally = localStatus === 'skipped';
      const isPastDue = taskDueDate !== null && taskDueDate < params.todayIso;
      const isBeyondSyncWindowOpen =
        task.status !== 'completed' && taskDueDate !== null && taskDueDate > maxSyncDate;
      const isCompletedLocally =
        localEntry !== undefined &&
        (localStatus === 'completed' ||
          params.hasCompletedLogFor(localEntry.date, localEntry.item));

      if (hasHydratedSchedules && (isExcluded || isSkippedLocally || isPastDue)) {
        const delRes = await tasksFetch(
          `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
            listId
          )}/tasks/${encodeURIComponent(task.id)}`,
          token,
          { method: 'DELETE' }
        );
        if (delRes.ok) {
          deletedStaleCount += 1;
        }
        continue;
      }

      if (isCompletedLocally && task.status !== 'completed') {
        await tasksFetch(
          `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
            listId
          )}/tasks/${encodeURIComponent(task.id)}`,
          token,
          {
            method: 'PATCH',
            body: JSON.stringify({ status: 'completed' }),
          }
        );
        continue;
      }

      if (isBeyondSyncWindowOpen) {
        const delRes = await tasksFetch(
          `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
            listId
          )}/tasks/${encodeURIComponent(task.id)}`,
          token,
          { method: 'DELETE' }
        );
        if (delRes.ok) {
          deletedStaleCount += 1;
        }
        continue;
      }

      // Only index active needsAction tasks so completed/archived tasks don't block pushing fresh tasks
      if (task.status !== 'completed') {
        taskByEntryId.set(entryId, task);
        const normTaskTitle = normalizeTaskWorkoutTitle(task.title);
        if (taskDueDate && normTaskTitle) {
          openTaskByDateTitle.set(`${taskDueDate}::${normTaskTitle}`, task);
        }
      }
    }

    // 3. Outbound: Push/update all Pending & In Progress schedule entries within [todayIso, maxSyncDate]
    let pushedCount = 0;

    const targetDates = Object.keys(params.schedules)
      .filter((d) => d >= params.todayIso && d <= maxSyncDate)
      .sort();

    for (const date of targetDates) {
      const daySch = params.schedules[date];
      for (const item of daySch?.items || []) {
        const itemStatus = normalizeScheduleStatus(item.status);
        if (itemStatus !== 'pending' && itemStatus !== 'in_progress') continue;
        if (excludedSet.has(item.scheduleItemUuid)) continue;
        const preset = params.presets.find((p) => p.presetUuid === item.presetUuid);
        const normPresetTitle = normalizeTaskWorkoutTitle(preset?.title);
        const existingTask =
          taskByEntryId.get(item.scheduleItemUuid) ||
          (normPresetTitle ? openTaskByDateTitle.get(`${date}::${normPresetTitle}`) : undefined);
        const payload = {
          title: buildTaskTitle(item, preset),
          due: `${date}T00:00:00.000Z`,
          notes: buildTaskNotes(item, preset),
          status: 'needsAction' as const,
        };

        if (existingTask) {
          const patchRes = await tasksFetch(
            `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
              listId
            )}/tasks/${encodeURIComponent(existingTask.id)}`,
            token,
            { method: 'PATCH', body: JSON.stringify(payload) }
          );
          if (patchRes.ok) pushedCount += 1;
        } else {
          const postRes = await tasksFetch(
            `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`,
            token,
            { method: 'POST', body: JSON.stringify(payload) }
          );
          if (postRes.ok) pushedCount += 1;
        }
      }
    }

    return {
      ok: true,
      pulledCompleted,
      pulledReschedules,
      pushedCount,
      deletedStaleCount,
    };
  } catch (err: unknown) {
    return {
      ok: false,
      pulledCompleted: [],
      pulledReschedules: [],
      pushedCount: 0,
      deletedStaleCount: 0,
      error: getTasksErrorMessage(err, 'Google Tasks sync failed'),
    };
  } finally {
    isSyncingTasks = false;
  }
}

export interface TaskLookupInput {
  scheduleId?: string;
  date?: string;
  workoutName?: string;
}

function findMatchingTasks(
  tasks: GoogleTaskItem[],
  lookup: TaskLookupInput,
  options?: { openOnly?: boolean }
): GoogleTaskItem[] {
  const candidates = tasks.filter(
    (t) => !t.deleted && !t.hidden && (!options?.openOnly || t.status !== 'completed')
  );
  const matched = new Map<string, GoogleTaskItem>();

  // 1. Primary match: exact [IronPulse:${scheduleId}] tag in task notes
  if (lookup.scheduleId) {
    for (const t of candidates) {
      if (extractIronPulseEntryId(t.notes) === lookup.scheduleId) {
        matched.set(t.id, t);
      }
    }
  }

  // 2. Resilient fallback: due date (YYYY-MM-DD) + normalized workout title (ignoring slot suffixes)
  if (lookup.date && lookup.workoutName) {
    for (const t of candidates) {
      const dueDate = t.due ? t.due.slice(0, 10) : '';
      if (dueDate === lookup.date && titlesMatchResilient(t.title, lookup.workoutName)) {
        matched.set(t.id, t);
      }
    }
  }

  return Array.from(matched.values());
}

function findMatchingTask(
  tasks: GoogleTaskItem[],
  lookup: TaskLookupInput
): GoogleTaskItem | undefined {
  const openMatches = findMatchingTasks(tasks, lookup, { openOnly: true });
  if (openMatches.length > 0) return openMatches[0];
  const anyMatches = findMatchingTasks(tasks, lookup);
  return anyMatches[0];
}

export async function completeGoogleTaskForWorkout(
  scheduleIdOrLookup: string | TaskLookupInput
): Promise<TasksActionResult> {
  const lookup: TaskLookupInput =
    typeof scheduleIdOrLookup === 'string'
      ? { scheduleId: scheduleIdOrLookup }
      : scheduleIdOrLookup;
  try {
    const token = getCachedGoogleTasksToken();
    if (!token) return { status: 'no-token' };
    if (!lookup.scheduleId && !(lookup.date && lookup.workoutName)) {
      return { status: 'not-found' };
    }
    const listId = await resolveTasksListId(token);
    const tasks = await fetchAllTasksInList(listId, token);
    const openMatches = findMatchingTasks(tasks, lookup, { openOnly: true });

    if (openMatches.length === 0) {
      const anyMatches = findMatchingTasks(tasks, lookup);
      if (anyMatches.some((t) => t.status === 'completed')) {
        return { status: 'synced' };
      }
      return { status: 'not-found' };
    }

    let anySuccess = false;
    let lastErrorStatus = 0;
    for (const task of openMatches) {
      const res = await tasksFetch(
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
          listId
        )}/tasks/${encodeURIComponent(task.id)}`,
        token,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: 'completed' }),
        }
      );
      if (res.ok) {
        anySuccess = true;
      } else {
        lastErrorStatus = res.status;
      }
    }
    return anySuccess
      ? { status: 'synced' }
      : { status: 'error', detail: `HTTP ${lastErrorStatus}` };
  } catch (err: unknown) {
    return { status: 'error', detail: getTasksErrorMessage(err, 'Network error') };
  }
}

export const completeGoogleTaskForSchedule = completeGoogleTaskForWorkout;

export async function deleteGoogleTaskForSchedule(
  scheduleIdOrLookup: string | TaskLookupInput
): Promise<TasksActionResult> {
  const lookup: TaskLookupInput =
    typeof scheduleIdOrLookup === 'string'
      ? { scheduleId: scheduleIdOrLookup }
      : scheduleIdOrLookup;
  try {
    const token = getCachedGoogleTasksToken();
    if (!token) return { status: 'no-token' };
    if (!lookup.scheduleId && !(lookup.date && lookup.workoutName)) {
      return { status: 'not-found' };
    }
    const listId = await resolveTasksListId(token);
    const tasks = await fetchAllTasksInList(listId, token);
    const match = findMatchingTask(tasks, lookup);
    if (!match) return { status: 'not-found' };

    const res = await tasksFetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
        listId
      )}/tasks/${encodeURIComponent(match.id)}`,
      token,
      { method: 'DELETE' }
    );
    return res.ok
      ? { status: 'synced' }
      : { status: 'error', detail: `HTTP ${res.status}` };
  } catch (err: unknown) {
    return { status: 'error', detail: getTasksErrorMessage(err, 'Network error') };
  }
}

export async function upsertGoogleTaskForSchedule(params: {
  date: string;
  item: ScheduledItem;
  preset?: WorkoutPreset;
  todayIso?: string;
}): Promise<TasksActionResult> {
  try {
    const todayIso = params.todayIso || getTodayIsoDate();
    if (!isDateWithinGoogleTasksSyncWindow(params.date, todayIso)) {
      return { status: 'out-of-window' };
    }
    const token = getCachedGoogleTasksToken();
    if (!token) return { status: 'no-token' };
    const listId = await resolveTasksListId(token);
    const tasks = await fetchAllTasksInList(listId, token);
    const existingActive = tasks.find(
      (t) =>
        !t.deleted &&
        !t.hidden &&
        t.status !== 'completed' &&
        extractIronPulseEntryId(t.notes) === params.item.scheduleItemUuid
    );

    const payload = {
      title: buildTaskTitle(params.item, params.preset),
      due: `${params.date}T00:00:00.000Z`,
      notes: buildTaskNotes(params.item, params.preset),
      status: 'needsAction' as const,
    };

    const res = existingActive
      ? await tasksFetch(
          `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
            listId
          )}/tasks/${encodeURIComponent(existingActive.id)}`,
          token,
          { method: 'PATCH', body: JSON.stringify(payload) }
        )
      : await tasksFetch(
          `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`,
          token,
          { method: 'POST', body: JSON.stringify(payload) }
        );

    return res.ok
      ? { status: 'synced' }
      : { status: 'error', detail: `HTTP ${res.status}` };
  } catch (err: unknown) {
    return { status: 'error', detail: getTasksErrorMessage(err, 'Network error') };
  }
}

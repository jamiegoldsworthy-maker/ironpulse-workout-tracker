import {
  GoogleAuthProvider,
  reauthenticateWithPopup,
  signInWithPopup,
} from 'firebase/auth';
import { initFirebaseServices } from '../services/firebase';
import { DailySchedule, ScheduledItem, WorkoutPreset } from '../types/workout';
import { shiftIsoDate } from '../utils/calculations';

export const GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
export const GOOGLE_TASKS_TARGET_LIST_ID = 'MDUzMDg2ODk5MjYwNjQzOTk5MzY6MDow';
const PREFERRED_LIST_ID = GOOGLE_TASKS_TARGET_LIST_ID;
const TOKEN_STORAGE_KEY = 'ironpulse_google_tasks_token';
const TOKEN_EXPIRY_KEY = 'ironpulse_google_tasks_token_exp';

export interface TasksActionResult {
  status: 'synced' | 'no-token' | 'not-found' | 'error';
  detail?: string;
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
        lines.push(
          `• ${ex.exerciseName}${ex.defaultDurationMin ? ` (${ex.defaultDurationMin}m)` : ''}`
        );
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
    const endDate = shiftIsoDate(params.todayIso, 6);
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
        (localEntry.date >= params.todayIso && localEntry.date <= endDate) ||
        (taskDueDate !== null && taskDueDate >= params.todayIso && taskDueDate <= endDate);

      if (
        isInWindow &&
        isActiveCompletedTask(task) &&
        localEntry.item.status !== 'completed' &&
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

    const endDate = shiftIsoDate(params.todayIso, 6);
    const scheduleByEntryId = new Map<string, { date: string; item: ScheduledItem }>();
    for (const [date, daySch] of Object.entries(params.schedules)) {
      for (const item of daySch?.items || []) {
        scheduleByEntryId.set(item.scheduleItemUuid, { date, item });
      }
    }

    const taskByEntryId = new Map<string, GoogleTaskItem>();
    const pulledCompleted: PendingTaskCompletion[] = [];
    const pulledReschedules: TaskReschedulePatch[] = [];
    let deletedStaleCount = 0;

    const excludedSet = new Set(params.excludedFromTasksIds || []);
    const dismissedSet = new Set(params.dismissedTaskCompletionIds || []);
    const hasHydratedSchedules = scheduleByEntryId.size > 0;

    // 1. Inbound: Check tasks in today..today+6 window for completions & reschedules
    for (const task of remoteTasks) {
      if (task.deleted || task.hidden) continue;
      const entryId = extractIronPulseEntryId(task.notes);
      if (!entryId) continue;

      const localEntry = scheduleByEntryId.get(entryId);
      const taskDueDate = task.due ? task.due.slice(0, 10) : null;

      if (localEntry && !excludedSet.has(entryId)) {
        const isInWindow =
          (localEntry.date >= params.todayIso && localEntry.date <= endDate) ||
          (taskDueDate !== null && taskDueDate >= params.todayIso && taskDueDate <= endDate);

        if (isInWindow) {
          if (taskDueDate && taskDueDate !== localEntry.date) {
            pulledReschedules.push({
              scheduleItemUuid: entryId,
              fromDate: localEntry.date,
              toDate: taskDueDate,
            });
          }

          if (
            isActiveCompletedTask(task) &&
            !dismissedSet.has(entryId) &&
            localEntry.item.status !== 'completed' &&
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

      // 2. Sweep ONLY past-due tasks (due < today) or explicitly excluded tasks (never delete unhydrated/unknown tasks)
      const isExcluded = excludedSet.has(entryId);
      const isPastDue = taskDueDate !== null && taskDueDate < params.todayIso;

      if (hasHydratedSchedules && (isExcluded || isPastDue)) {
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
      }
    }

    // 3. Outbound: Push/update all incomplete schedule entries from today through today + 6 days
    let pushedCount = 0;

    const targetDates = Object.keys(params.schedules)
      .filter((d) => d >= params.todayIso && d <= endDate)
      .sort();

    for (const date of targetDates) {
      const daySch = params.schedules[date];
      for (const item of daySch?.items || []) {
        if (item.status !== 'pending') continue;
        if (excludedSet.has(item.scheduleItemUuid)) continue;
        const existingTask = taskByEntryId.get(item.scheduleItemUuid);

        const preset = params.presets.find((p) => p.presetUuid === item.presetUuid);
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
  } catch (err: any) {
    return {
      ok: false,
      pulledCompleted: [],
      pulledReschedules: [],
      pushedCount: 0,
      deletedStaleCount: 0,
      error: err?.message || 'Google Tasks sync failed',
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

function findMatchingTask(
  tasks: GoogleTaskItem[],
  lookup: TaskLookupInput
): GoogleTaskItem | undefined {
  if (lookup.scheduleId) {
    const byTag = tasks.find(
      (t) => !t.deleted && extractIronPulseEntryId(t.notes) === lookup.scheduleId
    );
    if (byTag) return byTag;
  }
  if (lookup.date && lookup.workoutName) {
    const needle = lookup.workoutName.trim().toLowerCase();
    return tasks.find((t) => {
      if (t.deleted) return false;
      const dueDate = t.due ? t.due.slice(0, 10) : '';
      return dueDate === lookup.date && (t.title || '').toLowerCase().includes(needle);
    });
  }
  return undefined;
}

export async function completeGoogleTaskForSchedule(
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
    if (match.status === 'completed') return { status: 'synced' };

    const res = await tasksFetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
        listId
      )}/tasks/${encodeURIComponent(match.id)}`,
      token,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
      }
    );
    return res.ok
      ? { status: 'synced' }
      : { status: 'error', detail: `HTTP ${res.status}` };
  } catch (err: any) {
    return { status: 'error', detail: err?.message || 'Network error' };
  }
}

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
  } catch (err: any) {
    return { status: 'error', detail: err?.message || 'Network error' };
  }
}

export const markGoogleTaskCompletedSilently = completeGoogleTaskForSchedule;

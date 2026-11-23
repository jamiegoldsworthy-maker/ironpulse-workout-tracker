import {
  GoogleAuthProvider,
  reauthenticateWithPopup,
  signInWithPopup,
} from 'firebase/auth';
import { initFirebaseServices } from '../services/firebase';
import { DailySchedule, ScheduledItem, WorkoutPreset } from '../types/workout';
import { shiftIsoDate } from '../utils/calculations';

export const GOOGLE_TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks';
const PREFERRED_LIST_ID = 'MDUzMDg2ODk5MjYwNjQzOTk5MzY6MDow';
const TOKEN_STORAGE_KEY = 'ironpulse_google_tasks_token';
const TOKEN_EXPIRY_KEY = 'ironpulse_google_tasks_token_exp';

let resolvedListIdCache: string | null = null;

export interface GoogleTaskItem {
  id: string;
  title?: string;
  notes?: string;
  status?: 'needsAction' | 'completed';
  due?: string;
  updated?: string;
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
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
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
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(PREFERRED_LIST_ID)}`,
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

export async function syncGoogleTasksTwoWay(params: {
  interactive: boolean;
  todayIso: string;
  schedules: Record<string, DailySchedule>;
  presets: WorkoutPreset[];
  hasCompletedLogFor: (date: string, item: ScheduledItem) => boolean;
}): Promise<{
  ok: boolean;
  skipped?: boolean;
  pulledCompleted: PendingTaskCompletion[];
  pulledReschedules: TaskReschedulePatch[];
  pushedCount: number;
  error?: string;
}> {
  try {
    const token = await acquireGoogleTasksToken(params.interactive);
    if (!token) {
      return {
        ok: false,
        skipped: true,
        pulledCompleted: [],
        pulledReschedules: [],
        pushedCount: 0,
      };
    }

    const listId = await resolveTasksListId(token);
    const remoteTasks = await fetchAllTasksInList(listId, token);

    const taskByEntryId = new Map<string, GoogleTaskItem>();
    for (const task of remoteTasks) {
      const entryId = extractIronPulseEntryId(task.notes);
      if (entryId) {
        taskByEntryId.set(entryId, task);
      }
    }

    const pulledCompleted: PendingTaskCompletion[] = [];
    const pulledReschedules: TaskReschedulePatch[] = [];

    // 1. Inbound: Check all local schedule items against remote Google Tasks
    for (const [date, daySch] of Object.entries(params.schedules)) {
      for (const item of daySch.items || []) {
        const task = taskByEntryId.get(item.scheduleItemUuid);
        if (!task) continue;

        const taskDueDate = task.due ? task.due.slice(0, 10) : null;
        if (taskDueDate && taskDueDate !== date) {
          pulledReschedules.push({
            scheduleItemUuid: item.scheduleItemUuid,
            fromDate: date,
            toDate: taskDueDate,
          });
        }

        if (
          task.status === 'completed' &&
          item.status !== 'completed' &&
          !params.hasCompletedLogFor(taskDueDate || date, item)
        ) {
          const matchedPreset = params.presets.find((p) => p.presetUuid === item.presetUuid);
          pulledCompleted.push({
            scheduleItemUuid: item.scheduleItemUuid,
            date: taskDueDate || date,
            presetUuid: item.presetUuid,
            workoutTitle: matchedPreset?.title || 'Scheduled Workout',
            slotRole: item.slotRole || 'Primary',
          });
        }
      }
    }

    // 2. Outbound: Push incomplete schedule entries from today through today + 6 days
    const endDate = shiftIsoDate(params.todayIso, 6);
    let pushedCount = 0;

    const targetDates = Object.keys(params.schedules)
      .filter((d) => d >= params.todayIso && d <= endDate)
      .sort();

    for (const date of targetDates) {
      const daySch = params.schedules[date];
      for (const item of daySch?.items || []) {
        if (item.status !== 'pending') continue;
        // If Google Tasks already marked it completed inbound, don't overwrite it back to needsAction
        const existingTask = taskByEntryId.get(item.scheduleItemUuid);
        if (existingTask?.status === 'completed') continue;

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
    };
  } catch (err: any) {
    return {
      ok: false,
      pulledCompleted: [],
      pulledReschedules: [],
      pushedCount: 0,
      error: err?.message || 'Google Tasks sync failed',
    };
  }
}

export async function markGoogleTaskCompletedSilently(scheduleItemUuid: string): Promise<void> {
  try {
    const token = getCachedGoogleTasksToken();
    if (!token || !scheduleItemUuid) return;
    const listId = await resolveTasksListId(token);
    const tasks = await fetchAllTasksInList(listId, token);
    const match = tasks.find((t) => extractIronPulseEntryId(t.notes) === scheduleItemUuid);
    if (!match || match.status === 'completed') return;

    await tasksFetch(
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
        listId
      )}/tasks/${encodeURIComponent(match.id)}`,
      token,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
      }
    );
  } catch {
    // Swallow network/auth errors so offline workout completion never fails
  }
}

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
const PENDING_TASK_OPS_STORAGE_KEY = 'wt_gtasks_pending_ops';
const LEGACY_PENDING_TASK_OPS_KEY = 'ironpulse_google_tasks_pending_ops';
const GOOGLE_CLIENT_ID_STORAGE_KEY = 'wt_google_client_id';
const TOKEN_EXPIRY_BUFFER_MS = 2 * 60 * 1000; // Refresh if within 2 minutes of expiry
const RETRY_BACKOFF_MS = [500, 1500, 3000] as const;

export type GoogleSyncStatus =
  | 'idle'
  | 'syncing'
  | 'synced'
  | 'needs_reauth'
  | 'offline'
  | 'error';

export interface GoogleTasksRuntimeState {
  googleSyncStatus: GoogleSyncStatus;
  googleTokenExpiresAt: number | null;
  pendingOpsCount: number;
}

export interface TasksActionResult {
  status: 'synced' | 'no-token' | 'not-found' | 'out-of-window' | 'error';
  detail?: string;
}

export type SingleTaskSyncAction = 'complete' | 'modified' | 'skip' | 'pending' | 'delete';
export type CoalescedTaskOpType = 'upsert' | 'complete' | 'delete';

export interface SingleScheduleTaskInput {
  scheduleItemUuid?: string;
  scheduleId?: string;
  date: string;
  workoutName?: string;
  item?: ScheduledItem;
  preset?: WorkoutPreset;
}

export interface PersistedTaskOp {
  scheduleId: string;
  op: CoalescedTaskOpType;
  payload?: {
    date: string;
    workoutName?: string;
    item?: ScheduledItem;
    preset?: WorkoutPreset;
  };
  updatedAt: string;
}

export type QueuedTaskSyncOp = PersistedTaskOp;

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

export interface TaskLookupInput {
  scheduleId?: string;
  date?: string;
  workoutName?: string;
}

interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
}

interface GisTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

interface GisWindow {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient: (config: {
          client_id: string;
          scope: string;
          callback: (resp: GisTokenResponse) => void;
          error_callback?: (err: { type?: string; message?: string }) => void;
        }) => GisTokenClient;
      };
    };
  };
}

let resolvedListIdCache: string | null = null;
let googleTasksMutexTail: Promise<void> = Promise.resolve();
let memoryToken: string | null = null;
let googleTokenExpiresAt: number | null = null;
let currentGoogleSyncStatus: GoogleSyncStatus = 'idle';
let silentRefreshInFlight: Promise<string | null> | null = null;
const runtimeListeners = new Set<(state: GoogleTasksRuntimeState) => void>();

/**
 * Serialized single-flight async mutex so Master Sync runs and rapid back-to-back single-workout
 * clicks execute strictly sequentially and never race or create duplicate Google Tasks.
 */
function enqueueGoogleTasksMutex<T>(task: () => Promise<T>): Promise<T> {
  const run = googleTasksMutexTail.then(task, task);
  googleTasksMutexTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isOfflineNow(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function readTokenFromStorage(): { token: string | null; expiresAt: number | null } {
  if (memoryToken && googleTokenExpiresAt) {
    return { token: memoryToken, expiresAt: googleTokenExpiresAt };
  }
  if (typeof window === 'undefined') {
    return { token: memoryToken, expiresAt: googleTokenExpiresAt };
  }
  try {
    const token = window.sessionStorage.getItem(TOKEN_STORAGE_KEY);
    const expRaw = window.sessionStorage.getItem(TOKEN_EXPIRY_KEY);
    const parsedExp = expRaw ? Number(expRaw) : null;
    if (token && parsedExp && Number.isFinite(parsedExp)) {
      memoryToken = token;
      googleTokenExpiresAt = parsedExp;
      return { token, expiresAt: parsedExp };
    }
    return { token: token || null, expiresAt: parsedExp && Number.isFinite(parsedExp) ? parsedExp : null };
  } catch {
    return { token: memoryToken, expiresAt: googleTokenExpiresAt };
  }
}

export function getGoogleTokenExpiresAt(): number | null {
  return readTokenFromStorage().expiresAt;
}

export function getGoogleTasksRuntimeState(): GoogleTasksRuntimeState {
  return {
    googleSyncStatus: currentGoogleSyncStatus,
    googleTokenExpiresAt: getGoogleTokenExpiresAt(),
    pendingOpsCount: getPendingSingleTaskOpsCount(),
  };
}

function emitGoogleTasksRuntimeState(): void {
  const snapshot = getGoogleTasksRuntimeState();
  runtimeListeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // Ignore subscriber errors
    }
  });
}

export function subscribeGoogleTasksState(
  listener: (state: GoogleTasksRuntimeState) => void
): () => void {
  runtimeListeners.add(listener);
  listener(getGoogleTasksRuntimeState());
  return () => {
    runtimeListeners.delete(listener);
  };
}

export function setGoogleSyncStatus(next: GoogleSyncStatus): void {
  if (currentGoogleSyncStatus === next) return;
  currentGoogleSyncStatus = next;
  emitGoogleTasksRuntimeState();
}

function mapActionToCoalescedOp(action: SingleTaskSyncAction): CoalescedTaskOpType {
  if (action === 'delete') return 'delete';
  if (action === 'pending') return 'upsert';
  return 'complete';
}

function buildQueueScheduleId(input: {
  scheduleId?: string;
  date: string;
  workoutName?: string;
}): string {
  if (input.scheduleId) return input.scheduleId;
  return `dt::${input.date}::${normalizeTaskWorkoutTitle(input.workoutName) || 'workout'}`;
}

export function loadQueuedSingleTaskOps(): PersistedTaskOp[] {
  if (typeof window === 'undefined') return [];
  try {
    let raw = window.localStorage.getItem(PENDING_TASK_OPS_STORAGE_KEY);
    // Migrate legacy queue key if present
    const legacyRaw = window.localStorage.getItem(LEGACY_PENDING_TASK_OPS_KEY);
    if (legacyRaw) {
      try {
        const legacyArr = JSON.parse(legacyRaw);
        const currentArr = raw ? JSON.parse(raw) : [];
        const merged: PersistedTaskOp[] = Array.isArray(currentArr) ? [...currentArr] : [];
        if (Array.isArray(legacyArr)) {
          for (const item of legacyArr) {
            if (!item || typeof item !== 'object') continue;
            const op: CoalescedTaskOpType =
              item.op === 'upsert' || item.op === 'complete' || item.op === 'delete'
                ? item.op
                : mapActionToCoalescedOp(item.action || 'pending');
            const date = item.payload?.date || item.date || getTodayIsoDate();
            const workoutName = item.payload?.workoutName || item.workoutName;
            const scheduleId = buildQueueScheduleId({
              scheduleId: item.scheduleId,
              date,
              workoutName,
            });
            const normalized: PersistedTaskOp = {
              scheduleId,
              op,
              payload: {
                date,
                workoutName,
                item: item.payload?.item || item.item,
                preset: item.payload?.preset || item.preset,
              },
              updatedAt: item.updatedAt || item.queuedAt || new Date().toISOString(),
            };
            const existingIdx = merged.findIndex((m) => m.scheduleId === scheduleId);
            if (existingIdx >= 0) merged[existingIdx] = normalized;
            else merged.push(normalized);
          }
        }
        window.localStorage.removeItem(LEGACY_PENDING_TASK_OPS_KEY);
        if (merged.length > 0) {
          raw = JSON.stringify(merged);
          window.localStorage.setItem(PENDING_TASK_OPS_STORAGE_KEY, raw);
        }
      } catch {
        window.localStorage.removeItem(LEGACY_PENDING_TASK_OPS_KEY);
      }
    }

    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PersistedTaskOp =>
        Boolean(entry) &&
        typeof entry.scheduleId === 'string' &&
        (entry.op === 'upsert' || entry.op === 'complete' || entry.op === 'delete')
    );
  } catch {
    return [];
  }
}

function saveQueuedSingleTaskOps(ops: PersistedTaskOp[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (ops.length === 0) {
      window.localStorage.removeItem(PENDING_TASK_OPS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(PENDING_TASK_OPS_STORAGE_KEY, JSON.stringify(ops));
    }
  } catch {
    // Ignore storage quota / privacy restrictions
  }
  emitGoogleTasksRuntimeState();
}

/**
 * Coalesces pending Google Tasks mutations per `scheduleId`:
 * - Queuing `'delete'` removes any pending `'upsert'` / `'complete'` for the same `scheduleId`.
 * - Queuing `'complete'` supersedes any pending `'upsert'` for the same `scheduleId`.
 * - Queuing `'upsert'` supersedes any earlier pending op for the same `scheduleId`.
 */
function enqueueCoalescedTaskOp(op: PersistedTaskOp): void {
  const existing = loadQueuedSingleTaskOps();
  const withoutSame = existing.filter((entry) => entry.scheduleId !== op.scheduleId);
  withoutSame.push(op);
  saveQueuedSingleTaskOps(withoutSame);
}

export function getPendingSingleTaskOpsCount(): number {
  return loadQueuedSingleTaskOps().length;
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

export function getCachedGoogleTasksToken(): string | null {
  const { token, expiresAt } = readTokenFromStorage();
  if (!token) return null;
  if (expiresAt && Date.now() >= expiresAt) {
    clearCachedGoogleTasksToken();
    return null;
  }
  return token;
}

export function isGoogleTasksTokenExpiringSoon(): boolean {
  const { token, expiresAt } = readTokenFromStorage();
  if (!token) return true;
  if (!expiresAt) return true;
  return Date.now() >= expiresAt - TOKEN_EXPIRY_BUFFER_MS;
}

export function cacheGoogleTasksToken(token: string, ttlSeconds = 3500): void {
  const expiresAt = Date.now() + Math.max(60, ttlSeconds) * 1000;
  memoryToken = token;
  googleTokenExpiresAt = expiresAt;
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
      window.sessionStorage.setItem(TOKEN_EXPIRY_KEY, String(expiresAt));
    }
  } catch {
    // Ignore sessionStorage restrictions
  }
  if (currentGoogleSyncStatus === 'needs_reauth' || currentGoogleSyncStatus === 'error') {
    currentGoogleSyncStatus = 'idle';
  }
  emitGoogleTasksRuntimeState();
}

export function clearCachedGoogleTasksToken(): void {
  memoryToken = null;
  googleTokenExpiresAt = null;
  try {
    if (typeof window !== 'undefined') {
      window.sessionStorage.removeItem(TOKEN_STORAGE_KEY);
      window.sessionStorage.removeItem(TOKEN_EXPIRY_KEY);
    }
  } catch {
    // Ignore
  }
  emitGoogleTasksRuntimeState();
}

function resolveGisClientId(): string | null {
  try {
    const envId = (import.meta as { env?: Record<string, string | undefined> }).env
      ?.VITE_GOOGLE_CLIENT_ID;
    if (envId && envId.trim()) return envId.trim();
    if (typeof window !== 'undefined') {
      const stored = window.localStorage.getItem(GOOGLE_CLIENT_ID_STORAGE_KEY);
      if (stored && stored.trim()) return stored.trim();
    }
  } catch {
    // Ignore
  }
  return null;
}

/**
 * Attempts a silent OAuth2 access-token refresh via Google Identity Services (`gis`)
 * using `tokenClient.requestAccessToken({ prompt: '' })`.
 * Returns the refreshed token or `null` if GIS is unavailable or user gesture / reauth is required.
 */
async function trySilentGisTokenRefresh(): Promise<string | null> {
  if (silentRefreshInFlight) return silentRefreshInFlight;
  if (typeof window === 'undefined' || isOfflineNow()) return null;

  const clientId = resolveGisClientId();
  const gisOAuth = (window as unknown as GisWindow).google?.accounts?.oauth2;
  if (!clientId || !gisOAuth?.initTokenClient) {
    return null;
  }

  silentRefreshInFlight = new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      resolve(token);
    };

    const timeoutId = window.setTimeout(() => finish(null), 6000);

    try {
      const tokenClient = gisOAuth.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_TASKS_SCOPE,
        callback: (resp: GisTokenResponse) => {
          if (resp?.access_token && !resp.error) {
            const ttl = Number(resp.expires_in) || 3500;
            cacheGoogleTasksToken(resp.access_token, ttl);
            finish(resp.access_token);
          } else {
            finish(null);
          }
        },
        error_callback: () => {
          finish(null);
        },
      });
      tokenClient.requestAccessToken({ prompt: '' });
    } catch {
      finish(null);
    }
  }).finally(() => {
    silentRefreshInFlight = null;
  });

  return silentRefreshInFlight;
}

async function acquireInteractiveGisToken(): Promise<string | null> {
  if (typeof window === 'undefined' || isOfflineNow()) return null;
  const clientId = resolveGisClientId();
  const gisOAuth = (window as unknown as GisWindow).google?.accounts?.oauth2;
  if (!clientId || !gisOAuth?.initTokenClient) return null;

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (token: string | null) => {
      if (settled) return;
      settled = true;
      resolve(token);
    };
    try {
      const tokenClient = gisOAuth.initTokenClient({
        client_id: clientId,
        scope: GOOGLE_TASKS_SCOPE,
        callback: (resp: GisTokenResponse) => {
          if (resp?.access_token && !resp.error) {
            const ttl = Number(resp.expires_in) || 3500;
            cacheGoogleTasksToken(resp.access_token, ttl);
            finish(resp.access_token);
          } else {
            finish(null);
          }
        },
        error_callback: () => finish(null),
      });
      tokenClient.requestAccessToken({ prompt: 'consent' });
    } catch {
      finish(null);
    }
  });
}

/**
 * Pre-flight token check & acquisition:
 * - If a valid token exists with > 2 minutes before `googleTokenExpiresAt`, returns it immediately.
 * - If missing or within 2 minutes of expiry, attempts a silent GIS refresh (`prompt: ''`).
 * - If silent refresh fails and `interactive === true`, triggers interactive Google OAuth popup.
 * - If silent refresh fails and `interactive === false`, marks `googleSyncStatus = 'needs_reauth'`
 *   when `markNeedsReauthOnFail` is true and returns `null`.
 */
export async function acquireGoogleTasksToken(
  interactive: boolean,
  options?: { markNeedsReauthOnFail?: boolean }
): Promise<string | null> {
  if (isOfflineNow()) {
    setGoogleSyncStatus('offline');
    return null;
  }

  const cached = getCachedGoogleTasksToken();
  if (cached && !isGoogleTasksTokenExpiringSoon()) {
    return cached;
  }

  // Attempt silent refresh when token is missing or within 2 minutes of expiry
  const silentlyRefreshed = await trySilentGisTokenRefresh();
  if (silentlyRefreshed) {
    return silentlyRefreshed;
  }

  // If token is still technically valid (e.g. <2m remaining) and silent refresh wasn't available,
  // allow using it for the immediate call rather than prematurely failing; a 401 will still be handled.
  if (cached && !interactive) {
    return cached;
  }

  if (!interactive) {
    if (options?.markNeedsReauthOnFail) {
      setGoogleSyncStatus('needs_reauth');
    }
    return null;
  }

  // Interactive OAuth: prefer Firebase popup (also refreshes Firebase session), fall back to GIS popup
  const { auth } = initFirebaseServices();
  if (auth) {
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
    cacheGoogleTasksToken(token, 3500);
    return token;
  }

  const gisInteractive = await acquireInteractiveGisToken();
  if (!gisInteractive) {
    throw new Error('Firebase is not initialized and Google Identity Services is unavailable.');
  }
  return gisInteractive;
}

class GoogleTasksUnauthorizedError extends Error {
  constructor(message = 'Google Tasks authorization expired — reconnect required') {
    super(message);
    this.name = 'GoogleTasksUnauthorizedError';
  }
}

/**
 * Authenticated Google Tasks REST wrapper:
 * - Pre-flight token check (refreshes silently if missing or within 2 min of `googleTokenExpiresAt`).
 * - Automatic single silent refresh + retry on `401 Unauthorized`; marks `googleSyncStatus = 'needs_reauth'` if refresh fails.
 * - Exponential backoff (`500ms`, `1500ms`, `3000ms`) for transient `429` / `5xx` responses; never retries `400`/`404`.
 */
async function tasksFetch(
  url: string,
  tokenHint: string | null,
  init?: RequestInit
): Promise<Response> {
  let activeToken = tokenHint;
  if (!activeToken || isGoogleTasksTokenExpiringSoon()) {
    const preflight = await acquireGoogleTasksToken(false, { markNeedsReauthOnFail: true });
    if (preflight) {
      activeToken = preflight;
    }
  }
  if (!activeToken) {
    setGoogleSyncStatus('needs_reauth');
    throw new GoogleTasksUnauthorizedError();
  }

  let attempted401Refresh = false;

  for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt += 1) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${activeToken}`,
    };
    if (init?.body) {
      headers['Content-Type'] = 'application/json';
    }

    let res: Response;
    try {
      res = await fetch(url, {
        ...init,
        headers: {
          ...headers,
          ...(init?.headers || {}),
        },
      });
    } catch (networkErr) {
      if (attempt < RETRY_BACKOFF_MS.length && !isOfflineNow()) {
        await sleepMs(RETRY_BACKOFF_MS[attempt]);
        continue;
      }
      if (isOfflineNow()) {
        setGoogleSyncStatus('offline');
      }
      throw networkErr;
    }

    if (res.status === 401) {
      clearCachedGoogleTasksToken();
      if (!attempted401Refresh) {
        attempted401Refresh = true;
        const refreshed = await trySilentGisTokenRefresh();
        if (refreshed) {
          activeToken = refreshed;
          continue;
        }
      }
      setGoogleSyncStatus('needs_reauth');
      return res;
    }

    // Never retry client errors like 400 / 403 / 404
    if (res.status === 400 || res.status === 403 || res.status === 404) {
      return res;
    }

    // Retry transient rate-limit (429) or server errors (5xx) with exponential backoff
    if (
      (res.status === 429 || (res.status >= 500 && res.status < 600)) &&
      attempt < RETRY_BACKOFF_MS.length
    ) {
      await sleepMs(RETRY_BACKOFF_MS[attempt]);
      continue;
    }

    return res;
  }

  throw new Error('Google Tasks request exceeded retry attempts');
}

async function resolveTasksListId(token: string): Promise<string> {
  if (resolvedListIdCache) return resolvedListIdCache;
  const checkRes = await tasksFetch(
    `https://tasks.googleapis.com/tasks/v1/users/@me/lists/${encodeURIComponent(PREFERRED_LIST_ID)}`,
    token
  );
  if (checkRes.status === 401) {
    throw new GoogleTasksUnauthorizedError();
  }
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
  const allItems: GoogleTaskItem[] = [];
  let pageToken: string | undefined;
  let pageGuard = 0;

  while (pageGuard < 5) {
    pageGuard += 1;
    const url =
      `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks` +
      `?showCompleted=true&showHidden=true&maxResults=100` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');
    const res = await tasksFetch(url, token);
    if (res.status === 401) {
      throw new GoogleTasksUnauthorizedError();
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch Google Tasks (${res.status})`);
    }
    const json = await res.json();
    if (Array.isArray(json.items)) {
      allItems.push(...(json.items as GoogleTaskItem[]));
    }
    if (!json.nextPageToken) break;
    pageToken = String(json.nextPageToken);
  }

  return allItems;
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

function titlesMatchResilient(
  taskTitle: string | undefined,
  targetWorkoutName: string | undefined
): boolean {
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

/**
 * Idempotent match finder across BOTH `needsAction` and `completed` tasks:
 * prioritizes exact `[IronPulse:${scheduleId}]`, then falls back to `due date + normalized title`.
 */
function findIdempotentTaskMatch(
  tasks: GoogleTaskItem[],
  lookup: TaskLookupInput
): GoogleTaskItem | undefined {
  const visible = tasks.filter((t) => !t.deleted && !t.hidden);

  if (lookup.scheduleId) {
    const exactOpen = visible.find(
      (t) => t.status !== 'completed' && extractIronPulseEntryId(t.notes) === lookup.scheduleId
    );
    if (exactOpen) return exactOpen;
    const exactCompleted = visible.find(
      (t) => t.status === 'completed' && extractIronPulseEntryId(t.notes) === lookup.scheduleId
    );
    if (exactCompleted) return exactCompleted;
  }

  if (lookup.date && lookup.workoutName) {
    const openFallback = visible.find((t) => {
      const dueDate = t.due ? t.due.slice(0, 10) : '';
      return (
        t.status !== 'completed' &&
        dueDate === lookup.date &&
        titlesMatchResilient(t.title, lookup.workoutName)
      );
    });
    if (openFallback) return openFallback;

    const completedFallback = visible.find((t) => {
      const dueDate = t.due ? t.due.slice(0, 10) : '';
      return (
        t.status === 'completed' &&
        dueDate === lookup.date &&
        titlesMatchResilient(t.title, lookup.workoutName)
      );
    });
    if (completedFallback) return completedFallback;
  }

  return undefined;
}

async function completeGoogleTaskInternal(
  lookup: TaskLookupInput,
  token: string
): Promise<TasksActionResult> {
  try {
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
      if (res.status === 401) {
        return { status: 'no-token', detail: 'HTTP 401' };
      }
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
    if (err instanceof GoogleTasksUnauthorizedError) {
      return { status: 'no-token', detail: err.message };
    }
    return { status: 'error', detail: getTasksErrorMessage(err, 'Network error') };
  }
}

async function deleteGoogleTaskInternal(
  lookup: TaskLookupInput,
  token: string
): Promise<TasksActionResult> {
  try {
    if (!lookup.scheduleId && !(lookup.date && lookup.workoutName)) {
      return { status: 'not-found' };
    }
    const listId = await resolveTasksListId(token);
    const tasks = await fetchAllTasksInList(listId, token);
    const matches = findMatchingTasks(tasks, lookup);
    if (matches.length === 0) return { status: 'not-found' };

    let anySuccess = false;
    let lastErrorStatus = 0;
    for (const match of matches) {
      const res = await tasksFetch(
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
          listId
        )}/tasks/${encodeURIComponent(match.id)}`,
        token,
        { method: 'DELETE' }
      );
      if (res.status === 401) {
        return { status: 'no-token', detail: 'HTTP 401' };
      }
      if (res.ok || res.status === 404) {
        anySuccess = true;
      } else {
        lastErrorStatus = res.status;
      }
    }
    return anySuccess
      ? { status: 'synced' }
      : { status: 'error', detail: `HTTP ${lastErrorStatus}` };
  } catch (err: unknown) {
    if (err instanceof GoogleTasksUnauthorizedError) {
      return { status: 'no-token', detail: err.message };
    }
    return { status: 'error', detail: getTasksErrorMessage(err, 'Network error') };
  }
}

async function upsertGoogleTaskInternal(
  params: {
    date: string;
    item: ScheduledItem;
    preset?: WorkoutPreset;
    workoutName?: string;
    todayIso?: string;
  },
  token: string
): Promise<TasksActionResult> {
  try {
    const todayIso = params.todayIso || getTodayIsoDate();
    if (!isDateWithinGoogleTasksSyncWindow(params.date, todayIso)) {
      return { status: 'out-of-window' };
    }

    const listId = await resolveTasksListId(token);
    const tasks = await fetchAllTasksInList(listId, token);

    // Idempotent Upsert Guard: inspect BOTH needsAction and completed tasks for [IronPulse:${scheduleId}]
    // plus due date + normalized title fallback so retries never insert duplicates.
    const existing = findIdempotentTaskMatch(tasks, {
      scheduleId: params.item.scheduleItemUuid,
      date: params.date,
      workoutName: params.preset?.title || params.workoutName,
    });

    const payload: Record<string, unknown> = {
      title: buildTaskTitle(params.item, params.preset),
      due: `${params.date}T00:00:00.000Z`,
      notes: buildTaskNotes(params.item, params.preset),
      status: 'needsAction',
    };
    if (existing && existing.status === 'completed') {
      payload.completed = null;
    }

    const res = existing
      ? await tasksFetch(
          `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
            listId
          )}/tasks/${encodeURIComponent(existing.id)}`,
          token,
          { method: 'PATCH', body: JSON.stringify(payload) }
        )
      : await tasksFetch(
          `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`,
          token,
          { method: 'POST', body: JSON.stringify(payload) }
        );

    if (res.status === 401) {
      return { status: 'no-token', detail: 'HTTP 401' };
    }
    return res.ok
      ? { status: 'synced' }
      : { status: 'error', detail: `HTTP ${res.status}` };
  } catch (err: unknown) {
    if (err instanceof GoogleTasksUnauthorizedError) {
      return { status: 'no-token', detail: err.message };
    }
    return { status: 'error', detail: getTasksErrorMessage(err, 'Network error') };
  }
}

async function executeCoalescedOpInternal(
  op: PersistedTaskOp,
  token: string,
  todayIso: string
): Promise<TasksActionResult> {
  const realScheduleId = op.scheduleId.startsWith('dt::') ? undefined : op.scheduleId;
  const date = op.payload?.date || todayIso;
  const workoutName = op.payload?.workoutName || op.payload?.preset?.title;

  if (op.op === 'complete') {
    return completeGoogleTaskInternal(
      { scheduleId: realScheduleId, date, workoutName },
      token
    );
  }

  if (op.op === 'delete') {
    return deleteGoogleTaskInternal(
      { scheduleId: realScheduleId, date, workoutName },
      token
    );
  }

  // op === 'upsert'
  if (!isDateWithinGoogleTasksSyncWindow(date, todayIso)) {
    return { status: 'out-of-window' };
  }
  const itemForUpsert: ScheduledItem = op.payload?.item || {
    scheduleItemUuid: realScheduleId || `sch-temp-${date}`,
    orderIndex: 0,
    slotRole: 'Primary',
    presetUuid: op.payload?.preset?.presetUuid || '',
    status: 'pending',
    completed: false,
  };
  return upsertGoogleTaskInternal(
    {
      date,
      item: itemForUpsert,
      preset: op.payload?.preset,
      workoutName,
      todayIso,
    },
    token
  );
}

async function flushQueuedSingleTaskOpsInternal(token: string): Promise<{
  flushedCount: number;
  remainingCount: number;
  needsReauth: boolean;
}> {
  const queued = loadQueuedSingleTaskOps();
  if (queued.length === 0) {
    return { flushedCount: 0, remainingCount: 0, needsReauth: false };
  }

  const todayIso = getTodayIsoDate();
  const remaining: PersistedTaskOp[] = [];
  let flushedCount = 0;
  let needsReauth = false;

  for (let i = 0; i < queued.length; i += 1) {
    const op = queued[i];
    if (needsReauth) {
      remaining.push(op);
      continue;
    }

    const res = await executeCoalescedOpInternal(op, token, todayIso);
    if (res.status === 'synced' || res.status === 'not-found' || res.status === 'out-of-window') {
      flushedCount += 1;
    } else if (res.status === 'no-token') {
      needsReauth = true;
      remaining.push(op);
    } else {
      remaining.push(op);
    }
  }

  saveQueuedSingleTaskOps(remaining);
  if (needsReauth) {
    setGoogleSyncStatus('needs_reauth');
  } else if (remaining.length === 0 && flushedCount > 0) {
    setGoogleSyncStatus('synced');
  }

  return { flushedCount, remainingCount: remaining.length, needsReauth };
}

export async function flushQueuedSingleTaskOps(): Promise<number> {
  return enqueueGoogleTasksMutex(async () => {
    if (isOfflineNow()) {
      setGoogleSyncStatus('offline');
      return 0;
    }
    if (getPendingSingleTaskOpsCount() === 0) return 0;

    const token = await acquireGoogleTasksToken(false, { markNeedsReauthOnFail: true });
    if (!token) return 0;

    setGoogleSyncStatus('syncing');
    const result = await flushQueuedSingleTaskOpsInternal(token);
    if (!result.needsReauth && result.remainingCount === 0) {
      setGoogleSyncStatus('synced');
    } else if (!result.needsReauth && result.remainingCount > 0) {
      setGoogleSyncStatus('error');
    }
    return result.flushedCount;
  });
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
  return enqueueGoogleTasksMutex(async () => {
    if (isOfflineNow()) {
      return { ok: false, skipped: true, pulledCompleted: [] };
    }
    const token = await acquireGoogleTasksToken(false, { markNeedsReauthOnFail: false });
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
    }
  });
}

export async function syncGoogleTasksTwoWay(params: {
  interactive: boolean;
  todayIso: string;
  schedules: Record<string, DailySchedule>;
  presets: WorkoutPreset[];
  excludedFromTasksIds?: string[];
  dismissedTaskCompletionIds?: string[];
  isScheduleAuthoritative?: boolean;
  hasCompletedLogFor: (date: string, item: ScheduledItem) => boolean;
}): Promise<{
  ok: boolean;
  skipped?: boolean;
  needsReauth?: boolean;
  pulledCompleted: PendingTaskCompletion[];
  pulledReschedules: TaskReschedulePatch[];
  pushedCount: number;
  deletedStaleCount: number;
  error?: string;
}> {
  return enqueueGoogleTasksMutex(async () => {
    if (isOfflineNow()) {
      setGoogleSyncStatus('offline');
      return {
        ok: false,
        skipped: true,
        pulledCompleted: [],
        pulledReschedules: [],
        pushedCount: 0,
        deletedStaleCount: 0,
        error: 'Offline — Google Tasks sync queued for reconnect.',
      };
    }

    setGoogleSyncStatus('syncing');
    try {
      const token = await acquireGoogleTasksToken(params.interactive, {
        markNeedsReauthOnFail: true,
      });
      if (!token) {
        setGoogleSyncStatus('needs_reauth');
        return {
          ok: false,
          skipped: !params.interactive,
          needsReauth: true,
          pulledCompleted: [],
          pulledReschedules: [],
          pushedCount: 0,
          deletedStaleCount: 0,
          error: 'Google Tasks authorization expired — tap Reconnect to authorize.',
        };
      }

      // 0. Drain any coalesced single-workout task ops persisted in wt_gtasks_pending_ops
      const flushRes = await flushQueuedSingleTaskOpsInternal(token);
      if (flushRes.needsReauth) {
        setGoogleSyncStatus('needs_reauth');
        return {
          ok: false,
          needsReauth: true,
          pulledCompleted: [],
          pulledReschedules: [],
          pushedCount: 0,
          deletedStaleCount: 0,
          error: 'Google Tasks authorization expired — tap Reconnect to authorize.',
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
          const rawStatus = String(item.status || '').toLowerCase();
          const st = normalizeScheduleStatus(item.status);
          if (
            st === 'completed' ||
            st === 'skipped' ||
            rawStatus === 'modified' ||
            params.hasCompletedLogFor(date, item)
          ) {
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

      // Idempotent maps across both open and completed tasks to avoid duplicates on flaky Wi-Fi
      const openTaskByEntryId = new Map<string, GoogleTaskItem>();
      const completedTaskByEntryId = new Map<string, GoogleTaskItem>();
      const openTaskByDateTitle = new Map<string, GoogleTaskItem>();
      const pulledCompleted: PendingTaskCompletion[] = [];
      const pulledReschedules: TaskReschedulePatch[] = [];
      let deletedStaleCount = 0;

      const excludedSet = new Set(params.excludedFromTasksIds || []);
      const dismissedSet = new Set(params.dismissedTaskCompletionIds || []);
      const isScheduleAuthoritative =
        params.isScheduleAuthoritative !== undefined
          ? params.isScheduleAuthoritative
          : scheduleByEntryId.size > 0;

      // 1. Inbound & Completion Sweep across all visible IronPulse tasks (never touch personal tasks)
      for (const task of remoteTasks) {
        if (task.deleted || task.hidden) continue;
        const entryId = extractIronPulseEntryId(task.notes);
        const taskDueDate = task.due ? task.due.slice(0, 10) : null;
        const isIronPulseManaged = Boolean(entryId) || (task.title || '').startsWith('💪 ');

        if (!isIronPulseManaged) continue;

        // Sweep any open (needsAction) IronPulse task whose date + normalized workout title matches
        // a completed / modified / skipped local schedule entry, even if its scheduleId changed.
        if (task.status !== 'completed' && taskDueDate) {
          const completedTitlesForDate = completedDateTitles.get(taskDueDate) || [];
          const matchesCompletedByTitle = completedTitlesForDate.some((ct) =>
            titlesMatchResilient(task.title, ct)
          );
          if (matchesCompletedByTitle) {
            const patchRes = await tasksFetch(
              `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
                listId
              )}/tasks/${encodeURIComponent(task.id)}`,
              token,
              {
                method: 'PATCH',
                body: JSON.stringify({ status: 'completed' }),
              }
            );
            if (patchRes.status === 401) throw new GoogleTasksUnauthorizedError();
            continue;
          }
        }

        if (!entryId) continue;

        const localEntry = scheduleByEntryId.get(entryId);
        const rawLocalStatus = localEntry ? String(localEntry.item.status || '').toLowerCase() : '';
        const localStatus = localEntry ? normalizeScheduleStatus(localEntry.item.status) : null;

        if (localEntry && !excludedSet.has(entryId) && localStatus !== 'skipped') {
          const isInWindow =
            (localEntry.date >= params.todayIso && localEntry.date <= maxSyncDate) ||
            (taskDueDate !== null && taskDueDate >= params.todayIso && taskDueDate <= maxSyncDate);

          if (isInWindow) {
            if (
              taskDueDate &&
              taskDueDate !== localEntry.date &&
              localStatus !== 'completed' &&
              rawLocalStatus !== 'modified'
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
              rawLocalStatus !== 'modified' &&
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

        // 2. Deterministic status alignment & orphan pruning on Master Sync:
        // - Open [IronPulse:<scheduleId>] task whose <scheduleId> no longer exists in wt_schedule -> DELETE (orphan)
        // - Open [IronPulse:...] task due after maxSyncDate -> DELETE (out-of-window future week)
        // - Excluded or past-due open [IronPulse:...] task -> DELETE
        // - Open [IronPulse:...] task whose wt_schedule status is completed, modified, or skipped -> PATCH status: 'completed'
        const isExcluded = excludedSet.has(entryId);
        const isOrphanedOpen = isScheduleAuthoritative && !localEntry && task.status !== 'completed';
        const isBeyondSyncWindowOpen =
          task.status !== 'completed' && taskDueDate !== null && taskDueDate > maxSyncDate;
        const isDoneOrSkippedLocally =
          localEntry !== undefined &&
          (localStatus === 'completed' ||
            localStatus === 'skipped' ||
            rawLocalStatus === 'modified' ||
            params.hasCompletedLogFor(localEntry.date, localEntry.item));
        const isPastDueOpen =
          isScheduleAuthoritative &&
          task.status !== 'completed' &&
          taskDueDate !== null &&
          taskDueDate < params.todayIso &&
          !isDoneOrSkippedLocally;

        if (
          isOrphanedOpen ||
          isBeyondSyncWindowOpen ||
          (isScheduleAuthoritative && isExcluded && !isDoneOrSkippedLocally) ||
          isPastDueOpen
        ) {
          const delRes = await tasksFetch(
            `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
              listId
            )}/tasks/${encodeURIComponent(task.id)}`,
            token,
            { method: 'DELETE' }
          );
          if (delRes.status === 401) throw new GoogleTasksUnauthorizedError();
          if (delRes.ok) {
            deletedStaleCount += 1;
          }
          continue;
        }

        if (isDoneOrSkippedLocally && task.status !== 'completed') {
          const patchRes = await tasksFetch(
            `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
              listId
            )}/tasks/${encodeURIComponent(task.id)}`,
            token,
            {
              method: 'PATCH',
              body: JSON.stringify({ status: 'completed' }),
            }
          );
          if (patchRes.status === 401) throw new GoogleTasksUnauthorizedError();
          continue;
        }

        // Index both open and completed tasks by entryId for idempotent upserts
        if (task.status !== 'completed') {
          openTaskByEntryId.set(entryId, task);
          const normTaskTitle = normalizeTaskWorkoutTitle(task.title);
          if (taskDueDate && normTaskTitle) {
            openTaskByDateTitle.set(`${taskDueDate}::${normTaskTitle}`, task);
          }
        } else {
          completedTaskByEntryId.set(entryId, task);
        }
      }

      // 3. Outbound: Push/update all Pending & In Progress schedule entries within [todayIso, maxSyncDate]
      let pushedCount = 0;
      const pulledCompletedIdSet = new Set(pulledCompleted.map((p) => p.scheduleItemUuid));

      const targetDates = Object.keys(params.schedules)
        .filter((d) => d >= params.todayIso && d <= maxSyncDate)
        .sort();

      for (const date of targetDates) {
        const daySch = params.schedules[date];
        for (const item of daySch?.items || []) {
          const itemStatus = normalizeScheduleStatus(item.status);
          if (itemStatus !== 'pending' && itemStatus !== 'in_progress') continue;
          if (excludedSet.has(item.scheduleItemUuid)) continue;
          // If the user just checked this task off in Google Tasks, don't overwrite their checkmark
          if (pulledCompletedIdSet.has(item.scheduleItemUuid)) continue;

          const preset = params.presets.find((p) => p.presetUuid === item.presetUuid);
          const normPresetTitle = normalizeTaskWorkoutTitle(preset?.title);
          const existingOpen =
            openTaskByEntryId.get(item.scheduleItemUuid) ||
            (normPresetTitle ? openTaskByDateTitle.get(`${date}::${normPresetTitle}`) : undefined);
          const existingCompleted = !existingOpen
            ? completedTaskByEntryId.get(item.scheduleItemUuid)
            : undefined;
          const existingTask = existingOpen || existingCompleted;

          const payload: Record<string, unknown> = {
            title: buildTaskTitle(item, preset),
            due: `${date}T00:00:00.000Z`,
            notes: buildTaskNotes(item, preset),
            status: 'needsAction',
          };
          if (existingTask && existingTask.status === 'completed') {
            payload.completed = null;
          }

          if (existingTask) {
            const patchRes = await tasksFetch(
              `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(
                listId
              )}/tasks/${encodeURIComponent(existingTask.id)}`,
              token,
              { method: 'PATCH', body: JSON.stringify(payload) }
            );
            if (patchRes.status === 401) throw new GoogleTasksUnauthorizedError();
            if (patchRes.ok) pushedCount += 1;
          } else {
            const postRes = await tasksFetch(
              `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks`,
              token,
              { method: 'POST', body: JSON.stringify(payload) }
            );
            if (postRes.status === 401) throw new GoogleTasksUnauthorizedError();
            if (postRes.ok) pushedCount += 1;
          }
        }
      }

      setGoogleSyncStatus(getPendingSingleTaskOpsCount() === 0 ? 'synced' : 'idle');
      return {
        ok: true,
        pulledCompleted,
        pulledReschedules,
        pushedCount,
        deletedStaleCount,
      };
    } catch (err: unknown) {
      if (err instanceof GoogleTasksUnauthorizedError) {
        setGoogleSyncStatus('needs_reauth');
        return {
          ok: false,
          needsReauth: true,
          pulledCompleted: [],
          pulledReschedules: [],
          pushedCount: 0,
          deletedStaleCount: 0,
          error: 'Google Tasks authorization expired — tap Reconnect to authorize.',
        };
      }
      setGoogleSyncStatus(isOfflineNow() ? 'offline' : 'error');
      return {
        ok: false,
        pulledCompleted: [],
        pulledReschedules: [],
        pushedCount: 0,
        deletedStaleCount: 0,
        error: getTasksErrorMessage(err, 'Google Tasks sync failed'),
      };
    }
  });
}

export async function completeGoogleTaskForWorkout(
  scheduleIdOrLookup: string | TaskLookupInput
): Promise<TasksActionResult> {
  const lookup: TaskLookupInput =
    typeof scheduleIdOrLookup === 'string'
      ? { scheduleId: scheduleIdOrLookup }
      : scheduleIdOrLookup;
  return enqueueGoogleTasksMutex(async () => {
    const token = await acquireGoogleTasksToken(false, { markNeedsReauthOnFail: true });
    if (!token) return { status: 'no-token' };
    return completeGoogleTaskInternal(lookup, token);
  });
}

export const completeGoogleTaskForSchedule = completeGoogleTaskForWorkout;

export async function deleteGoogleTaskForSchedule(
  scheduleIdOrLookup: string | TaskLookupInput
): Promise<TasksActionResult> {
  const lookup: TaskLookupInput =
    typeof scheduleIdOrLookup === 'string'
      ? { scheduleId: scheduleIdOrLookup }
      : scheduleIdOrLookup;
  return enqueueGoogleTasksMutex(async () => {
    const token = await acquireGoogleTasksToken(false, { markNeedsReauthOnFail: true });
    if (!token) return { status: 'no-token' };
    return deleteGoogleTaskInternal(lookup, token);
  });
}

export async function upsertGoogleTaskForSchedule(params: {
  date: string;
  item: ScheduledItem;
  preset?: WorkoutPreset;
  todayIso?: string;
}): Promise<TasksActionResult> {
  return enqueueGoogleTasksMutex(async () => {
    const todayIso = params.todayIso || getTodayIsoDate();
    if (!isDateWithinGoogleTasksSyncWindow(params.date, todayIso)) {
      return { status: 'out-of-window' };
    }
    const token = await acquireGoogleTasksToken(false, { markNeedsReauthOnFail: true });
    if (!token) return { status: 'no-token' };
    return upsertGoogleTaskInternal(params, token);
  });
}

/**
 * Unified, mutex-serialized single-workout Google Tasks sync helper.
 * Executes immediately when online with a fresh token (attempting silent refresh if within 2m of expiry);
 * otherwise persists a coalesced mutation in `localStorage['wt_gtasks_pending_ops']` keyed by `scheduleId`.
 */
export async function syncSingleScheduleTask(
  scheduleItem: SingleScheduleTaskInput,
  action: SingleTaskSyncAction
): Promise<TasksActionResult> {
  return enqueueGoogleTasksMutex(async () => {
    const todayIso = getTodayIsoDate();
    const rawScheduleId =
      scheduleItem.scheduleItemUuid ||
      scheduleItem.scheduleId ||
      scheduleItem.item?.scheduleItemUuid;
    const workoutName = scheduleItem.workoutName || scheduleItem.preset?.title;
    const coalescedOpType = mapActionToCoalescedOp(action);

    if (
      coalescedOpType === 'upsert' &&
      !isDateWithinGoogleTasksSyncWindow(scheduleItem.date, todayIso)
    ) {
      return { status: 'out-of-window' };
    }

    const persistedOp: PersistedTaskOp = {
      scheduleId: buildQueueScheduleId({
        scheduleId: rawScheduleId,
        date: scheduleItem.date,
        workoutName,
      }),
      op: coalescedOpType,
      payload: {
        date: scheduleItem.date,
        workoutName,
        item: scheduleItem.item,
        preset: scheduleItem.preset,
      },
      updatedAt: new Date().toISOString(),
    };

    if (isOfflineNow()) {
      setGoogleSyncStatus('offline');
      enqueueCoalescedTaskOp(persistedOp);
      return { status: 'no-token' };
    }

    const token = await acquireGoogleTasksToken(false, { markNeedsReauthOnFail: true });
    if (!token) {
      enqueueCoalescedTaskOp(persistedOp);
      return { status: 'no-token' };
    }

    setGoogleSyncStatus('syncing');
    const res = await executeCoalescedOpInternal(persistedOp, token, todayIso);
    if (res.status === 'no-token') {
      enqueueCoalescedTaskOp(persistedOp);
      setGoogleSyncStatus('needs_reauth');
      return res;
    }
    if (res.status === 'error') {
      enqueueCoalescedTaskOp(persistedOp);
      setGoogleSyncStatus(isOfflineNow() ? 'offline' : 'error');
      return res;
    }

    // Remove any superseded queued op for this scheduleId if execution succeeded
    const existing = loadQueuedSingleTaskOps();
    if (existing.some((entry) => entry.scheduleId === persistedOp.scheduleId)) {
      saveQueuedSingleTaskOps(
        existing.filter((entry) => entry.scheduleId !== persistedOp.scheduleId)
      );
    }

    if (getPendingSingleTaskOpsCount() === 0) {
      setGoogleSyncStatus('synced');
    }
    return res;
  });
}

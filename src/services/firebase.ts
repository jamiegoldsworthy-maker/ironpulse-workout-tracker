import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  Auth,
  User,
} from 'firebase/auth';
import {
  getFirestore,
  enableIndexedDbPersistence,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  Firestore,
  writeBatch,
  Unsubscribe,
} from 'firebase/firestore';

export interface FirebaseConfigInput {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
}

export type WtCollectionName =
  | 'wt_meta'
  | 'wt_exercises'
  | 'wt_presets'
  | 'wt_programs'
  | 'wt_schedule'
  | 'wt_logs';

const RUNTIME_CONFIG_KEY = 'wt_firebase_config_override';

/**
 * Recursively strips `undefined` values and converts non-finite numbers (`NaN`, `Infinity`)
 * so Firestore `setDoc` / `writeBatch` never fails due to unsupported field values.
 */
export function sanitizeForFirestore<T>(value: T): T {
  if (value === null || value === undefined) {
    return null as unknown as T;
  }
  if (typeof value === 'number') {
    return (Number.isFinite(value) ? value : 0) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => sanitizeForFirestore(item)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (v !== undefined) {
        out[k] = sanitizeForFirestore(v);
      }
    }
    return out as T;
  }
  return value;
}

export function getEffectiveFirebaseConfig(): FirebaseConfigInput | null {
  try {
    const rawOverride = localStorage.getItem(RUNTIME_CONFIG_KEY);
    if (rawOverride) {
      const parsed = JSON.parse(rawOverride);
      if (parsed && parsed.apiKey && parsed.projectId) {
        return parsed;
      }
    }
  } catch {
    // ignore malformed JSON
  }

  const env = import.meta.env;
  if (
    env.VITE_FIREBASE_API_KEY &&
    env.VITE_FIREBASE_API_KEY !== 'your_api_key_here' &&
    env.VITE_FIREBASE_PROJECT_ID &&
    env.VITE_FIREBASE_PROJECT_ID !== 'your-project-id'
  ) {
    return {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || `${env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || `${env.VITE_FIREBASE_PROJECT_ID}.appspot.com`,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
      appId: env.VITE_FIREBASE_APP_ID || '',
    };
  }

  return null;
}

export function saveRuntimeFirebaseConfig(configJson: string): boolean {
  try {
    const cleaned = configJson
      .replace(/const\s+firebaseConfig\s*=\s*/g, '')
      .replace(/;\s*$/g, '')
      .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?\s*:/g, '"$2":')
      .replace(/'/g, '"');
    const parsed = JSON.parse(cleaned);
    if (!parsed.apiKey || !parsed.projectId) return false;
    localStorage.setItem(RUNTIME_CONFIG_KEY, JSON.stringify(parsed));
    return true;
  } catch {
    return false;
  }
}

export function clearRuntimeFirebaseConfig(): void {
  localStorage.removeItem(RUNTIME_CONFIG_KEY);
}

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;
let persistenceAttempted = false;

export function initFirebaseServices(): {
  app: FirebaseApp | null;
  auth: Auth | null;
  db: Firestore | null;
  isConfigured: boolean;
} {
  const cfg = getEffectiveFirebaseConfig();
  if (!cfg) {
    return { app: null, auth: null, db: null, isConfigured: false };
  }

  try {
    if (!appInstance) {
      const existing = getApps();
      appInstance = existing.length > 0 ? existing[0] : initializeApp(cfg);
      authInstance = getAuth(appInstance);
      dbInstance = getFirestore(appInstance);

      if (!persistenceAttempted && dbInstance) {
        persistenceAttempted = true;
        enableIndexedDbPersistence(dbInstance).catch((err) => {
          console.warn('Firestore IndexedDB persistence notice:', err?.code || err);
        });
      }
    }
    return {
      app: appInstance,
      auth: authInstance,
      db: dbInstance,
      isConfigured: true,
    };
  } catch (err) {
    console.error('Failed to initialize Firebase:', err);
    return { app: null, auth: null, db: null, isConfigured: false };
  }
}

export async function signInWithGoogle(): Promise<User | null> {
  const { auth } = initFirebaseServices();
  if (!auth) throw new Error('Firebase is not configured yet. Add your Firebase config in Settings.');
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutFirebase(): Promise<void> {
  const { auth } = initFirebaseServices();
  if (auth) {
    await fbSignOut(auth);
  }
}

export function subscribeToAuthChanges(callback: (user: User | null) => void): () => void {
  const { auth } = initFirebaseServices();
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

export async function upsertFirestoreDoc<T extends Record<string, any>>(
  collectionName: WtCollectionName,
  docId: string,
  data: T,
  explicitUid?: string
): Promise<void> {
  const { db, auth } = initFirebaseServices();
  if (!db) {
    throw new Error('Firestore is not initialized.');
  }
  const uid = auth?.currentUser?.uid || explicitUid;
  if (!uid) {
    throw new Error(`Cannot write to ${collectionName}/${docId}: user is not signed in.`);
  }
  const cleanData = sanitizeForFirestore({ ...data, uid });
  try {
    await setDoc(doc(db, collectionName, docId), cleanData, { merge: true });
  } catch (err) {
    console.error(`[Firestore] Failed to write ${collectionName}/${docId}:`, err, cleanData);
    throw err;
  }
}

export async function removeFirestoreDoc(
  collectionName: WtCollectionName,
  docId: string
): Promise<void> {
  const { db, auth } = initFirebaseServices();
  if (!db) {
    throw new Error('Firestore is not initialized.');
  }
  if (!auth?.currentUser) {
    throw new Error(`Cannot delete ${collectionName}/${docId}: user is not signed in.`);
  }
  try {
    await deleteDoc(doc(db, collectionName, docId));
  } catch (err) {
    console.error(`[Firestore] Failed to delete ${collectionName}/${docId}:`, err);
    throw err;
  }
}

export async function pullAllUserCollections(uid: string) {
  const { db } = initFirebaseServices();
  if (!db) return null;

  const fetchCol = async <T>(name: WtCollectionName): Promise<T[]> => {
    try {
      const q = query(collection(db, name), where('uid', '==', uid));
      const snap = await getDocs(q);
      return snap.docs.map((d) => d.data() as T);
    } catch (err) {
      console.error(`[Firestore] Failed to pull ${name} for uid=${uid}:`, err);
      throw err;
    }
  };

  const [exercises, presets, programs, schedules, logs, metas] = await Promise.all([
    fetchCol<any>('wt_exercises'),
    fetchCol<any>('wt_presets'),
    fetchCol<any>('wt_programs'),
    fetchCol<any>('wt_schedule'),
    fetchCol<any>('wt_logs'),
    fetchCol<any>('wt_meta'),
  ]);

  return {
    exercises,
    presets,
    programs,
    schedules,
    logs,
    meta: metas[0] || null,
  };
}

export interface RealtimeSyncCallbacks {
  onExercises: (items: any[]) => void;
  onPresets: (items: any[]) => void;
  onPrograms: (items: any[]) => void;
  onSchedules: (items: any[]) => void;
  onLogs: (items: any[]) => void;
  onMeta: (meta: any | null) => void;
  onError: (collectionName: WtCollectionName, error: Error) => void;
}

/**
 * Attaches real-time Firestore `onSnapshot` listeners filtered solely by `where('uid', '==', uid)`
 * (sorting is done client-side so no composite indexes are required).
 */
export function subscribeToUserCollections(
  uid: string,
  callbacks: RealtimeSyncCallbacks
): () => void {
  const { db } = initFirebaseServices();
  if (!db || !uid) return () => {};

  const unsubscribers: Unsubscribe[] = [];

  const watchCollection = (
    name: Exclude<WtCollectionName, 'wt_meta'>,
    onData: (docs: any[]) => void
  ) => {
    const q = query(collection(db, name), where('uid', '==', uid));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const docs = snapshot.docs.map((d) => d.data());
        onData(docs);
      },
      (err) => {
        console.error(`[Firestore] Real-time listener error on ${name}:`, err);
        callbacks.onError(name, err);
      }
    );
    unsubscribers.push(unsub);
  };

  watchCollection('wt_exercises', callbacks.onExercises);
  watchCollection('wt_presets', callbacks.onPresets);
  watchCollection('wt_programs', callbacks.onPrograms);
  watchCollection('wt_schedule', callbacks.onSchedules);
  watchCollection('wt_logs', callbacks.onLogs);

  const metaUnsub = onSnapshot(
    doc(db, 'wt_meta', uid),
    (snap) => {
      callbacks.onMeta(snap.exists() ? snap.data() : null);
    },
    (err) => {
      console.error('[Firestore] Real-time listener error on wt_meta:', err);
      callbacks.onError('wt_meta', err);
    }
  );
  unsubscribers.push(metaUnsub);

  return () => {
    unsubscribers.forEach((u) => u());
  };
}

export async function pushAllLocalDataToFirestore(
  uid: string,
  payload: {
    exercises: any[];
    presets: any[];
    programs: any[];
    schedules: Record<string, any>;
    logs: any[];
    meta: any;
  }
): Promise<void> {
  const { db } = initFirebaseServices();
  if (!db) throw new Error('Firestore is not initialized.');

  try {
    const operations: Array<{ col: WtCollectionName; id: string; data: any }> = [];

    if (payload.meta) {
      operations.push({
        col: 'wt_meta',
        id: uid,
        data: sanitizeForFirestore({ ...payload.meta, uid }),
      });
    }
    for (const ex of payload.exercises) {
      operations.push({
        col: 'wt_exercises',
        id: ex.exerciseUuid,
        data: sanitizeForFirestore({ ...ex, uid }),
      });
    }
    for (const pre of payload.presets) {
      operations.push({
        col: 'wt_presets',
        id: pre.presetUuid,
        data: sanitizeForFirestore({ ...pre, uid }),
      });
    }
    for (const prog of payload.programs) {
      operations.push({
        col: 'wt_programs',
        id: prog.programUuid,
        data: sanitizeForFirestore({ ...prog, uid }),
      });
    }
    for (const [dateKey, sch] of Object.entries(payload.schedules)) {
      const docId = `${uid}_${dateKey}`;
      operations.push({
        col: 'wt_schedule',
        id: docId,
        data: sanitizeForFirestore({ ...sch, scheduleId: docId, uid }),
      });
    }
    for (const log of payload.logs) {
      operations.push({
        col: 'wt_logs',
        id: log.logUuid,
        data: sanitizeForFirestore({ ...log, uid }),
      });
    }

    // Firestore writeBatch has a 500-operation limit per batch
    const CHUNK_SIZE = 450;
    for (let i = 0; i < operations.length; i += CHUNK_SIZE) {
      const batch = writeBatch(db);
      const chunk = operations.slice(i, i + CHUNK_SIZE);
      for (const op of chunk) {
        batch.set(doc(db, op.col, op.id), op.data, { merge: true });
      }
      await batch.commit();
    }
  } catch (err) {
    console.error('[Firestore] Batch push failed:', err);
    throw err;
  }
}

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
  query,
  where,
  Firestore,
  writeBatch,
} from 'firebase/firestore';

export interface FirebaseConfigInput {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId: string;
}

const RUNTIME_CONFIG_KEY = 'wt_firebase_config_override';

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
    // Allow pasting either strict JSON or JS object snippet from Firebase Console
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
          // multi-tab or unsupported browser warning is safe to ignore
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
  collectionName: 'wt_meta' | 'wt_exercises' | 'wt_presets' | 'wt_programs' | 'wt_schedule' | 'wt_logs',
  docId: string,
  data: T
): Promise<void> {
  const { db, auth } = initFirebaseServices();
  if (!db || !auth?.currentUser) return;
  const uid = auth.currentUser.uid;
  const cleanData = JSON.parse(JSON.stringify({ ...data, uid }));
  await setDoc(doc(db, collectionName, docId), cleanData, { merge: true });
}

export async function removeFirestoreDoc(
  collectionName: 'wt_meta' | 'wt_exercises' | 'wt_presets' | 'wt_programs' | 'wt_schedule' | 'wt_logs',
  docId: string
): Promise<void> {
  const { db, auth } = initFirebaseServices();
  if (!db || !auth?.currentUser) return;
  await deleteDoc(doc(db, collectionName, docId));
}

export async function pullAllUserCollections(uid: string) {
  const { db } = initFirebaseServices();
  if (!db) return null;

  const fetchCol = async <T>(name: string): Promise<T[]> => {
    const q = query(collection(db, name), where('uid', '==', uid));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as T);
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
  if (!db) return;

  const batch = writeBatch(db);

  if (payload.meta) {
    batch.set(
      doc(db, 'wt_meta', uid),
      JSON.parse(JSON.stringify({ ...payload.meta, uid })),
      { merge: true }
    );
  }

  for (const ex of payload.exercises) {
    batch.set(
      doc(db, 'wt_exercises', ex.exerciseUuid),
      JSON.parse(JSON.stringify({ ...ex, uid })),
      { merge: true }
    );
  }

  for (const pre of payload.presets) {
    batch.set(
      doc(db, 'wt_presets', pre.presetUuid),
      JSON.parse(JSON.stringify({ ...pre, uid })),
      { merge: true }
    );
  }

  for (const prog of payload.programs) {
    batch.set(
      doc(db, 'wt_programs', prog.programUuid),
      JSON.parse(JSON.stringify({ ...prog, uid })),
      { merge: true }
    );
  }

  for (const [dateKey, sch] of Object.entries(payload.schedules)) {
    const docId = `${uid}_${dateKey}`;
    batch.set(
      doc(db, 'wt_schedule', docId),
      JSON.parse(JSON.stringify({ ...sch, scheduleId: docId, uid })),
      { merge: true }
    );
  }

  for (const log of payload.logs) {
    batch.set(
      doc(db, 'wt_logs', log.logUuid),
      JSON.parse(JSON.stringify({ ...log, uid })),
      { merge: true }
    );
  }

  await batch.commit();
}

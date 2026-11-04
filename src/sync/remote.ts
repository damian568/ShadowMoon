/** The Firestore side of library sync: reads and writes users/{uid}/library/{title}. */
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';

import { getFirebaseDb } from '../firebase/client';
import { chunk, docIdFor, parseSynced, type PendingUpload, type SyncedEntry } from './merge';

/** Firestore allows 500 writes per batch; stay well under. */
const BATCH_SIZE = 400;

function db() {
  const database = getFirebaseDb();
  if (!database) throw new Error('Cloud sync is not set up.');
  return database;
}

/** Download this account's whole library (one document per title). */
export async function fetchRemoteLibrary(uid: string): Promise<Record<string, SyncedEntry>> {
  const snapshot = await getDocs(collection(db(), 'users', uid, 'library'));
  const out: Record<string, SyncedEntry> = {};
  snapshot.forEach((document) => {
    const entry = parseSynced(document.data());
    if (entry) out[entry.id] = entry;
  });
  return out;
}

/** Write titles to the cloud, replacing their documents. */
export async function uploadEntries(uid: string, items: PendingUpload[]): Promise<void> {
  const database = db();
  for (const part of chunk(items, BATCH_SIZE)) {
    const batch = writeBatch(database);
    for (const item of part) {
      batch.set(doc(database, 'users', uid, 'library', docIdFor(item.id)), { ...item.data });
    }
    await batch.commit();
  }
}

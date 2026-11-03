import type { RouteDocument } from '../domain/model';
import { RouteFileError } from './errors';
import { loadProject, saveProject } from './project';

let connection: Promise<IDBDatabase> | undefined;

function openDatabase(): Promise<IDBDatabase> {
  if (connection) return connection;
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('route-studio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        connection = undefined;
      };
      db.onclose = () => {
        connection = undefined;
      };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  }).catch(() => {
    connection = undefined;
    throw new RouteFileError('draft-storage');
  });
  return connection;
}

async function draftRequest(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest) {
  const db = await openDatabase();
  try {
    return await new Promise<unknown>((resolve, reject) => {
      const transaction = db.transaction('drafts', mode);
      const request = run(transaction.objectStore('drafts'));
      transaction.onabort = () => reject(transaction.error);
      // Wait for commit. A successful put request alone does not guarantee a durable write.
      transaction.oncomplete = () => resolve(request.result);
    });
  } catch {
    throw new RouteFileError('draft-storage');
  }
}

export async function saveDraft(doc: RouteDocument): Promise<void> {
  const text = saveProject(doc);
  await draftRequest('readwrite', (store) => store.put(text, 'current'));
}

export async function loadDraft(): Promise<RouteDocument | null> {
  const text = await draftRequest('readonly', (store) => store.get('current'));
  if (text === undefined) return null;
  if (typeof text !== 'string') throw new RouteFileError('invalid-project');
  return loadProject(text);
}

import type { RouteDocument } from '../../domain/model';
import { RouteFileError } from '../../files/errors';
import { loadProject, saveProject } from '../../files/project';

let connection: Promise<IDBDatabase> | undefined;

export interface Draft {
  doc: RouteDocument;
  backedUp: boolean;
}

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

export async function saveDraft({ doc, backedUp }: Draft): Promise<void> {
  const project = saveProject(doc);
  await draftRequest('readwrite', (store) => store.put({ project, backedUp }, 'current'));
}

export async function loadDraft(): Promise<Draft | null> {
  const stored = await draftRequest('readonly', (store) => store.get('current'));
  if (stored === undefined) return null;
  // Legacy drafts have no record of an independently saved project.
  if (typeof stored === 'string') return { doc: loadProject(stored), backedUp: false };
  if (
    !stored ||
    typeof stored !== 'object' ||
    !('project' in stored) ||
    typeof stored.project !== 'string' ||
    !('backedUp' in stored) ||
    typeof stored.backedUp !== 'boolean'
  )
    throw new RouteFileError('invalid-project');
  return { doc: loadProject(stored.project), backedUp: stored.backedUp };
}

import type { Dataset, DatasetMeta } from '../types';

const PREFIX = 'datadesk:';

export const fullKey = (key: string) => PREFIX + key;
export const datasetKey = (id: string) => `dataset:${id}`;
const indexKey = (userId: string) => `index:${userId}`;

export class StorageFullError extends Error {}

function isQuotaError(e: unknown) {
  return (
    e instanceof DOMException &&
    (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22)
  );
}

export function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(fullKey(key));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(fullKey(key), JSON.stringify(value));
  } catch (e) {
    if (isQuotaError(e)) {
      throw new StorageFullError(
        'Browser storage is full. Delete an older dataset or upload a smaller file (localStorage holds roughly 5 MB).',
      );
    }
    throw e;
  }
}

export function removeKey(key: string) {
  try {
    localStorage.removeItem(fullKey(key));
  } catch {
    /* ignore */
  }
}

function toMeta(ds: Dataset): DatasetMeta {
  return {
    id: ds.id,
    ownerId: ds.ownerId,
    name: ds.name,
    fileName: ds.fileName,
    createdAt: ds.createdAt,
    updatedAt: ds.updatedAt,
    rowCount: ds.rows.length,
    columnCount: ds.columns.length,
  };
}

export function listDatasets(userId: string): DatasetMeta[] {
  return readJSON<DatasetMeta[]>(indexKey(userId), []).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function loadDataset(id: string): Dataset | null {
  return readJSON<Dataset | null>(datasetKey(id), null);
}

export function saveDataset(ds: Dataset) {
  const full: Dataset = { ...ds, rowCount: ds.rows.length, columnCount: ds.columns.length };
  writeJSON(datasetKey(ds.id), full);
  const index = readJSON<DatasetMeta[]>(indexKey(ds.ownerId), []).filter((m) => m.id !== ds.id);
  index.push(toMeta(full));
  writeJSON(indexKey(ds.ownerId), index);
}

export function deleteDataset(userId: string, id: string) {
  removeKey(datasetKey(id));
  const index = readJSON<DatasetMeta[]>(indexKey(userId), []).filter((m) => m.id !== id);
  writeJSON(indexKey(userId), index);
}

/** Approximate localStorage usage, in characters (browsers cap at ~5M per origin). */
export function storageUsage() {
  let chars = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) chars += k.length + (localStorage.getItem(k)?.length ?? 0);
    }
  } catch {
    /* ignore */
  }
  return { used: chars, quota: 5_000_000 };
}

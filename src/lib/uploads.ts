import type { UploadDetail, UploadIssue, UploadList, UploadRow, UploadStatusFilter, UploadSummary } from '@datadesk/shared/api';
import type { UploadRequestInput } from '@datadesk/shared/upload';
import { api } from './api';

export type { UploadDetail, UploadIssue, UploadList, UploadRow, UploadStatusFilter, UploadSummary };

/** Sends the file plus its mapping/columns. The server stores it and queues validation. */
export function createUpload(meta: UploadRequestInput, file: File): Promise<UploadSummary> {
  const form = new FormData();
  form.append('meta', JSON.stringify(meta));
  form.append('file', file, file.name);
  return api<{ upload: UploadSummary }>('/uploads', { method: 'POST', body: form }).then((r) => r.upload);
}

export const getUpload = (id: string) => api<{ upload: UploadDetail }>(`/uploads/${id}`).then((r) => r.upload);

export function listIssues(id: string, f: { severity?: 'error' | 'warning'; column?: string; offset?: number; limit?: number }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') q.set(k, String(v));
  return api<{ issues: UploadIssue[]; total: number }>(`/uploads/${id}/issues?${q}`);
}

/** Download links (plain GETs; the session cookie authenticates them). */
export const downloads = (id: string) => ({
  templateFormat: `/api/uploads/${id}/export.csv`,
  errorsMarked: `/api/uploads/${id}/export.csv?errors=1`,
  errorReport: `/api/uploads/${id}/errors.csv`,
  original: `/api/uploads/${id}/original`,
});

export const FINISHED = new Set<UploadSummary['status']>(['passed', 'passed_with_warnings', 'failed_validation', 'error']);

export const STATUS_LABEL: Record<UploadSummary['status'], string> = {
  queued: 'Queued',
  validating: 'Validating…',
  passed: 'Passed',
  passed_with_warnings: 'Passed with warnings',
  failed_validation: 'Failed validation',
  error: "Couldn't read file",
};

export function listUploads(f: { status?: UploadStatusFilter; template?: string; q?: string }) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) if (v) q.set(k, v);
  return api<UploadList>(`/uploads?${q}`);
}

export const removeUpload = (id: string) => api<void>(`/uploads/${id}`, { method: 'DELETE' });

export function listRows(id: string, f: { offset: number; limit: number; onlyIssues: boolean }) {
  return api<{ rows: UploadRow[]; total: number }>(`/uploads/${id}/rows?offset=${f.offset}&limit=${f.limit}&onlyIssues=${f.onlyIssues ? 1 : 0}`);
}

export const IN_PROGRESS = new Set<UploadSummary['status']>(['queued', 'validating']);

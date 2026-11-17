/** Builders for API payloads used across the UI tests. */
import type { TemplateDetail, TemplateSummary, UploadDetail, UploadList, UploadSummary } from '@datadesk/shared/api';
import type { Session } from '../types';

export const session: Session = { userId: 'u1', name: 'Priya Shah', email: 'priya@example.com' };

export const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function templateDetail(over: Partial<TemplateDetail> = {}): TemplateDetail {
  return {
    id: ID(1),
    versionId: ID(11),
    name: 'Support tickets',
    description: 'Weekly export',
    isDefault: true,
    version: 2,
    hasHeaderRow: true,
    allowExtraColumns: true,
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-10T10:00:00Z',
    columns: [
      { key: 'ticket_id', name: 'ticket_id', type: 'integer', required: true, delimiter: null, aliases: ['Ticket #'], rules: [{ type: 'unique', params: {}, severity: 'error' }] },
      { key: 'label', name: 'label', type: 'select', required: true, delimiter: null, aliases: [], rules: [{ type: 'allowed_values', params: { values: ['bug', 'praise'], case_sensitive: false }, severity: 'error' }] },
      { key: 'confidence', name: 'confidence', type: 'number', required: false, delimiter: null, aliases: [], rules: [
        { type: 'min', params: { value: 0.6 }, severity: 'warning', message: 'Low confidence' },
        { type: 'max', params: { value: 1 }, severity: 'error' },
      ] },
    ],
    ...over,
  };
}

export function templateSummary(over: Partial<TemplateSummary> = {}): TemplateSummary {
  return {
    id: ID(1),
    name: 'Support tickets',
    description: 'Weekly export',
    isDefault: true,
    version: 2,
    columnCount: 3,
    ruleCount: 4,
    uploadCount: 2,
    columns: [
      { name: 'ticket_id', type: 'integer', required: true },
      { name: 'label', type: 'select', required: true },
      { name: 'confidence', type: 'number', required: false },
    ],
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: new Date(Date.now() - 3600_000).toISOString(),
    ...over,
  };
}

export function uploadSummary(over: Partial<UploadSummary> = {}): UploadSummary {
  return {
    id: ID(100),
    name: 'October tickets',
    status: 'failed_validation',
    statusMessage: null,
    originalFilename: 'tickets_oct.csv',
    sizeBytes: 5089,
    template: { id: ID(1), name: 'Support tickets', version: 2 },
    totalRows: 40,
    errorCount: 4,
    warningCount: 7,
    createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    validationStartedAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
    ...over,
  };
}

export function uploadDetail(over: Partial<UploadDetail> = {}): UploadDetail {
  return {
    ...uploadSummary(),
    invalidRowCount: 4,
    issuesTruncated: false,
    summary: [
      { column: 'confidence', rule: 'type', severity: 'error', count: 1 },
      { column: 'confidence', rule: 'min', severity: 'warning', count: 7 },
      { column: 'label', rule: 'allowed_values', severity: 'error', count: 3 },
    ],
    columns: [
      { key: 'ticket_id', name: 'ticket_id', type: 'integer', delimiter: null, required: true, sourceHeader: 'Ticket #' },
      { key: 'label', name: 'label', type: 'select', delimiter: null, required: true, sourceHeader: 'label' },
      { key: 'tags', name: 'tags', type: 'multiselect', delimiter: ',', required: false, sourceHeader: 'tags' },
      { key: 'confidence', name: 'confidence', type: 'number', delimiter: null, required: false, sourceHeader: 'confidence' },
    ],
    validationFinishedAt: new Date(Date.now() - 2 * 3600_000 + 1500).toISOString(),
    rowsWithIssues: 11,
    ...over,
  };
}

export function uploadList(uploads: UploadSummary[], over: Partial<UploadList> = {}): UploadList {
  const counts = { all: uploads.length, queued: 0, validating: 0, passed: 0, passed_with_warnings: 0, failed_validation: 0, error: 0 };
  for (const u of uploads) counts[u.status]++;
  return { uploads, counts, templates: [{ id: ID(1), name: 'Support tickets', archived: false }], truncated: false, ...over };
}

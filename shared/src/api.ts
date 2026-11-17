/** Response shapes of the DataDesk API, shared by the server and the web app. */
import type { TemplateColumn } from './rules';

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  version: number;
  columnCount: number;
  ruleCount: number;
  uploadCount: number;
  /** First few columns, for the template cards */
  columns: { name: string; type: TemplateColumn['type']; required: boolean }[];
  createdAt: string;
  updatedAt: string;
}

export interface TemplateDetail {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  version: number;
  versionId: string;
  hasHeaderRow: boolean;
  allowExtraColumns: boolean;
  columns: TemplateColumn[];
  createdAt: string;
  updatedAt: string;
}

export type UploadStatus = 'queued' | 'validating' | 'passed' | 'passed_with_warnings' | 'failed_validation' | 'error';

export interface UploadSummary {
  id: string;
  name: string;
  status: UploadStatus;
  statusMessage: string | null;
  originalFilename: string;
  sizeBytes: number;
  /** null = uploaded without a template */
  template: { id: string; name: string; version: number } | null;
  totalRows: number | null;
  errorCount: number;
  warningCount: number;
  createdAt: string;
  /** when a worker started checking it (for "checking for 3 s" while validating) */
  validationStartedAt: string | null;
}

/** Status filter of the listing: a single status, or both in-progress states together. */
export type UploadStatusFilter = UploadStatus | 'in_progress';

export interface UploadList {
  uploads: UploadSummary[];
  /** counts per status for the current template/search filter (ignoring the status filter), for the chips */
  counts: Record<UploadStatus, number> & { all: number };
  /** templates that appear in the user's uploads (including archived ones), for the template filter */
  templates: { id: string; name: string; archived: boolean }[];
  /** true when more uploads match than are returned (newest first) */
  truncated: boolean;
}

export interface UploadRow {
  row: number;
  data: Record<string, string | string[]>;
  issues: { column: string | null; severity: 'error' | 'warning'; message: string }[];
}

/** Upload result page: the summary plus what's needed to show and explain the issues. */
export interface UploadDetail extends UploadSummary {
  invalidRowCount: number;
  issuesTruncated: boolean;
  /** exact counts per column and rule (even when stored issues were capped) */
  summary: { column: string | null; rule: string; severity: 'error' | 'warning'; count: number }[];
  /** the columns this upload was checked against, in order (from its snapshot) */
  columns: { key: string; name: string; type: TemplateColumn['type']; delimiter: string | null; required: boolean; sourceHeader: string | null }[];
  validationFinishedAt: string | null;
  /** data rows that have at least one issue (error or warning), for the Data tab's filter */
  rowsWithIssues: number;
}

export interface UploadIssue {
  row: number | null;
  column: string | null;
  rule: string;
  severity: 'error' | 'warning';
  message: string;
  value: string | null;
}

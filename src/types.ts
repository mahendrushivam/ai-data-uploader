export type ColumnType =
  | 'text'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'date'
  | 'email'
  | 'url'
  | 'select'
  | 'multiselect';

/** Scalar cells are stored as the raw string the user typed (so invalid input is never lost);
 *  multi-value cells are stored as an array of items. */
export type CellValue = string | string[];

export interface Column {
  id: string;
  name: string;
  type: ColumnType;
  /** Separator used to split multi-value cells (multiselect only). */
  delimiter: string;
  width: number;
  required: boolean;
}

export interface Row {
  id: string;
  values: Record<string, CellValue>;
}

export interface DatasetMeta {
  id: string;
  ownerId: string;
  name: string;
  fileName: string;
  createdAt: number;
  updatedAt: number;
  rowCount: number;
  columnCount: number;
}

export interface Dataset extends DatasetMeta {
  columns: Column[];
  rows: Row[];
}

export interface User {
  id: string;
  name: string;
  email: string;
  salt: string;
  passwordHash: string;
  createdAt: number;
}

export interface Session {
  userId: string;
  name: string;
  email: string;
}

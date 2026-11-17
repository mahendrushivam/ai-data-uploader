/** Types shared by the browser app and the Node server/worker. */

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

/** The column fields that parsing and validation need. The web app's grid column extends this. */
export interface ColumnSpec {
  type: ColumnType;
  /** Separator used to split multi-value cells (multiselect only). */
  delimiter: string;
  required: boolean;
}

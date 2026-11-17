export type { CellValue, ColumnSpec, ColumnType } from '@datadesk/shared/types';

/** The signed-in user, as returned by GET /api/auth/me. */
export interface Session {
  userId: string;
  name: string;
  email: string;
}

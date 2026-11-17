import { useEffect, useState } from 'react';
import type { ColumnType } from '@datadesk/shared/types';
import { TYPE_DEFS } from '../lib/columnTypes';
import { listRows, type UploadDetail, type UploadRow } from '../lib/uploads';
import { CellView } from './CellView';

const PAGE = 50;

/** Data tab: the extracted rows (read-only), typed, with invalid cells marked and the reason on hover. */
export function DataTab({ upload }: { upload: UploadDetail }) {
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ rows: UploadRow[]; total: number } | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    listRows(upload.id, { offset, limit: PAGE, onlyIssues })
      .then(setPage)
      .catch((e) => setError(e.message));
  }, [upload.id, offset, onlyIssues]);

  const cols = upload.columns.map((c) => ({
    ...c,
    spec: { type: c.type as ColumnType, delimiter: c.delimiter ?? ',', required: c.required },
  }));

  return (
    <section className="table-card">
      <div className="row between issue-toolbar">
        <div className="row gap">
          {[false, true].map((v) => (
            <button
              key={String(v)}
              className={`fchip${onlyIssues === v ? ' on' : ''}`}
              onClick={() => {
                setOnlyIssues(v);
                setOffset(0);
              }}
            >
              {v ? 'Rows with issues' : 'All rows'}
              <span className="tcount">{v ? upload.rowsWithIssues : upload.totalRows ?? 0}</span>
            </button>
          ))}
        </div>
        <span className="muted small">🔒 Read-only. To change data, fix the file and upload it again.</span>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="data-scroll">
        <table className="preview-table data-table" data-testid="data-table">
          <thead>
            <tr>
              <th className="rn-th">#</th>
              {cols.map((c) => (
                <th key={c.key} className={c.sourceHeader === null ? 'missing' : ''} title={c.sourceHeader && c.sourceHeader !== c.name ? `From file column "${c.sourceHeader}"` : undefined}>
                  <span className={`htype t-${c.type}`}>{TYPE_DEFS[c.spec.type].icon}</span> {c.name}
                  {c.required && <span className="req">*</span>}
                  {c.sourceHeader === null && <span className="muted small"> (not in file)</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(page?.rows ?? []).map((r) => {
              const rowLevel = r.issues.filter((i) => i.column === null);
              return (
                <tr key={r.row}>
                  <td
                    className={`rn-th${rowLevel.length ? (rowLevel.some((i) => i.severity === 'error') ? ' row-error' : ' row-warning') : ''}`}
                    title={rowLevel.map((i) => i.message).join('\n') || undefined}
                  >
                    {r.row}
                  </td>
                  {cols.map((c) => {
                    const cellIssues = r.issues.filter((i) => i.column === c.key);
                    const cls = cellIssues.some((i) => i.severity === 'error') ? 'invalid' : cellIssues.length ? 'warn' : '';
                    return (
                      <td
                        key={c.key}
                        className={`${cls}${c.type === 'number' || c.type === 'integer' ? ' right' : ''}`}
                        title={cellIssues.map((i) => i.message).join('\n') || undefined}
                      >
                        <CellView value={r.data[c.key]} column={c.spec} />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="row between muted small issue-foot">
        <span>
          {upload.errorCount > 0 && (
            <>
              <span className="legend bad">◤</span> error{' '}
            </>
          )}
          {upload.warningCount > 0 && (
            <>
              <span className="legend warn">◤</span> warning{' '}
            </>
          )}
          · hover a marked cell for the reason
        </span>
        {page && page.total > 0 && (
          <span className="row gap">
            rows {offset + 1}–{Math.min(offset + PAGE, page.total)} of {page.total.toLocaleString()}
            <button className="btn sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              ‹ Prev
            </button>
            <button className="btn sm" disabled={offset + PAGE >= page.total} onClick={() => setOffset(offset + PAGE)}>
              Next ›
            </button>
          </span>
        )}
      </div>
    </section>
  );
}

import { useEffect, useRef, useState } from 'react';
import type { Session } from '../types';
import { downloads, FINISHED, getUpload, listIssues, STATUS_LABEL, type UploadDetail, type UploadIssue } from '../lib/uploads';
import { navigate } from '../router';
import { TopBar } from '../components/TopBar';
import { DataTab } from '../components/DataTab';
import { timeAgo } from '../lib/time';

const PAGE = 50;
const formatBytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const POLL_MS = 2000;

const RULE_TEXT: Record<string, string> = {
  required: 'missing required value',
  type: 'wrong type',
  min: 'below minimum',
  max: 'above maximum',
  min_length: 'too short',
  max_length: 'too long',
  regex: "doesn't match pattern",
  allowed_values: 'value not allowed',
  unique: 'duplicate',
  parse: 'unreadable CSV',
  empty_file: 'no data rows',
  too_many_rows: 'too many rows',
  missing_column: 'column not in file',
  extra_column: 'column not in template',
  duplicate_header: 'duplicate header',
  row_length: 'wrong number of cells',
};

/** Result of one upload: live status while it's validated, then counts, issues and downloads. */
export function UploadResultPage({ id, session, onLogout }: { id: string; session: Session; onLogout: () => void }) {
  const [upload, setUpload] = useState<UploadDetail | null>(null);
  const [error, setError] = useState('');
  const [severity, setSeverity] = useState<'' | 'error' | 'warning'>('');
  const [column, setColumn] = useState('');
  const [offset, setOffset] = useState(0);
  const [issues, setIssues] = useState<{ issues: UploadIssue[]; total: number } | null>(null);
  const [tab, setTab] = useState<'issues' | 'data' | null>(null);
  const timer = useRef<number>();

  // Poll every 2 s until validation has finished.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const u = await getUpload(id);
        if (!alive) return;
        setUpload(u);
        if (!FINISHED.has(u.status)) timer.current = window.setTimeout(load, POLL_MS);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    return () => {
      alive = false;
      window.clearTimeout(timer.current);
    };
  }, [id]);

  const finishedWithRows = upload && FINISHED.has(upload.status) && upload.status !== 'error';
  useEffect(() => {
    if (!finishedWithRows) return;
    listIssues(id, { severity: severity || undefined, column: column || undefined, offset, limit: PAGE })
      .then(setIssues)
      .catch((e) => setError(e.message));
  }, [id, finishedWithRows, severity, column, offset]);

  if (error) {
    return (
      <Shell session={session} onLogout={onLogout}>
        <div className="not-found" data-testid="not-found">
          <div className="empty-icon">⌕</div>
          <h2>{error}</h2>
          <p className="muted">It may have been removed, or it belongs to another account.</p>
          <a className="btn primary" href="#/">
            ← Back to My uploads
          </a>
        </div>
      </Shell>
    );
  }
  if (!upload) return <Shell session={session} onLogout={onLogout}><p className="muted">Loading…</p></Shell>;

  const dl = downloads(upload.id);
  // Errors need attention, so a failed upload opens on Issues; otherwise (passed, even with warnings,
  // which don't block anything) the data is what the user came for (mockup 11).
  const currentTab = tab ?? (upload.errorCount > 0 ? 'issues' : 'data');
  const colName = new Map(upload.columns.map((c) => [c.key, c.name]));
  const reupload = () => navigate(upload.template ? `/upload/${upload.template.id}` : '/upload');
  const seconds =
    upload.validationStartedAt && upload.validationFinishedAt
      ? Math.max(0.1, (Date.parse(upload.validationFinishedAt) - Date.parse(upload.validationStartedAt)) / 1000)
      : null;
  const fileLevel = upload.summary.filter((s) => s.column === null);
  const byColumn = upload.columns
    .map((c) => ({ ...c, items: upload.summary.filter((s) => s.column === c.key) }))
    .filter((c) => c.items.length);
  const errorsIn = (items: UploadDetail['summary']) => items.filter((i) => i.severity === 'error').reduce((n, i) => n + i.count, 0);
  const warningsIn = (items: UploadDetail['summary']) => items.filter((i) => i.severity === 'warning').reduce((n, i) => n + i.count, 0);

  return (
    <Shell session={session} onLogout={onLogout}>
      <a className="muted small back-link" href="#/">
        ← My uploads
      </a>
      <div className="row between wrap gap">
        <div className="row gap">
          <h1>{upload.name}</h1>
          <span className={`status-badge st-${upload.status}`} data-testid="upload-status">
            {(upload.status === 'queued' || upload.status === 'validating') && <span className="spin" />}
            {STATUS_LABEL[upload.status]}
          </span>
        </div>
        <div className="row gap">
          {finishedWithRows && (
            <a className={`btn${upload.status === 'failed_validation' ? '' : ' primary'}`} href={dl.templateFormat} download>
              ↓ Download in template format
            </a>
          )}
          <a className="btn" href={dl.original} download>
            ↓ Original
          </a>
        </div>
      </div>
      <p className="muted small">
        {upload.originalFilename} · {formatBytes(upload.sizeBytes)} ·{' '}
        {upload.template ? (
          <>
            {upload.template.name} <strong>v{upload.template.version}</strong>
          </>
        ) : (
          'No template'
        )}{' '}
        · uploaded {timeAgo(Date.parse(upload.createdAt))}
        {seconds !== null && FINISHED.has(upload.status) && ` · checked in ${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`}
      </p>

      {!FINISHED.has(upload.status) && (
        <div className="card-box mt">
          <div className="timeline">
            <div className="tl done">✓ Uploaded</div>
            <div className={`tl ${upload.status === 'validating' ? 'active' : ''}`}>
              {upload.status === 'validating' ? <span className="spin" /> : '○'} Checking every row against{' '}
              {upload.template ? 'the template' : 'your columns and rules'}
            </div>
            <div className="tl muted">○ Results</div>
          </div>
          <p className="muted small">This usually takes a few seconds. You can leave this page: the status updates on its own.</p>
        </div>
      )}

      {upload.status === 'error' && (
        <div className="card-box error-box mt" data-testid="error-box">
          <strong>We couldn't read this file, so no rows were checked</strong>
          <p>{upload.statusMessage}</p>
          <button className="btn primary" onClick={reupload}>
            ⇪ Upload a new file
          </button>
        </div>
      )}

      {finishedWithRows && (
        <>
          {upload.status === 'failed_validation' ? (
            <div className="fix-banner mt" data-testid="fix-banner">
              <strong>Fix and upload again</strong>
              <span className="stepno">1</span>
              <a className="btn sm primary" href={dl.errorsMarked} download>
                ↓ File with errors marked
              </a>
              <span className="muted small">or</span>
              <a className="btn sm" href={dl.errorReport} download>
                ↓ Error report
              </a>
              <span className="muted">→</span>
              <span className="stepno">2</span> Fix the flagged cells in Excel or Sheets <span className="muted">→</span>
              <span className="stepno">3</span>
              <button className="btn sm outline" onClick={reupload}>
                ⇪ Upload corrected file
              </button>
              <div className="muted small full">
                The corrected file becomes a <strong>new upload</strong> (with the same template preselected). This one stays in your list.
                The "errors marked" file can be uploaded again as-is: its <code>__errors</code> column is ignored.
              </div>
            </div>
          ) : (
            <div className="alert ok mt">
              <strong>{upload.status === 'passed' ? 'All rows passed.' : 'Passed: no errors, only warnings.'}</strong> Download the file in
              template format: the template's columns and names, with dates, booleans and numbers normalised.
              {upload.warningCount > 0 && (
                <>
                  {' '}
                  <a href={dl.errorReport} download>
                    Download the warnings report
                  </a>
                  .
                </>
              )}
            </div>
          )}

          <div className="kpis mt">
            <div className="kpi">
              <span>Rows</span>
              <strong>{(upload.totalRows ?? 0).toLocaleString()}</strong>
            </div>
            <div className={`kpi${upload.invalidRowCount ? ' red' : ''}`}>
              <span>Rows with errors</span>
              <strong>{upload.invalidRowCount.toLocaleString()}</strong>
            </div>
            <div className={`kpi${upload.errorCount ? ' red' : ''}`}>
              <span>Errors</span>
              <strong data-testid="error-count">{upload.errorCount.toLocaleString()}</strong>
            </div>
            <div className={`kpi${upload.warningCount ? ' amber' : ''}`}>
              <span>Warnings</span>
              <strong data-testid="warning-count">{upload.warningCount.toLocaleString()}</strong>
            </div>
          </div>

          <div className="tabs mt" role="tablist">
            <button role="tab" aria-selected={currentTab === 'issues'} className={currentTab === 'issues' ? 'on' : ''} onClick={() => setTab('issues')}>
              Issues <span className="tcount">{upload.errorCount + upload.warningCount}</span>
            </button>
            <button role="tab" aria-selected={currentTab === 'data'} className={currentTab === 'data' ? 'on' : ''} onClick={() => setTab('data')}>
              Data <span className="tcount">{(upload.totalRows ?? 0).toLocaleString()}</span>
            </button>
          </div>

          {currentTab === 'data' && <DataTab upload={upload} />}

          {currentTab === 'issues' && upload.summary.length === 0 && <p className="muted">No issues: every row passed every check.</p>}

          {currentTab === 'issues' && upload.summary.length > 0 && (
            <div className="result-layout">
              <aside className="card-box">
                <h3>Issues by column</h3>
                {fileLevel.length > 0 && (
                  <div className="by-col">
                    <div className="row between">
                      <strong>File &amp; row structure</strong>
                      <span>
                        {errorsIn(fileLevel) > 0 && <span className="tag-bad">{errorsIn(fileLevel)}</span>}{' '}
                        {warningsIn(fileLevel) > 0 && <span className="tag-warn">{warningsIn(fileLevel)}</span>}
                      </span>
                    </div>
                    <div className="muted small">{fileLevel.map((s) => `${RULE_TEXT[s.rule] ?? s.rule} (${s.count})`).join(' · ')}</div>
                  </div>
                )}
                {byColumn.map((c) => (
                  <button
                    key={c.key}
                    className={`by-col${column === c.key ? ' on' : ''}`}
                    onClick={() => {
                      setColumn(column === c.key ? '' : c.key);
                      setOffset(0);
                    }}
                  >
                    <div className="row between">
                      <strong>{c.name}</strong>
                      <span>
                        {errorsIn(c.items) > 0 && <span className="tag-bad">{errorsIn(c.items)}</span>}{' '}
                        {warningsIn(c.items) > 0 && <span className="tag-warn">{warningsIn(c.items)}</span>}
                      </span>
                    </div>
                    <div className="muted small">
                      {c.items.map((s) => `${RULE_TEXT[s.rule] ?? s.rule}${s.severity === 'warning' ? ', warning' : ''} (${s.count})`).join(' · ')}
                    </div>
                  </button>
                ))}
                {upload.issuesTruncated && (
                  <p className="muted small">The counts are exact; only the first 100,000 issues are listed and downloadable.</p>
                )}
              </aside>

              <section className="table-card">
                <div className="row between issue-toolbar">
                  <div className="row gap">
                    {(['', 'error', 'warning'] as const).map((s) => (
                      <button
                        key={s || 'all'}
                        className={`fchip${severity === s ? ' on' : ''}`}
                        onClick={() => {
                          setSeverity(s);
                          setOffset(0);
                        }}
                      >
                        {s === '' ? 'All' : s === 'error' ? 'Errors' : 'Warnings'}{' '}
                        <span className="tcount">{s === '' ? upload.errorCount + upload.warningCount : s === 'error' ? upload.errorCount : upload.warningCount}</span>
                      </button>
                    ))}
                  </div>
                  <select
                    aria-label="Filter by column"
                    value={column}
                    onChange={(e) => {
                      setColumn(e.target.value);
                      setOffset(0);
                    }}
                  >
                    <option value="">All columns</option>
                    {byColumn.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </div>
                <table className="list-table issue-table" data-testid="issue-table">
                  <thead>
                    <tr>
                      <th className="num">Row</th>
                      <th>Column</th>
                      <th>Value in file</th>
                      <th>Problem</th>
                      <th>Severity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(issues?.issues ?? []).map((i, k) => (
                      <tr key={k}>
                        <td className="num">{i.row ?? '–'}</td>
                        <td>{i.column ? colName.get(i.column) ?? i.column : <span className="muted">{i.row === null ? 'whole file' : 'whole row'}</span>}</td>
                        <td className="mono">{i.value}</td>
                        <td>{i.message}</td>
                        <td>
                          <span className={i.severity === 'error' ? 'tag-bad' : 'tag-warn'}>{i.severity === 'error' ? 'Error' : 'Warning'}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="row between muted small issue-foot">
                  <span>Row numbers count data rows after the header, as in the downloads.</span>
                  {issues && issues.total > 0 && (
                    <span className="row gap">
                      {offset + 1}–{Math.min(offset + PAGE, issues.total)} of {issues.total.toLocaleString()}
                      <button className="btn sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                        ‹ Prev
                      </button>
                      <button className="btn sm" disabled={offset + PAGE >= issues.total} onClick={() => setOffset(offset + PAGE)}>
                        Next ›
                      </button>
                    </span>
                  )}
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </Shell>
  );
}

function Shell({ session, onLogout, children }: { session: Session; onLogout: () => void; children: React.ReactNode }) {
  return (
    <div className="page">
      <TopBar session={session} onLogout={onLogout} />
      <main className="container result-page">{children}</main>
    </div>
  );
}

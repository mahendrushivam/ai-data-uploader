import { useEffect, useRef, useState } from 'react';
import type { Session } from '../types';
import {
  downloads,
  IN_PROGRESS,
  listUploads,
  removeUpload,
  STATUS_LABEL,
  type UploadList,
  type UploadStatusFilter,
  type UploadSummary,
} from '../lib/uploads';
import { elapsed, timeAgo } from '../lib/time';
import { navigate } from '../router';
import { TopBar } from '../components/TopBar';
import { useConfirm } from '../components/ConfirmDialog';

const POLL_MS = 2000;

const CHIPS: { value: '' | UploadStatusFilter; label: string; count: (c: UploadList['counts']) => number }[] = [
  { value: '', label: 'All', count: (c) => c.all },
  { value: 'in_progress', label: 'In progress', count: (c) => c.queued + c.validating },
  { value: 'failed_validation', label: 'Failed validation', count: (c) => c.failed_validation },
  { value: 'passed_with_warnings', label: 'Passed with warnings', count: (c) => c.passed_with_warnings },
  { value: 'passed', label: 'Passed', count: (c) => c.passed },
  { value: 'error', label: "Couldn't read", count: (c) => c.error },
];

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

/** Home page: every upload with its status, filterable; in-progress rows update live. */
export function UploadsPage({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [status, setStatus] = useState<'' | UploadStatusFilter>('');
  const [template, setTemplate] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState(''); // debounced search
  const [data, setData] = useState<UploadList | null>(null);
  const [error, setError] = useState('');
  const [, tick] = useState(0); // re-render each second so "waiting 12 s" counts up
  const [reloadKey, setReloadKey] = useState(0);
  const { confirm, dialog } = useConfirm();
  const timer = useRef<number>();

  useEffect(() => {
    const t = window.setTimeout(() => setQuery(search), 300);
    return () => window.clearTimeout(t);
  }, [search]);

  // Load, and keep polling while anything is queued or being validated.
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const d = await listUploads({ status: status || undefined, template: template || undefined, q: query || undefined });
        if (!alive) return;
        setData(d);
        setError('');
        if (d.counts.queued + d.counts.validating > 0) timer.current = window.setTimeout(load, POLL_MS);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    return () => {
      alive = false;
      window.clearTimeout(timer.current);
    };
  }, [status, template, query, reloadKey]);

  const inProgress = data ? data.counts.queued + data.counts.validating : 0;
  useEffect(() => {
    if (!inProgress) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [inProgress]);

  const remove = async (u: UploadSummary) => {
    const ok = await confirm({
      title: 'Remove this upload?',
      message: (
        <>
          <strong>{u.name}</strong> ({u.originalFilename}) will be removed from your list, along with its results and downloads.
          This can't be undone from the app.
        </>
      ),
      confirmLabel: 'Remove upload',
      danger: true,
    });
    if (!ok) return;
    try {
      await removeUpload(u.id);
      setReloadKey((k) => k + 1); // reload the list and the counts
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const filtered = !!(status || template || query);

  return (
    <div className="page">
      <TopBar session={session} onLogout={onLogout} />
      {dialog}
      <main className="container uploads-page">
        <div className="page-head">
          <div>
            <h1>My uploads</h1>
            <p className="muted">Every file you've uploaded and how its validation went.</p>
          </div>
          <button className="btn primary" onClick={() => navigate('/upload')}>
            ⇪ New upload
          </button>
        </div>

        {inProgress > 0 && (
          <div className="progress-banner" data-testid="progress-banner">
            <span className="spin" />
            <span>
              <strong>
                {inProgress} upload{inProgress === 1 ? ' is' : 's are'} being checked
              </strong>{' '}
              ({data!.counts.queued} waiting, {data!.counts.validating} in progress). This list updates on its own.
            </span>
            {status !== 'in_progress' && (
              <button className="btn sm" onClick={() => setStatus('in_progress')}>
                Show only these
              </button>
            )}
          </div>
        )}

        <div className="list-filters">
          <div className="chips-row" role="group" aria-label="Filter by status">
            {CHIPS.map((c) => (
              <button
                key={c.value || 'all'}
                className={`fchip${status === c.value ? ' on' : ''}`}
                aria-pressed={status === c.value}
                onClick={() => setStatus(c.value)}
              >
                {c.label}
                <span className="tcount">{data ? c.count(data.counts) : '–'}</span>
              </button>
            ))}
          </div>
          <div className="row gap">
            <select aria-label="Filter by template" value={template} onChange={(e) => setTemplate(e.target.value)}>
              <option value="">All templates</option>
              <option value="none">No template</option>
              {(data?.templates ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                  {t.archived ? ' (deleted)' : ''}
                </option>
              ))}
            </select>
            <input aria-label="Search uploads" type="search" placeholder="⌕ Search by name or file" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>

        {error && <div className="alert error mb">{error}</div>}
        {!data && !error && <p className="muted">Loading…</p>}

        {data && data.uploads.length === 0 && !filtered && (
          <div className="empty-card" onClick={() => navigate('/upload')}>
            <div className="empty-icon">⇪</div>
            <h3>No uploads yet</h3>
            <p className="muted">Upload a CSV file to check it against a template or your own rules.</p>
          </div>
        )}
        {data && data.uploads.length === 0 && filtered && (
          <div className="table-card empty-filter">
            No uploads match these filters.{' '}
            <button
              className="linklike"
              onClick={() => {
                setStatus('');
                setTemplate('');
                setSearch('');
              }}
            >
              Clear filters
            </button>
          </div>
        )}

        {data && data.uploads.length > 0 && (
          <div className="table-card">
            <table className="list-table uploads-table" data-testid="uploads-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Template</th>
                  <th>Status</th>
                  <th className="num">Rows</th>
                  <th>Issues</th>
                  <th>Uploaded</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.uploads.map((u) => {
                  const dl = downloads(u.id);
                  return (
                    <tr key={u.id} data-testid="upload-row" data-status={u.status} className={IN_PROGRESS.has(u.status) ? 'in-progress' : ''}>
                      <td>
                        <a className="strong row-link" href={`#/uploads/${u.id}`}>
                          {u.name}
                        </a>
                        <div className="muted small">
                          {u.originalFilename} · {size(u.sizeBytes)}
                        </div>
                      </td>
                      <td>
                        {u.template ? (
                          <span>
                            {u.template.name} <span className="muted">v{u.template.version}</span>
                          </span>
                        ) : (
                          <span className="chip-outline">No template</span>
                        )}
                      </td>
                      <td>
                        <span className={`status-badge st-${u.status}`}>
                          {IN_PROGRESS.has(u.status) && <span className="spin" />}
                          {STATUS_LABEL[u.status]}
                        </span>
                        {u.status === 'queued' && <div className="muted small">waiting {elapsed(Date.parse(u.createdAt))}</div>}
                        {u.status === 'validating' && u.validationStartedAt && (
                          <div className="muted small">checking for {elapsed(Date.parse(u.validationStartedAt))}</div>
                        )}
                        {u.status === 'error' && u.statusMessage && (
                          <div className="muted small ellipsis" title={u.statusMessage}>
                            {u.statusMessage}
                          </div>
                        )}
                      </td>
                      <td className="num">{u.totalRows === null ? <span className="muted">–</span> : u.totalRows.toLocaleString()}</td>
                      <td>
                        {u.totalRows === null ? (
                          <span className="muted">–</span>
                        ) : u.errorCount + u.warningCount === 0 ? (
                          <span className="muted">None</span>
                        ) : (
                          <span className="row gap">
                            {u.errorCount > 0 && <span className="tag-bad">{u.errorCount.toLocaleString()} error{u.errorCount === 1 ? '' : 's'}</span>}
                            {u.warningCount > 0 && <span className="tag-warn">{u.warningCount.toLocaleString()} warning{u.warningCount === 1 ? '' : 's'}</span>}
                          </span>
                        )}
                      </td>
                      <td className="muted nowrap" title={new Date(u.createdAt).toLocaleString()}>
                        {timeAgo(Date.parse(u.createdAt))}
                      </td>
                      <td className="actions">
                        {u.status === 'failed_validation' ? (
                          <>
                            <button className="btn sm outline" onClick={() => navigate(`/uploads/${u.id}`)}>
                              See errors
                            </button>
                            <a className="btn sm" href={dl.errorReport} download title="Download the error report">
                              ↓ Errors
                            </a>
                          </>
                        ) : u.status === 'passed' || u.status === 'passed_with_warnings' ? (
                          <>
                            <button className="btn sm" onClick={() => navigate(`/uploads/${u.id}`)}>
                              View
                            </button>
                            <a className="btn sm" href={dl.templateFormat} download title="Download in template format">
                              ↓ CSV
                            </a>
                          </>
                        ) : (
                          <button className="btn sm" onClick={() => navigate(`/uploads/${u.id}`)}>
                            {u.status === 'error' ? 'Details' : 'View'}
                          </button>
                        )}
                        <button className="btn sm ghost" aria-label={`Remove ${u.name}`} title="Remove from list" onClick={() => remove(u)}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {data && (
          <div className="row between muted small mt-s">
            <span>
              Showing {data.uploads.length}
              {data.truncated ? ` newest (of more than ${data.uploads.length})` : ''} upload{data.uploads.length === 1 ? '' : 's'}
            </span>
            {inProgress > 0 && <span>Updating every 2 seconds while uploads are being checked</span>}
          </div>
        )}
      </main>
    </div>
  );
}

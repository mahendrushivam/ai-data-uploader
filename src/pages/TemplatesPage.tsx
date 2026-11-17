import { useEffect, useState } from 'react';
import type { Session } from '../types';
import { TYPE_DEFS } from '../lib/columnTypes';
import { deleteTemplate, listTemplates, setDefaultTemplate, type TemplateSummary } from '../lib/templates';
import { navigate } from '../router';
import { TopBar } from '../components/TopBar';
import { useConfirm } from '../components/ConfirmDialog';
import { timeAgo } from '../lib/time';

export function TemplatesPage({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const load = () =>
    listTemplates()
      .then(setTemplates)
      .catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, []);

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    setError('');
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="page">
      <TopBar session={session} onLogout={onLogout} />
      {dialog}
      <main className="container">
        <div className="page-head">
          <div>
            <h1>Templates</h1>
            <p className="muted">Reusable columns and rules for checking CSV files. Only you can see your templates.</p>
          </div>
          <button className="btn primary" onClick={() => navigate('/templates/new')}>
            + New template
          </button>
        </div>

        {error && <div className="alert error mb">{error}</div>}
        {templates === null && !error && <p className="muted">Loading templates…</p>}

        {templates && (
          <div className="tpl-grid">
            {templates.map((t) => (
              <article key={t.id} className="tpl-card" data-testid="template-card">
                <h3>
                  {t.name}
                  {t.isDefault && <span className="badge default">★ Default</span>}
                  <span className="badge version">v{t.version}</span>
                </h3>
                <div className="desc">{t.description}</div>
                <div className="row gap wrap">
                  {t.columns.slice(0, 4).map((c, i) => (
                    <span key={i} className="col-chip">
                      <span className={`htype t-${c.type}`}>{TYPE_DEFS[c.type].icon}</span>
                      {c.name}
                      {c.required && <span className="req">*</span>}
                    </span>
                  ))}
                  {t.columnCount > 4 && <span className="col-chip muted">+{t.columnCount - 4} more</span>}
                </div>
                <div className="muted small">
                  {t.columnCount} column{t.columnCount === 1 ? '' : 's'} · {t.ruleCount} rule{t.ruleCount === 1 ? '' : 's'} ·{' '}
                  {t.uploadCount} upload{t.uploadCount === 1 ? '' : 's'} · edited {timeAgo(Date.parse(t.updatedAt))}
                </div>
                <div className="actions">
                  <button className="btn sm primary" onClick={() => navigate(`/upload/${t.id}`)}>
                    Use for upload
                  </button>
                  <button className="btn sm" onClick={() => navigate(`/templates/${t.id}`)}>
                    Edit
                  </button>
                  <button
                    className="btn sm"
                    disabled={busyId === t.id}
                    title={t.isDefault ? 'Stop preselecting this template for new uploads' : 'Preselect this template for new uploads'}
                    onClick={() => act(t.id, () => setDefaultTemplate(t.id, !t.isDefault))}
                  >
                    {t.isDefault ? '☆ Remove default' : '★ Set as default'}
                  </button>
                  <button
                    className="btn sm danger"
                    disabled={busyId === t.id}
                    onClick={async () => {
                      const ok = await confirm({
                        title: 'Delete this template?',
                        message: (
                          <>
                            <strong>{t.name}</strong> will no longer be available for new uploads
                            {t.isDefault ? ' and will stop being your default' : ''}. The {t.uploadCount} upload
                            {t.uploadCount === 1 ? '' : 's'} already checked with it keep their results.
                          </>
                        ),
                        confirmLabel: 'Delete template',
                        danger: true,
                      });
                      if (ok) act(t.id, () => deleteTemplate(t.id));
                    }}
                  >
                    Delete
                  </button>
                </div>
              </article>
            ))}
            <button className="tpl-card new-card" onClick={() => navigate('/templates/new')}>
              <div style={{ fontSize: 26, color: 'var(--green)' }}>＋</div>
              <strong>New template</strong>
              <span className="muted small">Define columns, types and rules once; reuse them for every upload.</span>
            </button>
          </div>
        )}
      </main>
    </div>
  );
}

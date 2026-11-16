import { useEffect, useState } from 'react';
import type { Session } from '../types';
import { deleteDataset, listDatasets, loadDataset, storageUsage } from '../lib/storage';
import { downloadText, toCsv } from '../lib/csv';
import { navigate } from '../router';
import { TopBar } from '../components/TopBar';

export function timeAgo(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  return new Date(ts).toLocaleDateString();
}

export function DashboardPage({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [items, setItems] = useState(() => listDatasets(session.userId));
  const [usage, setUsage] = useState(storageUsage);

  const refresh = () => {
    setItems(listDatasets(session.userId));
    setUsage(storageUsage());
  };

  useEffect(() => {
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }); // re-bind each render so refresh sees the current session

  const pct = Math.min(100, (usage.used / usage.quota) * 100);

  return (
    <div className="page">
      <TopBar session={session} onLogout={onLogout} />
      <main className="container">
        <div className="page-head">
          <div>
            <h1>Your datasets</h1>
            <p className="muted">Upload a CSV, map its columns, then review and edit it in the grid.</p>
          </div>
          <div className="row gap">
            <button className="btn" onClick={() => navigate('/upload/sample')}>
              Try sample data
            </button>
            <button className="btn primary" onClick={() => navigate('/upload')}>
              ⇪ Upload CSV
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="empty-card" onClick={() => navigate('/upload')}>
            <div className="empty-icon">⇪</div>
            <h3>No datasets yet</h3>
            <p className="muted">Upload a CSV file to get started — or try the sample ML review dataset.</p>
          </div>
        ) : (
          <div className="table-card">
            <table className="list-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="num">Rows</th>
                  <th className="num">Columns</th>
                  <th>Source file</th>
                  <th>Last edited</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map((d) => (
                  <tr key={d.id} onClick={() => navigate(`/sheet/${d.id}`)}>
                    <td className="strong">
                      <span className="file-icon">▦</span>
                      {d.name}
                    </td>
                    <td className="num">{d.rowCount.toLocaleString()}</td>
                    <td className="num">{d.columnCount}</td>
                    <td className="muted">{d.fileName}</td>
                    <td className="muted">{timeAgo(d.updatedAt)}</td>
                    <td className="actions" onClick={(e) => e.stopPropagation()}>
                      <button className="btn sm" onClick={() => navigate(`/sheet/${d.id}`)}>
                        Open
                      </button>
                      <button
                        className="btn sm"
                        onClick={() => {
                          const ds = loadDataset(d.id);
                          if (ds) downloadText(`${ds.name}.csv`, toCsv(ds.columns, ds.rows));
                        }}
                      >
                        Export
                      </button>
                      <button
                        className="btn sm danger"
                        onClick={() => {
                          if (confirm(`Delete "${d.name}"? This cannot be undone.`)) {
                            deleteDataset(session.userId, d.id);
                            refresh();
                          }
                        }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="storage-meter">
          <div className="row between">
            <span className="muted">Browser storage used (localStorage)</span>
            <span className="muted">
              {(usage.used / 1_000_000).toFixed(2)}M of ~{(usage.quota / 1_000_000).toFixed(0)}M characters
            </span>
          </div>
          <div className="meter">
            <div className={`meter-fill${pct > 80 ? ' warn' : ''}`} style={{ width: `${pct}%` }} />
          </div>
        </div>
      </main>
    </div>
  );
}

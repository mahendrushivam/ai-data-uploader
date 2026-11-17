import { useEffect, useState } from 'react';
import type { Session } from './types';
import { fetchSession, signOut } from './lib/auth';
import { navigate, useRoute } from './router';
import { LoginPage } from './pages/LoginPage';
import { UploadsPage } from './pages/UploadsPage';
import { UploadPage } from './pages/UploadPage';
import { TemplatesPage } from './pages/TemplatesPage';
import { TemplateEditorPage } from './pages/TemplateEditorPage';
import { UploadResultPage } from './pages/UploadResultPage';

export default function App() {
  // undefined = still checking the session cookie with the server
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [loadError, setLoadError] = useState('');
  const [page, arg] = useRoute();

  useEffect(() => {
    fetchSession()
      .then(setSession)
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (loadError) {
    return (
      <div className="boot">
        <div className="alert error">{loadError}</div>
        <button className="btn" onClick={() => window.location.reload()}>
          Try again
        </button>
      </div>
    );
  }
  if (session === undefined) return <div className="boot muted">Loading…</div>;

  if (!session) {
    return (
      <LoginPage
        onLogin={(s) => {
          setSession(s);
          // Read the route now, not from this render's closure: the URL may have changed while signing in,
          // and a deep link (e.g. #/templates/new) opened while signed out must be kept.
          if (!window.location.hash.replace(/^#\/?/, '')) navigate('/');
        }}
      />
    );
  }

  const logout = async () => {
    try {
      await signOut();
    } finally {
      setSession(null);
    }
  };

  if (page === 'templates' && arg === 'new') return <TemplateEditorPage key="new" session={session} onLogout={logout} />;
  if (page === 'templates' && arg) return <TemplateEditorPage key={arg} id={arg} session={session} onLogout={logout} />;
  if (page === 'templates') return <TemplatesPage session={session} onLogout={logout} />;
  if (page === 'upload') return <UploadPage key={arg ?? 'new'} session={session} onLogout={logout} arg={arg} />;
  if (page === 'uploads' && arg) return <UploadResultPage key={arg} id={arg} session={session} onLogout={logout} />;
  return <UploadsPage session={session} onLogout={logout} />;
}

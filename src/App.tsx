import { useEffect, useState } from 'react';
import type { Session } from './types';
import { getSession, signOut } from './lib/auth';
import { fullKey } from './lib/storage';
import { navigate, useRoute } from './router';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { UploadPage } from './pages/UploadPage';
import { SheetPage } from './pages/SheetPage';

export default function App() {
  const [session, setSession] = useState<Session | null>(getSession);
  const [page, arg] = useRoute();

  // Sign-in / sign-out in another tab applies here too
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === fullKey('session')) setSession(getSession());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  if (!session) {
    return (
      <LoginPage
        onLogin={(s) => {
          setSession(s);
          if (!page) navigate('/');
        }}
      />
    );
  }

  const logout = () => {
    signOut();
    setSession(null);
  };

  if (page === 'upload') return <UploadPage session={session} onLogout={logout} sample={arg === 'sample'} />;
  if (page === 'sheet' && arg) return <SheetPage key={arg} id={arg} session={session} onLogout={logout} />;
  return <DashboardPage session={session} onLogout={logout} />;
}

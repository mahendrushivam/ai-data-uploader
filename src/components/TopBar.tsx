import type { ReactNode } from 'react';
import type { Session } from '../types';
import { navigate, useRoute } from '../router';

export function Logo() {
  return (
    <span className="logo" onClick={() => navigate('/')} role="link">
      <span className="logo-mark">▦</span> DataDesk
    </span>
  );
}

export function TopBar({ session, onLogout, children }: { session: Session; onLogout: () => void; children?: ReactNode }) {
  const [page] = useRoute();
  const onTemplates = page === 'templates';
  return (
    <header className="topbar">
      <Logo />
      <nav className="nav-tabs">
        <a href="#/" className={onTemplates ? '' : 'on'}>
          Uploads
        </a>
        <a href="#/templates" className={onTemplates ? 'on' : ''}>
          Templates
        </a>
      </nav>
      <div className="topbar-center">{children}</div>
      <div className="topbar-user">
        <span className="avatar" title={session.email}>
          {session.name.slice(0, 1).toUpperCase()}
        </span>
        <span className="user-name">{session.name}</span>
        <button className="btn ghost sm" onClick={onLogout}>
          Sign out
        </button>
      </div>
    </header>
  );
}

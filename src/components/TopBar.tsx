import type { ReactNode } from 'react';
import type { Session } from '../types';
import { navigate } from '../router';

export function Logo() {
  return (
    <span className="logo" onClick={() => navigate('/')} role="link">
      <span className="logo-mark">▦</span> DataDesk
    </span>
  );
}

export function TopBar({ session, onLogout, children }: { session: Session; onLogout: () => void; children?: ReactNode }) {
  return (
    <header className="topbar">
      <Logo />
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

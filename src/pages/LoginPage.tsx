import { useState, type FormEvent } from 'react';
import type { Session } from '../types';
import { demoSignIn, signIn, signUp } from '../lib/auth';

export function LoginPage({ onLogin }: { onLogin: (s: Session) => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<Session>) => {
    setBusy(true);
    setError('');
    try {
      onLogin(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(() => (mode === 'signin' ? signIn(email, password) : signUp(name, email, password)));
  };

  return (
    <div className="auth-page">
      <div className="auth-side">
        <div className="logo lg">
          <span className="logo-mark">▦</span> DataDesk
        </div>
        <h1>Upload, map and review tabular data — like a spreadsheet.</h1>
        <ul className="auth-points">
          <li>Drop in a CSV and preview every row instantly</li>
          <li>Map columns to types: numbers, dates, emails, URLs, selects and multi-value lists</li>
          <li>Edit in an Excel-style grid with validation, undo and copy/paste</li>
        </ul>
        <div className="auth-grid-art" aria-hidden>
          {Array.from({ length: 24 }, (_, i) => (
            <span key={i} className={i % 7 === 2 ? 'on' : i % 5 === 0 ? 'mid' : ''} />
          ))}
        </div>
      </div>

      <div className="auth-main">
        <form className="auth-card" onSubmit={submit}>
          <h2>{mode === 'signin' ? 'Sign in' : 'Create your account'}</h2>
          <p className="muted">
            {mode === 'signin' ? 'Welcome back. Your datasets are stored in this browser.' : 'Takes ten seconds. Data stays in this browser.'}
          </p>

          {mode === 'signup' && (
            <label className="field">
              <span>Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus />
            </label>
          )}
          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus={mode === 'signin'}
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={mode === 'signup' ? 6 : undefined}
              required
            />
          </label>

          {error && <div className="alert error">{error}</div>}

          <button className="btn primary block" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
          <button type="button" className="btn block" disabled={busy} onClick={() => run(demoSignIn)}>
            Continue with demo account
          </button>

          <p className="auth-switch">
            {mode === 'signin' ? 'New here?' : 'Already have an account?'}{' '}
            <button
              type="button"
              className="linklike"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setError('');
              }}
            >
              {mode === 'signin' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
        </form>
      </div>
    </div>
  );
}

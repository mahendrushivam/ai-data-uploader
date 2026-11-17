import { useState, type FormEvent } from 'react';
import type { Session } from '../types';
import { signIn, signUp } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Field } from '../components/Field';

export function LoginPage({ onLogin }: { onLogin: (s: Session) => void }) {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<Session>) => {
    setBusy(true);
    setError('');
    setFieldErrors({});
    try {
      onLogin(await fn());
    } catch (e) {
      if (e instanceof ApiError && Object.keys(e.fields).length) setFieldErrors(e.fields);
      else setError(e instanceof Error ? e.message : String(e));
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
            {mode === 'signin' ? 'Welcome back.' : 'Your templates and uploads are private to you.'}
          </p>

          {mode === 'signup' && (
            <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" autoFocus error={fieldErrors.name} />
          )}
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            autoFocus={mode === 'signin'}
            required
            error={fieldErrors.email}
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            minLength={mode === 'signup' ? 8 : undefined}
            required
            error={fieldErrors.password}
            hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
          />

          {error && <div className="alert error">{error}</div>}

          <button className="btn primary block" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>

          <p className="auth-switch">
            {mode === 'signin' ? 'New here?' : 'Already have an account?'}{' '}
            <button
              type="button"
              className="linklike"
              onClick={() => {
                setMode(mode === 'signin' ? 'signup' : 'signin');
                setError('');
                setFieldErrors({});
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

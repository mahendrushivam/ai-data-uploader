import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { apiError, mockApi } from './test/mockApi';
import { uploadList } from './test/data';
import App from './App';

const user = { id: 'u1', name: 'Priya Shah', email: 'priya@example.com' };
const signedIn = (extra = {}) =>
  mockApi({
    'GET /api/auth/me': { body: { user } },
    'GET /api/uploads': { body: uploadList([]) },
    'GET /api/templates': { body: { templates: [] } },
    'POST /api/auth/logout': { status: 204 },
    ...extra,
  });
const go = (hash: string) =>
  act(async () => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });

describe('App', () => {
  it('checks the session first; signed out → sign-in page', async () => {
    mockApi({ 'GET /api/auth/me': apiError(401, 'unauthenticated', 'Please sign in.') });
    render(<App />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });

  it('signed in → My uploads; routes to templates, the builder and a new upload', async () => {
    signedIn();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'My uploads' })).toBeInTheDocument();
    await go('#/templates');
    expect(await screen.findByRole('heading', { name: 'Templates' })).toBeInTheDocument();
    await go('#/templates/new');
    expect(await screen.findByLabelText('Template name')).toBeInTheDocument();
    await go('#/upload');
    expect(await screen.findByRole('heading', { name: 'How should this file be checked?' })).toBeInTheDocument();
  });

  it('sign out returns to the sign-in page', async () => {
    const m = signedIn();
    render(<App />);
    await screen.findByRole('heading', { name: 'My uploads' });
    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
    expect(m.to('POST /api/auth/logout')).toHaveLength(1);
  });

  it('signing in from a deep link keeps the link (e.g. #/templates/new)', async () => {
    window.location.hash = '#/templates/new';
    let loggedIn = false;
    mockApi({
      'GET /api/auth/me': () => (loggedIn ? { body: { user } } : apiError(401, 'unauthenticated', 'Please sign in.')),
      'POST /api/auth/login': () => ((loggedIn = true), { body: { user } }),
    });
    render(<App />);
    await userEvent.type(await screen.findByLabelText('Email'), 'priya@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByLabelText('Template name')).toBeInTheDocument();
    expect(window.location.hash).toBe('#/templates/new');
  });

  it('signing in at the root goes to My uploads', async () => {
    mockApi({
      'GET /api/auth/me': apiError(401, 'unauthenticated', 'Please sign in.'),
      'POST /api/auth/login': { body: { user } },
      'GET /api/uploads': { body: uploadList([]) },
    });
    render(<App />);
    await userEvent.type(await screen.findByLabelText('Email'), 'priya@example.com');
    await userEvent.type(screen.getByLabelText('Password'), 'password123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'My uploads' })).toBeInTheDocument();
  });

  it('if the server is unreachable, says so and offers to try again', async () => {
    mockApi({ 'GET /api/auth/me': apiError(500, 'internal_error', 'Something went wrong. Please try again.') });
    render(<App />);
    expect(await screen.findByText('Something went wrong. Please try again.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});

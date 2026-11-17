import type { Session } from '../types';
import { api, ApiError } from './api';

/** Authentication against the DataDesk API. The session itself is an httpOnly cookie set by the server. */
interface ApiUser {
  id: string;
  name: string;
  email: string;
}

const toSession = (u: ApiUser): Session => ({ userId: u.id, name: u.name, email: u.email });

export async function signUp(name: string, email: string, password: string): Promise<Session> {
  const { user } = await api<{ user: ApiUser }>('/auth/signup', { method: 'POST', body: { name, email, password } });
  return toSession(user);
}

export async function signIn(email: string, password: string): Promise<Session> {
  const { user } = await api<{ user: ApiUser }>('/auth/login', { method: 'POST', body: { email, password } });
  return toSession(user);
}

export async function signOut(): Promise<void> {
  await api('/auth/logout', { method: 'POST' });
}

/** The current session, or null when signed out. */
export async function fetchSession(): Promise<Session | null> {
  try {
    const { user } = await api<{ user: ApiUser }>('/auth/me');
    return toSession(user);
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) return null;
    throw e;
  }
}

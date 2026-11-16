import type { Session, User } from '../types';
import { readJSON, removeKey, writeJSON } from './storage';
import { uid } from './id';

/**
 * Mock, client-side-only authentication. Passwords are salted + SHA-256 hashed so they are
 * not stored in plain text, but this is NOT real security — swap for a backend later.
 */
async function hash(text: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback for insecure contexts (e.g. plain http on a LAN IP)
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h) ^ text.charCodeAt(i);
  return (h >>> 0).toString(16);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const getUsers = () => readJSON<User[]>('users', []);

function startSession(u: User): Session {
  const s: Session = { userId: u.id, name: u.name, email: u.email };
  writeJSON('session', s);
  return s;
}

export async function signUp(name: string, email: string, password: string): Promise<Session> {
  const cleanEmail = email.trim().toLowerCase();
  if (!name.trim()) throw new Error('Please enter your name.');
  if (!EMAIL_RE.test(cleanEmail)) throw new Error('Please enter a valid email address.');
  if (password.length < 6) throw new Error('Password must be at least 6 characters.');
  const users = getUsers();
  if (users.some((u) => u.email === cleanEmail)) throw new Error('An account with this email already exists.');
  const salt = uid();
  const user: User = {
    id: uid('u_'),
    name: name.trim(),
    email: cleanEmail,
    salt,
    passwordHash: await hash(salt + password),
    createdAt: Date.now(),
  };
  writeJSON('users', [...users, user]);
  return startSession(user);
}

export async function signIn(email: string, password: string): Promise<Session> {
  const cleanEmail = email.trim().toLowerCase();
  const user = getUsers().find((u) => u.email === cleanEmail);
  if (!user || (await hash(user.salt + password)) !== user.passwordHash) {
    throw new Error('Incorrect email or password.');
  }
  return startSession(user);
}

export async function demoSignIn(): Promise<Session> {
  const email = 'demo@datadesk.local';
  const password = 'demo1234';
  if (getUsers().some((u) => u.email === email)) return signIn(email, password);
  return signUp('Demo Analyst', email, password);
}

export const getSession = () => readJSON<Session | null>('session', null);
export const signOut = () => removeKey('session');

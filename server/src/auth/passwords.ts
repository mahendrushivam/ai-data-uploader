import { hash, verify } from '@node-rs/argon2';

// argon2id (the library default) with OWASP-recommended minimums: 19 MiB memory, 2 iterations.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const hashPassword = (password: string) => hash(password, OPTIONS);

export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await verify(storedHash, password);
  } catch {
    return false; // malformed hash (e.g. the seeded demo user's "!no-login") never matches
  }
}

/**
 * When the email is unknown we still run one verification against this hash, so the response takes
 * the same time and doesn't reveal which emails have accounts.
 */
let dummyHash: Promise<string> | undefined;
export async function burnVerificationTime(password: string): Promise<void> {
  dummyHash ??= hashPassword('not-a-real-password-only-for-timing');
  await verifyPassword(await dummyHash, password);
}

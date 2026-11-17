import { spawn, type ChildProcess } from 'node:child_process';

/** Starts the real background worker (same code as production, run with tsx) and waits until it's polling. */
export async function startWorker(): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['--env-file=.env', '--import', 'tsx', 'server/src/worker.ts'], {
    env: { ...process.env, WORKER_POLL_MS: '300' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('worker did not start within 20 s')), 20_000);
    child.stdout!.on('data', (d: Buffer) => {
      if (d.toString().includes('worker started')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on('exit', (code) => reject(new Error(`worker exited with code ${code}`)));
  });
  return child;
}

export async function stopWorker(child: ChildProcess | undefined): Promise<void> {
  if (!child || child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    child.once('exit', () => resolve());
    child.kill('SIGTERM');
  });
}

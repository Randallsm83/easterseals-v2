import { test as base, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

type App = { url: string; apiURL: string; databasePath: string };
type AppProcess = { child: ChildProcess; output: () => string; error: () => Error | undefined };

const root = resolve(__dirname, '..');

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test port allocated');
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
  return address.port;
}

function startProcess(args: string[], env: NodeJS.ProcessEnv, cwd = root): AppProcess {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  let spawnError: Error | undefined;
  child.on('error', error => { spawnError = error; });
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', chunk => { output = (output + chunk.toString()).slice(-20_000); });
  }
  return { child, output: () => output, error: () => spawnError };
}

async function waitForReady(process: AppProcess, url: string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (process.error() || process.child.exitCode !== null || process.child.signalCode !== null) {
      throw new Error(`Test application exited before readiness: ${process.error() ?? ''}\n${process.output()}`);
    }
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      await response.body?.cancel();
      if (response.ok) return;
    } catch {
      // The owned child may not have bound its port yet.
    }
    await delay(100);
  }
  throw new Error(`Test application did not become ready at ${url}\n${process.output()}`);
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  const closed = once(child, 'close');
  child.kill();
  const forceKill = setTimeout(() => child.kill('SIGKILL'), 5_000);
  try {
    await closed;
  } finally {
    clearTimeout(forceKill);
  }
}

export const test = base.extend<{}, { app: App }>({
  app: [async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'easterseals-browser-'));
    const processes: AppProcess[] = [];
    try {
      const apiPort = await freePort();
      let clientPort = await freePort();
      while (clientPort === apiPort) clientPort = await freePort();
      const apiURL = `http://127.0.0.1:${apiPort}/api`;
      const url = `http://127.0.0.1:${clientPort}`;
      const databasePath = join(directory, 'easterseals.db');
      const server = startProcess(['--import', 'tsx', 'server/src/index.ts'], {
        NODE_ENV: 'test',
        PORT: String(apiPort),
        DATABASE_PATH: databasePath,
      });
      processes.push(server);
      await waitForReady(server, `${apiURL}/health`);

      const vite = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
      const client = startProcess([vite, '--host', '127.0.0.1', '--port', String(clientPort), '--strictPort'], {
        NODE_ENV: 'test',
        VITE_API_URL: apiURL,
      }, join(root, 'client'));
      processes.push(client);
      await waitForReady(client, url);
      await use({ url, apiURL, databasePath });
    } finally {
      // Direct Node children avoid npm/cmd process trees and release SQLite handles before removal.
      await Promise.all(processes.map(process => stopProcess(process.child)));
      await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  }, { scope: 'worker', timeout: 90_000 }],
  baseURL: async ({ app }, use) => use(app.url),
});

export { expect };

import { test as base } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export { expect } from '@playwright/test';

const host = '127.0.0.1';
const repository = join(__dirname, '../..');

function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer().once('error', reject);
    server.listen(0, host, () => {
      const { port } = server.address() as AddressInfo;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function waitForStartup(child: ChildProcess, port: number): Promise<void> {
  const stdout = child.stdout!.setEncoding('utf8');
  const stderr = child.stderr!.setEncoding('utf8');

  return new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    const timeout = setTimeout(() => fail('startup timed out'), 10_000);

    function done(error?: Error) {
      clearTimeout(timeout);
      child.off('error', done);
      child.off('exit', onExit);
      stdout.off('data', readOutput).resume();
      stderr.off('data', readErrors).resume();
      if (error) reject(error);
      else resolve();
    }

    function fail(reason: string) {
      done(new Error(`Isolated shop on port ${port}: ${reason}\n${errors}`));
    }

    function onExit(code: number | null, signal: NodeJS.Signals | null) {
      fail(`exited before startup (${signal ?? code})`);
    }

    function readOutput(chunk: string) {
      output += chunk;
      if (output.includes(`qa-shop запущен на порту ${port}\n`)) done();
    }

    function readErrors(chunk: string) {
      errors = (errors + chunk).slice(-4_000);
    }

    child.once('error', done);
    child.once('exit', onExit);
    stdout.on('data', readOutput);
    stderr.on('data', readErrors);
  });
}

export const test = base.extend({
  // A previous checkout must not change the inventory for another test or retry.
  baseURL: async ({}, use) => {
    const port = await availablePort();
    const child = spawn(process.execPath, ['scripts/start-shop.mjs'], {
      cwd: repository,
      env: { ...process.env, SHOP_PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const exited = new Promise<boolean>(resolve => {
      child.once('exit', () => resolve(true));
      child.once('error', () => resolve(true));
    });

    try {
      await waitForStartup(child, port);
      await use(`http://${host}:${port}`);
    } finally {
      child.kill('SIGTERM');
      if (!(await Promise.race([exited, delay(2_000, false, { ref: false })]))) {
        child.kill('SIGKILL');
        await exited;
      }
    }
  },
});

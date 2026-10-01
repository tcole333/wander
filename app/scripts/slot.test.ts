// scripts/slot.sh: the heavy-work slots and the e2e lock, which exist only on macOS outside CI.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, onTestFinished, test } from 'vitest';
import { DEV_PORT, FIXTURE_DATA_PORT, PREVIEW_PORT } from '../e2e/servers';

const SLOT_SH = fileURLToPath(new URL('./slot.sh', import.meta.url));

/** A server in a process of its own, as a killed e2e run leaves one, and its port. */
async function listener(): Promise<{ server: ChildProcess; port: string }> {
  const script =
    "const s = require('net').createServer().listen(0, '127.0.0.1', () => console.log(s.address().port))";
  const server = spawn(process.execPath, ['-e', script]);
  const port = await new Promise<string>((listening) =>
    server.stdout.once('data', (data: Buffer) => listening(data.toString().trim())),
  );
  return { server, port };
}

// A port no one listens on, which the e2e mode's tests watch in place of e2e's own: a live run's
// servers there must never be stopped by a test.
let idlePort = '';
beforeAll(async () => {
  const { server, port } = await listener();
  server.kill();
  await new Promise((exited) => server.once('exit', exited));
  idlePort = port;
});

function environment(pool: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/bin:/bin',
    HOME: pool,
    WANDER_CACHE: pool,
    WANDER_SLOT_POLL: '0.1',
    WANDER_E2E_PORTS: idlePort,
    ...extra,
  };
}

/** The wrapper's stdout and stderr, and how long it took in seconds. */
function wrapped(pool: string, args: string[], extra: Record<string, string> = {}) {
  const started = performance.now();
  const result = spawnSync('sh', [SLOT_SH, ...args], {
    env: environment(pool, extra),
    encoding: 'utf8',
  });
  return { ...result, seconds: (performance.now() - started) / 1000 };
}

/** Holds `lock` in the pool for `seconds` from another process, as another session would. */
async function holding(pool: string, lock: string, seconds: number): Promise<void> {
  const holder = spawn('/usr/bin/lockf', ['-k', join(pool, lock), 'sleep', String(seconds)]);
  await new Promise((started) => holder.once('spawn', started));
  await new Promise((settle) => setTimeout(settle, 150));
}

describe.skipIf(process.platform !== 'darwin')('slot.sh on macOS', () => {
  test('runs the command in the first free slot and names it to children', () => {
    const pool = mkdtempSync(join(tmpdir(), 'wander-slots-'));
    const run = wrapped(pool, ['heavy', 'printenv', 'WANDER_HEAVY_SLOT']);
    expect([run.status, run.stdout]).toEqual([0, '0\n']);
  });

  test('passes on the command’s exit status', () => {
    const pool = mkdtempSync(join(tmpdir(), 'wander-slots-'));
    expect(wrapped(pool, ['heavy', 'sh', '-c', 'exit 3']).status).toBe(3);
  });

  test('waits while every slot is held', async () => {
    const pool = mkdtempSync(join(tmpdir(), 'wander-slots-'));
    await holding(pool, 'heavy.0.lock', 1);
    await holding(pool, 'heavy.1.lock', 1);
    const run = wrapped(pool, ['heavy', 'printenv', 'WANDER_HEAVY_SLOT']);
    expect(run.stderr).toContain('waiting for one of 2 heavy-work slots');
    expect(run.seconds).toBeGreaterThan(0.5);
    expect(run.status).toBe(0);
  });

  test('takes no second slot inside one, nor on CI', async () => {
    const pool = mkdtempSync(join(tmpdir(), 'wander-slots-'));
    await holding(pool, 'heavy.0.lock', 2);
    await holding(pool, 'heavy.1.lock', 2);
    const nested = wrapped(pool, ['heavy', 'printenv', 'WANDER_HEAVY_SLOT'], {
      WANDER_HEAVY_SLOT: '1',
    });
    const ci = wrapped(pool, ['e2e', 'sh', '-c', 'echo "${WANDER_HEAVY_SLOT:-none}"'], {
      CI: 'true',
    });
    expect([nested.stdout, nested.seconds < 1]).toEqual(['1\n', true]);
    expect([ci.stdout, ci.seconds < 1]).toEqual(['none\n', true]);
  });

  test('e2e stops a server a killed run left on its ports before it runs the command', async () => {
    const pool = mkdtempSync(join(tmpdir(), 'wander-slots-'));
    const { server, port } = await listener();
    onTestFinished(() => void server.kill('SIGKILL'));
    const exited = new Promise((settle) => server.once('exit', settle));
    const run = wrapped(pool, ['e2e', 'echo', 'ran'], { WANDER_E2E_PORTS: port });
    expect(run.stderr).toContain(`stopping the servers a killed e2e run left on ports ${port}`);
    expect([run.status, run.stdout]).toEqual([0, 'ran\n']);
    await exited;
  });

  test('e2e waits for the e2e lock, then takes a slot', async () => {
    const pool = mkdtempSync(join(tmpdir(), 'wander-slots-'));
    await holding(pool, 'e2e.lock', 1);
    const run = wrapped(pool, ['e2e', 'printenv', 'WANDER_HEAVY_SLOT']);
    expect(run.stderr).toContain('waiting for the e2e lock');
    expect(run.seconds).toBeGreaterThan(0.5);
    expect([run.status, run.stdout]).toEqual([0, '0\n']);
  });
});

test('the e2e mode watches the ports e2e’s servers use', () => {
  const [, first = '', last = ''] =
    /WANDER_E2E_PORTS:-(\d+)-(\d+)/.exec(readFileSync(SLOT_SH, 'utf8')) ?? [];
  const watched = (port: number) => port >= Number(first) && port <= Number(last);
  expect([PREVIEW_PORT, DEV_PORT, FIXTURE_DATA_PORT].filter((port) => !watched(port))).toEqual([]);
});

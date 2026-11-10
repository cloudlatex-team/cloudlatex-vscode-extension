// Electron's Node-mode environment variable is a fixed API name.
/* eslint-disable @typescript-eslint/naming-convention */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { spawn } from 'child_process';
import { withFileLock } from '../../fileLock';

async function fixture() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cl-lock-test-'));
  return { root, lock: path.join(root, 'data.lock'), clean: () => fs.promises.rm(root, { recursive: true, force: true }) };
}

function worker(lock: string, task: string) {
  const code = `const fs = require('fs');
    const { withFileLock } = require(process.argv[2]);
    withFileLock(process.argv[1], async () => { ${task} })
      .catch(error => { console.error(error); process.exitCode = 1; });`;
  const child = spawn(process.execPath, ['-e', code, lock, require.resolve('../../fileLock')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: ['pipe', 'pipe', 'pipe']
  });
  let output = '';
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      if (output.includes('locked')) { resolve(); }
    });
    child.once('error', reject);
    child.once('exit', () => {
      if (!output.includes('locked')) { reject(new Error('Worker exited before acquiring its lock')); }
    });
  });
  // Some workers only exercise process exit and do not wait for readiness.
  void ready.catch(() => undefined);
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk.toString(); });
  const done = new Promise<void>((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(errors || `Worker exit ${code}`)));
  });
  return { child, ready, done };
}

suite('Cross-process file locks', function () {
  this.timeout(15000);

  test('another process cannot enter a live lock and can enter after release', async () => {
    const f = await fixture();
    const holder = worker(f.lock, `process.stdout.write('locked\\n');
      await new Promise(resolve => process.stdin.once('data', resolve));`);
    try {
      await holder.ready;
      let entered = false;
      await assert.rejects(withFileLock(f.lock, async () => { entered = true; }, 0), /locked by another process/);
      assert.strictEqual(entered, false);
      holder.child.stdin.end('release\n');
      await holder.done;
      await withFileLock(f.lock, async () => { entered = true; });
      assert.strictEqual(entered, true);
      assert.strictEqual(fs.existsSync(f.lock), false);
    } finally {
      if (!holder.child.stdin.writableEnded && !holder.child.stdin.destroyed) {
        holder.child.stdin.end('release\n');
      }
      await holder.done;
      await f.clean();
    }
  });

  test('concurrent processes serialize a shared read-modify-write', async () => {
    const f = await fixture();
    const value = path.join(f.root, 'value.json');
    await fs.promises.writeFile(value, '0');
    const task = `const file = ${JSON.stringify(value)};
      const value = Number(await fs.promises.readFile(file, 'utf8'));
      await new Promise(resolve => setTimeout(resolve, 100));
      await fs.promises.writeFile(file, String(value + 1));`;
    const first = worker(f.lock, task);
    const second = worker(f.lock, task);
    try {
      await Promise.all([first.done, second.done]);
      assert.strictEqual(await fs.promises.readFile(value, 'utf8'), '2');
      assert.strictEqual(fs.existsSync(f.lock), false);
    } finally {
      await Promise.allSettled([first.done, second.done]);
      await f.clean();
    }
  });

  test('a process exiting inside its task leaves a recoverable local lock', async () => {
    const f = await fixture();
    const crashed = worker(f.lock, "process.stdout.write('locked\\n'); process.exit(0);");
    try {
      await crashed.done;
      assert.strictEqual(fs.existsSync(f.lock), true);
      let entered = false;
      await withFileLock(f.lock, async () => { entered = true; });
      assert.strictEqual(entered, true);
      assert.strictEqual(fs.existsSync(f.lock), false);
    } finally { await f.clean(); }
  });

  test('an owner on another host is never reclaimed based on its PID', async () => {
    const f = await fixture();
    const host = createHash('sha256').update(os.hostname()).digest('hex').slice(0, 16);
    const otherHost = (host[0] === '0' ? '1' : '0') + host.slice(1);
    const crashed = worker(f.lock, 'process.exit(0);');
    try {
      await crashed.done;
      const owners = await fs.promises.readdir(f.lock);
      assert.strictEqual(owners.length, 1);
      const owner = otherHost + owners[0].slice(host.length);
      await fs.promises.rename(path.join(f.lock, owners[0]), path.join(f.lock, owner));
      await assert.rejects(withFileLock(f.lock, async () => undefined, 0), /locked by another process/);
      assert.deepStrictEqual(await fs.promises.readdir(f.lock), [owner]);
    } finally { await f.clean(); }
  });

  test('a throwing task releases its lock without hiding its error', async () => {
    const f = await fixture();
    try {
      await assert.rejects(withFileLock(f.lock, async () => { throw new Error('fixture failed'); }), /fixture failed/);
      assert.strictEqual(fs.existsSync(f.lock), false);
      assert.strictEqual(await withFileLock(f.lock, async () => 'next task'), 'next task');
    } finally { await f.clean(); }
  });
});

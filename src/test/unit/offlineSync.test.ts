// Exercise the pinned synchronization library over loopback HTTP and real files.
// No VS Code accounts, production endpoints, or mocked merge decisions are used.
/* eslint-disable @typescript-eslint/naming-convention */
import * as assert from 'assert';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { Account, AccountService, LatexApp, SyncResult } from 'cloudlatex-cli-plugin';
import { SyncDisplayState } from '../../syncDisplayState';

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'File watcher did not settle');
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

async function fixture(beforeStart?: (app: LatexApp, server: http.Server, temp: string) => void | Promise<void>) {
  const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cl-offline-review-'));
  const root = path.join(temp, 'paper');
  const storage = path.join(temp, 'storage');
  let fixtureServer: http.Server | undefined;
  let fixtureApp: LatexApp | undefined;
  const clean = async () => {
    try {
      await fixtureApp?.stop();
    } finally {
      try {
        if (fixtureServer?.listening) {
          await new Promise<void>(resolve => fixtureServer!.close(() => resolve()));
        }
      } finally {
        await new Promise(resolve => setTimeout(resolve, 100));
        await fs.promises.rm(temp, { recursive: true, force: true });
      }
    }
  };
  try {
    await Promise.all([root, storage].map(folder => fs.promises.mkdir(folder)));
    const remote = { online: true, content: 'original\n', revision: 1, deleted: false, writes: 0 };
    const server = fixtureServer = http.createServer(async (request, response) => {
      if (!remote.online) {
        request.socket.destroy();
        return;
      }
      const url = request.url || '';
      response.setHeader('Content-Type', 'application/json');
      if (url === '/api/auth/validate_token') {
        response.end(JSON.stringify({ success: true }));
      } else if (url === '/api/projects/1') {
        response.end(JSON.stringify({ project: { id: 1, title: 'Offline fixture', compile_target_file_id: 11 } }));
      } else if (url === '/api/projects/1/files') {
        response.end(JSON.stringify({ material_files: remote.deleted ? [] : [{
          id: 11, name: 'main.tex', full_path: 'main.tex', is_folder: false,
          revision: String(remote.revision), size: remote.content.length
        }] }));
      } else if (url === '/api/projects/1/files/11/download') {
        response.setHeader('Content-Type', 'text/plain');
        response.end(remote.content);
      } else if (url === '/api/projects/1/files/11' && request.method === 'PUT') {
        let body = '';
        for await (const chunk of request) { body += chunk.toString(); }
        const update = JSON.parse(body).material_file;
        if (update.revision !== String(remote.revision)) {
          response.writeHead(409).end('{}');
          return;
        }
        remote.writes++;
        remote.content = update.content;
        remote.revision++;
        response.end(JSON.stringify({ revision: String(remote.revision) }));
      } else {
        response.writeHead(404).end('{}');
      }
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const account = new AccountService<Account>();
    await account.save({ email: 'review@example.test', client: 'fixture-client', token: 'fixture-token' });
    const app = fixtureApp = await LatexApp.createApp({
      backend: 'cloudlatex', rootPath: root, projectId: 1, storagePath: storage,
      endpoint: `http://127.0.0.1:${address.port}/api`, outDir: '.output'
    }, { accountService: account });
    await beforeStart?.(app, server, temp);
    assert.strictEqual((await app.start()).status, 'success');
    const initial = await app.sync();
    assert.strictEqual(initial.status, 'success');
    const file = initial.appInfo.files.find(file => file.relativePath === 'main.tex');
    assert.ok(file);
    await waitFor(() => file.watcherSynced);
    const main = path.join(root, 'main.tex');
    return {
      app, remote, main, initial,
      editOffline: async () => {
        remote.online = false;
        await fs.promises.writeFile(main, 'edited offline\n');
        await waitFor(() => file.localChange === 'update');
        const offline = await app.sync();
        assert.strictEqual(offline.status, 'offline');
        assert.strictEqual(offline.appInfo.loginStatus, 'offline');
        assert.strictEqual(remote.writes, 0);
        assert.strictEqual(remote.content, 'original\n');
        assert.strictEqual(await fs.promises.readFile(main, 'utf8'), 'edited offline\n');
        return offline;
      },
      editRemote: () => { remote.content = 'edited on server\n'; remote.revision++; remote.online = true; },
      clean
    };
  } catch (error) {
    // Tests cannot reach their finally block when fixture setup itself fails.
    // Report the setup failure, not a secondary cleanup failure.
    await clean().catch(() => undefined);
    throw error;
  }
}

suite('Pinned sync core: offline and conflict regressions', function () {
  this.timeout(15000);

  for (const phase of ['start', 'sync'] as const) {
    test(`fixture cleans its server, watcher and directory when initial ${phase} fails`, async () => {
      let server: http.Server | undefined;
      let temp: string | undefined;
      let stopped = false;
      await assert.rejects(fixture((app, fixtureServer, fixtureTemp) => {
        server = fixtureServer;
        temp = fixtureTemp;
        const stop = app.stop.bind(app);
        app.stop = async () => {
          await stop();
          stopped = true;
        };
        if (phase === 'start') {
          const start = app.start.bind(app);
          app.start = async () => ({ ...await start(), status: 'offline' });
        } else {
          const sync = app.sync.bind(app);
          app.sync = async () => ({ ...await sync(), status: 'unknown-error' });
        }
      }), assert.AssertionError);
      assert.ok(stopped, 'the initialized watcher must be stopped');
      assert.ok(server);
      assert.strictEqual(server.listening, false);
      assert.ok(temp);
      assert.strictEqual(fs.existsSync(temp), false);
    });
  }

  test('offline edits stay local and upload after reconnect if the server did not change', async () => {
    const state = await fixture();
    try {
      const display = new SyncDisplayState();
      display.settle(state.initial.appInfo.files);
      const offline = await state.editOffline();
      assert.strictEqual(display.project(offline.appInfo.files)[0].localChange, 'update');
      state.remote.online = true;
      const recovered = await state.app.sync();
      assert.strictEqual(recovered.status, 'success');
      assert.strictEqual(state.remote.content, 'edited offline\n');
      assert.strictEqual(state.remote.writes, 1);
    } finally { await state.clean(); }
  });

  test('both sides changing stops at a conflict, including repeated concurrent sync requests', async () => {
    const state = await fixture();
    try {
      const display = new SyncDisplayState();
      display.settle(state.initial.appInfo.files);
      await state.editOffline();
      state.editRemote();
      const results: SyncResult[] = await Promise.all([state.app.sync(), state.app.sync()]);
      for (const result of results) {
        assert.strictEqual(result.status, 'conflict');
        assert.strictEqual(result.appInfo.conflictFiles.length, 1);
        assert.strictEqual(display.project(result.appInfo.files)[0].changeLocation, 'both');
      }
      assert.strictEqual(state.remote.writes, 0);
      assert.strictEqual(state.remote.content, 'edited on server\n');
      assert.strictEqual(await fs.promises.readFile(state.main, 'utf8'), 'edited offline\n');
    } finally { await state.clean(); }
  });

  for (const solution of ['pull', 'push'] as const) {
    test(`a conflict is resolved only after an explicit ${solution} choice`, async () => {
      const state = await fixture();
      try {
        await state.editOffline();
        state.editRemote();
        assert.strictEqual((await state.app.sync()).status, 'conflict');
        assert.strictEqual(state.remote.writes, 0);
        assert.strictEqual((await state.app.sync(solution)).status, 'success');
        const expected = solution === 'pull' ? 'edited on server\n' : 'edited offline\n';
        assert.strictEqual(await fs.promises.readFile(state.main, 'utf8'), expected);
        assert.strictEqual(state.remote.content, expected);
        assert.strictEqual(state.remote.writes, solution === 'push' ? 1 : 0);
      } finally { await state.clean(); }
    });
  }

  test('remote deletion during offline editing does not silently delete the local draft', async () => {
    const state = await fixture();
    try {
      await state.editOffline();
      state.remote.deleted = true;
      state.remote.online = true;
      const result = await state.app.sync();
      assert.strictEqual(result.status, 'conflict');
      assert.strictEqual(result.appInfo.conflictFiles[0].remoteChange, 'delete');
      assert.strictEqual(await fs.promises.readFile(state.main, 'utf8'), 'edited offline\n');
      assert.strictEqual(state.remote.writes, 0);
    } finally { await state.clean(); }
  });
});

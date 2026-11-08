/* eslint-disable @typescript-eslint/naming-convention */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { applyEdits, modify, parse } from 'jsonc-parser';

type Module = typeof import('../../folderConnection');
async function fixture(state = new Map<string, unknown>()) {
  const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cl-folder-test-'));
  const root = path.join(temp, 'destination');
  const storage = path.join(temp, 'metadata');
  await fs.promises.mkdir(root);
  await fs.promises.mkdir(storage);
  const settingsFile = path.join(root, '.vscode/settings.json');
  const vscode = {
    ConfigurationTarget: { Workspace: 2 },
    workspace: {
      workspaceFolders: [{ uri: { scheme: 'file', fsPath: root } }],
      getConfiguration: () => ({ update: async (key: string, value: unknown) => {
        const text = await fs.promises.readFile(settingsFile, 'utf8');
        await fs.promises.writeFile(settingsFile, applyEdits(text, modify(text, ['cloudlatex.' + key], value, {})));
      } })
    }
  };
  const registrySandbox = { exports: {}, URL, require: (name: string) => name === './locale' ? require('../../locale')
    : name === './const' ? require('../../const') : name === 'vscode' ? vscode
    : name === './interaction' ? {} : require(name) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../registeredProjects'), 'utf8'), registrySandbox);
  const sandbox = { exports: {}, require: (name: string) => name === './locale' ? require('../../locale')
    : name === './const' ? require('../../const') : name === 'vscode' ? vscode
    : name === './config' ? { getVSConfig: () => vscode.workspace.getConfiguration() }
    : name === './registeredProjects' ? registrySandbox.exports : require(name) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../folderConnection'), 'utf8'), sandbox);
  const mod = sandbox.exports as Module;
  const context = {
    storageUri: { fsPath: storage },
    globalState: { get: (key: string) => state.get(key), update: async (key: string, value: unknown) => {
      if (value === undefined) { state.delete(key); } else { state.set(key, value); }
    } }
  } as unknown as Parameters<Module['stageFolderConnection']>[0];
  const project = { id: 121, title: 'Test', endpoint: 'http://localhost:3000/api', lastOpenedAt: 0 };
  const inherited = { autoCompile: false, outDir: './.workspace', ignoredFiles: ['**/*.aux'] };
  return {
    temp, root, storage, state, settingsFile, vscode, context, mod,
    stage: () => mod.stageFolderConnection(context, root, project, inherited),
    complete: () => mod.completeFolderConnection(context),
    settings: async () => parse(await fs.promises.readFile(settingsFile, 'utf8')),
    clean: () => fs.promises.rm(temp, { recursive: true, force: true })
  };
}

suite('Registered project folder handoff', () => {
  test('inherits localhost and build preferences, clears stale metadata before enabling, consumes intent once', async () => {
    const f = await fixture();
    try {
      await f.stage();
      assert.strictEqual((await f.settings())['cloudlatex.endpoint'], 'http://localhost:3000/api');
      assert.strictEqual((await f.settings())['cloudlatex.enabled'], false);
      assert.strictEqual((await f.settings())['cloudlatex.autoCompile'], false);
      const oldDb = path.join(f.storage, '.121-cloudlatex.json');
      await fs.promises.writeFile(oldDb, 'stale');
      assert.strictEqual(await f.complete(), true);
      assert.strictEqual(fs.existsSync(oldDb), false);
      assert.strictEqual((await f.settings())['cloudlatex.enabled'], true);
      assert.strictEqual((await f.settings())['cloudlatex.projectId'], 121);
      assert.strictEqual(fs.existsSync(path.join(f.root, f.mod.CONNECTION_MARKER)), false);
      assert.strictEqual(await f.complete(), false);
    } finally { await f.clean(); }
  });
  test('preserves JSONC comments and unrelated editor settings', async () => {
    const f = await fixture();
    try {
      await fs.promises.mkdir(path.dirname(f.settingsFile));
      await fs.promises.writeFile(f.settingsFile, '{\n// keep this\n"editor.tabSize": 4,\n}\n');
      await f.stage();
      assert.strictEqual((await f.settings())['editor.tabSize'], 4);
      assert.match(await fs.promises.readFile(f.settingsFile, 'utf8'), /keep this/);
    } finally { await f.clean(); }
  });
  test('rejects nonempty folders without changing their files or settings', async () => {
    const f = await fixture();
    try {
      await fs.promises.writeFile(path.join(f.root, 'main.tex'), 'keep');
      await assert.rejects(f.stage());
      assert.strictEqual(await fs.promises.readFile(path.join(f.root, 'main.tex'), 'utf8'), 'keep');
      assert.strictEqual(fs.existsSync(f.settingsFile), false);
      assert.strictEqual(f.state.size, 0);
    } finally { await f.clean(); }
  });
  test('rejects settings symlinks without modifying their target', async () => {
    const f = await fixture();
    try {
      const target = path.join(f.temp, 'outside.json');
      await fs.promises.writeFile(target, '{}');
      await fs.promises.mkdir(path.dirname(f.settingsFile));
      await fs.promises.symlink(target, f.settingsFile);
      await assert.rejects(f.stage());
      assert.strictEqual(await fs.promises.readFile(target, 'utf8'), '{}');
    } finally { await f.clean(); }
  });
  test('failed folder opening can roll back staged settings and intent', async () => {
    const f = await fixture();
    try {
      const rollback = await f.stage();
      await rollback();
      assert.strictEqual(fs.existsSync(f.settingsFile), false);
      assert.strictEqual(f.state.size, 0);
      assert.strictEqual(await f.complete(), false);
    } finally { await f.clean(); }
  });
  test('an expired handoff removes its own marker and can be retried', async () => {
    const f = await fixture();
    try {
      await f.stage();
      (Array.from(f.state.values())[0] as { expires: number }).expires = 0;
      await assert.rejects(f.complete());
      assert.strictEqual(fs.existsSync(path.join(f.root, f.mod.CONNECTION_MARKER)), false);
      assert.strictEqual((await f.settings())['cloudlatex.enabled'], false);
      await f.stage();
      assert.strictEqual(await f.complete(), true);
    } finally { await f.clean(); }
  });
  test('two folders can complete independent handoffs in the same profile', async () => {
    const shared = new Map<string, unknown>();
    const first = await fixture(shared);
    const second = await fixture(shared);
    try {
      await first.stage();
      await second.stage();
      assert.strictEqual(shared.size, 2);
      assert.strictEqual(await first.complete(), true);
      assert.strictEqual(await second.complete(), true);
      assert.strictEqual((await first.settings())['cloudlatex.enabled'], true);
      assert.strictEqual((await second.settings())['cloudlatex.enabled'], true);
      assert.strictEqual(shared.size, 0);
    } finally { await first.clean(); await second.clean(); }
  });
  for (const change of ['nonce', 'endpoint', 'nonempty', 'expired', 'other-profile']) {
    test(`does not enable a handoff with ${change}`, async () => {
      const f = await fixture();
      try {
        await f.stage();
        if (change === 'nonce') { await fs.promises.writeFile(path.join(f.root, f.mod.CONNECTION_MARKER), '{"nonce":"other"}'); }
        if (change === 'endpoint') {
          const text = await fs.promises.readFile(f.settingsFile, 'utf8');
          await fs.promises.writeFile(f.settingsFile, text.replace('localhost:3000', 'other.example.test'));
        }
        if (change === 'nonempty') { await fs.promises.writeFile(path.join(f.root, 'main.tex'), 'keep'); }
        if (change === 'expired') { (Array.from(f.state.values())[0] as { expires: number }).expires = 0; }
        if (change === 'other-profile') {
          f.state.clear();
          assert.strictEqual(await f.complete(), false);
        } else { await assert.rejects(f.complete()); }
        assert.strictEqual((await f.settings())['cloudlatex.enabled'], false);
      } finally { await f.clean(); }
    });
  }
});

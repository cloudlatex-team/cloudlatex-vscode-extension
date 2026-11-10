/* eslint-disable @typescript-eslint/naming-convention */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { createHash } from 'crypto';
import { applyEdits, modify, parse } from 'jsonc-parser';

type Module = typeof import('../../folderConnection');
type Pending = { rootPath: string; endpoint: string; id: number; nonce: string; expires: number };
async function fixture(state = new Map<string, unknown>(), sharedStorage?: string) {
  const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cl-folder-test-'));
  const root = path.join(temp, 'destination');
  const storage = path.join(temp, 'metadata');
  const globalStorage = sharedStorage || path.join(temp, 'global');
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
    : name === './fileLock' ? require('../../fileLock')
    : name === './interaction' ? {} : require(name) };
  vm.runInNewContext(fs.readFileSync(require.resolve('../../registeredProjects'), 'utf8'), registrySandbox);
  // Each load is a separate extension host, i.e. another window.
  const load = (fileSystem = fs) => {
    const sandbox = { exports: {}, Buffer, require: (name: string) => name === 'fs' ? fileSystem : name === './locale' ? require('../../locale')
      : name === './const' ? require('../../const') : name === 'vscode' ? vscode
      : name === './fileLock' ? require('../../fileLock')
      : name === './config' ? { getVSConfig: () => vscode.workspace.getConfiguration() }
      : name === './registeredProjects' ? registrySandbox.exports : require(name) };
    vm.runInNewContext(fs.readFileSync(require.resolve('../../folderConnection'), 'utf8'), sandbox);
    return sandbox.exports as Module;
  };
  const mod = load();
  const context = {
    storageUri: { fsPath: storage },
    globalStorageUri: { fsPath: globalStorage },
    globalState: { get: (key: string) => state.get(key), update: async (key: string, value: unknown) => {
      if (value === undefined) { state.delete(key); } else { state.set(key, value); }
    } }
  } as unknown as Parameters<Module['stageFolderConnection']>[0];
  const project = { id: 121, title: 'Test', endpoint: 'http://localhost:3000/api', lastOpenedAt: 0 };
  const inherited = { autoCompile: false, outDir: './.workspace', ignoredFiles: ['**/*.aux'] };
  const canonicalRoot = await fs.promises.realpath(root);
  const pendingFile = path.join(globalStorage, 'pending-connections', createHash('sha256').update(canonicalRoot).digest('hex') + '.json');
  const pending = async (): Promise<Pending | undefined> => {
    try { return JSON.parse(await fs.promises.readFile(pendingFile, 'utf8')) || undefined; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { return undefined; } throw error; }
  };
  const pendingText = () => fs.promises.readFile(pendingFile, 'utf8').catch(() => undefined);
  const setPending = async (values: Partial<Pending>) => {
    await fs.promises.writeFile(pendingFile, JSON.stringify({ ...await pending(), ...values }));
  };
  const pendingCount = async () => {
    const directory = path.dirname(pendingFile);
    const files = await fs.promises.readdir(directory).catch(() => []);
    const values = await Promise.all(files.filter(file => file.endsWith('.json')).map(async file => JSON.parse(await fs.promises.readFile(path.join(directory, file), 'utf8'))));
    return values.filter(value => value !== null).length;
  };
  return {
    temp, root, storage, globalStorage, state, settingsFile, pendingFile, pending, pendingText, setPending, pendingCount, vscode, context, mod, inherited, project, otherWindow: load,
    stage: () => mod.stageFolderConnection(context, root, project, inherited),
    complete: () => mod.completeFolderConnection(context),
    settings: async () => parse(await fs.promises.readFile(settingsFile, 'utf8')),
    clean: () => fs.promises.rm(temp, { recursive: true, force: true })
  };
}

suite('Registered project folder handoff', () => {
  test('an unavailable workspace without a handoff does not fail ordinary activation', async () => {
    const f = await fixture();
    try {
      await fs.promises.rm(f.root, { recursive: true });
      assert.strictEqual(await f.complete(), false);
      assert.strictEqual(await f.pendingCount(), 0);
      assert.strictEqual(fs.existsSync(f.globalStorage), false);
    } finally { await f.clean(); }
  });
  test('an unrelated folder intent does not turn a missing workspace into a handoff failure', async () => {
    const shared = new Map<string, unknown>();
    const first = await fixture(shared);
    const second = await fixture(shared, first.globalStorage);
    try {
      await first.stage();
      await fs.promises.rm(second.root, { recursive: true });
      assert.strictEqual(await second.complete(), false);
      assert.strictEqual(await first.pendingCount(), 1);
      assert.strictEqual(await first.complete(), true);
    } finally { await first.clean(); await second.clean(); }
  });
  test('a known handoff still reports an unavailable destination instead of enabling it', async () => {
    const f = await fixture();
    try {
      await f.stage();
      const pending = (await f.pending())!;
      f.vscode.workspace.workspaceFolders[0].uri.fsPath = pending.rootPath;
      await fs.promises.rm(f.root, { recursive: true });
      await assert.rejects(f.complete(), (error: NodeJS.ErrnoException) => error.code === 'ENOENT');
      assert.strictEqual(await f.pendingCount(), 1);
    } finally { await f.clean(); }
  });
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
  test('inherits only project-contained relative output paths without changing the source preferences', async () => {
    for (const outDir of ['', '.', './.workspace', 'nested/build', 'nested/../build', 'nested/..', '.\\workspace', 'nested\\..\\build', '../destination/.workspace', '.../build']) {
      const f = await fixture();
      try {
        f.inherited.outDir = outDir;
        await f.stage();
        assert.strictEqual((await f.settings())['cloudlatex.outDir'], outDir, outDir);
        assert.strictEqual(f.inherited.outDir, outDir);
        assert.strictEqual((await f.settings())['cloudlatex.endpoint'], f.project.endpoint);
      } finally { await f.clean(); }
    }
  });
  test('drops absolute and escaping output paths rather than copying another project output target', async () => {
    const outside = ['/', '/tmp/other-project/.workspace', 'C:\\other-project\\output', 'C:/other-project/output', '\\\\server\\share\\output', '\\rooted\\output', 'C:drive-relative', '..', '../outside', 'nested/../../outside', '..\\outside', 'nested\\..\\..\\outside'];
    for (const outDir of outside) {
      const f = await fixture();
      try {
        f.inherited.outDir = outDir;
        await f.stage();
        assert.strictEqual((await f.settings())['cloudlatex.outDir'], '', outDir);
        assert.strictEqual(f.inherited.outDir, outDir);
      } finally { await f.clean(); }
    }
    const f = await fixture();
    try {
      // Even an absolute path inside the destination is deliberately dropped.
      f.inherited.outDir = path.join(f.root, '.workspace');
      await f.stage();
      assert.strictEqual((await f.settings())['cloudlatex.outDir'], '');
    } finally { await f.clean(); }
  });
  test('accepts empty and comment-only settings while preserving their text on rollback', async () => {
    for (const text of ['', '  \n', '// retained comment\n', '/* retained comment */\n']) {
      const f = await fixture();
      try {
        await fs.promises.mkdir(path.dirname(f.settingsFile));
        await fs.promises.writeFile(f.settingsFile, text);
        const rollback = await f.stage();
        assert.strictEqual((await f.settings())['cloudlatex.projectId'], f.project.id);
        if (text.includes('comment')) {
          assert.match(await fs.promises.readFile(f.settingsFile, 'utf8'), /retained comment/);
        }
        await rollback();
        assert.strictEqual(await fs.promises.readFile(f.settingsFile, 'utf8'), text);
        assert.strictEqual(await f.pendingCount(), 0);
      } finally { await f.clean(); }
    }
  });
  test('still rejects malformed and non-object settings without changing files or intent', async () => {
    for (const text of ['{', '{"key":', '{"key": 1,,}', '/* unterminated', 'null', '[]', 'false']) {
      const f = await fixture();
      try {
        await fs.promises.mkdir(path.dirname(f.settingsFile));
        await fs.promises.writeFile(f.settingsFile, text);
        await assert.rejects(f.stage(), /Invalid settings JSON/);
        assert.strictEqual(await fs.promises.readFile(f.settingsFile, 'utf8'), text);
        assert.strictEqual(fs.existsSync(path.join(f.root, f.mod.CONNECTION_MARKER)), false);
        assert.strictEqual(await f.pendingCount(), 0);
      } finally { await f.clean(); }
    }
  });
  test('rejects nonempty folders without changing their files or settings', async () => {
    const f = await fixture();
    try {
      await fs.promises.writeFile(path.join(f.root, 'main.tex'), 'keep');
      await assert.rejects(f.stage());
      assert.strictEqual(await fs.promises.readFile(path.join(f.root, 'main.tex'), 'utf8'), 'keep');
      assert.strictEqual(fs.existsSync(f.settingsFile), false);
      assert.strictEqual(await f.pendingCount(), 0);
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
      assert.strictEqual(await f.pendingCount(), 0);
      assert.strictEqual(await f.complete(), false);
    } finally { await f.clean(); }
  });
  test('an unchanged same-window retry rotates its nonce and an old rollback cannot remove it', async () => {
    const f = await fixture();
    try {
      const oldRollback = await f.stage();
      const previous = (await f.pending())!;
      f.inherited.outDir = './different-output';
      await f.stage();
      const current = (await f.pending())!;
      assert.notStrictEqual(current.nonce, previous.nonce);
      const marker = path.join(f.root, f.mod.CONNECTION_MARKER);
      const markerText = await fs.promises.readFile(marker, 'utf8');
      const settingsText = await fs.promises.readFile(f.settingsFile, 'utf8');
      await oldRollback();
      assert.strictEqual(await fs.promises.readFile(marker, 'utf8'), markerText);
      assert.strictEqual(await fs.promises.readFile(f.settingsFile, 'utf8'), settingsText);
      assert.strictEqual((await f.pending())!.nonce, current.nonce);
      assert.strictEqual(await f.complete(), true);
      assert.strictEqual((await f.settings())['cloudlatex.enabled'], true);
      assert.strictEqual(await f.pendingCount(), 0);
    } finally { await f.clean(); }
  });
  test('an overlapping old rollback blocks a retry until restoration has finished', async () => {
    const f = await fixture();
    const readFile = fs.promises.readFile;
    let resume!: () => void;
    let paused!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const reading = new Promise<void>(resolve => { paused = resolve; });
    let oldAttempt: Promise<void> | undefined;
    try {
      const oldRollback = await f.stage();
      const settingsFile = await fs.promises.realpath(f.settingsFile);
      let pause = true;
      fs.promises.readFile = (async (...args: Parameters<typeof readFile>) => {
        const value = await readFile(...args);
        if (args[0] === settingsFile && pause) {
          pause = false;
          paused();
          await gate;
        }
        return value;
      }) as typeof readFile;
      oldAttempt = oldRollback();
      await reading;
      f.inherited.outDir = './retry-output';
      await assert.rejects(f.stage(), /locked by another process/);
      resume();
      await oldAttempt;
      assert.strictEqual(fs.existsSync(f.settingsFile), false);
      assert.strictEqual(await f.pendingCount(), 0);
      await f.stage();
      assert.strictEqual(await f.complete(), true);
      assert.strictEqual((await f.settings())['cloudlatex.outDir'], './retry-output');
    } finally {
      fs.promises.readFile = readFile;
      resume();
      await oldAttempt;
      await f.clean();
    }
  });
  test('a retry rollback preserves its pre-retry settings and removes only its owned intent', async () => {
    const f = await fixture();
    try {
      const oldRollback = await f.stage();
      const previousSettings = await fs.promises.readFile(f.settingsFile, 'utf8');
      f.inherited.autoCompile = true;
      const rollback = await f.stage();
      await rollback();
      assert.strictEqual(await fs.promises.readFile(f.settingsFile, 'utf8'), previousSettings);
      assert.strictEqual(fs.existsSync(path.join(f.root, f.mod.CONNECTION_MARKER)), false);
      assert.strictEqual(await f.pendingCount(), 0);
      await oldRollback();
      assert.strictEqual(await fs.promises.readFile(f.settingsFile, 'utf8'), previousSettings);
    } finally { await f.clean(); }
  });
  test('an expired but unchanged owned stage can be retried without opening the folder first', async () => {
    const f = await fixture();
    try {
      await f.stage();
      await f.setPending({ expires: 0 });
      await f.stage();
      assert.ok((await f.pending())!.expires > Date.now());
      assert.strictEqual(await f.complete(), true);
    } finally { await f.clean(); }
  });
  for (const change of ['nonce', 'marker-content', 'marker-symlink', 'enabled', 'other-storage']) {
    test(`retry refuses ${change} and preserves the existing files and state`, async () => {
      const f = await fixture();
      try {
        await f.stage();
        const marker = path.join(f.root, f.mod.CONNECTION_MARKER);
        const pending = (await f.pending())!;
        if (change === 'nonce') { await fs.promises.writeFile(marker, '{"nonce":"unrelated"}'); }
        if (change === 'marker-content') { await fs.promises.writeFile(marker, JSON.stringify({ nonce: pending.nonce, note: 'user data' })); }
        if (change === 'marker-symlink') {
          const target = path.join(f.temp, 'marker-target.json');
          await fs.promises.rename(marker, target);
          await fs.promises.symlink(target, marker);
        }
        if (change === 'enabled') {
          const text = await fs.promises.readFile(f.settingsFile, 'utf8');
          await fs.promises.writeFile(f.settingsFile, applyEdits(text, modify(text, ['cloudlatex.enabled'], true, {})));
        }
        if (change === 'other-storage') { Object.assign(f.context, { globalStorageUri: { fsPath: path.join(f.temp, 'other-global') } }); }
        const settingsBefore = await fs.promises.readFile(f.settingsFile, 'utf8');
        const markerBefore = await fs.promises.readFile(marker, 'utf8').catch(() => undefined);
        const stateBefore = await f.pendingText();
        await assert.rejects(f.stage());
        assert.strictEqual(await fs.promises.readFile(f.settingsFile, 'utf8'), settingsBefore);
        assert.strictEqual(await fs.promises.readFile(marker, 'utf8').catch(() => undefined), markerBefore);
        assert.strictEqual(await f.pendingText(), stateBefore);
      } finally { await f.clean(); }
    });
  }
  for (const change of ['edited-settings', 'missing-marker', 'removed-vscode', 'expired']) {
    test(`retry replaces this window's earlier stage after ${change}`, async () => {
      const f = await fixture();
      try {
        await f.stage();
        const marker = path.join(f.root, f.mod.CONNECTION_MARKER);
        if (change === 'edited-settings') {
          const text = await fs.promises.readFile(f.settingsFile, 'utf8');
          await fs.promises.writeFile(f.settingsFile, applyEdits(text, modify(text, ['editor.fontSize'], 20, {})));
        }
        if (change === 'missing-marker') { await fs.promises.unlink(marker); }
        if (change === 'removed-vscode') { await fs.promises.rm(path.join(f.root, '.vscode'), { recursive: true }); }
        if (change === 'expired') { await f.setPending({ expires: 0 }); }
        await f.stage();
        assert.strictEqual(await f.pendingCount(), 1);
        assert.strictEqual(await f.complete(), true);
        const settings = await f.settings();
        assert.strictEqual(settings['cloudlatex.enabled'], true);
        assert.strictEqual(settings['cloudlatex.projectId'], f.project.id);
        if (change === 'edited-settings') { assert.strictEqual(settings['editor.fontSize'], 20); }
        assert.strictEqual(fs.existsSync(marker), false);
        assert.strictEqual(await f.pendingCount(), 0);
      } finally { await f.clean(); }
    });
  }
  test('another window cannot replace a live stage until it expires', async () => {
    const f = await fixture();
    try {
      await f.stage();
      const other = { ...f.project, id: f.project.id + 1, title: 'Other' };
      const stageInOtherWindow = f.otherWindow();
      const settingsBefore = await fs.promises.readFile(f.settingsFile, 'utf8');
      const stateBefore = await f.pendingText();
      await assert.rejects(stageInOtherWindow.stageFolderConnection(f.context, f.root, other, f.inherited));
      assert.strictEqual(await fs.promises.readFile(f.settingsFile, 'utf8'), settingsBefore);
      assert.strictEqual(await f.pendingText(), stateBefore);
      await f.setPending({ expires: 0 });
      await stageInOtherWindow.stageFolderConnection(f.context, f.root, other, f.inherited);
      assert.strictEqual(await f.complete(), true);
      assert.strictEqual((await f.settings())['cloudlatex.projectId'], other.id);
    } finally { await f.clean(); }
  });
  test('an expired retry cannot replace a newer stage from another window', async () => {
    const f = await fixture();
    let resume!: () => void;
    let paused!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const deleting = new Promise<void>(resolve => { paused = resolve; });
    let staging: Promise<() => Promise<void>> | undefined;
    try {
      await f.stage();
      await f.setPending({ expires: 0 });
      const marker = await fs.promises.realpath(path.join(f.root, f.mod.CONNECTION_MARKER));
      const promises = new Proxy(fs.promises, {
        get: (target, key) => key === 'unlink' ? async (file: fs.PathLike) => {
          if (file === marker) { paused(); await gate; }
          return target.unlink(file);
        } : Reflect.get(target, key)
      });
      const fileSystem = new Proxy(fs, { get: (target, key) => key === 'promises' ? promises : Reflect.get(target, key) });
      const other = f.otherWindow(fileSystem);
      const waitingProject = { ...f.project, id: f.project.id + 2 };
      staging = other.stageFolderConnection(f.context, f.root, waitingProject, f.inherited);
      await deleting;
      const pendingBefore = await f.pendingText();
      const markerBefore = await fs.promises.readFile(marker, 'utf8');
      const settingsBefore = await fs.promises.readFile(f.settingsFile, 'utf8');
      const competingProject = { ...f.project, id: f.project.id + 1 };
      await assert.rejects(f.mod.stageFolderConnection(f.context, f.root, competingProject, f.inherited), /locked by another process/);
      assert.strictEqual(await fs.promises.readFile(marker, 'utf8'), markerBefore);
      assert.strictEqual(await fs.promises.readFile(f.settingsFile, 'utf8'), settingsBefore);
      assert.strictEqual(await f.pendingText(), pendingBefore);
      resume();
      await staging;
      assert.strictEqual(await other.completeFolderConnection(f.context), true);
      assert.strictEqual((await f.settings())['cloudlatex.projectId'], waitingProject.id);
    } finally {
      resume();
      await staging?.catch(() => undefined);
      await f.clean();
    }
  });
  test("completion and rollback cannot run inside another window's stage", async () => {
    const f = await fixture();
    let resume!: () => void;
    let paused!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const saving = new Promise<void>(resolve => { paused = resolve; });
    let staging: Promise<() => Promise<void>> | undefined;
    try {
      const oldRollback = await f.stage();
      await f.setPending({ expires: 0 });
      const settingsFile = await fs.promises.realpath(f.settingsFile);
      const promises = new Proxy(fs.promises, {
        get: (target, key) => key === 'writeFile' ? async (...args: Parameters<typeof fs.promises.writeFile>) => {
          if (args[0] === settingsFile) { paused(); await gate; }
          return target.writeFile(...args);
        } : Reflect.get(target, key)
      });
      const fileSystem = new Proxy(fs, { get: (target, key) => key === 'promises' ? promises : Reflect.get(target, key) });
      const other = f.otherWindow(fileSystem);
      const project = { ...f.project, id: f.project.id + 1 };
      staging = other.stageFolderConnection(f.context, f.root, project, f.inherited);
      await saving;
      const pendingBefore = await f.pendingText();
      const marker = path.join(f.root, f.mod.CONNECTION_MARKER);
      const markerBefore = await fs.promises.readFile(marker, 'utf8');
      await assert.rejects(f.complete(), /locked by another process/);
      await assert.rejects(oldRollback(), /locked by another process/);
      assert.strictEqual(await f.pendingText(), pendingBefore);
      assert.strictEqual(await fs.promises.readFile(marker, 'utf8'), markerBefore);
      resume();
      await staging;
      await oldRollback();
      assert.strictEqual(await other.completeFolderConnection(f.context), true);
      assert.strictEqual((await f.settings())['cloudlatex.projectId'], project.id);
    } finally {
      resume();
      await staging?.catch(() => undefined);
      await f.clean();
    }
  });
  test('a non-string output directory is not carried over', async () => {
    const f = await fixture();
    try {
      await f.mod.stageFolderConnection(f.context, f.root, f.project, { ...f.inherited, outDir: null as unknown as string });
      assert.strictEqual((await f.settings())['cloudlatex.outDir'], '');
    } finally { await f.clean(); }
  });
  test('a cancelled stage can be retried for a different project in the same folder', async () => {
    const f = await fixture();
    try {
      await f.stage();
      const other = { ...f.project, id: f.project.id + 1, title: 'Other' };
      await f.mod.stageFolderConnection(f.context, f.root, other, f.inherited);
      assert.strictEqual(await f.pendingCount(), 1);
      assert.strictEqual(await f.complete(), true);
      const settings = await f.settings();
      assert.strictEqual(settings['cloudlatex.projectId'], other.id);
      assert.strictEqual(settings['cloudlatex.enabled'], true);
    } finally { await f.clean(); }
  });
  test('an expired handoff removes its own marker and can be retried', async () => {
    const f = await fixture();
    try {
      await f.stage();
      await f.setPending({ expires: 0 });
      await assert.rejects(f.complete());
      assert.strictEqual(fs.existsSync(path.join(f.root, f.mod.CONNECTION_MARKER)), false);
      assert.strictEqual((await f.settings())['cloudlatex.enabled'], false);
      await f.stage();
      assert.strictEqual(await f.complete(), true);
    } finally { await f.clean(); }
  });
  test('two folders can complete independent handoffs in the same storage namespace', async () => {
    const shared = new Map<string, unknown>();
    const first = await fixture(shared);
    const second = await fixture(shared, first.globalStorage);
    try {
      await first.stage();
      await second.stage();
      assert.strictEqual(await first.pendingCount(), 2);
      assert.strictEqual(await first.complete(), true);
      assert.strictEqual(await second.complete(), true);
      assert.strictEqual((await first.settings())['cloudlatex.enabled'], true);
      assert.strictEqual((await second.settings())['cloudlatex.enabled'], true);
      assert.strictEqual(await first.pendingCount(), 0);
    } finally { await first.clean(); await second.clean(); }
  });
  test('an ordinary available workspace creates no handoff metadata', async () => {
    const f = await fixture();
    try {
      assert.strictEqual(await f.complete(), false);
      assert.strictEqual(fs.existsSync(f.globalStorage), false);
      assert.strictEqual(fs.existsSync(path.join(f.root, '.vscode')), false);
    } finally { await f.clean(); }
  });
  test('simultaneous different-folder handoffs survive independent cached Memento writes', async () => {
    const first = await fixture();
    const second = await fixture(new Map(), first.globalStorage);
    let main: Record<string, unknown> = { unrelated: 'preserved' };
    let writes = 0;
    // ExtHostMemento sends its entire cached state, not just the changed key.
    const cachedState = () => {
      const cached = { ...main };
      return {
        get: (key: string) => cached[key],
        update: async (key: string, value: unknown) => {
          if (value === undefined) { delete cached[key]; } else { cached[key] = value; }
          await Promise.resolve();
          main = { ...cached };
          writes++;
        }
      };
    };
    const context = (f: typeof first, state = cachedState()) => ({ ...f.context, globalState: state }) as unknown as typeof first.context;
    try {
      const secondProject = { ...second.project, id: second.project.id + 1 };
      await Promise.all([
        first.mod.stageFolderConnection(context(first), first.root, first.project, first.inherited),
        second.mod.stageFolderConnection(context(second), second.root, secondProject, second.inherited)
      ]);
      assert.strictEqual(await first.pendingCount(), 2);
      assert.strictEqual(await first.otherWindow().completeFolderConnection(context(first)), true);
      assert.strictEqual(await second.pendingCount(), 1);
      assert.strictEqual(await second.otherWindow().completeFolderConnection(context(second)), true);
      assert.strictEqual((await first.settings())['cloudlatex.projectId'], first.project.id);
      assert.strictEqual((await second.settings())['cloudlatex.projectId'], secondProject.id);
      assert.strictEqual((await first.settings())['cloudlatex.enabled'], true);
      assert.strictEqual((await second.settings())['cloudlatex.enabled'], true);
      assert.strictEqual(await first.pendingCount(), 0);
      assert.strictEqual(writes, 0);
      assert.deepStrictEqual(main, { unrelated: 'preserved' });
    } finally { await first.clean(); await second.clean(); }
  });
  test('rolling back one folder does not consume a different folder intent', async () => {
    const first = await fixture();
    const second = await fixture(new Map(), first.globalStorage);
    try {
      const [rollback] = await Promise.all([first.stage(), second.stage()]);
      const secondPending = await second.pendingText();
      await rollback();
      assert.strictEqual(await first.complete(), false);
      assert.strictEqual(await second.pendingText(), secondPending);
      assert.strictEqual(await second.complete(), true);
      assert.strictEqual((await second.settings())['cloudlatex.enabled'], true);
    } finally { await first.clean(); await second.clean(); }
  });
  test('a legacy intent completes once and cannot be revived by its old marker', async () => {
    const f = await fixture();
    try {
      await f.stage();
      const pending = (await f.pending())!;
      const marker = path.join(f.root, f.mod.CONNECTION_MARKER);
      const markerText = await fs.promises.readFile(marker, 'utf8');
      const settingsText = await fs.promises.readFile(f.settingsFile, 'utf8');
      await fs.promises.unlink(f.pendingFile);
      f.state.set('cloudlatex.pendingFolderConnection:' + pending.rootPath, pending);
      assert.strictEqual(await f.complete(), true);
      assert.strictEqual(await f.pendingText(), 'null');
      await fs.promises.writeFile(marker, markerText);
      await fs.promises.writeFile(f.settingsFile, settingsText);
      assert.strictEqual(await f.otherWindow().completeFolderConnection(f.context), false);
      assert.strictEqual((await f.settings())['cloudlatex.enabled'], false);
      assert.strictEqual(await fs.promises.readFile(marker, 'utf8'), markerText);
      assert.strictEqual(f.state.size, 1, 'the old cached state is never written back');
    } finally { await f.clean(); }
  });
  test('a legacy intent can be retried and rollback prevents its resurrection', async () => {
    const f = await fixture();
    try {
      await f.stage();
      const pending = (await f.pending())!;
      const marker = path.join(f.root, f.mod.CONNECTION_MARKER);
      const markerText = await fs.promises.readFile(marker, 'utf8');
      const settingsText = await fs.promises.readFile(f.settingsFile, 'utf8');
      await fs.promises.unlink(f.pendingFile);
      f.state.set('cloudlatex.pendingFolderConnection:' + pending.rootPath, pending);
      const rollback = await f.stage();
      await rollback();
      assert.strictEqual(await f.pendingText(), 'null');
      await fs.promises.writeFile(marker, markerText);
      await fs.promises.writeFile(f.settingsFile, settingsText);
      assert.strictEqual(await f.otherWindow().completeFolderConnection(f.context), false);
      assert.strictEqual((await f.settings())['cloudlatex.enabled'], false);
    } finally { await f.clean(); }
  });
  test('invalid pending data is refused without changing the staged files', async () => {
    const f = await fixture();
    try {
      await f.stage();
      const valid = (await f.pending())!;
      const marker = path.join(f.root, f.mod.CONNECTION_MARKER);
      const markerText = await fs.promises.readFile(marker, 'utf8');
      const settingsText = await fs.promises.readFile(f.settingsFile, 'utf8');
      for (const change of [
        { rootPath: valid.rootPath + '-other' }, { endpoint: valid.endpoint + '?' }, { id: 0 },
        { nonce: 'unrelated' }, { expires: -1 }, { expires: Number.NaN }
      ]) {
        await fs.promises.writeFile(f.pendingFile, JSON.stringify({ ...valid, ...change }));
        await assert.rejects(f.stage(), /Invalid pending connection/);
        await assert.rejects(f.complete(), /Invalid pending connection/);
        assert.strictEqual(await fs.promises.readFile(marker, 'utf8'), markerText);
        assert.strictEqual(await fs.promises.readFile(f.settingsFile, 'utf8'), settingsText);
      }
    } finally { await f.clean(); }
  });
  test('pending storage rejects malformed, oversized and symbolic-link data without changing its target', async () => {
    for (const change of ['malformed', 'oversized', 'file-symlink', 'directory-symlink']) {
      const f = await fixture();
      try {
        await f.stage();
        const original = await fs.promises.readFile(f.pendingFile, 'utf8');
        let target = f.pendingFile;
        if (change === 'malformed') { await fs.promises.writeFile(f.pendingFile, '{'); }
        if (change === 'oversized') { await fs.promises.writeFile(f.pendingFile, ' '.repeat(64 * 1024 + 1)); }
        if (change === 'file-symlink') {
          target = path.join(f.temp, 'outside-pending.json');
          await fs.promises.rename(f.pendingFile, target);
          await fs.promises.symlink(target, f.pendingFile);
        }
        if (change === 'directory-symlink') {
          const directory = path.dirname(f.pendingFile);
          const outside = path.join(f.temp, 'outside-pending');
          await fs.promises.rename(directory, outside);
          await fs.promises.symlink(outside, directory);
          target = path.join(outside, path.basename(f.pendingFile));
        }
        const before = await fs.promises.readFile(target, 'utf8');
        const marker = path.join(f.root, f.mod.CONNECTION_MARKER);
        const markerText = await fs.promises.readFile(marker, 'utf8');
        await assert.rejects(f.stage());
        await assert.rejects(f.complete());
        assert.strictEqual(await fs.promises.readFile(target, 'utf8'), before);
        assert.strictEqual(await fs.promises.readFile(marker, 'utf8'), markerText);
        if (change.endsWith('symlink')) { assert.strictEqual(before, original); }
      } finally { await f.clean(); }
    }
  });
  test('an old rollback does not consume a different pending nonce', async () => {
    const f = await fixture();
    try {
      const rollback = await f.stage();
      const current = (await f.pending())!;
      await f.setPending({ nonce: current.nonce === 'a'.repeat(48) ? 'b'.repeat(48) : 'a'.repeat(48) });
      const otherPending = await f.pendingText();
      await rollback();
      assert.strictEqual(await f.pendingText(), otherPending);
      assert.strictEqual(fs.existsSync(f.settingsFile), false);
      assert.strictEqual(fs.existsSync(path.join(f.root, f.mod.CONNECTION_MARKER)), false);
    } finally { await f.clean(); }
  });
  test('a marker creation failure leaves no new private intent or settings', async () => {
    const f = await fixture();
    const marker = path.join(await fs.promises.realpath(f.root), f.mod.CONNECTION_MARKER);
    const promises = new Proxy(fs.promises, {
      get: (target, key) => key === 'writeFile' ? async (...args: Parameters<typeof fs.promises.writeFile>) => {
        if (args[0] === marker) { throw new Error('Marker write failed'); }
        return target.writeFile(...args);
      } : Reflect.get(target, key)
    });
    const fileSystem = new Proxy(fs, { get: (target, key) => key === 'promises' ? promises : Reflect.get(target, key) });
    try {
      await assert.rejects(f.otherWindow(fileSystem).stageFolderConnection(f.context, f.root, f.project, f.inherited), /Marker write failed/);
      assert.strictEqual(await f.pendingCount(), 0);
      assert.strictEqual(fs.existsSync(marker), false);
      assert.strictEqual(fs.existsSync(f.settingsFile), false);
    } finally { await f.clean(); }
  });
  test('a private intent write failure removes its marker without saving settings', async () => {
    const f = await fixture();
    const promises = new Proxy(fs.promises, {
      get: (target, key) => key === 'writeFile' ? async (...args: Parameters<typeof fs.promises.writeFile>) => {
        if (String(args[0]).startsWith(f.pendingFile + '.')) { throw new Error('Pending write failed'); }
        return target.writeFile(...args);
      } : Reflect.get(target, key)
    });
    const fileSystem = new Proxy(fs, { get: (target, key) => key === 'promises' ? promises : Reflect.get(target, key) });
    try {
      await assert.rejects(f.otherWindow(fileSystem).stageFolderConnection(f.context, f.root, f.project, f.inherited), /Pending write failed/);
      assert.strictEqual(await f.pendingCount(), 0);
      assert.strictEqual(fs.existsSync(path.join(f.root, f.mod.CONNECTION_MARKER)), false);
      assert.strictEqual(fs.existsSync(f.settingsFile), false);
    } finally { await f.clean(); }
  });
  test('a settings write failure consumes only its new intent and preserves original settings', async () => {
    const f = await fixture();
    const original = '{"editor.tabSize":4}';
    await fs.promises.mkdir(path.dirname(f.settingsFile));
    await fs.promises.writeFile(f.settingsFile, original);
    const settingsFile = await fs.promises.realpath(f.settingsFile);
    const promises = new Proxy(fs.promises, {
      get: (target, key) => key === 'writeFile' ? async (...args: Parameters<typeof fs.promises.writeFile>) => {
        if (args[0] === settingsFile) { throw new Error('Settings write failed'); }
        return target.writeFile(...args);
      } : Reflect.get(target, key)
    });
    const fileSystem = new Proxy(fs, { get: (target, key) => key === 'promises' ? promises : Reflect.get(target, key) });
    try {
      await assert.rejects(f.otherWindow(fileSystem).stageFolderConnection(f.context, f.root, f.project, f.inherited), /Settings write failed/);
      assert.strictEqual(await f.pendingText(), 'null');
      assert.strictEqual(await fs.promises.readFile(f.settingsFile, 'utf8'), original);
      assert.strictEqual(fs.existsSync(path.join(f.root, f.mod.CONNECTION_MARKER)), false);
      assert.strictEqual(await f.complete(), false);
    } finally { await f.clean(); }
  });
  test('a consume failure never enables synchronization and the destination can be retried', async () => {
    const f = await fixture();
    const promises = new Proxy(fs.promises, {
      get: (target, key) => key === 'writeFile' ? async (...args: Parameters<typeof fs.promises.writeFile>) => {
        if (String(args[0]).startsWith(f.pendingFile + '.')) { throw new Error('Consume write failed'); }
        return target.writeFile(...args);
      } : Reflect.get(target, key)
    });
    const fileSystem = new Proxy(fs, { get: (target, key) => key === 'promises' ? promises : Reflect.get(target, key) });
    try {
      await f.stage();
      const pending = await f.pendingText();
      await assert.rejects(f.otherWindow(fileSystem).completeFolderConnection(f.context), /Consume write failed/);
      assert.strictEqual((await f.settings())['cloudlatex.enabled'], false);
      assert.strictEqual(await f.pendingText(), pending);
      assert.strictEqual(fs.existsSync(path.join(f.root, f.mod.CONNECTION_MARKER)), false);
      await f.stage();
      assert.strictEqual(await f.complete(), true);
    } finally { await f.clean(); }
  });
  test('a rollback consume failure still restores settings without enabling the connection', async () => {
    const f = await fixture();
    let fail = false;
    const promises = new Proxy(fs.promises, {
      get: (target, key) => key === 'writeFile' ? async (...args: Parameters<typeof fs.promises.writeFile>) => {
        if (fail && String(args[0]).startsWith(f.pendingFile + '.')) { throw new Error('Consume write failed'); }
        return target.writeFile(...args);
      } : Reflect.get(target, key)
    });
    const fileSystem = new Proxy(fs, { get: (target, key) => key === 'promises' ? promises : Reflect.get(target, key) });
    try {
      const rollback = await f.otherWindow(fileSystem).stageFolderConnection(f.context, f.root, f.project, f.inherited);
      fail = true;
      await assert.rejects(rollback(), /Consume write failed/);
      assert.strictEqual(fs.existsSync(f.settingsFile), false);
      assert.strictEqual(fs.existsSync(path.join(f.root, f.mod.CONNECTION_MARKER)), false);
      await f.stage();
      assert.strictEqual(await f.complete(), true);
    } finally { await f.clean(); }
  });
  test('an enable failure keeps a consumed handoff disabled and retryable', async () => {
    const f = await fixture();
    const getConfiguration = f.vscode.workspace.getConfiguration;
    try {
      await f.stage();
      f.vscode.workspace.getConfiguration = () => ({ update: async () => { throw new Error('Enable failed'); } });
      await assert.rejects(f.complete(), /Enable failed/);
      assert.strictEqual((await f.settings())['cloudlatex.enabled'], false);
      assert.strictEqual(await f.pendingText(), 'null');
      assert.strictEqual(fs.existsSync(path.join(f.root, f.mod.CONNECTION_MARKER)), false);
      f.vscode.workspace.getConfiguration = getConfiguration;
      await f.stage();
      assert.strictEqual(await f.complete(), true);
    } finally { f.vscode.workspace.getConfiguration = getConfiguration; await f.clean(); }
  });
  test('unknown orphan markers cannot authorize completion or be silently replaced', async () => {
    const f = await fixture();
    try {
      await f.stage();
      await fs.promises.unlink(f.pendingFile);
      const marker = path.join(f.root, f.mod.CONNECTION_MARKER);
      const markerText = await fs.promises.readFile(marker, 'utf8');
      const settingsText = await fs.promises.readFile(f.settingsFile, 'utf8');
      assert.strictEqual(await f.otherWindow().completeFolderConnection(f.context), false);
      await assert.rejects(f.otherWindow().stageFolderConnection(f.context, f.root, f.project, f.inherited));
      assert.strictEqual(await fs.promises.readFile(marker, 'utf8'), markerText);
      assert.strictEqual(await fs.promises.readFile(f.settingsFile, 'utf8'), settingsText);
    } finally { await f.clean(); }
  });
  for (const change of ['nonce', 'endpoint', 'nonempty', 'expired', 'other-storage']) {
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
        if (change === 'expired') { await f.setPending({ expires: 0 }); }
        if (change === 'other-storage') {
          Object.assign(f.context, { globalStorageUri: { fsPath: path.join(f.temp, 'other-global') } });
          assert.strictEqual(await f.complete(), false);
        } else { await assert.rejects(f.complete()); }
        assert.strictEqual((await f.settings())['cloudlatex.enabled'], false);
      } finally { await f.clean(); }
    });
  }
});

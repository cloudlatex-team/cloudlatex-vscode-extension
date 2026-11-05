// Mock API names and setting keys must match VS Code.
/* eslint-disable @typescript-eslint/naming-convention */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { Account } from 'cloudlatex-cli-plugin';
import { ProjectConnection } from '../../projectConnection';

type SettingsModule = typeof import('../../projectConnectionSettings');
type Options = {
  workspace?: Record<string, unknown>;
  effective?: Record<string, unknown>;
  rootMismatch?: boolean;
  missingStorage?: boolean;
  existingAccount?: string;
  failAccountSave?: boolean;
  failUpdate?: (key: string, value: unknown) => boolean;
};
const account: Account = { email: 'author@example.test', client: 'new-client', token: 'private-new-token' };

async function fixture(options: Options = {}) {
  const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cloudlatex-connection-unit-'));
  const root = path.join(temp, 'paper');
  const storage = path.join(temp, 'workspace-storage');
  const globalStorage = path.join(temp, 'global-storage');
  await Promise.all([root, storage, globalStorage].map(directory => fs.promises.mkdir(directory)));
  const accountPath = path.join(globalStorage, 'account.json');
  if (options.existingAccount !== undefined) {
    await fs.promises.writeFile(accountPath, options.existingAccount);
  }
  const workspace: Record<string, unknown> = { ...options.workspace };
  const effective: Record<string, unknown> = { endpoint: 'https://cloudlatex.example.test/api', enabled: false, projectId: 0, ...options.effective };
  const updates: { key: string; value: unknown; target: number }[] = [];
  const savedAccounts: Account[] = [];
  const operations: string[] = [];
  let failedUpdate = false;
  class FileAccountService {
    constructor(private file: string) {
      assert.strictEqual(file, accountPath);
    }
    async save(value: Account) {
      operations.push('save-account');
      savedAccounts.push(value);
      // Simulate a save that can fail after touching the file.
      await fs.promises.writeFile(this.file, JSON.stringify(value));
      if (options.failAccountSave) {
        throw new Error('account save failed');
      }
    }
  }
  const getConfig = () => ({
    get: (key: string, fallback?: unknown) => key in workspace ? workspace[key] : (effective[key] === undefined ? fallback : effective[key]),
    inspect: (key: string) => ({ workspaceValue: workspace[key] }),
    update: async (key: string, value: unknown, target: number) => {
      operations.push(`update-${key}-${String(value)}`);
      if (!failedUpdate && options.failUpdate?.(key, value)) {
        failedUpdate = true;
        throw new Error('settings write failed');
      }
      updates.push({ key, value, target });
      if (value === undefined) {
        delete workspace[key];
      } else {
        workspace[key] = value;
      }
    }
  });
  const sandbox = {
    exports: {},
    require: (name: string) => {
      if (name === 'fs') { return fs; }
      if (name === 'path') { return path; }
      if (name === 'vscode') { return { ConfigurationTarget: { Workspace: 2 } }; }
      if (name === 'cloudlatex-cli-plugin') { return { AccountService: FileAccountService }; }
      if (name === './config') {
        return {
          getRootPath: () => options.rootMismatch ? path.join(temp, 'different') : root,
          getVSConfig: getConfig,
          obtainAccountPath: () => accountPath
        };
      }
      throw new Error(`Unexpected dependency: ${name}`);
    }
  };
  const filename = require.resolve('../../projectConnectionSettings');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  const settings = sandbox.exports as SettingsModule;
  const context = {
    storageUri: options.missingStorage ? undefined : { fsPath: storage },
    globalStorageUri: { fsPath: globalStorage }
  } as Parameters<SettingsModule['saveProjectConnection']>[0];
  const connection: ProjectConnection = {
    rootPath: root,
    endpoint: 'https://cloudlatex.example.test/api',
    project: { id: 42, title: 'My paper', compileTargetFileRemoteId: null },
    account
  };
  return {
    temp, root, storage, accountPath, workspace, effective, updates, savedAccounts, operations, connection,
    save: (selected = connection) => settings.saveProjectConnection(context, selected),
    cleanup: () => fs.promises.rm(temp, { recursive: true, force: true })
  };
}

suite('Project connection settings', () => {
  test('confirmed connection writes only workspace project/enabled settings and enables last', async () => {
    const state = await fixture({ effective: { projectId: 8 }, workspace: { outDir: '.workspace', autoCompile: false } });
    try {
      assert.deepStrictEqual(state.savedAccounts, [], 'construction must not persist unconfirmed credentials');
      await state.save();
      assert.deepStrictEqual(state.updates, [
        { key: 'enabled', value: false, target: 2 },
        { key: 'projectId', value: 42, target: 2 },
        { key: 'enabled', value: true, target: 2 }
      ]);
      assert.strictEqual(state.operations[state.operations.length - 1], 'update-enabled-true');
      assert.ok(state.operations.indexOf('save-account') < state.operations.indexOf('update-enabled-true'));
      assert.strictEqual(state.workspace.outDir, '.workspace');
      assert.strictEqual(state.workspace.autoCompile, false);
      assert.strictEqual(state.effective.projectId, 8, 'global configuration must remain unchanged');
      assert.deepStrictEqual(JSON.parse(await fs.promises.readFile(state.accountPath, 'utf8')), account);
    } finally { await state.cleanup(); }
  });

  test('only selected project metadata is discarded; other metadata and source files survive', async () => {
    const state = await fixture();
    try {
      const selected = path.join(state.storage, '.42-cloudlatex.json');
      const other = path.join(state.storage, '.7-cloudlatex.json');
      const source = path.join(state.root, 'main.tex');
      await fs.promises.writeFile(selected, 'stale sync state');
      await fs.promises.writeFile(other, 'other sync state');
      await fs.promises.writeFile(source, 'local source');
      await state.save();
      assert.strictEqual(fs.existsSync(selected), false);
      assert.strictEqual(await fs.promises.readFile(other, 'utf8'), 'other sync state');
      assert.strictEqual(await fs.promises.readFile(source, 'utf8'), 'local source');
    } finally { await state.cleanup(); }
  });

  test('invalid project IDs fail before touching configuration or credentials', async () => {
    const state = await fixture();
    try {
      for (const id of [0, -1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
        await assert.rejects(state.save({ ...state.connection, project: { id, title: 'invalid', compileTargetFileRemoteId: null } }), /workspace is no longer available/);
      }
      assert.deepStrictEqual(state.updates, []);
      assert.deepStrictEqual(state.savedAccounts, []);
      assert.strictEqual(fs.existsSync(state.accountPath), false);
    } finally { await state.cleanup(); }
  });

  test('changed root, missing storage, changed endpoint or enabled connection rejects without writes', async () => {
    for (const options of [
      { rootMismatch: true }, { missingStorage: true },
      { effective: { endpoint: 'https://different.example.test/api' } },
      { workspace: { enabled: true } }
    ]) {
      const state = await fixture(options);
      try {
        await assert.rejects(state.save());
        assert.deepStrictEqual(state.updates, []);
        assert.deepStrictEqual(state.savedAccounts, []);
        assert.strictEqual(fs.existsSync(state.accountPath), false);
      } finally { await state.cleanup(); }
    }
  });

  test('account save failure restores original account bytes and prior workspace overrides', async () => {
    const previousAccount = '{ "token": "old-token", "client": "old-client" }\n';
    const state = await fixture({ existingAccount: previousAccount, workspace: { projectId: 9, enabled: false }, failAccountSave: true });
    try {
      await assert.rejects(state.save(), /account save failed/);
      assert.strictEqual(await fs.promises.readFile(state.accountPath, 'utf8'), previousAccount);
      assert.strictEqual(state.workspace.projectId, 9);
      assert.strictEqual(state.workspace.enabled, false);
      assert.ok(state.updates.every(update => update.target === 2));
    } finally { await state.cleanup(); }
  });

  test('failed save removes a new account when no credentials previously existed', async () => {
    const state = await fixture({ failAccountSave: true });
    try {
      await assert.rejects(state.save(), /account save failed/);
      assert.strictEqual(fs.existsSync(state.accountPath), false);
      assert.strictEqual('projectId' in state.workspace, false);
      assert.strictEqual('enabled' in state.workspace, false);
    } finally { await state.cleanup(); }
  });

  test('configuration failure before credential save restores config without touching old account', async () => {
    const previousAccount = '{"token":"old-token"}';
    const state = await fixture({ existingAccount: previousAccount, workspace: { projectId: 9 }, failUpdate: key => key === 'projectId' });
    try {
      await assert.rejects(state.save(), /settings write failed/);
      assert.strictEqual(await fs.promises.readFile(state.accountPath, 'utf8'), previousAccount);
      assert.deepStrictEqual(state.savedAccounts, []);
      assert.strictEqual(state.workspace.projectId, 9);
      assert.strictEqual('enabled' in state.workspace, false);
    } finally { await state.cleanup(); }
  });

  test('failure enabling the connection rolls back credentials and workspace configuration', async () => {
    const previousAccount = '{"token":"old-token"}';
    const state = await fixture({ existingAccount: previousAccount, workspace: { projectId: 9, enabled: false }, failUpdate: (key, value) => key === 'enabled' && value === true });
    try {
      await assert.rejects(state.save(), /settings write failed/);
      assert.strictEqual(await fs.promises.readFile(state.accountPath, 'utf8'), previousAccount);
      assert.strictEqual(state.workspace.projectId, 9);
      assert.strictEqual(state.workspace.enabled, false);
    } finally { await state.cleanup(); }
  });

  test('metadata deletion failure rolls back settings and credentials without deleting sources', async () => {
    const previousAccount = '{"token":"old-token"}';
    const state = await fixture({ existingAccount: previousAccount, workspace: { projectId: 9 } });
    try {
      // A directory cannot be removed by the helper non-recursively.
      const selected = path.join(state.storage, '.42-cloudlatex.json');
      await fs.promises.mkdir(selected);
      await fs.promises.writeFile(path.join(selected, 'keep'), 'do not remove');
      await assert.rejects(state.save());
      assert.strictEqual(await fs.promises.readFile(state.accountPath, 'utf8'), previousAccount);
      assert.strictEqual(state.workspace.projectId, 9);
      assert.strictEqual('enabled' in state.workspace, false);
      assert.strictEqual(await fs.promises.readFile(path.join(selected, 'keep'), 'utf8'), 'do not remove');
    } finally { await state.cleanup(); }
  });
});

// VS Code commands and setting names are fixed API keys.
/* eslint-disable @typescript-eslint/naming-convention */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import { Account, AccountService, AppInfo, CompileResult, LatexApp, SyncResult } from 'cloudlatex-cli-plugin';
import { COMMAND_NAMES, STATUS_BAR_TEXT } from '../../const';
import { ProjectConnection } from '../../projectConnection';
import { RegisteredProject } from '../../registeredProjects';
import { SyncDisplayState } from '../../syncDisplayState';

type TestApp = {
  activated: boolean;
  autoCompile: boolean;
  appInfo: AppInfo;
  accountService: AccountService<Account>;
  statusBarItem: { text: string; show(): void };
  latexApp?: Pick<LatexApp, 'sync' | 'compile' | 'stop'>;
  setupCommands(): void;
  connectProject(): Promise<void>;
  registerProject(): Promise<void>;
  connectRegisteredFolder(project: RegisteredProject): Promise<void>;
  handleConfigurationChange(): void;
  startSync(): Promise<void>;
  compile(): Promise<void>;
};
type Lookup = (account: Account) => Promise<{ account: Account; project: ProjectConnection['project'] } | undefined>;
const oldAccount: Account = { email: 'old@example.test', client: 'old-client', token: 'old-token' };
const enteredAccount: Account = { email: 'new@example.test', client: 'new-client', token: 'new-token' };

async function fixture(options: { noFolder?: boolean; enabled?: boolean; lookup?: Lookup; stageFailures?: number } = {}) {
  const temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cl-lifecycle-'));
  const root = path.join(temp, 'source');
  const destination = path.join(temp, 'destination');
  const accountPath = path.join(temp, 'account.json');
  await Promise.all([root, destination].map(folder => fs.promises.mkdir(folder)));
  const project = { id: 42, title: 'Paper', compileTargetFileRemoteId: null };
  const record: RegisteredProject = { id: 42, title: 'Paper', endpoint: 'https://cloudlatex.io/api', lastOpenedAt: 0 };
  const config: Record<string, unknown> = { endpoint: record.endpoint, enabled: options.enabled || false, projectId: 42 };
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const wizardAccounts: (Account | null)[] = [];
  const lookupAccounts: Account[] = [];
  const errors: string[] = [];
  let accountInputs = 0;
  const input = async () => { accountInputs++; return enteredAccount; };
  const vscode = {
    commands: {
      registerCommand: (name: string, callback: (...args: unknown[]) => unknown) => {
        commands.set(name, callback);
        return { dispose: () => undefined };
      },
      executeCommand: async () => undefined
    },
    window: {
      showInputBox: async () => '42',
      showOpenDialog: async () => [{ scheme: 'file', fsPath: destination }],
      showInformationMessage: async () => undefined,
      showWarningMessage: async () => undefined,
      showErrorMessage: async (message: string) => { errors.push(message); },
      withProgress: async (_options: unknown, task: () => Promise<unknown>) => task()
    },
    Uri: { file: (fsPath: string) => ({ scheme: 'file', fsPath }) },
    workspace: { textDocuments: [] },
    ProgressLocation: { Notification: 15 }
  };
  const sandbox = {
    exports: {},
    require: (name: string): unknown => {
      if (name === 'fs' || name === 'path' || name === 'crypto') { return require(name); }
      if (name === './fileLock') { return require('../../fileLock'); }
      if (name === 'vscode') { return vscode; }
      if (name === 'cloudlatex-cli-plugin') { return require(name); }
      if (name === './const') { return require('../../const'); }
      if (name === './locale') { return require('../../locale'); }
      if (name === './config') {
        return {
          getRootPath: () => options.noFolder ? undefined : root,
          getVSConfig: () => ({ get: (key: string, fallback?: unknown) => config[key] === undefined ? fallback : config[key] }),
          obtainAccountPath: () => accountPath
        };
      }
      if (name === './interaction') { return { inputAccount: input, localeStr: (key: string) => key }; }
      if (name === './registeredProjects') {
        const registry = { exports: {}, URL, require: sandbox.require };
        vm.runInNewContext(fs.readFileSync(require.resolve('../../registeredProjects'), 'utf8'), registry);
        return registry.exports;
      }
      if (name === './projectConnection') {
        return {
          parseProjectId: () => 42,
          connectProject: async (saved: Account | null, commit: (connection: ProjectConnection) => Promise<void>) => {
            wizardAccounts.push(saved);
            await commit({ rootPath: root, endpoint: record.endpoint, project, account: saved || await input() });
          },
          loadProjectWithAccount: async (account: Account) => {
            lookupAccounts.push(account);
            return options.lookup ? options.lookup(account) : { account, project };
          }
        };
      }
      if (name === './projectConnectionSettings') {
        return { saveProjectConnection: async (_context: unknown, connection: ProjectConnection) => {
          await new AccountService<Account>(accountPath).save(connection.account);
        } };
      }
      if (name === './folderConnection') {
        let stageFailures = options.stageFailures || 0;
        return { stageFolderConnection: async () => {
          if (stageFailures-- > 0) { throw new Error('Choose an empty local folder'); }
          return async () => undefined;
        } };
      }
      return {};
    }
  };
  const filename = require.resolve('../../extension');
  // Expose the existing class only inside this VM, without changing its API.
  vm.runInNewContext(fs.readFileSync(filename, 'utf8') + '\nexports.TestApp = VSLatexApp;', sandbox, { filename });
  const app = Object.create((sandbox.exports as { TestApp: { prototype: object } }).TestApp.prototype) as TestApp;
  Object.assign(app, {
    context: { subscriptions: [], globalStorageUri: { fsPath: temp } },
    activated: false, autoCompile: false, syncedInitilally: false,
    connectionConfigUpdating: false, connectionSetupRunning: false, backendGeneration: 0,
    accountService: new AccountService<Account>(accountPath),
    statusBarItem: { text: STATUS_BAR_TEXT, show: () => undefined },
    syncDisplayState: new SyncDisplayState(),
    appInfo: { activationStatus: 'active', loginStatus: 'valid', loaded: true, files: [], conflictFiles: [], targetFileCandidates: [] },
    logger: { log: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined },
    projectRegistry: { upsert: async () => undefined },
    currentProject: () => undefined, rerenderSideBar: () => undefined, refreshProjectViews: () => undefined,
    registeredProjectsTree: { refresh: () => undefined },
    updateAppInfo: (info: AppInfo) => { app.appInfo = info; }
  });
  app.setupCommands();
  return {
    app, record, errors, accountPath, wizardAccounts, lookupAccounts,
    accountInputs: () => accountInputs,
    command: async (name: string) => { await commands.get(name)!(); },
    saved: async () => JSON.parse(await fs.promises.readFile(accountPath, 'utf8')),
    clean: () => fs.promises.rm(temp, { recursive: true, force: true })
  };
}

suite('Extension account and backend lifecycle', () => {
  for (const options of [{ noFolder: true }, { enabled: true }]) {
    test(`Set Account accepts credentials when inactive: ${JSON.stringify(options)}`, async () => {
      const f = await fixture(options);
      try {
        await f.command(COMMAND_NAMES.account);
        assert.strictEqual(f.accountInputs(), 1);
        assert.deepStrictEqual(await f.saved(), enteredAccount);
        assert.strictEqual(f.wizardAccounts.length, 0);
      } finally { await f.clean(); }
    });
  }

  for (const flow of ['connectProject', 'connectRegisteredFolder'] as const) {
    test(`${flow} does not reuse credentials deleted by Clear Account`, async () => {
      const f = await fixture();
      try {
        await f.app.accountService.save(oldAccount);
        await f.command(COMMAND_NAMES.clearAccount);
        // The old CLI service retains its memory value; new flows must ignore it.
        assert.deepStrictEqual(f.app.accountService.account, oldAccount);
        if (flow === 'connectProject') {
          await f.app.connectProject();
          assert.deepStrictEqual(f.wizardAccounts, [null]);
        } else {
          await f.app.connectRegisteredFolder(f.record);
          assert.deepStrictEqual(f.lookupAccounts, [enteredAccount]);
        }
        assert.strictEqual(f.accountInputs(), 1);
        assert.deepStrictEqual(await f.saved(), enteredAccount);
      } finally { await f.clean(); }
    });
  }

  for (const flow of ['registerProject', 'connectRegisteredFolder'] as const) {
    test(`${flow} saves credentials returned by authentication recovery`, async () => {
      const f = await fixture({ lookup: async () => ({ account: enteredAccount,
        project: { id: 42, title: 'Paper', compileTargetFileRemoteId: null } }) });
      try {
        await f.app.accountService.save(oldAccount);
        if (flow === 'registerProject') {
          await f.app.registerProject();
        } else {
          await f.app.connectRegisteredFolder(f.record);
        }
        assert.deepStrictEqual(f.lookupAccounts, [oldAccount]);
        assert.deepStrictEqual(await f.saved(), enteredAccount);
      } finally { await f.clean(); }
    });
  }

  test('connectRegisteredFolder keeps re-entered credentials when another folder must be chosen', async () => {
    const f = await fixture({ stageFailures: 1, lookup: async () => ({ account: enteredAccount,
      project: { id: 42, title: 'Paper', compileTargetFileRemoteId: null } }) });
    try {
      await f.app.accountService.save(oldAccount);
      await f.app.connectRegisteredFolder(f.record);
      // The second folder choice uses the recovered credentials, not the expired saved ones.
      assert.deepStrictEqual(f.lookupAccounts, [oldAccount, enteredAccount]);
      assert.deepStrictEqual(await f.saved(), enteredAccount);
    } finally { await f.clean(); }
  });

  for (const operation of ['startSync', 'compile'] as const) {
    test(`configuration changes clear the status bar during ${operation}`, async () => {
      const f = await fixture();
      try {
        let finish!: (result: SyncResult & CompileResult) => void;
        const pending = new Promise<SyncResult & CompileResult>(resolve => { finish = resolve; });
        f.app.activated = true;
        f.app.latexApp = { sync: () => pending, compile: () => pending, stop: async () => undefined };
        const running = f.app[operation]();
        assert.match(f.app.statusBarItem.text, /~spin/);
        f.app.handleConfigurationChange();
        finish({ status: 'success', appInfo: f.app.appInfo } as SyncResult & CompileResult);
        await running;
        assert.strictEqual(f.app.statusBarItem.text, STATUS_BAR_TEXT);
      } finally { await f.clean(); }
    });
  }
});

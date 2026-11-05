// Mock API names and setting keys must match VS Code.
/* eslint-disable @typescript-eslint/naming-convention */
import * as assert from 'assert';
import * as fs from 'fs';
import * as vm from 'vm';
import { EventEmitter } from 'events';
import { Account, Config, ProjectInfo } from 'cloudlatex-cli-plugin';
import { ProjectConnection } from '../../projectConnection';

type ConnectionModule = typeof import('../../projectConnection');
type TestUri = { scheme: string; fsPath: string };
type ProjectResult = { status: string; projects: ProjectInfo[] };
type Options = {
  folders?: TestUri[];
  config?: Record<string, unknown>;
  entries?: [string, number][][];
  enteredAccounts?: (Account | Error)[];
  results?: (ProjectResult | Error)[];
  select?: number | null;
  choices?: (string | undefined)[];
  pickedFolders?: TestUri[];
  onPick?: (config: Record<string, unknown>, folders: { uri: TestUri }[]) => void;
  projectInput?: string;
  get?: (url: URL, options: { headers: Record<string, string> }, callback: (response: MockResponse) => void) => MockRequest;
  fakeTimer?: boolean;
};
type MockRequest = EventEmitter & { destroy: () => void };
type MockResponse = EventEmitter & { statusCode: number; destroy: () => void };

const account: Account = { email: 'author@example.test', client: 'local-client', token: 'private-test-token' };
const project: ProjectInfo = { id: 42, title: 'My paper', compileTargetFileRemoteId: null };

function loadConnection(options: Options = {}) {
  const folders = (options.folders || [{ scheme: 'file', fsPath: '/workspace/paper' }]).map(uri => ({ uri }));
  const config: Record<string, unknown> = {
    endpoint: 'https://cloudlatex.io/api', projectId: 0, enabled: false, ...options.config
  };
  const enteredAccounts = [...(options.enteredAccounts || [account])];
  const results = [...(options.results || [{ status: 'success', projects: [project] }])];
  const choices = [...(options.choices || ['CONNECT_AND_RELOAD'])];
  const directories = [...(options.entries || [[]])];
  const savedInMemory: Account[] = [];
  const createCalls: { config: Config; accountService: object }[] = [];
  const commands: { command: string; args: unknown[] }[] = [];
  const information: { message: string; args: unknown[] }[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const picks: { items: { label: string; description: string; project: ProjectInfo }[]; options: { matchOnDescription: boolean } }[] = [];
  const commits: ProjectConnection[] = [];
  let accountInputs = 0;
  let stops = 0;
  let openDialogs = 0;
  const projectInputs: { validateInput: (value: string) => string | undefined }[] = [];
  let timeoutCallback: (() => void) | undefined;
  let timeoutDelay: number | undefined;
  let timerCleared = false;
  class MemoryAccountService {
    constructor(savePath?: string) {
      assert.strictEqual(savePath, undefined, 'project discovery must never persist credentials');
    }
    async save(value: Account) { savedInMemory.push(value); }
  }
  const moduleSource = require.resolve('../../projectConnection');
  const sandbox = {
    exports: {},
    URL, Buffer,
    setTimeout: options.fakeTimer ? (callback: () => void, delay: number) => {
      timeoutCallback = callback;
      timeoutDelay = delay;
      return 1;
    } : setTimeout,
    clearTimeout: options.fakeTimer ? () => { timerCleared = true; } : clearTimeout,
    require: (name: string) => {
      if (name === './locale' || name === '../locale') { return require('../../locale'); }
      if (name === './const') { return require('../../const'); }
      if (name === 'vscode') {
        return {
          workspace: {
            workspaceFolders: folders,
            fs: { readDirectory: async () => directories.length > 1 ? directories.shift() : directories[0] }
          },
          window: {
            showOpenDialog: async () => { openDialogs++; return options.pickedFolders; },
            showWarningMessage: async (message: string) => { warnings.push(message); return choices.shift(); },
            showErrorMessage: async (message: string) => { errors.push(message); },
            showInformationMessage: async (message: string, ...args: unknown[]) => {
              information.push({ message, args });
              return choices.shift();
            },
            showQuickPick: async (items: { label: string; description: string; project: ProjectInfo }[], pickerOptions: { matchOnDescription: boolean }) => {
              picks.push({ items, options: pickerOptions });
              options.onPick?.(config, folders);
              return options.select === null ? undefined : items[options.select || 0];
            },
            withProgress: async (_options: unknown, task: () => Promise<unknown>) => task(),
            showInputBox: async (inputOptions: { validateInput: (value: string) => string | undefined }) => {
              projectInputs.push(inputOptions);
              return options.projectInput;
            }
          },
          commands: { executeCommand: async (command: string, ...args: unknown[]) => { commands.push({ command, args }); } },
          Uri: { file: (fsPath: string) => ({ scheme: 'file', fsPath }) },
          FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
          ProgressLocation: { Notification: 15 }
        };
      }
      if (name === 'http' || name === 'https') {
        return { get: options.get || (() => { throw new Error('Unexpected transport request'); }) };
      }
      if (name === 'cloudlatex-cli-plugin') {
        return {
          AccountService: MemoryAccountService,
          LatexApp: {
            createApp: async (appConfig: Config, appOptions: { accountService: object }) => {
              createCalls.push({ config: appConfig, accountService: appOptions.accountService });
              return {
                listProjects: async () => {
                  const result = results.shift();
                  if (result instanceof Error) {
                    throw result;
                  }
                  assert.ok(result, 'unexpected extra project listing');
                  return result;
                },
                stop: async () => { stops++; }
                // No start/sync/compile API exists in the mock, so using one fails.
              };
            }
          }
        };
      }
      if (name === './config') {
        return { getVSConfig: () => ({ get: (key: string, fallback?: unknown) => config[key] === undefined ? fallback : config[key] }) };
      }
      if (name === './interaction') {
        return {
          localeStr: (key: string) => key,
          inputAccount: async () => {
            accountInputs++;
            const value = enteredAccounts.shift();
            if (!value || value instanceof Error) {
              throw value || new Error('input canceled');
            }
            return value;
          }
        };
      }
      throw new Error(`Unexpected dependency: ${name}`);
    }
  };
  vm.runInNewContext(fs.readFileSync(moduleSource, 'utf8'), sandbox, { filename: moduleSource });
  const connection = sandbox.exports as ConnectionModule;
  return {
    run: (saved: Account | null = null, commit = async (value: ProjectConnection) => { commits.push(value); }) => connection.connectProject(saved, commit),
    commits, createCalls, savedInMemory, commands, information, warnings, errors, picks, projectInputs,
    api: connection,
    fireTimeout: () => { assert.ok(timeoutCallback); timeoutCallback!(); },
    timeoutDelay: () => timeoutDelay,
    timerCleared: () => timerCleared,
    accountInputs: () => accountInputs, stops: () => stops, openDialogs: () => openDialogs
  };
}

type TransportOptions = {
  status?: number;
  requireUserAgent?: boolean;
  body?: unknown;
  raw?: string;
  chunks?: Buffer[];
  requestError?: Error;
  responseEvent?: 'error' | 'aborted';
  throwOnGet?: boolean;
  neverRespond?: boolean;
};

function mockTransport(options: TransportOptions = {}) {
  const requests: { url: URL; headers: Record<string, string> }[] = [];
  let destroyedRequests = 0;
  let destroyedResponses = 0;
  const get = (url: URL, requestOptions: { headers: Record<string, string> }, callback: (response: MockResponse) => void): MockRequest => {
    requests.push({ url, headers: requestOptions.headers });
    if (options.throwOnGet) {
      throw new Error(`transport error ${account.token}`);
    }
    const request: MockRequest = Object.assign(new EventEmitter(), { destroy: () => { destroyedRequests++; } });
    if (options.requestError) {
      queueMicrotask(() => request.emit('error', options.requestError));
    } else if (!options.neverRespond) {
      queueMicrotask(() => {
        let destroyed = false;
        const response: MockResponse = Object.assign(new EventEmitter(), {
          statusCode: options.requireUserAgent && !requestOptions.headers['user-agent']?.trim()
            ? 403 : options.status === undefined ? 200 : options.status,
          destroy: () => { destroyed = true; destroyedResponses++; }
        });
        callback(response);
        if (destroyed) { return; }
        if (options.responseEvent) {
          response.emit(options.responseEvent, new Error(`response error ${account.token}`));
          return;
        }
        const body = options.raw === undefined
          ? JSON.stringify(options.body === undefined ? { project: { id: 42, title: 'My paper', compile_target_file_id: null } } : options.body)
          : options.raw;
        for (const chunk of options.chunks || [Buffer.from(body)]) {
          response.emit('data', chunk);
          if (destroyed) { return; }
        }
        response.emit('end');
      });
    }
    return request;
  };
  return { get, requests, destroyedRequests: () => destroyedRequests, destroyedResponses: () => destroyedResponses };
}

suite('Project connection wizard', () => {
  test('new credentials are trimmed and persisted only by the confirmed commit callback', async () => {
    const state = loadConnection({ enteredAccounts: [{ email: ' author@example.test ', client: ' local-client ', token: ' private-test-token ' }] });
    await state.run();
    assert.strictEqual(state.accountInputs(), 1);
    assert.strictEqual(state.commits.length, 1);
    const selected = state.commits[0];
    assert.strictEqual(selected.rootPath, '/workspace/paper');
    assert.strictEqual(selected.endpoint, 'https://cloudlatex.io/api');
    assert.strictEqual(selected.project.id, 42);
    assert.strictEqual(selected.account.email, account.email);
    assert.strictEqual(selected.account.client, account.client);
    assert.strictEqual(selected.account.token, account.token);
    const preview = state.information[0];
    assert.ok(preview.message.includes('My paper (#42)'));
    assert.ok(preview.message.includes(selected.account.email));
    assert.ok(preview.message.includes(selected.endpoint));
    assert.ok(preview.message.includes(selected.rootPath));
    assert.ok(!preview.message.includes(account.token));
    assert.strictEqual((preview.args[0] as { modal: boolean }).modal, true);
  });

  test('saved credentials bypass account entry and discovery uses isolated non-watching app', async () => {
    const state = loadConnection();
    await state.run(account);
    assert.strictEqual(state.accountInputs(), 0);
    assert.strictEqual(state.createCalls.length, 1);
    const appConfig = state.createCalls[0].config;
    assert.strictEqual(appConfig.projectId, 0);
    assert.strictEqual(appConfig.storagePath, undefined);
    assert.strictEqual(appConfig.backend, 'cloudlatex');
    assert.strictEqual(appConfig.rootPath, '/workspace/paper');
    assert.strictEqual(appConfig.endpoint, 'https://cloudlatex.io/api');
    assert.strictEqual(state.stops(), 1);
  });

  test('custom endpoint confirmation happens before reading or sending saved credentials', async () => {
    const endpoint = 'https://cloudlatex.example.test/api';
    const canceled = loadConnection({ config: { endpoint }, choices: [undefined] });
    await canceled.run(account);
    assert.strictEqual(canceled.accountInputs(), 0);
    assert.strictEqual(canceled.createCalls.length, 0);
    assert.deepStrictEqual(canceled.savedInMemory, []);
    assert.deepStrictEqual(canceled.commits, []);
    assert.strictEqual(canceled.information[0].message, `CONNECT_CUSTOM_ENDPOINT\n\n${endpoint}`);
    assert.ok(!canceled.information[0].message.includes(account.token));
    assert.strictEqual((canceled.information[0].args[0] as { modal: boolean }).modal, true);

    const accepted = loadConnection({ config: { endpoint }, choices: ['CONNECT_ALLOW_ENDPOINT', 'CONNECT_AND_RELOAD'] });
    await accepted.run(account);
    assert.strictEqual(accepted.createCalls[0].config.endpoint, endpoint);
    assert.strictEqual(accepted.commits[0].endpoint, endpoint);
  });

  test('arbitrary endpoint schemes fail before credential input or project discovery', async () => {
    for (const endpoint of ['file:///tmp/projects', 'javascript:alert(1)', 'ftp://server.test/api']) {
      const state = loadConnection({ config: { endpoint } });
      await state.run(account);
      assert.strictEqual(state.accountInputs(), 0);
      assert.strictEqual(state.createCalls.length, 0);
      assert.deepStrictEqual(state.savedInMemory, []);
      assert.deepStrictEqual(state.commits, []);
      assert.deepStrictEqual(state.errors, ['CONNECT_FAILED']);
    }
  });

  test('default API with trailing slash needs only the project confirmation', async () => {
    const state = loadConnection({ config: { endpoint: 'https://cloudlatex.io/api/' } });
    await state.run(account);
    assert.strictEqual(state.information.length, 1);
    assert.ok(state.information[0].message.startsWith('CONNECT_CONFIRM'));
    assert.strictEqual(state.commits.length, 1);
  });

  test('invalid saved credentials prompt again and use the replacement account', async () => {
    const replacement = { ...account, token: 'replacement-private-token' };
    const state = loadConnection({
      enteredAccounts: [replacement],
      results: [{ status: 'invalid-account', projects: [] }, { status: 'success', projects: [project] }],
      choices: [undefined, 'CONNECT_AND_RELOAD']
    });
    await state.run(account);
    assert.deepStrictEqual(state.warnings, ['CONNECT_ACCOUNT_INVALID']);
    assert.strictEqual(state.accountInputs(), 1);
    assert.strictEqual(state.stops(), 2);
    assert.strictEqual(state.commits[0].account.token, replacement.token);
  });

  test('blank or dismissed account input cancels without discovery or persistence', async () => {
    const state = loadConnection({ enteredAccounts: [new Error('blank account input')] });
    await state.run();
    assert.strictEqual(state.createCalls.length, 0);
    assert.deepStrictEqual(state.commits, []);
    assert.deepStrictEqual(state.errors, []);
  });

  test('canceling project choice or confirmation never commits credentials or settings', async () => {
    for (const options of [{ select: null }, { choices: [undefined] }]) {
      const state = loadConnection(options);
      await state.run(account);
      assert.deepStrictEqual(state.commits, []);
      assert.strictEqual(state.stops(), 1);
    }
  });

  test('offline and failed discovery stop the app without committing or exposing tokens', async () => {
    for (const result of [
      { status: 'offline', projects: [] },
      new Error(`server response contains ${account.token}`)
    ]) {
      const state = loadConnection({ results: [result] });
      await state.run(account);
      assert.deepStrictEqual(state.commits, []);
      assert.strictEqual(state.stops(), 1);
      assert.strictEqual(state.errors.length, 1);
      assert.ok(state.errors.every(error => !error.includes(account.token)));
    }
  });

  test('unavailable index offers URL fallback and cancellation does not persist', async () => {
    const state = loadConnection({ results: [{ status: 'unknown-error', projects: [] }], choices: [undefined] });
    await state.run(account);
    assert.deepStrictEqual(state.warnings, ['PROJECT_LIST_UNAVAILABLE']);
    assert.deepStrictEqual(state.commits, []);
    assert.deepStrictEqual(state.errors, []);
    assert.strictEqual(state.projectInputs.length, 0);
    assert.strictEqual(state.stops(), 1);
  });

  test('URL fallback loads the selected project and confirms its real title before commit', async () => {
    const transport = mockTransport({ body: { project: { id: 42, title: 'Live project title', compile_target_file_id: 80 } } });
    const state = loadConnection({
      results: [{ status: 'unknown-error', projects: [] }],
      choices: ['CONNECT_BY_URL', 'CONNECT_AND_RELOAD'],
      projectInput: 'https://cloudlatex.io/projects/42/edit', get: transport.get
    });
    await state.run(account);
    assert.strictEqual(state.picks.length, 0);
    assert.strictEqual(state.commits[0].project.title, 'Live project title');
    assert.strictEqual(state.commits[0].project.compileTargetFileRemoteId, 80);
    assert.ok(state.information[0].message.includes('Live project title (#42)'));
    assert.strictEqual(state.projectInputs[0].validateInput('https://other.example.test/projects/42/edit'), 'PROJECT_URL_INVALID');
    assert.strictEqual(state.projectInputs[0].validateInput('42'), undefined);
    assert.strictEqual(transport.requests.length, 1);
  });

  test('URL fallback input cancellation and invalid URLs never send a lookup or persist', async () => {
    for (const projectInput of [undefined, 'https://other.example.test/projects/42/edit', '0']) {
      const transport = mockTransport();
      const state = loadConnection({
        results: [{ status: 'unknown-error', projects: [] }], choices: ['CONNECT_BY_URL'],
        projectInput, get: transport.get
      });
      await state.run(account);
      assert.deepStrictEqual(state.commits, []);
      assert.strictEqual(transport.requests.length, 0);
      if (projectInput !== undefined) {
        assert.deepStrictEqual(state.errors, ['PROJECT_URL_INVALID']);
      }
    }
  });

  test('URL fallback lookup errors and rejected final preview do not persist credentials', async () => {
    for (const options of [{ status: 403, choices: ['CONNECT_BY_URL'] }, { status: 200, choices: ['CONNECT_BY_URL', undefined] }]) {
      const transport = mockTransport({ status: options.status });
      const state = loadConnection({
        results: [{ status: 'unknown-error', projects: [] }], choices: options.choices,
        projectInput: '42', get: transport.get
      });
      await state.run(account);
      assert.deepStrictEqual(state.commits, []);
      assert.ok(state.errors.every(message => !message.includes(account.token)));
      if (options.status === 403) {
        assert.deepStrictEqual(state.errors, ['CONNECT_FAILED']);
      }
    }
  });

  test('empty projects show a message without offering a selection', async () => {
    const state = loadConnection({ results: [{ status: 'success', projects: [] }] });
    await state.run(account);
    assert.strictEqual(state.information[0].message, 'NO_PROJECTS');
    assert.deepStrictEqual(state.picks, []);
    assert.deepStrictEqual(state.commits, []);
  });

  test('project picker filters invalid IDs and supports title or project-ID search', async () => {
    const state = loadConnection({ results: [{ status: 'success', projects: [
      { id: 0, title: 'invalid', compileTargetFileRemoteId: null }, { id: -1, title: 'invalid', compileTargetFileRemoteId: null }, { id: 2.5, title: 'invalid', compileTargetFileRemoteId: null },
      { id: NaN, title: 'invalid', compileTargetFileRemoteId: null },
      { id: Number.MAX_SAFE_INTEGER + 1, title: 'invalid', compileTargetFileRemoteId: null }, { id: 7, title: '', compileTargetFileRemoteId: null }, project
    ] }], select: 0 });
    await state.run(account);
    assert.strictEqual(state.picks[0].items.length, 2);
    assert.strictEqual(state.picks[0].items[0].label, '#7');
    assert.strictEqual(state.picks[0].items[0].description, '#7');
    assert.strictEqual(state.picks[0].options.matchOnDescription, true);
    assert.strictEqual(state.commits[0].project.id, 7);
  });

  test('changes to endpoint, project, enabled flag or folder while picker is open prevent commit', async () => {
    const mutations: NonNullable<Options['onPick']>[] = [
      config => { config.endpoint = 'https://other.example.test/api'; },
      config => { config.projectId = 99; },
      config => { config.enabled = true; },
      (_config, folders) => { folders[0].uri.fsPath = '/workspace/another-paper'; }
    ];
    for (const onPick of mutations) {
      const state = loadConnection({ onPick });
      await state.run(account);
      assert.deepStrictEqual(state.commits, []);
      assert.ok(state.warnings.includes('CONNECT_SETTINGS_CHANGED'));
    }
  });

  test('source files appearing after preview prevent connection', async () => {
    const state = loadConnection({ entries: [[], [['main.tex', 1]]] });
    await state.run(account);
    assert.deepStrictEqual(state.commits, []);
    assert.ok(state.warnings.includes('CONNECT_EMPTY_FOLDER_REQUIRED'));
  });

  test('only regular editor or VCS metadata is allowed in the initial folder', async () => {
    const allowed = loadConnection({ entries: [[['.vscode', 2], ['.git', 1], ['.DS_Store', 1]]] });
    await allowed.run(account);
    assert.strictEqual(allowed.commits.length, 1);
    for (const entry of [['main.tex', 1], ['.vscode', 1], ['.git', 64 | 2], ['.DS_Store', 2]] as [string, number][]) {
      const state = loadConnection({ entries: [[entry]] });
      await state.run(account);
      assert.strictEqual(state.createCalls.length, 0);
      assert.deepStrictEqual(state.commits, []);
    }
  });

  test('no root opens a folder picker and returns without discovery', async () => {
    const chosen = { scheme: 'file', fsPath: '/workspace/new-paper' };
    const state = loadConnection({ folders: [], pickedFolders: [chosen] });
    await state.run(account);
    assert.strictEqual(state.openDialogs(), 1);
    assert.strictEqual(state.commands[0].command, 'vscode.openFolder');
    assert.strictEqual((state.commands[0].args[0] as TestUri).fsPath, chosen.fsPath);
    assert.strictEqual(state.createCalls.length, 0);
    assert.deepStrictEqual(state.commits, []);
  });

  test('multi-root or remote workspaces are blocked before account entry', async () => {
    for (const folders of [
      [{ scheme: 'file', fsPath: '/one' }, { scheme: 'file', fsPath: '/two' }],
      [{ scheme: 'vscode-remote', fsPath: '/remote' }]
    ]) {
      const state = loadConnection({ folders });
      await state.run();
      assert.deepStrictEqual(state.warnings, ['CONNECT_SINGLE_FOLDER_ONLY']);
      assert.strictEqual(state.accountInputs(), 0);
      assert.deepStrictEqual(state.commits, []);
    }
  });

  test('existing enabled connection offers another folder and does not replace it', async () => {
    const state = loadConnection({ config: { enabled: true }, choices: ['OPEN_EMPTY_FOLDER'], pickedFolders: [{ scheme: 'file', fsPath: '/new' }] });
    await state.run(account);
    assert.deepStrictEqual(state.warnings, ['CONNECT_EXISTING_CONNECTION']);
    assert.strictEqual(state.openDialogs(), 1);
    assert.strictEqual(state.createCalls.length, 0);
    assert.deepStrictEqual(state.commits, []);
  });

  test('commit errors are reported without exposing server response or token', async () => {
    const state = loadConnection();
    await state.run(account, async () => { throw new Error(`bad response ${account.token}`); });
    assert.deepStrictEqual(state.errors, ['CONNECT_FAILED']);
  });
});

suite('Project URL parsing and token lookup transport', () => {
  test('accepts a positive safe ID or same-origin Cloud LaTeX project URL', () => {
    const { api } = loadConnection();
    for (const input of ['42', ' 00042 ', 'https://cloudlatex.io/projects/42', 'https://cloudlatex.io/projects/42/edit/', 'https://cloudlatex.io/projects/42/edit?locale=ja']) {
      assert.strictEqual(api.parseProjectId(input, 'https://cloudlatex.io/api'), 42);
    }
    assert.strictEqual(api.parseProjectId('http://127.0.0.1:3000/projects/42/edit', 'http://127.0.0.1:3000/api/'), 42);
  });

  test('rejects foreign origins, credentials, invalid paths and unsafe IDs', () => {
    const { api } = loadConnection();
    for (const input of [
      '', '0', '-1', '1.5', '9007199254740992', 'Infinity',
      'https://other.example.test/projects/42/edit', 'http://cloudlatex.io/projects/42/edit',
      'https://cloudlatex.io:444/projects/42/edit', 'https://cloudlatex.io.evil.test/projects/42/edit',
      'https://user:password@cloudlatex.io/projects/42/edit', 'file:///projects/42/edit',
      'https://cloudlatex.io/projects/42/files', 'https://cloudlatex.io/projects/%34%32/edit',
      'https://cloudlatex.io/api/projects/42', '//cloudlatex.io/projects/42/edit'
    ]) {
      assert.strictEqual(api.parseProjectId(input, 'https://cloudlatex.io/api'), undefined, input);
    }
    for (const endpoint of ['file:///api', 'https://user:password@cloudlatex.io/api', 'https://cloudlatex.io/api?x=1', 'https://cloudlatex.io/api#fragment']) {
      assert.strictEqual(api.parseProjectId('42', endpoint), undefined, endpoint);
    }
  });

  test('lookup sends only token authentication headers to the selected API project endpoint', async () => {
    const transport = mockTransport({ body: { project: { id: 42, title: 'Actual local title', compile_target_file_id: 19 } } });
    const { api } = loadConnection({ get: transport.get });
    const actual = await api.loadProjectById(account, 'http://127.0.0.1:3000/api/', 42);
    assert.strictEqual(actual.id, 42);
    assert.strictEqual(actual.title, 'Actual local title');
    assert.strictEqual(actual.compileTargetFileRemoteId, 19);
    assert.strictEqual(transport.requests[0].url.href, 'http://127.0.0.1:3000/api/projects/42');
    assert.deepStrictEqual(Object.keys(transport.requests[0].headers).sort(), ['accept', 'access-token', 'client', 'uid', 'user-agent']);
    assert.strictEqual(transport.requests[0].headers.uid, account.email);
    assert.strictEqual(transport.requests[0].headers.client, account.client);
    assert.strictEqual(transport.requests[0].headers['access-token'], account.token);
    assert.strictEqual(transport.requests[0].headers.accept, 'application/json');
    assert.strictEqual(transport.requests[0].headers['user-agent'], 'cloudlatex-vscode-extension');
  });

  test('lookup succeeds through a gateway that rejects requests without client identification', async () => {
    const transport = mockTransport({ requireUserAgent: true });
    const { api } = loadConnection({ get: transport.get });
    const project = await api.loadProjectById(account, 'https://cloudlatex.io/api', 42);
    assert.strictEqual(project.id, 42);
    assert.strictEqual(transport.requests.length, 1);
    assert.strictEqual(transport.destroyedResponses(), 0);
  });

  test('lookup rejects redirects and authentication failures without forwarding credentials', async () => {
    for (const status of [301, 302, 307, 308, 401, 403, 404, 500]) {
      const transport = mockTransport({ status, raw: account.token });
      const { api } = loadConnection({ get: transport.get });
      await assert.rejects(api.loadProjectById(account, 'https://cloudlatex.io/api', 42), /Project lookup failed/);
      assert.strictEqual(transport.requests.length, 1);
      assert.strictEqual(transport.destroyedResponses(), 1);
    }
  });

  test('lookup rejects malformed, mismatched or incomplete project responses', async () => {
    for (const options of [
      { raw: '<html>sign in</html>' },
      { body: { project: { id: 43, title: 'wrong project' } } },
      { body: { project: { id: '42', title: 'wrong ID type' } } },
      { body: { project: { id: 42 } } },
      { body: { project: { id: 42, title: null } } },
      { body: { project: { id: 42, title: 'valid', compile_target_file_id: {} } } },
      { body: {} }
    ]) {
      const transport = mockTransport(options);
      const { api } = loadConnection({ get: transport.get });
      await assert.rejects(api.loadProjectById(account, 'https://cloudlatex.io/api', 42), /Project lookup failed/);
    }
  });

  test('lookup bounds response size and destroys an oversized response', async () => {
    const transport = mockTransport({ chunks: [Buffer.alloc(1024 * 1024), Buffer.from('x')] });
    const { api } = loadConnection({ get: transport.get });
    await assert.rejects(api.loadProjectById(account, 'https://cloudlatex.io/api', 42), /Project lookup failed/);
    assert.strictEqual(transport.destroyedResponses(), 1);
  });

  test('lookup times out after ten seconds and destroys its request', async () => {
    const transport = mockTransport({ neverRespond: true });
    const state = loadConnection({ get: transport.get, fakeTimer: true });
    const pending = assert.rejects(state.api.loadProjectById(account, 'https://cloudlatex.io/api', 42), /Project lookup failed/);
    assert.strictEqual(state.timeoutDelay(), 10000);
    state.fireTimeout();
    await pending;
    assert.strictEqual(transport.destroyedRequests(), 1);
    assert.strictEqual(state.timerCleared(), true);
  });

  test('request errors, response errors and aborts produce a generic credential-free error', async () => {
    for (const options of [
      { requestError: new Error(`request error ${account.token}`) },
      { responseEvent: 'error' as const }, { responseEvent: 'aborted' as const },
      { throwOnGet: true }
    ]) {
      const transport = mockTransport(options);
      const { api } = loadConnection({ get: transport.get });
      await assert.rejects(api.loadProjectById(account, 'https://cloudlatex.io/api', 42), (error: Error) => {
        assert.strictEqual(error.message, 'Project lookup failed');
        assert.ok(!error.message.includes(account.token));
        return true;
      });
    }
  });

  test('invalid endpoints and project IDs never send token headers', async () => {
    const transport = mockTransport();
    const { api } = loadConnection({ get: transport.get });
    for (const id of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(api.loadProjectById(account, 'https://cloudlatex.io/api', id), /Project lookup failed/);
    }
    for (const endpoint of ['javascript:alert(1)', 'https://user:password@cloudlatex.io/api', 'https://cloudlatex.io/api?x=1']) {
      await assert.rejects(api.loadProjectById(account, endpoint, 42), /Project lookup failed/);
    }
    assert.strictEqual(transport.requests.length, 0);
  });
});

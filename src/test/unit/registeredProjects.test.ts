// API class and enum names must match VS Code in the isolated mock.
/* eslint-disable @typescript-eslint/naming-convention */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as vm from 'vm';
import type { RegisteredProject, RegisteredProjectInput, ProjectRegistry as Registry } from '../../registeredProjects';

type RegistryModule = typeof import('../../registeredProjects');
const storageKey = 'cloudlatex.registeredProjects';

let temp: string;
let nextStorage = 0;
const registries = new Set<Registry>();

class MemoryState {
  readonly storagePath = path.join(temp, String(nextStorage++));
  writes: unknown[] = [];
  constructor(public data: unknown = []) {}
  get<T>(key: string): T | undefined {
    assert.strictEqual(key, storageKey);
    return this.data as T;
  }
  async update(key: string, value: unknown): Promise<void> {
    assert.strictEqual(key, storageKey);
    this.writes.push(value);
    this.data = value;
  }
}

function createRegistry(RegistryClass: typeof Registry, state: MemoryState, storagePath = state.storagePath): Registry {
  const registry = new RegistryClass(state, storagePath);
  registries.add(registry);
  return registry;
}

async function storedProjects(state: MemoryState): Promise<RegisteredProject[]> {
  const stored = JSON.parse(await fs.promises.readFile(path.join(state.storagePath, 'registered-projects.json'), 'utf8'));
  return stored.projects;
}

class MockEmitter {
  private listeners = new Set<(value: unknown) => void>();
  event = (listener: (value: unknown) => void) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };
  fire(value?: unknown): void {
    for (const listener of this.listeners) {
      listener(value);
    }
  }
  dispose(): void { this.listeners.clear(); }
}

function loadRegistry(): RegistryModule {
  const filename = require.resolve('../../registeredProjects');
  const sandbox = {
    exports: {}, URL,
    require: (name: string) => {
      if (name === './locale' || name === '../locale') { return require('../../locale'); }
      if (name === './const') { return require('../../const'); }
      if (name === 'path' || name === 'fs' || name === 'crypto') { return require(name); }
      if (name === './fileLock') { return require('../../fileLock'); }
      if (name === 'vscode') {
        return {
          EventEmitter: MockEmitter,
          TreeItem: class {
            constructor(public label: string, public collapsibleState: number) {}
          },
          ThemeIcon: class { constructor(public id: string) {} },
          TreeItemCollapsibleState: { None: 0 }
        };
      }
      if (name === './interaction') {
        return { localeStr: (key: string) => key };
      }
      throw new Error(`Unexpected dependency: ${name}`);
    }
  };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  return sandbox.exports as RegistryModule;
}

function project(overrides: Partial<RegisteredProject> = {}): RegisteredProject {
  return { id: 42, title: 'Paper', endpoint: 'https://cloudlatex.io/api', rootPath: '/papers/current', lastOpenedAt: 10, ...overrides };
}

function plain<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

suite('Registered Cloud LaTeX projects', () => {
  setup(async () => { temp = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cl-registry-')); });
  teardown(async () => {
    await Promise.all([...registries].map(registry => registry.dispose()));
    registries.clear();
    await fs.promises.rm(temp, { recursive: true, force: true });
  });
  test('canonical endpoint keys normalize origin and trailing slashes without admitting credentials', () => {
    const { normalizeProjectEndpoint } = loadRegistry();
    assert.strictEqual(normalizeProjectEndpoint(' HTTPS://CLOUDLATEX.IO:443/api/// '), 'https://cloudlatex.io/api');
    assert.strictEqual(normalizeProjectEndpoint('http://localhost:3000/'), 'http://localhost:3000');
    for (const value of [
      'ftp://localhost/api', 'cloudlatex.io/api', 'https://u:p@cloudlatex.io/api', 'https://@cloudlatex.io/api',
      'https://cloudlatex.io/api?', 'https://cloudlatex.io/api#', 'https://cloudlatex.io/api?token=secret',
      'https://cloudlatex.io/api#secret', 'https:\\cloudlatex.io\\api', 'https://cloudlatex.io/a\nb'
    ]) {
      assert.strictEqual(normalizeProjectEndpoint(value), undefined, value);
    }
  });

  test('default endpoint recognition normalizes aliases and rejects custom or invalid endpoints', () => {
    const { isDefaultEndpoint } = loadRegistry();
    for (const endpoint of ['https://cloudlatex.io/api', 'https://cloudlatex.io/api/', ' HTTPS://CLOUDLATEX.IO:443/api/// ']) {
      assert.strictEqual(isDefaultEndpoint(endpoint), true, endpoint);
    }
    for (const endpoint of ['http://localhost:3000/api', 'https://cloudlatex.io/custom/api',
      'http://cloudlatex.io/api', 'https://cloudlatex.io:444/api', '',
      'https://user:secret@cloudlatex.io/api', 'https://cloudlatex.io/api?token=secret']) {
      assert.strictEqual(isDefaultEndpoint(endpoint), false, endpoint);
    }
  });

  test('loading validates persisted records, deduplicates endpoint plus ID, and excludes secret fields', async () => {
    const { ProjectRegistry } = loadRegistry();
    const state = new MemoryState([
      { ...project(), token: 'do-not-copy', client: 'private-client' },
      project({ endpoint: 'https://cloudlatex.io/api/', title: 'Latest title', rootPath: undefined, lastOpenedAt: 20 }),
      project({ endpoint: 'http://localhost:3000/api', title: 'Local server', lastOpenedAt: 15 }),
      project({ id: 0 }), project({ id: Number.MAX_SAFE_INTEGER + 1 }),
      project({ endpoint: 'https://user:secret@cloudlatex.io/api' }),
      project({ rootPath: 'relative/path' }), project({ lastOpenedAt: NaN }),
      { id: 4, title: 123, endpoint: 'https://cloudlatex.io/api', lastOpenedAt: 1 }, null
    ]);
    const registry = createRegistry(ProjectRegistry, state);
    const rows = registry.list();
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].title, 'Latest title');
    assert.strictEqual(rows[0].rootPath, '/papers/current');
    assert.ok(!JSON.stringify(rows).includes('do-not-copy'));
    await registry.upsert(project({ id: 99 }));
    assert.ok(!JSON.stringify(await storedProjects(state)).includes('do-not-copy'));
    assert.ok(!JSON.stringify(await storedProjects(state)).includes('private-client'));
    assert.strictEqual(state.writes.length, 0, 'legacy Memento must never be written back');
  });

  test('upsert preserves a known folder binding and returns records sorted by recency then title', async () => {
    const { ProjectRegistry } = loadRegistry();
    const registry = createRegistry(ProjectRegistry, new MemoryState());
    await registry.upsert(project({ title: 'Old title' }));
    await registry.upsert({ id: 42, endpoint: 'https://cloudlatex.io/api/', title: 'Renamed', lastOpenedAt: 50 });
    await registry.upsert(project({ id: 43, title: 'Zulu', lastOpenedAt: 40 }));
    await registry.upsert(project({ id: 44, title: 'Alpha', lastOpenedAt: 40 }));
    assert.deepStrictEqual(plain(registry.list().map(record => record.title)), ['Renamed', 'Alpha', 'Zulu']);
    assert.strictEqual(registry.get('https://cloudlatex.io/api///', 42)?.rootPath, '/papers/current');
    assert.strictEqual(registry.get('http://localhost:3000/api', 42), undefined);
  });

  test('registry snapshots cannot mutate stored metadata or leak caller-owned object references', async () => {
    const { ProjectRegistry } = loadRegistry();
    const state = new MemoryState();
    const registry = createRegistry(ProjectRegistry, state);
    const input = { ...project(), token: 'not-a-persisted-field' };
    const result = await registry.upsert(input);
    input.title = 'Caller changed';
    assert.ok(Object.isFrozen(result));
    const list = registry.list();
    list.pop();
    assert.strictEqual(registry.list().length, 1);
    assert.strictEqual(registry.get(project().endpoint, 42)?.title, 'Paper');
    assert.ok(!JSON.stringify(await storedProjects(state)).includes('not-a-persisted-field'));
    const stored = (plain(await storedProjects(state)) as Record<string, unknown>[])[0];
    assert.deepStrictEqual(Object.keys(stored).sort(), ['endpoint', 'id', 'lastOpenedAt', 'rootPath', 'title']);
  });

  test('concurrent upserts serialize storage writes and keep both project records', async () => {
    const { ProjectRegistry } = loadRegistry();
    const state = new MemoryState();
    const registry = createRegistry(ProjectRegistry, state);
    await registry.load();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const writing = new Promise<void>(resolve => { started = resolve; });
    const writeFile = fs.promises.writeFile;
    let starts = 0;
    fs.promises.writeFile = (async (...args: Parameters<typeof writeFile>) => {
      if (String(args[0]).startsWith(state.storagePath) && String(args[0]).endsWith('.tmp')) {
        starts++;
        if (starts === 1) { started(); await gate; }
      }
      return writeFile(...args);
    }) as typeof writeFile;
    let first: Promise<RegisteredProject> | undefined;
    let second: Promise<RegisteredProject> | undefined;
    try {
      first = registry.upsert(project({ id: 1 }));
      second = registry.upsert(project({ id: 2 }));
      await writing;
      assert.strictEqual(starts, 1);
      assert.strictEqual(registry.list().length, 0, 'unpersisted records must not become visible');
      release();
      await Promise.all([first, second]);
      assert.deepStrictEqual(plain(registry.list().map(record => record.id).sort()), [1, 2]);
      assert.strictEqual((await storedProjects(state)).length, 2);
      assert.strictEqual(starts, 2);
    } finally {
      release();
      await Promise.allSettled([first, second]);
      fs.promises.writeFile = writeFile;
    }
  });

  test('simultaneous saves with separate stale Memento caches preserve both windows additions', async () => {
    const firstModule = loadRegistry();
    const secondModule = loadRegistry();
    const firstState = new MemoryState([project({ id: 1 })]);
    const secondState = new MemoryState(plain(firstState.data));
    const first = createRegistry(firstModule.ProjectRegistry, firstState);
    const second = createRegistry(secondModule.ProjectRegistry, secondState, firstState.storagePath);
    await Promise.all([first.load(), second.load()]);
    await Promise.all([first.upsert(project({ id: 2 })), second.upsert(project({ id: 3 }))]);
    await Promise.all([first.load(), second.load()]);
    assert.deepStrictEqual(plain(first.list().map(record => record.id).sort()), [1, 2, 3]);
    assert.deepStrictEqual(plain(second.list().map(record => record.id).sort()), [1, 2, 3]);
    assert.deepStrictEqual((await storedProjects(firstState)).map(record => record.id).sort(), [1, 2, 3]);
    assert.strictEqual(firstState.writes.length + secondState.writes.length, 0);
  });

  test('sequential additions from two registries preserve projects saved by the other instance', async () => {
    const { ProjectRegistry } = loadRegistry();
    const state = new MemoryState();
    const first = createRegistry(ProjectRegistry, state);
    const second = createRegistry(ProjectRegistry, state);
    await first.upsert(project({ id: 1 }));
    await second.upsert(project({ id: 2 }));
    assert.deepStrictEqual(plain(second.list().map(record => record.id).sort()), [1, 2]);
    assert.deepStrictEqual(plain(await storedProjects(state)), plain(second.list()));
  });

  test('a removal from another registry is not restored by a later addition or removal', async () => {
    const { ProjectRegistry } = loadRegistry();
    for (const operation of ['upsert', 'remove']) {
      const state = new MemoryState([project({ id: 1 }), project({ id: 2 })]);
      const first = createRegistry(ProjectRegistry, state);
      const second = createRegistry(ProjectRegistry, state);
      await first.remove(project().endpoint, 1);
      if (operation === 'upsert') {
        await second.upsert(project({ id: 3 }));
        assert.deepStrictEqual(plain(second.list().map(record => record.id).sort()), [2, 3]);
      } else {
        await second.remove(project().endpoint, 2);
        assert.strictEqual(second.list().length, 0);
      }
      assert.strictEqual(second.get(project().endpoint, 1), undefined);
      assert.deepStrictEqual(plain(await storedProjects(state)), plain(second.list()));
    }
  });

  test('a record removed in another window disappears here even when removing it again is a no-op', async () => {
    const { ProjectRegistry } = loadRegistry();
    const state = new MemoryState([project({ id: 1 }), project({ id: 2 })]);
    const first = createRegistry(ProjectRegistry, state);
    const second = createRegistry(ProjectRegistry, state);
    let changes = 0;
    second.onDidChange(() => changes++);
    await first.remove(project().endpoint, 1);
    assert.ok(second.get(project().endpoint, 1), 'the stale window still lists the record');
    await second.remove(project().endpoint, 1);
    assert.strictEqual(second.get(project().endpoint, 1), undefined);
    assert.deepStrictEqual(plain(second.list().map(record => record.id)), [2]);
    assert.strictEqual(changes, 1);
  });

  test('a failed storage write preserves the prior snapshot and does not poison later updates', async () => {
    const { ProjectRegistry } = loadRegistry();
    const state = new MemoryState([project()]);
    const registry = createRegistry(ProjectRegistry, state);
    await registry.load();
    let changes = 0;
    registry.onDidChange(() => changes++);
    const rename = fs.promises.rename;
    fs.promises.rename = (async (...args: Parameters<typeof rename>) => {
      if (args[1] === path.join(state.storagePath, 'registered-projects.json')) {
        throw new Error('Storage unavailable');
      }
      return rename(...args);
    }) as typeof rename;
    try {
      await assert.rejects(registry.upsert(project({ title: 'Lost title' })), /Storage unavailable/);
    } finally { fs.promises.rename = rename; }
    assert.strictEqual(registry.list()[0].title, 'Paper');
    assert.strictEqual((await storedProjects(state))[0].title, 'Paper');
    assert.strictEqual(changes, 0);
    await registry.upsert(project({ id: 43 }));
    assert.strictEqual(registry.list().length, 2);
    assert.strictEqual(changes, 1);
  });

  test('removal only forgets the selected registry record and retains other folder bindings', async () => {
    const { ProjectRegistry } = loadRegistry();
    const state = new MemoryState([project(), project({ endpoint: 'http://localhost:3000/api' })]);
    const registry = createRegistry(ProjectRegistry, state);
    await registry.remove('https://cloudlatex.io/api/', 42);
    assert.strictEqual(registry.list().length, 1);
    assert.strictEqual(registry.list()[0].rootPath, '/papers/current');
    const stored = await fs.promises.readFile(path.join(state.storagePath, 'registered-projects.json'), 'utf8');
    await registry.remove('https://cloudlatex.io/api', 42);
    assert.strictEqual(await fs.promises.readFile(path.join(state.storagePath, 'registered-projects.json'), 'utf8'), stored);
  });

  test('invalid registrations and removals are rejected without writing storage', async () => {
    const { ProjectRegistry } = loadRegistry();
    const state = new MemoryState();
    const registry = createRegistry(ProjectRegistry, state);
    const invalid: RegisteredProjectInput[] = [
      project({ id: -1 }), project({ id: 1.5 }), project({ endpoint: 'https://cloudlatex.io/api?token=x' }),
      project({ rootPath: 'not/absolute' }), project({ rootPath: '/unsafe\0path' }), project({ lastOpenedAt: -1 })
    ];
    for (const value of invalid) {
      await assert.rejects(registry.upsert(value), /Invalid registered project/);
    }
    await assert.rejects(registry.remove('https://user:secret@cloudlatex.io/api', 42), /Invalid registered project/);
    assert.strictEqual(state.writes.length, 0);
    assert.strictEqual(registry.list().length, 0);
  });

  test('later legacy profile imports do not resurrect removed shortcuts or replace current records', async () => {
    const { ProjectRegistry } = loadRegistry();
    const state = new MemoryState([project({ id: 1 })]);
    const first = createRegistry(ProjectRegistry, state);
    await first.remove(project().endpoint, 1);
    await first.upsert(project({ id: 2, title: 'Current title' }));
    const other = new MemoryState([project({ id: 1, lastOpenedAt: 20 }),
      project({ id: 2, title: 'Old title' }), project({ id: 3 })]);
    const second = createRegistry(ProjectRegistry, other, state.storagePath);
    await second.load();
    assert.strictEqual(second.get(project().endpoint, 1), undefined);
    assert.strictEqual(second.get(project().endpoint, 2)?.title, 'Current title');
    assert.ok(second.get(project().endpoint, 3));
    await second.upsert(project({ id: 1, title: 'Explicitly registered again' }));
    await first.load();
    assert.strictEqual(first.get(project().endpoint, 1)?.title, 'Explicitly registered again');
    const restarted = createRegistry(ProjectRegistry, state);
    await restarted.load();
    assert.strictEqual(restarted.get(project().endpoint, 1)?.title, 'Explicitly registered again');
  });

  test('disk changes refresh another windows tree without requiring a local mutation', async () => {
    const { ProjectRegistry } = loadRegistry();
    const state = new MemoryState();
    const first = createRegistry(ProjectRegistry, state);
    const second = createRegistry(ProjectRegistry, state);
    await Promise.all([first.load(), second.load()]);
    let refreshed!: () => void;
    const changed = new Promise<void>(resolve => { refreshed = resolve; });
    second.onDidChange(() => { if (second.get(project().endpoint, 3)) { refreshed(); } });
    await first.upsert(project({ id: 3 }));
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([changed, new Promise<void>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Registry watcher did not refresh')), 3000);
      })]);
      assert.ok(second.get(project().endpoint, 3));
    } finally { if (timeout) { clearTimeout(timeout); } }
  });

  test('disposal waits for an in-flight refresh to release its file lock', async () => {
    const { ProjectRegistry } = loadRegistry();
    const state = new MemoryState();
    const registry = createRegistry(ProjectRegistry, state);
    await registry.load();
    const file = path.join(state.storagePath, 'registered-projects.json');
    const readFile = fs.promises.readFile;
    let resume!: () => void;
    let paused!: () => void;
    const gate = new Promise<void>(resolve => { resume = resolve; });
    const reading = new Promise<void>(resolve => { paused = resolve; });
    let pause = true;
    fs.promises.readFile = (async (...args: Parameters<typeof readFile>) => {
      const value = await readFile(...args);
      if (args[0] === file && pause) {
        pause = false;
        paused();
        await gate;
      }
      return value;
    }) as typeof readFile;
    let refreshing: Promise<void> | undefined;
    let closing: Promise<void> | undefined;
    try {
      refreshing = registry.load();
      await reading;
      let disposed = false;
      closing = registry.dispose().then(() => { disposed = true; });
      await Promise.resolve();
      assert.strictEqual(disposed, false, 'disposal must wait for the active refresh');
      resume();
      await closing;
      assert.strictEqual(fs.existsSync(file + '.lock'), false);
      await fs.promises.rm(state.storagePath, { recursive: true });
      await registry.load();
      assert.strictEqual(fs.existsSync(state.storagePath), false, 'a disposed watcher must not recreate storage');
    } finally {
      fs.promises.readFile = readFile;
      resume();
      await Promise.allSettled([refreshing, closing]);
    }
  });

  test('invalid shared storage is reported without replacing its contents', async () => {
    const { ProjectRegistry } = loadRegistry();
    const state = new MemoryState([project()]);
    await fs.promises.mkdir(state.storagePath);
    const file = path.join(state.storagePath, 'registered-projects.json');
    await fs.promises.writeFile(file, '{broken');
    const registry = createRegistry(ProjectRegistry, state);
    await assert.rejects(registry.load());
    await assert.rejects(registry.upsert(project({ id: 3 })));
    assert.strictEqual(await fs.promises.readFile(file, 'utf8'), '{broken');
  });

  test('an empty tree offers the registration command', () => {
    const { ProjectRegistry, RegisteredProjectsTreeProvider } = loadRegistry();
    const tree = new RegisteredProjectsTreeProvider(createRegistry(ProjectRegistry, new MemoryState()));
    const rows = tree.getChildren();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].label, 'REGISTER_PROJECT');
    assert.strictEqual(rows[0].description, 'NO_REGISTERED_PROJECTS');
    assert.strictEqual(rows[0].command?.command, 'cloudlatex.registerProject');
    assert.strictEqual(tree.getTreeItem(rows[0]), rows[0]);
    assert.strictEqual(tree.getChildren(rows[0]).length, 0);
  });

  test('default project rows show ID, binding and active state without endpoint details', () => {
    const { ProjectRegistry, RegisteredProjectsTreeProvider } = loadRegistry();
    const registry = createRegistry(ProjectRegistry, new MemoryState([project()]));
    const tree = new RegisteredProjectsTreeProvider(registry, { endpoint: 'https://cloudlatex.io/api/', id: 42, rootPath: '/papers/current' });
    const row = tree.getChildren()[0];
    assert.strictEqual(row.contextValue, 'registeredProject');
    assert.strictEqual(row.description, 'REGISTERED_PROJECT_ACTIVE · #42 · /papers/current');
    assert.strictEqual(row.tooltip, 'Paper (#42)\n/papers/current');
    assert.strictEqual(row.command?.command, 'cloudlatex.openRegisteredProject');
    assert.deepStrictEqual(plain(row.command?.arguments?.[0]), project());
  });

  test('normalized default endpoint aliases do not add server details to the row or tooltip', () => {
    const { ProjectRegistry, RegisteredProjectsTreeProvider } = loadRegistry();
    for (const endpoint of ['https://cloudlatex.io/api/', ' HTTPS://CLOUDLATEX.IO:443/api/// ']) {
      const registry = createRegistry(ProjectRegistry, new MemoryState([project({ endpoint })]));
      const tree = new RegisteredProjectsTreeProvider(registry);
      const row = tree.getChildren()[0];
      assert.strictEqual(row.description, '#42 · /papers/current');
      assert.strictEqual(row.tooltip, 'Paper (#42)\n/papers/current');
      assert.deepStrictEqual(plain(row.command?.arguments?.[0]), project());
    }
  });

  test('custom endpoint rows retain origin, endpoint and local binding in the tooltip and open arguments', () => {
    const { ProjectRegistry, RegisteredProjectsTreeProvider } = loadRegistry();
    for (const endpoint of ['http://localhost:3000/api', 'https://cloudlatex.io/custom/api']) {
      const record = project({ endpoint });
      const registry = createRegistry(ProjectRegistry, new MemoryState([record]));
      const tree = new RegisteredProjectsTreeProvider(registry);
      const row = tree.getChildren()[0];
      assert.strictEqual(row.description, `${new URL(endpoint).origin} · #42 · /papers/current`);
      assert.strictEqual(row.tooltip, `Paper (#42)\n${endpoint}\n/papers/current`);
      assert.strictEqual(row.command?.command, 'cloudlatex.openRegisteredProject');
      assert.deepStrictEqual(plain(row.command?.arguments?.[0]), record);
    }
  });

  test('tree refresh updates the active binding and registry changes trigger the event', async () => {
    const { ProjectRegistry, RegisteredProjectsTreeProvider } = loadRegistry();
    const registry = createRegistry(ProjectRegistry, new MemoryState([project()]));
    const tree = new RegisteredProjectsTreeProvider(registry, { endpoint: project().endpoint, id: 42, rootPath: '/other/folder' });
    let changes = 0;
    tree.onDidChangeTreeData(() => changes++);
    assert.ok(!String(tree.getChildren()[0].description).includes('REGISTERED_PROJECT_ACTIVE'));
    tree.refresh({ endpoint: project().endpoint, id: 42, rootPath: '/papers/current' });
    assert.ok(String(tree.getChildren()[0].description).includes('REGISTERED_PROJECT_ACTIVE'));
    await registry.upsert(project({ id: 43, rootPath: undefined }));
    assert.strictEqual(changes, 2);
    assert.ok(tree.getChildren().some(row => String(row.description).includes('REGISTERED_PROJECT_NO_FOLDER')));
    tree.dispose();
    await registry.remove(project().endpoint, 42);
    assert.strictEqual(changes, 2);
  });

  test('context menu removal accepts the tree item and removes only that endpoint and project', async () => {
    const { ProjectRegistry, RegisteredProjectsTreeProvider } = loadRegistry();
    const local = project({ endpoint: 'http://localhost:3000/api' });
    const state = new MemoryState([project(), local]);
    const registry = createRegistry(ProjectRegistry, state);
    const tree = new RegisteredProjectsTreeProvider(registry);
    const row = tree.getChildren().find(item => item.command?.arguments?.[0].endpoint === local.endpoint);
    assert.ok(row);
    await tree.removeProject(row);
    assert.strictEqual(registry.get(local.endpoint, local.id), undefined);
    assert.deepStrictEqual(plain(registry.list()), [project()]);
    assert.deepStrictEqual(plain(await storedProjects(state)), [project()]);
    assert.strictEqual(tree.getChildren().length, 1);
  });

  test('context menu removal ignores missing entries and the empty-list action', async () => {
    const { ProjectRegistry, RegisteredProjectsTreeProvider } = loadRegistry();
    const state = new MemoryState();
    const registry = createRegistry(ProjectRegistry, state);
    const tree = new RegisteredProjectsTreeProvider(registry);
    await tree.removeProject();
    await tree.removeProject(tree.getChildren()[0]);
    assert.strictEqual(state.writes.length, 0);
    assert.strictEqual(tree.getChildren()[0].command?.command, 'cloudlatex.registerProject');
  });
});

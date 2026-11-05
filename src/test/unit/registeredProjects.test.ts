// API class and enum names must match VS Code in the isolated mock.
/* eslint-disable @typescript-eslint/naming-convention */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import type { RegisteredProject, RegisteredProjectInput } from '../../registeredProjects';

type RegistryModule = typeof import('../../registeredProjects');
const storageKey = 'cloudlatex.registeredProjects';

class MemoryState {
  writes: unknown[] = [];
  failNext = false;
  beforeWrite?: () => Promise<void>;
  constructor(public data: unknown = []) {}
  get<T>(key: string): T | undefined {
    assert.strictEqual(key, storageKey);
    return this.data as T;
  }
  async update(key: string, value: unknown): Promise<void> {
    assert.strictEqual(key, storageKey);
    if (this.beforeWrite) {
      await this.beforeWrite();
    }
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Storage unavailable');
    }
    this.writes.push(value);
    this.data = value;
  }
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
      if (name === 'path') {
        return path;
      }
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
    const registry = new ProjectRegistry(state);
    const rows = registry.list();
    assert.strictEqual(rows.length, 2);
    assert.strictEqual(rows[0].title, 'Latest title');
    assert.strictEqual(rows[0].rootPath, '/papers/current');
    assert.ok(!JSON.stringify(rows).includes('do-not-copy'));
    await registry.upsert(project({ id: 99 }));
    assert.ok(!JSON.stringify(state.data).includes('do-not-copy'));
    assert.ok(!JSON.stringify(state.data).includes('private-client'));
  });

  test('upsert preserves a known folder binding and returns records sorted by recency then title', async () => {
    const { ProjectRegistry } = loadRegistry();
    const registry = new ProjectRegistry(new MemoryState());
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
    const registry = new ProjectRegistry(state);
    const input = { ...project(), token: 'not-a-persisted-field' };
    const result = await registry.upsert(input);
    input.title = 'Caller changed';
    assert.ok(Object.isFrozen(result));
    const list = registry.list();
    list.pop();
    assert.strictEqual(registry.list().length, 1);
    assert.strictEqual(registry.get(project().endpoint, 42)?.title, 'Paper');
    assert.ok(!JSON.stringify(state.data).includes('not-a-persisted-field'));
    const stored = (plain(state.data) as Record<string, unknown>[])[0];
    assert.deepStrictEqual(Object.keys(stored).sort(), ['endpoint', 'id', 'lastOpenedAt', 'rootPath', 'title']);
  });

  test('concurrent upserts serialize storage writes and keep both project records', async () => {
    const { ProjectRegistry } = loadRegistry();
    const state = new MemoryState();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let starts = 0;
    state.beforeWrite = async () => { starts++; if (starts === 1) { await gate; } };
    const registry = new ProjectRegistry(state);
    const first = registry.upsert(project({ id: 1 }));
    const second = registry.upsert(project({ id: 2 }));
    await Promise.resolve();
    assert.strictEqual(starts, 1);
    assert.strictEqual(registry.list().length, 0, 'unpersisted records must not become visible');
    release();
    await Promise.all([first, second]);
    assert.deepStrictEqual(plain(registry.list().map(record => record.id).sort()), [1, 2]);
    assert.strictEqual((state.data as unknown[]).length, 2);
    assert.strictEqual(state.writes.length, 2);
  });

  test('a failed storage write preserves the prior snapshot and does not poison later updates', async () => {
    const { ProjectRegistry } = loadRegistry();
    const state = new MemoryState([project()]);
    const registry = new ProjectRegistry(state);
    let changes = 0;
    registry.onDidChange(() => changes++);
    state.failNext = true;
    await assert.rejects(registry.upsert(project({ title: 'Lost title' })), /Storage unavailable/);
    assert.strictEqual(registry.list()[0].title, 'Paper');
    assert.strictEqual(changes, 0);
    await registry.upsert(project({ id: 43 }));
    assert.strictEqual(registry.list().length, 2);
    assert.strictEqual(changes, 1);
  });

  test('removal only forgets the selected registry record and retains other folder bindings', async () => {
    const { ProjectRegistry } = loadRegistry();
    const state = new MemoryState([project(), project({ endpoint: 'http://localhost:3000/api' })]);
    const registry = new ProjectRegistry(state);
    await registry.remove('https://cloudlatex.io/api/', 42);
    assert.strictEqual(registry.list().length, 1);
    assert.strictEqual(registry.list()[0].rootPath, '/papers/current');
    const writes = state.writes.length;
    await registry.remove('https://cloudlatex.io/api', 42);
    assert.strictEqual(state.writes.length, writes);
  });

  test('invalid registrations and removals are rejected without writing storage', async () => {
    const { ProjectRegistry } = loadRegistry();
    const state = new MemoryState();
    const registry = new ProjectRegistry(state);
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

  test('an empty tree offers the registration command', () => {
    const { ProjectRegistry, RegisteredProjectsTreeProvider } = loadRegistry();
    const tree = new RegisteredProjectsTreeProvider(new ProjectRegistry(new MemoryState()));
    const rows = tree.getChildren();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].label, 'REGISTER_PROJECT');
    assert.strictEqual(rows[0].description, 'NO_REGISTERED_PROJECTS');
    assert.strictEqual(rows[0].command?.command, 'cloudlatex.registerProject');
    assert.strictEqual(tree.getTreeItem(rows[0]), rows[0]);
    assert.strictEqual(tree.getChildren(rows[0]).length, 0);
  });

  test('tree rows display origin, ID, binding and active state with token-free open arguments', () => {
    const { ProjectRegistry, RegisteredProjectsTreeProvider } = loadRegistry();
    const registry = new ProjectRegistry(new MemoryState([project()]));
    const tree = new RegisteredProjectsTreeProvider(registry, { endpoint: 'https://cloudlatex.io/api/', id: 42, rootPath: '/papers/current' });
    const row = tree.getChildren()[0];
    assert.strictEqual(row.contextValue, 'registeredProject');
    assert.strictEqual(row.description, 'REGISTERED_PROJECT_ACTIVE · https://cloudlatex.io · #42 · /papers/current');
    assert.strictEqual(row.command?.command, 'cloudlatex.openRegisteredProject');
    assert.deepStrictEqual(plain(row.command?.arguments?.[0]), project());
  });

  test('tree refresh updates the active binding and registry changes trigger the event', async () => {
    const { ProjectRegistry, RegisteredProjectsTreeProvider } = loadRegistry();
    const registry = new ProjectRegistry(new MemoryState([project()]));
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
});

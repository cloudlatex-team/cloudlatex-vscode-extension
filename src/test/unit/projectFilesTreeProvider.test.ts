/* eslint-disable @typescript-eslint/naming-convention */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { AppInfo, FileInfo } from 'cloudlatex-cli-plugin';
import type { ProjectFileItem, ProjectFilesSnapshot, ProjectSyncPhase } from '../../projectFilesTreeProvider';

type ProviderModule = typeof import('../../projectFilesTreeProvider');

function loadProvider(pathApi = path.posix) {
  const events: unknown[] = [];
  let disposed = false;
  class TreeItem {
    constructor(public label: string, public collapsibleState: number) {}
  }
  class ThemeIcon {
    constructor(public id: string) {}
  }
  class EventEmitter {
    event = () => undefined;
    fire(value: unknown) { events.push(value); }
    dispose() { disposed = true; }
  }
  const templates: Record<string, string> = {
    FILES_COUNT: '{count} files',
    FILES_PENDING: '{count} pending',
    FILES_CONFLICTS: '{count} conflicts',
    FILES_LAST_SYNC: 'Last sync {time}',
    FILES_INVALID_PATHS: '{count} unsafe paths ignored'
  };
  const sandbox = {
    exports: {},
    require: (name: string) => {
      if (name === './locale' || name === '../locale') { return require('../../locale'); }
      if (name === './const') { return require('../../const'); }
      if (name === 'path') {
        return pathApi;
      }
      if (name === 'vscode') {
        return {
          TreeItem, ThemeIcon, EventEmitter,
          TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
          Uri: { file: (fsPath: string) => ({ fsPath, scheme: 'file' }) }
        };
      }
      if (name === './interaction') {
        return { localeStr: (key: string) => templates[key] || key };
      }
      throw new Error(`Unexpected dependency: ${name}`);
    }
  };
  const filename = require.resolve('../../projectFilesTreeProvider');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  return { module: sandbox.exports as ProviderModule, events, isDisposed: () => disposed };
}

function file(relativePath: string, overrides: Partial<FileInfo> = {}): FileInfo {
  return {
    id: 1, isFolder: false, relativePath, url: '', remoteRevision: 'r1', localRevision: 'r1',
    localChange: 'no', remoteChange: 'no', changeLocation: 'no', remoteId: 1, watcherSynced: true,
    ...overrides
  };
}

function snapshot(files: FileInfo[] = [], overrides: Partial<ProjectFilesSnapshot> = {}): ProjectFilesSnapshot {
  const appInfo: AppInfo = {
    activationStatus: 'active', loginStatus: 'valid', loaded: true,
    conflictFiles: [], files, targetFileCandidates: []
  };
  return { rootPath: '/workspace/paper', appInfo, phase: 'ready', ...overrides };
}

function names(items: ProjectFileItem[]): string[] {
  return Array.from(items, item => String(item.label));
}

suite('CL project files and synchronization tree', () => {
  test('builds sorted hierarchy from flat core metadata, including inferred folders', () => {
    const { module } = loadProvider();
    const provider = new module.ProjectFilesTreeProvider(snapshot([
      file('z.tex'), file('figures/b.png'), file('figures', { isFolder: true }),
      file('chapters/part/main.tex'), file('a.tex'), file('figures/a.png')
    ]));
    const roots = provider.getChildren();
    assert.deepStrictEqual(names(roots.slice(1)), ['chapters', 'figures', 'a.tex', 'z.tex']);
    const chapters = roots[1];
    const part = provider.getChildren(chapters)[0];
    const main = provider.getChildren(part)[0];
    assert.strictEqual(main.relativePath, 'chapters/part/main.tex');
    assert.strictEqual(provider.getParent(main), part);
    assert.strictEqual(main.command?.command, 'cloudlatex.openProjectFile');
    assert.strictEqual(main.command?.arguments?.[0], '/workspace/paper/chapters/part/main.tex');
    assert.strictEqual(main.resourceUri?.fsPath, '/workspace/paper/chapters/part/main.tex');
    assert.strictEqual(main.contextValue, 'cloudlatexProjectFile');
    assert.strictEqual(chapters.command, undefined);
    assert.strictEqual(roots[0].description, '5 files');
  });

  test('rejects traversal, absolute, drive, UNC and null-byte paths before making commands', () => {
    const { module } = loadProvider();
    const unsafe = ['../outside.tex', '/tmp/private.tex', 'C:\\private.tex', '\\\\server\\private.tex',
      'chapters/../main.tex', 'chapters//main.tex', 'bad\0name.tex', './main.tex'];
    const provider = new module.ProjectFilesTreeProvider(snapshot([
      ...unsafe.map(relative => file(relative)), file('安全な原稿.tex')
    ]));
    const roots = provider.getChildren();
    assert.deepStrictEqual(names(roots.slice(1)), ['安全な原稿.tex']);
    assert.ok(String(roots[0].tooltip).includes(`${unsafe.length} unsafe paths ignored`));
    assert.strictEqual(roots[1].command?.arguments?.[0], '/workspace/paper/安全な原稿.tex');
  });

  test('normalizes relative Windows paths but never accepts an absolute tracked path', () => {
    const { module } = loadProvider(path.win32);
    const provider = new module.ProjectFilesTreeProvider(snapshot([
      file('chapters\\main.tex'), file('D:\\secrets.tex')
    ], { rootPath: 'C:\\paper', dirtyPaths: ['C:\\paper\\chapters\\main.tex', 'D:\\secrets.tex'] }));
    const chapters = provider.getChildren()[1];
    const main = provider.getChildren(chapters)[0];
    assert.strictEqual(main.command?.arguments?.[0], 'C:\\paper\\chapters\\main.tex');
    assert.ok(String(main.description).includes('FILE_UNSAVED'));
    assert.ok(String(provider.getChildren()[0].tooltip).includes('1 unsafe paths ignored'));
  });

  test('distinguishes local, remote, conflict and synchronized changes', () => {
    const { module } = loadProvider();
    const provider = new module.ProjectFilesTreeProvider(snapshot([
      file('create.tex', { localChange: 'create' }), file('update.tex', { localChange: 'update' }),
      file('delete.tex', { localChange: 'delete' }), file('remote-new.tex', { remoteChange: 'create' }),
      file('remote-edit.tex', { remoteChange: 'update' }), file('remote-delete.tex', { remoteChange: 'delete' }),
      file('conflict.tex', { localChange: 'update', remoteChange: 'update' }), file('synced.tex')
    ]));
    const lookup = new Map(provider.getChildren().slice(1).map(item => [String(item.label), item]));
    const expected: Record<string, string> = {
      'create.tex': 'FILE_SYNC_LOCAL_CREATE', 'update.tex': 'FILE_SYNC_LOCAL_UPDATE',
      'delete.tex': 'FILE_SYNC_LOCAL_DELETE', 'remote-new.tex': 'FILE_SYNC_REMOTE_CREATE',
      'remote-edit.tex': 'FILE_SYNC_REMOTE_UPDATE', 'remote-delete.tex': 'FILE_SYNC_REMOTE_DELETE',
      'conflict.tex': 'FILE_SYNC_CONFLICT_FILE', 'synced.tex': 'FILE_SYNCED'
    };
    for (const [name, label] of Object.entries(expected)) {
      assert.strictEqual(lookup.get(name)?.description, label);
    }
    assert.strictEqual(lookup.get('delete.tex')?.command, undefined);
    assert.ok(lookup.get('remote-delete.tex')?.command);
    const summary = provider.getChildren()[0];
    assert.strictEqual(summary.label, 'FILE_SYNC_CONFLICT');
    assert.strictEqual(summary.description, '8 files · 7 pending · 1 conflicts');
  });

  test('marks compile target without changing file opening or metadata', () => {
    const { module } = loadProvider();
    const main = file('main.tex');
    const initial = snapshot([main]);
    initial.appInfo.targetFile = main;
    const provider = new module.ProjectFilesTreeProvider(initial);
    const item = provider.getChildren()[1];
    assert.strictEqual(item.description, 'FILE_SYNCED · FILE_COMPILE_TARGET');
    assert.strictEqual(main.localChange, 'no');
    assert.strictEqual(main.remoteChange, 'no');
  });

  test('uses unsaved editor state only for tracked documents inside the current root', () => {
    const state = loadProvider();
    const main = file('main.tex');
    const provider = new state.module.ProjectFilesTreeProvider(snapshot([main, file('other.tex')]));
    const stableId = provider.getChildren()[1].id;
    provider.setDirtyPaths(['/workspace/paper/main.tex', '/workspace/paper-other/other.tex', '../other.tex']);
    const items = provider.getChildren();
    assert.strictEqual(items[0].label, '1 pending');
    assert.strictEqual(items[0].description, '2 files');
    assert.ok(String(items[0].tooltip).includes('1 pending'));
    assert.strictEqual(items[1].description, 'FILE_UNSAVED');
    assert.strictEqual(items[2].description, 'FILE_SYNCED');
    assert.strictEqual(items[1].id, stableId);
    assert.strictEqual(main.localChange, 'no');
    assert.strictEqual(state.events.length, 1);
    provider.setDirtyPaths([]);
    assert.strictEqual(provider.getChildren()[0].label, 'FILE_SYNC_READY');
    assert.strictEqual(state.events.length, 2);
    provider.dispose();
    assert.ok(state.isDisposed());
  });

  test('aggregates pending descendants and conflicts without counting synchronized siblings', () => {
    const { module } = loadProvider();
    const provider = new module.ProjectFilesTreeProvider(snapshot([
      file('chapters/one.tex', { localChange: 'update' }), file('chapters/two.tex'),
      file('assets/sub/conflict.png', { changeLocation: 'both' })
    ]));
    const roots = provider.getChildren();
    const assets = roots.find(item => item.label === 'assets')!;
    const chapters = roots.find(item => item.label === 'chapters')!;
    assert.strictEqual(assets.description, 'FILE_SYNC_CONFLICT_FILE');
    assert.strictEqual(chapters.description, '1 pending');
    assert.strictEqual(roots[0].description, '3 files · 2 pending · 1 conflicts');
  });

  test('shows lifecycle phase, latest successful sync time and error detail', () => {
    const { module } = loadProvider();
    const phases: [ProjectSyncPhase, string][] = [
      ['inactive', 'FILE_SYNC_INACTIVE'], ['ready', 'FILE_SYNC_READY'], ['syncing', 'FILE_SYNC_SYNCING'],
      ['offline', 'FILE_SYNC_OFFLINE'], ['conflict', 'FILE_SYNC_CONFLICT'], ['error', 'FILE_SYNC_ERROR']
    ];
    const provider = new module.ProjectFilesTreeProvider(snapshot([file('main.tex')]));
    for (const [phase, label] of phases) {
      provider.update(snapshot([file('main.tex')], { phase, lastSyncedAt: 1700000000000, detail: 'Local request failed' }));
      const summary = provider.getChildren()[0];
      assert.strictEqual(summary.label, label);
      assert.ok(String(summary.tooltip).includes('Last sync '));
      assert.ok(String(summary.tooltip).includes('Local request failed'));
      assert.strictEqual(summary.command, undefined);
    }
  });

  test('empty and unconnected workspaces show explicit empty states', () => {
    const { module } = loadProvider();
    const provider = new module.ProjectFilesTreeProvider(snapshot([], { phase: 'inactive' }));
    assert.deepStrictEqual(names(provider.getChildren()), ['FILE_SYNC_INACTIVE', 'FILES_EMPTY']);
    provider.update(snapshot([file('main.tex')], { rootPath: undefined, phase: 'inactive' }));
    assert.deepStrictEqual(names(provider.getChildren()), ['FILE_SYNC_INACTIVE', 'FILES_NO_PROJECT']);
    assert.strictEqual(provider.getChildren()[1].command, undefined);
  });

  test('malformed file/folder collisions retain a safe expandable parent', () => {
    const { module } = loadProvider();
    const provider = new module.ProjectFilesTreeProvider(snapshot([file('folder'), file('folder/main.tex')]));
    const roots = provider.getChildren();
    assert.strictEqual(roots[1].kind, 'folder');
    assert.strictEqual(roots[1].command, undefined);
    assert.strictEqual(provider.getChildren(roots[1])[0].relativePath, 'folder/main.tex');
    assert.ok(String(roots[0].tooltip).includes('1 unsafe paths ignored'));
  });
});

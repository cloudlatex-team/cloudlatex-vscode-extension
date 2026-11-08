import { COMMAND_NAMES } from './const';
import { MESSAGE_TYPE } from './locale';
import * as path from 'path';
import * as vscode from 'vscode';
import { AppInfo, FileInfo } from 'cloudlatex-cli-plugin';
import { localeStr } from './interaction';

export type ProjectSyncPhase = 'inactive' | 'ready' | 'syncing' | 'offline' | 'conflict' | 'error';
export type ProjectFilesSnapshot = {
  rootPath?: string;
  appInfo: AppInfo;
  phase: ProjectSyncPhase;
  lastSyncedAt?: number;
  detail?: string;
  /** Workspace-relative paths or absolute local document paths. */
  dirtyPaths?: string[];
};

type ItemKind = 'summary' | 'empty' | 'folder' | 'file';

type FileState = {
  conflict: boolean;
  pending: boolean;
  dirty: boolean;
  pendingCount: number;
  description: string;
  icon: string;
};

export class ProjectFileItem extends vscode.TreeItem {
  readonly children: ProjectFileItem[] = [];
  parent?: ProjectFileItem;
  info?: FileInfo;
  state?: FileState;

  constructor(
    public readonly kind: ItemKind,
    label: string,
    public readonly relativePath?: string
  ) {
    super(label, kind === 'folder' ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
  }
}

// This provider only presents tracked local paths and synchronization metadata.
// Opening files is handled by the extension command, which checks file existence.
export class ProjectFilesTreeProvider implements vscode.TreeDataProvider<ProjectFileItem>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<ProjectFileItem | undefined>();
  readonly onDidChangeTreeData: vscode.Event<ProjectFileItem | undefined> = this._onDidChangeTreeData.event;
  private snapshot: ProjectFilesSnapshot;
  private items: ProjectFileItem[] = [];

  constructor(snapshot: ProjectFilesSnapshot = {
    phase: 'inactive',
    appInfo: {
      activationStatus: 'inactive', loginStatus: 'offline', loaded: false,
      files: [], conflictFiles: [], targetFileCandidates: []
    }
  }) {
    this.snapshot = snapshot;
    this.rebuild();
  }

  update(snapshot: ProjectFilesSnapshot): void {
    this.snapshot = snapshot;
    this.rebuild();
    this._onDidChangeTreeData.fire(undefined);
  }

  setDirtyPaths(dirtyPaths: string[]): void {
    this.update({ ...this.snapshot, dirtyPaths });
  }

  getTreeItem(item: ProjectFileItem): vscode.TreeItem {
    return item;
  }

  getChildren(item?: ProjectFileItem): ProjectFileItem[] {
    return item ? item.children : this.items;
  }

  getParent(item: ProjectFileItem): ProjectFileItem | undefined {
    return item.parent;
  }

  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  private relativePath(raw: string): string | undefined {
    const normalized = raw.replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.includes('\0')) {
      return undefined;
    }
    const parts = normalized.split('/');
    if (parts.some(part => !part || part === '.' || part === '..')) {
      return undefined;
    }
    return parts.join('/');
  }

  private localPath(relativePath: string): string | undefined {
    if (!this.snapshot.rootPath) {
      return undefined;
    }
    const root = path.resolve(this.snapshot.rootPath);
    const resolved = path.resolve(root, ...relativePath.split('/'));
    const relative = path.relative(root, resolved);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      return undefined;
    }
    return resolved;
  }

  private dirtyPaths(): Set<string> {
    const dirty = new Set<string>();
    for (const raw of this.snapshot.dirtyPaths || []) {
      let relative = raw;
      if (path.isAbsolute(raw)) {
        if (!this.snapshot.rootPath) {
          continue;
        }
        relative = path.relative(path.resolve(this.snapshot.rootPath), path.resolve(raw));
      }
      const safe = this.relativePath(relative);
      if (safe && this.localPath(safe)) {
        dirty.add(safe);
      }
    }
    return dirty;
  }

  private describe(info: FileInfo, dirty: boolean): FileState {
    const local = info.localChange !== 'no';
    const remote = info.remoteChange !== 'no';
    const conflict = info.changeLocation === 'both' || (local && remote);
    const labels: string[] = [];
    let icon = 'check';
    if (conflict) {
      labels.push(localeStr(MESSAGE_TYPE.FILE_SYNC_CONFLICT_FILE));
      icon = 'warning';
    } else if (local) {
      labels.push(localeStr(info.localChange === 'create' ? MESSAGE_TYPE.FILE_SYNC_LOCAL_CREATE
        : info.localChange === 'delete' ? MESSAGE_TYPE.FILE_SYNC_LOCAL_DELETE : MESSAGE_TYPE.FILE_SYNC_LOCAL_UPDATE));
      icon = info.localChange === 'delete' ? 'trash' : 'cloud-upload';
    } else if (remote) {
      labels.push(localeStr(info.remoteChange === 'create' ? MESSAGE_TYPE.FILE_SYNC_REMOTE_CREATE
        : info.remoteChange === 'delete' ? MESSAGE_TYPE.FILE_SYNC_REMOTE_DELETE : MESSAGE_TYPE.FILE_SYNC_REMOTE_UPDATE));
      icon = 'cloud-download';
    } else if (!dirty) {
      labels.push(localeStr(MESSAGE_TYPE.FILE_SYNCED));
    }
    if (dirty) {
      labels.unshift(localeStr(MESSAGE_TYPE.FILE_UNSAVED));
      if (!conflict) {
        icon = 'circle-filled';
      }
    }
    if (info.relativePath.replace(/\\/g, '/') === this.snapshot.appInfo.targetFile?.relativePath.replace(/\\/g, '/')) {
      labels.push(localeStr(MESSAGE_TYPE.FILE_COMPILE_TARGET));
    }
    return { conflict, pending: conflict || local || remote || dirty, dirty, pendingCount: conflict || local || remote || dirty ? 1 : 0, description: labels.join(' · '), icon };
  }

  private rebuild(): void {
    const roots: ProjectFileItem[] = [];
    const nodes = new Map<string, ProjectFileItem>();
    const dirty = this.dirtyPaths();
    let invalid = 0;
    const valid = new Map<string, FileInfo>();
    for (const info of this.snapshot.appInfo.files) {
      const relative = this.relativePath(info.relativePath);
      if (!relative || !this.localPath(relative)) {
        invalid++;
        continue;
      }
      valid.set(relative, info);
    }

    const attach = (item: ProjectFileItem) => {
      const relative = item.relativePath!;
      const separator = relative.lastIndexOf('/');
      if (separator >= 0) {
        const parent = folder(relative.slice(0, separator));
        item.parent = parent;
        parent.children.push(item);
      } else {
        roots.push(item);
      }
      nodes.set(relative, item);
    };
    const folder = (relative: string): ProjectFileItem => {
      const existing = nodes.get(relative);
      if (existing) {
        return existing;
      }
      const item = new ProjectFileItem('folder', relative.split('/').pop()!, relative);
      item.id = `cloudlatex-folder:${relative}`;
      item.contextValue = 'cloudlatexProjectFolder';
      item.iconPath = new vscode.ThemeIcon('folder');
      attach(item);
      return item;
    };

    // Build folder structure first, including folders inferred from file paths.
    for (const [relative, info] of valid) {
      if (info.isFolder) {
        folder(relative).info = info;
      }
      const separator = relative.lastIndexOf('/');
      if (separator >= 0) {
        folder(relative.slice(0, separator));
      }
    }
    for (const [relative, info] of valid) {
      if (info.isFolder) {
        continue;
      }
      // A malformed server entry must not turn a parent folder into a file.
      if (nodes.has(relative)) {
        invalid++;
        continue;
      }
      const item = new ProjectFileItem('file', relative.split('/').pop()!, relative);
      item.id = `cloudlatex-file:${relative}`;
      item.contextValue = 'cloudlatexProjectFile';
      item.info = info;
      item.resourceUri = vscode.Uri.file(this.localPath(relative)!);
      if (info.localChange !== 'delete') {
        item.command = { command: COMMAND_NAMES.openProjectFile, title: String(item.label), arguments: [this.localPath(relative)!] };
      }
      attach(item);
    }

    let pending = 0;
    let conflicts = 0;
    let files = 0;
    const decorate = (item: ProjectFileItem): FileState => {
      let state: FileState = { conflict: false, pending: false, dirty: false, pendingCount: 0, description: '', icon: 'folder' };
      if (item.info) {
        state = this.describe(item.info, dirty.has(item.relativePath!));
        if (state.pending) {
          pending++;
        }
        if (state.conflict) {
          conflicts++;
        }
      }
      if (item.kind === 'file') {
        files++;
      }
      for (const child of item.children) {
        const childState = decorate(child);
        state.conflict = state.conflict || childState.conflict;
        state.pending = state.pending || childState.pending;
        state.dirty = state.dirty || childState.dirty;
        state.pendingCount += childState.pendingCount;
      }
      if (item.kind === 'folder') {
        state.description = state.conflict ? localeStr(MESSAGE_TYPE.FILE_SYNC_CONFLICT_FILE)
          : state.dirty ? localeStr(MESSAGE_TYPE.FILE_UNSAVED)
          : state.pending ? localeStr(MESSAGE_TYPE.FILES_PENDING).replace('{count}', String(state.pendingCount)) : '';
        state.icon = state.conflict ? 'warning' : state.pending ? 'sync' : 'folder';
      }
      item.state = state;
      item.description = state.description;
      item.iconPath = new vscode.ThemeIcon(state.icon);
      item.tooltip = [item.relativePath, state.description].filter(Boolean).join('\n');
      item.children.sort(compareItems);
      return state;
    };
    roots.forEach(item => decorate(item));
    roots.sort(compareItems);

    const phase = this.snapshot.phase === 'ready' && conflicts ? 'conflict' : this.snapshot.phase;
    const pendingDescription = localeStr(MESSAGE_TYPE.FILES_PENDING).replace('{count}', String(pending));
    const label = phase === 'ready' && pending > 0
      ? pendingDescription
      : localeStr(phase === 'ready' ? MESSAGE_TYPE.FILE_SYNC_READY
      : phase === 'syncing' ? MESSAGE_TYPE.FILE_SYNC_SYNCING
      : phase === 'offline' ? MESSAGE_TYPE.FILE_SYNC_OFFLINE
      : phase === 'conflict' ? MESSAGE_TYPE.FILE_SYNC_CONFLICT
      : phase === 'error' ? MESSAGE_TYPE.FILE_SYNC_ERROR : MESSAGE_TYPE.FILE_SYNC_INACTIVE);
    const summary = new ProjectFileItem('summary', label);
    summary.id = 'cloudlatex-files-summary';
    summary.iconPath = new vscode.ThemeIcon(phase === 'syncing' ? 'sync~spin'
      : phase === 'offline' ? 'cloud-offline' : phase === 'conflict' ? 'warning'
      : phase === 'error' ? 'error' : phase === 'ready' ? pending ? 'cloud-upload' : 'check' : 'info');
    const details = [localeStr(MESSAGE_TYPE.FILES_COUNT).replace('{count}', String(files))];
    if (pending && phase !== 'ready') {
      details.push(pendingDescription);
    }
    if (conflicts) {
      details.push(localeStr(MESSAGE_TYPE.FILES_CONFLICTS).replace('{count}', String(conflicts)));
    }
    summary.description = details.join(' · ');
    const tooltip = [...details];
    if (pending && phase === 'ready') {
      tooltip.push(pendingDescription);
    }
    if (this.snapshot.lastSyncedAt) {
      tooltip.push(localeStr(MESSAGE_TYPE.FILES_LAST_SYNC).replace('{time}', new Date(this.snapshot.lastSyncedAt).toLocaleString()));
    }
    if (this.snapshot.detail) {
      tooltip.push(this.snapshot.detail);
    }
    if (invalid) {
      tooltip.push(localeStr(MESSAGE_TYPE.FILES_INVALID_PATHS).replace('{count}', String(invalid)));
    }
    summary.tooltip = tooltip.join('\n');
    this.items = [summary, ...roots];
    if (!roots.length) {
      this.items.push(new ProjectFileItem('empty', localeStr(this.snapshot.rootPath ? MESSAGE_TYPE.FILES_EMPTY : MESSAGE_TYPE.FILES_NO_PROJECT)));
    }
  }
}

function compareItems(left: ProjectFileItem, right: ProjectFileItem): number {
  if (left.kind !== right.kind) {
    return left.kind === 'folder' ? -1 : 1;
  }
  return String(left.label).localeCompare(String(right.label));
}

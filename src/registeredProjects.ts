import { COMMAND_NAMES, DEFAULT_ENDPOINT } from './const';
import { MESSAGE_TYPE } from './locale';
import * as path from 'path';
import * as fs from 'fs';
import { createHash, randomBytes } from 'crypto';
import { withFileLock } from './fileLock';
import * as vscode from 'vscode';
import { localeStr } from './interaction';

export type RegisteredProject = {
  readonly id: number;
  readonly title: string;
  readonly endpoint: string;
  readonly rootPath?: string;
  readonly lastOpenedAt: number;
};

export type RegisteredProjectInput = Omit<RegisteredProject, 'lastOpenedAt'> & { lastOpenedAt?: number };
export type CurrentRegisteredProject = { endpoint: string; id: number; rootPath?: string };
type RegistryState = Pick<vscode.Memento, 'get'>;
type StoredRegistry = { version: number; projects: unknown[]; imported: string[]; removed: string[] };

const registryKey = 'cloudlatex.registeredProjects';

export function normalizeProjectEndpoint(endpoint: string): string | undefined {
  try {
    const value = endpoint.trim();
    const authority = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1];
    if (!authority || authority.includes('@') || /[\\?#\u0000-\u0020\u007f]/.test(value)) {
      return undefined;
    }
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      return undefined;
    }
    return url.origin + url.pathname.replace(/\/+$/, '');
  } catch (e) {
    return undefined;
  }
}

export function isDefaultEndpoint(endpoint: string): boolean {
  return normalizeProjectEndpoint(endpoint) === DEFAULT_ENDPOINT;
}

function projectKey(endpoint: string, id: number): string | undefined {
  const normalized = typeof endpoint === 'string' ? normalizeProjectEndpoint(endpoint) : undefined;
  return normalized && Number.isSafeInteger(id) && id > 0 ? `${normalized}#${id}` : undefined;
}

function validRootPath(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0')
    && (path.posix.isAbsolute(value) || path.win32.isAbsolute(value));
}

function validateRecord(value: unknown): RegisteredProject | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.endpoint !== 'string' || typeof record.id !== 'number' || typeof record.title !== 'string'
    || typeof record.lastOpenedAt !== 'number' || !Number.isSafeInteger(record.lastOpenedAt) || record.lastOpenedAt < 0
    || (record.rootPath !== undefined && !validRootPath(record.rootPath))) {
    return undefined;
  }
  const endpoint = normalizeProjectEndpoint(record.endpoint);
  if (!endpoint || !projectKey(endpoint, record.id)) {
    return undefined;
  }
  // Deliberately enumerate the persisted fields; account/token/client fields
  // from an object supplied by a caller or older storage must never be copied.
  return {
    id: record.id,
    title: record.title,
    endpoint,
    ...(record.rootPath !== undefined ? { rootPath: record.rootPath as string } : {}),
    lastOpenedAt: record.lastOpenedAt
  };
}

function snapshot(record: RegisteredProject): RegisteredProject {
  return Object.freeze({ ...record });
}

export class ProjectRegistry implements vscode.Disposable {
  private records = new Map<string, RegisteredProject>();
  private pending: Promise<void> = Promise.resolve();
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  private readonly legacy: Map<string, RegisteredProject>;
  private imported = new Set<string>();
  private removed = new Set<string>();
  private watcher?: fs.FSWatcher;
  private disposed = false;
  readonly onDidChange = this._onDidChange.event;

  constructor(state: RegistryState, private readonly storagePath: string) {
    this.legacy = this.readRecords(state.get<unknown>(registryKey));
    this.records = new Map(this.legacy);
  }

  load(): Promise<void> {
    return this.disposed ? Promise.resolve() : this.enqueue(async () => undefined);
  }

  list(): RegisteredProject[] {
    return [...this.records.values()]
      .sort((a, b) => b.lastOpenedAt - a.lastOpenedAt || a.title.localeCompare(b.title)
        || a.endpoint.localeCompare(b.endpoint) || a.id - b.id)
      .map(snapshot);
  }

  get(endpoint: string, id: number): RegisteredProject | undefined {
    const key = projectKey(endpoint, id);
    const record = key ? this.records.get(key) : undefined;
    return record ? snapshot(record) : undefined;
  }

  upsert(input: RegisteredProjectInput): Promise<RegisteredProject> {
    const record = validateRecord({ ...input, lastOpenedAt: input.lastOpenedAt ?? Date.now() });
    if (!record) {
      return Promise.reject(new Error('Invalid registered project'));
    }
    return this.enqueue(async () => {
      const key = projectKey(record.endpoint, record.id)!;
      const previous = this.records.get(key);
      const merged: RegisteredProject = {
        ...record,
        ...(record.rootPath || !previous?.rootPath ? {} : { rootPath: previous.rootPath })
      };
      const next = new Map(this.records);
      next.set(key, merged);
      const removed = new Set(this.removed);
      removed.delete(key);
      await this.persist(next, removed);
      return snapshot(merged);
    });
  }

  remove(endpoint: string, id: number): Promise<void> {
    const key = projectKey(endpoint, id);
    if (!key) {
      return Promise.reject(new Error('Invalid registered project'));
    }
    return this.enqueue(async () => {
      if (!this.records.has(key)) {
        return;
      }
      const next = new Map(this.records);
      next.delete(key);
      const removed = new Set(this.removed);
      removed.add(key);
      await this.persist(next, removed);
    });
  }

  readRecords(stored: unknown): Map<string, RegisteredProject> {
    const records = new Map<string, RegisteredProject>();
    if (!Array.isArray(stored)) {
      return records;
    }
    for (const value of stored) {
      const record = validateRecord(value);
      if (!record) {
        continue;
      }
      const key = projectKey(record.endpoint, record.id)!;
      const previous = records.get(key);
      if (!previous || record.lastOpenedAt >= previous.lastOpenedAt) {
        records.set(key, { ...record, ...(record.rootPath || !previous?.rootPath ? {} : { rootPath: previous.rootPath }) });
      } else if (!previous.rootPath && record.rootPath) {
        records.set(key, { ...previous, rootPath: record.rootPath });
      }
    }
    return records;
  }

  fingerprint(records: Map<string, RegisteredProject>): string {
    return JSON.stringify([...records.values()]
      .sort((a, b) => projectKey(a.endpoint, a.id)!.localeCompare(projectKey(b.endpoint, b.id)!))
      .map(r => [r.endpoint, r.id, r.title, r.lastOpenedAt, r.rootPath]));
  }

  async readStorage(): Promise<StoredRegistry> {
    let text: string;
    try {
      text = await fs.promises.readFile(path.join(this.storagePath, 'registered-projects.json'), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return { version: 1, projects: [], imported: [], removed: [] };
      }
      throw error;
    }
    const stored = JSON.parse(text) as StoredRegistry;
    if (!stored || stored.version !== 1 || !Array.isArray(stored.projects)
      || !Array.isArray(stored.imported) || !stored.imported.every(value => typeof value === 'string')
      || !Array.isArray(stored.removed) || !stored.removed.every(value => typeof value === 'string')) {
      throw new Error('Invalid registered projects storage');
    }
    return stored;
  }

  updateRecords(records: Map<string, RegisteredProject>): void {
    if (this.fingerprint(records) !== this.fingerprint(this.records)) {
      this.records = records;
      this._onDidChange.fire();
    }
  }

  watch(): void {
    if (this.watcher || this.disposed) {
      return;
    }
    this.watcher = fs.watch(this.storagePath, (_event, file) => {
      if (!file || file.toString() === 'registered-projects.json') {
        // A watcher refresh must not overwrite a mutation in this window.
        void this.load().catch(() => undefined);
      }
    });
    this.watcher.on('error', () => {
      this.watcher?.close();
      this.watcher = undefined;
    });
    const watcher = this.watcher as fs.FSWatcher & { unref?: () => void };
    watcher.unref?.();
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(async () => {
      if (this.disposed) {
        throw new Error('Project registry is disposed');
      }
      await fs.promises.mkdir(this.storagePath, { recursive: true });
      const file = path.join(this.storagePath, 'registered-projects.json');
      return withFileLock(file + '.lock', async () => {
        // Memento is cached per extension host and writes the entire state bag.
        // Read the shared file under the lock instead of merging cached arrays.
        const stored = await this.readStorage();
        const records = this.readRecords(stored.projects);
        this.imported = new Set(stored.imported);
        this.removed = new Set(stored.removed);
        const legacyKey = createHash('sha256').update(this.fingerprint(this.legacy)).digest('hex');
        if (!this.imported.has(legacyKey)) {
          // Each old profile snapshot is imported once. A later profile import
          // must not resurrect a shortcut removed from the shared registry.
          for (const [key, record] of this.legacy) {
            if (!records.has(key) && !this.removed.has(key)) {
              records.set(key, record);
            }
          }
          this.imported.add(legacyKey);
          await this.persist(records);
        } else {
          this.updateRecords(records);
        }
        this.watch();
        return operation();
      });
    });
    // A failed storage write must not poison later updates.
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  async persist(next: Map<string, RegisteredProject>, removed = this.removed): Promise<void> {
    const file = path.join(this.storagePath, 'registered-projects.json');
    const temporary = file + '.' + randomBytes(12).toString('hex') + '.tmp';
    const stored: StoredRegistry = {
      version: 1, projects: [...next.values()].map(record => ({ ...record })),
      imported: [...this.imported], removed: [...removed]
    };
    try {
      await fs.promises.writeFile(temporary, JSON.stringify(stored), { flag: 'wx', mode: 0o600 });
      await fs.promises.rename(temporary, file);
    } finally {
      await fs.promises.rm(temporary, { force: true });
    }
    this.removed = removed;
    this.updateRecords(next);
  }

  dispose(): Promise<void> {
    this.disposed = true;
    this.watcher?.close();
    this.watcher = undefined;
    this._onDidChange.dispose();
    // Explicit owners can wait until an in-flight file lock has been released.
    return this.pending;
  }
}

export class RegisteredProjectsTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem>, vscode.Disposable {
  private readonly _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
  readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined> = this._onDidChangeTreeData.event;
  private readonly registrySubscription: vscode.Disposable;

  constructor(private readonly registry: ProjectRegistry, private current?: CurrentRegisteredProject) {
    this.registrySubscription = registry.onDidChange(() => this._onDidChangeTreeData.fire(undefined));
  }

  refresh(current?: CurrentRegisteredProject): void {
    this.current = current;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(item: vscode.TreeItem): vscode.TreeItem {
    return item;
  }

  async removeProject(item?: vscode.TreeItem): Promise<void> {
    if (item?.contextValue !== 'registeredProject') {
      return;
    }
    // Context menus receive the tree item, not its open command's arguments.
    const project = item.command?.arguments?.[0] as RegisteredProject | undefined;
    const record = project && this.registry.get(project.endpoint, project.id);
    if (record) {
      await this.registry.remove(record.endpoint, record.id);
    }
  }

  getChildren(parent?: vscode.TreeItem): vscode.TreeItem[] {
    if (parent) {
      return [];
    }
    const projects = this.registry.list();
    if (projects.length === 0) {
      const item = new vscode.TreeItem(localeStr(MESSAGE_TYPE.REGISTER_PROJECT), vscode.TreeItemCollapsibleState.None);
      item.id = 'registeredProject:add';
      item.description = localeStr(MESSAGE_TYPE.NO_REGISTERED_PROJECTS);
      item.iconPath = new vscode.ThemeIcon('add');
      item.command = { command: COMMAND_NAMES.registerProject, title: localeStr(MESSAGE_TYPE.REGISTER_PROJECT) };
      return [item];
    }
    return projects.map(project => {
      const active = this.isActive(project);
      const item = new vscode.TreeItem(project.title || `#${project.id}`, vscode.TreeItemCollapsibleState.None);
      item.id = `registeredProject:${projectKey(project.endpoint, project.id)}`;
      const binding = project.rootPath || localeStr(MESSAGE_TYPE.REGISTERED_PROJECT_NO_FOLDER);
      const activeLabel = active ? `${localeStr(MESSAGE_TYPE.REGISTERED_PROJECT_ACTIVE)} · ` : '';
      const customEndpoint = !isDefaultEndpoint(project.endpoint);
      const endpointLabel = customEndpoint ? `${new URL(project.endpoint).origin} · ` : '';
      item.description = `${activeLabel}${endpointLabel}#${project.id} · ${binding}`;
      item.tooltip = `${project.title || ''} (#${project.id})\n${customEndpoint ? project.endpoint + '\n' : ''}${binding}`;
      item.iconPath = new vscode.ThemeIcon(active ? 'check' : 'project');
      item.contextValue = 'registeredProject';
      item.command = {
        command: COMMAND_NAMES.openRegisteredProject, title: project.title || `#${project.id}`, arguments: [snapshot(project)]
      };
      return item;
    });
  }

  isActive(project: RegisteredProject): boolean {
    return !!this.current && projectKey(project.endpoint, project.id) === projectKey(this.current.endpoint, this.current.id)
      && (!project.rootPath || !this.current.rootPath || project.rootPath === this.current.rootPath);
  }

  dispose(): void {
    this.registrySubscription.dispose();
    this._onDidChangeTreeData.dispose();
  }
}

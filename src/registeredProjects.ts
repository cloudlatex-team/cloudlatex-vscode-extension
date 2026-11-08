import { COMMAND_NAMES, DEFAULT_ENDPOINT } from './const';
import { MESSAGE_TYPE } from './locale';
import * as path from 'path';
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
type RegistryState = Pick<vscode.Memento, 'get' | 'update'>;

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
  } catch {
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
  readonly onDidChange = this._onDidChange.event;

  constructor(private readonly state: RegistryState) {
    const stored = state.get<unknown>(registryKey);
    if (!Array.isArray(stored)) {
      return;
    }
    for (const value of stored) {
      const record = validateRecord(value);
      if (!record) {
        continue;
      }
      const key = projectKey(record.endpoint, record.id)!;
      const previous = this.records.get(key);
      if (!previous || record.lastOpenedAt >= previous.lastOpenedAt) {
        this.records.set(key, { ...record, ...(record.rootPath || !previous?.rootPath ? {} : { rootPath: previous.rootPath }) });
      } else if (!previous.rootPath && record.rootPath) {
        this.records.set(key, { ...previous, rootPath: record.rootPath });
      }
    }
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
      await this.persist(next);
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
      await this.persist(next);
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation);
    // A failed storage write must not discard prior records or poison later
    // mutations. Each queued operation builds on the last successful snapshot.
    this.pending = result.then(() => undefined, () => undefined);
    return result;
  }

  private async persist(next: Map<string, RegisteredProject>): Promise<void> {
    await this.state.update(registryKey, [...next.values()].map(record => ({ ...record })));
    this.records = next;
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
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

  private isActive(project: RegisteredProject): boolean {
    return !!this.current && projectKey(project.endpoint, project.id) === projectKey(this.current.endpoint, this.current.id)
      && (!project.rootPath || !this.current.rootPath || project.rootPath === this.current.rootPath);
  }

  dispose(): void {
    this.registrySubscription.dispose();
    this._onDidChangeTreeData.dispose();
  }
}

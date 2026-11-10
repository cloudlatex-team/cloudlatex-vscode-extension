import { MESSAGE_TYPE } from './locale';
import * as vscode from 'vscode';
import * as http from 'http';
import * as https from 'https';
import { Account, ProjectInfo } from 'cloudlatex-cli-plugin';
import { getVSConfig } from './config';
import { inputAccount, localeStr } from './interaction';
import { isDefaultEndpoint, normalizeProjectEndpoint } from './registeredProjects';

export type ProjectConnection = {
  rootPath: string;
  endpoint: string;
  project: ProjectInfo;
  account: Account;
};

type ConnectionSnapshot = {
  rootPath: string;
  endpoint: string;
  projectId: number;
  enabled: boolean;
};

class ProjectAuthenticationError extends Error {
  constructor() {
    super('Project lookup failed');
  }
}

function parseEndpoint(endpoint: string): URL | undefined {
  const normalized = normalizeProjectEndpoint(endpoint);
  return normalized ? new URL(normalized) : undefined;
}

export function parseProjectId(input: string, endpoint: string): number | undefined {
  const server = parseEndpoint(endpoint);
  if (!server) {
    return undefined;
  }
  const value = input.trim();
  let digits: string;
  if (/^\d+$/.test(value)) {
    digits = value;
  } else {
    const authority = /^https?:\/\/([^/?#]+)/i.exec(value)?.[1];
    if (!authority || authority.includes('@') || value.includes('\\')) {
      return undefined;
    }
    let url: URL;
    try {
      url = new URL(value);
    } catch (e) {
      return undefined;
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== server.origin || url.username || url.password) {
      return undefined;
    }
    const match = /^\/projects\/(\d+)(?:\/edit)?\/?$/.exec(url.pathname);
    if (!match) {
      return undefined;
    }
    digits = match[1];
  }
  const id = Number(digits);
  return Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

// Look up the selected project through the existing project show endpoint.
// Never follow redirects with these token headers or reuse browser cookies.
export function loadProjectById(account: Account, endpoint: string, id: number): Promise<ProjectInfo> {
  const server = parseEndpoint(endpoint);
  if (!server || !Number.isSafeInteger(id) || id <= 0) {
    return Promise.reject(new Error('Project lookup failed'));
  }
  const url = new URL(`${server.href.replace(/\/+$/, '')}/projects/${id}`);
  const headers: http.OutgoingHttpHeaders = {
    uid: account.email,
    client: account.client,
    accept: 'application/json'
  };
  // Production gateways reject unidentified requests. Identify this client
  // explicitly, as the core sync transport already does via node-fetch.
  headers['user-agent'] = 'cloudlatex-vscode-extension';
  headers['access-token'] = account.token;
  return new Promise((resolve, reject) => {
    let settled = false;
    let request: http.ClientRequest | undefined;
    const finish = (project?: ProjectInfo, error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      if (project) {
        resolve(project);
      } else {
        reject(error || new Error('Project lookup failed'));
      }
    };
    const timer = setTimeout(() => {
      finish();
      request?.destroy();
    }, 10000);
    try {
      const transport = url.protocol === 'https:' ? https : http;
      request = transport.get(url, { headers }, response => {
        if (response.statusCode !== 200) {
          finish(undefined, response.statusCode === 401 ? new ProjectAuthenticationError() : undefined);
          response.destroy();
          return;
        }
        let bytes = 0;
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          if (bytes > 1024 * 1024) {
            finish();
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        response.once('error', () => finish());
        response.once('aborted', () => finish());
        response.once('end', () => {
          if (settled) {
            return;
          }
          try {
            const project = JSON.parse(Buffer.concat(chunks).toString('utf8')).project;
            if (!project || project.id !== id || typeof project.title !== 'string') {
              finish();
              return;
            }
            const target = project.compile_target_file_id ?? null;
            if (target !== null && typeof target !== 'number' && typeof target !== 'string') {
              finish();
              return;
            }
            finish({ id, title: project.title, compileTargetFileRemoteId: target });
          } catch (e) {
            finish();
          }
        });
      });
      request.once('error', () => finish());
    } catch (e) {
      finish();
    }
  });
}

// `progress` wraps each request only, so no progress notification stays open
// while the user re-enters credentials.
export async function loadProjectWithAccount(
  account: Account, endpoint: string, id: number,
  progress: <T>(task: () => Promise<T>) => Thenable<T> = task => task()
): Promise<{ account: Account; project: ProjectInfo } | undefined> {
  try {
    return { account, project: await progress(() => loadProjectById(account, endpoint, id)) };
  } catch (error) {
    if (!(error instanceof ProjectAuthenticationError)) {
      throw error;
    }
  }
  void vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.CONNECT_ACCOUNT_INVALID));
  try {
    const entered = await inputAccount();
    account = { email: entered.email.trim(), client: entered.client.trim(), token: entered.token.trim() };
  } catch (e) {
    return undefined;
  }
  return { account, project: await progress(() => loadProjectById(account, endpoint, id)) };
}

async function openEmptyFolder(): Promise<void> {
  const folders = await vscode.window.showOpenDialog({
    canSelectFiles: false,
    canSelectFolders: true,
    canSelectMany: false,
    openLabel: localeStr(MESSAGE_TYPE.OPEN_EMPTY_FOLDER),
    title: localeStr(MESSAGE_TYPE.SELECT_CONNECTION_FOLDER)
  });
  if (folders?.[0]) {
    await vscode.commands.executeCommand('vscode.openFolder', folders[0]);
  }
}

function readSnapshot(): ConnectionSnapshot | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length !== 1 || folders[0].uri.scheme !== 'file') {
    return undefined;
  }
  const config = getVSConfig();
  const endpoint = config.get<string>('endpoint');
  if (!endpoint) {
    return undefined;
  }
  return {
    rootPath: folders[0].uri.fsPath,
    endpoint,
    projectId: config.get<number>('projectId', 0),
    enabled: config.get<boolean>('enabled', false)
  };
}

function snapshotUnchanged(snapshot: ConnectionSnapshot): boolean {
  const current = readSnapshot();
  return !!current && current.rootPath === snapshot.rootPath
    && current.endpoint === snapshot.endpoint
    && current.projectId === snapshot.projectId
    && current.enabled === snapshot.enabled;
}

// Only editor/VCS metadata may exist before the first download. Never silently
// adopt local source files or follow metadata symlinks into another directory.
async function isEmptyProjectFolder(rootPath: string): Promise<boolean> {
  const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.file(rootPath));
  return entries.every(([name, type]) => {
    if (type & vscode.FileType.SymbolicLink) {
      return false;
    }
    if (name === '.vscode') {
      return type === vscode.FileType.Directory;
    }
    if (name === '.git') {
      return type === vscode.FileType.Directory || type === vscode.FileType.File;
    }
    return name === '.DS_Store' && type === vscode.FileType.File;
  });
}

async function requireEmptyFolder(rootPath: string): Promise<boolean> {
  if (await isEmptyProjectFolder(rootPath)) {
    return true;
  }
  const openFolder = localeStr(MESSAGE_TYPE.OPEN_EMPTY_FOLDER);
  const choice = await vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.CONNECT_EMPTY_FOLDER_REQUIRED), openFolder);
  if (choice === openFolder) {
    await openEmptyFolder();
  }
  return false;
}

export async function connectProject(
  savedAccount: Account | null,
  commit: (connection: ProjectConnection) => Promise<void>
): Promise<void> {
  try {
    if (!vscode.workspace.workspaceFolders?.length) {
      await openEmptyFolder();
      return;
    }
    const snapshot = readSnapshot();
    if (!snapshot) {
      await vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.CONNECT_SINGLE_FOLDER_ONLY));
      return;
    }
    if (snapshot.enabled) {
      const openFolder = localeStr(MESSAGE_TYPE.OPEN_EMPTY_FOLDER);
      const choice = await vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.CONNECT_EXISTING_CONNECTION), openFolder);
      if (choice === openFolder) {
        await openEmptyFolder();
      }
      return;
    }
    if (!await requireEmptyFolder(snapshot.rootPath)) {
      return;
    }
    if (!parseEndpoint(snapshot.endpoint)) {
      await vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.CONNECT_FAILED));
      return;
    }
    const customEndpoint = !isDefaultEndpoint(snapshot.endpoint);
    // A workspace can configure its own endpoint. Ask before sending global
    // credentials anywhere other than the default Cloud LaTeX API.
    if (customEndpoint) {
      const allow = localeStr(MESSAGE_TYPE.CONNECT_ALLOW_ENDPOINT);
      const choice = await vscode.window.showInformationMessage(
        `${localeStr(MESSAGE_TYPE.CONNECT_CUSTOM_ENDPOINT)}\n\n${snapshot.endpoint}`, { modal: true }, allow
      );
      if (choice !== allow) {
        return;
      }
    }

    let account = savedAccount;
    if (!account) {
      try {
        const entered = await inputAccount();
        account = { email: entered.email.trim(), client: entered.client.trim(), token: entered.token.trim() };
      } catch (e) {
        // The account helper signals dismissed/empty input by throwing.
        return;
      }
    }
    const input = await vscode.window.showInputBox({
      title: localeStr(MESSAGE_TYPE.PROJECT_URL_PROMPT),
      placeHolder: localeStr(MESSAGE_TYPE.PROJECT_URL_PLACEHOLDER),
      ignoreFocusOut: true,
      validateInput: value => parseProjectId(value, snapshot.endpoint) !== undefined
        ? undefined : localeStr(MESSAGE_TYPE.PROJECT_URL_INVALID)
    });
    if (input === undefined) {
      return;
    }
    const id = parseProjectId(input, snapshot.endpoint);
    if (id === undefined) {
      await vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.PROJECT_URL_INVALID));
      return;
    }
    let project: ProjectInfo;
    while (true) {
      if (!snapshotUnchanged(snapshot)) {
        await vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.CONNECT_SETTINGS_CHANGED));
        return;
      }
      try {
        project = await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: localeStr(MESSAGE_TYPE.REGISTER_PROJECT_LOADING)
        }, () => loadProjectById(account!, snapshot.endpoint, id));
        break;
      } catch (error) {
        if (!(error instanceof ProjectAuthenticationError)) {
          throw error;
        }
        void vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.CONNECT_ACCOUNT_INVALID));
        try {
          const entered = await inputAccount();
          account = { email: entered.email.trim(), client: entered.client.trim(), token: entered.token.trim() };
        } catch (e) {
          return;
        }
      }
    }

    const confirm = localeStr(MESSAGE_TYPE.CONNECT_AND_RELOAD);
    const details = [`${project.title || ''} (#${project.id})`, account.email];
    if (customEndpoint) {
      details.push(snapshot.endpoint);
    }
    details.push(snapshot.rootPath);
    const preview = localeStr(MESSAGE_TYPE.CONNECT_CONFIRM) + '\n\n' + details.join('\n');
    const choice = await vscode.window.showInformationMessage(preview, { modal: true }, confirm);
    if (choice !== confirm) {
      return;
    }
    if (!await requireEmptyFolder(snapshot.rootPath)) {
      return;
    }
    if (!snapshotUnchanged(snapshot)) {
      await vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.CONNECT_SETTINGS_CHANGED));
      return;
    }
    // Selection and credentials stay in memory until this final commit step.
    await commit({ rootPath: snapshot.rootPath, endpoint: snapshot.endpoint, project, account });
  } catch (e) {
    // Server errors can contain response bodies; never show them with credentials.
    await vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.CONNECT_FAILED));
  }
}

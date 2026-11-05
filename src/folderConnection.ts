import * as fs from 'fs';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { applyEdits, modify, parse, ParseError } from 'jsonc-parser';
import * as vscode from 'vscode';
import { RegisteredProject, normalizeProjectEndpoint } from './registeredProjects';

export const CONNECTION_MARKER = '.vscode/cloudlatex-connection.json';
const legacyPendingKey = 'cloudlatex.pendingFolderConnection';
const pendingKeyPrefix = 'cloudlatex.pendingFolderConnection:';
type Pending = {
  rootPath: string;
  endpoint: string;
  id: number;
  nonce: string;
  expires: number;
};
type Inherited = {
  autoCompile: boolean;
  outDir: string;
  ignoredFiles: string[];
};

async function removeOwnedMarker(marker: string, pending: Pending): Promise<void> {
  try {
    const stat = await fs.promises.lstat(marker);
    if (stat.isFile() && !stat.isSymbolicLink() && stat.size <= 256
      && JSON.parse(await fs.promises.readFile(marker, 'utf8')).nonce === pending.nonce) {
      await fs.promises.unlink(marker);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

async function checkFolder(root: string): Promise<void> {
  const stat = await fs.promises.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Choose an empty local folder');
  }
  for (const name of await fs.promises.readdir(root)) {
    const entry = await fs.promises.lstat(path.join(root, name));
    if (entry.isSymbolicLink() || !['.vscode', '.git', '.DS_Store'].includes(name)) {
      throw new Error('Choose an empty local folder');
    }
    if (name === '.vscode' && !entry.isDirectory()) {
      throw new Error('Invalid settings directory');
    }
  }
}

async function readSettings(root: string): Promise<{ text: string; values: Record<string, unknown>; exists: boolean }> {
  const file = path.join(root, '.vscode/settings.json');
  let text = '{}\n';
  let exists = false;
  try {
    const stat = await fs.promises.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024) {
      throw new Error('Invalid settings file');
    }
    text = await fs.promises.readFile(file, 'utf8');
    exists = true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
  const errors: ParseError[] = [];
  const values = parse(text, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length || !values || Array.isArray(values) || typeof values !== 'object') {
    throw new Error('Invalid settings JSON');
  }
  return { text, values, exists };
}

// Stage only a disabled connection. The destination extension host enables it
// after checking this profile's one-use intent and clearing old sync metadata.
export async function stageFolderConnection(
  context: vscode.ExtensionContext, rootPath: string, project: RegisteredProject, inherited: Inherited
): Promise<() => Promise<void>> {
  await checkFolder(rootPath);
  const root = await fs.promises.realpath(rootPath);
  const pendingKey = pendingKeyPrefix + root;
  const original = await readSettings(root);
  if (original.values['cloudlatex.enabled']) {
    throw new Error('Folder already connected');
  }
  const endpoint = normalizeProjectEndpoint(project.endpoint);
  if (!endpoint || !Number.isSafeInteger(project.id) || project.id <= 0) {
    throw new Error('Invalid project');
  }
  const pending: Pending = { rootPath: root, endpoint, id: project.id, nonce: randomBytes(24).toString('hex'), expires: Date.now() + 10 * 60 * 1000 };
  const marker = path.join(root, CONNECTION_MARKER);
  const settingsFile = path.join(root, '.vscode/settings.json');
  await fs.promises.mkdir(path.dirname(marker), { recursive: true });
  await fs.promises.writeFile(marker, JSON.stringify({ nonce: pending.nonce }), { flag: 'wx', mode: 0o600 });
  let text = original.text;
  const settings: [string, unknown][] = [
    ['cloudlatex.endpoint', endpoint],
    ['cloudlatex.projectId', project.id],
    ['cloudlatex.autoCompile', inherited.autoCompile],
    ['cloudlatex.outDir', inherited.outDir],
    ['cloudlatex.ignoredFiles', inherited.ignoredFiles],
    ['cloudlatex.enabled', false]
  ];
  for (const [key, value] of settings) {
    text = applyEdits(text, modify(text, [key], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
  }
  const rollback = async () => {
    if (await fs.promises.readFile(marker, 'utf8').catch(() => '') !== JSON.stringify({ nonce: pending.nonce })) {
      return;
    }
    // Restore only files still containing our exact staged settings.
    if (await fs.promises.readFile(settingsFile, 'utf8').catch(() => '') === text) {
      if (original.exists) {
        await fs.promises.writeFile(settingsFile, original.text);
      } else {
        await fs.promises.unlink(settingsFile);
      }
    }
    await fs.promises.unlink(marker);
    if (context.globalState.get<Pending>(pendingKey)?.nonce === pending.nonce) {
      await context.globalState.update(pendingKey, undefined);
    }
  };
  try {
    await context.globalState.update(pendingKey, pending);
    await fs.promises.writeFile(settingsFile, text);
  } catch (error) {
    await rollback();
    throw error;
  }
  return rollback;
}

export async function completeFolderConnection(context: vscode.ExtensionContext): Promise<boolean> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length !== 1 || folders[0].uri.scheme !== 'file') {
    return false;
  }
  const root = await fs.promises.realpath(folders[0].uri.fsPath);
  // Each folder has its own intent so simultaneous connections in two windows
  // cannot overwrite one another's handoff. Accept the earlier key on upgrade.
  let pendingKey = pendingKeyPrefix + root;
  let pending = context.globalState.get<Pending>(pendingKey);
  if (!pending && context.globalState.get<Pending>(legacyPendingKey)?.rootPath === root) {
    pendingKey = legacyPendingKey;
    pending = context.globalState.get<Pending>(pendingKey);
  }
  if (!pending || root !== pending.rootPath) {
    return false;
  }
  const marker = path.join(root, CONNECTION_MARKER);
  try {
    if (pending.expires < Date.now() || !context.storageUri) {
      throw new Error('Connection expired');
    }
    await checkFolder(root);
    const markerStat = await fs.promises.lstat(marker);
    if (!markerStat.isFile() || markerStat.isSymbolicLink() || markerStat.size > 256) {
      throw new Error('Invalid connection marker');
    }
    if (JSON.parse(await fs.promises.readFile(marker, 'utf8')).nonce !== pending.nonce) {
      throw new Error('Connection changed');
    }
    const { values } = await readSettings(root);
    if (values['cloudlatex.enabled'] !== false || values['cloudlatex.endpoint'] !== pending.endpoint
      || values['cloudlatex.projectId'] !== pending.id) {
      throw new Error('Connection settings changed');
    }
    await fs.promises.mkdir(context.storageUri.fsPath, { recursive: true });
    await fs.promises.rm(path.join(context.storageUri.fsPath, `.${pending.id}-cloudlatex.json`), { force: true });
    // Finish the handoff bookkeeping before enabling synchronization. A cleanup
    // failure must not leave a connection enabled after activation reported failure.
    await fs.promises.unlink(marker);
    await context.globalState.update(pendingKey, undefined);
    await vscode.workspace.getConfiguration('cloudlatex').update('enabled', true, vscode.ConfigurationTarget.Workspace);
    return true;
  } catch (error) {
    // No network access is started when the one-use handoff cannot be verified.
    // Remove only this intent's marker so an expired handoff can be retried.
    await removeOwnedMarker(marker, pending);
    if (context.globalState.get<Pending>(pendingKey)?.nonce === pending.nonce) {
      await context.globalState.update(pendingKey, undefined);
    }
    throw error;
  }
}

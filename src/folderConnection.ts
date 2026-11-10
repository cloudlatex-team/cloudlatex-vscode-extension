import * as fs from 'fs';
import * as path from 'path';
import { createHash, randomBytes } from 'crypto';
import { applyEdits, modify, parse, ParseError } from 'jsonc-parser';
import * as vscode from 'vscode';
import { getVSConfig } from './config';
import { CONFIG_NAMES } from './const';
import { withFileLock } from './fileLock';
import { RegisteredProject, normalizeProjectEndpoint } from './registeredProjects';

export const CONNECTION_MARKER = '.vscode/cloudlatex-connection.json';
const pendingKeyPrefix = 'cloudlatex.pendingFolderConnection:';
const connectionLock = '.vscode/cloudlatex-connection.lock';
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

function pendingFile(context: vscode.ExtensionContext, root: string): string {
  const key = createHash('sha256').update(root).digest('hex');
  return path.join(context.globalStorageUri.fsPath, 'pending-connections', key + '.json');
}

function validatePending(value: unknown, root: string): Pending | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const pending = value as Record<string, unknown>;
  if (pending.rootPath !== root || typeof pending.endpoint !== 'string'
    || normalizeProjectEndpoint(pending.endpoint) !== pending.endpoint
    || typeof pending.id !== 'number' || !Number.isSafeInteger(pending.id) || pending.id <= 0
    || typeof pending.nonce !== 'string' || !/^[a-f0-9]{48}$/.test(pending.nonce)
    || typeof pending.expires !== 'number' || !Number.isSafeInteger(pending.expires) || pending.expires < 0) {
    return undefined;
  }
  return { rootPath: root, endpoint: pending.endpoint, id: pending.id, nonce: pending.nonce, expires: pending.expires };
}

async function readPending(context: vscode.ExtensionContext, root: string): Promise<Pending | undefined> {
  const file = pendingFile(context, root);
  let value: unknown;
  try {
    const directory = await fs.promises.lstat(path.dirname(file));
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      throw new Error('Invalid pending connection directory');
    }
    const stat = await fs.promises.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024) {
      throw new Error('Invalid pending connection file');
    }
    value = JSON.parse(await fs.promises.readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Old intents are accepted only after the caller also verifies their marker.
      // Never write Memento: each extension host saves its entire cached state bag.
      return validatePending(context.globalState.get<unknown>(pendingKeyPrefix + root), root);
    }
    throw error;
  }
  // A consumed intent must not be revived from an older window's Memento cache.
  if (value === null) {
    return undefined;
  }
  const pending = validatePending(value, root);
  if (!pending) {
    throw new Error('Invalid pending connection');
  }
  return pending;
}

async function writePending(context: vscode.ExtensionContext, root: string, pending: Pending | null): Promise<void> {
  const file = pendingFile(context, root);
  const temporary = file + '.' + randomBytes(12).toString('hex') + '.tmp';
  await fs.promises.mkdir(path.dirname(file), { recursive: true });
  const directory = await fs.promises.lstat(path.dirname(file));
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    throw new Error('Invalid pending connection directory');
  }
  try {
    await fs.promises.writeFile(temporary, JSON.stringify(pending), { flag: 'wx', mode: 0o600 });
    await fs.promises.rename(temporary, file);
  } finally {
    await fs.promises.rm(temporary, { force: true });
  }
}

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
  const parsed = parse(text, errors, { allowTrailingComma: true, disallowComments: false, allowEmptyContent: true });
  const values = parsed === undefined ? {} : parsed;
  if (errors.length || !values || Array.isArray(values) || typeof values !== 'object') {
    throw new Error('Invalid settings JSON');
  }
  return { text, values, exists };
}

// Nonces of the stages this window created distinguish its cancelled stage
// from another window's handoff that is still in progress.
const stagedInThisWindow = new Set<string>();

// Returns whether a connection marker exists that may be replaced. Only an
// earlier stage this window created, or that has expired,
// is replaced; any other marker may belong to a handoff in progress elsewhere.
async function checkExistingMarker(marker: string, previous: Pending | undefined): Promise<boolean> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(marker);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
  if (!stat.isFile() || stat.size > 256 || typeof previous?.nonce !== 'string'
    || await fs.promises.readFile(marker, 'utf8') !== JSON.stringify({ nonce: previous.nonce })
    || (previous.expires >= Date.now() && !stagedInThisWindow.has(previous.nonce))) {
    throw new Error('Folder is being connected elsewhere');
  }
  return true;
}

function safeInheritedOutDir(root: string, outDir: unknown): string {
  // config.get() returns whatever the user wrote, which may not be a string.
  if (typeof outDir !== 'string') {
    return '';
  }
  const portable = outDir.replace(/\\/g, '/');
  if (path.isAbsolute(portable) || path.win32.isAbsolute(outDir) || /^[a-z]:/i.test(outDir) || outDir.includes('\0')) {
    return '';
  }
  const relative = path.relative(root, path.resolve(root, portable));
  return relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? '' : outDir;
}

// Stage only a disabled connection. The destination extension host enables it
// after checking this device's one-use intent and clearing old sync metadata.
export async function stageFolderConnection(
  context: vscode.ExtensionContext, rootPath: string, project: RegisteredProject, inherited: Inherited
): Promise<() => Promise<void>> {
  await checkFolder(rootPath);
  const root = await fs.promises.realpath(rootPath);
  return withFileLock(path.join(root, connectionLock), async () => {
    await checkFolder(root);
    const original = await readSettings(root);
    if (original.values[CONFIG_NAMES.enabled]) {
      throw new Error('Folder already connected');
    }
    const endpoint = normalizeProjectEndpoint(project.endpoint);
    if (!endpoint || !Number.isSafeInteger(project.id) || project.id <= 0) {
      throw new Error('Invalid project');
    }
    const marker = path.join(root, CONNECTION_MARKER);
    const settingsFile = path.join(root, '.vscode/settings.json');
    // An earlier stage (for example, one left behind when the folder switch was
    // cancelled) is replaced, whatever project it was for, when this window
    // created it, it has expired, or its marker is gone. Without the marker the
    // handoff can no longer complete.
    const previous = await readPending(context, root);
    const markerOwned = await checkExistingMarker(marker, previous);
    let text = original.text;
    const settings: [string, unknown][] = [
      [CONFIG_NAMES.endpoint, endpoint],
      [CONFIG_NAMES.projectId, project.id],
      [CONFIG_NAMES.autoCompile, inherited.autoCompile],
      [CONFIG_NAMES.outDir, safeInheritedOutDir(root, inherited.outDir)],
      [CONFIG_NAMES.ignoredFiles, inherited.ignoredFiles],
      [CONFIG_NAMES.enabled, false]
    ];
    for (const [key, value] of settings) {
      text = applyEdits(text, modify(text, [key], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } }));
    }
    const pending: Pending = {
      rootPath: root, endpoint, id: project.id, nonce: randomBytes(24).toString('hex'), expires: Date.now() + 10 * 60 * 1000
    };
    const markerText = JSON.stringify({ nonce: pending.nonce });
    await fs.promises.mkdir(path.dirname(marker), { recursive: true });
    if (markerOwned) {
      // The earlier attempt's rollback checks its own nonce, so it cannot remove
      // the marker written below.
      await fs.promises.unlink(marker).catch(error => {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      });
    }
    await fs.promises.writeFile(marker, markerText, { flag: 'wx', mode: 0o600 });
    stagedInThisWindow.add(pending.nonce);
    const rollback = async () => {
      if (await fs.promises.readFile(marker, 'utf8').catch(() => '') !== markerText) {
        return;
      }
      // Restore only files still containing our exact staged settings.
      if (await fs.promises.readFile(settingsFile, 'utf8').catch(() => '') === text) {
        // A retry may have rotated ownership while the settings read was pending.
        if (await fs.promises.readFile(marker, 'utf8').catch(() => '') !== markerText) {
          return;
        }
        if (original.exists) {
          await fs.promises.writeFile(settingsFile, original.text);
        } else {
          await fs.promises.unlink(settingsFile);
        }
      }
      if (await fs.promises.readFile(marker, 'utf8').catch(() => '') !== markerText) {
        return;
      }
      await fs.promises.unlink(marker);
      const stored = await readPending(context, root);
      if (stored?.nonce === pending.nonce || (previous && stored?.nonce === previous.nonce)) {
        await writePending(context, root, null);
      }
    };
    try {
      await writePending(context, root, pending);
      await fs.promises.writeFile(settingsFile, text);
    } catch (error) {
      await rollback();
      throw error;
    }
    return () => withFileLock(path.join(root, connectionLock), rollback, 0);
  }, 0);
}

export async function completeFolderConnection(context: vscode.ExtensionContext): Promise<boolean> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length !== 1 || folders[0].uri.scheme !== 'file') {
    return false;
  }
  let root: string;
  try {
    root = await fs.promises.realpath(folders[0].uri.fsPath);
  } catch (error) {
    // An ordinary unavailable workspace is not a failed connection handoff.
    // Keep a known intent's failure visible rather than enabling it unchecked.
    if (await readPending(context, path.resolve(folders[0].uri.fsPath))) {
      throw error;
    }
    return false;
  }
  if (!await readPending(context, root)) {
    return false;
  }
  return withFileLock(path.join(root, connectionLock), async () => {
    // Match the intent for this destination before enabling its connection.
    const pending = await readPending(context, root);
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
      if (values[CONFIG_NAMES.enabled] !== false || values[CONFIG_NAMES.endpoint] !== pending.endpoint
        || values[CONFIG_NAMES.projectId] !== pending.id) {
        throw new Error('Connection settings changed');
      }
      await fs.promises.mkdir(context.storageUri.fsPath, { recursive: true });
      await fs.promises.rm(path.join(context.storageUri.fsPath, `.${pending.id}-cloudlatex.json`), { force: true });
      // Finish the handoff bookkeeping before enabling synchronization. A cleanup
      // failure must not leave a connection enabled after activation reported failure.
      await fs.promises.unlink(marker);
      await writePending(context, root, null);
      await getVSConfig().update('enabled', true, vscode.ConfigurationTarget.Workspace);
      return true;
    } catch (error) {
      // No network access is started when the one-use handoff cannot be verified.
      // Remove only this intent's marker so an expired handoff can be retried.
      await removeOwnedMarker(marker, pending);
      if ((await readPending(context, root))?.nonce === pending.nonce) {
        await writePending(context, root, null);
      }
      throw error;
    }
  }, 0);
}

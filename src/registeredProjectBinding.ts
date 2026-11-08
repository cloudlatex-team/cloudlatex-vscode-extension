import * as fs from 'fs';
import * as path from 'path';
import { parse, ParseError } from 'jsonc-parser';
import { DEFAULT_ENDPOINT } from './const';
import { RegisteredProject, normalizeProjectEndpoint } from './registeredProjects';

const settingsLimit = 1024 * 1024;

function insideRoot(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return !!relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// A saved folder binding may outlive the settings that created it. Verify the
// current project and server before opening another workspace from the sidebar.
export async function folderMatchesRegisteredProject(
  record: RegisteredProject,
  globalEndpoint = DEFAULT_ENDPOINT
): Promise<boolean> {
  if (!record.rootPath || !path.isAbsolute(record.rootPath) || !Number.isSafeInteger(record.id) || record.id <= 0) {
    return false;
  }
  const endpoint = normalizeProjectEndpoint(record.endpoint);
  if (!endpoint) {
    return false;
  }
  let handle: fs.promises.FileHandle | undefined;
  try {
    const root = await fs.promises.realpath(record.rootPath);
    const candidate = path.join(record.rootPath, '.vscode', 'settings.json');
    const settingsPath = await fs.promises.realpath(candidate);
    if (!insideRoot(root, settingsPath)) {
      return false;
    }
    const initialStat = await fs.promises.stat(settingsPath);
    if (!initialStat.isFile() || initialStat.size > settingsLimit) {
      return false;
    }
    // Refuse a newly substituted symlink at the resolved file path. Bounded
    // reads also prevent a growing file from exceeding the memory limit.
    const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0);
    handle = await fs.promises.open(settingsPath, flags);
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > settingsLimit) {
      return false;
    }
    const content = Buffer.alloc(settingsLimit + 1);
    let offset = 0;
    while (offset < content.length) {
      const read = await handle.read(content, offset, content.length - offset, offset);
      if (!read.bytesRead) {
        break;
      }
      offset += read.bytesRead;
    }
    if (offset > settingsLimit || await fs.promises.realpath(record.rootPath) !== root
      || await fs.promises.realpath(candidate) !== settingsPath) {
      return false;
    }
    const errors: ParseError[] = [];
    const config: unknown = parse(content.toString('utf8', 0, offset), errors, { allowTrailingComma: true });
    if (errors.length || !config || typeof config !== 'object' || Array.isArray(config)) {
      return false;
    }
    const settings = config as Record<string, unknown>;
    if (settings['cloudlatex.projectId'] !== record.id) {
      return false;
    }
    const configuredEndpoint = Object.prototype.hasOwnProperty.call(settings, 'cloudlatex.endpoint')
      ? settings['cloudlatex.endpoint'] : globalEndpoint;
    return typeof configuredEndpoint === 'string' && normalizeProjectEndpoint(configuredEndpoint) === endpoint;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

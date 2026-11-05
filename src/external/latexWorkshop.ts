import { MESSAGE_TYPE } from '../locale';
import * as path from 'path';
import * as vscode from 'vscode';
import { localeStr } from '../interaction';
import { getRootPath, getVSConfig } from '../config';

const extensionId = 'james-yu.latex-workshop';
const marketplaceUrl = 'https://marketplace.visualstudio.com/items?itemName=James-Yu.latex-workshop';
const refreshPDFViewerCommand = 'latex-workshop.refresh-viewer';

export function checkInstalled() {
  return vscode.extensions.getExtension(extensionId) !== undefined;
}

// Workshop resolves relative paths from the root TeX file, while Cloud LaTeX
// resolves them from the workspace. Keep workspace-relative settings portable.
export function getWorkshopOutDir(rootPath: string, outDir: string): string {
  const resolved = path.resolve(rootPath, outDir || '.');
  if (path.isAbsolute(outDir)) {
    return resolved.split(path.sep).join('/');
  }
  const relative = path.relative(rootPath, resolved).split(path.sep).join('/');
  return relative ? `%WORKSPACE_FOLDER%/${relative}` : '%WORKSPACE_FOLDER%';
}

async function openMarketplace() {
  await vscode.env.openExternal(vscode.Uri.parse(marketplaceUrl));
}

export async function configure(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder || folder.uri.scheme !== 'file') {
    await vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.NO_WORKSPACE_ERROR));
    return;
  }

  if (!checkInstalled()) {
    const install = localeStr(MESSAGE_TYPE.INSTALL_LATEX_WORKSHOP);
    const choice = await vscode.window.showInformationMessage(localeStr(MESSAGE_TYPE.LATEX_WORKSHOP_REQUIRED), install);
    if (choice === install) {
      try {
        await openMarketplace();
      } catch (error) {
        await vscode.window.showErrorMessage(`${localeStr(MESSAGE_TYPE.LATEX_WORKSHOP_SETUP_FAILED)} ${String(error)}`);
      }
    }
    return;
  }

  const outDir = getWorkshopOutDir(folder.uri.fsPath, getVSConfig().get<string>('outDir', ''));
  const config = vscode.workspace.getConfiguration('latex-workshop', folder.uri);
  const settings: [string, string][] = [
    ['latex.autoBuild.run', 'never'],
    ['latex.outDir', outDir]
  ];
  const changes = settings.filter(([key, value]) => config.get<string>(key) !== value);
  if (changes.length === 0) {
    await vscode.window.showInformationMessage(localeStr(MESSAGE_TYPE.LATEX_WORKSHOP_CONFIGURED));
    return;
  }

  const apply = localeStr(MESSAGE_TYPE.APPLY_SETTINGS);
  const message = localeStr(MESSAGE_TYPE.LATEX_WORKSHOP_SETUP_PREVIEW) + '\n\n'
    + changes.map(([key, value]) => `latex-workshop.${key}: ${JSON.stringify(value)}`).join('\n');
  const choice = await vscode.window.showInformationMessage(message, { modal: true }, apply);
  if (choice !== apply) {
    return;
  }

  // Match the first folder used by Cloud LaTeX without changing other roots.
  const target = (vscode.workspace.workspaceFolders?.length || 0) > 1
    ? vscode.ConfigurationTarget.WorkspaceFolder : vscode.ConfigurationTarget.Workspace;
  try {
    for (const [key, value] of changes) {
      await config.update(key, value, target);
    }
    await vscode.window.showInformationMessage(localeStr(MESSAGE_TYPE.LATEX_WORKSHOP_CONFIGURED));
  } catch (error) {
    await vscode.window.showErrorMessage(`${localeStr(MESSAGE_TYPE.LATEX_WORKSHOP_SETUP_FAILED)} ${String(error)}`);
  }
}

export async function refreshViewer(): Promise<void> {
  if (!checkInstalled()) {
    return;
  }
  await vscode.commands.executeCommand(refreshPDFViewerCommand);
}

export async function viewPDF(pdfPath?: string): Promise<void> {
  const rootPath = getRootPath();
  if (!rootPath) {
    await vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.NO_WORKSPACE_ERROR));
    return;
  }
  if (!pdfPath) {
    await vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.PDF_NOT_FOUND));
    return;
  }

  const uri = vscode.Uri.file(path.resolve(rootPath, pdfPath));
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (!(stat.type & vscode.FileType.File)) {
      throw new Error('Not a file');
    }
  } catch {
    await vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.PDF_NOT_FOUND));
    return;
  }

  try {
    if (checkInstalled()) {
      // Open the actual artifact, even if a different source file is active.
      await vscode.commands.executeCommand('vscode.openWith', uri, 'latex-workshop-pdf-hook', vscode.ViewColumn.Beside);
      return;
    }

    const install = localeStr(MESSAGE_TYPE.INSTALL_LATEX_WORKSHOP);
    const external = localeStr(MESSAGE_TYPE.OPEN_PDF_EXTERNALLY);
    const choice = await vscode.window.showInformationMessage(localeStr(MESSAGE_TYPE.LATEX_WORKSHOP_REQUIRED), install, external);
    if (choice === install) {
      await openMarketplace();
    } else if (choice === external) {
      const opened = await vscode.env.openExternal(uri);
      if (!opened) {
        throw new Error(localeStr(MESSAGE_TYPE.PDF_OPEN_FAILED));
      }
    }
  } catch (error) {
    await vscode.window.showErrorMessage(`${localeStr(MESSAGE_TYPE.PDF_OPEN_FAILED)} ${String(error)}`);
  }
}

import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AccountService } from 'cloudlatex-cli-plugin';
import { getRootPath, getVSConfig, obtainAccountPath } from './config';
import { ProjectConnection } from './projectConnection';

// Persist a new connection only after the wizard has confirmed an empty folder.
// No login, file watching, synchronization or compilation happens here.
export async function saveProjectConnection(context: vscode.ExtensionContext, connection: ProjectConnection): Promise<void> {
  if (getRootPath() !== connection.rootPath || !context.storageUri
    || !Number.isSafeInteger(connection.project.id) || connection.project.id <= 0) {
    throw new Error('Connection workspace is no longer available');
  }
  const config = getVSConfig();
  if (config.get<boolean>('enabled', false) || config.get<string>('endpoint') !== connection.endpoint) {
    throw new Error('Connection settings have changed');
  }
  const previousProject = config.inspect<number>('projectId')?.workspaceValue;
  const previousEnabled = config.inspect<boolean>('enabled')?.workspaceValue;
  const accountPath = obtainAccountPath(context);
  await fs.promises.mkdir(context.globalStorageUri.fsPath, { recursive: true });
  let previousAccount: Buffer | undefined;
  try {
    previousAccount = await fs.promises.readFile(accountPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  // Do not change the AccountService used by the current backend. A reload will
  // create a new backend with the new credentials and selected project.
  const accountService = new AccountService(accountPath);
  let accountChanged = false;
  try {
    await config.update('enabled', false, vscode.ConfigurationTarget.Workspace);
    await config.update('projectId', connection.project.id, vscode.ConfigurationTarget.Workspace);
    accountChanged = true;
    await accountService.save(connection.account);

    // The core's metadata is keyed only by project ID. Reusing a previous sync
    // database in an empty folder could turn absent local files into deletions.
    const metadata = path.join(context.storageUri.fsPath, `.${connection.project.id}-cloudlatex.json`);
    await fs.promises.rm(metadata, { force: true });
    await config.update('enabled', true, vscode.ConfigurationTarget.Workspace);
  } catch (error) {
    // Leave synchronization disabled if rollback itself fails.
    await config.update('enabled', false, vscode.ConfigurationTarget.Workspace);
    if (accountChanged) {
      if (previousAccount) {
        await fs.promises.writeFile(accountPath, previousAccount);
      } else {
        await fs.promises.rm(accountPath, { force: true });
      }
    }
    await config.update('projectId', previousProject, vscode.ConfigurationTarget.Workspace);
    await config.update('enabled', previousEnabled, vscode.ConfigurationTarget.Workspace);
    throw error;
  }
}

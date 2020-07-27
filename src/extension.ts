// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import TargetTreeProvider from './targetTreeProvider';
import LatexApp, {AppInfo, Config, Logger, Account} from 'latex-extension';
import { decideSyncMode, inputAccount } from './interaction';
import VSLogger from './vslogger';
import { VSConfig} from './type';
import * as fs from 'fs';
import * as path from 'path';
// #TODO save user info in ~/.cloudlatex or ...
// https://github.com/shanalikhan/code-settings-sync/blob/eb332ba5e8180680e613e94be89119119c5638d1/src/service/github.oauth.service.ts#L116
// https://github.com/shanalikhan/code-settings-sync/blob/eb332ba5e8180680e613e94be89119119c5638d1/src/environmentPath.ts



let statusBarItem: vscode.StatusBarItem;

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export async function activate(context: vscode.ExtensionContext) {
  if (!isEnabled()) {
    vscode.window.showErrorMessage('Be sure to set cloudlatex.enable to true not at user\'s settings but at workspace settings.');
    return;
  }

  if (!validateProjectIdConfiguration()) {
    vscode.window.showErrorMessage('ProjectId should be set in workspace configration file.');
    return;
  }

  console.log(context);

  /**
   * Status bar
   */
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  statusBarItem.command = 'cloudlatex.open';
	context.subscriptions.push(statusBarItem);

  /**
   * Latex app
   */
  const rootPath = vscode.workspace.rootPath;
  if (!rootPath) {
    throw new Error('The root path can not be obtained!');
  }

  const vsconfig = vscode.workspace.getConfiguration('cloudlatex') as any as VSConfig;

  // storage path to save meta data
  const storagePath = context.storagePath || rootPath;
  try {
    await fs.promises.mkdir(storagePath);
  } catch (e) {
    // directory is already created
  }

  // global storage path to save account data and global meta data.
  const globalStoragePath = context.globalStoragePath;
  try {
    await fs.promises.mkdir(globalStoragePath);
  } catch (e) {
    // directory is already created
  }
  const accountPath = path.join(globalStoragePath, 'account.json');

  const config: Config = {
    ...vsconfig,
    storagePath,
    rootPath,
    accountStorePath: accountPath,
  };

  const logger = new VSLogger();
  const latexApp = new LatexApp(config, decideSyncMode, logger);

  latexApp.on('appinfo-updated', () => {
    vscode.commands.executeCommand('cloudlatex.refreshEntry');
  });

  latexApp.on('start-compile', () => {
    statusBarItem.text = 'Compiling ...';
    statusBarItem.tooltip = 'Cloud LaTeX';
    statusBarItem.show();
  });

  latexApp.on('successfully-compiled', () => {
    statusBarItem.text = 'Compiled';
    statusBarItem.show();

    // latex workshop support
    vscode.commands.executeCommand('latex-workshop.refresh-viewer');
  });

  latexApp.on('failed-compile', () =>{
    statusBarItem.text = 'Failed to compile';
    statusBarItem.show();
  });


  /**
   * Side Bar
   */
  const tree =  new TargetTreeProvider(latexApp.appInfo);
  const panel = vscode.window.registerTreeDataProvider('cloudlatex-commands', tree);


  /**
   * Commands
   */
  vscode.commands.registerCommand('cloudlatex.refreshEntry', () => {
    tree.refresh(latexApp.appInfo); // TODO fix error
  });

  vscode.commands.registerCommand('cloudlatex.compile', async () => {
    const result = await latexApp.validateAccount();
    if (result === 'offline') {
      logger.warn('Cannot stil connect to the server.');
      return;
    }
    if (result === 'invalid') {
      return;
    }
    latexApp.compile();
  });

  vscode.commands.registerCommand('cloudlatex.reload', async () => {
    const result = await latexApp.validateAccount();
    if (result === 'offline') {
      logger.warn('Cannot stil connect to the server.');
    }
    if (result === 'valid') {
      latexApp.startSync();
    }
  });

  vscode.commands.registerCommand('cloudlatex.open', () => {
    vscode.commands.executeCommand('workbench.view.extension.cloudlatex').then(
      () => vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
    );
  });

  vscode.commands.registerCommand('cloudlatex.account', async () => {
    let account!: Account;
    try {
      account = await inputAccount();
    } catch (e) {
      logger.log('account input is canceled');
      return; // input box is canceled.
    }
    try {
      latexApp.setAccount(account);
      if (await latexApp.validateAccount() === 'valid') {
        logger.info('Your account is validated!');
        latexApp.startSync();
      }
    } catch (e) {
      logger.warn(JSON.stringify(e));
    }
  });

  /**
   * Launch app
   */
  await latexApp.launch();
  if (await latexApp.validateAccount() === 'valid') {
    latexApp.startSync();
  }
}

// this method is called when your extension is deactivated
export function deactivate() {
  // TODO delete config files
}

// Check if this plugin is enabled.
function isEnabled(): boolean {
  const config = vscode.workspace.getConfiguration('cloudlatex');
  /**
   * To prevent overwriting files unexpectedly,
   * `enabled` should be defined in workspace configuration.
   */
  const enabledInspect = config.inspect('enabled');
  if (!enabledInspect || !enabledInspect.workspaceValue) {
    return false;
  }
  return true;
}

/**
 * To prevent overwriting files unexpectedly,
 * `projectId` should be defined in workspace configuration.
 */
function validateProjectIdConfiguration(): boolean {
  const config = vscode.workspace.getConfiguration('cloudlatex');
  const projectIdInspect = config.inspect('projectId');
  if (!projectIdInspect || !projectIdInspect.workspaceValue) {
    return false;
  }
  return true;
}


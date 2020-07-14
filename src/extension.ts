// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import TargetTreeProvider from './targetTreeProvider';
import LatexApp, {AppInfo, Config, DecideSyncMode, Logger } from 'latex-extension';

const decideSyncMode: DecideSyncMode = async function(conflictFiles) {
  const push: vscode.QuickPickItem = { label: 'Push', description: 'Apply local changes to remote.' };
  const pull: vscode.QuickPickItem = { label: 'Pull', description: 'Apply remote changes to local' };

  // TODO explanation of the conflict
  const explanation = `Following files is both changed in the server and local: \n 
    ${conflictFiles.join('\n')}
  `;
  const ResolveConflict = 'Resolve conflict';
  const selection = await vscode.window.showWarningMessage(explanation, ResolveConflict);
  if (selection !== ResolveConflict) {
    vscode.window.showInformationMessage(selection || 'no');
    throw new Error('The result of decideSyncMode is invalid.');
  }
  const result = await vscode.window.showQuickPick([pull, push], {placeHolder: explanation});
  if (result === pull) {
    return 'download';
  } else if (result === push) {
    return 'upload';
  }
  throw new Error('The result of decideSyncMode is invalid.');
};

// TODO execute at the project open
console.log('extension.ts');

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  console.log('activate!!');
  if (!isEnabled()) {
    vscode.window.showErrorMessage('Be sure to set cloudlatex.enable to true not at user\'s settings but at workspace settings.');
    return;
  }

  if (!validateProjectIdConfiguration()) {
    vscode.window.showErrorMessage('ProjectId should be set in workspace configration file.');
    return;
  }

  const rootPath = vscode.workspace.rootPath;
  if (!rootPath) {
    throw new Error('The root path can not be obtained!');
  }

  const config: Config = Object.assign({},
    vscode.workspace.getConfiguration('cloudlatex') as any as Config,
    {
      rootPath
    }
  );

  const latexApp = new LatexApp(config, decideSyncMode, new VSLogger());

  latexApp.on('appinfo-updated', () => {
    vscode.commands.executeCommand('cloudlatex.refreshEntry', latexApp.appInfo);
  });

  latexApp.on('successfully-compiled', () => {
    // latex workshop support
    vscode.commands.executeCommand('latex-workshop.refresh-viewer');
  });

  latexApp.launch();


  // Tree provider
  const tree =  new TargetTreeProvider(latexApp.appInfo);
  vscode.window.registerTreeDataProvider('cloudlatex-commands', tree);
  vscode.commands.registerCommand('cloudlatex.refreshEntry', (status: AppInfo) => {
    tree.refresh(status);
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('cloudlatex.compile', () => {
      latexApp.compile();
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cloudlatex.reload', () => {
      latexApp.reload();
    })
  );
}

// this method is called when your extension is deactivated
export function deactivate() {}

// Check if this plugin is enabled.
function isEnabled(): boolean {
  const config = vscode.workspace.getConfiguration('cloudlatex');
  /*
   * To prevent overwriting files unexpectedly,
   * `enabled` should be defined in workspace configuration.
   */
  const enabledInspect = config.inspect('enabled');
  if (!enabledInspect || !enabledInspect.workspaceValue) {
    return false;
  }
  return true;
}

/*
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

class VSLogger extends Logger  {
  _log(m: any, ...o: any[]){console.log(m, ...o);};
  _info(m: any, ...o: any[]){vscode.window.showInformationMessage(m, ...o);};
  _warn(m: any, ...o: any[]){vscode.window.showWarningMessage(m, ...o);};
  _error(m: any, ...o: any[]){vscode.window.showErrorMessage(m, ...o);};
}

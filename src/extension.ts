// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import TargetTreeProvider from './targetTreeProvider';
import LatexApp from './latexApp';
import { AppInfo, Config, DecideSyncMode } from './types';

const decideSyncMode: DecideSyncMode = async function(remoteChanges, localChanges, bothChanges) {
  const pull: vscode.QuickPickItem = { label: 'Push', description: 'Apply local changes to remote.' };
  const push: vscode.QuickPickItem = { label: 'Pull', description: 'Apply remote changes to local' };
  
  const result = await vscode.window.showQuickPick([pull, push]);
  if(result === pull) {
    return 'download';
  } else if(result === push) {
    return 'upload';
  }
  throw new Error('The result of decideSyncMode is invalid.');
};

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  if (!isEnabled()) {
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
  const config = vscode.workspace.getConfiguration('cloudlatex') as any as Config;
  const latexApp = new LatexApp(config, rootPath, decideSyncMode, new VSLogger());
  latexApp.on('appinfo-updated', () => {
    vscode.commands.executeCommand('cloudlatex.refreshEntry', latexApp.appInfo);
  });
  latexApp.on('successfully-compiled', () => {
    // latex workshop support
    vscode.commands.executeCommand('latex-workshop.refresh-viewer');
  });
  
  latexApp.launch();

  const tree =  new TargetTreeProvider({loggedIn: false});
  vscode.window.registerTreeDataProvider('cloudlatex-commands', tree);
  vscode.commands.registerCommand('cloudlatex.refreshEntry', (status: AppInfo) => {
    tree.refresh(status);
  });

  // This line of code will only be executed once when your extension is activated

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  let disposable = vscode.commands.registerCommand('cloudlatex.openWebApp', () => {
    // The code you place here will be executed every time your command is executed
  });

  context.subscriptions.push(disposable);

  context.subscriptions.push(
    vscode.commands.registerCommand('cloudlatex.compile', () => {
      if(latexApp) {
        latexApp.compile();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cloudlatex.reload', () => {
      if(latexApp) {
        latexApp.reload();
      }
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

class VSLogger {
  info(m: any, ...o: any[]){vscode.window.showInformationMessage(m, ...o);};
  warn(m: any, ...o: any[]){vscode.window.showWarningMessage(m, ...o);};
  error(m: any, ...o: any[]){vscode.window.showErrorMessage(m, ...o);};
}

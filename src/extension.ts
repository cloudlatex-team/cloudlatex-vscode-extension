// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import TargetTreeProvider from './targetTreeProvider';
import LatexApp, {AppInfo, Config, DecideSyncMode} from 'latex-extension';

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
  const tree =  new TargetTreeProvider({offline: true});
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

class VSLogger {
  log(m: any, ...o: any[]){console.log(m, ...o);};
  info(m: any, ...o: any[]){vscode.window.showInformationMessage(m, ...o);};
  warn(m: any, ...o: any[]){vscode.window.showWarningMessage(m, ...o);};
  error(m: any, ...o: any[]){vscode.window.showErrorMessage(m, ...o);};
}

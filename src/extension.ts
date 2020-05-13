// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import TargetTreeProvider from './targetTreeProvider';
import LatexApp from './latexApp';
import { AppStatus } from './types';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  if (!LatexApp.isEnabled()) {
    return;
  }
  if (!LatexApp.validateProjectIdConfiguration()) {
    vscode.window.showErrorMessage('ProjectId should be set in workspace configration file.');
    return;
  }
  let latexApp: LatexApp;
  LatexApp.launch().then(_latexApp => latexApp = _latexApp);

  const tree =  new TargetTreeProvider({loggedIn: false});
  vscode.window.registerTreeDataProvider('vscodeWebApp', tree);
  vscode.commands.registerCommand('vscode-web-app.refreshEntry', (status: AppStatus) => {
    tree.refresh(status);
  });

  // This line of code will only be executed once when your extension is activated

  // The command has been defined in the package.json file
  // Now provide the implementation of the command with registerCommand
  // The commandId parameter must match the command field in package.json
  let disposable = vscode.commands.registerCommand('vscode-web-app.openWebApp', () => {
    // The code you place here will be executed every time your command is executed
  });

  context.subscriptions.push(disposable);

  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-web-app.compile', () => {
      if(latexApp) {
        latexApp.compile();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('vscode-web-app.reload', () => {
      if(latexApp) {
        latexApp.reload();
      }
    })
  );
}

// this method is called when your extension is deactivated
export function deactivate() {}

import * as vscode from 'vscode';
import LatexApp, { AppInfo, Config, DecideSyncMode, Logger, Account } from 'cloudlatex-cli-plugin';
import { commandNames } from './const';

export const decideSyncMode: DecideSyncMode = async function (conflictFiles) {
  const push: vscode.QuickPickItem = { label: 'Push', description: 'Apply local changes to remote.' };
  const pull: vscode.QuickPickItem = { label: 'Pull', description: 'Apply remote changes to local' };

  const explanation = `Following files is both changed in the server and local: \n 
    ${conflictFiles.map(file => file.relativePath).join('\n')}
  `;
  const resolveConflict = 'Resolve conflict';
  const selection = await vscode.window.showInformationMessage(explanation, { modal: true }, resolveConflict);

  if (selection !== resolveConflict) {
    throw new Error('Canceled');
  }
  const result = await vscode.window.showQuickPick([pull, push], { placeHolder: explanation });
  if (result === pull) {
    return 'download';
  } else if (result === push) {
    return 'upload';
  }
  throw new Error('Canceled');
};

export async function inputAccount(): Promise<Account> {
  /**
   * Email
   */
  const email = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: 'Email address'
  });
  if (!email) {
    throw new Error('Email address is empty');
  }

  /**
   * Client ID
   */
  const client = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: 'Client ID'
  });
  if (!client) {
    throw new Error('Client ID is empty');
  }

  /**
   * Token
   */
  const token = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: 'Token',
    password: true
  });
  if (!token) {
    throw new Error('Token is empty');
  }

  return { email, client, token };
}

export async function promptToReload(message: string) {
  const item = await vscode.window.showInformationMessage(
    message,
    { title: 'Restart VSCode' }
  );
  if (!item) {
    return;
  }
  vscode.commands.executeCommand('workbench.action.reloadWindow');
}

export async function promptToShowProblemPanel(message: string) {
  const item = await vscode.window.showWarningMessage(
    message,
    { title: 'Check details' }
  );
  if (!item) {
    return;
  }
  vscode.commands.executeCommand('workbench.actions.view.problems');
}

export async function promptToSetAccount(message: string) {
  const item = await vscode.window.showWarningMessage(
    message,
    { title: 'Set account' }
  );
  if (!item) {
    return;
  }
  vscode.commands.executeCommand(commandNames.account);
}

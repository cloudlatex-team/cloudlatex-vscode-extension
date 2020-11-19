import * as vscode from 'vscode';
import LatexApp, { AppInfo, Config, DecideSyncMode, Logger, Account } from 'cloudlatex-cli-plugin';

export const decideSyncMode: DecideSyncMode = async function (conflictFiles) {
  const push: vscode.QuickPickItem = { label: 'Push', description: 'Apply local changes to remote.' };
  const pull: vscode.QuickPickItem = { label: 'Pull', description: 'Apply remote changes to local' };

  const explanation = `Following files is both changed in the server and local: \n 
    ${conflictFiles.join('\n')}
  `;
  const ResolveConflict = 'Resolve conflict';
  const selection = await vscode.window.showInformationMessage(explanation, { modal: true }, ResolveConflict);

  if (selection !== ResolveConflict) {
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
  const email = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: 'Email address'
  });
  if (!email) {
    throw new Error('Email address is empty');
  }

  const client = await vscode.window.showInputBox({
    ignoreFocusOut: true,
    prompt: 'Client ID'
  });
  if (!client) {
    throw new Error('Client ID is empty');
  }

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
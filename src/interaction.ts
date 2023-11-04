import * as vscode from 'vscode';
import { ConflictSolution, Account, FileInfo } from 'cloudlatex-cli-plugin';
import { COMMAND_NAMES } from './const';
import { MESSAGE_TYPE } from './locale';
import { jaTranslation } from './locale/ja';
import { enTranslation } from './locale/en';

export function localeStr(key: keyof typeof MESSAGE_TYPE): string {
  return vscode.env.language === 'ja' ? jaTranslation[key] : enTranslation[key];
}

export const decideConflictSolution = async function (conflictFiles: FileInfo[]): Promise<ConflictSolution> {
  const push: vscode.QuickPickItem = { label: 'Push', description: 'Apply local changes to remote.' };
  const pull: vscode.QuickPickItem = { label: 'Pull', description: 'Apply remote changes to local' };

  const explanation = `Following files is both changed in the server and local: \n 
    ${conflictFiles.map(file => file.relativePath).join('\n')}
  `;
  const RESOLVE_CONFLICT = 'Resolve conflict';
  const selection = await vscode.window.showInformationMessage(explanation, { modal: true }, RESOLVE_CONFLICT);

  if (selection !== RESOLVE_CONFLICT) {
    throw new Error('Canceled');
  }
  const result = await vscode.window.showQuickPick([pull, push], { placeHolder: explanation });
  if (result === pull) {
    return 'pull';
  } else if (result === push) {
    return 'push';
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
    { title: localeStr(MESSAGE_TYPE.CHECK_DETAILS) }
  );
  if (!item) {
    return;
  }
  vscode.commands.executeCommand('workbench.actions.view.problems');
}

export async function promptToSetAccount() {
  const message = localeStr(MESSAGE_TYPE.LOGIN_FAILED);
  const howToGenerateTokenMessage = localeStr('HOW_TO_GENERATE_TOKEN');
  const setAccountMessage = localeStr('SET_ACCOUNT');
  const item = await vscode.window.showWarningMessage(
    message,
    { title: howToGenerateTokenMessage },
    { title: setAccountMessage }
  );

  if (item?.title === howToGenerateTokenMessage) {
    // Open github readme in browser
    vscode.commands.executeCommand(COMMAND_NAMES.openHelpPage);

    // Show message again
    await promptToSetAccount();

  } else if (item?.title === setAccountMessage) {
    // Show input account dialog
    vscode.commands.executeCommand(COMMAND_NAMES.account);

    // Show message again
    await promptToSetAccount();
  }

}

export async function promptToFixConfigEnabledPlace() {
  const detailMessage = localeStr('DETAIL');
  const item = await vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.CONFIG_ENABLED_PLACE_ERROR),
    { title: detailMessage },
  );

  if (item?.title === detailMessage) {
    vscode.commands.executeCommand(COMMAND_NAMES.openHelpPage);
  }
}

export async function showTargetFileSelector(files: FileInfo[]) {
  const items = files.map(file => ({
    label: file.relativePath,
    id: file.id,
  }));
  const explanation = 'Select target file';
  const result = await vscode.window.showQuickPick(items, { placeHolder: explanation });
  return result && files.find(file => file.id === result.id);
}

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

import { EXTENSION_NAME } from './const';


export function  obtainAccountPath(context: vscode.ExtensionContext): string {
  // global storage path to save account data and global meta data.
  const globalStoragePath = context.globalStorageUri.fsPath;
  fs.promises.mkdir(globalStoragePath).catch(() => {
    // directory is already created
  });
  return path.join(globalStoragePath, 'account.json');
}

export function getVSConfig() {
  return vscode.workspace.getConfiguration(EXTENSION_NAME);
}

export function getRootPath(): string | undefined {
  return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0].uri.fsPath;
}

export function getStoragePath(context: vscode.ExtensionContext): string | undefined {
  return context.storageUri?.fsPath;
}


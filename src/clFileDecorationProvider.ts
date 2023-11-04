import * as vscode from 'vscode';
import { SideBarInfo } from './type';
import VSLogger from './vslogger';
import { getRootPath } from './config';
import * as path from 'path';


export class CLFileDecorationProvider implements vscode.FileDecorationProvider {
  private disposable: vscode.Disposable;
  private readonly _onDidChangeDecorations = new vscode.EventEmitter<vscode.Uri[]>();
  readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri[]> = this._onDidChangeDecorations.event;

  constructor(private status: SideBarInfo, private logger: VSLogger) {
    this.disposable = vscode.window.registerFileDecorationProvider(this);
  }

  refresh(status: SideBarInfo): void {
    const oldTarget = this.status.targetRelativeFilePath;
    const newTarget = status.targetRelativeFilePath;

    if (oldTarget === newTarget) {
      return;
    }

    const uris = [];
    if (oldTarget) {
      uris.push(vscode.Uri.file(path.join(getRootPath() || '', oldTarget)));
    }
    if (newTarget) {
      uris.push(vscode.Uri.file(path.join(getRootPath() || '', newTarget)));
    }

    this._onDidChangeDecorations.fire(uris);
    this.status = status;
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const relativePath = path.relative(getRootPath() || '', uri.fsPath);
    if (relativePath === this.status.targetRelativeFilePath) {
      return new vscode.FileDecoration('T', 'Tex Target');
    }
  }
}

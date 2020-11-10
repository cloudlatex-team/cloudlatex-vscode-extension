import * as vscode from 'vscode';
import { Logger } from 'cloudlatex-cli-plugin';

export default class VSLogger extends Logger {
  constructor(private logPanel: vscode.OutputChannel) {
    super();
  }
  _log(m: any, ...o: any[]) {
    this.logPanel.append(m + '\n');
    console.log(m, ...o);
  };
  _info(m: any, ...o: any[]) {
    this.logPanel.append(m + '\n');
    vscode.window.showInformationMessage(m, ...o);
  };
  _warn(m: any, ...o: any[]) {
    this.logPanel.append(m + '\n');
    vscode.window.showWarningMessage(m, ...o);
  };
  _error(m: any, ...o: any[]) {
    this.logPanel.append(m + '\n');
    vscode.window.showErrorMessage(m, ...o);
  };
}

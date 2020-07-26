import * as vscode from 'vscode';
import { Logger } from 'latex-extension';

export default class VSLogger extends Logger  {
  _log(m: any, ...o: any[]){console.log(m, ...o);};
  _info(m: any, ...o: any[]){vscode.window.showInformationMessage(m, ...o);};
  _warn(m: any, ...o: any[]){vscode.window.showWarningMessage(m, ...o);};
  _error(m: any, ...o: any[]){vscode.window.showErrorMessage(m, ...o);};
}

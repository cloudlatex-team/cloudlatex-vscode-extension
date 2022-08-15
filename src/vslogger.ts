import * as vscode from 'vscode';
import { Logger } from 'cloudlatex-cli-plugin';
import * as dateformat from 'dateformat';

export default class VSLogger extends Logger {
  constructor(private logPanel: vscode.OutputChannel) {
    super();
  }
  _log(m: any, ...o: any[]) {
    this._appendToLogPanel('Log  ', m, ...o);
    console.log(m, ...o);
  };
  _info(m: any, ...o: any[]) {
    this._appendToLogPanel('Info ', m, ...o);
    console.info(m, ...o);
  };
  _warn(m: any, ...o: any[]) {
    this._appendToLogPanel('Warn ', m, ...o);
    console.warn(m, ...o);
  };
  _error(m: any, ...o: any[]) {
    this._appendToLogPanel('Error', m, ...o);
    console.error(m, ...o);
  };

  _appendToLogPanel(type: string, m: any, ...o: any[]) {
    const now = new Date();
    const timeStr = dateformat(now, 'hh:MM:ss');
    const message = [m, ...(o || [])].map(o => {
      if (typeof o === 'string') {
        return o;
      }
      return JSON.stringify(o);
    }).join(' ');

    this.logPanel.appendLine(`[${type} - ${timeStr}] ${message}`);
  }
}

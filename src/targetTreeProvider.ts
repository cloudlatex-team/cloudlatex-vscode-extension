import * as vscode from 'vscode';
import {AppInfo} from './types';
import { stat } from 'fs';

export default class TargetTreeProvider implements vscode.TreeDataProvider<object> {
  private _onDidChangeTreeData: vscode.EventEmitter<Item> = new vscode.EventEmitter<Item>();
  readonly onDidChangeTreeData: vscode.Event<Item> = this._onDidChangeTreeData.event;
  constructor(private status: AppInfo) {

  }

  refresh(status: AppInfo): void {
    this.status = status;
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: object): vscode.TreeItem {
    return element;
  }

  getChildren(element?: object): Thenable<object[]> {
    // vscode.commands.executeCommand('cloudlatex.openWebApp');
    // vscode.commands.executeCommand('workbench.view.explorer');

    const items = [];
    if (this.status.loggedIn) {
      items.push( new Item('Compile', vscode.TreeItemCollapsibleState.None,
      this.status.backend || '',
      {
        command: 'cloudlatex.compile',
        title: 'titile',
        arguments: []
      }));
      items.push( new Item('Reload', vscode.TreeItemCollapsibleState.None,
      this.status.backend || '',
      {
        command: 'cloudlatex.reload',
        title: 'titile',
        arguments: []
      }));
    } else {
      items.push(new Item(`Login with ${this.status.backend}`, vscode.TreeItemCollapsibleState.None,
      this.status.backend || '',
      {
        command: 'cloudlatex.openWebApp',
        title: 'titile',
        arguments: []
      }));
    }
    return Promise.resolve(items);
  }
}

class Item extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly backend: string,
    public readonly command?: vscode.Command
  ) {
    super(label, collapsibleState);
  }

  get tooltip(): string {
    return `${this.label}`;
  }

  get description(): string {
    return `(${this.backend})`;
  }
}
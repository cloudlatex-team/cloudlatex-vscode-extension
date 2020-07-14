import * as vscode from 'vscode';
import {AppInfo} from 'latex-extension';

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
    const items = [];
    if (!this.status.offline) {
      items.push( new Item('Compile', vscode.TreeItemCollapsibleState.None,
      '',
      {
        command: 'cloudlatex.compile',
        title: 'titile',
        arguments: []
      }));
      items.push( new Item('Reload', vscode.TreeItemCollapsibleState.None,
      '',
      {
        command: 'cloudlatex.reload',
        title: 'titile',
        arguments: []
      }));
    } else {
      items.push( new Item('Offline', vscode.TreeItemCollapsibleState.None,
      '',
      {
        command: 'cloudlatex.reload',
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
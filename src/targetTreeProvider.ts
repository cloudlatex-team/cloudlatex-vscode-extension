import * as vscode from 'vscode';
import {AppInfo} from 'latex-extension';

// TODO sync from server button
export default class TargetTreeProvider implements vscode.TreeDataProvider<Item> {
  private _onDidChangeTreeData: vscode.EventEmitter<Item | undefined> = new vscode.EventEmitter<Item | undefined>();
  readonly onDidChangeTreeData: vscode.Event<Item | undefined> = this._onDidChangeTreeData.event;
  constructor(private status: AppInfo) {

  }

  refresh(status: AppInfo): void {
    this.status = status;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: Item): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: object) {
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
    return items;
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
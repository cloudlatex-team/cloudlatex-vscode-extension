import * as vscode from 'vscode';
import { CommandNames } from './const';
import { SideBarInfo } from './type';

export default class TargetTreeProvider implements vscode.TreeDataProvider<Item> {
  private _onDidChangeTreeData: vscode.EventEmitter<Item | undefined> = new vscode.EventEmitter<Item | undefined>();
  readonly onDidChangeTreeData: vscode.Event<Item | undefined> = this._onDidChangeTreeData.event;
  constructor(private status: SideBarInfo) {

  }

  refresh(status: SideBarInfo): void {
    this.status = status;
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: Item): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: object) {
    const items = [];

    items.push(new Item('Set account',  vscode.TreeItemCollapsibleState.None,
    {
      command: CommandNames.account,
      title: 'titile',
      arguments: []
    }, 'account'));

    items.push(new Item(
      `Project setting ${this.status.projectName ? '(' + this.status.projectName + ')' : ''}`,
      vscode.TreeItemCollapsibleState.None,
    {
      command: CommandNames.setting,
      title: 'titile',
      arguments: []
    }, 'settings'));

    if (this.status.activated) {
      if (!this.status.offline) {
        items.push( new Item('Compile', vscode.TreeItemCollapsibleState.None,
        {
          command: CommandNames.compile,
          title: 'titile',
          arguments: []
        }, 'debug-start'));
        items.push( new Item('View Compiler Log', vscode.TreeItemCollapsibleState.None,
        {
          command: CommandNames.compilerLog,
          title: 'titile',
          arguments: []
        }, 'output'));
        items.push( new Item('Reload', vscode.TreeItemCollapsibleState.None,
        {
          command: CommandNames.reload,
          title: 'titile',
          arguments: []
        }, 'debug-restart'));
      } else {
        items.push( new Item('Offline', vscode.TreeItemCollapsibleState.None,
        {
          command: CommandNames.reload,
          title: 'titile',
          arguments: []
        }, 'rss'));
      }
    }

    return items;
  }
}

class Item extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command,
    public readonly codicon?: string
  ) {
    super(label, collapsibleState);
    if (codicon) {
      this.iconPath = new vscode.ThemeIcon(codicon);
    }
  }

}
import * as vscode from 'vscode';
import { COMMAND_NAMES } from './const';
import { localeStr } from './interaction';
import { MESSAGE_TYPE } from './locale';
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
    const items: Item[] = [];

    items.push(this.getConnectProjectItem());
    items.push(this.getAccountItem());

    if (this.status.isWorkspace) {
      items.push(this.getProjectItem());
      items.push(this.getConfigureLatexWorkshopItem());
    }

    if (this.status.activated) {
      items.push(this.getViewPDFItem());
      if (this.status.loginStatus !== 'offline') {
        items.push(this.getCompileItem());
        items.push(this.getViewCompilerErrorItem());
        items.push(this.getCompilerLogItem());
        items.push(this.getReloadItem());
      } else {
        items.push(this.getOfflineItem());
      }
    }

    return items;
  }

  getConnectProjectItem() {
    return new Item(localeStr(MESSAGE_TYPE.CONNECT_PROJECT), vscode.TreeItemCollapsibleState.None,
      {
        command: COMMAND_NAMES.connectProject,
        title: 'Connect Project',
        arguments: []
      }, 'plug');
  }

  getAccountItem() {
    let title = `${localeStr(MESSAGE_TYPE.SET_ACCOUNT)} (${localeStr(MESSAGE_TYPE.NOT_LOGGED_IN)})`;
    if (this.status.loginStatus === 'valid') {
      title = `${localeStr(MESSAGE_TYPE.CHANGE_ACCOUNT)} (${this.status.displayUserName || ''})`;
    }

    return new Item(title, vscode.TreeItemCollapsibleState.None,
      {
        command: COMMAND_NAMES.account,
        title: 'account',
        arguments: []
      }, 'account');
  }

  getProjectItem() {
    return new Item(
      `${localeStr(MESSAGE_TYPE.PROJECT_SETTING)} ${this.status.projectName ? '(' + this.status.projectName + ')' : ''}`,
      vscode.TreeItemCollapsibleState.None,
      {
        command: COMMAND_NAMES.setting,
        title: 'setting',
        arguments: []
      }, 'settings');
  }

  getConfigureLatexWorkshopItem() {
    return new Item(localeStr(MESSAGE_TYPE.CONFIGURE_LATEX_WORKSHOP), vscode.TreeItemCollapsibleState.None,
      {
        command: COMMAND_NAMES.configureLatexWorkshop,
        title: 'Configure LaTeX Workshop',
        arguments: []
      }, 'extensions');
  }

  getCompileItem() {
    return new Item(localeStr(MESSAGE_TYPE.COMPILE), vscode.TreeItemCollapsibleState.None,
      {
        command: COMMAND_NAMES.compile,
        title: 'compile',
        arguments: []
      }, 'debug-start');
  }

  getViewCompilerErrorItem() {
    return new Item(localeStr(MESSAGE_TYPE.VIEW_COMPILER_ERROR), vscode.TreeItemCollapsibleState.None,
      {
        command: COMMAND_NAMES.viewCompilerError,
        title: 'error',
        arguments: []
      }, 'alert');
  }

  getCompilerLogItem() {
    return new Item(localeStr(MESSAGE_TYPE.VIEW_LOG), vscode.TreeItemCollapsibleState.None,
      {
        command: COMMAND_NAMES.compilerLog,
        title: 'compilerLog',
        arguments: []
      }, 'output');
  }

  getReloadItem() {
    return new Item(localeStr(MESSAGE_TYPE.RELOAD), vscode.TreeItemCollapsibleState.None,
      {
        command: COMMAND_NAMES.reload,
        title: 'reload',
        arguments: []
      }, 'debug-restart');
  }

  getOfflineItem() {
    return new Item(localeStr(MESSAGE_TYPE.OFFLINE), vscode.TreeItemCollapsibleState.None,
      {
        command: COMMAND_NAMES.reload,
        title: 'reload',
        arguments: []
      }, 'rss');
  }

  getViewPDFItem() {
    return new Item(localeStr(MESSAGE_TYPE.VIEW_PDF), vscode.TreeItemCollapsibleState.None,
    {
      command: COMMAND_NAMES.viewPDF,
      title: 'view PDF',
      arguments: []
    }, 'file-pdf');
  }
}

class Item extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command,
    public readonly codicon?: string,
  ) {
    super(label, collapsibleState);
    if (codicon) {
      this.iconPath = new vscode.ThemeIcon(codicon);
    }
  }

}

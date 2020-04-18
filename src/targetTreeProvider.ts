import * as vscode from 'vscode';

export default class TargetTreeProvider implements vscode.TreeDataProvider<object> {
  private _onDidChangeTreeData: vscode.EventEmitter<object | undefined> = new vscode.EventEmitter<object | undefined>();
  readonly onDidChangeTreeData: vscode.Event<object | undefined> = this._onDidChangeTreeData.event;

  constructor() {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: object): vscode.TreeItem {
    return element;
  }

  getChildren(element?: object): Thenable<object[]> {
    // vscode.commands.executeCommand('vscode-web-app.openWebApp');
    // vscode.commands.executeCommand('workbench.view.explorer');

    this._onDidChangeTreeData.fire(); // Make sure collection is not cached.
    //return Promise.reject([]);
    return Promise.resolve([
      new Item('Login with CloudLatex', vscode.TreeItemCollapsibleState.None, {
        command: 'vscode-web-app.openWebApp',
        title: 'titile',
        arguments: []
      }),
      new Item('Compile', vscode.TreeItemCollapsibleState.None, {
        command: 'vscode-web-app.compile',
        title: 'titile',
        arguments: []
      }),
      new Item('Reload', vscode.TreeItemCollapsibleState.None, {
        command: 'vscode-web-app.reload',
        title: 'titile',
        arguments: []
      })
    ]);
  }
}

class Item extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly command?: vscode.Command
  ) {
    super(label, collapsibleState);
  }

  get tooltip(): string {
    return `${this.label}`;
  }

  get description(): string {
    return '(CloudLatex)[https://cloudlatex.io/]';
  }
}
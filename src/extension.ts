// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import TargetTreeProvider from './targetTreeProvider';
import LatexApp, {AppInfo, Config, Account, CompileResult} from 'cloudlatex-cli-plugin';
import { decideSyncMode, inputAccount } from './interaction';
import VSLogger from './vslogger';
import { VSConfig, SideBarInfo } from './type';
import * as fs from 'fs';
import * as path from 'path';
// #TODO check invalid account at start and offline

// #TODO account 消えてる？
// #TODO save user info in ~/.cloudlatex or ...
// https://github.com/shanalikhan/code-settings-sync/blob/eb332ba5e8180680e613e94be89119119c5638d1/src/service/github.oauth.service.ts#L116
// https://github.com/shanalikhan/code-settings-sync/blob/eb332ba5e8180680e613e94be89119119c5638d1/src/environmentPath.ts

export async function activate(context: vscode.ExtensionContext) {
  const app = new VSLatexApp(context);
  app.activate();

  vscode.workspace.onDidChangeConfiguration(() => {
    app.activate();
  });

  console.log(context.globalStoragePath);
}

export function deactivate() {
  // TODO delete config files
}

class VSLatexApp {
  latexApp!: LatexApp;
  context: vscode.ExtensionContext;
  logger: VSLogger;
  tree!: TargetTreeProvider;
  statusBarItem!: vscode.StatusBarItem;
  statusBarAnimationId:  NodeJS.Timeout  | null = null;
  activated: boolean;
  logPanel: vscode.OutputChannel;
  problemPanel: vscode.DiagnosticCollection;
  constructor(context: vscode.ExtensionContext) {
    this.context =  context;
    this.activated = false;
    this.problemPanel = vscode.languages.createDiagnosticCollection('LaTeX');
    this.logPanel = vscode.window.createOutputChannel('Cloud LaTeX');
    this.logPanel.append('Ready\n');
    this.logger = new VSLogger(this.logPanel);
    this.setupStatusBar();
    this.setupCommands();
    this.setupSideBar();
  }

  async activate() {
    if (this.latexApp) {
      this.latexApp.exit();
    }
    const config = await this.configuration();
    this.latexApp = new LatexApp(config, decideSyncMode, this.logger);

    if (!this.validateVSConfig()) {
      this.activated = false;
      vscode.commands.executeCommand('cloudlatex.refreshEntry');
      return;
    }

    this.activated = true;
    vscode.commands.executeCommand('cloudlatex.refreshEntry');

    this.latexApp.on('appinfo-updated', () => {
      vscode.commands.executeCommand('cloudlatex.refreshEntry');
    });

    this.latexApp.on('start-sync', () => {
      this.statusBarItem.text = '$(sync~spin)';
    });

    this.latexApp.on('failed-sync', () => {
      this.statusBarItem.text = '$(issues)';
      this.statusBarItem.show();
    });

    this.latexApp.on('successfully-synced', () => {
      this.statusBarItem.text = '$(folder-active)';
      this.statusBarItem.show();
    });

    this.latexApp.on('start-compile', () => {
      this.statusBarItem.text = '$(loading~spin)';
      this.statusBarItem.show();
    });

    this.latexApp.on('successfully-compiled', (result: CompileResult) => {
      this.statusBarItem.text = 'Compiled';
      this.statusBarItem.show();
      this.showProblems(result.logs);

      // latex workshop support
      vscode.commands.executeCommand('latex-workshop.refresh-viewer');
    });

    this.latexApp.on('failed-compile', (result: CompileResult) =>{
      this.logger.log('failed compilation', result);
      this.statusBarItem.text = 'Failed to compile';
      this.statusBarItem.show();
      if (result.logs) {
        this.showProblems(result.logs);
      }
    });

    /**
     * Launch app
     */
    await this.latexApp.launch();
    if (await this.latexApp.validateAccount() === 'valid') {
      this.latexApp.startSync(true);
    }
  }

  /**
   * SideBar
   */
  setupSideBar() {
    this.tree =  new TargetTreeProvider(this.sideBarInfo);
    const panel = vscode.window.registerTreeDataProvider('cloudlatex-commands', this.tree);
  }

  /**
   * Status Bar
   */
  setupStatusBar() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    this.statusBarItem.command = 'cloudlatex.open';
    this.statusBarItem.text = 'CL';
    this.context.subscriptions.push(this.statusBarItem);
  }

  /**
   * Problems panel
   *
   * ref: https://github.com/James-Yu/LaTeX-Workshop/blob/master/src/components/parser/log.ts
   */
  showProblems(logs: CompileResult['logs']) {
    this.problemPanel.clear();
    if (!logs || logs.length === 0) {
      return;
    }
    const diagsCollection: { [key: string]: vscode.Diagnostic[] } = {};
    logs.forEach((log) => {
        const range = new vscode.Range(new vscode.Position(log.line - 1, 0), new vscode.Position(log.line - 1, 65535));
        const diag = new vscode.Diagnostic(range, log.message,
          log.type ==='warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error );
        diag.source = 'LaTeX';
        if (diagsCollection[log.file] === undefined) {
            diagsCollection[log.file] = [];
        }
        diagsCollection[log.file].push(diag);
    });

    for (const file in diagsCollection) {
        this.problemPanel.set(vscode.Uri.file(file), diagsCollection[file]);
    }
  }

  /**
   * Commands
   */
  setupCommands() {
    vscode.commands.registerCommand('cloudlatex.refreshEntry', () => {
      this.tree.refresh(this.sideBarInfo); // TODO fix error
    });

    vscode.commands.registerCommand('cloudlatex.compile', async () => {
      const result = await this.latexApp.validateAccount();
      if (result === 'offline') {
        this.logger.warn('Cannot stil connect to the server.');
        return;
      }
      if (result === 'invalid') {
        return;
      }
      this.latexApp.compile();
    });

    vscode.commands.registerCommand('cloudlatex.reload', async () => {
      const result = await this.latexApp.validateAccount();
      if (result === 'offline') {
        this.logger.warn('Cannot stil connect to the server.');
      }
      if (result === 'valid') {
        this.latexApp.startSync(true);
      }
    });

    vscode.commands.registerCommand('cloudlatex.open', () => {
      vscode.commands.executeCommand('workbench.view.extension.cloudlatex').then(
        () => vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
      );
    });

    vscode.commands.registerCommand('cloudlatex.account', async () => {
      let account!: Account;
      try {
        account = await inputAccount();
      } catch (e) {
        this.logger.log('account input is canceled');
        return; // input box is canceled.
      }
      try {
        this.latexApp.setAccount(account);
        if (!this.sideBarInfo.activated) {
          return;
        }
        if (await this.latexApp.validateAccount() === 'valid') {
          this.logger.info('Your account is validated!');
          this.latexApp.startSync(true);
        }
      } catch (e) {
        this.logger.warn(JSON.stringify(e));
      }
    });

    vscode.commands.registerCommand('cloudlatex.setting', async() => {
      await vscode.commands.executeCommand( 'workbench.action.openWorkspaceSettings');
      await vscode.commands.executeCommand( 'workbench.action.openSettings', 'cloudlatex' );
    });

    vscode.commands.registerCommand('cloudlatex.compilerLog', () => {
     this.logPanel.show();
    });

    vscode.commands.registerCommand('cloudlatex.resetLocal', async() => {
      this.latexApp.resetLocal();
    });
  }

  async configuration(): Promise<Config> {
    const rootPath = vscode.workspace.rootPath;
    if (!rootPath) {
      throw new Error('The root path can not be obtained!');
    }

    const vsconfig = vscode.workspace.getConfiguration('cloudlatex') as any as VSConfig;

    // storage path to save meta data
    const storagePath = this.context.storagePath || rootPath;
    try {
      await fs.promises.mkdir(storagePath);
    } catch (e) {
      // directory is already created
    }

    // global storage path to save account data and global meta data.
    const globalStoragePath = this.context.globalStoragePath;
    try {
      await fs.promises.mkdir(globalStoragePath);
    } catch (e) {
      // directory is already created
    }
    const accountPath = path.join(globalStoragePath, 'account.json');

    return {
      ...vsconfig,
      backend: 'cloudlatex',
      storagePath,
      rootPath,
      accountStorePath: accountPath,
    };
  }

  validateVSConfig(): boolean {
    /**
     * Enabled
     */
    const config = vscode.workspace.getConfiguration('cloudlatex');
     // To prevent overwriting files unexpectedly,
     //`enabled` should be defined in workspace configuration.
    const enabledInspect = config.inspect<boolean>('enabled');
    if (!enabledInspect || enabledInspect.globalValue) {
      vscode.window.showErrorMessage('Be sure to set cloudlatex.enable to true not at user\'s settings but at workspace settings.');
      return false;
    }

    if (!enabledInspect.workspaceValue) {
      return false;
    }


    /**
     * Project ID
     */
    const projectIdInspect = config.inspect('projectId');
    if (!projectIdInspect || !projectIdInspect.workspaceValue) {
      vscode.window.showErrorMessage('ProjectId should be set in workspace configration file.');
      return false;
    }

    return true;
  }

  get sideBarInfo(): SideBarInfo {
    return {
      offline: this.latexApp && this.latexApp.appInfo.offline,
      activated: this.activated,
      projectName: this.latexApp && this.latexApp.appInfo.projectName || null
    };
  }
}

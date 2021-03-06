// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { ExtensionName, ConfigNames, CommandNames, DataTreeProviderId, StatusBarText } from './const';
import TargetTreeProvider from './targetTreeProvider';
import LatexApp, { AppInfo, Config, Account, CompileResult, AccountService } from 'cloudlatex-cli-plugin';
import { decideSyncMode, inputAccount, promptToReload, promptToShowProblemPanel, promptToSetAccount } from './interaction';
import VSLogger from './vslogger';
import { VSConfig, SideBarInfo } from './type';
import * as fs from 'fs';
import * as path from 'path';

export async function activate(context: vscode.ExtensionContext) {
  const app = new VSLatexApp(context);
  app.activate();

  vscode.workspace.onDidChangeConfiguration(async (e) => {
    if (
      [ConfigNames.enabled, ConfigNames.outDir, ConfigNames.autoCompile, ConfigNames.endpoint, ConfigNames.projectId]
        .some(name => e.affectsConfiguration(name))
    ) {

      if (
        [ConfigNames.enabled, ConfigNames.endpoint, ConfigNames.projectId]
          .some(name => e.affectsConfiguration(name))
      ) {
        const storagePath = app.getStoragePath();
        if (storagePath) {
          app.removeFilesInStoragePath(storagePath);
        }
      }

      app.latexApp?.stopFileWatcher();
      app.activated = false;
      vscode.commands.executeCommand(CommandNames.refreshEntry);

      promptToReload('Configuration has been changed. Please restart to apply it.');
    }
  });
}

export function deactivate() {
  // TODO delete config files
}

class VSLatexApp {
  latexApp?: LatexApp;
  context: vscode.ExtensionContext;
  logger: VSLogger;
  tree!: TargetTreeProvider;
  statusBarItem!: vscode.StatusBarItem;
  statusBarAnimationId: NodeJS.Timeout | null = null;
  logPanel: vscode.OutputChannel;
  problemPanel: vscode.DiagnosticCollection;
  activated: boolean;
  autoCompile: boolean = false;
  syncedInitilally: boolean;
  accountService: AccountService<Account>;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.activated = false;
    this.syncedInitilally = false;
    this.accountService = new AccountService(this.obtainAccountPath());
    this.problemPanel = vscode.languages.createDiagnosticCollection('LaTeX');
    this.logPanel = vscode.window.createOutputChannel('Cloud LaTeX');
    this.logPanel.appendLine('Ready');
    this.logger = new VSLogger(this.logPanel);
    this.setupStatusBar();
    this.setupCommands();
    this.setupSideBar();
  }

  async activate() {
    if (this.latexApp) {
      this.latexApp.stopFileWatcher();
    }

    this.activated = false;

    let rootPath = '';
    if (this.validateVSConfig()) {
      let _rootPath = this.getRootPath();
      if (_rootPath) {
        this.activated = true;
        rootPath = _rootPath;
      } else {
        // no workspace
        this.logger.info('No workspace');
      }
    }

    const config = await this.configuration(rootPath);
    this.autoCompile = config.autoCompile || false;
    this.latexApp = await LatexApp.createApp(config, {
      decideSyncMode,
      logger: this.logger,
      accountService: this.accountService
    });

    vscode.commands.executeCommand(CommandNames.refreshEntry);

    this.latexApp.on('network-updated', () => {
      vscode.commands.executeCommand(CommandNames.refreshEntry);
    });

    this.latexApp.on('project-loaded', () => {
      vscode.commands.executeCommand(CommandNames.refreshEntry);
    });

    this.latexApp.on('file-changed', async () => {
      if (await this.validateAccount() !== 'valid') {
        return;
      }
      this.latexApp!.startSync();
    });

    this.latexApp.on('sync-failed', () => {
      this.statusBarItem.text = '$(issues)';
      this.statusBarItem.show();
    });

    this.latexApp.on('successfully-synced', (result) => {
      this.statusBarItem.text = '$(folder-active)';
      this.statusBarItem.show();
      if (!this.syncedInitilally || (result.fileChanged && this.autoCompile)) {
        this.compile();
      }
      if (!this.syncedInitilally) {
        this.syncedInitilally = true;
        this.logger.info('Project files have been synchronized!');
      }
    });

    /**
     * Launch app
     */
    if (this.activated) {
      await this.latexApp.startFileWatcher();
      if (await this.validateAccount() !== 'valid') {
        return;
      }
      this.startSync();
    }
  }

  startSync() {
    if (!this.latexApp) {
      this.logger.error('LatexApp is not defined');
      return;
    }
    this.latexApp.startSync();
    this.statusBarItem.text = '$(sync~spin)';
    this.statusBarItem.show();
  }

  async compile() {
    if (!this.latexApp) {
      this.logger.error('LatexApp is not defined');
      return;
    }
    this.statusBarItem.text = '$(loading~spin)';
    this.statusBarItem.show();

    const result = await this.latexApp.compile();

    if (result.status === 'success') { // Succeeded
      this.statusBarItem.text = 'Compiled';
      this.statusBarItem.show();
      this.showProblems(result.logs);

      // latex workshop support
      try {
        vscode.commands.executeCommand('latex-workshop.refresh-viewer');
      } catch (e) { // no latexworkshop?
      }

    } else { // Failed
      this.statusBarItem.text = 'Failed to compile';
      this.statusBarItem.show();
      if (result.logs) {
        this.showProblems(result.logs);
      }
      promptToShowProblemPanel('Compilation error');
    }
  }

  async validateAccount() {
    const result = await this.latexApp!.validateAccount();
    if (result === 'invalid') {
      this.logger.log('Account is invalid');
      promptToSetAccount('Your account is invalid');
    }
    return result;
  }

  /**
   * SideBar
   */
  setupSideBar() {
    this.tree = new TargetTreeProvider(this.sideBarInfo);
    const panel = vscode.window.registerTreeDataProvider(DataTreeProviderId, this.tree);
  }

  /**
   * Status Bar
   */
  setupStatusBar() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    this.statusBarItem.command = CommandNames.open;
    this.statusBarItem.text = StatusBarText;
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
        log.type === 'warning' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Error);
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
    vscode.commands.registerCommand(CommandNames.refreshEntry, () => {
      this.tree.refresh(this.sideBarInfo);
    });

    vscode.commands.registerCommand(CommandNames.compile, async () => {
      if (!this.latexApp || !this.activated) {
        this.logger.warn(`'${CommandNames.compile}' cannot be called without workspace.`);
        return;
      }

      const result = await this.validateAccount();

      if (result === 'offline') {
        this.logger.warn('Cannot connect to the server.');
      }

      if (result === 'valid') {
        this.compile();
      }
    });

    vscode.commands.registerCommand(CommandNames.reload, async () => {
      if (!this.latexApp || !this.activated) {
        this.logger.warn(`'${CommandNames.reload}' cannot be called without workspace.`);
        return;
      }

      const result = await this.validateAccount();

      if (result === 'offline') {
        this.logger.warn('Cannot connect to the server.');
      }

      if (result === 'valid') {
        this.startSync();
      }
    });

    vscode.commands.registerCommand(CommandNames.open, () => {
      vscode.commands.executeCommand(`workbench.view.extension.${ExtensionName}`).then(
        () => vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
      );
    });

    vscode.commands.registerCommand(CommandNames.account, async () => {
      let account!: Account;
      try {
        account = await inputAccount();
      } catch (e) {
        this.logger.log('Account input is canceled');
        return; // input box is canceled.
      }
      try {
        this.accountService.save(account);
        if (!this.latexApp) {
          return;
        }
        if (await this.validateAccount() === 'valid') {
          this.logger.info('Your account has been validated!');
          if (this.sideBarInfo.activated) {
            this.startSync();
          }
        }
      } catch (e) {
        this.logger.error('Error in setting account: ' + (e || '').toString() + '\n' + (e && e.trace || ''));
      }
    });

    vscode.commands.registerCommand(CommandNames.setting, async () => {
      await vscode.commands.executeCommand('workbench.action.openWorkspaceSettings');
      await vscode.commands.executeCommand('workbench.action.openSettings', ExtensionName);
    });

    vscode.commands.registerCommand(CommandNames.compilerLog, () => {
      this.logPanel.show();
    });

    vscode.commands.registerCommand(CommandNames.resetLocal, async () => {
      if (!this.latexApp || !this.activated) {
        this.logger.warn(`'${CommandNames.resetLocal}' cannot be called without workspace.`);
        return;
      }

      this.latexApp.resetLocal();
      this.startSync();
    });

    vscode.commands.registerCommand(CommandNames.clearAccount, async () => {
      try {
        await fs.promises.unlink(this.obtainAccountPath());
      } catch (e) {
        this.logger.error(e);
      }
    });
  }

  async configuration(rootPath: string): Promise<Config> {
    const vsconfig = vscode.workspace.getConfiguration(ExtensionName) as any as VSConfig;

    const storagePath = this.getStoragePath();
    if (!storagePath) {
      this.logger.log('No storage path');
    } else {
      // storage path to save meta data
      try {
        await fs.promises.mkdir(storagePath);
      } catch (e) {
        // directory is already created
      }
    }

    return {
      ...vsconfig,
      backend: 'cloudlatex',
      storagePath,
      rootPath,
    };
  }

  obtainAccountPath(): string {
    // global storage path to save account data and global meta data.
    const globalStoragePath = this.context.globalStoragePath;
    fs.promises.mkdir(globalStoragePath).catch(() => {
      // directory is already created
    });
    return path.join(globalStoragePath, 'account.json');
  }

  async removeFilesInStoragePath(storagePath: string) {
    const files = await fs.promises.readdir(storagePath);
    try {
      await Promise.all(files.map(file => {
        return fs.promises.unlink(path.join(storagePath, file));
      }));
    } catch (e) {
      this.logger.error(e);
    }
  }

  validateVSConfig(): boolean {
    /**
     * Enabled
     */
    const config = vscode.workspace.getConfiguration(ExtensionName);
    // To prevent overwriting files unexpectedly,
    //`enabled` should be defined in workspace configuration.
    const enabledInspect = config.inspect<boolean>('enabled');
    if (!enabledInspect) {
      return false;
    }

    if (enabledInspect.globalValue) {
      vscode.window.showErrorMessage(`Be sure to set ${ConfigNames.enabled} to true not at user\'s settings but at workspace settings.`);
    }

    if (!enabledInspect.workspaceValue) {
      return false;
    }


    /**
     * Project ID
     */
    const projectIdInspect = config.inspect('projectId');
    if (!projectIdInspect) {
      return false;
    }

    if (projectIdInspect.globalLanguageValue) {
      vscode.window.showErrorMessage('ProjectId should be set in workspace configration file.');
    }

    if (!projectIdInspect.workspaceValue) {
      return false;
    }

    return true;
  }

  getRootPath(): string | undefined {
    return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0].uri.fsPath;
  }

  getStoragePath(): string | undefined {
    return this.context.storagePath;
  }

  get sideBarInfo(): SideBarInfo {
    return {
      isWorkspace: !!this.getRootPath(),
      offline: this.latexApp && this.latexApp.appInfo.offline || false,
      activated: this.activated,
      projectName: this.latexApp && this.latexApp.appInfo.projectName || null
    };
  }
}

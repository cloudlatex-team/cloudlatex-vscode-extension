// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { EXTENSION_NAME, CONFIG_NAMES, COMMAND_NAMES, DATA_TREE_PROVIDER_ID, STATUS_BAR_TEXT } from './const';
import TargetTreeProvider from './targetTreeProvider';
import { LatexApp, LATEX_APP_EVENTS, Config, Account, CompileResult, AccountService } from 'cloudlatex-cli-plugin';
import { decideSyncMode, inputAccount, promptToReload, promptToShowProblemPanel, promptToSetAccount, localeStr } from './interaction';
import VSLogger from './vslogger';
import { VSConfig, SideBarInfo } from './type';
import * as fs from 'fs';
import * as path from 'path';
import { MESSAGE_TYPE } from './locale';

export async function activate(context: vscode.ExtensionContext) {
  const app = new VSLatexApp(context);
  app.activate();

  vscode.workspace.onDidChangeConfiguration(async (e) => {
    if (
      [CONFIG_NAMES.enabled, CONFIG_NAMES.outDir, CONFIG_NAMES.autoCompile, CONFIG_NAMES.endpoint, CONFIG_NAMES.projectId]
        .some(name => e.affectsConfiguration(name))
    ) {

      if (
        [CONFIG_NAMES.enabled, CONFIG_NAMES.endpoint, CONFIG_NAMES.projectId]
          .some(name => e.affectsConfiguration(name))
      ) {
        const storagePath = app.getStoragePath();
        if (storagePath) {
          app.removeFilesInStoragePath(storagePath);
        }
      }

      app.latexApp?.stopFileWatcher();
      app.activated = false;
      vscode.commands.executeCommand(COMMAND_NAMES.refreshEntry);

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
  autoCompile: boolean;
  syncedInitilally: boolean;
  accountService: AccountService<Account>;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.activated = false;
    this.autoCompile = false;
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
        vscode.window.showInformationMessage(localeStr(MESSAGE_TYPE.NO_WORKSPACE_ERROR));
      }
    }

    const config = await this.configuration(rootPath);
    this.autoCompile = config.autoCompile || false;
    this.latexApp = await LatexApp.createApp(config, {
      decideSyncMode,
      logger: this.logger,
      accountService: this.accountService
    });

    vscode.commands.executeCommand(COMMAND_NAMES.refreshEntry);

    this.latexApp.on(LATEX_APP_EVENTS.LOGIN_SUCCEEDED, () => {
      vscode.commands.executeCommand(COMMAND_NAMES.refreshEntry);
      vscode.window.showInformationMessage(localeStr(MESSAGE_TYPE.LOGIN_SUCCEEDED));
    });

    this.latexApp.on(LATEX_APP_EVENTS.LOGIN_FAILED, () => {
      vscode.commands.executeCommand(COMMAND_NAMES.refreshEntry);
    });

    this.latexApp.on(LATEX_APP_EVENTS.LOGIN_OFFLINE, () => {
      vscode.commands.executeCommand(COMMAND_NAMES.refreshEntry);
      vscode.window.showInformationMessage(localeStr(MESSAGE_TYPE.OFFLINE_ERROR));

    });

    this.latexApp.on(LATEX_APP_EVENTS.PROJECT_LOADED, () => {
      vscode.commands.executeCommand(COMMAND_NAMES.refreshEntry);
    });

    this.latexApp.on(LATEX_APP_EVENTS.FILE_CHANGED, async () => {
      if (await this.validateAccount() !== 'valid') {
        return;
      }
      this.latexApp!.startSync();
    });

    this.latexApp.on(LATEX_APP_EVENTS.FILE_SYNC_FAILED, () => {
      this.statusBarItem.text = '$(issues)';
      this.statusBarItem.show();
      vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.FILE_SYNC_FAILED));
    });

    this.latexApp.on(LATEX_APP_EVENTS.FILE_SYNC_SUCCEEDED, (result) => {
      this.statusBarItem.text = '$(folder-active)';
      this.statusBarItem.show();
      if (!this.syncedInitilally || (result.fileChanged && this.autoCompile)) {
        this.compile();
      }
      if (!this.syncedInitilally) {
        this.syncedInitilally = true;
        vscode.window.showInformationMessage(localeStr(MESSAGE_TYPE.FILE_SYNCHRONIZED));
      }
    });

    this.latexApp.on(LATEX_APP_EVENTS.FILE_CHANGE_ERROR, (detail: string) => {
      vscode.window.showErrorMessage('File change error', detail);
    });

    this.latexApp.on(LATEX_APP_EVENTS.COMPILATION_STARTED, () => {
      this.statusBarItem.text = '$(loading~spin)';
      this.statusBarItem.show();
    });

    this.latexApp.on(LATEX_APP_EVENTS.COMPILATION_SUCCEEDED, (result) => {
      this.statusBarItem.text = 'Compiled';
      this.statusBarItem.show();
      this.showProblems(result.logs);

      // latex workshop support
      try {
        vscode.commands.executeCommand('latex-workshop.refresh-viewer');
      } catch (e) { // no latexworkshop?
      }
    });

    this.latexApp.on(LATEX_APP_EVENTS.COMPILATION_FAILED, (result) => {
      this.statusBarItem.text = 'Failed to compile';
      this.statusBarItem.show();
      if (result.logs) {
        this.showProblems(result.logs);
      }
      promptToShowProblemPanel(localeStr(MESSAGE_TYPE.COMPILATION_FAILED));
    });

    this.latexApp.on(LATEX_APP_EVENTS.UNEXPECTED_ERROR, () => {
      vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.UNEXPECTED_ERROR));
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
      vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.UNEXPECTED_ERROR));
      return;
    }
    this.latexApp.startSync();
    this.statusBarItem.text = '$(sync~spin)';
    this.statusBarItem.show();
  }

  compile() {
    if (!this.latexApp) {
      this.logger.error('LatexApp is not defined');
      vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.UNEXPECTED_ERROR));
      return;
    }

    this.latexApp.compile();
  }

  async validateAccount() {
    const result = await this.latexApp!.validateAccount();
    if (result === 'invalid') {
      promptToSetAccount(localeStr(MESSAGE_TYPE.LOGIN_FAILED));
    }
    return result;
  }

  /**
   * SideBar
   */
  setupSideBar() {
    this.tree = new TargetTreeProvider(this.sideBarInfo);
    const panel = vscode.window.registerTreeDataProvider(DATA_TREE_PROVIDER_ID, this.tree);
  }

  /**
   * Status Bar
   */
  setupStatusBar() {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    this.statusBarItem.command = COMMAND_NAMES.open;
    this.statusBarItem.text = STATUS_BAR_TEXT;
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
    vscode.commands.registerCommand(COMMAND_NAMES.refreshEntry, () => {
      this.tree.refresh(this.sideBarInfo);
    });

    vscode.commands.registerCommand(COMMAND_NAMES.compile, async () => {
      if (!this.latexApp || !this.activated) {
        const msg = `'${COMMAND_NAMES.compile}' cannot be called without workspace.`;
        this.logger.warn(msg);
        vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.NO_WORKSPACE_ERROR));
        return;
      }

      const result = await this.validateAccount();

      if (result === 'offline') {
        vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.OFFLINE_ERROR));
      }

      if (result === 'valid') {
        this.compile();
      }
    });

    vscode.commands.registerCommand(COMMAND_NAMES.reload, async () => {
      if (!this.latexApp || !this.activated) {
        const msg = `'${COMMAND_NAMES.reload}' cannot be called without workspace.`;
        this.logger.warn(msg);
        vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.NO_WORKSPACE_ERROR));
        return;
      }

      const result = await this.validateAccount();

      if (result === 'offline') {
        vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.OFFLINE_ERROR));
      }

      if (result === 'valid') {
        this.startSync();
      }
    });

    vscode.commands.registerCommand(COMMAND_NAMES.open, () => {
      vscode.commands.executeCommand(`workbench.view.extension.${EXTENSION_NAME}`).then(
        () => vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup')
      );
    });

    vscode.commands.registerCommand(COMMAND_NAMES.account, async () => {
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
          if (this.activated) {
            this.startSync();
          }
        }
      } catch (e) {
        const msg = `Error in setting account: ${(e as any || '').toString()} \n  ${(e && (e as Error).stack || '')}`;
        this.logger.error(msg);
        vscode.window.showErrorMessage(msg, { modal: true });
      }
    });

    vscode.commands.registerCommand(COMMAND_NAMES.setting, async () => {
      await vscode.commands.executeCommand('workbench.action.openSettings', EXTENSION_NAME);
      await vscode.commands.executeCommand('workbench.action.openWorkspaceSettings');
    });

    vscode.commands.registerCommand(COMMAND_NAMES.compilerLog, () => {
      this.logPanel.show();
    });

    vscode.commands.registerCommand(COMMAND_NAMES.resetLocal, async () => {
      if (!this.latexApp || !this.activated) {
        const msg = `'${COMMAND_NAMES.resetLocal}' cannot be called without workspace.`;
        this.logger.warn(msg);
        vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.NO_WORKSPACE_ERROR));
        return;
      }

      this.latexApp.resetLocal();
      this.startSync();
    });

    vscode.commands.registerCommand(COMMAND_NAMES.clearAccount, async () => {
      try {
        await fs.promises.unlink(this.obtainAccountPath());
      } catch (e) {
        this.logger.error(e);
        vscode.window.showErrorMessage((e as Error).toString());
      }
    });
  }

  async configuration(rootPath: string): Promise<Config> {
    const vsconfig = vscode.workspace.getConfiguration(EXTENSION_NAME) as any as VSConfig;

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
      vscode.window.showErrorMessage((e as Error).toString());
    }
  }

  validateVSConfig(): boolean {
    /**
     * Enabled
     */
    const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
    // To prevent overwriting files unexpectedly,
    //`enabled` should be defined in workspace configuration.
    const enabledInspect = config.inspect<boolean>('enabled');
    if (!enabledInspect) {
      return false;
    }

    if (enabledInspect.globalValue) {
      vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.CONFIG_ENABLED_PLACE_ERROR));
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
      vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.CONFIG_PROJECTID_EMPTY_ERROR));
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
      loginStatus: this.latexApp?.appInfo.loginStatus || 'offline',
      activated: this.activated,
      projectName: this.latexApp?.appInfo.projectName || null,
      displayUserName: this.accountService.account?.email || '',
    };
  }
}

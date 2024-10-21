// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { EXTENSION_NAME, CONFIG_NAMES, COMMAND_NAMES, DATA_TREE_PROVIDER_COMMDNS_ID, STATUS_BAR_TEXT } from './const';
import TargetTreeProvider from './targetTreeProvider';
import { LatexApp, LATEX_APP_EVENTS, Config, Account, CompileResult, AccountService, AppInfo, ConflictSolution, SyncResult } from 'cloudlatex-cli-plugin';
import { inputAccount, promptToReload, promptToShowProblemPanel, promptToSetAccount, localeStr, promptToFixConfigEnabledPlace, decideConflictSolution, showTargetFileSelector } from './interaction';
import VSLogger from './vslogger';
import { SideBarInfo, VSConfig } from './type';
import * as fs from 'fs';
import * as path from 'path';
import { MESSAGE_TYPE } from './locale';
import * as latexWorkshop from './external/latexWorkshop';
import { getRootPath, getStoragePath, getVSConfig, obtainAccountPath } from './config';
import { CLFileDecorationProvider } from './clFileDecorationProvider';

export async function activate(context: vscode.ExtensionContext) {
  const app = new VSLatexApp(context);
  await app.activate();

  vscode.workspace.onDidChangeConfiguration(async (e) => {
    if (
      [CONFIG_NAMES.enabled, CONFIG_NAMES.outDir, CONFIG_NAMES.autoCompile, CONFIG_NAMES.endpoint, CONFIG_NAMES.projectId, CONFIG_NAMES.ignoredFiles]
        .some(name => e.affectsConfiguration(name))
    ) {

      if (
        [CONFIG_NAMES.enabled, CONFIG_NAMES.endpoint, CONFIG_NAMES.projectId]
          .some(name => e.affectsConfiguration(name))
      ) {
        const storagePath = getStoragePath(context);
        if (storagePath) {
          app.removeFilesInStoragePath(storagePath);
        }
      }

      app.latexApp?.stop();
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
  tree?: TargetTreeProvider;
  fileDecorationProvider?: CLFileDecorationProvider;
  statusBarItem!: vscode.StatusBarItem;
  statusBarAnimationId: NodeJS.Timeout | null = null;
  logPanel: vscode.OutputChannel;
  problemPanel: vscode.DiagnosticCollection;
  activated: boolean;
  autoCompile: boolean;
  syncedInitilally: boolean;
  accountService: AccountService<Account>;
  appInfo: AppInfo = {
    loginStatus: 'offline',
    loaded: false,
    conflictFiles: [],
    files: [],
    targetFileCandidates: [],
  };

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.activated = false;
    this.autoCompile = false;
    this.syncedInitilally = false;
    this.accountService = new AccountService(obtainAccountPath(context));
    this.problemPanel = vscode.languages.createDiagnosticCollection('LaTeX');
    this.logPanel = vscode.window.createOutputChannel('Cloud LaTeX');
    this.logPanel.appendLine('Ready');
    this.logger = new VSLogger(this.logPanel);
  }

  async activate() {
    if (this.latexApp) {
      this.latexApp.stop();
    }

    this.activated = false;

    this.setupCommands();


    const rootPath = getRootPath();
    if (!rootPath) {
      // no workspace
      return;
    }

    this.setupStatusBar();
    this.setupSideBar();

    if (this.validateVSConfig()) {
      this.activated = true;
    }

    const config = await this.configuration(rootPath);
    this.autoCompile = (getVSConfig() as any as VSConfig).autoCompile || false;
    this.latexApp = await LatexApp.createApp(config, {
      logger: this.logger,
      accountService: this.accountService
    });

    vscode.commands.executeCommand(COMMAND_NAMES.refreshEntry);

    this.latexApp.on(LATEX_APP_EVENTS.FILE_CHANGED, async () => {
      this.startSync();
    });

    /**
     * Launch app
     */
    if (this.activated) {
      const result = await this.latexApp.start();
      this.updateAppInfo(result.appInfo, { forceOfflineErrLog: true });

      if (result.status === 'success') {
        await this.startSync();
      }
    }
  }

  async startSync(conflictSolution?: ConflictSolution) {
    if (!this.latexApp) {
      this.logger.error('LatexApp is not defined');
      vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.UNEXPECTED_ERROR));
      return;
    }

    this.statusBarItem.text = '$(sync~spin)';
    this.statusBarItem.show();

    const result = await this.latexApp.sync(conflictSolution);

    if (result.status === 'not-empty-directory') {
      vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.NOT_EMPTY_DIRECTORY));
      return;
    }

    // Show no message if offline status continue
    if (result.status === 'offline' && this.appInfo.loginStatus === 'offline') {
      this.statusBarItem.text = '$(issue-opened)';
      this.statusBarItem.show();
      return;
    }
    this.updateAppInfo(result.appInfo);

    if (result.status === 'success') {
      this.statusBarItem.text = '$(folder-active)';
      this.statusBarItem.show();
      if (!this.syncedInitilally || this.autoCompile) {
        this.compile(true);
      }
      if (!this.syncedInitilally) {
        this.syncedInitilally = true;
        vscode.window.showInformationMessage(localeStr(MESSAGE_TYPE.FILE_SYNCHRONIZED));
      }

    } else if (result.status === 'conflict') {
      this.statusBarItem.text = '$(warning)';
      this.statusBarItem.show();

      await this.handleConflict(result);
    } else {
      this.statusBarItem.text = '$(issue-opened)';
      this.statusBarItem.show();

      // Show sync error dialog
      const ret = await vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.FILE_SYNC_FAILED), {
        title: localeStr(MESSAGE_TYPE.CHECK_DETAILS)
      });
      if (ret) {
        this.logPanel.show();
      }
    }

  }

  async handleConflict(result: SyncResult) {
    try {
      const conflictSolution = await decideConflictSolution(result.appInfo.conflictFiles);
      this.startSync(conflictSolution);
    } catch (err) {
      this.logger.info('Conflict solution decision process is canceled');
    }
  }

  async compile(autoCompilation: boolean = false) {
    if (!this.latexApp) {
      this.logger.error('LatexApp is not defined');
      vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.UNEXPECTED_ERROR));
      return;
    }

    this.statusBarItem.text = '$(loading~spin)';
    this.statusBarItem.show();

    const compileResult = await this.latexApp.compile();

    if (compileResult.status === 'success') {
      this.statusBarItem.text = 'Compiled';
      this.statusBarItem.show();

      this.showProblems(compileResult.logs);

      // latex workshop support
      latexWorkshop.refreshViewer();
    } else {
      this.statusBarItem.text = 'Failed to compile';
      this.statusBarItem.show();

      if (compileResult.status === 'compiler-error') {
        if (compileResult.logs) {
          this.showProblems(compileResult.logs);
        }
        promptToShowProblemPanel(localeStr(MESSAGE_TYPE.COMPILATION_FAILED));

      } else if (compileResult.status === 'no-target-error') {
        vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.NO_COMPILATION_TARGET));
      } else {
        vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.UNKNOWN_ERROR));
      }
    }

    this.updateAppInfo(compileResult.appInfo, { forceOfflineErrLog: !autoCompilation });
  }

  /**
   * SideBar
   */
  setupSideBar() {
    this.tree = new TargetTreeProvider(this.sideBarInfo);
    const panel = vscode.window.registerTreeDataProvider(DATA_TREE_PROVIDER_COMMDNS_ID, this.tree);

    this.fileDecorationProvider = new CLFileDecorationProvider(this.sideBarInfo, this.logger);
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
      this.rerenderSideBar();
    });

    vscode.commands.registerCommand(COMMAND_NAMES.openHelpPage, () => {
      vscode.env.openExternal(vscode.Uri.parse(localeStr('SETTING_README_URL')));
    });

    vscode.commands.registerCommand(COMMAND_NAMES.compile, async () => {
      if (!this.latexApp || !this.activated) {
        const msg = `'${COMMAND_NAMES.compile}' cannot be called without workspace.`;
        this.logger.warn(msg);
        vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.NO_WORKSPACE_ERROR));
        return;
      }
      this.compile();
    });

    vscode.commands.registerCommand(COMMAND_NAMES.reload, async () => {
      if (!this.latexApp || !this.activated) {
        const msg = `'${COMMAND_NAMES.reload}' cannot be called without workspace.`;
        this.logger.warn(msg);
        vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.NO_WORKSPACE_ERROR));
        return;
      }

      this.startSync();
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

        const loginResult = await this.latexApp.login();
        this.updateAppInfo(loginResult.appInfo, { forceLoginSucceededLog: true, forceOfflineErrLog: true });
        if (loginResult.status === 'success') {
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

    vscode.commands.registerCommand(COMMAND_NAMES.viewCompilerError, () => {
      vscode.commands.executeCommand('workbench.action.showErrorsWarnings');
    });

    vscode.commands.registerCommand(COMMAND_NAMES.compilerLog, () => {
      this.logPanel.show();
    });

    vscode.commands.registerCommand(COMMAND_NAMES.viewPDF, async () => {
      // Open target file
      await this.openTargetTexFile();

      // Open PDF
      latexWorkshop.viewPDF();
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
        await fs.promises.unlink(obtainAccountPath(this.context));
      } catch (e) {
        this.logger.error(e);
        vscode.window.showErrorMessage((e as Error).toString());
      }
    });

    vscode.commands.registerCommand(COMMAND_NAMES.setTarget, async (uri?: vscode.Uri) => {
      this.logger.info(`Command setTarget(${uri?.fsPath}) is called`);

      if (!this.latexApp) {
        this.logger.error('LatexApp is not defined');
        vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.UNEXPECTED_ERROR));
        return;
      }

      let targetFile;
      if (!uri) {
        // Show target file picker
        targetFile = await showTargetFileSelector(this.appInfo.targetFileCandidates);
        if (!targetFile) {
          this.logger.info('Target file picker is canceled');
          return;
        }
      } else {
        const relativePath = path.relative(getRootPath() || '', uri.fsPath);
        targetFile = this.appInfo.files.find(file => file.relativePath === relativePath);
        if (!targetFile) {
          const errMsg = `Request of setTarget is rejected. Target file not found: ${relativePath}`;
          this.logger.error(errMsg);
          vscode.window.showErrorMessage(errMsg);
          return;
        }
      }

      const result = await this.latexApp.updateProjectInfo({
        compileTargetFileRemoteId: targetFile.remoteId
      });
      this.updateAppInfo(result.appInfo, { forceOfflineErrLog: true });

      if (result?.status === 'success') {
        vscode.window.showInformationMessage(localeStr(MESSAGE_TYPE.PROJECT_UPDATED));
      }
    });
  }

  async configuration(rootPath: string): Promise<Config> {
    const vsconfig = getVSConfig() as any as VSConfig;;

    const storagePath = getStoragePath(this.context);
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
    const config = getVSConfig();
    // To prevent overwriting files unexpectedly,
    //`enabled` should be defined in workspace configuration.
    const enabledInspect = config.inspect<boolean>('enabled');
    if (!enabledInspect) {
      return false;
    }

    if (enabledInspect.globalValue) {
      promptToFixConfigEnabledPlace();
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

  updateAppInfo(appInfo: AppInfo, option?: { forceOfflineErrLog?: boolean, forceLoginSucceededLog?: boolean }) {
    // Login status
    if (appInfo.loginStatus === 'valid') {
      if (option?.forceLoginSucceededLog || appInfo.loginStatus !== this.appInfo.loginStatus) {
        vscode.window.showInformationMessage(localeStr(MESSAGE_TYPE.LOGIN_SUCCEEDED));
      }
    } else if (appInfo.loginStatus === 'invalid') {
      promptToSetAccount();
    } else if (appInfo.loginStatus === 'offline') {
      if (option?.forceOfflineErrLog || appInfo.loginStatus !== this.appInfo.loginStatus) {
        vscode.window.showInformationMessage(localeStr(MESSAGE_TYPE.OFFLINE_ERROR));
      }
    }

    this.appInfo = appInfo;
    this.rerenderSideBar();
  }

  get sideBarInfo(): SideBarInfo {
    return {
      isWorkspace: !!getRootPath(),
      loginStatus: this.appInfo.loginStatus || 'offline',
      activated: this.activated,
      projectName: this.appInfo.projectName || null,
      displayUserName: this.accountService.account?.email,
      targetRelativeFilePath: this.appInfo.targetFile?.relativePath,
    };
  }

  rerenderSideBar() {
    this.tree?.refresh(this.sideBarInfo);
    this.fileDecorationProvider?.refresh(this.sideBarInfo);
  }

  async openTargetTexFile() {
    // Obtain target tex file uri
    const rootPath = getRootPath();
    if (!rootPath) {
      this.logger.warn('rootPath is not defined');
      return;
    }

    const targetRelativePath = this.appInfo.targetFile?.relativePath;
    if (!targetRelativePath) {
      this.logger.warn('Compile target file is not defined');
      return;
    }

    const target = path.join(rootPath, targetRelativePath);

    // Do nothing if target file is already opened
    if (vscode.window.activeTextEditor?.document.uri.fsPath === target) {
      return;
    }

    // Execute open file command
    try {
      await vscode.commands.executeCommand<vscode.TextDocumentShowOptions>('vscode.open', vscode.Uri.file(target));
    } catch (e) {
      const msg = `Error in opening target file: ${(e as any || '').toString()} \n  ${(e && (e as Error).stack || '')}`;
      this.logger.error(msg);
    }
  }
}

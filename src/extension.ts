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
import { connectProject, loadProjectById, parseProjectId } from './projectConnection';
import { ProjectRegistry, RegisteredProjectsTreeProvider, RegisteredProject, normalizeProjectEndpoint } from './registeredProjects';
import { ProjectFilesTreeProvider } from './projectFilesTreeProvider';
import { folderMatchesRegisteredProject } from './registeredProjectBinding';
import { SyncDisplayState } from './syncDisplayState';
import { saveProjectConnection } from './projectConnectionSettings';
import { completeFolderConnection, stageFolderConnection } from './folderConnection';

export async function activate(context: vscode.ExtensionContext) {
  const app = new VSLatexApp(context);
  await app.activate();

  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (e) => {
    if (app.connectionConfigUpdating) {
      return;
    }
    if (
      [CONFIG_NAMES.enabled, CONFIG_NAMES.outDir, CONFIG_NAMES.autoCompile, CONFIG_NAMES.endpoint, CONFIG_NAMES.projectId, CONFIG_NAMES.ignoredFiles]
        .some(name => e.affectsConfiguration(name))
    ) {
      app.handleConfigurationChange();

      if (
        [CONFIG_NAMES.enabled, CONFIG_NAMES.endpoint, CONFIG_NAMES.projectId]
          .some(name => e.affectsConfiguration(name))
      ) {
        await app.latexApp?.resetLocal();
      }

      app.latexApp?.stop();
      vscode.commands.executeCommand(COMMAND_NAMES.refreshEntry);

      promptToReload('Configuration has been changed. Please restart to apply it.');
    }
  }));
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
  connectionConfigUpdating = false;
  private connectionSetupRunning = false;
  private projectRegistry: ProjectRegistry;
  private registeredProjectsTree?: RegisteredProjectsTreeProvider;
  private projectFilesTree?: ProjectFilesTreeProvider;
  private syncPhase: 'inactive' | 'ready' | 'syncing' | 'offline' | 'conflict' | 'error' = 'inactive';
  private syncDetail?: string;
  private lastSyncedAt?: number;
  private rememberedProject?: string;
  private trustedRegistrationEndpoint?: string;
  private dirtyPathsKey?: string;
  // Discard outdated UI results; this does not cancel backend I/O already running.
  private backendGeneration = 0;
  private readonly syncDisplayState = new SyncDisplayState();
  appInfo: AppInfo = {
    activationStatus: 'inactive',
    loginStatus: 'offline',
    loaded: false,
    conflictFiles: [],
    files: [],
    targetFileCandidates: [],
  };

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.projectRegistry = new ProjectRegistry(context.globalState);
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
    let folderConnectionFailed = false;
    let folderConnected = false;
    try {
      folderConnected = await completeFolderConnection(this.context);
    } catch {
      // A notification resolves only when dismissed; never block command registration on it.
      void vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.CONNECT_FAILED));
      folderConnectionFailed = true;
    }
    if (this.latexApp) {
      this.latexApp.stop();
    }

    this.activated = false;

    this.setupCommands();
    await this.accountService.load();
    this.setupSideBar();
    if (folderConnected) {
      vscode.commands.executeCommand('workbench.view.extension.cloudlatex');
    }
    if (folderConnectionFailed) {
      return;
    }
    this.context.subscriptions.push(
      vscode.workspace.onDidChangeTextDocument(e => this.refreshDirtyPaths(e.document)),
      vscode.workspace.onDidSaveTextDocument(doc => this.refreshDirtyPaths(doc)),
      vscode.workspace.onDidCloseTextDocument(doc => this.refreshDirtyPaths(doc))
    );

    const rootPath = getRootPath();
    if (!rootPath) {
      // no workspace
      return;
    }

    this.setupStatusBar();

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
    this.latexApp.on(LATEX_APP_EVENTS.FILE_CHANGE_ERROR, () => {
      this.syncPhase = 'error';
      this.syncDetail = localeStr(MESSAGE_TYPE.FILE_CHANGE_ERROR);
      this.refreshProjectViews();
    });

    /**
     * Launch app
     */
    if (this.activated) {
      const result = await this.latexApp.start();
      this.syncPhase = result.status === 'success' ? 'inactive' : result.status === 'offline' ? 'offline' : 'error';
      this.updateAppInfo(result.appInfo, { forceOfflineErrLog: true });

      if (result.status === 'success') {
        await this.startSync();
      }
    }
  }

  async startSync(conflictSolution?: ConflictSolution) {
    if (this.connectionConfigUpdating || !this.activated) {
      return;
    }
    if (!this.latexApp) {
      this.logger.error('LatexApp is not defined');
      vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.UNEXPECTED_ERROR));
      return;
    }

    this.statusBarItem.text = '$(sync~spin)';
    this.statusBarItem.show();

    this.syncPhase = 'syncing';
    this.syncDetail = undefined;
    this.refreshProjectViews();
    let result: SyncResult;
    const generation = this.backendGeneration;
    try {
      result = await this.latexApp.sync(conflictSolution);
    } catch {
      if (generation !== this.backendGeneration) {
        return;
      }
      this.syncPhase = 'error';
      this.syncDetail = localeStr(MESSAGE_TYPE.FILE_SYNC_FAILED);
      this.refreshProjectViews();
      this.statusBarItem.text = '$(issue-opened)';
      await vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.FILE_SYNC_FAILED));
      return;
    }
    if (generation !== this.backendGeneration) {
      return;
    }
    this.syncPhase = result.status === 'success' ? 'ready'
      : result.status === 'offline' ? 'offline' : result.status === 'conflict' ? 'conflict' : 'error';
    if (result.status === 'success') {
      this.lastSyncedAt = Date.now();
      this.syncDisplayState.settle(result.appInfo.files);
    }
    this.syncDetail = result.status === 'not-empty-directory' ? localeStr(MESSAGE_TYPE.NOT_EMPTY_DIRECTORY)
      : result.status === 'unknown-error' ? localeStr(MESSAGE_TYPE.FILE_SYNC_FAILED) : undefined;

    if (result.status === 'not-empty-directory') {
      this.updateAppInfo(result.appInfo);
      vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.NOT_EMPTY_DIRECTORY));
      return;
    }

    // Show no message if offline status continue
    if (result.status === 'offline' && this.appInfo.loginStatus === 'offline') {
      this.statusBarItem.text = '$(issue-opened)';
      this.statusBarItem.show();
      this.appInfo = result.appInfo;
      this.refreshProjectViews();
      return;
    }
    this.updateAppInfo(result.appInfo);

    if (result.status === 'success') {
      this.statusBarItem.text = '$(folder-active)';
      this.statusBarItem.show();
      if (this.autoCompile) {
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
    if (this.connectionConfigUpdating) {
      return;
    }
    if (!this.latexApp) {
      this.logger.error('LatexApp is not defined');
      vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.UNEXPECTED_ERROR));
      return;
    }

    if (this.appInfo.activationStatus !== 'active') {
      this.logger.info('Project is not activated');
      return;
    }

    this.statusBarItem.text = '$(loading~spin)';
    this.statusBarItem.show();

    const generation = this.backendGeneration;
    const compileResult = await this.latexApp.compile();
    if (generation !== this.backendGeneration) {
      return;
    }

    if (compileResult.status === 'success') {
      this.statusBarItem.text = 'Compiled';
      this.statusBarItem.show();

      this.showProblems(compileResult.logs);

      // latex workshop support
      try {
        await latexWorkshop.refreshViewer();
      } catch (error) {
        this.logger.warn(`${localeStr(MESSAGE_TYPE.PDF_REFRESH_FAILED)} ${String(error)}`);
      }
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
    this.context.subscriptions.push(vscode.window.registerTreeDataProvider(DATA_TREE_PROVIDER_COMMDNS_ID, this.tree));

    this.fileDecorationProvider = new CLFileDecorationProvider(this.sideBarInfo, this.logger);
    this.registeredProjectsTree = new RegisteredProjectsTreeProvider(this.projectRegistry);
    this.projectFilesTree = new ProjectFilesTreeProvider();
    this.context.subscriptions.push(
      vscode.window.registerTreeDataProvider('cloudlatex-projects', this.registeredProjectsTree),
      vscode.window.registerTreeDataProvider('cloudlatex-files', this.projectFilesTree),
      this.projectRegistry, this.registeredProjectsTree, this.projectFilesTree
    );
    this.refreshProjectViews();
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
    this.context.subscriptions.push(
      vscode.commands.registerCommand(COMMAND_NAMES.registerProject, async () => this.registerProject()),
      vscode.commands.registerCommand(COMMAND_NAMES.openRegisteredProject, async (entry: RegisteredProject) => this.openRegisteredProject(entry)),
      vscode.commands.registerCommand(COMMAND_NAMES.removeRegisteredProject, async (entry: RegisteredProject) => {
        const record = this.projectRegistry.get(entry?.endpoint, entry?.id);
        if (record) {
          await this.projectRegistry.remove(record.endpoint, record.id);
          this.registeredProjectsTree?.refresh(this.currentProject());
        }
      }),
      vscode.commands.registerCommand(COMMAND_NAMES.openProjectFile, async (filePath: string) => this.openProjectFile(filePath))
    );

    vscode.commands.registerCommand(COMMAND_NAMES.openHelpPage, () => {
      vscode.env.openExternal(vscode.Uri.parse(localeStr(MESSAGE_TYPE.SETTING_README_URL)));
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

    this.context.subscriptions.push(vscode.commands.registerCommand(COMMAND_NAMES.connectProject, async () => {
      await this.connectProject();
    }));

    vscode.commands.registerCommand(COMMAND_NAMES.account, async () => {
      if (this.connectionConfigUpdating) {
        return;
      }
      if (!this.activated) {
        await this.connectProject(true);
        return;
      }
      let account!: Account;
      try {
        account = await inputAccount();
      } catch (e) {
        this.logger.log('Account input is canceled');
        return; // input box is canceled.
      }
      try {
        await fs.promises.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
        await this.accountService.save(account);
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
      await latexWorkshop.viewPDF(this.appInfo.loaded ? this.appInfo.pdfPath : undefined);
    });

    this.context.subscriptions.push(vscode.commands.registerCommand(COMMAND_NAMES.configureLatexWorkshop, async () => {
      await latexWorkshop.configure();
    }));

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

  private async connectProject(forceAccount = false): Promise<void> {
    if (this.connectionSetupRunning || this.connectionConfigUpdating) {
      return;
    }
    this.connectionSetupRunning = true;
    try {
      await connectProject(forceAccount ? null : this.accountService.account, async connection => {
        this.connectionConfigUpdating = true;
        this.backendGeneration++;
        try {
          await this.latexApp?.stop();
          await saveProjectConnection(this.context, connection);
        } catch (error) {
          this.connectionConfigUpdating = false;
          throw error;
        }
        try {
          await this.projectRegistry.upsert({
            id: connection.project.id, title: connection.project.title,
            endpoint: connection.endpoint, rootPath: connection.rootPath
          });
        } catch {
          // The connection is already saved; retry shortcut persistence after reload.
          this.logger.warn(localeStr(MESSAGE_TYPE.REGISTER_PROJECT_FAILED));
        }
        this.activated = false;
        this.rerenderSideBar();
        try {
          await vscode.commands.executeCommand('workbench.action.reloadWindow');
        } catch {
          await vscode.window.showInformationMessage(localeStr(MESSAGE_TYPE.CONNECT_RELOAD_REQUIRED));
        }
      });
    } finally {
      this.connectionSetupRunning = false;
    }
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
      activated: this.activated && this.appInfo.activationStatus === 'active',
      projectName: this.appInfo.projectName || null,
      endpointOrigin: this.getEndpointOrigin(),
      displayUserName: this.accountService.account?.email,
      targetRelativeFilePath: this.appInfo.targetFile?.relativePath,
    };
  }

  rerenderSideBar() {
    this.tree?.refresh(this.sideBarInfo);
    this.fileDecorationProvider?.refresh(this.sideBarInfo);
    this.refreshProjectViews();
    this.rememberCurrentProject();
  }

  private currentProject(): { endpoint: string; id: number; rootPath?: string } | undefined {
    const id = getVSConfig().get<number>('projectId', 0);
    const endpoint = normalizeProjectEndpoint(getVSConfig().get<string>('endpoint', ''));
    return endpoint && id > 0 ? { endpoint, id, rootPath: getRootPath() } : undefined;
  }

  private refreshProjectViews(): void {
    this.registeredProjectsTree?.refresh(this.currentProject());
    const dirtyPaths = this.collectDirtyPaths();
    this.dirtyPathsKey = dirtyPaths.join('\n');
    this.projectFilesTree?.update({
      rootPath: getRootPath(), appInfo: { ...this.appInfo, files: this.syncDisplayState.project(this.appInfo.files) }, phase: this.syncPhase,
      lastSyncedAt: this.lastSyncedAt, detail: this.syncDetail, dirtyPaths
    });
  }

  // Editing fires on every keystroke, but the files view changes only when a
  // buffer's saved/unsaved state flips. Rebuild the tree only in that case.
  private refreshDirtyPaths(document: vscode.TextDocument): void {
    if (document.uri.scheme !== 'file') {
      return;
    }
    const dirtyPaths = this.collectDirtyPaths();
    const key = dirtyPaths.join('\n');
    if (key !== this.dirtyPathsKey) {
      this.dirtyPathsKey = key;
      this.projectFilesTree?.setDirtyPaths(dirtyPaths);
    }
  }

  private collectDirtyPaths(): string[] {
    const rootPath = getRootPath();
    return rootPath ? vscode.workspace.textDocuments
      .filter(doc => doc.isDirty && doc.uri.scheme === 'file')
      .map(doc => path.relative(rootPath, doc.uri.fsPath).split(path.sep).join('/'))
      .sort() : [];
  }

  private rememberCurrentProject(): void {
    const current = this.currentProject();
    if (!this.activated || this.connectionConfigUpdating || !current || !this.appInfo.loaded || !this.appInfo.projectName || !current.rootPath) {
      return;
    }
    const key = `${current.endpoint}#${current.id}:${current.rootPath}:${this.appInfo.projectName}`;
    if (key === this.rememberedProject) {
      return;
    }
    this.rememberedProject = key;
    void this.projectRegistry.upsert({ ...current, title: this.appInfo.projectName }).then(() => {
      this.registeredProjectsTree?.refresh(this.currentProject());
    }).catch(() => {
      this.rememberedProject = undefined;
      this.logger.warn(localeStr(MESSAGE_TYPE.REGISTER_PROJECT_FAILED));
    });
  }

  private async registerProject(): Promise<void> {
    if (this.connectionSetupRunning || this.connectionConfigUpdating) {
      return;
    }
    this.connectionSetupRunning = true;
    const generation = this.backendGeneration;
    const rootPath = getRootPath();
    try {
      const endpoint = normalizeProjectEndpoint(getVSConfig().get<string>('endpoint', ''));
      if (!endpoint) {
        throw new Error('Invalid endpoint');
      }
      const value = await vscode.window.showInputBox({
        title: localeStr(MESSAGE_TYPE.REGISTER_PROJECT), prompt: localeStr(MESSAGE_TYPE.PROJECT_URL_PROMPT),
        placeHolder: localeStr(MESSAGE_TYPE.PROJECT_URL_PLACEHOLDER), ignoreFocusOut: true,
        validateInput: text => parseProjectId(text, endpoint) ? undefined : localeStr(MESSAGE_TYPE.PROJECT_URL_INVALID)
      });
      if (!value) {
        return;
      }
      const id = parseProjectId(value, endpoint);
      if (!id) {
        return;
      }
      if (endpoint !== 'https://cloudlatex.io/api' && this.trustedRegistrationEndpoint !== endpoint) {
        const allow = localeStr(MESSAGE_TYPE.CONNECT_ALLOW_ENDPOINT);
        const choice = await vscode.window.showInformationMessage(
          `${localeStr(MESSAGE_TYPE.CONNECT_CUSTOM_ENDPOINT)}\n\n${endpoint}`, { modal: true }, allow
        );
        if (choice !== allow) {
          return;
        }
        this.trustedRegistrationEndpoint = endpoint;
      }
      let account = this.accountService.account;
      if (!account) {
        try {
          account = await inputAccount();
        } catch {
          return;
        }
      }
      const project = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification, title: localeStr(MESSAGE_TYPE.REGISTER_PROJECT_LOADING)
      }, () => loadProjectById(account!, endpoint, id));
      if (generation !== this.backendGeneration || rootPath !== getRootPath()
        || endpoint !== normalizeProjectEndpoint(getVSConfig().get<string>('endpoint', ''))) {
        await vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.CONNECT_SETTINGS_CHANGED));
        return;
      }
      if (!this.accountService.account && !this.activated) {
        await fs.promises.mkdir(this.context.globalStorageUri.fsPath, { recursive: true });
        await new AccountService<Account>(obtainAccountPath(this.context)).save(account);
        await this.accountService.load();
      }
      const current = this.currentProject();
      await this.projectRegistry.upsert({
        id: project.id, title: project.title, endpoint,
        rootPath: this.appInfo.loaded && current?.id === project.id && current.endpoint === endpoint ? getRootPath() : undefined
      });
      this.registeredProjectsTree?.refresh(this.currentProject());
    } catch {
      await vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.REGISTER_PROJECT_FAILED));
    } finally {
      this.connectionSetupRunning = false;
    }
  }

  private async openRegisteredProject(entry: RegisteredProject): Promise<void> {
    const record = this.projectRegistry.get(entry?.endpoint, entry?.id);
    if (!record) {
      return;
    }
    const current = this.currentProject();
    const matches = record.rootPath && (record.rootPath === getRootPath()
      ? current?.id === record.id && current.endpoint === record.endpoint
      : await folderMatchesRegisteredProject(record,
        getVSConfig().inspect<string>('endpoint')?.globalValue || 'https://cloudlatex.io/api'));
    if (record.rootPath && matches) {
      try {
        const stat = await vscode.workspace.fs.stat(vscode.Uri.file(record.rootPath));
        if (stat.type & vscode.FileType.Directory) {
          if (record.rootPath !== getRootPath()) {
            await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(record.rootPath));
          } else {
            await vscode.commands.executeCommand('workbench.view.extension.cloudlatex');
          }
          return;
        }
      } catch { /* The local folder may have moved. */ }
    }
    await this.connectRegisteredFolder(record);
  }

  private async connectRegisteredFolder(record: RegisteredProject): Promise<void> {
    if (this.connectionSetupRunning || this.connectionConfigUpdating) {
      return;
    }
    this.connectionSetupRunning = true;
    const generation = this.backendGeneration;
    const config = getVSConfig();
    const inherited = {
      autoCompile: config.get<boolean>('autoCompile', true),
      outDir: config.get<string>('outDir', ''),
      ignoredFiles: config.get<string[]>('ignoredFiles', [])
    };
    try {
      while (true) {
        const folders = await vscode.window.showOpenDialog({
          canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
          title: `${record.title} — ${new URL(record.endpoint).origin} — ${localeStr(MESSAGE_TYPE.SELECT_PROJECT_DESTINATION)}`,
          openLabel: localeStr(MESSAGE_TYPE.CONNECT_PROJECT)
        });
        if (!folders?.[0]) {
          return;
        }
        if (folders[0].scheme !== 'file') {
          throw new Error('Local folder required');
        }
        const rootPath = await fs.promises.realpath(folders[0].fsPath);
        const currentRoot = getRootPath();
        if (currentRoot) {
          const relative = path.relative(await fs.promises.realpath(currentRoot), rootPath);
          if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
            await vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.CONNECT_NESTED_FOLDER));
            continue;
          }
        }
        // A different registered server needs explicit consent before using the
        // shared account. The usual same-server switch needs only the folder.
        if (normalizeProjectEndpoint(config.get<string>('endpoint', '')) !== record.endpoint) {
          const allow = localeStr(MESSAGE_TYPE.CONNECT_ALLOW_ENDPOINT);
          if (await vscode.window.showInformationMessage(`${localeStr(MESSAGE_TYPE.CONNECT_CUSTOM_ENDPOINT)}\n\n${record.endpoint}`, { modal: true }, allow) !== allow) {
            return;
          }
        }
        // inputAccount() rejects when the input is dismissed; treat that as a cancel.
        const account = this.accountService.account || await inputAccount().catch(() => undefined);
        if (!account) {
          return;
        }
        const project = await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification, title: localeStr(MESSAGE_TYPE.REGISTER_PROJECT_LOADING)
        }, () => loadProjectById(account, record.endpoint, record.id));
        if (generation !== this.backendGeneration) {
          throw new Error('Connection changed');
        }
        let rollback: () => Promise<void>;
        try {
          rollback = await stageFolderConnection(this.context, rootPath, { ...record, title: project.title }, inherited);
        } catch {
          await vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.CONNECT_FOLDER_FAILED));
          continue;
        }
        try {
          if (!this.accountService.account) {
            await new AccountService<Account>(obtainAccountPath(this.context)).save(account);
          }
          await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(rootPath), { forceReuseWindow: true });
        } catch (error) {
          await rollback();
          throw error;
        }
        return;
      }
    } catch {
      await vscode.window.showErrorMessage(localeStr(MESSAGE_TYPE.CONNECT_FAILED));
    } finally {
      this.connectionSetupRunning = false;
    }
  }

  private async openProjectFile(filePath: string): Promise<void> {
    const rootPath = getRootPath();
    if (!rootPath || typeof filePath !== 'string') {
      return;
    }
    try {
      const relative = path.relative(rootPath, filePath);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('Outside project');
      }
      const [rootReal, fileReal] = await Promise.all([fs.promises.realpath(rootPath), fs.promises.realpath(filePath)]);
      const realRelative = path.relative(rootReal, fileReal);
      if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
        throw new Error('Outside project');
      }
      if (!(await fs.promises.stat(fileReal)).isFile()) {
        throw new Error('Not a file');
      }
      await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(filePath));
    } catch {
      await vscode.window.showWarningMessage(localeStr(MESSAGE_TYPE.PROJECT_FILE_NOT_LOCAL));
    }
  }

  private getEndpointOrigin(): string | undefined {
    try {
      return new URL(getVSConfig().get<string>('endpoint', '')).origin;
    } catch {
      return undefined;
    }
  }

  handleConfigurationChange(): void {
    this.backendGeneration++;
    this.activated = false;
    this.syncPhase = 'inactive';
    this.lastSyncedAt = undefined;
    this.syncDetail = undefined;
    this.rememberedProject = undefined;
    this.syncDisplayState.reset();
    this.appInfo = { ...this.appInfo, loaded: false, files: [], conflictFiles: [], targetFile: undefined, projectName: undefined };
    this.rerenderSideBar();
  }

}

import * as path from 'path';
import * as vscode from 'vscode';
import {Readable} from 'stream';
import * as pako from 'pako';

import WebAppApi from './webAppApi';
import Setting from './configManager';
import ClFileSystem from './clFileSystem';
import { Config, CompileResult, EditorProject, AppStatus } from './types';

export default class LatexApp {
  private config: Config;
  private api: WebAppApi;
  private fileSystem: ClFileSystem;
  private projectInfo?: EditorProject;
  private loggedIn :boolean = false;

  constructor() {
    const rootPath = vscode.workspace.rootPath;
    if (!rootPath) {
      throw new Error('root path can not be obtained!');
    }
    this.config = vscode.workspace.getConfiguration('cloudlatex') as any as Config;
    // TODO raise if config is invalid.
    this.api = new WebAppApi(this.config);
    this.fileSystem = new ClFileSystem(rootPath, this.api, (relativePath) => {
      return ![this.logPath, this.pdfPath, this.synctexPath].includes(relativePath);
    });
  }

  // Check if this plugin is enabled.
  public static isEnabled(): boolean {
    const config = vscode.workspace.getConfiguration('cloudlatex');
    /*
     * To prevent overwriting files unexpectedly,
     * `enabled` should be defined in workspace configuration.
     */
    const enabledInspect = config.inspect('enabled');
    if (!enabledInspect || !enabledInspect.workspaceValue) {
      return false;
    }
    return true;
  }

 /*
  * To prevent overwriting files unexpectedly,
  * `projectId` should be defined in workspace configuration.
  */
  public static validateProjectIdConfiguration(): boolean {
    const config = vscode.workspace.getConfiguration('cloudlatex');
    const projectIdInspect = config.inspect('projectId');
    if (!projectIdInspect || !projectIdInspect.workspaceValue) {
      return false;
    }
    return true;
  }

  // #TODO include the state: not loggedin yet
  public static async launch(): Promise<LatexApp> {
    const app = new LatexApp();
    await app.launch();
    return app;
  }

  async launch() {
    try {
      const result = await this.api.validateToken();
      if (!result.success) {
        throw new result;
      }
    } catch(err) {
      vscode.window.showErrorMessage('[cloudlatex] Failed to login.');
      return;
    }
    this.projectInfo = (await this.api.loadProjectInfo())['project'];
    if (!this.projectInfo) {
      vscode.window.showErrorMessage('[cloudlatex] Failed to load Project info.');
      return;
    }
    console.log('project info', this.projectInfo);
    this.loggedIn = true;
    vscode.commands.executeCommand('cloudlatex.refreshEntry', this.appStatus);

    await this.fileSystem.loadFiles();

    this.compile();


    this.fileSystem.initFileWatcher();
    this.fileSystem.on('file-changed', (absPath: string) => {
      this.compile();
    });

    this.fileSystem.on('local-reading-error', (e: any) => {
      console.error('local-reading-error', e);
    });
    this.fileSystem.on('local-changed-error', (e: any) => {
      console.error('local-changed-error', e);
    });
    this.fileSystem.on('local-deleted-error', (e: any) => {
      console.error('local-deleted-error', e);
    });

  }

  get targetName(): string {
    if(!this.projectInfo) {
      throw new Error('Project info is not defined');
    }
    const file = this.fileSystem.files[this.projectInfo.compile_target_file_id];
    if(!file) {
      throw new Error('target file is not found');
    }
    return path.basename(file.name, '.tex');
  }

  get logPath(): string {
    return path.join(this.config.outDir, this.targetName + '.log');
  }

  get pdfPath(): string {
    return path.join(this.config.outDir, this.targetName + '.pdf');
  }

  get synctexPath(): string {
    return path.join(this.config.outDir, this.targetName + '.synctex');
  }

  get appStatus(): AppStatus {
    return {
      loggedIn: this.loggedIn,
      backend: this.config.backend,
      projectName: this.projectInfo?.title,
      projectId: this.projectInfo?.id ? String(this.projectInfo.id) : ''
    };
  }

  public async reload() {
    await this.fileSystem.loadFiles();
  }

  public async compile() {
    try {
      if(!this.api) {
        throw new Error('api object is not set.');
      }
      console.log('compile...');
      let result = await this.api.compileProject();

      if(result.exit_code === 0) {
        vscode.window.showInformationMessage('[cloudlatex] Successfully Compiled.');
      } else {
        vscode.window.showWarningMessage('[cloudlatex] Some error occured with compilation.');
      }

      console.log('compile result', result);

      // log
      const logStr = result.errors.join('\n') + result.warnings.join('\n') + '\n' + result.log;
      this.fileSystem.saveAs(this.logPath, Readable.from(logStr));

      /*if(result.exitCode !== 0) {
        return;
      }*/

      // download pdf
      const pdfStream = await this.api.downloadFile(result.uri);
      this.fileSystem.saveAs(this.pdfPath, pdfStream).catch(err => {
        vscode.window.showErrorMessage(err);
      }).then(() => {
        // latex workshop support
        return vscode.commands.executeCommand('latex-workshop.refresh-viewer');
      }).catch(err => {
        console.warn(err);
      });

      // download synctex
      const compressed = await this.api.loadSynctexObject(result.synctex_uri);
      const decompressed = pako.inflate(new Uint8Array(compressed));
      let synctexStr = new TextDecoder("utf-8").decode(decompressed);
      synctexStr = synctexStr.replace(/\/data\/\./g, this.fileSystem.rootPath);
      this.fileSystem.saveAs(this.synctexPath, Readable.from(synctexStr));
    } catch(e) {
      console.error(e);
      vscode.window.showWarningMessage(e.message); // #TODO show multiple compile error
    }
  }
}
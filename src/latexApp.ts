import * as path from 'path';
import * as vscode from 'vscode';
import {Readable} from 'stream';
import * as pako from 'pako';

import Browser from './browser';
import WebAppApi from './webAppApi';
import Setting from './setting';
import ClFileSystem from './clFileSystem';
import { Creditials, Config, CompileResult, EditorProject } from './types';

export default class LatexApp {
  private setting: Setting;
  private config: Config;
  private api: WebAppApi;
  private fileSystem: ClFileSystem;
  private projectInfo?: EditorProject;

  constructor(setting: Setting, creditials: Creditials) {
    this.setting = setting;

    const rootPath = vscode.workspace.rootPath;
    if (!rootPath) {
      throw new Error('root path can not be obtained!');
    }
    this.api = new WebAppApi(creditials.csrf, creditials.loginSession, setting.obj.projectId);
    this.config = vscode.workspace.getConfiguration('cloudlatex') as any as Config;
    this.fileSystem = new ClFileSystem(rootPath, this.api, (relativePath) => {
      return ![this.logPath, this.pdfPath, this.synctexPath].includes(relativePath);
    });
  }

  public static async launch(): Promise<LatexApp> {
    const setting = new Setting();
    const browser = new Browser(setting);
    try {
      await setting.load();
    } catch(err) {
      console.error(err);
    }
    const creditials = await browser.launch();
    console.log('creditials', creditials);
    const app = new LatexApp(setting, creditials);
    await app.launch();
    return app;
  }

  async launch() {
    this.projectInfo = (await this.api.loadProjectInfo())['project'];
    console.log('project info', this.projectInfo);
    await this.fileSystem.loadFiles();

    if (!this.setting.obj.initialized) {
      try {
        await this.fileSystem.pull();
      } catch (err) {
        console.error(err);
        return;
      }
      this.setting.obj.initialized = true;
      this.setting.save();
    }

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
        vscode.window.showInformationMessage('[latex-cloud] Successfully Compiled.');
      } else {
        vscode.window.showWarningMessage('[latex-cloud] Some error occured with compilation.');
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
      this.fileSystem.saveAs(this.pdfPath, pdfStream).then(() => {
        // latex workshop support
        vscode.commands.executeCommand('latex-workshop.refresh-viewer');
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
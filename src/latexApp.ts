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
  //private watcher: Watcher;
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
    this.fileSystem = new ClFileSystem(rootPath, this.api);
    this.config = vscode.workspace.getConfiguration('cloudlatex') as any as Config;
  }

  public static async launch() {
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
    app.launch();
  }

  async launch() {
    this.projectInfo = (await this.api.loadProjectInfo())['project'];
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

  public async compile() {
    try {
      if(!this.api) {
        throw new Error('api object is not set.');
      }
      console.log('compile...');
      let result = await this.api.compileProject();
      vscode.window.showInformationMessage('[latex-cloud] Successfully Compiled.');

      console.log('compile result', result);

      // log
      const logStr = result.errors.join('\n') + result.warnings.join('\n') + '\n' + result.log;
      const logPath = path.join(this.config.outDir, this.targetName + '.log');
      this.fileSystem.saveAs(logPath, Readable.from(logStr));

      /*if(result.exitCode !== 0) {
        return;
      }*/

      // download pdf
      const pdfStream = await this.api.downloadFile(result.uri);
      const pdfPath = path.join(this.config.outDir, this.targetName + '.pdf');
      this.fileSystem.saveAs(pdfPath, pdfStream).then(() => {
        // latex workshop support
        vscode.commands.executeCommand('latex-workshop.refresh-viewer');
      });

      // download synctex
      const compressed = await this.api.loadSynctexObject(result.synctex_uri);
      const decompressed = pako.inflate(new Uint8Array(compressed));
      let synctexStr = new TextDecoder("utf-8").decode(decompressed);
      synctexStr = synctexStr.replace(/\/data\/\./g, this.fileSystem.rootPath);
      const synctexPath = path.join(this.config.outDir, this.targetName + '.synctex');
      this.fileSystem.saveAs(synctexPath, Readable.from(synctexStr));
    } catch(e) {
      console.error(e);
      vscode.window.showWarningMessage(e); // #TODO show multiple compile error
    }
  }
}
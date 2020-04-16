import * as path from 'path';
import * as vscode from 'vscode';
import {Readable} from 'stream';
import * as pako from 'pako';

import Browser from './browser';
import {ProjectsUrl, editPageUrlMatch, WebAppApi, LoginSessionKey} from './webAppApi';
import Setting from './setting';
import ClFileSystem from './clFileSystem';
import AppFileSystem from './appFileSystem';
import { Creditials, Config, CompileResult } from './types';

export default class LatexApp {
  private browser: Browser;
  private setting: Setting;
  private config: Config;
  //private watcher: Watcher;
  private api: WebAppApi;
  private rootPath: string;
  private fileSystem: ClFileSystem;
  private targetName: string;

  constructor(browser: Browser, setting: Setting, creditials: Creditials) {
    this.browser = browser;
    this.setting = setting;

    const rootPath = vscode.workspace.rootPath;
    if (!rootPath) {
      throw new Error('root path can not be obtained!');
    }
    this.rootPath = rootPath;
    this.api = new WebAppApi(creditials.csrf, creditials.loginSession, setting.obj.projectId);
    this.fileSystem = new ClFileSystem(this.rootPath, this.api);
    this.config = vscode.workspace.getConfiguration('cloudlatex') as any as Config;
    this.targetName = 'main'; // #TODO
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
    const app = new LatexApp(browser, setting, creditials);
    app.launch();
  }

  async launch() {
    if (!this.setting.obj.initialized) {
      try {
        await this.fileSystem.pull();
      } catch (err) {
        console.error(err);
        return;
      }
      this.setting.obj.initialized = true;
      this.setting.save();
      this.compile();
    } else {
      await this.fileSystem.downloadProjectInfo();
    }

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

  public async compile() {
    if(!this.api) {
      throw new Error('api object is not set.');
    }
    console.log('compile...');
    let result: CompileResult;
    try {
      result = await this.api.compileProject();
    } catch(e) {
      console.error('error in complie', e); // #TODO show multiple compile error
      return;
    }
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
    this.fileSystem.saveAs(pdfPath, pdfStream);

    // download synctex
    const compressed = await this.api.loadSynctexObject(result.synctex_uri);
    const decompressed = pako.inflate(new Uint8Array(compressed));
    let synctexStr = new TextDecoder("utf-8").decode(decompressed);
    synctexStr = synctexStr.replace(/\/data\/\./g, this.rootPath);
    const synctexPath = path.join(this.config.outDir, this.targetName + '.synctex');
    this.fileSystem.saveAs(synctexPath, Readable.from(synctexStr));
  }
}
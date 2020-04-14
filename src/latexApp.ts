import Browser from './browser';
import {ProjectsUrl, editPageUrlMatch, WebAppApi, LoginSessionKey} from './webAppApi';
import Config from './config';
import * as vscode from 'vscode';
import ClFileSystem from './clFileSystem';

export default class LatexApp {
  private browser: Browser;
  private config: Config;
  //private watcher: Watcher;
  private api?: WebAppApi;
  private rootPath: string;
  private fileSystem?: ClFileSystem;

  constructor() {
    this.config = new Config();
    this.browser = new Browser(this.config);
    const rootPath = vscode.workspace.rootPath;
    if (!rootPath) {
      throw new Error('root path can not be obtained!');
    }
    this.rootPath = rootPath;
  }

  async launch() {
    try {
      await this.config.load();
    } catch(err) {
      console.error(err);
    }
    const creditials = await this.browser.launch();
    console.log('creditials', creditials);
    this.api = new WebAppApi(creditials.csrf, creditials.loginSession, this.config.obj.projectId);
    this.fileSystem = new ClFileSystem(this.rootPath, this.api);

    this.fileSystem.on('local-reading-error', (e: any) => {
      console.error('local-reading-error', e);
    });
    this.fileSystem.on('local-changed-error', (e: any) => {
      console.error('local-changed-error', e);
    });
    this.fileSystem.on('local-deleted-error', (e: any) => {
      console.error('local-deleted-error', e);
    });

    if (!this.config.obj.initialized) {
      try {
        await this.fileSystem.pull();
      } catch (err) {
        console.error(err);
        return;
      }
      this.config.obj.initialized = true;
      this.config.save();
      this.compile();
    }
  }

  public async compile() {
    console.log('compile...');
    const res = await this.api?.compileProject();
    console.log('compile result', res);
  }

}
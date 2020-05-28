import * as path from 'path';
import * as  EventEmitter from 'eventemitter3';
import {Readable} from 'stream';
import * as pako from 'pako';
import Logger from './logger';
import { Config, ProjectInfo, AppInfo, SyncMode, DecideSyncMode } from './types';
import Manager from './fileManage/index';

export default class LatexApp extends EventEmitter {
  private projectInfo?: ProjectInfo;
  private loggedIn :boolean = false;
  private manager: Manager;

  constructor(private config: Config, rootPath: string, decideSyncMode: DecideSyncMode, private logger: Logger) {
    super();
    this.manager = new Manager(config, rootPath, decideSyncMode, 
      relativePath => {
        return ![this.logPath, this.pdfPath, this.synctexPath].includes(relativePath);
      }, 
      logger);
    
  }

  async launch() {
    await this.manager.init();
    this.manager.on('successfully-synced', () => {
      this.compile();
    });

    // #TODO offline 時を現在のstate machineに統合
    this.projectInfo = await this.manager.api.loadProjectInfo();
    if (!this.projectInfo) {
      this.logger.error('[cloudlatex] Failed to load Project info.');
      return;
    }
    console.log('project info', this.projectInfo);
    this.loggedIn = true;
    this.emit('appinfo-updated');

    await this.manager.startSync();
    /*
    try {
      const result = await this.manager.api.validateToken();
      if (!result.success) {
        throw new result;
      }
    } catch(err) {
      return;
    }
    */
  }

  get targetName(): string {
    if(!this.projectInfo) {
      throw new Error('Project info is not defined');
    }
    const file = this.manager.files.findBy('remoteId', this.projectInfo.compile_target_file_id);
    if(!file) {
      throw new Error('target file is not found');
    }
    return path.basename(file.relativePath, '.tex');
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

  get appInfo(): AppInfo {
    return {
      loggedIn: this.loggedIn,
      backend: this.config.backend,
      projectName: this.projectInfo?.title,
      projectId: this.projectInfo?.id ? String(this.projectInfo.id) : ''
    };
  }

  public async reload() {
    await this.manager.fileAdapter.loadFileList();
  }

  public async compile() {
    try {
      console.log('compile...');
      let result = await this.manager.api.compileProject();

      if(result.exit_code === 0) {
        this.logger.info('[cloudlatex] Successfully Compiled.');
      } else {
        this.logger.warn('[cloudlatex] Some error occured with compilation.');
      }

      console.log('compile result', result);

      // log
      const logStr = result.errors.join('\n') + result.warnings.join('\n') + '\n' + result.log;
      this.manager.fileAdapter.saveAs(this.logPath, Readable.from(logStr));

      /*if(result.exitCode !== 0) {
        return;
      }*/

      // download pdf
      const pdfStream = await this.manager.api.downloadFile(result.uri);
      this.manager.fileAdapter.saveAs(this.pdfPath, pdfStream).catch(err => {
        this.logger.error(err);
      }).then(() => {
        this.emit('successfully-compiled');
        return;
      }).catch(err => {
        console.warn(err);
      });

      // download synctex
      const compressed = await this.manager.api.loadSynctexObject(result.synctex_uri);
      const decompressed = pako.inflate(new Uint8Array(compressed));
      let synctexStr = new TextDecoder('utf-8').decode(decompressed);
      synctexStr = synctexStr.replace(/\/data\/\./g, this.manager.rootPath);
      this.manager.fileAdapter.saveAs(this.synctexPath, Readable.from(synctexStr));
    } catch(e) {
      console.error(e);
      this.logger.warn(e.message); // #TODO show multiple compile error
    }
  }
}
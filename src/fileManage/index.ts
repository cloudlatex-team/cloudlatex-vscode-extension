import {TypeDB, Repository} from 'type-db';
import * as path from 'path';
import {Config, SyncMode, WebAppApi, DecideSyncMode} from './../types';
import BackendSelector from './../backend/backendSelector';
import {FileInfoDesc, FileInfo} from './../model/fileModel';
import FileWatcher from './fileWatcher';
import SyncManager from './syncManager';
import BaseFileAdapter from './baseFileAdapter';
import ClFileAdapter from '../backend/cloudlatex/clFileAdapter';
import Logger from './../logger';
import * as  EventEmitter from 'eventemitter3';
import { timingSafeEqual } from 'crypto';

/*
 * File management class
 *
 * Instantiate fileAdapter, fileWatcher and syncManager.
 * The fileWatcher detects local changes.
 * The syncManager synchronize local files with remote ones.
 * The file Adapter abstructs file operations of local files and remote ones.
 */
export default class FileManager extends EventEmitter {
  private selector: BackendSelector;
  readonly api: WebAppApi;
  private _fileAdapter?: BaseFileAdapter;
  private _files?: Repository<typeof FileInfoDesc>;
  private syncManager?: SyncManager;
  constructor(
    private config: Config,
    readonly rootPath: string,
    private decideSyncMode: DecideSyncMode,
    private fileFilter: (relativePath: string) => boolean,
    private logger: Logger
  ) {
    super();
    this.selector = new BackendSelector(config);
    this.api = this.selector.api;
  }

  public async init(): Promise<void> {
    // DB
    const dbFilePath = path.join(this.rootPath, `.${this.config.backend}.json`);
    const db = new TypeDB(dbFilePath);
    await db.load();
    this._files = db.getRepository(FileInfoDesc);
    this._files.all().forEach(file => {
      file.watcherSynced = false;
    });
    this._files.save();

    this._fileAdapter = this.selector.instantiateFileAdapter(this.rootPath, this._files, this.logger);

    // Sync Manager
    this.syncManager = new SyncManager(this._files, this._fileAdapter, this.decideSyncMode);  

    // File watcher
    const fileWatcher = new FileWatcher(this.rootPath, this._files, this.fileFilter, this.logger);
    fileWatcher.on('change-detected', () => {
      this.startSync();
    });
  }

  public async startSync() {
    if(!this.syncManager) {
      throw new Error('synManager is undefined.');
    }
    if (await this.syncManager.syncSession()) {
      this.emit('successfully-synced');
    }
  }

  public get fileAdapter(): BaseFileAdapter {
    if(!this._fileAdapter) {
      throw new Error('file adapter is not defined');
    }
    return this._fileAdapter;
  }

  public get files() {
    if(!this._files) {
      throw new Error('files is not defined');
    }
    return this._files;
  }
}
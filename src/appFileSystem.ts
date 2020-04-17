import * as  EventEmitter from 'eventemitter3';
import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';


type KeyType = number | string;

export default class AppFileSystem<AppFile> extends EventEmitter{
  public rootPath: string;
  public files: {[key in KeyType]: AppFile};
  private fileWatcher?: chokidar.FSWatcher;
  private watcherSyncedFiles: {[key in KeyType]: boolean};

  constructor(rootPath: string) {
    super();
    this.rootPath = rootPath;
    this.files = {};
    this.watcherSyncedFiles = {};
  }

  public initFileWatcher() {
    const watcherOption = {
      ignored: /\.git|\.vswpp|synctex\.gz|main\.pdf|\.workspace|\.vscode|.DS\_Store/ //#TODO
    };
    this.fileWatcher = chokidar.watch(this.rootPath, watcherOption);
    this.fileWatcher.on('add', (file: string) => this.onWatchingNewFile(file));
    this.fileWatcher.on('change', (file: string) => this.onWatchedFileChanged(file));
    this.fileWatcher.on('unlink', (file: string) => this.onWatchedFileDeleted(file));
  }

  public async pull() {
    for(let id in this.files) {
      try {
        this.download(id);
      } catch(err) {
        console.error('download error', this.files[id], err);
      }
    }
  }

  // #TODO
  public async sync() {

  }

  public loadFiles(): Promise<unknown> {
    throw new Error('No implementation');
  }

  public async download(id: KeyType): Promise<unknown> {
    if (!(id in this.files)) {
      return Promise.reject();
    }
    const file = this.files[id];
    console.log('downloading..,', file);
    const stream = await this._download(file);
    this.watcherSyncedFiles[id] = false;
    const relativePath =  this._getRelativePath(file);
    return this.saveAs(relativePath, stream);
  }

  protected _download(file: AppFile): Promise<NodeJS.ReadableStream>  {
    throw new Error('No implementation');
  }

  public async saveAs(relativePath: string, stream: NodeJS.ReadableStream): Promise<unknown> {
    const absPath = path.join(this.rootPath, relativePath);
    const dirname = path.dirname(absPath);
    try {
      await fs.promises.access(absPath);
    } catch(err) {
      await fs.promises.mkdir(dirname, {recursive: true});
    }

    return await new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(absPath);
      stream.pipe(fileStream);
      stream.on("error", (err) => {
        reject(err);
      });
      fileStream.on("finish", () => {
        resolve();
      });
    });
  }

  public async upload(relativePath: string, option?: any): Promise<KeyType>  {
    const id = await this._upload(relativePath, option);
    this.watcherSyncedFiles[id] = true;
    return id;
  }

  protected _upload(relativePath: string, option?: any): Promise<KeyType>  {
    throw new Error('No implementation');
  }

  public updateRemote(id: KeyType): Promise<unknown>  {
    return this._updateRemote(id);
  }

  protected _updateRemote(id: KeyType): Promise<unknown>  {
    throw new Error('No implementation');
  }

  public deleteRemote(id: KeyType): Promise<unknown>  {
    return this._deleteRemote(id);
  }

  protected _deleteRemote(id: KeyType): Promise<unknown>  {
    throw new Error('No implementation');
  }

  private getRelativePath(absPath: string): string {
    return absPath.replace(this.rootPath, '');
  }
  private getIdfromAbsPath(absPath: string): KeyType | null {
    let relativePath: string = this.getRelativePath(absPath);
    if(relativePath[0] === '/') {
      relativePath = relativePath.slice(1);
    }
    for(let id in this.files) {
      let _relativePath = this._getRelativePath(this.files[id]);
      if(_relativePath[0] === '/') {
        _relativePath = _relativePath.slice(1);
      }
      if(relativePath === _relativePath) {
        return id;
      }
    }

    return null;
  }

  protected _getRelativePath(file: AppFile): string {
    throw new Error('No implementation');
  }

  private onWatchingNewFile(absPath: string) {
    const relativePath = this.getRelativePath(absPath);
    const id = this.getIdfromAbsPath(absPath);
    if(id) {
      if(!this.watcherSyncedFiles[id]) {
        // this file is downloaded from remote
        this.watcherSyncedFiles[id] = true;
        return;
      }
      throw new Error('New file detected, but already registered.: ' + absPath);
    }
    console.log('new file detected', absPath);
    try {
      this.upload(relativePath);
    } catch(err) {
      console.error('upload failed', err);
    }
  }

  private async onWatchedFileChanged(absPath: string) {
    const id = this.getIdfromAbsPath(absPath);
    if(!id) {
      this.emit('local-changed-error', absPath);
      return;
    }
    // file was changed by downloading
    if(!this.watcherSyncedFiles[id]) {
      this.watcherSyncedFiles[id] = true;
      return;
    }
    try {
      const result = await this.updateRemote(id);
      console.log('update remote result', result);
    } catch(e) {
      console.error(e);
      vscode.window.showWarningMessage(e);
    }
    this.emit('file-changed', absPath);
  }

  private onWatchedFileDeleted(absPath: string) {
    const id = this.getIdfromAbsPath(absPath);
    if (!id) {
      this.emit('local-deleted-error', absPath);
      return;
    }
    if(!this.watcherSyncedFiles[id]) {
      this.watcherSyncedFiles[id] = false;
      return;
    }
    this.deleteRemote(id);
  }
}

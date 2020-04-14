const EventEmitter = require('eventemitter3');
import * as chokidar from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';

type KeyType = number | string;

export default class AppFileSystem<AppFile> extends EventEmitter{
  protected rootPath: string;
  protected files: {[key in KeyType]: AppFile};
  private fileWatcher?: chokidar.FSWatcher;
  private systemChangedFiles: {[key in KeyType]: boolean};

  constructor(rootPath: string) {
    super();
    this.rootPath = rootPath;
    this.files = {};
    this.initFileWatcher(rootPath);
    this.systemChangedFiles = {};
  }

  private initFileWatcher(rootPath: string) {
    const watcherOption = {
      ignored: /\.git|\.vswpp/
    };
    this.fileWatcher = chokidar.watch(rootPath, watcherOption);
    this.fileWatcher.on('add', (file: string) => this.onWatchingNewFile(file));
    this.fileWatcher.on('change', (file: string) => this.onWatchedFileChanged(file));
    this.fileWatcher.on('unlink', (file: string) => this.onWatchedFileDeleted(file));
  }

  public async pull() {
    await this._downloadProjectInfo();
    for(let id in this.files) {
      try {
        this.download(id);
      } catch(err) {
        console.error('download error', this.files[id], err);
      }
    }
  }

  protected _downloadProjectInfo(): Promise<unknown> {
    throw new Error('No implementation');
  }

  public async download(id: KeyType): Promise<unknown> {
    if (!(id in this.files)) {
      return Promise.reject();
    }
    const file = this.files[id];
    console.log('downloading..,', file);
    const stream = await this._download(file);
    this.systemChangedFiles[id] = true;
    const localPath =  this._getRelativePath(file);
    const absPath = path.join(this.rootPath, localPath);
    const dirname = path.dirname(absPath);
    await fs.promises.mkdir(dirname, {recursive: true});

    await new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(absPath);
      stream.pipe(fileStream);
      stream.on("error", (err) => {
        reject(err);
      });
      fileStream.on("finish", function() {
        resolve();
      });
    });
  }

  protected _download(file: AppFile): Promise<NodeJS.ReadableStream>  {
    throw new Error('No implementation');
  }

  public upload(relativePath: string, option?: any): Promise<unknown>  {
    return this._upload(relativePath, option);
  }

  protected _upload(relativePath: string, option?: any): Promise<unknown>  {
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

  private getIdfromLocalPath(lcoalPath: string): KeyType | null {
    let relativePath: string = lcoalPath.replace(this.rootPath, '');
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

  private onWatchingNewFile(localPath: string) {
    const id = this.getIdfromLocalPath(localPath);
    if(id) {
      if(this.systemChangedFiles[id]) {
        this.systemChangedFiles[id] = false;
        return;
      }
      throw new Error('New file detected, but already registered.: ' + localPath)
    }
    fs.writeFileSync(path.join(this.rootPath, localPath), '');
    this.upload(localPath);
  }

  private onWatchedFileChanged(localPath: string) {
    const id = this.getIdfromLocalPath(localPath);
    if(!id) {
      this.emit('local-changed-error', localPath);
      return;
    }
    // file was changed by downloading
    if(this.systemChangedFiles[id]) {
      this.systemChangedFiles[id] = true;
      return;
    }
    this.updateRemote(id);
  }

  private onWatchedFileDeleted(localPath: string) {
    const id = this.getIdfromLocalPath(localPath);
    if (!id) {
      this.emit('local-deleted-error', localPath);
      return;
    }
    if(this.systemChangedFiles[id]) {
      this.systemChangedFiles[id] = true;
      return;
    }
    this.deleteRemote(id);
  }
}

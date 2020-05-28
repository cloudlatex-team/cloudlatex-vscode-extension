import * as chokidar from 'chokidar';
import * as  EventEmitter from 'eventemitter3';
import {FileRepository} from '../model/fileModel';
import Logger from './../logger';

export default class FileWatcher extends EventEmitter {
  private fileWatcher: chokidar.FSWatcher;

  constructor(
    private rootPath: string,
    private files: FileRepository,
    public readonly watcherFileFilter: (relativePath: string) => boolean,
    private logger: Logger
  ) {
    super();
    const watcherOption = {
      ignored: /\.git|\.cloudlatex\.json|synctex\.gz|\.vscode|.DS\_Store/ //#TODO
      // ignored: /\.git|\.vswpp|synctex\.gz|main\.pdf|\.workspace|\.vscode|.DS\_Store/ //#TODO
    };
    this.fileWatcher = chokidar.watch(this.rootPath, watcherOption);
    this.fileWatcher.on('add', (file: string) => this.onWatchingNewFile(file));
    this.fileWatcher.on('change', (file: string) => this.onWatchedFileChanged(file));
    this.fileWatcher.on('unlink', (file: string) => this.onWatchedFileDeleted(file));
  }

  private onWatchingNewFile(absPath: string) {
    const relativePath = this.getRelativePath(absPath);
    if(!this.filterWatchingEvent(relativePath)) {
      return;
    }
    let file = this.files.findBy('relativePath', relativePath);
    if(file) {
      if(!file.watcherSynced) {
        // this file is downloaded from remote
        file.watcherSynced = true;
        this.files.save();
        return;
      }
      return this.logger.error('New file detected, but already registered.: ' + absPath);
    }
    console.log('new file detected', absPath);
    // #TODO add into files
    file = this.files.new({
      relativePath, 
      localChange: 'new',
      changeLocation: 'local'
    });
    this.files.save();
    this.emit('change-detected');
  }

  private async onWatchedFileChanged(absPath: string) {
    const relativePath = this.getRelativePath(absPath);
    if(!this.filterWatchingEvent(relativePath)) {
      return;
    }
    const changedFile = this.files.findBy('relativePath', relativePath);
    if(!changedFile) {
      this.logger.error('local-changed-error', absPath);
      return;
    }
    // file was changed by downloading
    if(!changedFile.watcherSynced) {
      changedFile.watcherSynced = true;
      this.files.save();
      return;
    }
    changedFile.localChange = 'update';
    this.files.save();
    this.emit('change-detected');
  }

  private async onWatchedFileDeleted(absPath: string) {
    const relativePath = this.getRelativePath(absPath);
    if(!this.filterWatchingEvent(relativePath)) {
      return;
    }
    const file = this.files.findBy('relativePath', relativePath);
    if (!file) {
      this.logger.error('local-deleted-error', absPath);
      return;
    }
    if(file.watcherSynced) {
      file.watcherSynced = false;
      this.files.save();
      return;
    }
    file.localChange = 'delete';
    this.files.save();
    this.emit('change-detected');
  }

  private getRelativePath(absPath: string): string {
    let relativePath = absPath.replace(this.rootPath, '');
    if(relativePath[0] === '/') {
      relativePath = relativePath.slice(1);
    }
    return relativePath;
  }

  private filterWatchingEvent(relativePath: string): boolean {
    if(this.watcherFileFilter && !this.watcherFileFilter(relativePath)) {
      return false;
    }
    return true;
  }
}
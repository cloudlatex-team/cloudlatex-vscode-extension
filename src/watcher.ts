import * as chokidar from 'chokidar';

export default class Watcher {
  private root: string;
  private fileWatcher: chokidar.FSWatcher;
  constructor(root: string) {
    this.root = root;
    const watcherOption = {
      ignored: /$^.git/
    };
    this.fileWatcher = chokidar.watch(root, watcherOption);
    this.fileWatcher.on('add', (file: string) => this.onWatchingNewFile(file));
    this.fileWatcher.on('change', (file: string) => this.onWatchedFileChanged(file));
    this.fileWatcher.on('unlink', (file: string) => this.onWatchedFileDeleted(file));
  }

  private onWatchingNewFile(file: string) {

  }

  private onWatchedFileChanged(file: string) {

  }

  private onWatchedFileDeleted(file: string) {

  }


}
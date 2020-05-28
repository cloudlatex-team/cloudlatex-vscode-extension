import BaseFileSystem from './baseFileAdapter';
import {SyncMode, DecideSyncMode} from '../types';
import baseFileAdapter from './baseFileAdapter';
import {FileRepository, FileInfo} from '../model/fileModel';

export default class SyncManager {
  private syncing: boolean = false;
  private syncReserved: boolean = false;
  constructor(private files: FileRepository, private fileAdapter: baseFileAdapter,  public decideSyncMode: DecideSyncMode) {
  }

  public async syncSession(): Promise<boolean> {
    if(this.syncing) {
      this.syncReserved = true;
      return true;
    }
    this.syncing = true;
    try {
      this.sync();
    } catch(e) {
      this.syncing = false;
      // #TODO offline or unauthorized?
      return false;
    }
    this.syncing = false;

    if(this.syncReserved) {
      this.syncReserved = false;
      setTimeout(this.syncSession.bind(this), 0);
      return false;
    }
    return true;
  }

  private async sync() {
    let remoteChanged = false;
    let bothChanged = false;
    const remoteFileList = await this.fileAdapter.loadFileList();
    const remoteFileDict = this.toDict(remoteFileList);

    // Reset remote change state and change location
    this.files.all().forEach(file => {
      file.remoteChange = 'no';
      file.changeLocation = 'no';
    });

    /* 
     * Compare remote and local file
     */
    // Remote to local
    remoteFileList.forEach(remoteFile => {
      let file = this.files.findBy('remoteId', remoteFile.remoteId);
      if(!file) { // created in remote
        file = this.files.new();
        file.changeLocation = 'remote';
        file.remoteChange = 'new';
        remoteChanged = true;
      } else if(file.revision !== remoteFile.revision) { // remote updated
        file.changeLocation = 'remote';
        file.remoteChange = 'update';
        remoteChanged = true;
      }
    });
    // Local to remote
    this.files.all().forEach(file => {
      let remoteFile = remoteFileDict[file.id];
      if(remoteFile) { // remote file exists
        if(file.localChange === 'no') {
          return;
        }
        if(file.changeLocation === 'remote') {
          file.changeLocation = 'both';
          bothChanged = true;
        } else {
          file.changeLocation = 'local';
        }
      } else { // remote file does not exist
        if(file.remoteId === null) { // local file is created
          file.changeLocation = 'local';
        } else { // remote file is deleted
          file.changeLocation = 'remote';
          file.remoteChange = 'delete';
          file.remoteId = null;
          remoteChanged = true;
        }
      }
    });

    let syncMode: SyncMode = 'download';
    if(remoteChanged) { // #TODO only bothChanged?
      syncMode = await this.decideSyncMode(
        this.files.where({'changeLocation': 'remote'}).map(file => file.relativePath),
        this.files.where({'changeLocation': 'local'}).map(file => file.relativePath),
        this.files.where({'changeLocation': 'both'}).map(file => file.relativePath),
      );
    }
    let promises = this.getSyncTasks(syncMode);
    await Promise.all(promises);
  }

  private getSyncTasks(remoteSyncMode: SyncMode): Promise<unknown>[] {
    const tasks: Promise<unknown>[] = [];
    this.files.all().forEach(file => {
      if(file.changeLocation === 'remote' || 
        (file.changeLocation === 'both' && remoteSyncMode === 'download')) {
        tasks.push(this.syncWithLocalTask(file));
      } else if(
        file.changeLocation === 'local' ||
        (file.changeLocation === 'both' && remoteSyncMode === 'upload')
      ) {
        tasks.push(this.syncWithRemoteTask(file));      
      }
    });
    return tasks;
  }

  private syncWithLocalTask(file: FileInfo): Promise<unknown> {
    switch(file.localChange) {
      case 'new':
        return this.fileAdapter.upload(file);
      case 'update':
        if(file.remoteChange === 'delete') {
          return this.fileAdapter.upload(file);
        }
        return this.fileAdapter.updateRemote(file);
      case 'delete':
        if(file.remoteChange === 'delete') {
          this.files.delete(file.id);
          this.files.save();
          return Promise.resolve();
        }
        return this.fileAdapter.deleteRemote(file);
      case 'no':
        return Promise.resolve();
    }
  }

  private syncWithRemoteTask(file: FileInfo): Promise<unknown> {
    switch(file.remoteChange) {
      case 'new':
      case 'update':
        return this.fileAdapter.download(file);
      case 'delete':
        if(file.localChange === 'delete') {
          this.files.delete(file.id);
          this.files.save();
          return Promise.resolve();
        }
        return this.fileAdapter.deleteLocal(file);
      case 'no':
        return Promise.resolve();
    }
  }

  private toDict(list: FileInfo[]): Record<number, FileInfo>{
    return list.reduce((dict, file) => {
      dict[file.id] = file;
      return dict;
    }, {} as Record<number, FileInfo>);
  }
}
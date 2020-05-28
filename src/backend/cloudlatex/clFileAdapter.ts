import BaseFileSystem from '../../fileManage/baseFileAdapter';
import * as fs from 'fs';
import * as path from 'path';
import WebAppApi from './webAppApi';
import {FileRepository, FileInfo} from '../../model/fileModel';
import {ClFile} from './types';
import Logger from '../../logger';

export default class ClFileAdapter extends BaseFileSystem {
  constructor(rootPath: string, files: FileRepository, private api: WebAppApi, logger: Logger) {
    super(rootPath, files, logger);
  }

  protected _download(file: FileInfo) {
    if(!file.url) {
      throw Error(`file url is not found!! ${file.relativePath}`);
    }
    return this.api.downloadFile(file.url);
  }

  protected async _upload(file: FileInfo, option?: any): Promise<string>{
    const stream = fs.createReadStream(path.join(this.rootPath, file.relativePath));
    let relativeDir = path.dirname(file.relativePath);
    if (relativeDir.length > 1 && relativeDir[0] === '/') {
      relativeDir = relativeDir.slice(1);
    }
    const result = await this.api.uploadFile(stream, relativeDir);
    return result.file.id;
  }

  protected _updateRemote(file: FileInfo & {remoteId: number}): Promise<any> {
    return fs.promises.readFile(
      path.join(this.rootPath, file.relativePath), 'utf-8'
    ).catch(err => {
      this.logger.error('local-reading-error', file.relativePath);
      return Promise.reject(file.relativePath);
    }).then(content => {
      return this.api.updateFile(file.remoteId, {
        content,
        revision: file.revision
      });
    }).then(result => {
      // TODO change
      file.revision = result.revision;
      return file;
    });
  }

  protected async _deleteRemote(file: FileInfo & {remoteId: number}) {
    const result = await this.api.deleteFile(file.remoteId);
    await this.loadFileList();
    return result;
  }

  public async loadFileList(): Promise<FileInfo[]> {
    // #TODO detect unauthorized and offline
    const res = await this.api?.loadFiles();
    const materialFiles: Array<ClFile> = res.material_files;
    console.log(materialFiles, res);

    return materialFiles.map(materialFile => {
      return {
        id: -1,
        isFolder: materialFile.is_folder,
        relativePath: materialFile.full_path,
        url: materialFile.file_url,
        revision: materialFile.revision,
        localChange: 'no',
        remoteChange: 'no',
        changeLocation: 'no',
        remoteId: materialFile.id,
        watcherSynced: false
      };
    });
  }
}
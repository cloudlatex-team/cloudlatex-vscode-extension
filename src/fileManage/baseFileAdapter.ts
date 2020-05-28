import * as fs from 'fs';
import * as path from 'path';
import {KeyType} from '../types';
import {FileRepository, FileInfo} from '../model/fileModel';
import Logger from '../logger';

export default class BaseFileAdapter {
  constructor(protected rootPath: string, private files: FileRepository, protected logger: Logger) {
  }

  public loadFileList(): Promise<FileInfo[]> {
    throw new Error('No implementation');
  }

  public async download(file: FileInfo): Promise<unknown> {
    if(file.isFolder) {
      return;
    } 
    console.log('downloading..,', file);

    const stream = await this._download(file);
    file.watcherSynced = false;
    this.files.save();
    return this.saveAs(file.relativePath, stream);
  }

  protected _download(file: FileInfo): Promise<NodeJS.ReadableStream>  {
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
      stream.on('error', (err) => {
        reject(err);
      });
      fileStream.on('finish', () => {
        resolve();
      });
    });
  }

  public async upload(file: FileInfo, option?: any): Promise<KeyType>  {
    const remoteId = await this._upload(file, option);
    file.watcherSynced = true;
    this.files.save();
    return remoteId;
  }

  protected _upload(file: FileInfo, option?: any): Promise<KeyType>  {
    throw new Error('No implementation');
  }

  public updateRemote(file: FileInfo): Promise<unknown>  {
    return this._updateRemote(file);
  }

  protected _updateRemote(file: FileInfo): Promise<unknown>  {
    throw new Error('No implementation');
  }

  public async deleteRemote(file: FileInfo): Promise<unknown>  {
    const result = await this._deleteRemote(file);
    file.watcherSynced = false;
    this.files.save();
    return result;
  }

  protected _deleteRemote(file: FileInfo): Promise<unknown>  {
    throw new Error('No implementation');
  }

  public deleteLocal(file: FileInfo) {
    const absPath = path.join(this.rootPath, file.relativePath);
    return fs.promises.unlink(absPath);
  }
}

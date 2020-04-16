import AppFileSystem from "./appFileSystem";
import { ClFile } from "./types";
import * as fs from 'fs';
import * as path from 'path';
import {ProjectsUrl, editPageUrlMatch, WebAppApi, LoginSessionKey} from './webAppApi';

export default class ClFileSystem extends AppFileSystem<ClFile> {
  private api: WebAppApi;

  constructor(rootPath: string, api: WebAppApi) {
    super(rootPath);
    this.api = api;
  }

  protected _download(file: ClFile) {
    if(file.is_folder) {
    } else {
      if(!file.file_url) {
        throw Error(`file irl is not found!! ${file.full_path}`);
      }
      return this.api.downloadFile(file.file_url);
    }
    return Promise.reject();
  }

  protected async _upload(relativePath: string, option?: any): Promise<string>{
    const stream = fs.createReadStream(path.join(this.rootPath, relativePath), 'utf8');
    const relativeDir = path.dirname(relativePath);
    const result = await this.api.uploadFile(stream, relativeDir);
    await this.downloadProjectInfo();
    return result.file.id;;
  }

  protected _updateRemote(id: number): Promise<any> {
    const file = this.files[id];
    let content;
    return fs.promises.readFile(
      path.join(this.rootPath, file.full_path), 'utf-8'
    ).catch(err => {
      this.emit('local-reading-error', file.full_path);
      return Promise.reject(file.full_path);
    }).then(content => {
      return this.api.updateFile(id, {
        content,
        revision: file.revision
      });
    }).then(result => {
      file.revision = result.revision;
      return file;
    });
  }

  protected async _deleteRemote(id: number) {
    const result = await this.api.deleteFile(id);
    await this.downloadProjectInfo();
    return result;
  }

  public async downloadProjectInfo(): Promise<unknown> {
    const res = await this.api?.loadFiles();
    this.files = {};
    const materialFiles: Array<ClFile> = res.material_files;
    console.log(materialFiles, res);

    for (let idx in materialFiles) {
      this.files[materialFiles[idx].id] = materialFiles[idx];
    }
    return;
  }

  protected _getRelativePath(file: ClFile): string {
    return file.full_path;
  }

}
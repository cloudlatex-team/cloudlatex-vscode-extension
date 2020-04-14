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

  _download(file: ClFile) {
    if(file.is_folder) {
    } else {
      if(!file.file_url) {
        throw Error(`file irl is not found!! ${file.full_path}`);
      }
      return this.api.downloadFile(file.file_url);
    }
    return Promise.reject();
  }

  _upload(relativePath: string, option?: any) {
    const stream = fs.createReadStream(path.join(this.rootPath, relativePath), 'utf8');
    return this.api.uploadFile(stream, relativePath);
  }

  _updateRemote(id: number) {
    const file = this.files[id];
    let content;
    try {
      content = fs.readFileSync(path.join(this.rootPath, file.full_path));
    } catch(e) {
      this.emit('local-reading-error', file.full_path);
      return Promise.reject(file.full_path);
    }
    return this.api.updateFile(id, {
      content
    });
  }

  _deleteRemote(id: number) {
    return this.api.deleteFile(id);
  }

  async _downloadProjectInfo(): Promise<unknown> {
    const res = await this.api?.loadFiles();
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
import fetch from 'node-fetch';
import { Stream } from 'stream';
import { CompileResult } from './types';
import * as FormData from 'form-data';
import { Config, ProjectInfo, WebAppApi } from '../../types';
import { APIProjects, APIRoot } from './clConst';

export default class CLWebAppApi implements WebAppApi {
  constructor(private config: Config) {
  }

  private headers(option: {json?: boolean, form?: boolean} = {}) {
    const headers: any = {
      'uid': this.config.email,
      'access-token': this.config.token,
      'client': this.config.client,
      // 'accept-language': 'ja,en-US;q=0.9,en;q=0.8'
    };
    if(option.json) {
      headers['Content-Type'] = 'application/json';
    }
    if(option.form) {
      headers['Content-Type'] = 'multipart/form-data';
    }
    return headers;
  }

  async validateToken() {
    const res = await fetch(`${APIRoot}/auth/validate_token`, {headers: this.headers()});
    return await res.json();
  }

  async loadProjects() {
    const res = await fetch(APIProjects, {headers: this.headers()});
    return JSON.parse(await res.json());
  }

  async loadProjectInfo() {
    const res = await fetch(`${APIProjects}/${this.config.projectId}`, {headers: this.headers()});
    const text = await res.text();
    return JSON.parse(text)['project'] as ProjectInfo;
  }

  async loadFiles() {
    const res = await fetch(`${APIProjects}/${this.config.projectId}/files`, {headers: this.headers()});
    const text = await res.text();
    return JSON.parse(text);
  }

  async createFile(name: string, belongs: number, is_folder: boolean) {
    const res = await fetch(
      `${APIProjects}/${this.config.projectId}`,
      {headers: this.headers({json: true}),
      method: 'POST',
      body: JSON.stringify({name, is_folder, belongs})}
    );
    return JSON.parse(await res.text());
  }

  async deleteFile(id: number) {
    const res = await fetch(
      `${APIProjects}/${this.config.projectId}/files/${id}`,
      {headers: this.headers(),
      method: 'DELETE'}
    );
    return JSON.parse(await res.text());
  }

  async updateFile(id: number, params: any): Promise<{revision: string}> {
    const res = await fetch(
      `${APIProjects}/${this.config.projectId}/files/${id}`,
      {headers: this.headers({json: true}),
      body: JSON.stringify({ material_file: params }),
      method: 'PUT'}
    );
    const result = JSON.parse(await res.text());
    if(!res.ok) {
      throw result;
    }
    return result;
  }

  async compileProject(): Promise<CompileResult> {
    const res = await fetch(
      `${APIProjects}/${this.config.projectId}/compile`,
      {headers: this.headers(),
      method: 'POST'}
    );
    const result = JSON.parse(await res.text());
    if(!res.ok) {
      console.log('compile failed', res, result);
      throw result;
    }
    return result;
  }

  async uploadFile(stream: Stream, relativeDir: string) {
    const form = new FormData();
    form.append('relative_path', relativeDir);
    form.append('file', stream);
    const headers = form.getHeaders();
    const res = await fetch(
      `${APIProjects}/${this.config.projectId}/files/upload`,
      {headers: {...this.headers(), ...headers},
      body: form,
      method: 'POST'}
    );
    const result = JSON.parse(await res.text());
    if(!res.ok) {
      console.log('upload file failed', res, result);
      throw result;
    }
    return result;
  }

  async downloadFile(url: string): Promise<NodeJS.ReadableStream> {
    const res = await fetch(
      `${url}`
    );
    return res.body;
  }

  async loadSynctexObject(url: string) {
    const res = await fetch(
      `${url}`
    );
    return await res.arrayBuffer();
  }
};

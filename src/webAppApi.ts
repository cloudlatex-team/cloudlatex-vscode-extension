import fetch from 'node-fetch';
import { Stream } from 'stream';
import { CompileResult } from './types';
import * as FormData from 'form-data';

const AppOrigin = 'http://localhost:3000'; //'https://cloudlatex.io';
export const ProjectsUrl = AppOrigin + '/projects';
const APIRoot = AppOrigin + '/api';
export const APIEndpoint = APIRoot + '/projects';
export const editPageUrlMatch =  /\/projects\/\d+\/edit/g; // /https\:\/\/cloudlatex.io\/projects\/\d+\/edit/g;;

export const LoginSessionKey = '_cloudlatex2_session';
const csrfKey = 'X-CSRF-Token';

export class WebAppApi {
  private csrf: string;
  private loginSession: string;
  private projectId: string;
  constructor(csrf: string, loginSession: string, projectId: string) {
    this.csrf = csrf;
    this.loginSession = loginSession;
    this.projectId = projectId;
  }

  private headers(option: {json?: boolean, form?: boolean} = {}) {
    const headers: any = {
      cookie: `${LoginSessionKey}=${this.loginSession}`,
      [csrfKey]: this.csrf
    };
    if(option.json) {
      headers['Content-Type'] = 'application/json';
    }
    if(option.form) {
      headers['Content-Type'] = 'multipart/form-data';
    }
    return headers;
  }

  async loadProjects() {
    const res = await fetch(APIEndpoint, {headers: this.headers()});
    return JSON.parse(await res.json());
  }

  async loadProjectInfo() {
    const res = await fetch(`${APIEndpoint}/${this.projectId}`, {headers: this.headers()});
    const text = await res.text();
    return JSON.parse(text);
  }

  async loadFiles() {
    const res = await fetch(`${APIEndpoint}/${this.projectId}/files`, {headers: this.headers()});
    const text = await res.text();
    return JSON.parse(text);
  }

  async createFile(name: string, belongs: number, is_folder: boolean) {
    const res = await fetch(
      `${APIEndpoint}/${this.projectId}`,
      {headers: this.headers({json: true}),
      method: 'POST',
      body: JSON.stringify({name, is_folder, belongs})}
    );
    return JSON.parse(await res.text());
  }

  // #TODO needed?
  async openFile(id: number) {
    const res = await fetch(
      `${APIEndpoint}/${this.projectId}/files/${id}`,
      {headers: this.headers()}
    );
    return JSON.parse(await res.text());
  }

  async deleteFile(id: number) {
    const res = await fetch(
      `${APIEndpoint}/${this.projectId}/files/${id}`,
      {headers: this.headers(),
      method: 'DELETE'}
    );
    return JSON.parse(await res.text());
  }

  async updateFile(id: number, params: any): Promise<{revision: string}> {
    const res = await fetch(
      `${APIEndpoint}/${this.projectId}/files/${id}`,
      {headers: this.headers({json: true}),
      body: JSON.stringify({ material_file: params }),
      method: 'PUT'}
    );
    if(!res.ok) {
      console.log('update file failed', res);
      throw res;
    }
    const result = JSON.parse(await res.text());
    return result;
  }

  async compileProject(): Promise<CompileResult> {
    const res = await fetch(
      `${APIEndpoint}/${this.projectId}/compile`,
      {headers: this.headers(),
      method: 'POST'}
    );
    const result = JSON.parse(await res.text());
    if(!res.ok) {
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
      `${APIEndpoint}/${this.projectId}/files/upload`,
      {headers: {...this.headers(), ...headers},
      body: form,
      method: 'POST'}
    );
    if(!res.ok) {
      console.log('upload file failed', res, await res.text());
      throw res;
    }
    return JSON.parse(await res.text());
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

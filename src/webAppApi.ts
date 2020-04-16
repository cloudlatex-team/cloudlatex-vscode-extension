import fetch from 'node-fetch';
import { Stream } from 'stream';
import { CompileResult } from './types';
import * as FormData from 'form-data';

const AppOrigin = 'https://cloudlatex.io';
export const ProjectsUrl = AppOrigin + '/projects';
const APIRoot = AppOrigin + '/api';
export const APIEndpoint = APIRoot + '/projects';
export const editPageUrlMatch =  /https\:\/\/cloudlatex.io\/projects\/\d+\/edit/g;;

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

  private headers(json: boolean = false) {
    const headers: any = {
      cookie: `${LoginSessionKey}=${this.loginSession}`,
      [csrfKey]: this.csrf
    };
    if(json) {
      headers['Content-Type'] = 'application/json';
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
      {headers: this.headers(true),
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
      {headers: this.headers(true),
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

  async uploadFile(stream: Stream, relativePath: string) {
    const form = new FormData();
    form.append('relative_path', relativePath);
    form.append('file', stream);
    const res = await fetch(
      `${APIEndpoint}/${this.projectId}/files/upload`,
      {headers: this.headers(),
      body: form,
      method: 'POST'}
    );
    if(!res.ok) {
      console.log('upload file failed', res);
      return;
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

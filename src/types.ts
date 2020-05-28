// TODO move to backend
export interface ProjectInfo {
  id: number;
  last_opened_file_id: number;
  compile_target_file_id: number;
  sync_target: string;        // enum?
  compiler: string;           // enum?
  display_warnings: boolean;
  editor_theme: string;       // enum?
  title: string;
  updated_at: string;         // Date?
  scroll_sync: boolean;
}

export interface Config {
  outDir: string;
  backend: string;
  email: string;
  client: string;
  token: string;
  projectId: number;
}

export interface AppInfo {
  loggedIn: boolean;
  backend?: string;
  projectName?: string;
  projectId?: string;
}

export interface WebAppApi {
  loadProjectInfo(): Promise<ProjectInfo>,
  downloadFile(url: string): Promise<NodeJS.ReadableStream>,
  loadSynctexObject(url: string): Promise<any>,
  compileProject(): any
}

/*
export const AppStates = {
  Init: 'Init',
  Offline: 'Offline',
  At_Login: 'At_Login',
  Failed_Login: 'Failed_Login',
  Conflicting: 'Conflicting',
  Pulling: 'Pulling',
  Pushing: 'Pushing',
  Idle: 'Idle'
} as const;

//'init' | 'offline' | 'at_login' | 'failed_login' | 'conflicting' | 'pushing' | 'pulling' | 'idle';
export type AppState = (typeof AppStates)[keyof typeof AppStates];
*/

export type KeyType = number | string;
export type SyncMode = 'upload' | 'download';
export type ChangeState = 'no' | 'update' | 'new' | 'delete';
export type ChangeLocation = 'no' | 'local' | 'remote' | 'both';

export interface DecideSyncMode {
  (
    remoteChangedFiles: string[],
    localChangedFiles: string[], 
    bothChangedFiles: string[]
  ): Promise<SyncMode>
}

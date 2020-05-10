export interface ClFile {
  is_folder: boolean;
  id: number;
  name: string;
  revision: string;
  size: number;
  mimetype: string;
  belonging_to: number;  // id
  full_path: string;
  file_url: string;
  thumbnail_url?: string;
}

export interface CompileResult {
  exit_code: number,
  uri: string,
  synctex_uri: string,
  errors: Array<string>,
  warnings: Array<string>,
  log: string,
}

export interface EditorProject {
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

export interface AppStatus {
  loggedIn: boolean;
  backend?: string;
  projectName?: string;
  projectId?: string;
}
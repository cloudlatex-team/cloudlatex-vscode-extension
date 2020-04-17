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
  exitCode: number,
  uri: string,
  synctex_uri: string,
  errors: Array<string>,
  warnings: Array<string>,
  log: string,
}


export interface Creditials {
  csrf: string,
  loginSession: string
}

export interface Config {
  outDir: string;
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

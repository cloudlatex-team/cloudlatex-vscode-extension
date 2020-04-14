export interface ClFile {
  is_folder: boolean;
  id: number;
  name: string;
  size: number;
  mimetype: string;
  belonging_to: number;  // id
  full_path: string;
  file_url: string;
  thumbnail_url?: string;
}

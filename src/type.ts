import { LoginStatus } from 'cloudlatex-cli-plugin';
export type VSConfig = {
  enabled: boolean,
  outDir: string,
  // backend: string,
  autoCompile: boolean,
  endpoint: string,
  projectId: number,
  supressIcon: boolean
};

export type SideBarInfo = {
  isWorkspace: boolean,
  activated: boolean,
  loginStatus: LoginStatus,
  displayUserName?: string,
  projectName: string | null
};
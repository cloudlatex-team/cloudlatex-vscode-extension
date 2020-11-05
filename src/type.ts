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
  offline: boolean,
  projectName: string | null
};
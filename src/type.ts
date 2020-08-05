export type VSConfig = {
  enabled: boolean,
  outDir: string,
  // backend: string,
  autoBuild: boolean,
  endpoint: string,
  projectId: number,
  supressIcon: boolean
};

export type SideBarInfo = {
  activated: boolean,
  offline: boolean,
};
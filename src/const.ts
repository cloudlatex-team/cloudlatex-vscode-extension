export const extensionName = 'cloudlatex';

export const dataTreeProviderId = 'cloudlatex-commands';
export const statusBarText = 'CL';

export const configNames = {
  enabled: `${extensionName}.enabled`,
  outDir: `${extensionName}.outDir`,
  autoCompile: `${extensionName}.autoCompile`,
  endpoint: `${extensionName}.endpoint`,
  projectId: `${extensionName}.projectId`,
  supressIcon: `${extensionName}.supressIcon`
};

export const commandNames = {
  refreshEntry: `${extensionName}.refreshEntry`,
  compile: `${extensionName}.compile`,
  reload: `${extensionName}.reload`,
  open: `${extensionName}.open`,
  account: `${extensionName}.account`,
  setting: `${extensionName}.setting`,
  compilerLog: `${extensionName}.compilerLog`,
  resetLocal: `${extensionName}.resetLocal`,
  clearAccount: `${extensionName}.clearAccount`
};

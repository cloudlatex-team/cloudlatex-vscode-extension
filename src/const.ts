import { VSConfig } from './type';

export const EXTENSION_NAME = 'cloudlatex';

export const DATA_TREE_PROVIDER_COMMDNS_ID = 'cloudlatex-commands';
export const DATA_TREE_PROVIDER_TUTORIAL_ID = 'cloudlatex-tutorial';
export const STATUS_BAR_TEXT = 'CL';

export const CONFIG_NAMES: { [k in keyof VSConfig]: `${typeof EXTENSION_NAME}.${keyof VSConfig}` } = {
  enabled: `${EXTENSION_NAME}.enabled`,
  outDir: `${EXTENSION_NAME}.outDir`,
  autoCompile: `${EXTENSION_NAME}.autoCompile`,
  endpoint: `${EXTENSION_NAME}.endpoint`,
  projectId: `${EXTENSION_NAME}.projectId`,
  supressIcon: `${EXTENSION_NAME}.supressIcon`,
  ignoredFiles: `${EXTENSION_NAME}.ignoredFiles`,
};

export const COMMAND_NAMES: { [k: string]: `${typeof EXTENSION_NAME}.${string}` } = {
  refreshEntry: `${EXTENSION_NAME}.refreshEntry`,
  openHelpPage: `${EXTENSION_NAME}.openHelpPage`,
  compile: `${EXTENSION_NAME}.compile`,
  reload: `${EXTENSION_NAME}.reload`,
  open: `${EXTENSION_NAME}.open`,
  account: `${EXTENSION_NAME}.account`,
  setting: `${EXTENSION_NAME}.setting`,
  viewCompilerError: `${EXTENSION_NAME}.viewCompilerError`,
  compilerLog: `${EXTENSION_NAME}.compilerLog`,
  viewPDF: `${EXTENSION_NAME}.viewPDF`,
  resetLocal: `${EXTENSION_NAME}.resetLocal`,
  clearAccount: `${EXTENSION_NAME}.clearAccount`,
};

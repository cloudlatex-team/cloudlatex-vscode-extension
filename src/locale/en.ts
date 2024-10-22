import { Translation } from '.';
import { CONFIG_NAMES } from '../const';

/* eslint-disable @typescript-eslint/naming-convention */
export const enTranslation: Translation = {
  SET_ACCOUNT: 'Set Account',
  NOT_LOGGED_IN: 'Not Logged In',
  CHANGE_ACCOUNT: 'Change Account',
  PROJECT_SETTING: 'Project Setting',
  COMPILE: 'Compile',
  VIEW_COMPILER_ERROR: 'View Compiler Error',
  VIEW_LOG: 'View Log',
  RELOAD: 'Reload',
  OFFLINE: 'Offline',
  VIEW_PDF: 'View LaTeX PDF',

  DETAIL: 'Detail',
  NO_WORKSPACE_ERROR: 'No workspace found. Please open a workspace first.',
  LOGIN_SUCCEEDED: 'Login to Cloud LaTeX succeeded.',
  LOGIN_FAILED: `Login to Cloud LaTeX failed. 
  Please generate a token from the Cloud LaTeX web site and enter the generated token from the \'Set Account\' button on the lower right.
  (* The token will be deactivated after a certain period of time. In that case, you need to generate token again.)`,
  OFFLINE_ERROR: `The network is offline or some trouble occur with the server.
  You can edit your files, but your changes will not be reflected on the server
  until it is enable to communicate with the server.`,
  COMPILATION_FAILED: 'Compilation failed.',
  FILE_SYNC_FAILED: 'File synchronization failed',
  FILE_SYNCHRONIZED: 'Project files have been synchronized!',
  FILE_CHANGE_ERROR: 'File change error happened.',
  UNEXPECTED_ERROR: 'Unexpected error happend.',
  FILE_CONFLICT_DETECTED: 'Following files is both changed in the server and local:',
  CONFIG_ENABLED_PLACE_ERROR: `Be sure to set ${CONFIG_NAMES.enabled} to true not at user\'s settings but at workspace settings.`,
  CONFIG_PROJECTID_EMPTY_ERROR: 'ProjectId should be set in workspace configration file.',
  HOW_TO_GENERATE_TOKEN: 'How to generate token',
  SETTING_README_URL: 'https://github.com/cloudlatex-team/cloudlatex-vscode-extension#setting',
  CHECK_DETAILS: 'Check details',
  NO_COMPILATION_TARGET: 'Compilation target is not set',
  UNKNOWN_ERROR: 'Unknown error happens',
  PROJECT_UPDATED: 'Project setting has been updated',
  FIRST_SYNC_NOTIFICATION: 'Do you want to sync the project \'$project_name\' ?',
  NOT_EMPTY_DIRECTORY: 'The directory contains files. To prevent overwriting files, the directory to be synchronized must be empty.'
};

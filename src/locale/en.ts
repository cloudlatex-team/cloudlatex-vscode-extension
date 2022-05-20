import { Translation } from '.';
import { CONFIG_NAMES } from '../const';

/* eslint-disable @typescript-eslint/naming-convention */
export const enTranslation: Translation = {
  SET_ACCOUNT: 'Set Account',
  NOT_LOGGED_IN: 'Not Logged In',
  CHANGE_ACCOUNT: 'Change Account',
  PROJECT_SETTING: 'Project Setting',
  COMPILE: 'Compile',
  VIEW_COMPILER_LOG: 'View Copiler Log',
  RELOAD: 'Reload',
  OFFLINE: 'Offline',

  NO_WORKSPACE_ERROR: 'No workspace found. Please open a workspace first.',
  LOGIN_SUCCEEDED: 'Login succeeded.',
  LOGIN_FAILED: 'Login failed.',
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
};
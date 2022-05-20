/* eslint-disable @typescript-eslint/naming-convention */
export const MESSAGE_TYPE = {
  /** Side bar */
  SET_ACCOUNT: 'SET_ACCOUNT',
  NOT_LOGGED_IN: 'NOT_LOGGED_IN',
  CHANGE_ACCOUNT: 'CHANGE_ACCOUNT',
  PROJECT_SETTING: 'PROJECT_SETTING',
  COMPILE: 'COMPILE',
  VIEW_COMPILER_LOG: 'VIEW_COMPILER_LOG',
  RELOAD: 'RELOAD',
  OFFLINE: 'OFFLINE',

  /** Message */
  NO_WORKSPACE_ERROR: 'NO_WORKSPACE_ERROR',
  LOGIN_SUCCEEDED: 'LOGIN_SUCCEEDED',
  LOGIN_FAILED: 'LOGIN_FAILED',
  OFFLINE_ERROR: 'OFFLINE_ERROR',
  COMPILATION_FAILED: 'COMPILATION_FAILED',
  FILE_SYNC_FAILED: 'FILE_SYNC_FAILED',
  FILE_SYNCHRONIZED: 'FILE_SYNCHRONIZED',
  FILE_CHANGE_ERROR: 'FILE_CHANGE_ERROR',
  UNEXPECTED_ERROR: 'UNEXPECTED_ERROR',
  FILE_CONFLICT_DETECTED: 'FILE_CONFLICT_DETECTED',
  CONFIG_ENABLED_PLACE_ERROR: 'CONFIG_ENABLED_PLACE_ERROR',
  CONFIG_PROJECTID_EMPTY_ERROR: 'CONFIG_PROJECTID_EMPTY_ERROR',
} as const;
/* eslint-enable @typescript-eslint/naming-convention */

export type Translation = { [key in typeof MESSAGE_TYPE[keyof typeof MESSAGE_TYPE]]: string };

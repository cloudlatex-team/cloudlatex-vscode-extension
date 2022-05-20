import { Translation } from '.';
import { CONFIG_NAMES } from '../const';

/* eslint-disable @typescript-eslint/naming-convention */
export const jaTranslation: Translation = {
  SET_ACCOUNT: 'アカウント設定',
  NOT_LOGGED_IN: 'ログインしていません',
  CHANGE_ACCOUNT: 'アカウント変更',
  PROJECT_SETTING: 'プロジェクト設定',
  COMPILE: 'コンパイル',
  VIEW_COMPILER_LOG: 'コンパイラログ表示',
  RELOAD: 'リロード',
  OFFLINE: 'オフライン',

  NO_WORKSPACE_ERROR: 'ワークスペースが見つかりません. 最初にワークスペースを開いてください.',
  LOGIN_SUCCEEDED: 'ログインに成功しました.',
  LOGIN_FAILED: 'ログインに失敗しました.',
  OFFLINE_ERROR: 'オフライン状態かサーバにエラーが発生しています. 引き続き編集できますがサーバと再接続されるまでファイルは同期されません.',
  COMPILATION_FAILED: 'コンパイルに失敗しました.',
  FILE_SYNC_FAILED: 'ファイルの同期に失敗しました',
  FILE_SYNCHRONIZED: 'ファイルが同期されました!',
  FILE_CHANGE_ERROR: '予期しないファイルの変更が検出されました.',
  UNEXPECTED_ERROR: '予期せぬエラーが発生しました.',
  FILE_CONFLICT_DETECTED: '下記のファイルがローカルとサーバの両方で変更されました:',
  CONFIG_ENABLED_PLACE_ERROR: `ユーザの設定ではなくワークスペースの設定内の ${CONFIG_NAMES.enabled} を有効化してください`,
  CONFIG_PROJECTID_EMPTY_ERROR: 'ProjectId はワークスペースの設定内に設定されている必要があります',
};
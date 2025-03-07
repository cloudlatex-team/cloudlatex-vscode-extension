import { Translation } from '.';
import { CONFIG_NAMES } from '../const';

/* eslint-disable @typescript-eslint/naming-convention */
export const jaTranslation: Translation = {
  SET_ACCOUNT: 'アカウント設定',
  NOT_LOGGED_IN: 'ログインしていません',
  CHANGE_ACCOUNT: 'アカウント変更',
  PROJECT_SETTING: 'プロジェクト設定',
  COMPILE: 'コンパイル',
  VIEW_COMPILER_ERROR: 'コンパイルエラー表示',
  VIEW_LOG: 'ログ表示',
  RELOAD: 'リロード',
  OFFLINE: 'オフライン',
  VIEW_PDF: 'PDF 表示',

  DETAIL: '詳細',
  NO_WORKSPACE_ERROR: 'ワークスペースが見つかりません. 最初にワークスペースを開いてください.',
  LOGIN_SUCCEEDED: 'ログインに成功しました.',
  LOGIN_FAILED: `Cloud LaTeXのログインに失敗しました.
  トークンをCloud LaTeXサイトより生成し、右下の 'アカウント設定' ボタンより生成したトークンを入力してください。
  (＊トークンは一定期間で無効化されます。その場合は初回手順と同様にトークンを生成して設定しなおす必要があります。)`,
  OFFLINE_ERROR: 'オフライン状態かサーバにエラーが発生しています. 引き続き編集できますがサーバと再接続されるまでファイルは同期されません.',
  COMPILATION_FAILED: 'コンパイルに失敗しました.',
  FILE_SYNC_FAILED: 'ファイルの同期に失敗しました',
  FILE_SYNCHRONIZED: 'ファイルが同期されました!',
  FILE_CHANGE_ERROR: '予期しないファイルの変更が検出されました.',
  UNEXPECTED_ERROR: '予期せぬエラーが発生しました.',
  FILE_CONFLICT_DETECTED: '下記のファイルがローカルとサーバの両方で変更されました:',
  CONFIG_ENABLED_PLACE_ERROR: `ユーザの設定ではなくワークスペースの設定内の ${CONFIG_NAMES.enabled} を有効化してください`,
  CONFIG_PROJECTID_EMPTY_ERROR: 'ProjectId はワークスペースの設定内に設定されている必要があります',
  HOW_TO_GENERATE_TOKEN: 'トークン生成方法',
  SETTING_README_URL: 'https://github.com/cloudlatex-team/cloudlatex-vscode-extension/blob/main/docs/README_ja.md#%E6%BA%96%E5%82%99',
  CHECK_DETAILS: '詳細を確認',
  NO_COMPILATION_TARGET: 'コンパイルターゲットが設定されていません',
  UNKNOWN_ERROR: '不明なエラーが発生しました',
  PROJECT_UPDATED: 'プロジェクト設定が更新されました',
  FIRST_SYNC_NOTIFICATION: 'プロジェクト \'$project_name\' を同期しますか？',
  NOT_EMPTY_DIRECTORY: 'ディレクトリにファイルが存在します。ファイルの上書きを防ぐため、同期を行うディレクトリは空である必要があります。',
};

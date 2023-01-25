# Cloud LaTeX Extension for Visual Studio Code
![CI](https://github.com/cloudlatex-team/cloudlatex-vscode-extension/workflows/build/badge.svg)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

# 特徴
- ローカルPCにtexliveをインストールすることなくVSCodeで編集したtexファイルをコンパイル可能に
- [Cloud LaTeX](https://cloudlatex.io/)公式VSCodeプラグイン
- ローカル上のファイルとCloud LaTeXサーバ上のファイルを自動同期
- オフライン時のファイル編集にも対応 (オンライン復帰時に自動同期)

# インストール
[Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=cloudlatex.cloudlatex)からインストール、あるいはクイックオープン(`ctrl/cmd + P`)に `ext install cloudlatex` と入力します.

# 準備
0. Cloud LaTeXのアカウントを持っていない場合は、[Cloud LaTeX](https://cloudlatex.io/)からアカウントを作成します。
1. [プロジェクト一覧](https://cloudlatex.io/projects)の右上のユーザ名をクリックし、上から3つ目のプラグイン連携を選択する。トークン生成ダイアログが表示されるので、アカウント情報を入力し、生成されるクライアントID、トークンを記録します。

    <img src="https://github.com/cloudlatex-team/cloudlatex-vscode-extension/raw/main/docs/extension_button_jp.png" alt="extension button" width="240px">  
    <br />
    <img src="https://github.com/cloudlatex-team/cloudlatex-vscode-extension/raw/main/docs/token_dialog_jp.png" alt="token dialog" width="320px">

2. [プロジェクト一覧](https://cloudlatex.io/projects)からプロジェクトを作成します。（VSCodeから利用したいプロジェクトが既に存在する場合はスキップしてください。）
3. 作成したプロジェクトのプロジェクトIDをURLより記録します。例: `/projects/123/edit` -> プロジェクトIDは `123`

    <img src="https://github.com/cloudlatex-team/cloudlatex-vscode-extension/raw/main/docs/cl_project_url.png" alt="url of cloudlatex project page" width="420px">


# 設定
- ローカルに**空のプロジェクト用フォルダ**を作成し、VSCodeでそのフォルダを開きます。
[Activity Bar](https://code.visualstudio.com/docs/getstarted/userinterface)に表示される`CL`アイコンをクリックするとSide Barに二つのボタンが表示されます。

- `Set account`ボタン（`アカウント設定` ボタン）をクリックし、`email`, `client`, `token` を設定します。
アカウントの設定は、コマンドパレット(mac: `Cmd+Shift+P`, win: `Ctrl+Shift+P`)で`cloud LaTeX: Set account` コマンドからも可能です。

    ＊ VSCodeの言語設定で日本語が設定されている場合は当拡張機能の表示も日本語化されます。キャプチャ画像は英語のものです。（[詳細](#ui言語設定)）

  <img src="https://github.com/cloudlatex-team/cloudlatex-vscode-extension/raw/main/docs/panel.png" alt="panel UI" width="320px">


- 次に`Project setting` ボタン (`プロジェクト設定` ボタン) をクリックし表示される項目のうち、
`Cloudlatex.projectID` に準備の項で確認した値を設定し、
`Clodulatex.Enabled` にチェックを付けます。(`Project setting` ボタンが表示されていない場合、プロジェクトフォルダが開かれているか確認してください。)


  ＊ `User` タブではなく、`Workspace` タブに設定を行う必要があります。

  <img src="https://github.com/cloudlatex-team/cloudlatex-vscode-extension/raw/main/docs/setting.png" alt="setting UI" width="600px">


- プロジェクトの[settings.json](https://code.visualstudio.com/docs/getstarted/settings)から設定することも可能です。(右上のアイコンクリックで`settings.json`を開きます)

  ```settings.json
  {
    "cloudlatex.projectId": 123,
    "cloudlatex.enabled": true,
    "cloudlatex.outDir":  "./.workspace",
  }
  ```

- [LaTeX Workshop](https://marketplace.visualstudio.com/items?itemName=James-Yu.latex-workshop)と併用することで、pdfのレビューやコマンド補完などが使えるようになります。
この場合、以下のようにしてLatex Workshopの自動コンパイルを無効化してください (`latex-workshop.latex.outDir`は `cloudlatex.outDir` と同じ値に設定します)。
  ```setting.json
  {
    "cloudlatex.projectId": 123,
    "cloudlatex.enabled": true,
    "cloudlatex.outDir":  "./.workspace",
    "latex-workshop.latex.autoBuild.run": "never",
    "latex-workshop.latex.outDir": "./.workspace",
    "[latex]": {
      "editor.formatOnSave": false,
    }
  }
  ```

- 設定ファイルを変更すると、VSCodeを再起動するよう促すダイアログが表示されるので、ダイアログ中のダイアログ中の `Restart VSCode` ボタンを押して再起動します。
再起動後、プロジェクトファイルがダウンロードされます。
ダウンロードが成功すると、ファイル同期に成功した旨のダイアログが表示されます。

  ＊ **プロジェクトを同期しなおす際には、同期中にローカルのファイルを削除しないように注意してください。(サーバのファイルも削除されます)　また、　同じローカルディレクトリ内で同期するプロジェクトを変更する際には、ローカルファイルが予期せず上書きされないように注意してください。（`projectId` を変更して同期を行うと、元のローカルファイルは上書きされます）**

  ＊ プロジェクトファイルがダウンロードされない時は、`reload`ボタン(`リロード` ボタン)をクリックするか、一旦VSCodeを閉じ、再度開いてみてください

## 設定項目一覧

| Setting key              | Description                                                                         | Default  | Type      |
| -------------------------| ----------------------------------------------------------------------------------- | -------- | --------- |
| `cloudlatex.enabled`     | プラグインを有効にするかどうか                                | `false`  | _boolean_ |
| `cloudlatex.projectId`   | プロジェクトID. *設定を間違えるとローカルファイルが別のプロジェクトファイルの内容に上書きされる可能性があるので注意してください    | `0`      | _number_  |
| `cloudlatex.outDir`      | コンパイル成果物出力先ディレクトリ                                                  | `""`     | _string_  |
| `cloudlatex.autoCompile` | 自動コンパイルを有効にするかどうか                          | `true`   | _boolean_ |
| `cloudlatex.supressIcon` | `true` にするとLaTeXプロジェクト以外のプロジェクトではActivity BarにCLアイコンが表示されなくなります     | `false`  | _boolean_ |

## UI言語設定
VSCodeの言語設定で日本語が設定されている場合は当拡張機能のUIも日本語表示になります。
日本語表示にするには[こちら](https://marketplace.visualstudio.com/items?itemName=MS-CEINTL.vscode-language-pack-ja) からJapanese Language Packをインストールしてください

# ファイルの同期とコンパイル
- オンラインの際にはローカルで行ったでファイルの変更が自動で同期されます。
Cloud LaTeXのwebアプリから行ったファイルの変更もローカルに反映されます。

`Project setting` で `cloudlatex.autoCompile` にチェックを入れることで、ファイル保存時に自動でコンパイルが行われます。
CLアイコンをクリックすることで表示されるサイドパネルの、 `Compile` ボタンからコンパイルすることも可能です。
コンパイル完了後、`Project setting` の `cloudlatex.outDir` に設定したディレクトリ以下にpdfがダウンロードされます。


## コンパイラ出力の確認
- texファイルに構文エラーがあり、コンパイルに失敗した場合、コンパイルに失敗した旨のダイアログが表示されます。

  <img src="https://github.com/cloudlatex-team/cloudlatex-vscode-extension/raw/main/docs/err_dialog.png" alt="error dialog" width="400px">


- `Check details` ボタンを押して、コンパイラ出力を確認してください。

  <img src="https://github.com/cloudlatex-team/cloudlatex-vscode-extension/raw/main/docs/problems_tab.png" alt="problems tab" width="400px">

## ファイルのコンフリクト
- 同一のファイルをローカルとサーバ(Cloudlatex Webエディタ、あるいはDropbox連携機能)の両方で編集すると、ファイルのコンフリクトが発生します。コンフリクトが発生すると、ローカルかサーバ、いずれかの変更に合わせる必要があります。

- コンフリクトを検知すると、以下のダイアログが表示されます。

  <img src="https://github.com/cloudlatex-team/cloudlatex-vscode-extension/raw/main/docs/conflict.png" alt="conflict dialog" width="400px">

- `Resolve conflict` ボタンを押し、`Pull` か `Push` を選択します。

  <img src="https://github.com/cloudlatex-team/cloudlatex-vscode-extension/raw/main/docs/push_or_pull.png" alt="resolve conflict dialog" width="500px">

  - Pull: サーバの変更をダウンロードし、サーバに合わせます
  - Push: サーバにローカルの変更をアップロードすることで、ローカルに合わせます

  <img src="https://github.com/cloudlatex-team/cloudlatex-vscode-extension/raw/main/docs/conflict_concept.png" alt="concept of conflict" width="400px">

# トラブルシューティング

## 「`error in syncSession: ...`」 というエラーメッセージが表示され、ファイルの同期が完了しない
リモートサーバとのファイルの同期が失敗しています。
Cloud LaTeX webアプリのプロジェクトにアクセスし、コンパイルターゲットが設定されていない等の問題がないか確認してください。
また、ローカルに不正なファイル（.から始まるファイル、LaTeXで利用されない拡張子を持つファイル等）が存在しないか確認し、存在する場合は削除してください。
問題が解決しない場合、コマンドパレット(mac: `Cmd+Shift+P`, win: `Ctrl+Shift+P`)を開き、`cloud LaTeX: Reset local` コマンドを実行し、強制的にローカルファイルの状態をサーバの状態に合わせることが可能です (注: サーバに同期されていないローカルファイルの変更点は失われます)。

## コンパイル時に「`Target file is not found`」というエラーメッセージが表示される
コンパイルターゲットに指定したファイル名を変更または削除すると、コンパイルができなくなります。その場合、Cloud LaTeX webアプリよりコンパイルターゲットを設定しなおしてください。

## 起動時に「Be sure to set cloudlatex.enabled to true ...」というエラーメッセージが表示される
`Project setting`の `User` タブの `cloudlatex.autoCompile` のチェックを外してください。(`Project` タブの`cloudlatex.autoCompile` にのみチェックを入れる必要があります)

## 今までファイル同期できていたのにかかわらず、突然「Your account is invalid」という警告メッセージが表示され、同期ができなくなる
トークンの有効期限が切れた可能性があります。サイトにアクセスし、初回と同様の手順でトークンを発行しなおしてください。

# 注意事項
- VSCodeでプロジェクトを開いている時にのみファイルの同期が行われます。そのため、プロジェクトを開いていない際に行ったファイル操作は同期されません。

# ソースコード
https://github.com/cloudlatex-team/cloudlatex-vscode-extension/tree/main

# ライセンス
Apache License 2.0

# 開発方法
[development](development.md) 参照
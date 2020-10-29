# Cloud LaTeX Extension for Visual Studio Code
<span style="color: red; font-size: 16px">開発中のプラグインです。動作確認以外の用途で使用しないでください。</span>

<!--
＊このプラグインはbetaバージョンです。バグの報告は、[issues](https://github.com/cloudlatex-team/cloudlatex-vscode-extension/issues)で受け付けています。
また、プルリクエストも歓迎しています。
-->

# 特徴
- ローカルPCにtexliveをインストールすることなくVSCodeで編集したtexファイルをコンパイル可能に
- [Cloud LaTeX](https://cloudlatex.io/)公式VSCodeプラグイン
- ローカル上のファイルとCloud LaTeXサーバ上のファイルを自動同期
- オフラインにも対応 (オンライン復帰時に自動同期)


# 準備
0. Cloud LaTeXのアカウントを持っていない場合は、[Cloud LaTeX](https://cloudlatex.io/)からアカウントを作成する。
1. [プロジェクト一覧](https://cloudlatex.io/projects)の右上のユーザ名をクリックし、上から3つ目のExtensionを選択する。トークン生成ダイアログが表示されるので、アカウント情報を入力し、生成されるクライアントID、トークンを記録する。
2. [プロジェクト一覧](https://cloudlatex.io/projects)からプロジェクトを作成する。
3. 作成したプロジェクトのプロジェクトIDをURLより記録する。例: `/projects/123/edit` -> プロジェクトIDは `123`

# 設定
ローカルに空のVSCode用プロジェクトを作成します。
[Activity Bar](https://code.visualstudio.com/docs/getstarted/userinterface)に表示される`CL`アイコンをクリックするとSide Barに二つのボタンが表示されます。

`Set account`ボタンをクリックし、`email`, `client`, `token` を設定します。
アカウントの設定は、コマンドパレット(mac: `Cmd+Shift+P`, win: `Ctrl+Shift+P`)で`cloud LaTeX: Set account` コマンドからも可能です。

<img src="panel.png" width="300px">


次に`Project setting` ボタンをクリックし表示される項目のうち、
`Cloudlatex.projectID` に準備の項で確認した値を設定し、
`Clodulatex.Enabled` にチェックを付けます。

＊ Cloudlatexの設定項目が表示されない時は、一旦vscodeを閉じ、再度開いてみてください

＊ `User` タブではなく、`Workspace` タブに設定を行う必要があります。

<img src="setting.png" width="500px">


プロジェクトの[settings.json](https://code.visualstudio.com/docs/getstarted/settings)から設定することも可能です。

```settings.json
{
  "cloudlatex.projectId": 127,
  "cloudlatex.enabled": true,
  "cloudlatex.outDir":  "./.workspace",
}
```

[LaTeX Workshop](https://marketplace.visualstudio.com/items?itemName=James-Yu.latex-workshop)と併用することで、pdfのレビューやコマンド補完などが使えるようになります。
この場合、以下の設定を追加することを推奨します (`latex-workshop.latex.outDir`は `cloudlatex.outDir` に合わせます)。
```setting.json
{
  "latex-workshop.latex.autoCompile.run": "never",
  "latex-workshop.latex.outDir": "./.workspace",
}
```

入力されたアカウントでログインができると自動でCloud LaTeXサーバからプロジェクトファイルがダウンロードされ、コンパイルが実行されます。

＊ プロジェクトファイルがダウンロードされない時は、一旦vscodeを閉じ、再度開いてみてください

# ファイルの同期とコンパイル
オンラインの際にはローカルで行ったでファイルの変更が自動で同期されます。
Cloud LaTeXのwebアプリから行ったファイルの変更もローカルに反映されます。

`Project setting` で `cloudlatex.autoCompile` にチェックを入れることで、ファイル保存時に自動でコンパイルが行われます。
CLアイコンをクリックすることで表示されるサイドパネルの、 `Compile` ボタンからコンパイルすることも可能です。
コンパイル完了後、`Project setting` の `cloudlatex.outDir` に設定したディレクトリ以下にpdfがダウンロードされます。

## ファイルのコンフリクト
同一のファイルをローカルとサーバ(Cloudlatex Webエディタ、あるいはDropbox連携機能)の両方で編集すると、ファイルのコンフリクトが発生します。コンフリクトが発生すると、ローカルかサーバ、いずれかの変更に合わせる必要があります。

コンフリクトを検知すると、以下のダイアログが表示されます。

<img src="conflict.png" width="500px">

`Resolve conflict` ボタンを押し、`Pull` か `Push` を選択します。

<img src="push_or_pull.png" width="500px">

- Pull: サーバの変更をダウンロードし、サーバに合わせます
- Push: サーバにローカルの変更をアップロードすることで、ローカルに合わせます

<img src="conflict_concept.png" width="400px">

# トラブルシューティング

## 「error in syncSession: ...'」 というエラ〜メッセージが表示される
リモートサーバとのファイルの同期が失敗しています。
Cloud LaTeX webアプリのプロジェクトにアクセスし、コンパイルターゲットが設定されていない等の問題がないか確認してください。
問題が解決しない場合、コマンドパレット(mac: `Cmd+Shift+P`, win: `Ctrl+Shift+P`)を開き、`cloud LaTeX: Reset local` コマンドを実行してください (注: サーバに同期されていないローカルファイルの変更点は失われます)。

## コンパイル時に「Target file is not found」というエラーメッセージが表示される
コンパイルターゲットに指定したファイル名を変更または削除すると、コンパイルができなくなります。その場合、Cloud LaTeX webアプリよりコンパイルターゲットを設定しなおしてください。

## 起動時に「Be sure to set cloudlatex.enabled to true ...」というエラーメッセージが表示される
`Project setting`の `User` タブの `cloudlatex.autoCompile` のチェックを外してください。(`Project` タブの`cloudlatex.autoCompile` にのみチェックを入れる必要があります)

# 注意事項
- VSCodeでプロジェクトを開いている時にのみファイルの同期が行われます。そのため、プロジェクトを開いていない際に行ったファイル操作は同期されません。

# ソースコード
https://github.com/cloudlatex-team/cloudlatex-vscode-extension/tree/master

# ライセンス
Apache License 2.0
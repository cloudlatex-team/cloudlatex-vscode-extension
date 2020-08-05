# Cloud LaTeX Extension for Visual Studio Code

## 特徴
- [Cloud LaTeX](https://cloudlatex.io/)を用いてローカルPC上のtexファイルをコンパイル
- ローカル上のファイルとCloud LaTeXサーバ上のファイルを自動同期
- オフラインに対応


## 準備
0. Cloud LaTeXのアカウントを持っていない場合は、[Cloud LaTeX](https://cloudlatex.io/)からアカウントを作成する。
1. [プロジェクト一覧](https://cloudlatex.io/projects)の右上のユーザ名をクリックし、上から3つ目のExtensionを選択する。トークン生成ダイアログが表示されるので、アカウント情報を入力し、生成されるクライアントID、トークンを記録する。
2. [プロジェクト一覧](https://cloudlatex.io/projects)からプロジェクトを作成する。
3. 作成したプロジェクトのプロジェクトIDをURLより記録する。例: `/projects/127/edit` -> プロジェクトIDは `127`

## 設定
ローカルに空のVSCode用プロジェクトを作成します。
プロジェクトの[settings.json](https://code.visualstudio.com/docs/getstarted/settings)に以下の設定を記述します。(GUIからの設定も可能です)
projectIdは、準備の項で確認した値に置き換えます。

```settings.json
{
  "cloudlatex.projectId": 127,
  "cloudlatex.enabled": true,
  "cloudlatex.outDir":  "./.workspace",
}
```

[LaTeX Workshop](https://marketplace.visualstudio.com/items?itemName=James-Yu.latex-workshop)と併用する場合、以下の設定を追加することを推奨します。
```setting.json
{
  "latex-workshop.latex.autoBuild.run": "never",
  "latex-workshop.latex.outDir": "./.workspace",
}
```

設定を行うと、activity barにCLアイコンが追加されます。
CLアイコンをクリックするとサイドパネルに`Set account`ボタンが出現するのでクリックし、
`email`, `client`, `token` を設定します。
アカウントの設定は、コマンドパレット(mac: `Cmd+Shift+P`, win: `Ctrl+Shift+P`)で`cloud LaTeX: Set account` コマンドからも可能です。

入力されたアカウントでログインができると自動でCloud LaTeXサーバからプロジェクトファイルがダウンロードされ、コンパイルが実行されます。

## ファイルの同期とコンパイル
オンラインの際にはローカルで行ったでファイルの変更が自動で同期されます。
Cloud LaTeXのwebアプリから行ったファイルの変更もローカルに反映されます。

`setting.json` で `{"cloudlatex.autoBuild": true}` を設定することで、ファイル保存時に自動でコンパイルが行われます。
CLアイコンをクリックすることで表示されるサイドパネルの、 `Compile` ボタンからコンパイルすることも可能です。

## 注意事項
- VSCodeでプロジェクトを開いている時にのみファイルの同期が行われます。そのため、プロジェクトを開いていない際に行ったファイル操作は同期されません。

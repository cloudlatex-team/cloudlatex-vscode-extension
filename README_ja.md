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
プロジェクトの[settings.json](https://code.visualstudio.com/docs/getstarted/settings)に以下の設定を記述します。
emailは、Cloud LaTeXアカウントで登録したメールアドレスを指定し、client、token、projectIdは、準備の項で記録した値を設定します。

```settings.json
{
  "cloudlatex.email": "Your email address",
  "cloudlatex.client": "Your client id",
  "cloudlatex.token": "Your token",
  "cloudlatex.projectId": [Your Project id],
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

設定を行うと、VSCodeの左側のパネルにCLアイコンが追加されます。
アイコンをクリックすると自動でCloud LaTeXサーバからプロジェクトファイルがダウンロードされ、コンパイルが実行されます。

## ファイルの同期とコンパイル
オンラインの際にはローカルで行ったでファイルの変更が自動で同期されます。
Cloud LaTeXのwebアプリから行ったファイルの変更もローカルに反映されます。

`cloudlatex.enabled` を設定することで、ファイル保存時に自動でコンパイルが行われます。
CLアイコンをクリックすることで表示されるパネルの、 `Compile` ボタンからコンパイルすることも可能です。

## 注意事項
- VSCodeでプロジェクトを開いている時にのみファイルの同期が行われます。そのため、プロジェクトを開いていない際に行ったファイル操作は同期されません。
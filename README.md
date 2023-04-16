# Cloud LaTeX Extension for Visual Studio Code

![CI](https://github.com/cloudlatex-team/cloudlatex-vscode-extension/workflows/build/badge.svg)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)

\*\*\* Write locally and compile on cloud service.

This is an extension for Visual Studio Code to write tex locally with Cloud LaTeX.

[日本語](https://github.com/cloudlatex-team/cloudlatex-vscode-extension/blob/main/docs/README_ja.md)

# Features

- Tex files you edit with VSCode can be compiled without installing texlive on your PC
- [Cloud LaTeX](https://cloudlatex.io/) official plugin
- Automatic synchronization between files in your PC and the Cloud LaTeX server
- Offline support (auto-sync on return to online)

# Installation

Install from [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=cloudlatex.cloudlatex), or run `ext install cloudlatex` in VS Code Quick Open (`ctrl/cmd + P`).

# Preparation

0. If you do not have an account, create your account from [Cloud LaTeX](https://cloudlatex.io/).
1. Click on the user name in the upper right corner at [Projects](https://cloudlatex.io/projects) and select the third button from the top labeled 'Extension'. A token generation dialog appears and enter your account information and record the generated client ID and token.
2. Create your project from [Projects](https://cloudlatex.io/projects).
3. Record the project ID from the URL (e.g., `/projects/123/edit` -> project ID is `123`)

## Setting

Create an empty VSCode project.
Click the `CL` icon on the Activity Bar and two buttins are appeared on the Side Bar.

Click `Set account` and enter `email`, `client` and `token`.
You can also set your account by `cloud LaTeX: Set account` command on the Command Pallete (mac: `Cmd+Shift+P`, win: `Ctrl+Shift+P`).

<img src="https://github.com/cloudlatex-team/cloudlatex-vscode-extension/raw/main/docs/panel.png" alt="panel UI" width="240px">

Click `Project setting` and set `Cloudlatex.projectID` and check 　`Clodulatex.Enabled`.

＊ Make sure to set in `Workspace` tab (not `User` tab).

<img src="https://github.com/cloudlatex-team/cloudlatex-vscode-extension/raw/main/docs/setting.png" alt="setting UI" width="600px">

You can also set `settings.json` under the project.

```settings.json
{
  "cloudlatex.projectId": 123,
  "cloudlatex.enabled": true,
  "cloudlatex.outDir":  "./.workspace",
}
```

With [LaTeX Workshop](https://marketplace.visualstudio.com/items?itemName=James-Yu.latex-workshop), you can use pdf review and command completion.
In this case, it is recommended to add the following settings (match `latex-workshop.latex.outDir` with `cloudlatex.outDir`).

```setting.json
{
  "latex-workshop.latex.autoCompile.run": "never",
  "latex-workshop.latex.outDir": "./.workspace",
  "[latex]": {
    "editor.formatOnSave": false,
  }
}
```

When you change the configuration file, a dialog box asks you to restart VSCode.
After the restart, the project files are downloaded.
If the download is successful, a dialog box will appear indicating that the files have been successfully synchronized.

\* When you try to re-synchronize project, please be careful not to delete any local files when the extension is enabled (this will cause deletion of the server files). Also, when you try to change the project in the same local directory, please be careful not that local files are overwritten unexpectedly (when you change `projectId`, original local files will be overwritten. ).

\* If the project files have not been downloaded, click the `reload` button or close and reopen VSCode.

| Setting key               | Description                                                                       | Default              | Type              |
| ------------------------- | --------------------------------------------------------------------------------- | -------------------- | ----------------- |
| `cloudlatex.enabled`      | Set true to enable cloudlatex plugin in this project                              | `false`              | _boolean_         |
| `cloudlatex.projectId`    | ProjectId. \*Do not mistake this value, otherwise your files might be overwritten | `0`                  | _number_          |
| `cloudlatex.outDir`       | Directory to output compile result                                                | `""`                 | _string_          |
| `cloudlatex.autoCompile`  | Set true to automatically compile when any files are saved                        | `true`               | _boolean_         |
| `cloudlatex.supressIcon`  | Set true to hide cloudlatex icon on the activity bar in the unactivated project   | `false`              | _boolean_         |
| `cloudlatex.ignoredFiles` | Files to be ignored from file synchronization                                     | See the next section | _Array\<string\>_ |

### Specifying files not to be synchronized

Files matching the glob pattern specified in `cloudlatex.ignoredFiles` are ignored from the file synchronization process. The glob patterns are matched against the absolute file pattern.
Patterns are compatible with [anymatch](https://github.com/micromatch/anymatch).

Examples

- Do not synchoronize files named 'README.md' : `**/README.md`
- Do not synchoronize files with 'bin' extension: `**/*.bin`
- Do not synchoronize files under 'test' directory: `**/test/**`

By default, file names starting with `.` except for `.latexmkrc` and extensions related to LaTeX compiled artifacts are set.  
For performance reasons, `.git` and `node_modules` are also ignored from the file synchronization process, regardless of `cloudlatex.ignoredFiles`.

<details>
<summary>Default value of cloudlatex.ignoredFiles </summary>

```
[
  "**/*.aux",
  "**/*.bbl",
  "**/*.bcf",
  "**/*.blg",
  "**/*.idx",
  "**/*.ind",
  "**/*.lof",
  "**/*.lot",
  "**/*.out",
  "**/*.toc",
  "**/*.acn",
  "**/*.acr",
  "**/*.alg",
  "**/*.glg",
  "**/*.glo",
  "**/*.gls",
  "**/*.ist",
  "**/*.fls",
  "**/*.log",
  "**/*.nav",
  "**/*.snm",
  "**/*.fdb_latexmk",
  "**/*.synctex.gz",
  "**/*.synctex\\(busy\\)",
  "**/*.synctex.gz\\(busy\\)",
  "**/*.run.xml",
  "**/.vscode/**",
  "**/.!(latexmkrc)"
]
```

</details>

# Source Code

https://github.com/cloudlatex-team/cloudlatex-vscode-extension/tree/main

# License

Apache License 2.0

# Development
See [development](docs/development.md)
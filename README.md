# Cloud LaTeX Extension for Visual Studio Code
*** Write locally and compile on cloud service.

This is an extension for Visual Studio Code to write tex locally with Cloud LaTeX.

[日本語](https://github.com/cloudlatex-team/cloudlatex-vscode-extension/blob/master/docs/README_ja.md)

## Features
- Cloud Services
  - Cloudlatex

- Sync files
- Auto build

## Installation
Find the cloudlatex plugin in [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/), or run `ext install latex-workshop` in VS Code Quick Open (`ctrl/cmd + P`).


## Setting

settings.json
```settings.json
{
  "latex-workshop.latex.autoBuild.run": "never",
  "latex-workshop.latex.outDir": "./.workspace",
  "cloudlatex.email": "Your email address",
  "cloudlatex.client": "Your client id",
  "cloudlatex.token": "Your token",
  "cloudlatex.projectId": [Your Project id],
  "cloudlatex.enabled": true,
}
```

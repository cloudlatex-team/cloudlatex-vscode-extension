# Development

## Repositories

### CloudLaTeX VSCode Extension

https://github.com/cloudlatex-team/cloudlatex-vscode-extension  
Implementation of VSCode dependent features

### CloudLaTeX CLI Plugin

https://github.com/cloudlatex-team/cloudlatex-cli-plugin  
Implementation of Editor independent functionality

## Setup

Node.js 22 or later and Yarn 1 are required. The packaging tool (`@vscode/vsce`) does not support older versions of
Node.js. CI uses Node.js 24.

```bash
git clone git@github.com:cloudlatex-team/cloudlatex-vscode-extension.git
git clone git@github.com:cloudlatex-team/cloudlatex-cli-plugin.git

cd cloudlatex-cli-plugin
yarn install    # also builds dist with the prepare script
yarn link

cd ../cloudlatex-vscode-extension
yarn link cloudlatex-cli-plugin
yarn install
```

## Debug

Use debug tool
https://code.visualstudio.com/docs/editor/debugging

## Build

```bash
yarn run vsce
```

`build/cloudlatex-xxx.vsix` will be generated.

Install extension locally by follwoing.

```bash
code --install-extension ./build/cloudlatex-xxx.vsix
```

## Release

See [release.md](release.md).

# Development

## Repositories

### CloudLaTeX VSCode Extension

https://github.com/cloudlatex-team/cloudlatex-vscode-extension  
Implementation of VSCode dependent features

### CloudLaTeX CLI Plugin

https://github.com/cloudlatex-team/cloudlatex-cli-plugin  
Implementation of Editor independent functionality

## Setup

```bash
git clone git@github.com:cloudlatex-team/cloudlatex-vscode-extension.git
git clone git@github.com:cloudlatex-team/cloudlatex-cli-plugin.git

cd cloudlatex-cli-plugin
yarn install
yarn run build
yarn link

cd ../cloudlatex-vscode-extension
yarn link cloudlatex-cli-plugin
yarn install
```

## Debug

Use debug tool
https://code.visualstudio.com/docs/editor/debugging

### Custom API endpoints

Normal use connects to `https://cloudlatex.io/api`. For local development, set
`cloudlatex.endpoint` in an empty development workspace's `.vscode/settings.json`
before registering or connecting a project:

```json
{
  "cloudlatex.endpoint": "http://localhost:3000/api"
}
```

Use a separate VS Code user-data directory and development credentials when
testing another server. Named profiles within one user-data directory share the
existing account file. The extension asks for confirmation before sending
credentials to a custom endpoint. Registered shortcuts retain their endpoint,
and a new folder connection carries it over along with the compilation, output,
and ignored-file settings. The default endpoint is hidden from the registered
project row, tooltip, connection confirmation, and folder picker; only custom
endpoints are shown. Commands contains actions rather than server metadata.

### Project connections and registered shortcuts

The connection wizard accepts a project URL or ID and validates it through the
existing individual-project API. It does not request a server-wide project list
or depend on an unreleased project-list API. Shortcut registration uses the same
individual-project API.

Registered Projects is a local shortcut registry, not a server-wide project
list. It remembers projects explicitly registered by URL/ID or connected in the
current VS Code profile. Records contain the project ID, title, endpoint,
last-opened time, and local folder when known; they contain no credentials.
Any future feature that lists all account projects must be implemented only
after the corresponding server API has been released.

## Tests

```bash
yarn install --frozen-lockfile
yarn run lint
yarn run test:unit
yarn test
```

Adapter unit tests mock VS Code and require no server or account. The offline
regression tests also run the pinned CLI plugin against an isolated loopback HTTP
fixture and real temporary files. They verify offline edits, reconnects,
simultaneous sync requests, explicit push/pull conflict resolution, and remote
deletion during offline editing without using a Cloud LaTeX account.
`yarn test` also runs
extension-host tests in an isolated temporary workspace, user profile and
extension directory, with Cloud LaTeX disabled and its endpoint set to localhost.
It downloads a test copy of VS Code by default. To use an existing executable,
set `VSCODE_EXECUTABLE_PATH` (the application executable, not the `code` shell script).

## Synchronization review notes

The CLI plugin remains pinned to `853b03cb8777381019293cecb7f6ad05fcb5c1c2`.
The extension does not add a reconnect timer or a new merge algorithm. File-change
events and the Reload action continue to call the existing synchronization API.
The new display baseline copies file metadata and normalizes only stale remote
flags from a known successful sync; it does not modify the core repository.

There is one intentional compilation change: `cloudlatex.autoCompile: false`
also suppresses the initial automatic compile. Manual Compile remains available.

The current upstream watcher has a separate cold-start limitation: changes made
externally while the watcher is stopped may not be marked as local edits on
restart. If the remote copy changed too, the core can download it without
reporting a conflict. The running-watcher offline tests above do not establish
safety for that scenario. This limitation requires a CLI-plugin change and is
not addressed by the sidebar feature.

The folder connection marker contains a one-use nonce only. The profile's
pending intent is keyed by the target folder. Synchronization stays disabled
until the destination host validates the handoff and clears old sync metadata.
Expired intents remove only their own marker so the folder can be selected again.
`jsonc-parser` preserves comments and trailing commas in VS Code settings.

## Build

```bash
yarn run vsce
```

`build/cloudlatex-xxx.vsix` will be generated.

Install extension locally by follwoing.

```bash
code --install-extension ./build/cloudlatex-xxx.vsix
```

// VS Code configuration keys and Electron environment variables use fixed names.
/* eslint-disable @typescript-eslint/naming-convention */
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

import { runTests } from 'vscode-test';

async function main() {
	// Never load a developer's accounts, projects, or installed extensions.
	// macOS limits the length of the IPC socket inside the user-data directory.
	const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cl-test-'));
	try {
		// The folder containing the Extension Manifest package.json
		// Passed to `--extensionDevelopmentPath`
		const extensionDevelopmentPath = path.resolve(__dirname, '../../');

		// The path to test runner
		// Passed to --extensionTestsPath
		const extensionTestsPath = path.resolve(__dirname, './suite/index');

		// Download VS Code, unzip it and run the integration test
		const workspacePath = path.join(testRoot, 'workspace');
		fs.mkdirSync(path.join(workspacePath, '.vscode'), { recursive: true });
		fs.writeFileSync(path.join(workspacePath, '.vscode/settings.json'), JSON.stringify({
			'cloudlatex.enabled': false,
			'cloudlatex.endpoint': 'http://127.0.0.1:1/api'
		}));
		await runTests({
			extensionDevelopmentPath,
			extensionTestsPath,
			vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH,
			extensionTestsEnv: { ELECTRON_RUN_AS_NODE: undefined },
			launchArgs: [
				workspacePath,
				'--disable-extensions',
				'--disable-updates',
				'--disable-workspace-trust',
				'--skip-welcome',
				'--skip-release-notes',
				`--user-data-dir=${path.join(testRoot, 'user-data')}`,
				`--extensions-dir=${path.join(testRoot, 'extensions')}`
			]
		});
	} catch (err) {
		console.error('Failed to run tests');
		console.error(err);
		process.exitCode = 1;
	} finally {
		fs.rmSync(testRoot, { recursive: true, force: true });
	}
}

main();

// Mock API names and setting keys must match VS Code and LaTeX Workshop.
/* eslint-disable @typescript-eslint/naming-convention */
import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';

type WorkshopModule = typeof import('../../external/latexWorkshop');
type TestUri = { scheme: string; fsPath: string };
type Options = {
  installed?: boolean;
  rootPath?: string | null;
  cloudOutDir?: string;
  folders?: TestUri[];
  settings?: Record<string, string>;
  choices?: (string | undefined)[];
  statType?: number;
  statError?: Error;
  commandError?: Error;
  updateError?: Error;
  externalError?: Error;
  externalResult?: boolean;
  pathApi?: typeof path.posix;
};

// Load the compiled adapter with a deliberately small VS Code mock. This keeps
// the tests independent of the extension host, accounts and all network APIs.
function loadWorkshop(options: Options = {}) {
  const rootPath = options.rootPath === undefined ? '/workspace/paper' : options.rootPath;
  const folders = options.folders || (rootPath ? [{ scheme: 'file', fsPath: rootPath }] : []);
  const settings = { ...options.settings };
  const choices = [...(options.choices || [])];
  const updates: { section: string; key: string; value: string; target: number }[] = [];
  const configurations: { section: string; resource: TestUri }[] = [];
  const commands: { command: string; args: unknown[] }[] = [];
  const externalUris: TestUri[] = [];
  const statUris: TestUri[] = [];
  const information: { message: string; args: unknown[] }[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const vscode = {
    extensions: {
      getExtension: (id: string) => {
        assert.strictEqual(id, 'james-yu.latex-workshop');
        return options.installed === false ? undefined : {};
      }
    },
    workspace: {
      workspaceFolders: folders.map(uri => ({ uri })),
      getConfiguration: (section: string, resource: TestUri) => {
        configurations.push({ section, resource });
        assert.strictEqual(section, 'latex-workshop');
        return {
          get: (key: string) => settings[key],
          update: async (key: string, value: string, target: number) => {
            if (options.updateError) {
              throw options.updateError;
            }
            updates.push({ section, key, value, target });
            settings[key] = value;
          }
        };
      },
      fs: {
        stat: async (uri: TestUri) => {
          statUris.push(uri);
          if (options.statError) {
            throw options.statError;
          }
          return { type: options.statType === undefined ? 1 : options.statType };
        }
      }
    },
    window: {
      showInformationMessage: async (message: string, ...args: unknown[]) => {
        information.push({ message, args });
        return choices.shift();
      },
      showWarningMessage: async (message: string) => { warnings.push(message); },
      showErrorMessage: async (message: string) => { errors.push(message); }
    },
    commands: {
      executeCommand: async (command: string, ...args: unknown[]) => {
        commands.push({ command, args });
        if (options.commandError) {
          throw options.commandError;
        }
      }
    },
    env: {
      openExternal: async (uri: TestUri) => {
        externalUris.push(uri);
        if (options.externalError) {
          throw options.externalError;
        }
        return options.externalResult !== false;
      }
    },
    Uri: {
      file: (fsPath: string): TestUri => ({ scheme: 'file', fsPath }),
      parse: (url: string): TestUri => ({ scheme: 'https', fsPath: url })
    },
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    FileType: { File: 1, Directory: 2 },
    ViewColumn: { Beside: -2 }
  };
  const sandbox = {
    exports: {},
    require: (name: string) => {
      if (name === './locale' || name === '../locale') { return require('../../locale'); }
      if (name === './const') { return require('../../const'); }
      if (name === 'vscode') {
        return vscode;
      }
      if (name === 'path') {
        return options.pathApi || path.posix;
      }
      if (name === '../interaction') {
        return { localeStr: (key: string) => key };
      }
      if (name === '../config') {
        return {
          getRootPath: () => rootPath || undefined,
          getVSConfig: () => ({
            get: (key: string, fallback: string) => {
              assert.strictEqual(key, 'outDir');
              return options.cloudOutDir === undefined ? fallback : options.cloudOutDir;
            }
          })
        };
      }
      throw new Error(`Unexpected dependency: ${name}`);
    }
  };
  const filename = require.resolve('../../external/latexWorkshop');
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), sandbox, { filename });
  return {
    workshop: sandbox.exports as WorkshopModule,
    updates, configurations, settings, commands, externalUris, statUris,
    information, warnings, errors
  };
}

suite('LaTeX Workshop integration', () => {
  test('output paths are workspace based, portable and normalized', () => {
    const { workshop } = loadWorkshop();
    assert.strictEqual(workshop.getWorkshopOutDir('/workspace/paper', ''), '%WORKSPACE_FOLDER%');
    assert.strictEqual(workshop.getWorkshopOutDir('/workspace/paper', '.'), '%WORKSPACE_FOLDER%');
    assert.strictEqual(workshop.getWorkshopOutDir('/workspace/paper', './build/../.workspace/'), '%WORKSPACE_FOLDER%/.workspace');
    assert.strictEqual(workshop.getWorkshopOutDir('/workspace/paper', '../artifacts/'), '%WORKSPACE_FOLDER%/../artifacts');
    assert.strictEqual(workshop.getWorkshopOutDir('/workspace/paper', '/tmp/artifacts/'), '/tmp/artifacts');
  });

  test('Windows output paths retain drive letters and use forward slashes', () => {
    const { workshop } = loadWorkshop({ pathApi: path.win32 });
    assert.strictEqual(workshop.getWorkshopOutDir('C:\\papers\\論文', ''), '%WORKSPACE_FOLDER%');
    assert.strictEqual(workshop.getWorkshopOutDir('C:\\papers\\論文', '.\\build\\'), '%WORKSPACE_FOLDER%/build');
    assert.strictEqual(workshop.getWorkshopOutDir('C:\\papers\\論文', 'D:\\PDF files\\'), 'D:/PDF files');
  });

  test('setup previews changes and cancellation leaves all settings untouched', async () => {
    const state = loadWorkshop({ cloudOutDir: './.workspace', settings: { 'latex.autoBuild.run': 'onSave', 'latex.outDir': '%DIR%' } });
    await state.workshop.configure();
    assert.deepStrictEqual(state.updates, []);
    assert.strictEqual(state.settings['latex.autoBuild.run'], 'onSave');
    assert.ok(state.information[0].message.includes('latex-workshop.latex.autoBuild.run: "never"'));
    assert.ok(state.information[0].message.includes('%WORKSPACE_FOLDER%/.workspace'));
    assert.strictEqual((state.information[0].args[0] as { modal: boolean }).modal, true);
  });

  test('setup applies only two Workshop settings at workspace scope and is idempotent', async () => {
    const state = loadWorkshop({ cloudOutDir: './.workspace', choices: ['APPLY_SETTINGS'] });
    await state.workshop.configure();
    assert.deepStrictEqual(state.updates, [
      { section: 'latex-workshop', key: 'latex.autoBuild.run', value: 'never', target: 2 },
      { section: 'latex-workshop', key: 'latex.outDir', value: '%WORKSPACE_FOLDER%/.workspace', target: 2 }
    ]);
    assert.strictEqual(state.configurations[0].resource.fsPath, '/workspace/paper');
    await state.workshop.configure();
    assert.strictEqual(state.updates.length, 2);
    assert.strictEqual(state.information[state.information.length - 1].message, 'LATEX_WORKSHOP_CONFIGURED');
  });

  test('multi-root setup is limited to the first folder used by Cloud LaTeX', async () => {
    const state = loadWorkshop({
      folders: [{ scheme: 'file', fsPath: '/workspace/paper' }, { scheme: 'file', fsPath: '/workspace/other' }],
      choices: ['APPLY_SETTINGS']
    });
    await state.workshop.configure();
    assert.ok(state.updates.every(update => update.target === 3));
    assert.strictEqual(state.configurations[0].resource.fsPath, '/workspace/paper');
  });

  test('already correct settings produce no confirmation or writes', async () => {
    const state = loadWorkshop({ settings: { 'latex.autoBuild.run': 'never', 'latex.outDir': '%WORKSPACE_FOLDER%' } });
    await state.workshop.configure();
    assert.deepStrictEqual(state.updates, []);
    assert.strictEqual(state.information.length, 1);
    assert.strictEqual(state.information[0].message, 'LATEX_WORKSHOP_CONFIGURED');
  });

  test('setup without a local folder returns before reading or writing settings', async () => {
    for (const options of [{ rootPath: null }, { folders: [{ scheme: 'vscode-remote', fsPath: '/remote/paper' }] }]) {
      const state = loadWorkshop(options);
      await state.workshop.configure();
      assert.deepStrictEqual(state.configurations, []);
      assert.deepStrictEqual(state.updates, []);
      assert.deepStrictEqual(state.warnings, ['NO_WORKSPACE_ERROR']);
    }
  });

  test('missing Workshop offers installation without installing or changing settings automatically', async () => {
    const canceled = loadWorkshop({ installed: false });
    await canceled.workshop.configure();
    assert.deepStrictEqual(canceled.updates, []);
    assert.deepStrictEqual(canceled.externalUris, []);
    assert.strictEqual(canceled.information[0].message, 'LATEX_WORKSHOP_REQUIRED');

    const accepted = loadWorkshop({ installed: false, choices: ['INSTALL_LATEX_WORKSHOP'] });
    await accepted.workshop.configure();
    assert.strictEqual(accepted.externalUris.length, 1);
    assert.ok(accepted.externalUris[0].fsPath.includes('marketplace.visualstudio.com/items?itemName=James-Yu.latex-workshop'));
    assert.deepStrictEqual(accepted.updates, []);
  });

  test('setup reports marketplace opening failures without changing settings', async () => {
    const state = loadWorkshop({
      installed: false,
      choices: ['INSTALL_LATEX_WORKSHOP'],
      externalError: new Error('browser unavailable')
    });
    await state.workshop.configure();
    assert.ok(state.errors[0].includes('LATEX_WORKSHOP_SETUP_FAILED'));
    assert.ok(state.errors[0].includes('browser unavailable'));
    assert.deepStrictEqual(state.updates, []);
  });

  test('configuration update failures are reported and do not claim success', async () => {
    const state = loadWorkshop({ choices: ['APPLY_SETTINGS'], updateError: new Error('read-only settings') });
    await state.workshop.configure();
    assert.ok(state.errors[0].includes('LATEX_WORKSHOP_SETUP_FAILED'));
    assert.ok(state.errors[0].includes('read-only settings'));
    assert.ok(state.information.every(message => message.message !== 'LATEX_WORKSHOP_CONFIGURED'));
  });

  test('View PDF opens the actual downloaded artifact beside the editor', async () => {
    const state = loadWorkshop();
    await state.workshop.viewPDF('.workspace/main.pdf');
    assert.strictEqual(state.statUris[0].fsPath, '/workspace/paper/.workspace/main.pdf');
    assert.strictEqual(state.commands.length, 1);
    assert.strictEqual(state.commands[0].command, 'vscode.openWith');
    assert.strictEqual((state.commands[0].args[0] as TestUri).fsPath, '/workspace/paper/.workspace/main.pdf');
    assert.strictEqual(state.commands[0].args[1], 'latex-workshop-pdf-hook');
    assert.strictEqual(state.commands[0].args[2], -2);
  });

  test('PDF paths outside the workspace retain their resolved location', async () => {
    const state = loadWorkshop();
    await state.workshop.viewPDF('../build/main.pdf');
    assert.strictEqual(state.statUris[0].fsPath, '/workspace/build/main.pdf');
  });

  test('missing PDF, missing workspace and directories never open a viewer', async () => {
    const cases: [Options, string | undefined, string][] = [
      [{ installed: false }, undefined, 'PDF_NOT_FOUND'],
      [{ rootPath: null }, 'main.pdf', 'NO_WORKSPACE_ERROR'],
      [{ statError: new Error('ENOENT') }, 'main.pdf', 'PDF_NOT_FOUND'],
      [{ statType: 2 }, 'main.pdf', 'PDF_NOT_FOUND']
    ];
    for (const [options, pdfPath, warning] of cases) {
      const state = loadWorkshop(options);
      await state.workshop.viewPDF(pdfPath);
      assert.deepStrictEqual(state.warnings, [warning]);
      assert.deepStrictEqual(state.commands, []);
      assert.deepStrictEqual(state.externalUris, []);
    }
  });

  test('unknown artifact on an offline cold start preserves Workshop local PDF discovery', async () => {
    const state = loadWorkshop();
    await state.workshop.viewPDF();
    assert.deepStrictEqual(state.commands, [{ command: 'latex-workshop.view', args: [] }]);
    assert.deepStrictEqual(state.statUris, []);
    assert.deepStrictEqual(state.warnings, []);
    assert.deepStrictEqual(state.externalUris, []);
  });

  test('offline Workshop PDF discovery failures are reported', async () => {
    const state = loadWorkshop({ commandError: new Error('local PDF unavailable') });
    await state.workshop.viewPDF();
    assert.ok(state.errors[0].includes('PDF_OPEN_FAILED'));
    assert.ok(state.errors[0].includes('local PDF unavailable'));
  });

  test('PDF preview command rejections are reported', async () => {
    const state = loadWorkshop({ commandError: new Error('viewer unavailable') });
    await state.workshop.viewPDF('main.pdf');
    assert.ok(state.errors[0].includes('PDF_OPEN_FAILED'));
    assert.ok(state.errors[0].includes('viewer unavailable'));
  });

  test('missing Workshop allows an explicit external PDF fallback or cancellation', async () => {
    const canceled = loadWorkshop({ installed: false });
    await canceled.workshop.viewPDF('main.pdf');
    assert.deepStrictEqual(canceled.externalUris, []);

    const accepted = loadWorkshop({ installed: false, choices: ['OPEN_PDF_EXTERNALLY'] });
    await accepted.workshop.viewPDF('main.pdf');
    assert.strictEqual(accepted.externalUris[0].scheme, 'file');
    assert.strictEqual(accepted.externalUris[0].fsPath, '/workspace/paper/main.pdf');
    assert.deepStrictEqual(accepted.commands, []);
  });

  test('external PDF failures are reported for rejection and false return values', async () => {
    for (const options of [{ externalError: new Error('no PDF handler') }, { externalResult: false }]) {
      const state = loadWorkshop({ ...options, installed: false, choices: ['OPEN_PDF_EXTERNALLY'] });
      await state.workshop.viewPDF('main.pdf');
      assert.ok(state.errors[0].includes('PDF_OPEN_FAILED'));
    }
  });

  test('PDF fallback can open the Workshop marketplace instead', async () => {
    const state = loadWorkshop({ installed: false, choices: ['INSTALL_LATEX_WORKSHOP'] });
    await state.workshop.viewPDF('main.pdf');
    assert.strictEqual(state.externalUris[0].scheme, 'https');
    assert.deepStrictEqual(state.commands, []);
  });

  test('refresh awaits the Workshop command and exposes rejections to its caller', async () => {
    const missing = loadWorkshop({ installed: false });
    await missing.workshop.refreshViewer();
    assert.deepStrictEqual(missing.commands, []);

    const rejected = loadWorkshop({ commandError: new Error('refresh failed') });
    await assert.rejects(rejected.workshop.refreshViewer(), /refresh failed/);
    assert.strictEqual(rejected.commands[0].command, 'latex-workshop.refresh-viewer');
  });
});

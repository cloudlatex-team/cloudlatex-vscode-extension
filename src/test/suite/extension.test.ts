import * as assert from 'assert';
import * as vscode from 'vscode';
import TargetTreeProvider from '../../targetTreeProvider';
import { COMMAND_NAMES } from '../../const';

suite('LaTeX Workshop integration in VS Code', () => {
  test('setup and PDF commands are registered without an account', async function () {
    // A fresh extension host has to load the shared synchronization library.
    this.timeout(30000);
    assert.strictEqual(vscode.workspace.getConfiguration('cloudlatex').get('enabled'), false);
    const extension = vscode.extensions.getExtension('cloudlatex.cloudlatex');
    assert.ok(extension);
    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(COMMAND_NAMES.configureLatexWorkshop));
    assert.ok(commands.includes(COMMAND_NAMES.viewPDF));
    assert.ok(commands.includes(COMMAND_NAMES.connectProject));
  });

  test('setup is discoverable before connecting a project', async () => {
    const tree = new TargetTreeProvider({
      isWorkspace: true, activated: false, loginStatus: 'offline', projectName: null
    });
    const items = await tree.getChildren();
    assert.ok(items.some(item => item.command?.command === COMMAND_NAMES.configureLatexWorkshop));
    assert.ok(items.some(item => item.command?.command === COMMAND_NAMES.connectProject));
  });

  test('the connection entry is also available before opening a folder', async () => {
    const tree = new TargetTreeProvider({
      isWorkspace: false, activated: false, loginStatus: 'offline', projectName: null
    });
    const items = await tree.getChildren();
    assert.ok(items.some(item => item.command?.command === COMMAND_NAMES.connectProject));
  });

  test('the sidebar identifies the actual server, including localhost ports', async () => {
    const tree = new TargetTreeProvider({
      isWorkspace: true, activated: false, loginStatus: 'offline', projectName: null,
      endpointOrigin: 'http://localhost:3000'
    });
    const items = await tree.getChildren();
    assert.ok(items.some(item => item.label.includes('http://localhost:3000')));
  });

  test('an active project keeps PDF viewing available while offline', async () => {
    const tree = new TargetTreeProvider({
      isWorkspace: true, activated: true, loginStatus: 'offline', projectName: 'Local project'
    });
    const items = await tree.getChildren();
    assert.ok(items.some(item => item.command?.command === COMMAND_NAMES.viewPDF));
    assert.ok(!items.some(item => item.command?.command === COMMAND_NAMES.compile));
  });
});

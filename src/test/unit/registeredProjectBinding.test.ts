// Fixed API names and VS Code setting keys are intentionally not camelCase.
/* eslint-disable @typescript-eslint/naming-convention */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vm from 'vm';
import * as jsonc from 'jsonc-parser';
import type { RegisteredProject } from '../../registeredProjects';

type BindingModule = typeof import('../../registeredProjectBinding');

function loadBinding(): BindingModule {
  // Reuse the real endpoint normalizer without loading the VS Code runtime.
  const registry = { exports: {}, URL, require: (name: string) => {
      if (name === './locale' || name === '../locale') { return require('../../locale'); }
      if (name === './const') { return require('../../const'); }
    if (name === 'path') {
      return path;
    }
    if (name === 'vscode') {
      return {};
    }
    if (name === './interaction') {
      return { localeStr: (key: string) => key };
    }
    throw new Error(`Unexpected dependency: ${name}`);
  } };
  const registryFile = require.resolve('../../registeredProjects');
  vm.runInNewContext(fs.readFileSync(registryFile, 'utf8'), registry, { filename: registryFile });
  const binding = { exports: {}, Buffer, require: (name: string) => {
      if (name === './locale' || name === '../locale') { return require('../../locale'); }
      if (name === './const') { return require('../../const'); }
    if (name === 'fs') {
      return fs;
    }
    if (name === 'path') {
      return path;
    }
    if (name === 'jsonc-parser') {
      return jsonc;
    }
    if (name === './registeredProjects') {
      return registry.exports;
    }
    throw new Error(`Unexpected dependency: ${name}`);
  } };
  const bindingFile = require.resolve('../../registeredProjectBinding');
  vm.runInNewContext(fs.readFileSync(bindingFile, 'utf8'), binding, { filename: bindingFile });
  return binding.exports as BindingModule;
}

suite('Registered project folder binding', () => {
  let root: string;
  const { folderMatchesRegisteredProject } = loadBinding();
  const project = (overrides: Partial<RegisteredProject> = {}): RegisteredProject => ({
    id: 127, title: 'Local paper', endpoint: 'http://localhost:3000/api',
    rootPath: root, lastOpenedAt: 1, ...overrides
  });
  const write = async (content: string) => {
    await fs.promises.mkdir(path.join(root, '.vscode'), { recursive: true });
    await fs.promises.writeFile(path.join(root, '.vscode/settings.json'), content);
  };
  setup(async () => { root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cl-binding-')); });
  teardown(async () => { await fs.promises.rm(root, { recursive: true, force: true }); });

  test('reads JSONC comments and trailing commas without changing the settings file', async () => {
    const text = '{\n // Project chosen in VS Code\n "cloudlatex.projectId": 127,\n "cloudlatex.endpoint": "HTTP://LOCALHOST:3000/api///",\n}\n';
    await write(text);
    assert.strictEqual(await folderMatchesRegisteredProject(project()), true);
    assert.strictEqual(await fs.promises.readFile(path.join(root, '.vscode/settings.json'), 'utf8'), text);
  });

  test('project ID mismatch and string-valued IDs cannot open a stale binding', async () => {
    for (const id of [128, '127', null]) {
      await write(JSON.stringify({ 'cloudlatex.projectId': id, 'cloudlatex.endpoint': 'http://localhost:3000/api' }));
      assert.strictEqual(await folderMatchesRegisteredProject(project()), false);
    }
  });

  test('same project ID on another endpoint or API path is a different binding', async () => {
    for (const endpoint of ['https://cloudlatex.io/api', 'http://localhost:3001/api', 'http://localhost:3000/other-api']) {
      await write(JSON.stringify({ 'cloudlatex.projectId': 127, 'cloudlatex.endpoint': endpoint }));
      assert.strictEqual(await folderMatchesRegisteredProject(project()), false);
    }
  });

  test('missing workspace endpoint inherits the supplied global endpoint or the product default', async () => {
    await write('{ "cloudlatex.projectId": 127 }');
    assert.strictEqual(await folderMatchesRegisteredProject(project(), 'http://localhost:3000/api/'), true);
    assert.strictEqual(await folderMatchesRegisteredProject(project()), false);
    assert.strictEqual(await folderMatchesRegisteredProject(project({ endpoint: 'https://cloudlatex.io/api' })), true);
  });

  test('an explicit invalid endpoint never falls back to the global endpoint', async () => {
    for (const endpoint of [null, 0, '', 'https://user:password@cloudlatex.io/api', 'http://localhost:3000/api?token=secret']) {
      await write(JSON.stringify({ 'cloudlatex.projectId': 127, 'cloudlatex.endpoint': endpoint }));
      assert.strictEqual(await folderMatchesRegisteredProject(project(), 'http://localhost:3000/api'), false);
    }
  });

  test('missing, malformed, non-object and nested settings are not accepted', async () => {
    assert.strictEqual(await folderMatchesRegisteredProject(project()), false);
    for (const text of ['{', '{"cloudlatex.projectId":127,,}', '[]', 'null',
      '{"cloudlatex":{"projectId":127,"endpoint":"http://localhost:3000/api"}}', '{}']) {
      await write(text);
      assert.strictEqual(await folderMatchesRegisteredProject(project()), false);
    }
  });

  test('invalid or absent recorded folders and project IDs fail closed', async () => {
    await write('{ "cloudlatex.projectId": 127, "cloudlatex.endpoint": "http://localhost:3000/api" }');
    for (const record of [project({ rootPath: undefined }), project({ rootPath: 'relative/path' }),
      project({ rootPath: path.join(root, 'missing') }), project({ id: 0 }), project({ id: NaN }),
      project({ endpoint: 'ftp://localhost/api' })]) {
      assert.strictEqual(await folderMatchesRegisteredProject(record), false);
    }
  });

  test('refuses oversized settings and non-regular settings paths', async () => {
    await write(' '.repeat(1024 * 1024 + 1));
    assert.strictEqual(await folderMatchesRegisteredProject(project()), false);
    await fs.promises.unlink(path.join(root, '.vscode/settings.json'));
    await fs.promises.mkdir(path.join(root, '.vscode/settings.json'));
    assert.strictEqual(await folderMatchesRegisteredProject(project()), false);
  });

  test('does not follow a settings symlink outside the recorded root', async () => {
    const outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cl-binding-out-'));
    try {
      const target = path.join(outside, 'settings.json');
      await fs.promises.writeFile(target, '{ "cloudlatex.projectId":127,"cloudlatex.endpoint":"http://localhost:3000/api" }');
      await fs.promises.mkdir(path.join(root, '.vscode'));
      await fs.promises.symlink(target, path.join(root, '.vscode/settings.json'));
      assert.strictEqual(await folderMatchesRegisteredProject(project()), false);
      assert.strictEqual(await fs.promises.readFile(target, 'utf8'), '{ "cloudlatex.projectId":127,"cloudlatex.endpoint":"http://localhost:3000/api" }');
    } finally {
      await fs.promises.rm(outside, { recursive: true, force: true });
    }
  });

  test('does not follow a .vscode directory symlink outside the recorded root', async () => {
    const outside = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'cl-binding-out-'));
    try {
      await fs.promises.writeFile(path.join(outside, 'settings.json'), '{ "cloudlatex.projectId":127,"cloudlatex.endpoint":"http://localhost:3000/api" }');
      await fs.promises.symlink(outside, path.join(root, '.vscode'));
      assert.strictEqual(await folderMatchesRegisteredProject(project()), false);
    } finally {
      await fs.promises.rm(outside, { recursive: true, force: true });
    }
  });

  test('allows a settings symlink whose real target remains inside the recorded root', async () => {
    const target = path.join(root, 'editor-settings.json');
    await fs.promises.writeFile(target, '{ "cloudlatex.projectId":127,"cloudlatex.endpoint":"http://localhost:3000/api" }');
    await fs.promises.mkdir(path.join(root, '.vscode'));
    await fs.promises.symlink(target, path.join(root, '.vscode/settings.json'));
    assert.strictEqual(await folderMatchesRegisteredProject(project()), true);
  });
});

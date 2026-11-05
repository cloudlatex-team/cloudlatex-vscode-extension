import * as assert from 'assert';
import type { FileInfo } from 'cloudlatex-cli-plugin';
import { SyncDisplayState } from '../../syncDisplayState';

function file(overrides: Partial<FileInfo> = {}): FileInfo {
  return {
    id: 1, isFolder: false, relativePath: 'main.tex', url: '',
    localRevision: 'r1', remoteRevision: 'r1',
    localChange: 'no', remoteChange: 'create', changeLocation: 'remote',
    remoteId: 101, watcherSynced: true, ...overrides
  };
}

suite('Successful synchronization display baseline', () => {
  test('the actual successful download trace no longer appears pending', () => {
    const state = new SyncDisplayState();
    const source = file();
    state.settle([source]);
    const displayed = state.project([source])[0];
    assert.strictEqual(displayed.localChange, 'no');
    assert.strictEqual(displayed.remoteChange, 'no');
    assert.strictEqual(displayed.changeLocation, 'no');
    assert.strictEqual(source.remoteChange, 'create');
    assert.strictEqual(source.changeLocation, 'remote');
  });

  test('successful updates and resolved both-side flags are normalized for display', () => {
    for (const changeLocation of ['remote', 'both'] as const) {
      const state = new SyncDisplayState();
      const source = file({ remoteChange: 'update', changeLocation });
      state.settle([source]);
      const displayed = state.project([source])[0];
      assert.strictEqual(displayed.remoteChange, 'no');
      assert.strictEqual(displayed.changeLocation, 'no');
      assert.strictEqual(source.remoteChange, 'update');
      assert.strictEqual(source.changeLocation, changeLocation);
    }
  });

  test('subsequent local edits stay pending while settled remote flags are hidden', () => {
    for (const localChange of ['create', 'update', 'delete'] as const) {
      const state = new SyncDisplayState();
      const source = file();
      state.settle([source]);
      const changed = { ...source, localChange };
      const displayed = state.project([changed])[0];
      assert.strictEqual(displayed.localChange, localChange);
      assert.strictEqual(displayed.remoteChange, 'no');
      assert.strictEqual(displayed.changeLocation, 'local');
      assert.strictEqual(changed.remoteChange, 'create');
      assert.strictEqual(changed.changeLocation, 'remote');
    }
  });

  test('new remote revisions are never cleared by an older success baseline', () => {
    const state = new SyncDisplayState();
    const source = file();
    state.settle([source]);
    const changed = file({ remoteRevision: 'r2', remoteChange: 'update' });
    const displayed = state.project([changed])[0];
    assert.deepStrictEqual(displayed, changed);
    assert.strictEqual(displayed.remoteChange, 'update');
    assert.strictEqual(displayed.changeLocation, 'remote');
  });

  test('genuine remote deletion and new conflict flags survive even with equal revisions', () => {
    const state = new SyncDisplayState();
    state.settle([file()]);
    for (const changed of [
      file({ remoteChange: 'delete' }),
      file({ changeLocation: 'both', localChange: 'update' })
    ]) {
      assert.deepStrictEqual(state.project([changed])[0], changed);
    }
  });

  test('failed operations without a successful settle keep remote work visible', () => {
    const state = new SyncDisplayState();
    const failedDownload = file();
    assert.deepStrictEqual(state.project([failedDownload])[0], failedDownload);
    state.settle([file()]);
    const failedLaterDownload = file({ remoteRevision: 'r2', remoteChange: 'update' });
    // A failed sync does not call settle and cannot replace the known baseline.
    assert.deepStrictEqual(state.project([failedLaterDownload])[0], failedLaterDownload);
  });

  test('files with outstanding local work are not recorded as successfully settled', () => {
    const state = new SyncDisplayState();
    const pending = file({ localChange: 'update', remoteChange: 'update', changeLocation: 'both' });
    state.settle([pending]);
    assert.deepStrictEqual(state.project([pending])[0], pending);
  });

  test('baseline matching is scoped to each file ID', () => {
    const state = new SyncDisplayState();
    const settled = file();
    const other = file({ id: 2, relativePath: 'references.bib' });
    state.settle([settled]);
    const projected = state.project([settled, other]);
    assert.strictEqual(projected[0].remoteChange, 'no');
    assert.deepStrictEqual(projected[1], other);
  });

  test('each successful snapshot drops removed or no-longer-settled file baselines', () => {
    const state = new SyncDisplayState();
    const previous = file();
    const next = file({ id: 2, relativePath: 'next.tex' });
    state.settle([previous]);
    state.settle([next]);
    const projected = state.project([previous, next]);
    assert.deepStrictEqual(projected[0], previous);
    assert.strictEqual(projected[1].remoteChange, 'no');
    const pending = { ...next, localChange: 'update' as const };
    state.settle([pending]);
    assert.deepStrictEqual(state.project([pending])[0], pending);
  });

  test('configuration reset restores the raw flags until the new project sync succeeds', () => {
    const state = new SyncDisplayState();
    const source = file();
    state.settle([source]);
    state.reset();
    assert.deepStrictEqual(state.project([source])[0], source);
  });

  test('projection always clones its input and never mutates core repository records', () => {
    const state = new SyncDisplayState();
    const source = Object.freeze(file());
    const input = [source];
    state.settle(input);
    const projected = state.project(input);
    assert.notStrictEqual(projected, input);
    assert.notStrictEqual(projected[0], source);
    projected[0].relativePath = 'display-only.tex';
    assert.strictEqual(source.relativePath, 'main.tex');
    assert.strictEqual(source.remoteChange, 'create');
    const raw = new SyncDisplayState().project(input);
    assert.notStrictEqual(raw[0], source);
  });
});

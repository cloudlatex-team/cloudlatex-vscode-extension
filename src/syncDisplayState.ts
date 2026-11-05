import type { FileInfo } from 'cloudlatex-cli-plugin';

function signature(file: FileInfo): string {
  return JSON.stringify([file.localRevision, file.remoteRevision, file.remoteChange, file.changeLocation]);
}

// The pinned sync library can retain its applied remote flags after a successful
// download. Normalize only the display snapshot that is known to have settled.
export class SyncDisplayState {
  private settled = new Map<number, string>();

  settle(files: FileInfo[]): void {
    const baseline = new Map<number, string>();
    for (const file of files) {
      if (file.localChange === 'no') {
        baseline.set(file.id, signature(file));
      }
    }
    this.settled = baseline;
  }

  project(files: FileInfo[]): FileInfo[] {
    return files.map(file => {
      const displayed = { ...file };
      if (this.settled.get(file.id) === signature(file)) {
        displayed.remoteChange = 'no';
        displayed.changeLocation = file.localChange === 'no' ? 'no' : 'local';
      }
      return displayed;
    });
  }

  reset(): void {
    this.settled.clear();
  }
}

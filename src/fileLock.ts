import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createHash, randomBytes } from 'crypto';

const host = createHash('sha256').update(os.hostname()).digest('hex').slice(0, 16);
const ownerPattern = /^([a-f0-9]{16})-([1-9][0-9]*)-[a-f0-9]{32}$/;

async function removeEmptyDirectory(directory: string): Promise<void> {
  try {
    await fs.promises.rmdir(directory);
  } catch (error) {
    if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes((error as NodeJS.ErrnoException).code || '')) {
      throw error;
    }
  }
}

async function claimLock(lockPath: string): Promise<(() => Promise<void>) | undefined> {
  try {
    await fs.promises.mkdir(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Invalid file lock');
  }
  const owner = `${host}-${process.pid}-${randomBytes(16).toString('hex')}`;
  const ownerPath = path.join(lockPath, owner);
  try {
    await fs.promises.mkdir(ownerPath);
  } catch (error) {
    // A releasing owner may have removed an empty lock directory first.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  }
  const release = async () => {
    await removeEmptyDirectory(ownerPath);
    await removeEmptyDirectory(lockPath);
  };
  let claimed = false;
  try {
    for (const entry of await fs.promises.readdir(lockPath)) {
      if (entry === owner) {
        continue;
      }
      const match = ownerPattern.exec(entry);
      if (!match || match[1] !== host) {
        continue;
      }
      const pid = Number(match[2]);
      if (!Number.isSafeInteger(pid)) {
        continue;
      }
      try {
        process.kill(pid, 0);
      } catch (error) {
        // Time alone cannot prove an owner has stopped using the protected file.
        // Only reclaim a known-dead process on this host; leave other owners alone.
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') {
          await removeEmptyDirectory(path.join(lockPath, entry));
        }
      }
    }
    const owners = await fs.promises.readdir(lockPath);
    if (owners.length === 1 && owners[0] === owner) {
      claimed = true;
      return release;
    }
    return undefined;
  } finally {
    if (!claimed) {
      await release();
    }
  }
}

// A live owner's unique child keeps the lock directory nonempty. Contenders
// remove only their own child or one owned by a known-dead local process, so
// stale cleanup cannot delete a newly acquired lock at the same path.
export async function withFileLock<T>(lockPath: string, task: () => Promise<T>, timeout = 10000): Promise<T> {
  const parent = path.dirname(lockPath);
  await fs.promises.mkdir(parent, { recursive: true });
  const parentStat = await fs.promises.lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error('Invalid file lock directory');
  }
  const deadline = Date.now() + timeout;
  while (true) {
    const release = await claimLock(lockPath);
    if (release) {
      try {
        return await task();
      } finally {
        await release();
      }
    }
    if (Date.now() >= deadline) {
      throw new Error('File is locked by another process');
    }
    await new Promise(resolve => setTimeout(resolve, 25 + Math.floor(Math.random() * 25)));
  }
}

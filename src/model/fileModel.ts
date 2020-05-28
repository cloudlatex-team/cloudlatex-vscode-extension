import { ChangeState, ChangeLocation } from '../types';
import {TypeDB, Repository} from 'type-db';

export const FileInfoDesc = {
  name: 'FileInfo',
  columns: {
    id: 0,
    isFolder: false,
    relativePath: '',
    url: '',
    revision: ('' as string | number),
    localChange: ('no' as ChangeState),
    remoteChange: ('no' as ChangeState),
    changeLocation: ('no' as ChangeLocation),
    remoteId: (null as string | number | null),
    watcherSynced: false
  },
  primaryKey: 'id',
  indexColumns: ['remoteId'],
  autoIncrement: true
};

export type FileRepository = Repository<typeof FileInfoDesc>;
export type FileInfo = typeof FileInfoDesc['columns'];

async function test() {
  const db = new TypeDB('path');
  await db.load();
  const files = db.getRepository(FileInfoDesc);

  files.find(1);
  const file = files.new();
  file.isFolder = false;
  await db.save();
}

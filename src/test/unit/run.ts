import * as fs from 'fs';
import * as path from 'path';
import * as Mocha from 'mocha';

const mocha = new Mocha({ ui: 'tdd', color: true });
for (const file of fs.readdirSync(__dirname).filter(file => file.endsWith('.test.js'))) {
  mocha.addFile(path.join(__dirname, file));
}
mocha.run(failures => {
  process.exitCode = failures > 0 ? 1 : 0;
});

import * as fs from 'fs';
import * as vscode from 'vscode';

type Config = {
  projectId: string;
  initialized: boolean;
};

export default class ConfigManager<ConfigType extends Object> {

  private filePath: string;
  public config: ConfigType;
  constructor() {
    this.filePath = vscode.workspace.rootPath + '/.vswpp.json';
    this.config = {} as ConfigType;
  }

  public get<Key extends keyof ConfigType>(name: Key): ConfigType[Key] {
    return this.config[name];
  }

  public set<Key extends keyof ConfigType>(name: Key, value: ConfigType[Key]) {
    this.config[name] = value;
  }

  public load(): Promise<ConfigType> {
    return new Promise((resolve, reject) => {
      fs.readFile(this.filePath, 'utf-8', (err, content) => {
        if(err) {
          return reject(err);
        }
        try {
          const config = JSON.parse(content);
          this.config = config;
          resolve(config);
        } catch(err) {
          return reject(err);
        }
      });
    });
  }

  public save() {
    return new Promise((resolve, reject) => {
      fs.writeFile(this.filePath, JSON.stringify(this.config), (err) => {
        if(err) {
          return reject(err);
        }
        resolve();
      });
    });
  }
}
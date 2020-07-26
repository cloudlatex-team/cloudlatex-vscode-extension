import * as fs from 'fs';

export default class AccountManager<Account> {
  private _account: Account | null = null;
  constructor(private savePath: string) {

  }

  public save(account: Account) {
    this._account = account;
    return fs.promises.writeFile(this.savePath, JSON.stringify(account));
  }

  public async load() {
    try {
      this._account = JSON.parse(await fs.promises.readFile(this.savePath, 'utf-8'));
    } catch (e) {
      return null;
    }
    return this._account;
  }

  public get account(): Account | null {
    return this._account;
  }
}
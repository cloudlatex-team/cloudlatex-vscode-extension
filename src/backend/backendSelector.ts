
import baseFileAdapter from './../fileManage/baseFileAdapter';
import ClFileAdapter from './cloudlatex/clFileAdapter';
import {FileRepository} from './../model/fileModel';
import ClAPI from './cloudlatex/webAppApi';
import {Config, WebAppApi} from './../types';
import Logger from '../logger';
import CLWebAppApi from './cloudlatex/webAppApi';

export default class BackendSelector {
  public api: WebAppApi;
  constructor(private config: Config) {
    this.api = this.getApi(); 
  }

  public instantiateFileAdapter(rootPath: string, files: FileRepository, logger: Logger): baseFileAdapter {
    if(this.config.backend === 'cloudlatex') {
      return new ClFileAdapter(rootPath, files, this.api as CLWebAppApi, logger);
    } else {
      throw new Error('Unknown backend detected: ' + this.config.backend);
    }
  }

  private getApi(): WebAppApi {
    if(this.config.backend === 'cloudlatex') {
      return new ClAPI(this.config);
    } else {
      throw new Error('Unknown backend detected: ' + this.config.backend);
    }
  }
}
import * as vscode from 'vscode';
import fetch from 'node-fetch';
import Browser from './browser';
const { inlineSource } = require('inline-source');

export default class AppContent {
  private panel: vscode.WebviewPanel | null;
  constructor(){
    this.panel = null;
  }

  public async create() {
    let browser = new Browser();
    browser.launch();
    this.panel = vscode.window.createWebviewPanel(
      'web-app', // Identifies the type of the webview. Used internally
      'Web app', // Title of the panel displayed to the user
      vscode.ViewColumn.One, // Editor column to show the new webview panel in.
      {
        enableScripts: true,
        retainContextWhenHidden: true
      } // Webview options. More on these later.
    );
    this.panel.webview.html =  await this.getContent();
  }

  private async getContent() {
    /*return Promise.resolve(`
    <html>
    <body>
    <iframe src="https://cloudlatex.io/" width="100%" height="400px">
    </iframe>
    </body>
    </html>
    `);*/
    let html = await fetch('https://cloudlatex.io/').then((res: { text: () => any; }) => res.text());
    html = await inlineSource(html, {});
    // console.log(html);
    return html;
  }
}

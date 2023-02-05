import * as vscode from 'vscode';

const extensionId = 'james-yu.latex-workshop';
const viewPDFCommand = 'latex-workshop.view';
const refreshPDFViewerCommand = 'latex-workshop.refresh-viewer';

export function checkInstalled () {
  const extension = vscode.extensions.getExtension(extensionId);
  return extension !== undefined;
}

export function refreshViewer () {
  if (!checkInstalled()) {
    return;
  }
  try {
    vscode.commands.executeCommand(refreshPDFViewerCommand);
  } catch (e) { // no latexworkshop?
  }
}

export function viewPDF () {
  if (!checkInstalled()) {
    return;
  }
  try {
    vscode.commands.executeCommand(viewPDFCommand);
  } catch (e) { // no latexworkshop?
  }
}
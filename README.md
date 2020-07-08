# Visual Studio Code LaTeX Cloud Application Extension
*** Write locally and compile on cloud service.

LaTeX Cloud is an extension for Visual Studio Code to write tex locally with latex cloud services such as CloudLatex or Overleaf.


## Features
- Cloud Services
  - Cloudlatex

- Sync files
- Auto build

## Usage
### Setting

settings.json
```settings.json
{
  "latex-workshop.latex.autoBuild.run": "never",
  "latex-workshop.latex.outDir": "./.workspace",
  "cloudlatex.email": "Your email address",
  "cloudlatex.client": "Your client id",
  "cloudlatex.token": "Your token",
  "cloudlatex.projectId": [Your Project id],
  "cloudlatex.enabled": true,
}
```

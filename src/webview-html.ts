import * as vscode from "vscode";
import { randomBytes } from "crypto";

/**
 * @returns nonce for webview CSP
 */
export function getNonce(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Samples panel document (CSP + markup). Script/style URIs come from `asWebviewUri`.
 */
export function buildSamplesWebviewHtml(
  webview: vscode.Webview,
  scriptUri: vscode.Uri,
  styleUri: vscode.Uri,
  codiconUri: vscode.Uri,
  nonce: string,
): string {
  const cspFull = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `font-src ${webview.cspSource}`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${cspFull}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${codiconUri}" rel="stylesheet" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>CP Helper</title>
</head>
<body>
  <section class="import" aria-label="Import testcases">
    <div class="import__identity">
      <span
        id="importProblemTitle"
        class="import-problem-title import-problem-title--empty"
        role="status"
        aria-live="polite"
        aria-label="Active problem"
      >No problem imported</span>
      <span id="activeSourceWrap" class="active-source-wrap meta-chip">
        <span class="codicon codicon-file-code meta-chip__icon" aria-hidden="true"></span>
        <span id="activeSourceLabel" class="active-source-label" title="" role="status" aria-live="polite" aria-label="Active file for Run">No file</span>
      </span>
    </div>
    <div id="importActions" class="import__actions">
      <div class="btn-row__cluster" role="group" aria-label="Import actions">
        <button id="btnToggleJson" type="button" class="btn-secondary btn-icon" title="Show the JSON paste box" aria-label="Paste JSON" aria-expanded="false" aria-controls="import-json"><span class="codicon codicon-json" aria-hidden="true"></span></button>
        <button id="btnLoad" type="button" class="btn-icon" title="Add the problems in the JSON above to the list" aria-label="Load"><span class="codicon codicon-desktop-download" aria-hidden="true"></span></button>
        <button id="btnAddProblem" type="button" class="btn-secondary btn-icon" title="Add a custom problem (one empty testcase)" aria-label="Custom problem"><span class="codicon codicon-add" aria-hidden="true"></span></button>
        <span class="btn-sep" aria-hidden="true"></span>
        <button id="btnStopRun" type="button" class="btn-secondary btn-stop btn-icon" hidden title="Stop compile or run" aria-label="Stop"><span class="codicon codicon-debug-stop" aria-hidden="true"></span></button>
        <button id="btnClear" type="button" class="btn-secondary btn-icon" title="Remove every problem from the list" aria-label="Clear"><span class="codicon codicon-clear-all" aria-hidden="true"></span></button>
        <button id="btnExport" type="button" class="btn-secondary btn-icon" title="Write all cases to testcases/sample_N.{in,out}.txt (replaces existing sample files)" aria-label="Export"><span class="codicon codicon-export" aria-hidden="true"></span></button>
      </div>
      <div id="runnerHint" class="runner-hint meta-chip" hidden role="status" aria-live="polite">
        <span class="codicon codicon-tools meta-chip__icon" aria-hidden="true"></span>
        <span class="runner-hint__value"></span>
      </div>
    </div>
    <textarea id="import-json" spellcheck="false" hidden placeholder='Paste JSON here, then click Load&#10;[{ "sample": 1, "input": "...", "output": "..." }]' aria-label="Testcases JSON"></textarea>
  </section>

  <div id="err" class="err" hidden role="alert"></div>

  <section class="cases-section" aria-labelledby="casesHeading">
  <h2 class="cases-heading" id="casesHeading">Test cases</h2>
  <p id="list-empty" class="list-empty">No test cases yet.<br>Open the <strong>JSON box</strong> and click <strong>Load</strong>, use <strong>OJ Sync</strong> from your browser,<br>or add a <strong>custom problem</strong> from the toolbar.</p>
  <ul id="list" class="list"></ul>
  </section>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

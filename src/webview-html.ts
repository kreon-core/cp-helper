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
  nonce: string,
): string {
  const cspFull = [
    `default-src 'none'`,
    `style-src ${webview.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join("; ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${cspFull}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${styleUri}" rel="stylesheet" />
  <title>CP Helper</title>
</head>
<body>
  <section class="panel" aria-label="Import testcases">
    <div class="import-panel-head">
      <h2 class="section-title import-panel-head__title">IMPORT</h2>
      <span
        id="importProblemTitle"
        class="import-problem-title"
        hidden
        role="status"
        aria-live="polite"
      ></span>
      <div id="runnerHint" class="runner-hint" hidden role="status" aria-live="polite">
        <span class="runner-hint__value"></span>
      </div>
    </div>
    <textarea id="import-json" spellcheck="false" placeholder='Paste JSON here, then click Load ↓&#10;[{ "sample": 1, "input": "…", "output": "…" }]' aria-label="Testcases JSON"></textarea>
    <div class="btn-row btn-row--import">
      <div class="btn-row__cluster" role="group" aria-label="Import actions">
        <button id="btnLoad" type="button" class="btn-icon" title="Replace samples with the JSON above" aria-label="Load"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 2v8M4 7l4 4 4-4M2 14h12"/></svg></button>
        <button id="btnRunAll" type="button" class="btn-primary btn-icon" disabled title="Compile once (if configured), then run every sample" aria-label="Run all"><svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true" focusable="false"><path d="M1 2l7 6-7 6V2zm8 0l7 6-7 6V2z"/></svg></button>
        <span
          id="runAllPassedSummary"
          class="run-all-passed-summary"
          hidden
          role="status"
          aria-live="polite"
          title=""
        ></span>
        <button id="btnClear" type="button" class="btn-secondary btn-icon" title="Remove all samples from the list" aria-label="Clear"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M5 2h6M2 5h12M4 5l1 8h6l1-8"/></svg></button>
        <button id="btnExport" type="button" class="btn-secondary btn-icon" title="Write all cases to testcases/sample_N.{in,out}" aria-label="Export"><svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M8 11V2M4 6l4-4 4 4M2 14h12"/></svg></button>
        <span id="run-status" class="run-status" hidden>
          <span class="run-status-spinner" aria-hidden="true"></span>
          <span id="run-status-label" class="run-status-label"></span>
        </span>
        <button id="btnStopRun" type="button" class="btn-secondary btn-stop btn-icon" hidden title="Stop compile or run" aria-label="Stop"><svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true" focusable="false"><path d="M3 3h10v10H3z"/></svg></button>
      </div>
      <div class="btn-row__source" role="group" aria-label="Run target file">
      <span class="active-source-wrap">
        <span id="activeSourceLabel" class="active-source-label" title="" role="status" aria-live="polite" aria-label="Active file for Run">No file</span>
        <button id="btnToggleLocal" type="button" class="btn-debug-local" title="" aria-pressed="false" aria-label="Toggle -DLOCAL for compile">
          <!-- VS Code Codicons "debug" (MIT): https://github.com/microsoft/vscode-codicons -->
          <svg class="btn-debug-local__icon" width="12" height="12" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="currentColor" aria-hidden="true" focusable="false">
            <path d="M21.75 12H19.5V9C19.5 8.445 19.347 7.9245 19.083 7.4775L20.7795 5.781C21.072 5.4885 21.072 5.013 20.7795 4.7205C20.487 4.428 20.0115 4.428 19.719 4.7205L18.0225 6.417C17.5755 6.153 17.055 6 16.5 6C16.5 3.519 14.481 1.5 12 1.5C9.519 1.5 7.5 3.519 7.5 6C6.945 6 6.4245 6.153 5.9775 6.417L4.281 4.7205C3.9885 4.428 3.513 4.428 3.2205 4.7205C2.928 5.013 2.928 5.4885 3.2205 5.781L4.917 7.4775C4.653 7.9245 4.5 8.445 4.5 9V12H2.25C1.836 12 1.5 12.336 1.5 12.75C1.5 13.164 1.836 13.5 2.25 13.5H4.5C4.5 15.2985 5.136 16.95 6.195 18.2445L3.594 20.8455C3.3015 21.138 3.3015 21.6135 3.594 21.906C3.741 22.053 3.933 22.125 4.125 22.125C4.317 22.125 4.509 22.0515 4.656 21.906L7.257 19.305C8.55 20.364 10.203 21 12.0015 21C13.8 21 15.4515 20.364 16.746 19.305L19.347 21.906C19.494 22.053 19.686 22.125 19.878 22.125C20.07 22.125 20.262 22.0515 20.409 21.906C20.7015 21.6135 20.7015 21.138 20.409 20.8455L17.808 18.2445C18.867 16.9515 19.503 15.2985 19.503 13.5H21.753C22.167 13.5 22.503 13.164 22.503 12.75C22.503 12.336 22.167 12 21.753 12H21.75ZM12 3C13.6545 3 15 4.3455 15 6H9C9 4.3455 10.3455 3 12 3ZM18 13.5C18 16.809 15.309 19.5 12 19.5C8.691 19.5 6 16.809 6 13.5V9C6 8.172 6.672 7.5 7.5 7.5H16.5C17.328 7.5 18 8.172 18 9V13.5ZM14.781 11.031L13.062 12.75L14.781 14.469C15.0735 14.7615 15.0735 15.237 14.781 15.5295C14.634 15.6765 14.442 15.7485 14.25 15.7485C14.058 15.7485 13.866 15.675 13.719 15.5295L12 13.8105L10.281 15.5295C10.134 15.6765 9.942 15.7485 9.75 15.7485C9.558 15.7485 9.366 15.675 9.219 15.5295C8.9265 15.237 8.9265 14.7615 9.219 14.469L10.938 12.75L9.219 11.031C8.9265 10.7385 8.9265 10.263 9.219 9.9705C9.5115 9.678 9.987 9.678 10.2795 9.9705L11.9985 11.6895L13.7175 9.9705C14.01 9.678 14.4855 9.678 14.778 9.9705C15.0705 10.263 15.0705 10.7385 14.778 11.031H14.781Z"/>
          </svg>
        </button>
      </span>
      </div>
    </div>
  </section>

  <div id="err" class="err" hidden role="alert"></div>

  <section class="cases-section" aria-labelledby="casesHeading">
  <h2 class="cases-heading" id="casesHeading">Test cases</h2>
  <p id="list-empty" class="list-empty">No test cases yet.<br>Paste JSON and click <strong>Load</strong>, use <strong>OJ Sync</strong> from your browser,<br>or add a <strong>custom group</strong> below.</p>
  <ul id="list" class="list"></ul>
  </section>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

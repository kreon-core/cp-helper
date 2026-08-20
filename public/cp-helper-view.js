(function () {
  const vscode = acquireVsCodeApi();

  /** @type {{ id: string; label: string; cases: { sample: number; input: string; output: string }[] }[]} */
  let groups = [];

  /** @type {Record<string, { verdict: string; badge: string; stdout: string; stderr: string; elapsedMs?: number }>} */
  const lastRun = {};

  /** Per-group Run all summary: key = group index string. */
  const lastRunAllSummaryByGroup = {};

  /** Collapsed problem groups: key = `CaseGroup.id`, value true = collapsed (`setState` while session lasts). */
  /** @type {Record<string, boolean>} */
  let groupCollapsed = {};

  /** @type {{ active: boolean; mode: "one" | "all" | null; phase: "compile" | "run" | null; groupIndex: number | null; index: number | null; total: number | null }} */
  let runState = {
    active: false,
    mode: null,
    phase: null,
    groupIndex: null,
    index: null,
    total: null,
  };

  /**
   * Groups whose case indices changed while a run was in flight. The host keys results by the
   * index it captured at run start, so those are dropped until the next run for that group.
   * @type {Set<number>}
   */
  const staleResultGroups = new Set();

  /** Workspace: add `-DLOCAL` after the compiler in `compileCommand` when true. */
  let defineLocal = false;

  const $ = (id) => {
    const el = document.getElementById(id);
    if (!el) throw new Error("missing #" + id);
    return el;
  };

  const _CODICONS = {
    play: "play",
    runAll: "run-all",
    trash: "trash",
    add: "add",
    close: "close",
    copy: "copy",
    debug: "debug-alt",
  };

  /**
   * @param {keyof typeof _CODICONS} type
   * @returns {HTMLSpanElement}
   */
  function mkIcon(type) {
    const el = document.createElement("span");
    el.className = `codicon codicon-${_CODICONS[type]}`;
    el.setAttribute("aria-hidden", "true");
    return el;
  }

  const jsonEl = $("import-json");
  const btnToggleJson = $("btnToggleJson");
  const btnLoad = $("btnLoad");
  const btnRunAll = $("btnRunAll");
  const runAllPassedSummaryEl = $("runAllPassedSummary");
  const btnClear = $("btnClear");
  const btnExport = $("btnExport");
  const btnStopRun = $("btnStopRun");
  const runStatusEl = $("run-status");
  const runStatusLabel = $("run-status-label");
  const errEl = $("err");
  const listEl = $("list");
  const listEmptyEl = $("list-empty");
  const activeSourceLabelEl = $("activeSourceLabel");
  const btnToggleLocal = $("btnToggleLocal");
  const runnerHintEl = $("runnerHint");
  const runnerHintValueEl = runnerHintEl.querySelector(".runner-hint__value");
  if (!runnerHintValueEl) throw new Error("missing .runner-hint__value");
  const importProblemTitleEl = $("importProblemTitle");
  /** @type {{ label: string; compile: string; run: string }} */
  let runnerInfo = { label: "", compile: "", run: "" };
  const importActionsEl = $("importActions");
  const importSectionEl = importActionsEl.closest(".import");
  if (!(importSectionEl instanceof HTMLElement)) throw new Error("missing .import");
  const actionClusterEl = importActionsEl.querySelector(".btn-row__cluster");
  if (!actionClusterEl) throw new Error("missing .btn-row__cluster");

  // Register ASAP so host `postMessage` (e.g. cpHelper.runFirstSample right after reveal) is not
  // dropped while the rest of this script still runs. Handler functions are hoisted in this IIFE.
  window.addEventListener("message", onMessage);

  /**
   * View-only: strip trailing line breaks (assertion uses raw strings from the extension).
   * @param {string} s
   */
  function trimTrailingNewlines(s) {
    return String(s ?? "").replace(/(?:\r\n|\n|\r)+$/u, "");
  }

  /**
   * Strip ANSI escapes (SGR colors, clear line, etc.); textarea cannot render them.
   * @param {string} s
   */
  function stripAnsi(s) {
    let t = String(s ?? "");
    t = t.replace(/\u001b\[[\d;]*[A-Za-z]/g, "");
    t = t.replace(/\u001b\][^\u0007]*\u0007/g, "");
    return t;
  }

  /**
   * @param {string} s
   */
  function streamDisplay(s) {
    return trimTrailingNewlines(stripAnsi(s));
  }

  /**
   * Format elapsed milliseconds as a compact string: "234ms" under 1 s, "1.23s" at or above.
   * @param {number | undefined} ms
   * @returns {string}
   */
  function formatElapsed(ms) {
    if (ms == null) return "";
    if (ms < 1000) return ` ${ms}ms`;
    return ` ${(ms / 1000).toFixed(2)}s`;
  }

  /** @returns {number} */
  function maxFieldHeight() {
    return Math.min(400, Math.floor(window.innerHeight * 0.48));
  }

  /** @returns {number} */
  function maxJsonHeight() {
    return Math.min(180, Math.floor(window.innerHeight * 0.28));
  }

  /** Cap for readonly stdout/stderr auto-height (IPC-limited text; avoids unbounded layout). */
  function maxStdoutReadonlyHeight() {
    return Math.min(280, Math.floor(window.innerHeight * 0.36));
  }

  /**
   * @param {HTMLElement} ta editable field or read-only `pre`
   * @param {number} capPx
   */
  function fitTextarea(ta, capPx) {
    const minH = 32;
    ta.style.height = "auto";
    const target = Math.max(minH, Math.min(ta.scrollHeight, capPx));
    ta.style.height = `${target}px`;
    ta.style.overflowY = ta.scrollHeight > capPx ? "auto" : "hidden";
  }

  /**
   * @param {HTMLTextAreaElement} ta
   */
  function fitJsonTextarea(ta) {
    const minH = 44;
    ta.style.height = "auto";
    const cap = maxJsonHeight();
    const target = Math.max(minH, Math.min(ta.scrollHeight, cap));
    ta.style.height = `${target}px`;
    ta.style.overflowY = ta.scrollHeight > cap ? "auto" : "hidden";
  }

  /**
   * @param {HTMLTextAreaElement} ta
   */
  function fitFieldTextarea(ta) {
    fitTextarea(ta, maxFieldHeight());
    scheduleEqualizeResultColumns();
  }

  /**
   * Sizes readonly stdout or stderr to content up to `maxStdoutReadonlyHeight`.
   * @param {HTMLElement} ta
   */
  function fitStdoutReadonly(ta) {
    fitTextarea(ta, maxStdoutReadonlyHeight());
    scheduleEqualizeResultColumns();
  }

  let equalizeQueued = false;
  let equalizing = false;

  /** Batches one equalize pass per frame; re-entrant calls from the pass itself are ignored. */
  function scheduleEqualizeResultColumns() {
    if (equalizeQueued || equalizing) {
      return;
    }
    equalizeQueued = true;
    requestAnimationFrame(() => {
      equalizeQueued = false;
      equalizing = true;
      try {
        equalizeResultColumns();
      } finally {
        equalizing = false;
      }
    });
  }

  /**
   * Expected and stdout share the grid row, so they must share a height or the comparison reads
   * as broken. Input spans its own full-width row above and keeps its own fitted height, as does
   * every field once the layout stacks below the breakpoint.
   */
  function equalizeResultColumns() {
    const sideBySide = window.matchMedia("(min-width: 560px)").matches;
    /** @type {{ ta: HTMLElement; cap: number }[][]} */
    const rows = [];
    document.querySelectorAll(".case-body").forEach((body) => {
      const fields = [
        {
          ta: body.querySelector(
            ".field:nth-child(1) textarea.input-area--sample",
          ),
          cap: maxFieldHeight(),
          inRow: false,
        },
        {
          ta: body.querySelector(
            ".field:nth-child(2) textarea.input-area--sample",
          ),
          cap: maxFieldHeight(),
          inRow: true,
        },
        {
          ta: body.querySelector(
            ".field--stdout .input-area--stream-stdout",
          ),
          cap: maxStdoutReadonlyHeight(),
          inRow: true,
        },
      ].filter((f) => f.ta instanceof HTMLElement);

      const row = sideBySide ? fields.filter((f) => f.inRow) : [];
      // A lone field has nothing to match, so fit it to its own content instead.
      if (row.length < 2) {
        for (const f of fields) {
          fitTextarea(f.ta, f.cap);
        }
        return;
      }
      for (const f of fields) {
        if (!row.includes(f)) {
          fitTextarea(f.ta, f.cap);
        }
      }
      rows.push(row);
    });
    if (rows.length === 0) {
      return;
    }
    // Write, then read, then write: one reflow for the batch instead of one per case.
    for (const row of rows) {
      for (const f of row) {
        f.ta.style.height = "auto";
      }
    }
    const measured = rows.map((row) => row.map((f) => f.ta.scrollHeight));
    rows.forEach((row, i) => {
      const cap = Math.min(...row.map((f) => f.cap));
      const target = Math.max(32, Math.min(cap, Math.max(...measured[i])));
      row.forEach((f, j) => {
        f.ta.style.height = `${target}px`;
        f.ta.style.overflowY = measured[i][j] > target ? "auto" : "hidden";
      });
    });
  }

  /**
   * The element whose next scroll event is an echo of a mirrored scroll, not a user action.
   * Also cleared on the next frame, in case the assignment clamped and fired no event at all.
   */
  let scrollSyncEcho = null;

  /**
   * Expected and stdout scroll together while they sit side by side: comparing line 40 of one
   * against line 40 of the other is the whole point of the two-column layout.
   * `scroll` does not bubble, so this listens in the capture phase.
   * @param {Event} e
   */
  function onFieldScroll(e) {
    const src = e.target;
    if (!(src instanceof HTMLElement)) {
      return;
    }
    if (src === scrollSyncEcho) {
      scrollSyncEcho = null;
      return;
    }
    const expected = src.classList.contains("input-area--sample");
    const stdout = src.classList.contains("input-area--stream-stdout");
    if (!expected && !stdout) {
      return;
    }
    if (!window.matchMedia("(min-width: 560px)").matches) {
      return;
    }
    const body = src.closest(".case-body");
    if (!body) {
      return;
    }
    // Only the expected field pairs with stdout; the input field scrolls on its own.
    if (expected && src.closest(".field") !== body.children[1]) {
      return;
    }
    const partner = expected
      ? body.querySelector(".field--stdout .input-area--stream-stdout")
      : body.querySelector(".field:nth-child(2) textarea.input-area--sample");
    if (!(partner instanceof HTMLElement)) {
      return;
    }
    const { scrollTop, scrollLeft } = src;
    if (partner.scrollTop === scrollTop && partner.scrollLeft === scrollLeft) {
      return;
    }
    scrollSyncEcho = partner;
    partner.scrollTop = scrollTop;
    partner.scrollLeft = scrollLeft;
    requestAnimationFrame(() => {
      if (scrollSyncEcho === partner) {
        scrollSyncEcho = null;
      }
    });
  }

  document.addEventListener("scroll", onFieldScroll, true);

  function refitAll() {
    if (!jsonEl.hidden) fitJsonTextarea(jsonEl);
    listEl
      .querySelectorAll("textarea.input-area--sample")
      .forEach((el) => {
        fitFieldTextarea(/** @type {HTMLTextAreaElement} */ (el));
      });
    listEl
      .querySelectorAll(
        ".input-area--stream-stdout, .input-area--stream-stderr",
      )
      .forEach((el) => {
        fitStdoutReadonly(/** @type {HTMLElement} */ (el));
      });
  }

  window.addEventListener("resize", syncProblemTitleOverflow);
  window.addEventListener("resize", scheduleEqualizeResultColumns);
  requestAnimationFrame(syncProblemTitleOverflow);

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(refitAll, 120);
  });

  function showErr(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
  }

  function hideErr() {
    errEl.hidden = true;
    errEl.textContent = "";
  }

  /**
   * One parent folder + file name (e.g. `src/main.cpp`).
   * @param {string} fullPath
   */
  function pathToParentAndName(fullPath) {
    if (!fullPath || typeof fullPath !== "string") return "";
    const norm = fullPath.replace(/\\/g, "/");
    const parts = norm.split("/").filter((p) => p.length > 0);
    if (parts.length === 0) return fullPath;
    const base = parts[parts.length - 1];
    if (parts.length === 1) return base;
    const parent = parts[parts.length - 2];
    return `${parent}/${base}`;
  }

  /**
   * Active editor path, or snapshotted path while a run is in progress.
   * @param {{ path: string | null; running?: boolean; cpp?: boolean }} m
   */
  function updateActiveSourceLabel(m) {
    const p = m.path ?? null;
    const running = !!m.running;
    const cpp = m.cpp !== false;
    if (p && !cpp) {
      activeSourceLabelEl.textContent = pathToParentAndName(p);
      activeSourceLabelEl.title = `Not a C++ file - CP Helper runs C++ only:\n${p}`;
      activeSourceLabelEl.setAttribute(
        "aria-label",
        `Not a C++ file: ${p}`,
      );
      activeSourceLabelEl.classList.remove("active-source-label--empty");
    } else if (p) {
      activeSourceLabelEl.textContent = pathToParentAndName(p);
      activeSourceLabelEl.title = running
        ? `Run in progress (this file only; tab switches are OK):\n${p}`
        : `Run uses active editor:\n${p}`;
      activeSourceLabelEl.setAttribute(
        "aria-label",
        running ? `Running: ${p}` : `Active file for Run: ${p}`,
      );
      activeSourceLabelEl.classList.remove("active-source-label--empty");
    } else {
      activeSourceLabelEl.textContent = "No file";
      activeSourceLabelEl.title = "Open a file in the editor to Run";
      activeSourceLabelEl.setAttribute(
        "aria-label",
        "No active file for Run",
      );
      activeSourceLabelEl.classList.add("active-source-label--empty");
    }
    activeSourceLabelEl.classList.toggle(
      "active-source-label--running",
      running && !!p,
    );
    activeSourceLabelEl.classList.toggle(
      "active-source-label--foreign",
      !!p && !cpp,
    );
  }

  function rk(gi, ci) {
    return `${gi}-${ci}`;
  }

  function totalCaseCount() {
    return groups.reduce((n, g) => n + g.cases.length, 0);
  }

  function showGroupHeaders() {
    if (groups.length > 1) return true;
    if (groups.length === 1 && (groups[0].label ?? "").trim().length > 0) {
      return true;
    }
    return false;
  }

  /** Single empty unnamed bucket (nothing imported yet) - show "add problem group" and first custom becomes `custom/1`. */
  function isNoProblemsPlaceholder() {
    return (
      groups.length === 1 &&
      (groups[0].label ?? "").trim() === "" &&
      (groups[0].cases?.length ?? 0) === 0
    );
  }

  function showAddProblemGroupRow() {
    return showGroupHeaders() || isNoProblemsPlaceholder();
  }

  function addCustomProblemGroup() {
    if (runState.active) return;
    const newId = `manual-${Date.now()}`;
    if (isNoProblemsPlaceholder()) {
      const oldId = String(groups[0].id ?? "");
      if (oldId) {
        delete groupCollapsed[oldId];
      }
      groups[0] = {
        id: newId,
        label: "custom/1",
        cases: [{ sample: 1, input: "", output: "" }],
      };
      groupCollapsed[newId] = true;
      delete lastRunAllSummaryByGroup[0];
    } else {
      const num = groups.length + 1;
      groups.push({
        id: newId,
        label: `custom/${num}`,
        cases: [{ sample: 1, input: "", output: "" }],
      });
      groupCollapsed[newId] = true;
    }
    persistWebviewNavState();
    persist();
    render();
  }

  /**
   * When the Samples list shows a header row per problem, default every group to collapsed.
   * @param {{ id: string; label: string; cases: unknown[] }[]} gs
   * @returns {Record<string, boolean>}
   */
  function defaultCollapsedAllHeaders(gs) {
    /** @type {Record<string, boolean>} */
    const out = {};
    const headers =
      gs.length > 1 ||
      (gs.length === 1 && (gs[0].label ?? "").trim().length > 0);
    if (!headers) {
      return out;
    }
    for (let i = 0; i < gs.length; i++) {
      const gid = String(gs[i]?.id ?? i);
      if (gid) {
        out[gid] = true;
      }
    }
    return out;
  }

  function persistWebviewNavState() {
    const prev = vscode.getState();
    const base =
      prev && typeof prev === "object" && !Array.isArray(prev)
        ? { ...prev }
        : {};
    base.groupCollapsed = { ...groupCollapsed };
    delete base.lastCollapseFingerprint;
    vscode.setState(base);
  }

  function pruneGroupCollapseState() {
    const ids = new Set(groups.map((g) => String(g.id ?? "")));
    let changed = false;
    for (const k of Object.keys(groupCollapsed)) {
      if (!ids.has(k)) {
        delete groupCollapsed[k];
        changed = true;
      }
    }
    if (changed) {
      persistWebviewNavState();
    }
  }

  /**
   * @param {string} groupId
   */
  function toggleGroupCollapsed(groupId) {
    const id = String(groupId ?? "");
    if (!id) {
      return;
    }
    if (groupCollapsed[id]) {
      delete groupCollapsed[id];
    } else {
      groupCollapsed[id] = true;
    }
    persistWebviewNavState();
    render();
  }

  function ensureDefaultGroup() {
    if (groups.length === 0) {
      groups.push({ id: "0", label: "", cases: [] });
    }
  }

  function persist() {
    vscode.postMessage({ type: "saveCaseGroups", groups });
  }

  function nextSampleInGroup(gi) {
    const c = groups[gi]?.cases ?? [];
    if (c.length === 0) return 1;
    return Math.max(...c.map((x) => x.sample)) + 1;
  }

  /**
   * @param {{ label?: string; compileCommand?: string; runCommand?: string }} m
   */
  function updateRunnerHint(m) {
    runnerInfo = {
      label: typeof m?.label === "string" ? m.label.trim() : "",
      compile: typeof m?.compileCommand === "string" ? m.compileCommand : "",
      run: typeof m?.runCommand === "string" ? m.runCommand : "",
    };
    renderRunnerHint();
  }

  /**
   * Hover text spells out what the label stands for: the compile line actually in effect
   * (including -DLOCAL) and the run line.
   */
  function renderRunnerHint() {
    const { label, compile, run } = runnerInfo;
    if (!label) {
      runnerHintValueEl.textContent = "";
      runnerHintEl.hidden = true;
      runnerHintEl.removeAttribute("title");
      runnerHintEl.removeAttribute("aria-label");
      return;
    }
    runnerHintValueEl.textContent = label;
    runnerHintEl.hidden = false;
    const lines = [`Runner: ${label}`];
    lines.push(
      compile
        ? `Compile: ${defineLocal ? withLocalDefine(compile) : compile}`
        : "Compile: skipped (compileCommand is empty)",
    );
    if (run) {
      lines.push(`Run: ${run}`);
    }
    const text = lines.join("\n");
    runnerHintEl.title = text;
    runnerHintEl.setAttribute("aria-label", text);
  }

  /**
   * Mirrors the extension's `-DLOCAL` insertion (right after the compiler token) for display only.
   * @param {string} cmd
   */
  function withLocalDefine(cmd) {
    const t = cmd.trimStart();
    const m = /^(\S+)(.*)/su.exec(t);
    return m ? `${m[1]} -DLOCAL${m[2]}` : `${t} -DLOCAL`;
  }

  /**
   * Contest / problem id from OJ Sync (e.g. atcoder/abc451_a).
   * @param {string | null | undefined} label
   */
  function updateImportProblemTitle(label) {
    const t = typeof label === "string" ? label.trim() : "";
    importProblemTitleEl.classList.toggle("import-problem-title--empty", !t);
    if (!t) {
      importProblemTitleEl.textContent = "No problem imported";
      importProblemTitleEl.removeAttribute("title");
      importProblemTitleEl.setAttribute("aria-label", "Imported problem");
    } else {
      importProblemTitleEl.textContent = t;
      importProblemTitleEl.title = t;
      importProblemTitleEl.setAttribute("aria-label", `Imported problem: ${t}`);
    }
    importProblemTitleEl.scrollLeft = 0;
    requestAnimationFrame(syncProblemTitleOverflow);
  }

  function syncProblemTitleOverflow() {
    importProblemTitleEl.classList.toggle(
      "import-problem-title--overflow",
      importProblemTitleEl.scrollWidth > importProblemTitleEl.clientWidth + 1,
    );
  }

  function syncLocalToggleUi() {
    renderRunnerHint();
    btnToggleLocal.setAttribute("aria-pressed", String(defineLocal));
    btnToggleLocal.classList.toggle("btn-debug-local--on", defineLocal);
    btnToggleLocal.title = defineLocal
      ? "Debug: compile with -DLOCAL (on). Click to turn off."
      : "Debug: click to add -DLOCAL when compiling.";
    btnToggleLocal.setAttribute(
      "aria-label",
      defineLocal
        ? "Debug mode on: -DLOCAL for compile"
        : "Debug mode off: click for -DLOCAL on compile",
    );
  }

  function purgeLastRunForGroup(gi) {
    const prefix = `${gi}-`;
    Object.keys(lastRun).forEach((k) => {
      if (k.startsWith(prefix)) delete lastRun[k];
    });
    delete lastRunAllSummaryByGroup[gi];
  }

  /**
   * Compile/run line for the group header when this group is the active run (multi-header mode).
   * @param {number} gi
   * @returns {string} empty if this group is not running
   */
  /**
   * Returns null when no spinner should show, "" when spinner should show without a label
   * (compile phase), or a non-empty string label for the run phase.
   * @param {number} gi
   * @returns {string | null}
   */
  function textForActiveGroupRunStatus(gi) {
    if (!runState.active) {
      return null;
    }
    const gIdx = runState.groupIndex;
    if (typeof gIdx !== "number" || gIdx !== gi) {
      return null;
    }
    if (runState.mode === "all" && runState.phase === "compile") {
      return ""; // show spinner, no count label yet
    }
    if (
      runState.mode === "all" &&
      runState.phase === "run" &&
      runState.total != null
    ) {
      const i = runState.index ?? 0;
      return `${i + 1}/${runState.total}`;
    }
    if (runState.mode === "one" && runState.index != null) {
      const g = groups[gi];
      const sn = g?.cases[runState.index]?.sample ?? runState.index + 1;
      return `#${sn}`;
    }
    return null;
  }

  /**
   * Import toolbar + global run status (no testcase list).
   */
  function applyToolbarAndImportState() {
    const busy = runState.active;
    const multi = showGroupHeaders();
    const tc = totalCaseCount();
    btnRunAll.hidden = multi;
    runAllPassedSummaryEl.hidden = multi || busy;
    // Run stays clickable while busy: a click restarts, replacing the run in flight.
    btnRunAll.disabled = tc === 0;
    btnToggleJson.disabled = busy;
    btnLoad.disabled = busy;
    btnClear.disabled = busy;
    btnExport.disabled = busy || totalCaseCount() === 0;
    btnToggleLocal.disabled = busy;
    btnStopRun.hidden = !busy;
    runStatusEl.hidden = !busy || multi;
    if (!multi && !busy) {
      const s = lastRunAllSummaryByGroup[0];
      if (s && s.total > 0) {
        runAllPassedSummaryEl.hidden = false;
        runAllPassedSummaryEl.textContent = `${s.passed}/${s.total}`;
        const tip = `${s.passed} of ${s.total} test cases passed`;
        runAllPassedSummaryEl.title = tip;
        runAllPassedSummaryEl.setAttribute("aria-label", tip);
      } else {
        runAllPassedSummaryEl.hidden = true;
        runAllPassedSummaryEl.textContent = "";
        runAllPassedSummaryEl.removeAttribute("title");
        runAllPassedSummaryEl.removeAttribute("aria-label");
      }
    }
    if (busy && !multi) {
      if (runState.mode === "all" && runState.phase === "compile") {
        runStatusLabel.textContent = "";
      } else if (
        runState.mode === "all" &&
        runState.phase === "run" &&
        runState.total != null
      ) {
        const i = runState.index ?? 0;
        runStatusLabel.textContent = `${i + 1}/${runState.total}`;
      } else if (
        runState.mode === "one" &&
        runState.index != null &&
        runState.groupIndex != null
      ) {
        const g = groups[runState.groupIndex];
        const sn = g?.cases[runState.index]?.sample ?? runState.index + 1;
        runStatusLabel.textContent = `#${sn}`;
      } else {
        runStatusLabel.textContent = "";
      }
    } else {
      runStatusLabel.textContent = "";
    }
    syncSeparators();
  }

  /**
   * Hides a group separator with no visible control on one of its sides: the run cluster empties
   * out in multi-group mode, which would otherwise leave two rules butted together.
   */
  function syncSeparators() {
    const kids = Array.from(actionClusterEl.children);
    const seps = [];
    let visibleSinceSep = 0;
    for (const el of kids) {
      if (el.classList.contains("btn-sep")) {
        seps.push({ el, before: visibleSinceSep, after: 0 });
        visibleSinceSep = 0;
        continue;
      }
      if (!(el instanceof HTMLElement) || el.hidden) continue;
      visibleSinceSep++;
      for (const s of seps) s.after++;
    }
    for (const s of seps) {
      s.el.hidden = s.before === 0 || s.after === 0;
    }
  }

  /**
   * True when the list DOM still matches `groups` (safe to patch headers/rows without full rebuild).
   */
  function incrementalDomReady() {
    if (!showGroupHeaders()) {
      return false;
    }
    const n = groups.length;
    if (n < 1) {
      return false;
    }
    const wraps = listEl.querySelectorAll(
      ":scope > li.case-group-wrap[data-cp-gi]",
    );
    if (wraps.length !== n) {
      return false;
    }
    for (let gi = 0; gi < n; gi++) {
      const wrap = listEl.querySelector(
        `li.case-group-wrap[data-cp-gi="${gi}"]`,
      );
      if (!wrap) {
        return false;
      }
      const ul = wrap.querySelector(":scope > ul.case-group-cases");
      if (!ul) {
        return false;
      }
      const rows = ul.querySelectorAll(":scope > li.case");
      if (rows.length !== groups[gi].cases.length) {
        return false;
      }
    }
    const addProblemGroupRow = listEl.querySelector(
      ":scope > li.add-problem-group-row",
    );
    if (
      !addProblemGroupRow ||
      !addProblemGroupRow.querySelector(".btn-add-problem-group")
    ) {
      return false;
    }
    return true;
  }

  function syncMultiGroupHeadersFromState() {
    const busy = runState.active;
    groups.forEach((group, gi) => {
      const wrap = listEl.querySelector(
        `li.case-group-wrap[data-cp-gi="${gi}"]`,
      );
      if (!wrap) {
        return;
      }
      const gs = lastRunAllSummaryByGroup[gi];
      wrap.classList.remove("case-group-wrap--ac", "case-group-wrap--wa");
      // Only the running group's summary is cleared in state; keep other groups' AC/WA + n/m visible.
      if (gs && gs.total > 0) {
        wrap.classList.add(
          gs.passed === gs.total
            ? "case-group-wrap--ac"
            : "case-group-wrap--wa",
        );
      }
      const sumEl = wrap.querySelector(".case-group-passed");
      if (sumEl) {
        if (gs && gs.total > 0) {
          sumEl.textContent = `${gs.passed}/${gs.total}`;
          sumEl.title = `${gs.passed} of ${gs.total} passed in this problem`;
        } else {
          sumEl.textContent = "";
          sumEl.removeAttribute("title");
        }
      }
      const grpStatus = wrap.querySelector(".case-group-run-status");
      if (grpStatus) {
        grpStatus.innerHTML = "";
        const st = textForActiveGroupRunStatus(gi);
        if (st !== null) {
          const grpSpin = document.createElement("span");
          grpSpin.className = "run-status-spinner";
          grpSpin.setAttribute("aria-hidden", "true");
          grpStatus.appendChild(grpSpin);
          if (st) {
            const grpLbl = document.createElement("span");
            grpLbl.className = "run-status-label";
            grpLbl.textContent = st;
            grpLbl.setAttribute("aria-live", "polite");
            grpStatus.appendChild(grpLbl);
          }
          grpStatus.hidden = false;
        } else {
          grpStatus.hidden = true;
        }
      }
      const runAllBtn = wrap.querySelector(".case-group__run-all");
      if (runAllBtn) {
        runAllBtn.disabled = group.cases.length === 0;
      }
      const clearBtn = wrap.querySelector(".case-group__clear");
      if (clearBtn) {
        clearBtn.disabled = busy;
      }
    });
  }

  function syncCaseRowSpinners() {
    const busy = runState.active;
    const gIdx = runState.groupIndex ?? -1;
    listEl.querySelectorAll("li.case").forEach((li) => {
      const gi = Number(li.dataset.groupIndex);
      const index = Number(li.dataset.index);
      if (Number.isNaN(gi) || Number.isNaN(index)) {
        return;
      }
      const head = li.querySelector(".case-head");
      const actions = head && head.querySelector(".case-actions");
      if (!head || !actions) {
        return;
      }
      head.querySelectorAll(".run-row-spinner").forEach((el) => el.remove());
      const showRowSpinner =
        busy &&
        gIdx === gi &&
        ((runState.mode === "one" && runState.index === index) ||
          (runState.mode === "all" &&
            runState.phase === "run" &&
            runState.index === index));
      if (showRowSpinner) {
        const spin = document.createElement("span");
        spin.className = "run-row-spinner";
        spin.title = "Running";
        spin.setAttribute("aria-label", "Running");
        const verdict = head.querySelector(".case-verdict");
        head.insertBefore(spin, verdict ?? actions);
      }
    });
  }

  /**
   * @param {number} gi
   * @param {number} ci
   * @returns {boolean}
   */
  function patchCaseRowFromLastRun(gi, ci) {
    const li = listEl.querySelector(
      `li.case[data-group-index="${gi}"][data-index="${ci}"]`,
    );
    if (!li) {
      return false;
    }
    const runInfo = lastRun[rk(gi, ci)];
    li.className = "case";
    if (runInfo) {
      li.classList.add(`case--${runInfo.badge}`);
    }
    const head = li.querySelector(".case-head");
    const actions = head && head.querySelector(".case-actions");
    if (!head || !actions) {
      return false;
    }
    head.querySelectorAll(".case-verdict").forEach((el) => el.remove());
    if (runInfo) {
      const verdictEl = document.createElement("span");
      verdictEl.className = "case-verdict";
      const timeHint = formatElapsed(runInfo.elapsedMs);
      verdictEl.textContent = runInfo.verdict + timeHint;
      head.insertBefore(verdictEl, actions);
    }
    const body = li.querySelector(".case-body");
    if (!body) {
      return true;
    }
    body.querySelectorAll(".field--result").forEach((el) => el.remove());
    if (runInfo) {
      const so = runInfo.stdout ?? "";
      const se = runInfo.stderr ?? "";
      if (so.trim() !== "") {
        body.appendChild(
          makeReadonlyOutput("Stdout", so, "stdout", diffTarget(runInfo, gi, ci)),
        );
      }
      if (se.trim() !== "") {
        body.appendChild(makeReadonlyOutput("Stderr", se, "stderr"));
      }
    }
    requestAnimationFrame(() => {
      body
        .querySelectorAll(
          ".input-area--stream-stdout, .input-area--stream-stderr",
        )
        .forEach((el) =>
          fitStdoutReadonly(/** @type {HTMLElement} */ (el)),
        );
    });
    return true;
  }

  function refreshIncrementalRunUi() {
    applyToolbarAndImportState();
    syncMultiGroupHeadersFromState();
    syncCaseRowSpinners();
    listEmptyEl.hidden = totalCaseCount() > 0;
    listEl
      .querySelectorAll(
        ".btn-add-case, .btn-add-problem-group, .case-group__add-case",
      )
      .forEach((btn) => {
        btn.disabled = runState.active;
      });
    requestAnimationFrame(() => refitAll());
  }

  function render() {
    listEl.innerHTML = "";
    ensureDefaultGroup();
    pruneGroupCollapseState();
    const busy = runState.active;
    const multi = showGroupHeaders();
    applyToolbarAndImportState();
    listEmptyEl.hidden = totalCaseCount() > 0;

    groups.forEach((group, gi) => {
      const wrap = document.createElement("li");
      wrap.className = "case-group-wrap";
      wrap.setAttribute("data-cp-gi", String(gi));

      if (multi) {
        const gid = String(group.id ?? gi);
        const panelId = `case-group-panel-${gi}`;
        const collapsed = !!groupCollapsed[gid];
        const gs = lastRunAllSummaryByGroup[gi];
        wrap.classList.remove("case-group-wrap--ac", "case-group-wrap--wa");
        if (gs && gs.total > 0) {
          wrap.classList.add(
            gs.passed === gs.total
              ? "case-group-wrap--ac"
              : "case-group-wrap--wa",
          );
        }

        const ghead = document.createElement("div");
        ghead.className = "case-group-head";

        const labelText =
          (group.label ?? "").trim() !== ""
            ? group.label
            : `Group ${gi + 1}`;
        const disclose = document.createElement("button");
        disclose.type = "button";
        disclose.className = "case-group-disclose";
        disclose.setAttribute("aria-expanded", collapsed ? "false" : "true");
        disclose.setAttribute("aria-controls", panelId);
        disclose.title = collapsed
          ? `Expand ${labelText}`
          : `Collapse ${labelText}`;
        disclose.setAttribute(
          "aria-label",
          collapsed ? `Expand ${labelText}` : `Collapse ${labelText}`,
        );
        const chev = document.createElement("span");
        chev.className = "case-group-disclose__chev";
        chev.setAttribute("aria-hidden", "true");
        chev.textContent = collapsed ? "▸" : "▾";
        const lbl = document.createElement("span");
        lbl.className = "case-group-disclose__label";
        lbl.textContent = labelText;
        disclose.appendChild(chev);
        disclose.appendChild(lbl);
        disclose.addEventListener("click", () => {
          toggleGroupCollapsed(gid);
        });
        ghead.appendChild(disclose);

        const sumEl = document.createElement("span");
        sumEl.className = "case-group-passed";
        if (gs && gs.total > 0) {
          sumEl.textContent = `${gs.passed}/${gs.total}`;
          sumEl.title = `${gs.passed} of ${gs.total} passed in this problem`;
        } else {
          sumEl.textContent = "";
        }
        ghead.appendChild(sumEl);

        const grpStatus = document.createElement("span");
        grpStatus.className = "case-group-run-status";
        const grpSt = textForActiveGroupRunStatus(gi);
        if (grpSt !== null) {
          const grpSpin = document.createElement("span");
          grpSpin.className = "run-status-spinner";
          grpSpin.setAttribute("aria-hidden", "true");
          grpStatus.appendChild(grpSpin);
          if (grpSt) {
            const grpLbl = document.createElement("span");
            grpLbl.className = "run-status-label";
            grpLbl.textContent = grpSt;
            grpLbl.setAttribute("aria-live", "polite");
            grpStatus.appendChild(grpLbl);
          }
          grpStatus.hidden = false;
        } else {
          grpStatus.hidden = true;
        }
        ghead.appendChild(grpStatus);

        const btnRunG = document.createElement("button");
        btnRunG.type = "button";
        btnRunG.className = "case-group__run-all btn-icon";
        btnRunG.title = "Run all cases in this group";
        btnRunG.setAttribute("aria-label", `Run all cases in ${(group.label ?? "").trim() || `group ${gi + 1}`}`);
        btnRunG.appendChild(mkIcon("runAll"));
        btnRunG.disabled = group.cases.length === 0;
        btnRunG.addEventListener("click", () => {
          hideErr();
          if (group.cases.length === 0) return;
          purgeLastRunForGroup(gi);
          runState = { active: true, mode: "all", phase: "compile", groupIndex: gi, index: null, total: group.cases.length };
          if (incrementalDomReady()) {
            refreshIncrementalRunUi();
          } else {
            render();
          }
          vscode.postMessage({
            type: "runAll",
            groupIndex: gi,
            cases: group.cases,
          });
        });
        ghead.appendChild(btnRunG);

        const btnAddCaseG = document.createElement("button");
        btnAddCaseG.type = "button";
        btnAddCaseG.className = "btn-secondary case-group__add-case btn-icon";
        btnAddCaseG.title = "Add empty testcase to this problem";
        btnAddCaseG.appendChild(mkIcon("add"));
        btnAddCaseG.setAttribute(
          "aria-label",
          `Add testcase to ${(group.label ?? "").trim() || `group ${gi + 1}`}`,
        );
        btnAddCaseG.disabled = busy;
        btnAddCaseG.addEventListener("click", () => {
          if (busy) return;
          groups[gi].cases.push({
            sample: nextSampleInGroup(gi),
            input: "",
            output: "",
          });
          delete lastRunAllSummaryByGroup[gi];
          persist();
          render();
        });
        ghead.appendChild(btnAddCaseG);

        const btnClrG = document.createElement("button");
        btnClrG.type = "button";
        btnClrG.className = "btn-secondary case-group__clear btn-icon";
        btnClrG.disabled = busy;
        btnClrG.title = "Remove this problem group";
        btnClrG.setAttribute("aria-label", "Remove this problem group");
        btnClrG.appendChild(mkIcon("trash"));
        btnClrG.addEventListener("click", () => {
          if (busy) return;
          groups.splice(gi, 1);
          reindexLastRunAfterGroupRemove(gi);
          ensureDefaultGroup();
          persist();
          render();
        });
        ghead.appendChild(btnClrG);

        wrap.appendChild(ghead);
        wrap.classList.toggle("case-group-wrap--collapsed", collapsed);
      }

      const inner = document.createElement("ul");
      inner.className = "case-group-cases";
      if (multi) {
        inner.id = `case-group-panel-${gi}`;
        inner.hidden = !!groupCollapsed[String(group.id ?? gi)];
        inner.setAttribute(
          "aria-hidden",
          inner.hidden ? "true" : "false",
        );
      }

      group.cases.forEach((c, index) => {
        const li = document.createElement("li");
        li.className = "case";
        li.dataset.groupIndex = String(gi);
        li.dataset.index = String(index);
        const runInfo = lastRun[rk(gi, index)];
        if (runInfo) {
          li.classList.add(`case--${runInfo.badge}`);
        }

        const head = document.createElement("div");
        head.className = "case-head";

        const tEl = document.createElement("div");
        tEl.className = "case-title";
        tEl.setAttribute("role", "group");
        tEl.setAttribute("aria-label", `Sample ${c.sample}`);
        const num = document.createElement("span");
        num.className = "case-num";
        num.textContent = String(c.sample);
        const lbl = document.createElement("span");
        lbl.textContent = "";
        tEl.appendChild(num);
        tEl.appendChild(lbl);

        const actions = document.createElement("div");
        actions.className = "case-actions";

        const runOne = document.createElement("button");
        runOne.type = "button";
        runOne.className = "btn-icon";
        runOne.title = `Run sample ${c.sample}`;
        runOne.setAttribute("aria-label", `Run sample ${c.sample}`);
        runOne.appendChild(mkIcon("play"));
        runOne.disabled = false;
        runOne.addEventListener("click", () => {
          delete lastRun[rk(gi, index)];
          runState = { active: true, mode: "one", phase: "run", groupIndex: gi, index, total: 1 };
          if (incrementalDomReady()) {
            refreshIncrementalRunUi();
          } else {
            render();
          }
          vscode.postMessage({
            type: "runOne",
            groupIndex: gi,
            index,
            case: group.cases[index],
          });
        });

        const debugOne = document.createElement("button");
        debugOne.type = "button";
        debugOne.className = "btn-secondary btn-icon";
        debugOne.title = `Debug sample ${c.sample} (input piped to stdin)`;
        debugOne.setAttribute("aria-label", `Debug sample ${c.sample}`);
        debugOne.appendChild(mkIcon("debug"));
        debugOne.disabled = false;
        debugOne.addEventListener("click", () => {
          hideErr();
          vscode.postMessage({
            type: "debugOne",
            groupIndex: gi,
            index,
            case: group.cases[index],
          });
        });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn-secondary btn-icon";
        remove.title = "Remove this testcase";
        remove.setAttribute("aria-label", "Remove this testcase");
        remove.appendChild(mkIcon("close"));
        remove.disabled = false;
        remove.addEventListener("click", () => {
          if (runState.active && runState.groupIndex === gi) {
            vscode.postMessage({ type: "stopRun" });
            staleResultGroups.add(gi);
            runState = {
              active: false,
              mode: null,
              phase: null,
              groupIndex: null,
              index: null,
              total: null,
            };
          }
          group.cases.splice(index, 1);
          reindexLastRunAfterCaseRemove(gi, index);
          delete lastRunAllSummaryByGroup[gi];
          persist();
          render();
        });

        actions.appendChild(runOne);
        actions.appendChild(debugOne);
        actions.appendChild(remove);

        head.appendChild(tEl);
        const gIdx = runState.groupIndex ?? -1;
        const showRowSpinner =
          busy &&
          gIdx === gi &&
          ((runState.mode === "one" && runState.index === index) ||
            (runState.mode === "all" &&
              runState.phase === "run" &&
              runState.index === index));
        if (showRowSpinner) {
          const spin = document.createElement("span");
          spin.className = "run-row-spinner";
          spin.title = "Running";
          spin.setAttribute("aria-label", "Running");
          head.appendChild(spin);
        }
        if (runInfo) {
          const verdictEl = document.createElement("span");
          verdictEl.className = "case-verdict";
          const timeHint = formatElapsed(runInfo.elapsedMs);
          verdictEl.textContent = runInfo.verdict + timeHint;
          head.appendChild(verdictEl);
        }
        head.appendChild(actions);

        const body = document.createElement("div");
        body.className = "case-body";
        body.appendChild(makeField("Input", gi, index, "input"));
        body.appendChild(makeField("Expected output", gi, index, "output"));

        if (runInfo) {
          const so = runInfo.stdout ?? "";
          const se = runInfo.stderr ?? "";
          if (so.trim() !== "") {
            body.appendChild(
              makeReadonlyOutput("Stdout", so, "stdout", diffTarget(runInfo, gi, index)),
            );
          }
          if (se.trim() !== "") {
            body.appendChild(makeReadonlyOutput("Stderr", se, "stderr"));
          }
        }

        li.appendChild(head);
        li.appendChild(body);
        inner.appendChild(li);
      });

      wrap.appendChild(inner);
      listEl.appendChild(wrap);
    });

    if (showAddProblemGroupRow()) {
      const addProblemRow = document.createElement("li");
      addProblemRow.className = "add-problem-group-row";
      const btnAddProblem = document.createElement("button");
      btnAddProblem.type = "button";
      btnAddProblem.className = "btn-add-problem-group";
      btnAddProblem.setAttribute(
        "aria-label",
        isNoProblemsPlaceholder()
          ? "custom group - create custom/1 with one empty testcase"
          : "custom group - add problem group with one empty testcase",
      );
      btnAddProblem.title = isNoProblemsPlaceholder()
        ? "Create first custom problem group (one empty testcase)"
        : "Add problem group with one empty testcase";
      const plusMark = document.createElement("span");
      plusMark.className = "btn-add-problem-group__plus";
      plusMark.setAttribute("aria-hidden", "true");
      plusMark.appendChild(mkIcon("add"));
      const addProblemLabel = document.createElement("span");
      addProblemLabel.className = "btn-add-problem-group__label";
      addProblemLabel.textContent = "custom group";
      btnAddProblem.appendChild(plusMark);
      btnAddProblem.appendChild(addProblemLabel);
      btnAddProblem.disabled = busy;
      btnAddProblem.addEventListener("click", () => {
        addCustomProblemGroup();
      });
      addProblemRow.appendChild(btnAddProblem);
      listEl.appendChild(addProblemRow);
    }

    // Flat-mode testcase +: hide while empty placeholder so only the problem-group + shows.
    if (!multi && !isNoProblemsPlaceholder()) {
      const addRow = document.createElement("li");
      addRow.className = "add-case-row";
      const btnAddCase = document.createElement("button");
      btnAddCase.type = "button";
      btnAddCase.className = "btn-add-case";
      btnAddCase.setAttribute("aria-label", "Add testcase");
      btnAddCase.appendChild(mkIcon("add"));
      btnAddCase.disabled = busy;
      btnAddCase.addEventListener("click", () => {
        const gi = Math.max(0, groups.length - 1);
        ensureDefaultGroup();
        groups[gi].cases.push({
          sample: nextSampleInGroup(gi),
          input: "",
          output: "",
        });
        delete lastRunAllSummaryByGroup[gi];
        persist();
        render();
      });
      addRow.appendChild(btnAddCase);
      listEl.appendChild(addRow);
    }

    requestAnimationFrame(() => {
      refitAll();
    });
  }

  function reindexLastRunAfterGroupRemove(removedGi) {
    const next = {};
    Object.keys(lastRun).forEach((k) => {
      const m = k.match(/^(\d+)-(\d+)$/u);
      if (!m) return;
      let g = Number(m[1]);
      const c = Number(m[2]);
      if (g === removedGi) return;
      if (g > removedGi) g -= 1;
      next[`${g}-${c}`] = lastRun[k];
    });
    Object.keys(lastRun).forEach((k) => delete lastRun[k]);
    Object.assign(lastRun, next);
    const sumNext = {};
    Object.keys(lastRunAllSummaryByGroup).forEach((k) => {
      let g = Number(k);
      if (g === removedGi) return;
      if (g > removedGi) g -= 1;
      sumNext[g] = lastRunAllSummaryByGroup[k];
    });
    Object.keys(lastRunAllSummaryByGroup).forEach(
      (k) => delete lastRunAllSummaryByGroup[k],
    );
    Object.assign(lastRunAllSummaryByGroup, sumNext);
  }

  function reindexLastRunAfterCaseRemove(gi, removedCi) {
    const next = {};
    Object.keys(lastRun).forEach((k) => {
      const m = k.match(/^(\d+)-(\d+)$/u);
      if (!m) return;
      const g = Number(m[1]);
      const c = Number(m[2]);
      if (g !== gi) {
        next[k] = lastRun[k];
        return;
      }
      if (c === removedCi) return;
      const nc = c > removedCi ? c - 1 : c;
      next[`${g}-${nc}`] = lastRun[k];
    });
    Object.keys(lastRun).forEach((k) => delete lastRun[k]);
    Object.assign(lastRun, next);
  }

  /**
   * @param {string} label
   * @param {number} gi
   * @param {number} index
   * @param {"input" | "output"} key
   */
  function makeField(label, gi, index, key) {
    const wrap = document.createElement("div");
    wrap.className = `field field--sample field--${key}`;
    const lb = document.createElement("label");
    lb.textContent = label;
    const ta = document.createElement("textarea");
    ta.className = "input-area input-area--sample";
    ta.rows = 1;
    ta.spellcheck = false;
    const row = groups[gi].cases[index];
    ta.value = trimTrailingNewlines(row[key]);
    ta.addEventListener("focus", () => {
      ta.value = groups[gi].cases[index][key];
      fitFieldTextarea(ta);
    });
    ta.addEventListener("blur", () => {
      groups[gi].cases[index][key] = ta.value;
      ta.value = trimTrailingNewlines(groups[gi].cases[index][key]);
      fitFieldTextarea(ta);
      persist();
    });
    ta.addEventListener("input", () => {
      groups[gi].cases[index][key] = ta.value;
      fitFieldTextarea(ta);
      persist();
    });
    wrap.appendChild(lb);
    wrap.appendChild(ta);
    requestAnimationFrame(() => fitFieldTextarea(ta));
    return wrap;
  }

  /**
   * Expected output to mark stdout against, or null when marking would mislead: only a WA is a
   * plain text mismatch. AC can differ textually (float tolerance, checker), and TLE/RE outputs
   * are truncated, where flagging every trailing token says nothing.
   * @param {{ verdict?: string }} runInfo
   * @param {number} gi
   * @param {number} ci
   */
  function diffTarget(runInfo, gi, ci) {
    if (runInfo?.verdict !== "WA") {
      return null;
    }
    const expected = groups[gi]?.cases[ci]?.output;
    return typeof expected === "string" ? trimTrailingNewlines(expected) : null;
  }

  /**
   * Splits a line into whitespace-preserving chunks: even indices are tokens, odd are separators.
   * @param {string} line
   */
  function splitTokens(line) {
    return line.split(/(\s+)/u);
  }

  /**
   * Marks the tokens of `actual` that differ from `expected` at the same position. Whole extra
   * lines count as differing. Comparison is positional and textual, so it is only meaningful for
   * a WA - the host's float-aware compare can accept text the eye reads as different.
   * @param {HTMLElement} host
   * @param {string} actual
   * @param {string} expected
   */
  function appendDiffedText(host, actual, expected) {
    const expLines = expected.split("\n");
    actual.split("\n").forEach((line, li) => {
      if (li > 0) {
        host.appendChild(document.createTextNode("\n"));
      }
      const expTokens = splitTokens(expLines[li] ?? "").filter(
        (_, i) => i % 2 === 0,
      );
      let tokenIndex = 0;
      for (const [i, chunk] of splitTokens(line).entries()) {
        if (i % 2 === 1) {
          host.appendChild(document.createTextNode(chunk));
          continue;
        }
        const same = li < expLines.length && chunk === expTokens[tokenIndex];
        tokenIndex += 1;
        if (chunk === "") {
          continue;
        }
        if (same) {
          host.appendChild(document.createTextNode(chunk));
          continue;
        }
        const mark = document.createElement("span");
        mark.className = "diff-token";
        mark.textContent = chunk;
        host.appendChild(mark);
      }
    });
  }

  /**
   * Read-only run output: stdout/stderr grow to content up to `maxStdoutReadonlyHeight`, then
   * scroll. Rendered as a `pre` rather than a textarea so mismatching tokens can be marked.
   * Includes a copy-to-clipboard button.
   * @param {string} label
   * @param {string} value
   * @param {"stdout" | "stderr"} stream
   * @param {string | null} [diffAgainst] expected output to mark differences against
   */
  function makeReadonlyOutput(label, value, stream, diffAgainst) {
    const wrap = document.createElement("div");
    wrap.className = `field field--result field--${stream}`;

    const hdr = document.createElement("div");
    hdr.className = "field-header";

    const lb = document.createElement("label");
    lb.textContent = label;
    hdr.appendChild(lb);

    const copyLbl = label.toLowerCase();
    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "btn-copy";
    copyBtn.title = `Copy ${copyLbl}`;
    copyBtn.setAttribute("aria-label", `Copy ${copyLbl}`);
    copyBtn.appendChild(mkIcon("copy"));

    const out = document.createElement("pre");
    out.className =
      stream === "stderr"
        ? "input-area input-area--stream-stderr"
        : "input-area input-area--stream-stdout";
    out.tabIndex = 0;
    out.setAttribute("role", "textbox");
    out.setAttribute("aria-readonly", "true");
    out.setAttribute("aria-label", label);
    if (typeof diffAgainst === "string" && diffAgainst !== "") {
      appendDiffedText(out, value, diffAgainst);
    } else {
      out.textContent = value;
    }

    function showCopied() {
      copyBtn.title = "Copied!";
      copyBtn.classList.add("btn-copy--done");
      setTimeout(() => {
        copyBtn.title = `Copy ${copyLbl}`;
        copyBtn.classList.remove("btn-copy--done");
      }, 1500);
    }

    function copyViaSelection() {
      const range = document.createRange();
      range.selectNodeContents(out);
      const sel = window.getSelection();
      if (!sel) return;
      sel.removeAllRanges();
      sel.addRange(range);
      try { document.execCommand("copy"); showCopied(); } catch (_) {}
    }

    copyBtn.addEventListener("click", () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(value).then(showCopied, copyViaSelection);
      } else {
        copyViaSelection();
      }
    });

    hdr.appendChild(copyBtn);
    wrap.appendChild(hdr);
    wrap.appendChild(out);
    requestAnimationFrame(() => fitStdoutReadonly(out));
    return wrap;
  }

  /**
   * Run all samples in the first problem group (flat or multi-header). No-op if group 0 is empty;
   * while a run is in flight this restarts, replacing it.
   */
  function triggerRunAll() {
    hideErr();
    ensureDefaultGroup();
    const g0 = groups[0];
    if (!g0 || g0.cases.length === 0) return;
    purgeLastRunForGroup(0);
    runState = { active: true, mode: "all", phase: "compile", groupIndex: 0, index: null, total: g0.cases.length };
    if (incrementalDomReady()) {
      refreshIncrementalRunUi();
    } else {
      render();
    }
    vscode.postMessage({
      type: "runAll",
      groupIndex: 0,
      cases: g0.cases,
    });
  }

  /**
   * Run first row of first problem group (sample index 0). No-op if group 0 has no cases;
   * while a run is in flight this restarts, replacing it.
   */
  function triggerRunFirst() {
    hideErr();
    ensureDefaultGroup();
    const g0 = groups[0];
    if (!g0 || g0.cases.length === 0) return;
    runState = { active: true, mode: "one", phase: "run", groupIndex: 0, index: 0, total: 1 };
    if (incrementalDomReady()) {
      refreshIncrementalRunUi();
    } else {
      render();
    }
    vscode.postMessage({
      type: "runOne",
      groupIndex: 0,
      index: 0,
      case: g0.cases[0],
    });
  }

  function onMessage(e) {
    const m = e.data;
    if (m.type === "shortcutRunFirst") {
      triggerRunFirst();
      return;
    }
    if (m.type === "shortcutRunAll") {
      triggerRunAll();
      return;
    }
    if (m.type === "syncFocusContext") {
      vscode.postMessage({
        type: "webviewFocus",
        focused: document.hasFocus(),
      });
      return;
    }
    if (m.type === "runState") {
      if (m.running) {
        const giClear =
          typeof m.groupIndex === "number" ? m.groupIndex : 0;
        delete lastRunAllSummaryByGroup[giClear];
        staleResultGroups.delete(giClear);
      }
      runState = {
        active: !!m.running,
        mode: m.mode === "one" || m.mode === "all" ? m.mode : null,
        phase:
          m.phase === "compile" || m.phase === "run" ? m.phase : null,
        groupIndex:
          typeof m.groupIndex === "number" ? m.groupIndex : null,
        index: typeof m.index === "number" ? m.index : null,
        total: typeof m.total === "number" ? m.total : null,
      };
      if (incrementalDomReady()) {
        refreshIncrementalRunUi();
      } else {
        render();
      }
      return;
    }
    if (m.type === "cases") {
      if (Array.isArray(m.groups) && m.groups.length > 0) {
        groups = m.groups.map((g, i) => ({
          id: typeof g.id === "string" ? g.id : String(i),
          label: typeof g.label === "string" ? g.label : "",
          cases: Array.isArray(g.cases) ? g.cases : [],
        }));
      } else if (Array.isArray(m.cases)) {
        groups = [{ id: "0", label: "", cases: m.cases }];
      } else {
        groups = [];
      }
      groupCollapsed = defaultCollapsedAllHeaders(groups);
      persistWebviewNavState();
      if (Object.prototype.hasOwnProperty.call(m, "importProblem")) {
        updateImportProblemTitle(m.importProblem);
      }
      Object.keys(lastRun).forEach((k) => delete lastRun[k]);
      Object.keys(lastRunAllSummaryByGroup).forEach(
        (k) => delete lastRunAllSummaryByGroup[k],
      );
      hideErr();
      if (jsonBoxOpen()) {
        jsonEl.value = "";
        setJsonBoxOpen(false);

  function syncStuckState() {
    const stickyEl =
      getComputedStyle(importActionsEl).position === "sticky"
        ? importActionsEl
        : importSectionEl;
    importSectionEl.classList.toggle(
      "import--stuck",
      document.body.scrollTop > stickyEl.offsetTop,
    );
  }

  document.body.addEventListener("scroll", syncStuckState, { passive: true });
  syncStuckState();
      }
      render();
      return;
    }
    if (m.type === "importProblem") {
      updateImportProblemTitle(m.label);
      return;
    }
    if (m.type === "options") {
      if (typeof m.defineLocal === "boolean") {
        defineLocal = m.defineLocal;
        syncLocalToggleUi();
      }
      return;
    }
    if (m.type === "runner") {
      updateRunnerHint(m);
      return;
    }
    if (m.type === "sourceFile") {
      updateActiveSourceLabel(m);
      return;
    }
    if (m.type === "error") {
      showErr(m.message || "Error");
      return;
    }
    if (m.type === "runResult") {
      const gi = typeof m.groupIndex === "number" ? m.groupIndex : 0;
      if (staleResultGroups.has(gi)) {
        return;
      }
      const i = m.index;
      const key = rk(gi, i);
      const disp = streamDisplay;
      const verdictRaw =
        typeof m.verdict === "string" ? m.verdict.toUpperCase() : "WA";
      const verdictNorm =
        verdictRaw === "AC" ||
        verdictRaw === "TLE" ||
        verdictRaw === "RE"
          ? verdictRaw
          : "WA";
      const badgeNorm = verdictNorm.toLowerCase();
      const elapsedMs = typeof m.elapsedMs === "number" ? m.elapsedMs : undefined;
      if (m.error) {
        lastRun[key] = {
          verdict: "WA",
          badge: "wa",
          stdout: "",
          stderr: disp(String(m.error)),
        };
      } else if (verdictNorm === "TLE") {
        const compileHint = m.compileStderr
          ? String(m.compileStderr)
          : "";
        const runErr =
          m.stderr != null ? String(m.stderr) : "";
        const stderrText = compileHint
          ? compileHint
          : runErr || "Time limit exceeded";
        lastRun[key] = {
          verdict: "TLE",
          badge: "tle",
          stdout: disp(m.stdout != null ? String(m.stdout) : ""),
          stderr: disp(stderrText),
          elapsedMs,
        };
      } else if (verdictNorm === "RE") {
        const runErr = m.stderr != null ? String(m.stderr) : "";
        lastRun[key] = {
          verdict: "RE",
          badge: "re",
          stdout: disp(m.stdout != null ? String(m.stdout) : ""),
          stderr: disp(
            runErr.trim() !== ""
              ? runErr
              : "Runtime error (non-zero exit or abnormal termination)",
          ),
          elapsedMs,
        };
      } else if (m.compileStderr) {
        lastRun[key] = {
          verdict: "WA",
          badge: "wa",
          stdout: "",
          stderr: disp("Compile failed:\n" + String(m.compileStderr)),
        };
      } else {
        lastRun[key] = {
          verdict: verdictNorm,
          badge: badgeNorm,
          stdout: disp(m.stdout != null ? String(m.stdout) : ""),
          stderr: disp(m.stderr != null ? String(m.stderr) : ""),
          elapsedMs,
        };
      }
      if (incrementalDomReady() && patchCaseRowFromLastRun(gi, i)) {
        refreshIncrementalRunUi();
      } else {
        render();
      }
      return;
    }
    if (m.type === "runAllDone") {
      if (m.error) showErr(m.error);
      const gi = typeof m.groupIndex === "number" ? m.groupIndex : 0;
      if (staleResultGroups.has(gi)) {
        return;
      }
      const gr = groups[gi];
      let passed = 0;
      const n = gr?.cases.length ?? 0;
      for (let i = 0; i < n; i++) {
        if (lastRun[rk(gi, i)]?.verdict === "AC") passed++;
      }
      lastRunAllSummaryByGroup[gi] =
        n > 0 ? { passed, total: n } : undefined;
      if (incrementalDomReady()) {
        refreshIncrementalRunUi();
      } else {
        render();
      }
      return;
    }
    if (m.type === "exportDone") {
      const count = typeof m.count === "number" ? m.count : 0;
      const prevTitle = btnExport.title;
      btnExport.title = `Exported ${count} case${count === 1 ? "" : "s"} ✓`;
      btnExport.classList.add("btn--export-done");
      setTimeout(() => {
        btnExport.title = prevTitle;
        btnExport.classList.remove("btn--export-done");
      }, 2500);
      return;
    }
  }

  /**
   * @param {boolean} open
   * @param {boolean} [focus]
   */
  function setJsonBoxOpen(open, focus) {
    jsonEl.hidden = !open;
    btnLoad.hidden = !open;
    btnToggleJson.setAttribute("aria-expanded", String(open));
    btnToggleJson.classList.toggle("btn-icon--on", open);
    btnToggleJson.title = open ? "Hide the JSON paste box" : "Show the JSON paste box";
    syncSeparators();
    if (open) {
      fitJsonTextarea(jsonEl);
      if (focus) jsonEl.focus();
    }
  }

  function jsonBoxOpen() {
    return !jsonEl.hidden;
  }

  jsonEl.addEventListener("input", () => fitJsonTextarea(jsonEl));

  btnToggleJson.addEventListener("click", () => {
    setJsonBoxOpen(!jsonBoxOpen(), true);
  });

  btnLoad.addEventListener("click", () => {
    hideErr();
    vscode.postMessage({ type: "loadJson", text: jsonEl.value });
  });

  btnRunAll.addEventListener("click", () => {
    triggerRunAll();
  });

  btnStopRun.addEventListener("click", () => {
    vscode.postMessage({ type: "stopRun" });
  });

  btnExport.addEventListener("click", () => {
    hideErr();
    if (groups.length === 0) return;
    vscode.postMessage({
      type: "exportCases",
      groupIndex: 0,
      cases: groups.flatMap((g) => g.cases),
    });
  });

  btnClear.addEventListener("click", () => {
    hideErr();
    groups = [];
    Object.keys(lastRun).forEach((k) => delete lastRun[k]);
    Object.keys(lastRunAllSummaryByGroup).forEach(
      (k) => delete lastRunAllSummaryByGroup[k],
    );
    ensureDefaultGroup();
    vscode.postMessage({
      type: "saveCaseGroups",
      groups: [...groups],
      clearImportProblem: true,
    });
    render();
  });

  btnToggleLocal.addEventListener("click", () => {
    vscode.postMessage({ type: "setDefineLocal", value: !defineLocal });
  });

  syncLocalToggleUi();

  setJsonBoxOpen(false);

  /**
   * Tell the extension whether this document has keyboard focus (drives `cp-helper.samplesFocus`).
   */
  function postFocusToHost(focused) {
    vscode.postMessage({ type: "webviewFocus", focused });
  }

  /**
   * After focus leaves the webview document, `document.hasFocus()` often stays true for a frame
   * or two while VS Code moves focus to the editor. Single rAF misses that; debounced sync matches reality.
   */
  let focusSyncTimer = 0;
  function scheduleFocusSyncToHost() {
    window.clearTimeout(focusSyncTimer);
    focusSyncTimer = window.setTimeout(() => {
      focusSyncTimer = 0;
      postFocusToHost(document.hasFocus());
    }, 80);
  }

  document.addEventListener(
    "focusin",
    () => {
      window.clearTimeout(focusSyncTimer);
      focusSyncTimer = 0;
      postFocusToHost(true);
    },
    true,
  );

  document.addEventListener(
    "focusout",
    (ev) => {
      const next = ev.relatedTarget;
      if (next && document.contains(next)) {
        return;
      }
      scheduleFocusSyncToHost();
    },
    true,
  );

  document.addEventListener(
    "pointerdown",
    () => {
      postFocusToHost(true);
    },
    true,
  );

  window.addEventListener("blur", () => {
    // Immediately blur any focused element so the webview doesn't keep capturing
    // keyboard input while VS Code has already moved focus to the editor.
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    postFocusToHost(false);
    scheduleFocusSyncToHost();
  });

  // Escape inside any focusable element releases webview focus and returns to editor.
  document.addEventListener(
    "keydown",
    (ev) => {
      if (ev.key !== "Escape") return;
      const active = document.activeElement;
      if (!active || active === document.body) return;
      if (active instanceof HTMLElement) {
        active.blur();
      }
      postFocusToHost(false);
      vscode.postMessage({ type: "focusEditor" });
      ev.stopPropagation();
    },
    true,
  );

  vscode.postMessage({ type: "restore" });
  requestAnimationFrame(() => {
    postFocusToHost(document.hasFocus());
  });
})();

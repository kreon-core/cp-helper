(function () {
  const vscode = acquireVsCodeApi();

  /** @type {{ id: string; label: string; timeLimitMs?: number; memoryLimitMb?: number; cases: { sample: number; input: string; output: string }[] }[]} */
  let groups = [];

  /** @type {Record<string, { verdict: string; badge: string; stdout: string; stderr: string; elapsedMs?: number; execMs?: number; overheadMs?: number; timeLimitMs?: number; run?: number }>} */
  const lastRun = {};

  /**
   * Per-group Run all summary: key = group index string. `file` is the source that produced it,
   * which is not necessarily the one a run would compile now.
   * @type {Record<string, { passed: number; total: number; file: string; verdict?: string; counts?: Record<string, number> } | undefined>}
   */
  const lastRunAllSummaryByGroup = {};

  /** Header verdict of a problem is its most severe sample verdict, in this order. */
  const GROUP_VERDICT_ORDER = ["RE", "TLE", "WA", "AC"];

  /** Order of the per-verdict count chips in a problem header. */
  const GROUP_COUNT_ORDER = ["AC", "WA", "TLE", "RE"];

  /** Header tint class per group verdict. */
  const GROUP_VERDICT_CLASSES = GROUP_VERDICT_ORDER.map(
    (v) => `case-group-wrap--${v.toLowerCase()}`,
  );

  /** Stamp of the run a result came from; seeded past the stamps restored from an earlier session. */
  let runStampSeq = Date.now();
  /** @type {Record<string, number | undefined>} */
  const runStampByGroup = {};

  /** Collapsed problem groups: key = `CaseGroup.id`, value true = collapsed (`setState` while session lasts). */
  /** @type {Record<string, boolean>} */
  let groupCollapsed = {};

  /** Collapsed testcases: key = `ck()`, value true = collapsed (`setState` while session lasts). */
  /** @type {Record<string, boolean>} */
  let caseCollapsed = {};

  /** `CaseGroup.id` of a group just created by hand; the next `render` puts the caret in it. */
  let pendingFocusGroupId = "";

  /** Pending `persistRunResults` write, so a Run all writes once instead of once per sample. */
  let saveRunResultsTimer = null;

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
   * Rows with a sample in flight, keyed by `rk(groupIndex, index)`. Run all reports progress as a
   * completion count and runs samples concurrently, so the host says which rows actually started
   * and each `runResult` retires one.
   * @type {Set<string>}
   */
  const runningRows = new Set();

  /**
   * Groups whose case indices changed while a run was in flight. The host keys results by the
   * index it captured at run start, so those are dropped until the next run for that group.
   * @type {Set<number>}
   */
  const staleResultGroups = new Set();

  const NEEDS_CPP_HINT = "Open a C++ file first";

  /**
   * Whether the active editor is a C++ file the host would accept. Run and Debug compile that
   * editor, so they stay disabled until one is open.
   */
  let sourceRunnable = false;
  /**
   * Problem whose run may bind the file it compiles, awaiting that run's source snapshot. A Run
   * button in a problem header sets it unconditionally - clicking Run is how a file is moved off
   * the problem that held it. A keybinding sets it only for a problem no file has claimed, so the
   * keys can adopt a free problem but never take one away from another file.
   * @type {number | null}
   */
  let explicitRunGroup = null;

  /** Path a Run would compile right now; it decides which problem the keybindings act on. */
  let activeSourcePath = "";

  /**
   * Whether OJ Sync is attached to the submit bridge. Submitting goes through the browser session
   * that is already logged in to the judge, so nothing can be sent while it is down.
   */
  let submitBridgeConnected = false;

  /** Submit target title per group index from the host; `null` where the group cannot be submitted. */
  let submitTargets = [];

  /** Group indexes with a submit in flight; problems submit independently of each other. */
  let submitBusyGroups = new Set();

  /**
   * Latest submit outcome per group, keyed by group id so it survives the reindexing a group
   * removal does to positions.
   * @type {Record<string, { text: string; tone: string; title: string; url: string }>}
   */
  let submitStatusByGroup = {};

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
    local: "beaker",
    submit: "cloud-upload",
    file: "file-code",
    edit: "edit",
    timeLimit: "watch",
    memoryLimit: "chip",
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
  const btnAddProblem = $("btnAddProblem");
  const btnClear = $("btnClear");
  const btnExport = $("btnExport");
  const btnStopRun = $("btnStopRun");
  const errEl = $("err");
  const listEl = $("list");
  const listEmptyEl = $("list-empty");
  const activeSourceLabelEl = $("activeSourceLabel");
  const activeSourceWrapEl = $("activeSourceWrap");
  const runnerHintEl = $("runnerHint");
  const runnerHintValueEl = runnerHintEl.querySelector(".runner-hint__value");
  if (!runnerHintValueEl) throw new Error("missing .runner-hint__value");
  const importProblemTitleEl = $("importProblemTitle");
  /** @type {{ label: string; compile: string; localCompile: string; run: string }} */
  let runnerInfo = { label: "", compile: "", localCompile: "", run: "" };
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

  /**
   * Format a memory limit in MB: "256MB", or "1GB" / "1.5GB" from 1024 MB up.
   * @param {number} mb
   * @returns {string}
   */
  function formatMemoryLimit(mb) {
    if (mb < 1024) return `${mb}MB`;
    return `${Number((mb / 1024).toFixed(2))}GB`;
  }

  /**
   * Verdict, program time and overhead read as separate chips: the verdict keeps the pass/fail
   * colour, the timings stay neutral so they are not mistaken for part of the status. A case with
   * no result still gets every chip as a blank placeholder, so the action buttons sit in the same
   * column on every row of the list.
   * @param {HTMLElement} head
   * @param {{ verdict: string; elapsedMs?: number; execMs?: number; overheadMs?: number; timeLimitMs?: number } | null} runInfo
   * @param {Element | null} before insertion anchor, or null to append
   * @param {boolean} [running] sample in flight: the verdict slot holds the spinner
   */
  function appendCaseStatus(head, runInfo, before, running) {
    const execMs = runInfo
      ? (runInfo.execMs != null ? runInfo.execMs : runInfo.elapsedMs)
      : undefined;
    const elapsed = formatElapsed(execMs).trim();
    const overhead =
      runInfo && runInfo.overheadMs != null
        ? `+${formatElapsed(runInfo.overheadMs).trim()}`
        : "";
    const put = (el) => {
      if (before) {
        head.insertBefore(el, before);
      } else {
        head.appendChild(el);
      }
    };
    const mk = (kind, text, hint) => {
      const el = document.createElement("span");
      el.className = `case-status case-${kind}`;
      if (text === "") {
        el.classList.add("case-status--blank");
        el.setAttribute("aria-hidden", "true");
      } else {
        el.textContent = text;
        if (hint) {
          el.title = hint;
        }
      }
      put(el);
    };
    const limitMs = runInfo && runInfo.timeLimitMs != null ? runInfo.timeLimitMs : null;
    const timeHint =
      limitMs != null
        ? `Time (limit${formatElapsed(limitMs)})`
        : "Time";
    if (running) {
      const slot = document.createElement("span");
      slot.className = "case-status case-verdict case-verdict--running";
      slot.title = "Running";
      slot.setAttribute("aria-label", "Running");
      const spin = document.createElement("span");
      spin.className = "run-row-spinner";
      spin.setAttribute("aria-hidden", "true");
      slot.appendChild(spin);
      put(slot);
    } else {
      mk("verdict", runInfo ? runInfo.verdict : "");
    }
    mk("time", elapsed, timeHint);
    mk("overhead", overhead, "Overhead");
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

  let listScrollHeldTop = 0;
  let listScrollHeld = false;

  /**
   * Runs a height pass with the list's scroll offset held. Fitting sets a field to `height: auto`
   * and reads it back, so mid-pass the list is shorter than its content was; once that drops below
   * the current offset the browser clamps `scrollTop` and never puts it back, which reads as the
   * list jumping to the top while typing. Nested passes are held by the outermost caller.
   * @param {() => void} fn
   */
  function withListScrollHeld(fn) {
    if (listScrollHeld) {
      fn();
      return;
    }
    listScrollHeld = true;
    listScrollHeldTop = listEl.scrollTop;
    try {
      fn();
    } finally {
      listScrollHeld = false;
      if (listEl.scrollTop !== listScrollHeldTop) {
        listEl.scrollTop = listScrollHeldTop;
      }
    }
  }

  /**
   * @param {HTMLElement} ta editable field or read-only `pre`
   * @param {number} capPx
   */
  function fitTextarea(ta, capPx) {
    withListScrollHeld(() => {
      const minH = 32;
      ta.style.height = "auto";
      const target = Math.max(minH, Math.min(ta.scrollHeight, capPx));
      ta.style.height = `${target}px`;
      ta.style.overflowY = ta.scrollHeight > capPx ? "auto" : "hidden";
    });
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

  /**
   * Draws the `.field-scroll` line for one sample or output area, creating it on first need. The
   * line is never shorter than 16px, so a heavily clipped field still shows something.
   * @param {HTMLElement} area
   */
  function syncFieldScrollIndicator(area) {
    const field = area.closest(".field");
    if (!(field instanceof HTMLElement)) {
      return;
    }
    let bar = field.querySelector(":scope > .field-scroll");
    const view = area.clientHeight;
    const total = area.scrollHeight;
    /**
     * `fitTextarea` and the equalize pass both set `overflow-y` inline, so it is the exact record
     * of whether this field was left scrollable. Checking it keeps the line off a field that only
     * overflows by a rounding pixel, where a full-height bar would claim hidden content.
     */
    const scrollable =
      area.style.overflowY === "auto" && view > 0 && total - view >= 4;
    if (!scrollable) {
      if (bar instanceof HTMLElement) {
        bar.hidden = true;
      }
      return;
    }
    if (!(bar instanceof HTMLElement)) {
      bar = document.createElement("span");
      bar.className = "field-scroll";
      bar.setAttribute("aria-hidden", "true");
      field.appendChild(bar);
    }
    const h = Math.max(16, Math.round((view * view) / total));
    const progress = Math.min(1, Math.max(0, area.scrollTop / (total - view)));
    bar.hidden = false;
    bar.style.height = `${h}px`;
    bar.style.top = `${area.offsetTop + 2 + Math.round((view - h - 4) * progress)}px`;
  }

  function syncAllFieldScrollIndicators() {
    listEl
      .querySelectorAll(".input-area")
      .forEach((el) => syncFieldScrollIndicator(/** @type {HTMLElement} */ (el)));
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
        withListScrollHeld(() => equalizeResultColumns());
      } finally {
        equalizing = false;
      }
      syncAllFieldScrollIndicators();
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
    if (src.classList.contains("input-area")) {
      syncFieldScrollIndicator(src);
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
    syncAllFieldScrollIndicators();
    syncStickyOffsets();
  }

  /**
   * Sample headers stick below their group header, whose height varies with wrapping and with the
   * run status label, so each group publishes its own measured offset.
   */
  function syncStickyOffsets() {
    listEl
      .querySelectorAll("li.case-group-wrap[data-cp-gi]")
      .forEach((wrap) => {
        const head = wrap.querySelector(":scope > .case-group-head");
        const h = head && !head.hidden ? head.offsetHeight : 0;
        wrap.style.setProperty("--cp-sticky-top", `${h}px`);
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
   * The run target readout from the toolbar, rebuilt inside a problem header.
   * @param {HTMLElement} chip
   * @param {string} fullPath
   * @param {boolean} current whether this is also the file a run would compile now
   */
  function paintGroupSourceChip(chip, fullPath, current) {
    chip.replaceChildren();
    const icon = mkIcon("file");
    icon.classList.add("meta-chip__icon");
    chip.appendChild(icon);
    const label = document.createElement("span");
    label.className = "case-group-src__label";
    paintSourcePathInto(label, fullPath);
    chip.appendChild(label);
    chip.classList.toggle("case-group-src--current", current);
    chip.title = `${fullPath}\nClick to open, right-click to unlink`;
    chip.setAttribute(
      "aria-label",
      current
        ? `Open ${fullPath}, the open file this problem is bound to`
        : `Open ${fullPath}, the file this problem is bound to`,
    );
  }

  /**
   * Most severe verdict among a problem's samples (RE, then TLE, then WA). A sample without a
   * result counts as WA, since it did not pass.
   * @param {(string | undefined)[]} verdicts
   * @returns {string}
   */
  function worstVerdict(verdicts) {
    let worst = GROUP_VERDICT_ORDER.length - 1;
    for (const v of verdicts) {
      const at = GROUP_VERDICT_ORDER.indexOf(v ?? "WA");
      worst = Math.min(worst, at === -1 ? GROUP_VERDICT_ORDER.indexOf("WA") : at);
    }
    return GROUP_VERDICT_ORDER[worst];
  }

  /**
   * Samples per verdict. A sample without a result, or with a verdict the header does not tint,
   * counts as WA.
   * @param {(string | undefined)[]} verdicts
   * @returns {Record<string, number>}
   */
  function countVerdicts(verdicts) {
    /** @type {Record<string, number>} */
    const counts = {};
    for (const v of verdicts) {
      const key = v !== undefined && GROUP_COUNT_ORDER.includes(v) ? v : "WA";
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }

  /**
   * Fill a problem's summary slot with one chip per verdict that occurred ("2 AC", "1 TLE").
   * @param {HTMLElement} sumEl
   * @param {Record<string, number>} counts
   */
  function paintVerdictCounts(sumEl, counts) {
    sumEl.replaceChildren();
    for (const v of GROUP_COUNT_ORDER) {
      const n = counts[v] ?? 0;
      if (n <= 0) continue;
      const chip = document.createElement("span");
      chip.className = `case-group-count case-group-count--${v.toLowerCase()}`;
      chip.textContent = `${n} ${v}`;
      sumEl.appendChild(chip);
    }
  }

  /**
   * Paint a problem's result state onto its header: the pass/fail tint, the Run all count, and the
   * source the problem is bound to, highlighted while that is the file in the editor and muted
   * otherwise. A single sample tints the header too, but leaves the count off: one case is not a
   * verdict for the problem. The source comes from the binding, not from the count.
   * @param {HTMLElement} wrap
   * @param {HTMLElement} sumEl
   * @param {HTMLElement} srcEl
   * @param {number} gi
   */
  function paintGroupResults(wrap, sumEl, srcEl, gi) {
    const bound = groups[gi]?.source ?? "";
    const stale = bound !== "" && bound !== activeSourcePath;
    wrap.classList.toggle("case-group-wrap--stale", stale);
    srcEl.hidden = bound === "";
    if (bound !== "") {
      paintGroupSourceChip(srcEl, bound, !stale);
    }
    const gs = lastRunAllSummaryByGroup[gi];
    sumEl.textContent = "";
    if (!gs || gs.total <= 0) {
      sumEl.removeAttribute("title");
      wrap.classList.remove(...GROUP_VERDICT_CLASSES);
      return;
    }
    const verdict =
      typeof gs.verdict === "string" && GROUP_VERDICT_ORDER.includes(gs.verdict)
        ? gs.verdict
        : gs.passed === gs.total
          ? "AC"
          : "WA";
    const tint = `case-group-wrap--${verdict.toLowerCase()}`;
    GROUP_VERDICT_CLASSES.forEach((c) => wrap.classList.toggle(c, c === tint));
    if (gs.partial) {
      sumEl.removeAttribute("title");
      return;
    }
    paintVerdictCounts(
      sumEl,
      gs.counts && typeof gs.counts === "object"
        ? gs.counts
        : { AC: gs.passed, WA: gs.total - gs.passed },
    );
    const ran =
      gs.file !== "" ? ` - ${pathToParentAndName(gs.file)}` : "";
    sumEl.title = stale
      ? `${gs.passed}/${gs.total} passed${ran} (not the current file)`
      : `${gs.passed}/${gs.total} passed${ran}`;
  }

  /**
   * Parent folder dimmed, file name at full strength, so the name a glance is looking for wins.
   * @param {string} fullPath
   */
  function paintSourcePathInto(el, fullPath) {
    const text = pathToParentAndName(fullPath);
    const cut = text.lastIndexOf("/");
    el.replaceChildren();
    if (cut > 0) {
      const dir = document.createElement("span");
      dir.className = "active-source-label__dir";
      dir.textContent = text.slice(0, cut + 1);
      el.appendChild(dir);
    }
    const name = document.createElement("span");
    name.textContent = cut > 0 ? text.slice(cut + 1) : text;
    el.appendChild(name);
  }

  function paintActiveSourceLabel(fullPath) {
    paintSourcePathInto(activeSourceLabelEl, fullPath);
  }

  /**
   * Run target (the active C++ editor, or the last one visited), or the snapshotted path while a
   * run is in progress.
   * @param {{ path: string | null; running?: boolean; cpp?: boolean }} m
   */
  function updateActiveSourceLabel(m) {
    const p = m.path ?? null;
    const running = !!m.running;
    const cpp = m.cpp !== false;
    if (p) {
      paintActiveSourceLabel(p);
      activeSourceLabelEl.title = running ? `Running: ${p}` : `Run target: ${p}`;
      activeSourceLabelEl.setAttribute(
        "aria-label",
        running ? `Running: ${p}` : `Run target: ${p}`,
      );
      activeSourceLabelEl.classList.remove("active-source-label--empty");
    } else {
      activeSourceLabelEl.textContent = "No file";
      activeSourceLabelEl.title = "No C++ file open";
      activeSourceLabelEl.setAttribute(
        "aria-label",
        "No C++ file for Run",
      );
      activeSourceLabelEl.classList.add("active-source-label--empty");
    }
    activeSourceLabelEl.classList.toggle(
      "active-source-label--running",
      running && !!p,
    );
    activeSourceWrapEl.classList.toggle("meta-chip--running", running && !!p);
    sourceRunnable = !!p && cpp;
    activeSourcePath = p ?? "";
    if (
      running &&
      p &&
      typeof m.groupIndex === "number" &&
      explicitRunGroup === m.groupIndex
    ) {
      explicitRunGroup = null;
      bindGroupSource(m.groupIndex, p);
    }
    applyToolbarAndImportState();
    syncRunAffordances();
    // Which problem the keybindings act on, and which results are another file's, follow the editor.
    syncActiveProblemTitle();
    if (incrementalDomReady()) {
      syncMultiGroupHeadersFromState();
    } else {
      render();
    }
  }

  /**
   * Enables or disables every button that compiles the active editor, in place: a tab switch must
   * not rebuild the list.
   */
  function syncRunAffordances() {
    listEl.querySelectorAll(".needs-cpp").forEach((btn) => {
      const disabled = runDisabled(btn);
      btn.disabled = disabled;
      if (disabled && !sourceRunnable) {
        btn.title = NEEDS_CPP_HINT;
      } else if (btn.dataset.cpTitle) {
        btn.title = btn.dataset.cpTitle;
      }
    });
  }

  /**
   * @param {Element} btn
   * @returns {boolean}
   */
  function runDisabled(btn) {
    if (!btn.classList.contains("case-group__run-all")) {
      return !sourceRunnable;
    }
    const wrap = btn.closest("li.case-group-wrap[data-cp-gi]");
    const gi = wrap ? Number(wrap.getAttribute("data-cp-gi")) : NaN;
    return !sourceRunnable || (groups[gi]?.cases.length ?? 0) === 0;
  }

  function rk(gi, ci) {
    return `${gi}-${ci}`;
  }

  /**
   * Collapse key for a testcase. Keyed by group id and sample number so it survives the
   * reindexing that a case or group removal does to `rk()` keys.
   * @param {number} gi
   * @param {number} ci
   * @returns {string}
   */
  function ck(gi, ci) {
    const gid = String(groups[gi]?.id ?? gi);
    const sample = groups[gi]?.cases?.[ci]?.sample ?? ci + 1;
    return `${gid}::${sample}`;
  }

  function totalCaseCount() {
    return groups.reduce((n, g) => n + g.cases.length, 0);
  }

  /**
   * Problem the run keybindings act on: the one bound to the file a run would compile, else the
   * first problem no file has claimed. Position is only the tie-breaker - a source file drives its
   * own problem wherever it sits. Every problem already taken by another file means the keybindings
   * have no target, since running one of them would compile a file that is not the one it belongs
   * to; -1 says so, and a Run button in a problem header is what moves a binding.
   * @returns {number} group index, or -1 when no problem belongs to the file in the editor
   */
  function shortcutTargetGroup() {
    if (activeSourcePath !== "") {
      const bound = groups.findIndex(
        (g) => (g.source ?? "") === activeSourcePath,
      );
      if (bound >= 0) {
        return bound;
      }
      const free = groups.findIndex((g) => (g.source ?? "") === "");
      return free;
    }
    return 0;
  }

  /** Why a keybinding had nowhere to go: every problem is being solved in some other file. */
  function unboundSourceHint() {
    const name = pathToParentAndName(activeSourcePath);
    return `${name || "This file"} is not linked to a problem, and every problem is linked to another file - press Run in a problem header to move it here`;
  }

  /**
   * Remember which file a problem is being solved in. Only a Run button inside a problem does this,
   * so a keybinding never moves a binding the user set by hand. A file solves one problem at a
   * time: binding it here drops it from whichever problem held it before, results and submit
   * status included.
   * @param {number} gi
   * @param {string} file
   */
  function bindGroupSource(gi, file) {
    const g = groups[gi];
    if (!g || file === "") {
      return;
    }
    let changed = false;
    groups.forEach((other, i) => {
      if (i !== gi && (other.source ?? "") === file) {
        delete other.source;
        purgeLastRunForGroup(i);
        setSubmitStatus(i, "", "");
        changed = true;
      }
    });
    if ((g.source ?? "") !== file) {
      g.source = file;
      changed = true;
    }
    if (changed) {
      persist();
    }
  }

  /**
   * Drop a problem's file binding. The chip in the header is the only place a binding is visible,
   * so right-clicking it is what takes back a binding a stray Run left behind. The problem's
   * results and submit status go with it: every verdict on screen describes the file just unlinked.
   * @param {number} gi
   */
  function unbindGroupSource(gi) {
    const g = groups[gi];
    if (!g || (g.source ?? "") === "") {
      return;
    }
    delete g.source;
    purgeLastRunForGroup(gi);
    setSubmitStatus(gi, "", "");
    persist();
    if (incrementalDomReady()) {
      syncMultiGroupHeadersFromState();
    } else {
      render();
    }
    applySubmitButtonsState();
  }

  /**
   * Header text for a problem; unnamed groups (a bare testcase array, a stress case) still need
   * something to click on.
   * @param {number} gi
   */
  function groupDisplayLabel(gi) {
    const label = (groups[gi]?.label ?? "").trim();
    return label !== "" ? label : `Group ${gi + 1}`;
  }

  /** The unnamed empty bucket `ensureDefaultGroup` leaves behind: a list with nothing on it yet. */
  function isNoProblemsPlaceholder() {
    return (
      groups.length === 1 &&
      (groups[0].label ?? "").trim() === "" &&
      (groups[0].cases?.length ?? 0) === 0
    );
  }

  /**
   * First `custom/N` that no group holds. Numbering off the group count instead hands out a label
   * already on screen as soon as one has been deleted or an import landed in between.
   */
  function nextCustomLabel() {
    const taken = new Set(
      groups.map((g) => (g.label ?? "").trim().toLowerCase()),
    );
    let n = 1;
    while (taken.has(`custom/${n}`)) {
      n += 1;
    }
    return `custom/${n}`;
  }

  function addCustomProblemGroup() {
    if (runState.active) return;
    const newId = `manual-${Date.now()}`;
    const group = {
      id: newId,
      label: nextCustomLabel(),
      cases: [{ sample: 1, input: "", output: "" }],
    };
    if (isNoProblemsPlaceholder()) {
      const oldId = String(groups[0].id ?? "");
      if (oldId) {
        delete groupCollapsed[oldId];
      }
      groups[0] = group;
      delete lastRunAllSummaryByGroup[0];
    } else {
      groups.push(group);
    }
    // An import arrives collapsed because its samples are already filled in; a problem asked for
    // by hand is empty and about to be typed into.
    delete groupCollapsed[newId];
    delete caseCollapsed[`${newId}::1`];
    pendingFocusGroupId = newId;
    persistWebviewNavState();
    persist();
    render();
  }

  /**
   * Enter or focus loss keeps what was typed, Escape drops it.
   * @param {number} gi
   */
  function startGroupRename(gi) {
    if (runState.active) return;
    const wrap = listEl.querySelector(
      `li.case-group-wrap[data-cp-gi="${gi}"]`,
    );
    const head = wrap?.querySelector(":scope > .case-group-head");
    if (!head || head.querySelector(".case-group-rename")) {
      return;
    }
    const disclose = head.querySelector(".case-group-disclose");
    const renameBtn = head.querySelector(".case-group__rename");
    if (!disclose) {
      return;
    }
    const before = (groups[gi]?.label ?? "").trim();
    const input = document.createElement("input");
    input.type = "text";
    input.className = "case-group-rename";
    input.spellcheck = false;
    input.maxLength = 120;
    input.value = before;
    input.placeholder = `Group ${gi + 1}`;
    input.setAttribute("aria-label", "Problem name");
    disclose.hidden = true;
    if (renameBtn) {
      renameBtn.hidden = true;
    }
    head.insertBefore(input, disclose);
    let settled = false;
    /** @param {boolean} commit */
    const finish = (commit) => {
      if (settled) return;
      settled = true;
      const next = input.value.trim();
      input.remove();
      disclose.hidden = false;
      if (renameBtn) {
        renameBtn.hidden = false;
      }
      if (!commit || next === before || !groups[gi]) {
        return;
      }
      groups[gi].label = next;
      persist();
      render();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    input.focus();
    input.select();
  }

  /** Caret into the group `addCustomProblemGroup` just made, once `render` has built its rows. */
  function focusPendingGroup() {
    const gid = pendingFocusGroupId;
    pendingFocusGroupId = "";
    if (gid === "") {
      return;
    }
    const gi = groups.findIndex((g) => String(g.id ?? "") === gid);
    if (gi < 0) {
      return;
    }
    const wrap = listEl.querySelector(
      `li.case-group-wrap[data-cp-gi="${gi}"]`,
    );
    if (!wrap) {
      return;
    }
    wrap.scrollIntoView({ block: "nearest" });
    const ta = wrap.querySelector(".field--input .input-area");
    if (ta) {
      ta.focus();
    }
  }

  /**
   * When the Samples list shows a header row per problem, default every group to collapsed.
   * @param {{ id: string; label: string; cases: unknown[] }[]} gs
   * @returns {Record<string, boolean>}
   */
  function defaultCollapsedAllHeaders(gs) {
    /** @type {Record<string, boolean>} */
    const out = {};
    for (let i = 0; i < gs.length; i++) {
      const gid = String(gs[i]?.id ?? i);
      if (gid) {
        out[gid] = true;
      }
    }
    return out;
  }

  /**
   * Testcases start collapsed so a long sample list reads as a list. Keys absent from the map
   * count as expanded, which is what a case added later wants.
   * @param {{ id: string; cases: { sample: number }[] }[]} gs
   * @returns {Record<string, boolean>}
   */
  function defaultCollapsedAllCases(gs) {
    /** @type {Record<string, boolean>} */
    const out = {};
    for (let i = 0; i < gs.length; i++) {
      const gid = String(gs[i]?.id ?? i);
      const cases = gs[i]?.cases ?? [];
      for (let j = 0; j < cases.length; j++) {
        out[`${gid}::${cases[j]?.sample ?? j + 1}`] = true;
      }
    }
    return out;
  }

  /**
   * Hand the submit outcomes to the host, which keeps them in workspace state.
   */
  function persistSubmitStatus() {
    vscode.postMessage({
      type: "saveSubmitStatus",
      status: submitStatusByGroup,
    });
  }

  /**
   * Paint back the submit outcomes of an earlier session. Entries for a group that is gone are
   * dropped: the samples are the truth.
   * @param {unknown} stored blob from the host, keyed by `CaseGroup.id`
   */
  function restoreSubmitStatus(stored) {
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return;
    }
    groups.forEach((g, gi) => {
      const gid = String(g?.id ?? gi);
      const st = stored[gid];
      if (!st || typeof st !== "object" || typeof st.text !== "string" || st.text === "") {
        return;
      }
      submitStatusByGroup[gid] = {
        text: st.text,
        tone: typeof st.tone === "string" ? st.tone : "",
        title: typeof st.title === "string" && st.title !== "" ? st.title : st.text,
        url: typeof st.url === "string" ? st.url : "",
      };
    });
  }

  /**
   * Collapse state for a list that has just been replaced. A group or case the previous list
   * already held keeps whatever the user left it at; anything new takes the collapsed default.
   * @param {Record<string, boolean>} prev
   * @param {Record<string, boolean>} defaults
   * @param {Set<string>} known keys the previous list held
   * @returns {Record<string, boolean>}
   */
  function carryCollapsed(prev, defaults, known) {
    /** @type {Record<string, boolean>} */
    const out = {};
    for (const k of Object.keys(defaults)) {
      if (known.has(k) ? prev[k] : defaults[k]) {
        out[k] = true;
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
    base.caseCollapsed = { ...caseCollapsed };
    delete base.lastCollapseFingerprint;
    vscode.setState(base);
  }

  /**
   * Results as the host stores them: keyed by group id and sample number, so a reload, a reorder
   * or a re-import of the same problem still lands each result on the row it came from. Index
   * keys (`rk()`) would not survive any of that.
   * @returns {Record<string, { summary?: object; cases: Record<string, object> }>}
   */
  function snapshotRunResults() {
    const out = {};
    groups.forEach((g, gi) => {
      const gid = String(g?.id ?? "");
      if (gid === "") {
        return;
      }
      const cases = {};
      (g.cases ?? []).forEach((c, ci) => {
        const r = lastRun[rk(gi, ci)];
        if (r) {
          cases[String(c?.sample ?? ci + 1)] = r;
        }
      });
      const summary = lastRunAllSummaryByGroup[gi];
      if (!summary && Object.keys(cases).length === 0) {
        return;
      }
      out[gid] = summary ? { summary, cases } : { cases };
    });
    return out;
  }

  /**
   * Paint back what a previous session ran. A sample the problem no longer has, or a group id that
   * is gone, is dropped: the samples are the truth, the results only describe them.
   * @param {unknown} stored blob from the host, shaped by `snapshotRunResults`
   */
  function restoreRunResults(stored) {
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
      return;
    }
    groups.forEach((g, gi) => {
      const entry = stored[String(g?.id ?? "")];
      if (!entry || typeof entry !== "object") {
        return;
      }
      const cases = entry.cases;
      if (cases && typeof cases === "object") {
        (g.cases ?? []).forEach((c, ci) => {
          const r = cases[String(c?.sample ?? ci + 1)];
          if (r && typeof r === "object" && typeof r.badge === "string") {
            lastRun[rk(gi, ci)] = r;
          }
        });
      }
      const summary = entry.summary;
      if (summary && typeof summary === "object" && typeof summary.total === "number") {
        lastRunAllSummaryByGroup[gi] = summary;
      }
    });
  }

  /**
   * Hand the results to the host, which keeps them in workspace state. Coalesced, because a Run all
   * streams one result per sample and only the last one is worth a write.
   */
  function persistRunResults() {
    if (saveRunResultsTimer !== null) {
      clearTimeout(saveRunResultsTimer);
    }
    saveRunResultsTimer = setTimeout(() => {
      saveRunResultsTimer = null;
      vscode.postMessage({
        type: "saveRunResults",
        results: snapshotRunResults(),
      });
    }, 250);
  }

  function pruneGroupCollapseState() {
    const ids = new Set(groups.map((g) => String(g.id ?? "")));
    let changed = false;
    let submitChanged = false;
    for (const k of Object.keys(submitStatusByGroup)) {
      if (!ids.has(k)) {
        delete submitStatusByGroup[k];
        submitChanged = true;
      }
    }
    if (submitChanged) {
      persistSubmitStatus();
    }
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
      return false;
    }
    if (groupCollapsed[id]) {
      delete groupCollapsed[id];
    } else {
      groupCollapsed[id] = true;
    }
    persistWebviewNavState();
    return !!groupCollapsed[id];
  }

  /**
   * Applies one group's collapsed state to its own header and panel. Like the per-case
   * disclosure, toggling patches these nodes instead of calling `render()`, and `animate` keeps
   * the expand animation on a real disclosure - replaying it for every group on an unrelated
   * render (adding a group, a run finishing) is what reads as a flick.
   * @param {HTMLElement} wrap
   * @param {HTMLElement} inner
   * @param {HTMLElement} disclose
   * @param {HTMLElement} chev
   * @param {string} labelText
   * @param {boolean} collapsed
   * @param {boolean} animate
   */
  function applyGroupCollapsedUi(
    wrap,
    inner,
    disclose,
    chev,
    labelText,
    collapsed,
    animate,
  ) {
    wrap.classList.toggle("case-group-wrap--collapsed", collapsed);
    inner.hidden = collapsed;
    inner.setAttribute("aria-hidden", collapsed ? "true" : "false");
    inner.classList.toggle("case-group-cases--expanding", animate && !collapsed);
    disclose.setAttribute("aria-expanded", collapsed ? "false" : "true");
    chev.classList.add("codicon", "codicon-chevron-right");
    chev.classList.toggle("disclose-chev--open", !collapsed);
    const hint = collapsed ? `Expand ${labelText}` : `Collapse ${labelText}`;
    disclose.title = hint;
    disclose.setAttribute("aria-label", hint);
  }

  /**
   * @param {string} key
   * @returns {boolean} the new collapsed state
   */
  function toggleCaseCollapsed(key) {
    const k = String(key ?? "");
    if (!k) {
      return false;
    }
    if (caseCollapsed[k]) {
      delete caseCollapsed[k];
    } else {
      caseCollapsed[k] = true;
    }
    persistWebviewNavState();
    return !!caseCollapsed[k];
  }

  /**
   * Applies one case's collapsed state to its own row. Toggling patches these four nodes rather
   * than calling `render()`: rebuilding the list for a disclosure flashes every other row and
   * restarts the group's expand animation.
   * @param {HTMLElement} li
   * @param {HTMLElement} body
   * @param {HTMLElement} btn
   * @param {HTMLElement} chev
   * @param {number} sample
   * @param {boolean} collapsed
   */
  function applyCaseCollapsedUi(li, body, btn, chev, sample, collapsed) {
    li.classList.toggle("case--collapsed", collapsed);
    body.hidden = collapsed;
    body.setAttribute("aria-hidden", collapsed ? "true" : "false");
    btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    chev.classList.add("codicon", "codicon-chevron-right");
    chev.classList.toggle("disclose-chev--open", !collapsed);
    const hint = collapsed
      ? `Expand sample ${sample}`
      : `Collapse sample ${sample}`;
    btn.title = hint;
    btn.setAttribute("aria-label", hint);
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
   * @param {{ label?: string; compileCommand?: string; localCompileCommand?: string; runCommand?: string }} m
   */
  function updateRunnerHint(m) {
    runnerInfo = {
      label: typeof m?.label === "string" ? m.label.trim() : "",
      compile: typeof m?.compileCommand === "string" ? m.compileCommand : "",
      localCompile:
        typeof m?.localCompileCommand === "string" ? m.localCompileCommand : "",
      run: typeof m?.runCommand === "string" ? m.runCommand : "",
    };
    renderRunnerHint();
  }

  /**
   * Hover text spells out what the label stands for: both compile lines the two run buttons use,
   * and the run line.
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
    paintRunnerLabel(label);
    runnerHintEl.hidden = false;
    const lines = [`Runner: ${label}`];
    lines.push(
      compile
        ? `Compile (normal): ${compile}`
        : "Compile: skipped (compileCommand is empty)",
    );
    lines.push(`Compile (LOCAL): ${localCompileForDisplay() || "skipped"}`);
    if (run) {
      lines.push(`Run: ${run}`);
    }
    const text = lines.join("\n");
    runnerHintEl.title = text;
    runnerHintEl.setAttribute("aria-label", text);
  }

  /**
   * `resolveRunnerLabel` joins compiler and standard with " - ", which reads like part of a flag.
   * Split it back apart so the two facts sit either side of a divider.
   * @param {string} label
   */
  function paintRunnerLabel(label) {
    const cut = label.indexOf(" - ");
    runnerHintValueEl.textContent = "";
    if (cut < 0) {
      runnerHintValueEl.textContent = label;
      return;
    }
    const name = document.createElement("span");
    name.textContent = label.slice(0, cut);
    const std = document.createElement("span");
    std.className = "runner-hint__std";
    std.textContent = label.slice(cut + 3);
    runnerHintValueEl.appendChild(name);
    runnerHintValueEl.appendChild(std);
  }

  /**
   * Mirrors `selectRunCompile` for display only: the LOCAL command when configured, otherwise the
   * NORMAL one with `-DLOCAL` injected.
   * @returns {string}
   */
  function localCompileForDisplay() {
    const { compile, localCompile } = runnerInfo;
    if (localCompile) {
      return localCompile;
    }
    return compile ? withLocalDefine(compile) : compile;
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
   * Names the problem the keybindings would run, so the title says where the next ctrl+enter goes.
   */
  function syncActiveProblemTitle() {
    const hasProblem = groups.length > 0 && !isNoProblemsPlaceholder();
    const gi = hasProblem ? shortcutTargetGroup() : 0;
    updateImportProblemTitle(
      hasProblem && gi >= 0 ? groupDisplayLabel(gi) : "",
      hasProblem ? "No problem for this file" : "No problem imported",
    );
  }

  /**
   * Contest / problem id from OJ Sync (e.g. atcoder/abc451_a).
   * @param {string | null | undefined} label
   * @param {string} [emptyText] what the title reads when no problem is the keybinding target
   */
  function updateImportProblemTitle(label, emptyText) {
    const t = typeof label === "string" ? label.trim() : "";
    importProblemTitleEl.classList.toggle("import-problem-title--empty", !t);
    if (!t) {
      importProblemTitleEl.textContent = emptyText || "No problem imported";
      importProblemTitleEl.removeAttribute("title");
      importProblemTitleEl.setAttribute("aria-label", "Active problem");
    } else {
      importProblemTitleEl.textContent = t;
      importProblemTitleEl.title = t;
      importProblemTitleEl.setAttribute("aria-label", `Active problem: ${t}`);
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

  /**
   * Drop every result a problem is showing: the case rows' verdicts and the header's tint and
   * count. A single-sample run starts with this, so what the header and the rows show belongs to
   * that run alone - one sample leaves its own tint and no verdict from a run now history.
   * @param {number} gi
   */
  function purgeLastRunForGroup(gi) {
    const prefix = `${gi}-`;
    Object.keys(lastRun).forEach((k) => {
      if (k.startsWith(prefix)) delete lastRun[k];
    });
    delete lastRunAllSummaryByGroup[gi];
    persistRunResults();
    if (!incrementalDomReady()) {
      return;
    }
    const n = groups[gi]?.cases?.length ?? 0;
    for (let ci = 0; ci < n; ci++) {
      patchCaseRowFromLastRun(gi, ci);
    }
  }

  /**
   * Retire the rows a finished Run all never reached, so what the list shows belongs to that run
   * alone. A run that produced no verdict at all never started, and leaves the list as it was.
   * @param {number} gi
   */
  function dropRowsFromEarlierRuns(gi) {
    const stamp = runStampByGroup[gi];
    const prefix = `${gi}-`;
    const keys = Object.keys(lastRun).filter((k) => k.startsWith(prefix));
    if (stamp === undefined || !keys.some((k) => lastRun[k].run === stamp)) {
      return;
    }
    const dropped = [];
    keys.forEach((k) => {
      if (lastRun[k].run !== stamp) {
        delete lastRun[k];
        dropped.push(Number(k.slice(prefix.length)));
      }
    });
    if (dropped.length === 0) {
      return;
    }
    persistRunResults();
    if (!incrementalDomReady()) {
      return;
    }
    dropped.forEach((ci) => patchCaseRowFromLastRun(gi, ci));
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
   * Codeforces spells its verdicts out in full ("Memory limit exceeded on test 4"), which does not
   * fit a toolbar. The short form matches the sample chips; the full text stays in the tooltip.
   * Anything unrecognised passes through, which is what keeps AtCoder's own `WJ` and `19/33`
   * readouts intact while a submission is still being judged.
   * @param {string} verdict
   * @returns {string}
   */
  function shortVerdict(verdict) {
    const v = verdict.trim().replace(/^\d+\s*\/\s*\d+\s+/u, "");
    const table = [
      [/^accepted|^happy new year|^ok\b/iu, "AC"],
      [/^wrong answer/iu, "WA"],
      [/^time limit exceeded/iu, "TLE"],
      [/^memory limit exceeded/iu, "MLE"],
      [/^idleness limit exceeded/iu, "ILE"],
      [/^runtime error/iu, "RE"],
      [/^compilation error/iu, "CE"],
      [/^presentation error/iu, "PE"],
      [/^partial/iu, "PARTIAL"],
      [/^hacked/iu, "HACKED"],
      [/^skipped/iu, "SKIPPED"],
      [/^in queue/iu, "QUEUED"],
      [/^running/iu, "RUN"],
    ];
    for (const [re, short] of table) {
      if (re.test(v)) {
        return short;
      }
    }
    return v;
  }

  /**
   * @param {HTMLButtonElement} el status chip in a problem header
   * @param {{ text: string; tone: string; title: string; url: string } | undefined} st
   */
  function paintSubmitStatusEl(el, st) {
    const text = st?.text ?? "";
    const url = st?.url ?? "";
    const full = st?.title ?? text;
    el.textContent = text;
    el.hidden = text === "";
    el.dataset.cpUrl = url;
    el.title = url !== "" ? `${full} - click to open` : full;
    el.disabled = url === "";
    el.setAttribute("aria-label", full);
    el.classList.toggle("submit-status--ok", st?.tone === "ok");
    el.classList.toggle("submit-status--bad", st?.tone === "bad");
  }

  /**
   * Record and show one problem's submit stage or verdict. Empty `text` clears it.
   * @param {number} gi
   * @param {string} text
   * @param {string} [tone] "ok" | "bad"
   * @param {string} [title] long form for the tooltip
   * @param {string} [url] submission page, when the judge gave one
   */
  function setSubmitStatus(gi, text, tone, title, url) {
    const gid = String(groups[gi]?.id ?? "");
    if (!gid) {
      return;
    }
    if (text === "") {
      delete submitStatusByGroup[gid];
    } else {
      submitStatusByGroup[gid] = {
        text,
        tone: tone ?? "",
        title: typeof title === "string" && title !== "" ? title : text,
        url: typeof url === "string" ? url : "",
      };
    }
    const el = listEl.querySelector(
      `button.submit-status[data-cp-gi="${gi}"]`,
    );
    if (el) {
      paintSubmitStatusEl(el, submitStatusByGroup[gid]);
    }
    persistSubmitStatus();
  }

  /**
   * @returns {number[]} group indexes the host resolved to a judge submit target
   */
  function submittableGroups() {
    const out = [];
    groups.forEach((_, i) => {
      if (typeof submitTargets[i] === "string" && submitTargets[i] !== "") {
        out.push(i);
      }
    });
    return out;
  }

  /**
   * @param {number} gi
   * @returns {string | null} why Submit is unavailable, or null when it is ready
   */
  function submitBlockedReason(gi) {
    if (typeof submitTargets[gi] !== "string" || submitTargets[gi] === "") {
      return "Submit supports Codeforces and AtCoder only";
    }
    if (!submitBridgeConnected) {
      return "OJ Sync not connected";
    }
    if (submitBusyGroups.has(gi)) {
      return "Submitting";
    }
    const linked = groups[gi]?.source ?? "";
    if (linked === "") {
      return "No linked file";
    }
    const gs = lastRunAllSummaryByGroup[gi];
    if (!gs || gs.total <= 0 || gs.partial) {
      return "Run all samples first";
    }
    if ((gs.file ?? "") !== "" && gs.file !== linked) {
      return "Last run used another file";
    }
    if (gs.passed !== gs.total) {
      return `${gs.passed}/${gs.total} samples passed`;
    }
    return null;
  }

  /** Submitting is a per-problem action: every Submit button lives in its problem header. */
  function applySubmitButtonsState() {
    listEl.querySelectorAll("button.case-group__submit").forEach((btn) => {
      const i = Number(btn.dataset.cpGi);
      const r = submitBlockedReason(i);
      btn.disabled = r !== null;
      btn.title = r ?? `Submit to ${submitTargets[i]}`;
    });
  }

  /**
   * @param {number} gi group whose linked file goes to the judge
   */
  function startSubmit(gi) {
    if (gi < 0 || submitBlockedReason(gi) !== null) {
      return;
    }
    hideErr();
    submitBusyGroups.add(gi);
    setSubmitStatus(gi, "...", "", "Submitting");
    applySubmitButtonsState();
    vscode.postMessage({ type: "submit", groupIndex: gi });
  }

  /**
   * Import toolbar only; running and submitting are per-problem and live in the headers.
   */
  function applyToolbarAndImportState() {
    const busy = runState.active;
    btnToggleJson.disabled = busy;
    btnLoad.disabled = busy;
    btnAddProblem.disabled = busy;
    btnClear.disabled = busy;
    btnExport.disabled = busy || totalCaseCount() === 0;
    applySubmitButtonsState();
    btnStopRun.hidden = !busy;
    syncSeparators();
  }

  /**
   * Hides a group separator with no visible control on one of its sides: Stop is hidden unless a
   * run is in flight, which would otherwise leave two rules butted together.
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
    return true;
  }

  function syncMultiGroupHeadersFromState() {
    const busy = runState.active;
    const activeGi = shortcutTargetGroup();
    groups.forEach((group, gi) => {
      const wrap = listEl.querySelector(
        `li.case-group-wrap[data-cp-gi="${gi}"]`,
      );
      if (!wrap) {
        return;
      }
      wrap.classList.toggle("case-group-wrap--active", gi === activeGi);
      const sumEl = wrap.querySelector(".case-group-passed");
      const srcEl = wrap.querySelector(".case-group-src");
      if (sumEl && srcEl) {
        paintGroupResults(wrap, sumEl, srcEl, gi);
      }
      const grpStatus = wrap.querySelector(".case-group-run-status");
      if (grpStatus) {
        const st = textForActiveGroupRunStatus(gi);
        if (st === null) {
          grpStatus.replaceChildren();
          grpStatus.hidden = true;
        } else {
          // Recreating the spinner would restart its animation on every sample.
          if (!grpStatus.querySelector(".run-status-spinner")) {
            const grpSpin = document.createElement("span");
            grpSpin.className = "run-status-spinner";
            grpSpin.setAttribute("aria-hidden", "true");
            grpStatus.appendChild(grpSpin);
          }
          let grpLbl = grpStatus.querySelector(".run-status-label");
          if (st === "") {
            grpLbl?.remove();
          } else {
            if (!grpLbl) {
              grpLbl = document.createElement("span");
              grpLbl.className = "run-status-label";
              grpLbl.setAttribute("aria-live", "polite");
              grpStatus.appendChild(grpLbl);
            }
            if (grpLbl.textContent !== st) {
              grpLbl.textContent = st;
            }
          }
          grpStatus.hidden = false;
        }
      }
      wrap.querySelectorAll(".case-group__run-all").forEach((runAllBtn) => {
        runAllBtn.disabled = group.cases.length === 0 || !sourceRunnable;
      });
      const clearBtn = wrap.querySelector(".case-group__clear");
      if (clearBtn) {
        clearBtn.disabled = busy;
      }
      const renameBtn = wrap.querySelector(".case-group__rename");
      if (renameBtn) {
        renameBtn.disabled = busy;
      }
    });
  }

  /**
   * @param {number} gi
   * @param {number} index
   * @returns {boolean}
   */
  function isRowRunning(gi, index) {
    if (!runState.active || runState.groupIndex !== gi) {
      return false;
    }
    if (runState.mode === "one") {
      return runState.index === index;
    }
    return runningRows.has(rk(gi, index));
  }

  function syncCaseRowSpinners() {
    listEl.querySelectorAll("li.case").forEach((li) => {
      const gi = Number(li.dataset.groupIndex);
      const index = Number(li.dataset.index);
      if (Number.isNaN(gi) || Number.isNaN(index)) {
        return;
      }
      const head = li.querySelector(".case-head");
      const actions = head && head.querySelector(".case-actions");
      const slot = head && head.querySelector(".case-verdict");
      if (!head || !actions || !slot) {
        return;
      }
      const running = isRowRunning(gi, index);
      if (running === slot.classList.contains("case-verdict--running")) {
        return;
      }
      head.querySelectorAll(".case-status").forEach((el) => el.remove());
      appendCaseStatus(head, lastRun[rk(gi, index)] ?? null, actions, running);
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
    const collapsed = li.classList.contains("case--collapsed");
    li.className = "case";
    if (runInfo) {
      li.classList.add(`case--${runInfo.badge}`);
    }
    if (collapsed) {
      li.classList.add("case--collapsed");
    }
    const head = li.querySelector(".case-head");
    const actions = head && head.querySelector(".case-actions");
    if (!head || !actions) {
      return false;
    }
    head.querySelectorAll(".case-status").forEach((el) => el.remove());
    appendCaseStatus(head, runInfo ?? null, actions, isRowRunning(gi, ci));
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
    syncRunAffordances();
    listEmptyEl.hidden = totalCaseCount() > 0;
    listEl
      .querySelectorAll(
        ".btn-add-case, .case-group__add-case",
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
    applyToolbarAndImportState();
    syncActiveProblemTitle();
    listEmptyEl.hidden = totalCaseCount() > 0;

    /**
     * Group disclosure state is applied after the loop: it needs both the header nodes and the
     * `inner` panel, which is built further down.
     * @type {(() => void)[]}
     */
    const groupDisclosures = [];

    // The empty bucket has no problem behind it: an empty header with a Run button on it reads as
    // a problem that failed to import, so the empty state is the "custom group" row alone.
    const rendered = isNoProblemsPlaceholder() ? [] : groups;
    const activeGi = shortcutTargetGroup();

    rendered.forEach((group, gi) => {
      const wrap = document.createElement("li");
      wrap.className = "case-group-wrap";
      wrap.setAttribute("data-cp-gi", String(gi));
      wrap.classList.toggle("case-group-wrap--active", gi === activeGi);

      wrap.classList.add("case-group-wrap--panel");
      const gid = String(group.id ?? gi);
      const panelId = `case-group-panel-${gi}`;

      const ghead = document.createElement("div");
      ghead.className = "case-group-head";

      const labelText = groupDisplayLabel(gi);
      const disclose = document.createElement("button");
      disclose.type = "button";
      disclose.className = "case-group-disclose";
      disclose.setAttribute("aria-controls", panelId);
      const chev = document.createElement("span");
      chev.className = "case-group-disclose__chev";
      chev.setAttribute("aria-hidden", "true");
      const lbl = document.createElement("span");
      lbl.className = "case-group-disclose__label";
      lbl.textContent = labelText;
      disclose.appendChild(chev);
      disclose.appendChild(lbl);
      const addLimit = (icon, text, title) => {
        const limit = document.createElement("span");
        limit.className = "case-group-limit";
        limit.title = title;
        limit.appendChild(mkIcon(icon));
        limit.append(text);
        disclose.appendChild(limit);
      };
      if (typeof group.timeLimitMs === "number") {
        addLimit("timeLimit", formatElapsed(group.timeLimitMs).trim(), "Time limit");
      }
      if (typeof group.memoryLimitMb === "number") {
        addLimit("memoryLimit", formatMemoryLimit(group.memoryLimitMb), "Memory limit");
      }
      disclose.addEventListener("click", () => {
        const nowCollapsed = toggleGroupCollapsed(gid);
        applyGroupCollapsedUi(
          wrap,
          inner,
          disclose,
          chev,
          labelText,
          nowCollapsed,
          true,
        );
        if (!nowCollapsed) {
          refitAll();
        }
      });
      groupDisclosures.push(() =>
        applyGroupCollapsedUi(
          wrap,
          inner,
          disclose,
          chev,
          labelText,
          !!groupCollapsed[gid],
          false,
        ),
      );
      ghead.appendChild(disclose);
      if (gid.startsWith("manual-")) {
        const btnRenameG = document.createElement("button");
        btnRenameG.type = "button";
        btnRenameG.className = "case-group__rename btn-icon";
        btnRenameG.title = "Rename";
        btnRenameG.setAttribute("aria-label", `Rename ${labelText}`);
        btnRenameG.appendChild(mkIcon("edit"));
        btnRenameG.disabled = busy;
        btnRenameG.addEventListener("click", () => {
          startGroupRename(gi);
        });
        ghead.appendChild(btnRenameG);
      }

      const actions = document.createElement("div");
      actions.className = "case-group-actions";
      let btnSubmitG = null;
      let submitStatusG = null;
      ghead.addEventListener("click", (e) => {
        if (e.target === ghead) {
          disclose.click();
        }
      });

      if (typeof submitTargets[gi] === "string" && submitTargets[gi] !== "") {
        btnSubmitG = document.createElement("button");
        btnSubmitG.type = "button";
        btnSubmitG.className =
          "case-group__submit btn-icon btn-submit";
        btnSubmitG.dataset.cpGi = String(gi);
        btnSubmitG.setAttribute(
          "aria-label",
          `Submit to ${submitTargets[gi]}`,
        );
        btnSubmitG.appendChild(mkIcon("submit"));
        btnSubmitG.addEventListener("click", () => startSubmit(gi));

        submitStatusG = document.createElement("button");
        submitStatusG.type = "button";
        submitStatusG.className = "submit-status";
        submitStatusG.dataset.cpGi = String(gi);
        submitStatusG.setAttribute("role", "status");
        submitStatusG.setAttribute("aria-live", "polite");
        paintSubmitStatusEl(submitStatusG, submitStatusByGroup[gid]);
        submitStatusG.addEventListener("click", () => {
          const url = submitStatusG.dataset.cpUrl ?? "";
          if (url !== "") {
            vscode.postMessage({ type: "openSubmission", url });
          }
        });
      }

      const sumEl = document.createElement("span");
      sumEl.className = "case-group-passed";
      const srcEl = document.createElement("button");
      srcEl.type = "button";
      srcEl.className = "case-group-src meta-chip";
      srcEl.addEventListener("click", () => {
        const path = groups[gi]?.source ?? "";
        if (path === "") return;
        vscode.postMessage({ type: "openSource", path });
      });
      srcEl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (runState.active) return;
        unbindGroupSource(gi);
      });
      paintGroupResults(wrap, sumEl, srcEl, gi);

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
      ghead.appendChild(sumEl);
      if (submitStatusG) {
        ghead.appendChild(submitStatusG);
      }
      ghead.appendChild(srcEl);
      ghead.appendChild(actions);

      const groupName = (group.label ?? "").trim() || `group ${gi + 1}`;
      [false, true].forEach((local) => {
        const btnRunG = document.createElement("button");
        btnRunG.type = "button";
        btnRunG.className = local
          ? "case-group__run-all needs-cpp btn-icon btn-run-local"
          : "case-group__run-all needs-cpp btn-icon btn-run";
        btnRunG.title = local
          ? "Run all (LOCAL)"
          : "Run all";
        btnRunG.dataset.cpTitle = btnRunG.title;
        btnRunG.setAttribute(
          "aria-label",
          local
            ? `Run all cases in ${groupName} with LOCAL build`
            : `Run all cases in ${groupName}`,
        );
        btnRunG.appendChild(mkIcon(local ? "local" : "runAll"));
        btnRunG.disabled = group.cases.length === 0 || !sourceRunnable;
        btnRunG.addEventListener("click", () => {
          hideErr();
          explicitRunGroup = gi;
          startRunAllForGroup(gi, local);
        });
        actions.appendChild(btnRunG);
      });
      if (btnSubmitG) {
        actions.appendChild(btnSubmitG);
      }

      const btnAddCaseG = document.createElement("button");
      btnAddCaseG.type = "button";
      btnAddCaseG.className = "case-group__add-case btn-icon";
      btnAddCaseG.title = "Add testcase";
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
      actions.appendChild(btnAddCaseG);

      const btnClrG = document.createElement("button");
      btnClrG.type = "button";
      btnClrG.className = "case-group__clear btn-icon";
      btnClrG.disabled = busy;
      btnClrG.title = "Remove problem";
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
      actions.appendChild(btnClrG);

      wrap.appendChild(ghead);

      const inner = document.createElement("ul");
      inner.className = "case-group-cases";
      inner.id = `case-group-panel-${gi}`;

      group.cases.forEach((c, index) => {
        const li = document.createElement("li");
        li.className = "case";
        li.dataset.groupIndex = String(gi);
        li.dataset.index = String(index);
        const caseKey = ck(gi, index);
        const caseIsCollapsed = !!caseCollapsed[caseKey];
        const casePanelId = `case-panel-${gi}-${index}`;
        const runInfo = lastRun[rk(gi, index)];
        if (runInfo) {
          li.classList.add(`case--${runInfo.badge}`);
        }

        const head = document.createElement("div");
        head.className = "case-head";

        const tEl = document.createElement("button");
        tEl.type = "button";
        tEl.className = "case-disclose";
        tEl.setAttribute("aria-controls", casePanelId);
        const caseChev = document.createElement("span");
        caseChev.className = "case-disclose__chev";
        caseChev.setAttribute("aria-hidden", "true");
        const num = document.createElement("span");
        num.className = "case-num";
        num.textContent = `${c.sample}`;
        tEl.appendChild(caseChev);
        tEl.appendChild(num);
        tEl.addEventListener("click", () => {
          const collapsed = toggleCaseCollapsed(caseKey);
          applyCaseCollapsedUi(li, body, tEl, caseChev, c.sample, collapsed);
          if (!collapsed) {
            refitAll();
          }
        });

        const actions = document.createElement("div");
        actions.className = "case-actions";

        const runButtons = [false, true].map((local) => {
          const runOne = document.createElement("button");
          runOne.type = "button";
          runOne.className = local
            ? "needs-cpp btn-icon btn-run-local"
            : "needs-cpp btn-icon btn-run";
          runOne.title = local
            ? `Run sample ${c.sample} (LOCAL)`
            : `Run sample ${c.sample}`;
          runOne.dataset.cpTitle = runOne.title;
          runOne.setAttribute(
            "aria-label",
            local
              ? `Run sample ${c.sample} with LOCAL build`
              : `Run sample ${c.sample}`,
          );
          runOne.appendChild(mkIcon(local ? "local" : "play"));
          runOne.disabled = !sourceRunnable;
          runOne.addEventListener("click", () => {
            explicitRunGroup = gi;
            purgeLastRunForGroup(gi);
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
              defineLocal: local,
              timeLimitMs: group.timeLimitMs,
            });
          });
          return runOne;
        });

        const debugOne = document.createElement("button");
        debugOne.type = "button";
        debugOne.className = "needs-cpp btn-icon";
        debugOne.title = `Debug sample ${c.sample}`;
        debugOne.dataset.cpTitle = debugOne.title;
        debugOne.setAttribute("aria-label", `Debug sample ${c.sample}`);
        debugOne.appendChild(mkIcon("debug"));
        debugOne.disabled = !sourceRunnable;
        debugOne.addEventListener("click", () => {
          hideErr();
          vscode.postMessage({
            type: "debugOne",
            groupIndex: gi,
            index,
            case: group.cases[index],
            defineLocal: false,
          });
        });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "btn-icon btn-remove";
        remove.title = "Remove testcase";
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

        runButtons.forEach((b) => actions.appendChild(b));
        actions.appendChild(debugOne);
        actions.appendChild(remove);

        head.appendChild(tEl);
        appendCaseStatus(head, runInfo ?? null, null, isRowRunning(gi, index));
        head.appendChild(actions);

        const body = document.createElement("div");
        body.className = "case-body";
        body.id = casePanelId;
        applyCaseCollapsedUi(li, body, tEl, caseChev, c.sample, caseIsCollapsed);
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

    groupDisclosures.forEach((apply) => apply());
    applySubmitButtonsState();

    syncRunAffordances();

    requestAnimationFrame(() => {
      refitAll();
      focusPendingGroup();
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
    persistRunResults();
    const busyNext = new Set();
    submitBusyGroups.forEach((g) => {
      if (g === removedGi) return;
      busyNext.add(g > removedGi ? g - 1 : g);
    });
    submitBusyGroups = busyNext;
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
    persistRunResults();
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
   * @param {number} gi
   * @param {boolean} defineLocal compile with `localCompileCommand` instead of `compileCommand`
   * @param {string} [sourceFile] file to compile instead of the editor's, for a run that is not the
   * editor's problem (an import auto-running a problem already linked to a file)
   * @returns {boolean} false when the group has nothing to run
   */
  function startRunAllForGroup(gi, defineLocal, sourceFile) {
    const g = groups[gi];
    if (!g || g.cases.length === 0) {
      return false;
    }
    runStampByGroup[gi] = ++runStampSeq;
    runState = { active: true, mode: "all", phase: "compile", groupIndex: gi, index: null, total: g.cases.length };
    if (incrementalDomReady()) {
      refreshIncrementalRunUi();
    } else {
      render();
    }
    vscode.postMessage({
      type: "runAll",
      groupIndex: gi,
      cases: g.cases,
      defineLocal: defineLocal === true,
      timeLimitMs: g.timeLimitMs,
      sourceFile: typeof sourceFile === "string" ? sourceFile : "",
    });
    return true;
  }

  /**
   * Run every sample of the problem the editor's file belongs to (see `shortcutTargetGroup`).
   * @param {boolean} [defineLocal] compile with `localCompileCommand` instead of `compileCommand`
   */
  function triggerRunAll(defineLocal) {
    hideErr();
    ensureDefaultGroup();
    const gi = shortcutTargetGroup();
    if (gi < 0) {
      showErr(unboundSourceHint());
      return;
    }
    explicitRunGroup = (groups[gi]?.source ?? "") === "" ? gi : null;
    if (!startRunAllForGroup(gi, defineLocal === true)) {
      showErr(`${groupDisplayLabel(gi)} has no samples to run`);
    }
  }

  /**
   * Run the first row of that same problem (sample index 0). No-op when it has no cases;
   * while a run is in flight this restarts, replacing it.
   * @param {boolean} [defineLocal] compile with `localCompileCommand` instead of `compileCommand`
   */
  function triggerRunFirst(defineLocal) {
    hideErr();
    ensureDefaultGroup();
    const gi = shortcutTargetGroup();
    if (gi < 0) {
      showErr(unboundSourceHint());
      return;
    }
    explicitRunGroup = (groups[gi]?.source ?? "") === "" ? gi : null;
    const g = groups[gi];
    if (!g || g.cases.length === 0) {
      showErr(`${groupDisplayLabel(gi)} has no samples to run`);
      return;
    }
    purgeLastRunForGroup(gi);
    runState = { active: true, mode: "one", phase: "run", groupIndex: gi, index: 0, total: 1 };
    if (incrementalDomReady()) {
      refreshIncrementalRunUi();
    } else {
      render();
    }
    vscode.postMessage({
      type: "runOne",
      groupIndex: gi,
      index: 0,
      case: g.cases[0],
      defineLocal: defineLocal === true,
    });
  }

  function onMessage(e) {
    const m = e.data;
    if (m.type === "shortcutRunFirst") {
      triggerRunFirst(false);
      return;
    }
    if (m.type === "shortcutRunFirstLocal") {
      triggerRunFirst(true);
      return;
    }
    if (m.type === "shortcutRunAll") {
      triggerRunAll(false);
      return;
    }
    if (m.type === "shortcutRunAllLocal") {
      triggerRunAll(true);
      return;
    }
    if (m.type === "runGroupAll") {
      hideErr();
      const gi = typeof m.groupIndex === "number" ? m.groupIndex : 0;
      const linked = String(groups[gi]?.source ?? "");
      explicitRunGroup = linked === "" ? gi : null;
      startRunAllForGroup(gi, m.defineLocal === true, linked);
      return;
    }
    if (m.type === "syncFocusContext") {
      vscode.postMessage({
        type: "webviewFocus",
        focused: document.hasFocus(),
      });
      return;
    }
    if (m.type === "sampleStart") {
      const gi = typeof m.groupIndex === "number" ? m.groupIndex : 0;
      if (staleResultGroups.has(gi) || typeof m.index !== "number") {
        return;
      }
      runningRows.add(rk(gi, m.index));
      // The host only reports progress on completion, so the first sample's start is what says
      // compiling is over.
      if (runState.active && runState.mode === "all" && runState.phase === "compile") {
        runState.phase = "run";
      }
      if (incrementalDomReady()) {
        refreshIncrementalRunUi();
      } else {
        render();
      }
      return;
    }
    if (m.type === "runState") {
      if (m.running) {
        staleResultGroups.delete(
          typeof m.groupIndex === "number" ? m.groupIndex : 0,
        );
        if (m.phase === "compile") {
          runningRows.clear();
        }
      } else {
        runningRows.clear();
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
      const knownGroupIds = new Set();
      const knownCaseKeys = new Set();
      groups.forEach((g, gi) => {
        const gid = String(g?.id ?? gi);
        knownGroupIds.add(gid);
        (g?.cases ?? []).forEach((c, ci) => {
          knownCaseKeys.add(`${gid}::${c?.sample ?? ci + 1}`);
        });
      });
      const prevGroupCollapsed = groupCollapsed;
      const prevCaseCollapsed = caseCollapsed;
      if (Array.isArray(m.groups) && m.groups.length > 0) {
        groups = m.groups.map((g, i) => {
          const out = {
            id: typeof g.id === "string" ? g.id : String(i),
            label: typeof g.label === "string" ? g.label : "",
            cases: Array.isArray(g.cases) ? g.cases : [],
          };
          if (typeof g.timeLimitMs === "number") {
            out.timeLimitMs = g.timeLimitMs;
          }
          if (typeof g.memoryLimitMb === "number") {
            out.memoryLimitMb = g.memoryLimitMb;
          }
          if (typeof g.url === "string" && g.url !== "") {
            out.url = g.url;
          }
          if (typeof g.source === "string" && g.source !== "") {
            out.source = g.source;
          }
          return out;
        });
      } else if (Array.isArray(m.cases)) {
        groups = [{ id: "0", label: "", cases: m.cases }];
      } else {
        groups = [];
      }
      submitTargets = Array.isArray(m.submitTargets) ? m.submitTargets : [];
      const liveGroupIds = new Set(groups.map((g, i) => String(g?.id ?? i)));
      for (const k of Object.keys(submitStatusByGroup)) {
        if (!liveGroupIds.has(k)) {
          delete submitStatusByGroup[k];
        }
      }
      restoreSubmitStatus(m.submitStatus);
      persistSubmitStatus();
      groupCollapsed = carryCollapsed(
        prevGroupCollapsed,
        defaultCollapsedAllHeaders(groups),
        knownGroupIds,
      );
      caseCollapsed = carryCollapsed(
        prevCaseCollapsed,
        defaultCollapsedAllCases(groups),
        knownCaseKeys,
      );
      persistWebviewNavState();
      Object.keys(lastRun).forEach((k) => delete lastRun[k]);
      Object.keys(lastRunAllSummaryByGroup).forEach(
        (k) => delete lastRunAllSummaryByGroup[k],
      );
      restoreRunResults(m.runResults);
      persistRunResults();
      hideErr();
      if (jsonBoxOpen()) {
        jsonEl.value = "";
        setJsonBoxOpen(false);
      }
      render();
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
      runningRows.delete(key);
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
      const execMs = typeof m.execMs === "number" ? m.execMs : undefined;
      const overheadMs =
        typeof m.overheadMs === "number" ? m.overheadMs : undefined;
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
          execMs,
          overheadMs,
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
          execMs,
          overheadMs,
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
          execMs,
          overheadMs,
        };
      }
      if (typeof m.timeLimitMs === "number") {
        lastRun[key].timeLimitMs = m.timeLimitMs;
      }
      lastRun[key].run = runStampByGroup[gi];
      if (runState.mode === "one") {
        lastRunAllSummaryByGroup[gi] = {
          passed: lastRun[key].verdict === "AC" ? 1 : 0,
          total: 1,
          verdict: worstVerdict([lastRun[key].verdict]),
          file: typeof m.file === "string" ? m.file : "",
          partial: true,
        };
      }
      persistRunResults();
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
      dropRowsFromEarlierRuns(gi);
      const gr = groups[gi];
      let passed = 0;
      const n = gr?.cases.length ?? 0;
      const verdicts = [];
      for (let i = 0; i < n; i++) {
        const v = lastRun[rk(gi, i)]?.verdict;
        verdicts.push(v);
        if (v === "AC") passed++;
      }
      lastRunAllSummaryByGroup[gi] =
        n > 0
          ? {
              passed,
              total: n,
              file: typeof m.file === "string" ? m.file : "",
              verdict: worstVerdict(verdicts),
              counts: countVerdicts(verdicts),
            }
          : undefined;
      persistRunResults();
      if (incrementalDomReady()) {
        refreshIncrementalRunUi();
      } else {
        render();
      }
      return;
    }
    if (m.type === "submitTargets") {
      const before = submittableGroups().join(",");
      submitTargets = Array.isArray(m.targets) ? m.targets : [];
      if (submittableGroups().join(",") !== before) {
        // Which groups carry a Submit button is decided while rendering the headers.
        render();
      } else {
        applySubmitButtonsState();
      }
      return;
    }
    if (m.type === "submitBridge") {
      submitBridgeConnected = m.connected === true;
      applySubmitButtonsState();
      return;
    }
    if (m.type === "submitState") {
      const gi = typeof m.groupIndex === "number" ? m.groupIndex : -1;
      if (gi < 0) {
        return;
      }
      if (m.phase === "start") {
        submitBusyGroups.add(gi);
        setSubmitStatus(gi, "...", "", "Submitting");
      } else if (m.phase === "progress") {
        const live = typeof m.message === "string" ? m.message.trim() : "";
        if (live !== "") {
          setSubmitStatus(gi, shortVerdict(live), "", live);
        } else {
          setSubmitStatus(gi, "...", "", String(m.stage ?? "working"));
        }
      } else if (m.phase === "done") {
        submitBusyGroups.delete(gi);
        if (m.cancelled === true) {
          setSubmitStatus(gi, "", "");
        } else if (typeof m.error === "string" && m.error !== "") {
          setSubmitStatus(gi, "ERROR", "bad", m.error, m.submissionUrl);
        } else if (typeof m.verdict === "string" && m.verdict !== "") {
          setSubmitStatus(
            gi,
            shortVerdict(m.verdict),
            m.accepted === true ? "ok" : "bad",
            m.verdict,
            m.submissionUrl,
          );
        } else if (m.submitted === true) {
          setSubmitStatus(gi, "OK", "ok", "Submitted", m.submissionUrl);
        } else {
          setSubmitStatus(gi, "", "");
        }
      }
      applySubmitButtonsState();
      return;
    }
    if (m.type === "exportDone") {
      const count = typeof m.count === "number" ? m.count : 0;
      const prevTitle = btnExport.title;
      btnExport.title = `Exported ${count} case${count === 1 ? "" : "s"}`;
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
    btnToggleJson.title = open ? "Hide JSON" : "Paste JSON";
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

  btnAddProblem.addEventListener("click", () => {
    hideErr();
    addCustomProblemGroup();
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
    persistRunResults();
    ensureDefaultGroup();
    vscode.postMessage({
      type: "saveCaseGroups",
      groups: [...groups],
    });
    render();
  });

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

  function syncStuckState() {
    importSectionEl.classList.toggle("import--stuck", listEl.scrollTop > 0);
  }

  listEl.addEventListener("scroll", syncStuckState, { passive: true });
  syncStuckState();

  vscode.postMessage({ type: "restore" });
  requestAnimationFrame(() => {
    postFocusToHost(document.hasFocus());
  });
})();

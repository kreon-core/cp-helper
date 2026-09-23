(() => {
  const cfLetter = (s) => (/^[a-z]$/iu.test(s) ? s.toUpperCase() : s);

  function shortTitleFor(href) {
    let u;
    try {
      u = new URL(href);
    } catch {
      return "";
    }
    const host = u.hostname;
    const path = u.pathname;
    if (host === "codeforces.com" || host.endsWith(".codeforces.com")) {
      let m = path.match(/\/(?:contest|gym)\/(\d+)\/problem\/([^/?#]+)/u);
      if (m) {
        return `${cfLetter(m[2])} - ${m[1]}`;
      }
      m = path.match(/\/problemset\/problem\/(\d+)\/([^/?#]+)/u);
      if (m) {
        return `${cfLetter(m[2])} - ${m[1]}`;
      }
      return "";
    }
    if (host === "atcoder.jp" || host.endsWith(".atcoder.jp")) {
      const m = path.match(/\/contests\/([^/]+)\/tasks\/([^/?#]+)/u);
      if (!m) {
        return "";
      }
      const cut = m[2].lastIndexOf("_");
      const letter = cut >= 0 ? m[2].slice(cut + 1) : m[2];
      const shown = letter.charAt(0).toUpperCase() + letter.slice(1);
      return `${shown} - ${m[1]}`;
    }
    return "";
  }

  let wanted = "";

  function applyTitle() {
    wanted = shortTitleFor(location.href);
    if (wanted !== "" && document.title !== wanted) {
      document.title = wanted;
    }
  }

  applyTitle();

  const head = document.head || document.documentElement;
  if (head) {
    new MutationObserver(() => {
      if (wanted !== "" && document.title !== wanted) {
        document.title = wanted;
      }
    }).observe(head, { childList: true, subtree: true, characterData: true });
  }

  for (const key of ["pushState", "replaceState"]) {
    const original = history[key];
    history[key] = function (...args) {
      const r = original.apply(this, args);
      applyTitle();
      return r;
    };
  }
  window.addEventListener("popstate", applyTitle);
})();

import type { Platform } from "../types";

export interface ProblemLink {
  id: string;
  key: string;
  url: string;
  platform: Platform;
}

const MAX_CF_CONTEST = 100000;
const CF_RE =
  /^https?:\/\/(?:www\.|m\d\.)?codeforces\.com\/(?:contest|problemset\/problem)\/(\d+)\/(?:problem\/)?([A-Za-z]\d?)\/?(?:[?#].*)?$/;
const AC_RE = /^https?:\/\/atcoder\.jp\/contests\/([\w-]+)\/tasks\/([\w-]+)\/?(?:[?#].*)?$/;
const CSES_RE = /^https?:\/\/cses\.fi\/problemset\/task\/(\d+)\/?(?:[?#].*)?$/;

export function parseProblemLink(text: string): ProblemLink | null {
  const url = text.trim();
  const cf = CF_RE.exec(url);
  if (cf) {
    const contest = Number(cf[1]);
    const index = (cf[2] ?? "").toUpperCase();
    if (contest >= MAX_CF_CONTEST) return null;
    return {
      id: `cf:${contest}${index}`,
      key: `${contest}${index}`,
      url: `https://codeforces.com/contest/${contest}/problem/${index}`,
      platform: "Codeforces",
    };
  }
  const ac = AC_RE.exec(url);
  if (ac) {
    const [, contest, task] = ac;
    return {
      id: `ac:${task}`,
      key: task ?? "",
      url: `https://atcoder.jp/contests/${contest}/tasks/${task}`,
      platform: "AtCoder",
    };
  }
  const cses = CSES_RE.exec(url);
  if (cses) {
    const [, task] = cses;
    return { id: `cses:${task}`, key: task ?? "", url: `https://cses.fi/problemset/task/${task}`, platform: "CSES" };
  }
  return null;
}

export interface ParsedLinks {
  links: ProblemLink[];
  invalid: string[];
  duplicates: number;
}

export function parseProblemLinks(text: string): ParsedLinks {
  const links: ProblemLink[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  for (const token of text.split(/[\s,]+/)) {
    if (!token) continue;
    const link = parseProblemLink(token);
    if (!link) invalid.push(token);
    else if (seen.has(link.id)) duplicates++;
    else {
      seen.add(link.id);
      links.push(link);
    }
  }
  return { links, invalid, duplicates };
}

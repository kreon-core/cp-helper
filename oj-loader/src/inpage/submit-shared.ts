/**
 * Shared helpers for the in-page submit drivers. Everything here runs inside the judge tab, which
 * is why submitting needs no login handling: the page's own cookies and CSRF token are right there.
 */
import type { AntiBotState } from "../types";

/**
 * Spacing in a judge's option text is not stable - AtCoder ships both "C++ 23 (gcc 12.2)" and
 * "C++23 (GCC 15.2.0)" across versions - so whitespace is ignored on both sides.
 * @param text option text as the judge renders it
 * @param want substring from the OJ Runner setting
 */
function optionMatches(text: string, want: string): boolean {
  const squash = (v: string) => v.toLowerCase().replace(/\s+/gu, "");
  return squash(text).includes(squash(want));
}

/**
 * Body for replaying a form, encoded the way the form itself declares. Rebuilding it by hand
 * loses hidden fields the judge has added and, when the form is multipart, is parsed as empty -
 * which both judges report only as a generic error.
 * @param overrides fields to force, replacing every existing entry
 * @param drop fields to remove entirely
 */
export function buildFormBody(
  form: HTMLFormElement,
  overrides: Record<string, string>,
  drop?: string[],
): { body: FormData | URLSearchParams; headers: Record<string, string> } {
  const data = new FormData(form);
  for (const name of drop ?? []) {
    data.delete(name);
  }
  for (const [name, value] of Object.entries(overrides)) {
    data.delete(name);
    data.set(name, value);
  }
  const enctype = (form.getAttribute("enctype") ?? "").toLowerCase();
  if (enctype.includes("multipart")) {
    // The browser sets the boundary; setting Content-Type ourselves would break it.
    return { body: data, headers: {} };
  }
  const params = new URLSearchParams();
  for (const [name, value] of data.entries()) {
    if (typeof value === "string") {
      params.append(name, value);
    }
  }
  return {
    body: params,
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
  };
}

/**
 * Pick the language option the user configured, else any C++ one so a renamed option does not
 * block the submit outright.
 */
export function pickLanguage(
  select: HTMLSelectElement | null,
  want: string,
): { value: string; text: string } | { error: string } {
  if (!select) {
    return { error: "Language selector not found on the submit page." };
  }
  const options = Array.from(select.options).filter(
    (o) => (o.value ?? "").trim() !== "",
  );
  if (options.length === 0) {
    return { error: "Submit page lists no languages - are you logged in?" };
  }
  const exact = options.find((o) => optionMatches(o.text, want));
  if (exact) {
    return { value: exact.value, text: exact.text.trim() };
  }
  const cpp = options.find(
    (o) => optionMatches(o.text, "c++") || optionMatches(o.text, "g++"),
  );
  if (cpp) {
    return { value: cpp.value, text: cpp.text.trim() };
  }
  return {
    error: `No language matching "${want}". Available: ${options
      .slice(0, 8)
      .map((o) => o.text.trim())
      .join(", ")}`,
  };
}

export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/**
 * A form control named `action` clobbers `form.action` in the browser, and Codeforces ships
 * exactly such a hidden input - so the property yields the element, not the URL. The attribute
 * is the only reliable source.
 * @returns absolute POST target
 */
export function formAction(form: HTMLFormElement): string {
  const raw = (form.getAttribute("action") ?? "").trim();
  return new URL(raw === "" ? location.href : raw, location.href).toString();
}

/** Hidden fields an anti-bot widget fills in once it has cleared the visitor. */
const ANTI_BOT_NAMES = [
  "cf-turnstile-response",
  "g-recaptcha-response",
  "h-captcha-response",
];

function antiBotField(): HTMLInputElement | HTMLTextAreaElement | null {
  for (const name of ANTI_BOT_NAMES) {
    const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      `[name="${name}"]`,
    );
    if (el) {
      return el;
    }
  }
  return document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    '[name*="turnstile"], [name*="captcha"]',
  );
}

/**
 * Codeforces guards its submit form with an anti-bot widget whose token is only filled in after
 * the widget clears the visitor, a second or two after the page loads. Replaying the form before
 * then is rejected with "Please complete the anti-bot verification". The widget re-creates its
 * own field, so it is re-queried on every pass.
 * @param timeoutMs how long to let the widget clear on its own
 * @returns `present` without a `value` means the widget wants the user to act
 */
export async function waitForAntiBotToken(
  timeoutMs: number,
): Promise<AntiBotState> {
  if (!antiBotField()) {
    return { present: false, name: "", value: "" };
  }
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const el = antiBotField();
    const value = el ? (el.value ?? "").trim() : "";
    if (el && value !== "") {
      return { present: true, name: el.name, value };
    }
    if (Date.now() > deadline) {
      return { present: true, name: el ? el.name : "", value: "" };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Every distinct error message on a re-rendered form page. Both judges ship empty error
 * placeholders next to each field, so the first `.error` node is usually blank and only a
 * later one carries the reason.
 */
export function collectErrors(doc: Document): string[] {
  // The document is our own parsed copy, so the dismiss buttons can just go: their "x" would
  // otherwise be read as part of the message ("x Error.").
  for (const chrome of doc.querySelectorAll(
    "button.close, .close, [data-dismiss], .glyphicon",
  )) {
    chrome.remove();
  }
  const found: string[] = [];
  for (const el of doc.querySelectorAll(
    '.error, .alert-danger, .alert, .has-error .help-block, [class*="error"]',
  )) {
    const text = (el.textContent ?? "").replace(/\s+/gu, " ").trim();
    if (
      text !== "" &&
      text.length <= 300 &&
      /[a-z0-9]/iu.test(text) &&
      !found.includes(text)
    ) {
      found.push(text);
    }
  }
  return found;
}

/**
 * Both judges have a house-style "Error." banner that names nothing. Treating it as the whole
 * story hides the only other evidence there is - what the response itself was.
 */
export function isGenericError(errors: string[]): boolean {
  return (
    errors.length === 0 ||
    errors.every((e) => /^(?:error|\u30A8\u30E9\u30FC)[.!\s]*$/iu.test(e))
  );
}

/**
 * What the judge actually answered, for an outcome we could not classify. Without it a failed
 * submit is unreportable: the response body is the only evidence and it is thrown away.
 * @param doc parsed response body
 */
export function describeResponse(res: Response, doc: Document): string {
  const bits = [`HTTP ${res.status}`];
  try {
    bits.push(new URL(res.url).pathname);
  } catch {
    /* opaque URL */
  }
  const title = (doc.title ?? "").trim();
  if (title !== "") {
    bits.push(`page "${title.slice(0, 60)}"`);
  }
  return bits.join(", ");
}

/**
 * @param url same-origin page to read with the tab's own session
 */
export async function fetchDocument(url: string): Promise<Document> {
  const res = await fetch(url, { credentials: "include" });
  return parseHtml(await res.text());
}

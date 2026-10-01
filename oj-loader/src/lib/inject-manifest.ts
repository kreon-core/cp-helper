/**
 * Bundles injected into a judge tab before calling `globalThis.__ojLoaderExtractSamplesInPage`.
 * Paths are relative to the built extension root (`dist/`, the folder that contains
 * `manifest.json`).
 */
export const OJ_LOADER_INPAGE_SCRIPT_PATHS = ["inpage/extract.js"];

/**
 * Bundles injected before calling `globalThis.__ojLoaderSubmitInPage` /
 * `__ojLoaderVerdictInPage` in a judge tab.
 */
export const OJ_LOADER_SUBMIT_SCRIPT_PATHS = ["inpage/submit.js"];

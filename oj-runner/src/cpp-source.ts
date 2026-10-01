import * as path from "path";
import { CPP_SOURCE_EXTENSIONS } from "./constants";

/**
 * True for a C++ solution file. `.C` (uppercase) counts on case-sensitive filesystems only,
 * matching how g++ itself decides between C and C++ for that extension.
 */
export function isCppSourcePath(file: string): boolean {
  const ext = path.extname(file);
  if (ext === ".C" && process.platform !== "win32") {
    return true;
  }
  return (CPP_SOURCE_EXTENSIONS as readonly string[]).includes(
    ext.toLowerCase(),
  );
}

import {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
} from "node:fs";
import { dirname } from "node:path";

export function ensureDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}

export function writeOrCheck(
  filePath: string,
  content: string,
  checkMode = false,
): boolean {
  if (checkMode) {
    const existing = existsSync(filePath)
      ? readFileSync(filePath, "utf8")
      : null;
    return existing !== content;
  }

  ensureDir(dirname(filePath));
  writeFileSync(filePath, content);
  return false;
}

export function readIfExists(filePath: string): string | null {
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : null;
}

export function listFiles(
  dir: string,
  filter: (f: string) => boolean,
): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(filter);
}

export function listDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
}

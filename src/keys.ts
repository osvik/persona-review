import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { ensureUserConfigDirs, USER_CONFIG_DIR } from "./user-config.js";

export const USER_KEYS_PATH = path.join(USER_CONFIG_DIR, "keys.yaml");

export type ApiKeySource = "environment" | "keys-file" | "missing";

export interface ApiKeyLookup {
  name: string;
  value?: string;
  source: ApiKeySource;
  filePath: string;
}

export function ensureUserKeysFile(filePath: string = USER_KEYS_PATH): string {
  ensureUserConfigDirs(path.dirname(filePath));
  if (!existsSync(filePath)) {
    writeFileSync(filePath, "", { mode: 0o600 });
  }
  return filePath;
}

export function lookupApiKey(
  name: string,
  filePath: string = USER_KEYS_PATH
): ApiKeyLookup {
  const envValue = normalizeKey(process.env[name]);
  if (envValue) {
    return { name, value: envValue, source: "environment", filePath };
  }

  ensureUserKeysFile(filePath);
  const fileValue = normalizeKey(readKeyFromFile(name, filePath));
  if (fileValue) {
    return { name, value: fileValue, source: "keys-file", filePath };
  }

  return { name, source: "missing", filePath };
}

export function getRequiredApiKey(
  name: string,
  filePath: string = USER_KEYS_PATH
): string {
  const lookup = lookupApiKey(name, filePath);
  if (lookup.value) return lookup.value;
  throw new Error(
    `${name} is required. Set it as an environment variable or add it to ${lookup.filePath}.`
  );
}

/**
 * Write (or clear) an API key in `keys.yaml`. Preserves any other keys in
 * the file and enforces mode 0o600. Passing an empty/whitespace value
 * removes the entry. Throws on file or YAML errors; caller surfaces them.
 *
 * Note: round-tripping through `yaml.parse` + `yaml.stringify` normalizes
 * comments and quoting. A user who hand-edited keys.yaml with comments
 * will lose them on the next write.
 */
export function writeApiKey(
  name: string,
  value: string,
  filePath: string = USER_KEYS_PATH
): void {
  ensureUserKeysFile(filePath);
  const raw = readFileSync(filePath, "utf-8");
  const parsed = parseYaml(raw);
  let data: Record<string, unknown>;
  if (parsed == null) {
    data = {};
  } else if (isPlainRecord(parsed)) {
    data = { ...parsed };
  } else {
    throw new Error(`${filePath} must contain a YAML object.`);
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    delete data[name];
  } else {
    data[name] = trimmed;
  }
  const out = Object.keys(data).length === 0 ? "" : stringifyYaml(data);
  writeFileSync(filePath, out, { mode: 0o600 });
  // writeFileSync only sets mode when creating a new file; ensure 0o600
  // even when overwriting an existing file with different mode.
  try {
    chmodSync(filePath, 0o600);
  } catch {
    /* best effort — non-POSIX filesystems may not support chmod */
  }
}

function readKeyFromFile(name: string, filePath: string): unknown {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = parseYaml(raw);
  if (parsed == null) return undefined;
  if (!isPlainRecord(parsed)) {
    throw new Error(`${filePath} must contain a YAML object.`);
  }

  const value = parsed[name];
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new Error(`${name} in ${filePath} must be a string.`);
  }
  return value;
}

function normalizeKey(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

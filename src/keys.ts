import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
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

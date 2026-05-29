import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { SessionDevice } from "./browser.js";
import { isSubmitDataYamlPath } from "./submit-data.js";
import type { Provider } from "./llm/types.js";
import {
  ensureUserConfigDirs,
  USER_DEFAULTS_PATH,
  USER_PERSONAS_DIR,
  USER_CONFIG_DIR,
} from "./user-config.js";

export { USER_CONFIG_DIR, USER_DEFAULTS_PATH, USER_PERSONAS_DIR };

export interface UserDefaults {
  personaId: string;
  provider: Provider;
  model?: string;
  maxOutputTokens: number;
  maxActions: number;
  costCapUsd: number;
  fullPage: boolean;
  device?: SessionDevice;
  json: boolean;
  repl: boolean;
  replOnly: boolean;
  allowSubmit: boolean;
  allowDownloads: boolean;
  allowCrossPageNavigation: boolean;
  submitDataPath?: string;
  yes: boolean;
}

const keyMap = {
  persona: "personaId",
  "persona-id": "personaId",
  persona_id: "personaId",
  personaId: "personaId",
  provider: "provider",
  model: "model",
  "max-tokens": "maxOutputTokens",
  max_tokens: "maxOutputTokens",
  maxTokens: "maxOutputTokens",
  "max-output-tokens": "maxOutputTokens",
  max_output_tokens: "maxOutputTokens",
  maxOutputTokens: "maxOutputTokens",
  "max-actions": "maxActions",
  max_actions: "maxActions",
  maxActions: "maxActions",
  "cost-cap-usd": "costCapUsd",
  cost_cap_usd: "costCapUsd",
  costCapUsd: "costCapUsd",
  "full-page-snapshot": "fullPage",
  full_page_snapshot: "fullPage",
  fullPageSnapshot: "fullPage",
  "full-page": "fullPage",
  full_page: "fullPage",
  fullPage: "fullPage",
  device: "device",
  json: "json",
  repl: "repl",
  "repl-only": "replOnly",
  repl_only: "replOnly",
  replOnly: "replOnly",
  "allow-submit": "allowSubmit",
  allow_submit: "allowSubmit",
  allowSubmit: "allowSubmit",
  "allow-downloads": "allowDownloads",
  allow_downloads: "allowDownloads",
  allowDownloads: "allowDownloads",
  "allow-cross-page-navigation": "allowCrossPageNavigation",
  allow_cross_page_navigation: "allowCrossPageNavigation",
  allowCrossPageNavigation: "allowCrossPageNavigation",
  "submit-data": "submitDataPath",
  submit_data: "submitDataPath",
  "submit-data-path": "submitDataPath",
  submit_data_path: "submitDataPath",
  submitData: "submitDataPath",
  submitDataPath: "submitDataPath",
  yes: "yes",
} as const satisfies Record<string, keyof UserDefaults>;

const supportedKeys = Object.keys(keyMap).sort();

export function ensureUserDefaultsFile(
  filePath: string = USER_DEFAULTS_PATH
): string {
  ensureUserConfigDirs(path.dirname(filePath));
  if (!existsSync(filePath)) {
    writeFileSync(filePath, "");
  }
  return filePath;
}

export function loadUserDefaults(
  filePath: string = USER_DEFAULTS_PATH
): Partial<UserDefaults> {
  const raw = readFileSync(filePath, "utf-8");
  const parsed = parseYaml(raw);
  if (parsed == null) return {};
  if (!isPlainRecord(parsed)) {
    throw new Error(`${filePath} must contain a YAML object.`);
  }

  const defaults: Partial<UserDefaults> = {};
  for (const [key, value] of Object.entries(parsed)) {
    const target = keyMap[key as keyof typeof keyMap];
    if (!target) {
      throw new Error(
        `Unknown option "${key}" in ${filePath}. Supported keys: ${supportedKeys.join(", ")}.`
      );
    }
    assignDefault(defaults, target, value, key, filePath);
  }
  return defaults;
}

// Canonical file-key for each internal field — matches the snake_case
// form documented in the README. Used by writeUserDefaults() so the file
// the TUI writes is the same shape a CLI user would hand-write.
const internalToFileKey: Record<keyof UserDefaults, string> = {
  personaId: "persona",
  provider: "provider",
  model: "model",
  maxOutputTokens: "max_tokens",
  maxActions: "max_actions",
  costCapUsd: "cost_cap_usd",
  fullPage: "full_page_snapshot",
  device: "device",
  json: "json",
  repl: "repl",
  replOnly: "repl_only",
  allowSubmit: "allow_submit",
  allowDownloads: "allow_downloads",
  allowCrossPageNavigation: "allow_cross_page_navigation",
  submitDataPath: "submit_data",
  yes: "yes",
};

/**
 * Write a snapshot of user defaults to ~/.persona-review/defaults.yaml.
 * Round-trips through yaml.stringify, so any comments or hand-formatting
 * in the existing file are normalized away. Undefined values are skipped
 * (so e.g. `model: undefined` stays absent — falls back to the provider
 * default at next read).
 */
export function writeUserDefaults(
  values: Partial<UserDefaults>,
  filePath: string = USER_DEFAULTS_PATH
): void {
  ensureUserConfigDirs(path.dirname(filePath));
  const out: Record<string, unknown> = {};
  for (const [internal, value] of Object.entries(values)) {
    if (value === undefined) continue;
    const fileKey =
      internalToFileKey[internal as keyof UserDefaults] ?? null;
    if (!fileKey) continue;
    out[fileKey] = value;
  }
  const content =
    Object.keys(out).length === 0 ? "" : stringifyYaml(out);
  writeFileSync(filePath, content);
}

function assignDefault(
  defaults: Partial<UserDefaults>,
  target: keyof UserDefaults,
  value: unknown,
  key: string,
  filePath: string
) {
  switch (target) {
    case "personaId":
    case "model":
      defaults[target] = requireString(value, key, filePath);
      return;
    case "provider":
      defaults.provider = requireProvider(value, key, filePath);
      return;
    case "device":
      defaults.device = requireDevice(value, key, filePath);
      return;
    case "submitDataPath": {
      const submitDataPath = requireString(value, key, filePath);
      if (!isSubmitDataYamlPath(submitDataPath)) {
        throw new Error(
          `${key} in ${filePath} must point to a .yaml or .yml file.`
        );
      }
      defaults.submitDataPath = submitDataPath;
      return;
    }
    case "maxOutputTokens":
    case "maxActions":
      defaults[target] = requirePositiveInteger(value, key, filePath);
      return;
    case "costCapUsd":
      defaults.costCapUsd = requirePositiveNumber(value, key, filePath);
      return;
    case "fullPage":
    case "json":
    case "repl":
    case "replOnly":
    case "allowSubmit":
    case "allowDownloads":
    case "allowCrossPageNavigation":
    case "yes":
      defaults[target] = requireBoolean(value, key, filePath);
      return;
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, key: string, filePath: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${key} in ${filePath} must be a non-empty string.`);
  }
  return value;
}

function requireBoolean(value: unknown, key: string, filePath: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${key} in ${filePath} must be true or false.`);
  }
  return value;
}

function requirePositiveInteger(
  value: unknown,
  key: string,
  filePath: string
): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} in ${filePath} must be a positive integer.`);
  }
  return value;
}

function requirePositiveNumber(
  value: unknown,
  key: string,
  filePath: string
): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} in ${filePath} must be a positive number.`);
  }
  return value;
}

function requireProvider(
  value: unknown,
  key: string,
  filePath: string
): Provider {
  if (value !== "anthropic" && value !== "openai" && value !== "google") {
    throw new Error(
      `${key} in ${filePath} must be 'anthropic', 'openai', or 'google'.`
    );
  }
  return value;
}

function requireDevice(
  value: unknown,
  key: string,
  filePath: string
): SessionDevice {
  if (value !== "mobile" && value !== "desktop") {
    throw new Error(`${key} in ${filePath} must be 'mobile' or 'desktop'.`);
  }
  return value;
}

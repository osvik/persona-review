import { mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const USER_CONFIG_DIR = path.join(os.homedir(), ".persona-review");
export const USER_DEFAULTS_PATH = path.join(USER_CONFIG_DIR, "defaults.yaml");
export const USER_PERSONAS_DIR = path.join(USER_CONFIG_DIR, "personas");

export function ensureUserConfigDirs(configDir: string = USER_CONFIG_DIR): string {
  mkdirSync(configDir, { recursive: true });
  mkdirSync(path.join(configDir, "personas"), { recursive: true });
  return configDir;
}

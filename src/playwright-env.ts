import os from "node:os";
import path from "node:path";

const CLOUD_SHELL_TMP_BROWSER_PATH = "/tmp/persona-review-ms-playwright";

export function configurePlaywrightEnvironment(): void {
  if (
    shouldUseManagedCloudShellBrowserPath() &&
    !process.env.PLAYWRIGHT_BROWSERS_PATH
  ) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = cloudShellPersistentBrowserPath();
  }
}

export function configurePlaywrightCloudShellInstallEnvironment(): void {
  if (
    shouldUseManagedCloudShellBrowserPath() &&
    !process.env.PLAYWRIGHT_BROWSERS_PATH
  ) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = cloudShellTmpBrowserPath();
  }
}

export function shouldUseManagedCloudShellBrowserPath(): boolean {
  return process.platform === "linux" && isGoogleCloudShell();
}

export function cloudShellPersistentBrowserPath(): string {
  return path.join(os.homedir(), ".cache", "persona-review-ms-playwright");
}

export function cloudShellTmpBrowserPath(): string {
  return CLOUD_SHELL_TMP_BROWSER_PATH;
}

export function isGoogleCloudShell(): boolean {
  return (
    process.env.CLOUD_SHELL === "true" ||
    Boolean(process.env.DEVSHELL_PROJECT_ID)
  );
}

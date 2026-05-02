import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export interface FailedRequest {
  url: string;
  status?: number;
}

export interface PageObservation {
  url: string;
  title: string;
  htmlLang: string | null;
  ariaSnapshot: string;
  screenshotBase64: string;
  screenshotMediaType: "image/jpeg";
  screenshotBytes: number;
  consoleErrors: string[];
  failedRequests: FailedRequest[];
  scrollY: number;
  documentHeight: number;
}

export type ActionResult = { ok: true } | { ok: false; reason: string };

export type ClickResult =
  | { ok: true; submitted: boolean }
  | { ok: false; reason: string };

export type SessionDevice = "mobile" | "desktop";

export interface DeviceProfile {
  device: SessionDevice;
  viewport: { width: number; height: number };
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  userAgent: string;
}

export const MOBILE_PROFILE: DeviceProfile = {
  device: "mobile",
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
};

export const DESKTOP_PROFILE: DeviceProfile = {
  device: "desktop",
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
};

export function profileFor(device: SessionDevice): DeviceProfile {
  return device === "mobile" ? MOBILE_PROFILE : DESKTOP_PROFILE;
}

export interface SessionOptions {
  device?: SessionDevice;
  fullPage?: boolean;
  jpegQuality?: number;
  timeoutMs?: number;
  allowSubmit?: boolean;
  allowDownloads?: boolean;
}

export class BrowserSession {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private consoleErrors: string[] = [];
  private failedRequests: FailedRequest[] = [];
  public readonly profile: DeviceProfile;
  public allowSubmit: boolean;
  private fullPage: boolean;
  private jpegQuality: number;
  private timeoutMs: number;
  private allowDownloads: boolean;

  constructor(opts: SessionOptions = {}) {
    this.profile = profileFor(opts.device ?? "desktop");
    this.fullPage = opts.fullPage ?? false;
    this.jpegQuality = opts.jpegQuality ?? 70;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.allowSubmit = opts.allowSubmit ?? false;
    this.allowDownloads = opts.allowDownloads ?? false;
  }

  async open(url: string): Promise<{ loadMs: number }> {
    const start = Date.now();
    this.browser = await chromium.launch();
    this.context = await this.browser.newContext({
      viewport: this.profile.viewport,
      deviceScaleFactor: this.profile.deviceScaleFactor,
      isMobile: this.profile.isMobile,
      hasTouch: this.profile.hasTouch,
      userAgent: this.profile.userAgent,
      acceptDownloads: this.allowDownloads,
    });
    this.page = await this.context.newPage();
    this.page.on("console", (msg) => {
      if (msg.type() === "error") this.consoleErrors.push(msg.text());
    });
    this.page.on("requestfailed", (req) => {
      this.failedRequests.push({ url: req.url() });
    });
    this.page.on("response", (res) => {
      const s = res.status();
      if (s >= 400) this.failedRequests.push({ url: res.url(), status: s });
    });
    await this.page.goto(url, { waitUntil: "networkidle", timeout: this.timeoutMs });
    // Real users don't act in the same instant DOMContentLoaded fires — give
    // the page's DCL handlers a 200–400ms cushion to wire up before we
    // observe or interact, so the persona doesn't critique a half-booted UI.
    const settleMs = 200 + Math.floor(Math.random() * 201);
    await this.page.waitForTimeout(settleMs);
    return { loadMs: Date.now() - start };
  }

  async observe(): Promise<PageObservation> {
    const page = this.requirePage();
    const title = await page.title();
    const url = page.url();
    const htmlLang = await page.evaluate(() => {
      const lang = document.documentElement.getAttribute("lang");
      return lang && lang.trim() ? lang.trim() : null;
    });
    const ariaSnapshot = await page.ariaSnapshot({ mode: "ai" });
    const screenshotBuf = await page.screenshot({
      fullPage: this.fullPage,
      type: "jpeg",
      quality: this.jpegQuality,
    });
    const { scrollY, documentHeight } = await page.evaluate(() => ({
      scrollY: Math.round(window.scrollY),
      documentHeight: document.documentElement.scrollHeight,
    }));
    return {
      url,
      title,
      htmlLang,
      ariaSnapshot,
      screenshotBase64: screenshotBuf.toString("base64"),
      screenshotMediaType: "image/jpeg",
      screenshotBytes: screenshotBuf.byteLength,
      consoleErrors: [...this.consoleErrors],
      failedRequests: [...this.failedRequests],
      scrollY,
      documentHeight,
    };
  }

  async scroll(
    direction: "up" | "down",
    amount: "viewport" | "page" | "to_top" | "to_bottom" = "viewport"
  ): Promise<ActionResult> {
    const page = this.requirePage();
    try {
      if (amount === "to_top") {
        await page.evaluate(() => window.scrollTo({ top: 0 }));
      } else if (amount === "to_bottom") {
        await page.evaluate(() =>
          window.scrollTo({ top: document.documentElement.scrollHeight })
        );
      } else {
        const factor = amount === "page" ? 0.95 : 0.8;
        const sign = direction === "down" ? 1 : -1;
        await page.evaluate(
          ({ factor, sign }) => {
            window.scrollBy({ top: window.innerHeight * factor * sign });
          },
          { factor, sign }
        );
      }
      await page.waitForTimeout(250);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  }

  async click(ref: string): Promise<ClickResult> {
    const page = this.requirePage();
    try {
      const locator = page.locator(`aria-ref=${ref}`);
      // Only treat real form-submit buttons specially: type=submit AND inside
      // a <form>. Plain <button> elements default to type="submit" even when
      // not in a form — those are NOT actual submitters and must remain
      // freely clickable (cookie banners, modal close buttons, etc.).
      const isFormSubmit = await locator
        .evaluate((el) => {
          const isSubmittable =
            (el instanceof HTMLButtonElement &&
              el.type === "submit") ||
            (el instanceof HTMLInputElement &&
              (el.type === "submit" || el.type === "image"));
          if (!isSubmittable) return false;
          return !!el.closest("form");
        })
        .catch(() => false);
      if (isFormSubmit && !this.allowSubmit) {
        return {
          ok: false,
          reason:
            "Refused: this is a form-submit button. Form submission is not allowed in this run. Examine or fill the form fields instead.",
        };
      }
      await locator.click({ timeout: 5_000 });
      // After a real submit, give the resulting page longer to settle so we
      // observe the thank-you / error / redirect rather than an in-flight
      // state. Non-submit clicks keep the existing short wait.
      const settleTimeout = isFormSubmit ? 15_000 : 5_000;
      try {
        await page.waitForLoadState("networkidle", { timeout: settleTimeout });
      } catch {
        // Some clicks don't trigger network activity; that's fine.
      }
      if (isFormSubmit) {
        // Extra cushion for client-side thank-you renders that swap DOM
        // without firing networkidle a second time.
        await page.waitForTimeout(750);
      }
      return { ok: true, submitted: isFormSubmit };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  }

  async type(ref: string, text: string): Promise<ActionResult> {
    const page = this.requirePage();
    try {
      await page.locator(`aria-ref=${ref}`).fill(text, { timeout: 5_000 });
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: (e as Error).message };
    }
  }

  async close(): Promise<void> {
    try {
      await this.browser?.close();
    } catch {
      // ignore
    }
    this.browser = undefined;
    this.context = undefined;
    this.page = undefined;
  }

  private requirePage(): Page {
    if (!this.page) throw new Error("BrowserSession.open() not called yet.");
    return this.page;
  }
}

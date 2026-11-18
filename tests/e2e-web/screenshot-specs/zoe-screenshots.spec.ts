import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(__dirname, "../../..");
const screenshotDir = process.env.ZOE_SCREENSHOT_DIR || join(repoRoot, "test-results/screenshots");
const navigationLabels = ["Home", "Records", "Ask", "Wellness"] as const;

async function capture(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(screenshotDir, name), fullPage: true, animations: "disabled" });
}

test.beforeAll(() => mkdirSync(screenshotDir, { recursive: true }));

test("capture synthetic patient screens in Firefox", async ({ page, browserName }) => {
  expect(browserName).toBe("firefox");
  const externalRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const requestUrl = new URL(route.request().url());
    if (["127.0.0.1", "localhost"].includes(requestUrl.hostname) || ["blob:", "data:"].includes(requestUrl.protocol)) await route.continue();
    else { externalRequests.push(requestUrl.origin); await route.abort(); }
  });
  await page.goto("/");
  expect(await page.evaluate(() => navigator.userAgent)).toContain("Firefox/");
  await expect(page.getByText("Enter Zoe")).toBeVisible();
  await capture(page, "patient-entry-firefox.png");
  await page.getByRole("button", { name: "Unlock synthetic preview" }).click();
  await expect(page.getByText("Good morning, Mira")).toBeVisible();
  await capture(page, "patient-home-firefox.png");

  await page.getByRole("button", { name: "Records", exact: true }).click();
  await expect(page.getByText("Health record", { exact: true })).toBeVisible();
  await capture(page, "patient-records-firefox.png");

  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Import Rx photo" }).click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles({
    name: "synthetic-prescription.svg",
    mimeType: "image/svg+xml",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="620"><rect width="100%" height="100%" fill="#fffdf8"/><rect x="45" y="45" width="910" height="530" rx="18" fill="none" stroke="#2f5d4f" stroke-width="8"/><text x="90" y="145" font-family="sans-serif" font-size="58" font-weight="700" fill="#18302a">SYNTHETIC RX</text><text x="90" y="245" font-family="sans-serif" font-size="40" fill="#18302a">Metformin 500 mg</text><text x="90" y="325" font-family="sans-serif" font-size="32" fill="#4e635c">Demo only · not a real prescription</text><line x1="90" y1="390" x2="850" y2="390" stroke="#d8ddd7" stroke-width="5"/><line x1="90" y1="455" x2="760" y2="455" stroke="#d8ddd7" stroke-width="5"/></svg>')
  });
  await expect(page.getByText("Image loaded for visual reference only.", { exact: false })).toBeVisible();
  await page.getByLabel("Name").fill("Metformin 500 mg");
  await page.getByLabel("Details").fill("Synthetic transcription awaiting patient confirmation.");
  await page.getByRole("checkbox").click();
  await capture(page, "patient-import-review-firefox.png");

  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByRole("textbox", { name: "Question", exact: true }).fill("What medicine am I taking?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText(/Metformin 500 mg:/)).toBeVisible();
  await capture(page, "patient-chat-firefox.png");

  await page.getByRole("button", { name: "Wellness", exact: true }).click();
  await expect(page.getByText("Only fresh, stable readings appear")).toBeVisible();
  await expect(page.getByText(/Status unconfigured/)).toBeHidden();
  await capture(page, "patient-wellness-firefox.png");
  const technicalDetails = page.getByRole("button", { name: "Technical details" });
  await technicalDetails.click();
  await expect(technicalDetails).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText(/Status unconfigured/)).toBeVisible();
  await technicalDetails.click();

  expect(externalRequests).toEqual([]);
});

test("patient layout fits every supported width with 48px controls", async ({ page, browserName }) => {
  expect(browserName).toBe("firefox");
  for (const width of [320, 360, 430, 1024]) {
    await page.setViewportSize({ width, height: 932 });
    await page.goto("/");
    await page.getByRole("button", { name: "Unlock synthetic preview" }).click();
    await expect(page.getByText("Good morning, Mira")).toBeVisible();

    const lockBox = await page.getByRole("button", { name: "Lock vault" }).boundingBox();
    expect(lockBox?.height, `Lock vault height at ${width}px`).toBeGreaterThanOrEqual(48);

    for (const label of navigationLabels) {
      const control = page.getByRole("button", { name: label, exact: true });
      const controlBox = await control.boundingBox();
      expect(controlBox?.height, `${label} height at ${width}px`).toBeGreaterThanOrEqual(48);
      await control.click();
      await expect(control).toHaveAttribute("aria-current", "page");
      const overflow = await page.evaluate(() => ({
        viewport: window.innerWidth,
        document: document.documentElement.scrollWidth,
        body: document.body.scrollWidth
      }));
      expect(overflow.document, `${label} document width at ${width}px`).toBeLessThanOrEqual(overflow.viewport);
      expect(overflow.body, `${label} body width at ${width}px`).toBeLessThanOrEqual(overflow.viewport);
    }

    await page.getByRole("button", { name: "Ask", exact: true }).click();
    const sendBox = await page.getByRole("button", { name: "Send question" }).boundingBox();
    expect(sendBox, `Send box at ${width}px`).not.toBeNull();
    expect((sendBox?.x ?? 0) + (sendBox?.width ?? 0), `Send right edge at ${width}px`).toBeLessThanOrEqual(width);
  }
});

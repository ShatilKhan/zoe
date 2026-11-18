import { expect, test } from "@playwright/test";

test("patient can add a reviewed record and ask a sourced question", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Unlock synthetic preview" }).click();
  await expect(page.getByText("Good morning, Mira")).toBeVisible();

  await page.getByRole("button", { name: "Records", exact: true }).click();
  await page.getByRole("button", { name: "Add manually" }).click();
  await page.getByLabel("Name").fill("Synthetic asthma note");
  await page.getByLabel("Details").fill("Synthetic demo: inhaler reviewed at a clinic visit.");
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Confirm patient-entered record" }).click();
  await expect(page.getByText("Saved as a confirmed patient-reviewed record.")).toBeVisible();
  await expect(page.getByText("Synthetic asthma note")).toBeVisible();

  await page.getByRole("button", { name: "Ask", exact: true }).click();
  await page.getByRole("textbox", { name: "Question", exact: true }).fill("What medicine am I taking?");
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByText(/Metformin 500 mg:/)).toBeVisible();
  await expect(page.getByText(/rec-med-metformin|Metformin 500 mg · photo-transcribed/)).toBeVisible();
});

test("synthetic preview cannot claim or create a cloud share", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Unlock synthetic preview" }).click();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  await expect(page.getByText("Cloud sharing is unavailable in synthetic preview.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Encrypt and upload selected records" })).toBeDisabled();
});

test("clinician viewer fails closed without its publishable key", async ({ page }) => {
  await page.goto("http://127.0.0.1:4173/?objectId=00000000-0000-4000-8000-000000000001#synthetic-key");
  await expect(page.getByRole("heading", { name: "Share unavailable" })).toBeVisible();
  await expect(page.getByText("Clinician viewer is not configured with the Supabase publishable key.")).toBeVisible();
  await expect(page.getByText("No record content was rendered.")).toBeVisible();
});

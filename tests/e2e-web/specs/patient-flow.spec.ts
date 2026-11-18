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

test("patient preview contains no clinician sharing route", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Unlock synthetic preview" }).click();
  await expect(page.getByRole("button", { name: "Share", exact: true })).toHaveCount(0);
  await expect(page.getByText(/clinician|recipient|cloud sharing/i)).toHaveCount(0);
});

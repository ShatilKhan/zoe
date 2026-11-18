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

test("OTP session opens an empty account vault without exposing its raw identity", async ({ page }) => {
  const accountId = "00000000-0000-4000-8000-000000000099";
  const email = "mira.patient@example.com";
  await page.route("https://ixwpotnpnlotjecmjbnb.supabase.co/auth/v1/**", async (route) => {
    if (route.request().url().endsWith("/otp")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        access_token: "synthetic-access-token",
        refresh_token: "synthetic-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        user: { id: accountId, email, aud: "authenticated", role: "authenticated" }
      })
    });
  });

  await page.goto("/");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send one-time code" }).click();
  await page.getByLabel("One-time code").fill("123456");
  await page.getByRole("button", { name: "Verify code and unlock" }).click();

  await expect(page.getByText("Your health record", { exact: true })).toBeVisible();
  await expect(page.getByText("Your encrypted vault is empty. Add your first reviewed record.")).toBeVisible();
  await expect(page.getByText("Signed in · m***@example.com")).toBeVisible();
  await expect(page.getByText("Good morning, Mira")).toHaveCount(0);
  await expect(page.getByText(accountId)).toHaveCount(0);
  await expect(page.getByText(email)).toHaveCount(0);
});

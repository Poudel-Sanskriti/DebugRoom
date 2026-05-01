import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("a learner runs Python, seeks through its trace, and keeps old input attached to the run", async ({
  page,
}) => {
  const key = (await readFile(".data/local-login-token", "utf8")).trim();
  await page.goto("/#local=" + encodeURIComponent(key));
  await page
    .getByRole("combobox", { name: "Load example" })
    .selectOption("binary-search");
  await page.getByRole("button", { name: "Run code", exact: false }).click();
  await expect(page.locator(".outcome-badge")).toHaveText("Completed", {
    timeout: 30_000,
  });
  await expect(page.locator(".final-return")).toContainText("5");
  const timeline = page.getByRole("slider", { name: "Execution timeline" });
  await timeline.focus();
  await timeline.press("End");
  await expect(
    page.getByRole("button", { name: "Next", exact: true }),
  ).toBeDisabled();
  await timeline.press("Home");
  await expect(
    page.getByRole("button", { name: "Previous", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(timeline).toHaveValue("1");
  await expect(page.locator(".cm-trace-line")).toHaveCount(1);
  const capturedInput = await page.getByLabel("Program input").inputValue();
  await page.getByRole("tab", { name: "Working draft" }).click();
  await page.getByLabel("Program input").fill('{"args":[[],11],"kwargs":{}}');
  await expect(page.locator(".save-indicator")).toContainText(
    "All changes saved",
  );
  await page.getByRole("tab", { name: "Run snapshot" }).click();
  await expect(page.getByLabel("Program input")).toHaveValue(capturedInput);
  await page.reload();
  await expect(page.locator(".outcome-badge")).toHaveText("Completed");
  await expect(page.getByLabel("Program input")).toHaveValue(capturedInput);
});

test("an invitation opens a separate student view and revocation ends that session", async ({
  page,
  browser,
}) => {
  const key = (await readFile(".data/local-login-token", "utf8")).trim();
  await page.goto("/#local=" + encodeURIComponent(key));
  await page.getByRole("button", { name: "Feedback", exact: true }).click();
  await page
    .getByRole("button", { name: "Invite student", exact: true })
    .click();
  await page.getByRole("button", { name: "Create private link" }).click();
  const link = await page
    .getByRole("textbox", { name: "Student invitation link" })
    .inputValue();
  const student = await browser.newContext(),
    studentPage = await student.newPage();
  try {
    await studentPage.goto(link);
    await studentPage.getByRole("button", { name: "Join workspace" }).click();
    await expect(
      studentPage.getByRole("combobox", { name: "Choose branch" }),
    ).toHaveCount(0);
    await studentPage
      .getByRole("button", { name: "Feedback", exact: true })
      .click();
    await expect(
      studentPage.getByRole("button", { name: "Invite student" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Revoke student access" }).click();
    await page
      .getByRole("button", { name: "Revoke access", exact: true })
      .click();
    await studentPage.reload();
    await expect(
      studentPage.getByRole("heading", {
        name: "A room for better questions.",
      }),
    ).toBeVisible();
  } finally {
    await student.close();
  }
});

import { test, expect } from "@playwright/test";
// Each check owns a fresh workspace, never the learner's existing draft.
let workspaceId: string;
test.beforeEach(async ({ page }) => {
  workspaceId = "";
  const origin = "http://127.0.0.1:5173";
  await page.request.post("/api/auth/local", { headers: { origin }, data: {} });
  const session = await (await page.request.get("/api/session")).json();
  const created = await page.request.post("/api/workspaces", {
    headers: { origin, "x-csrf-token": session.csrf },
    data: { title: `Playwright verification ${Date.now()}` },
  });
  expect(created.ok()).toBeTruthy();
  workspaceId = (await created.json()).id;
  await page.goto("/");
});
test.afterEach(async ({ page }) => {
  if (!workspaceId) return;
  const session = await (await page.request.get("/api/session")).json();
  const deleted = await page.request.delete(`/api/workspaces/${workspaceId}`, {
    headers: { origin: "http://127.0.0.1:5173", "x-csrf-token": session.csrf },
  });
  expect(deleted.ok()).toBeTruthy();
  workspaceId = "";
});

test("a learner runs Python, seeks through its trace, and keeps old input attached to the run", async ({
  page,
}) => {
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
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const visual = await page
    .getByRole("region", { name: "Execution visualization" })
    .boundingBox();
  expect(visual!.y + visual!.height).toBeLessThanOrEqual(768);
  const array = page.getByLabel("nums array visualization", { exact: true });
  expect(
    await array.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
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
    await studentPage.goto("/");
    await expect(studentPage.getByRole("alert")).toContainText(
      "This session has ended",
    );
    await expect(
      studentPage.getByRole("button", { name: "Create workspace" }),
    ).toHaveCount(0);
  } finally {
    await student.close();
  }
});

test("fresh local entry needs no key and array playback can be replayed with reduced motion", async ({
  page,
  browser,
}, testInfo) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  const fresh = await browser.newContext();
  try {
    const freshPage = await fresh.newPage();
    await freshPage.goto("/");
    await expect(
      freshPage.getByRole("button", { name: "Create workspace" }),
    ).toBeVisible();
    await expect(freshPage.getByLabel("Local access key")).toHaveCount(0);
  } finally {
    await fresh.close();
  }
  await page
    .getByRole("combobox", { name: "Load example" })
    .selectOption("bubble-sort");
  await page.getByRole("button", { name: "Run code", exact: false }).click();
  await expect(page.locator(".outcome-badge")).toHaveText("Completed", {
    timeout: 30_000,
  });
  const timeline = page.getByRole("slider", { name: "Execution timeline" });
  await timeline.focus();
  await timeline.press("End");
  await expect(page.getByLabel("Index 0: 1", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Index 4: 5", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Visualize", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".inspector")).toHaveCSS("overflow-y", "visible");
  await page.evaluate(() => window.scrollTo(0, 0));
  const bounds = await page
    .getByRole("region", { name: "Execution visualization" })
    .boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(768);
  await page.getByRole("button", { name: "Replay execution" }).click();
  await expect(
    page.getByRole("button", { name: "Pause playback" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Pause playback" }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await timeline.focus();
  await timeline.press("End");
  await expect(page.locator(".stage-cell").first()).toHaveCSS(
    "transition-duration",
    "0s",
  );
  await page.screenshot({
    path: testInfo.outputPath("execution-studio-desktop.png"),
    fullPage: true,
  });
  await page.getByRole("tab", { name: "Output", exact: true }).click();
  await expect(page.locator(".final-return")).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Execution visualization" }),
  ).toBeHidden();
  await page.getByRole("tab", { name: "Visualize", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("region", { name: "Execution visualization" }),
  ).toBeVisible();
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter(
        (element) =>
          element.getBoundingClientRect().right > innerWidth &&
          getComputedStyle(element).position !== "absolute",
      )
      .map((element) => element.className)
      .slice(0, 12),
  );
  expect(
    await page.locator("body").evaluate((element) => element.scrollWidth),
    JSON.stringify(overflow),
  ).toBe(390);
  await page.screenshot({
    path: testInfo.outputPath("execution-studio-mobile.png"),
    fullPage: true,
  });
});

test("recursive playback follows the captured call stack and return value", async ({
  page,
}, testInfo) => {
  await page
    .getByRole("combobox", { name: "Load example" })
    .selectOption("recursion");
  await page.getByRole("button", { name: "Run code", exact: false }).click();
  await expect(page.locator(".outcome-badge")).toHaveText("Completed", {
    timeout: 30_000,
  });
  const timeline = page.getByRole("slider", { name: "Execution timeline" });
  await timeline.focus();
  await timeline.press("End");
  await expect(page.locator(".stage-return")).toContainText("24");
  await expect(page.locator(".stage-call.is-current")).toContainText(
    "factorial()",
  );
  await page.screenshot({
    path: testInfo.outputPath("execution-studio-recursion.png"),
    fullPage: true,
  });
});

test("C++ vector execution renders captured values and output", async ({
  page,
}) => {
  await page
    .getByRole("combobox", { name: "Load example" })
    .selectOption("cpp-vector");
  await page.getByRole("button", { name: "Run code", exact: false }).click();
  await expect(page.locator(".outcome-badge")).toHaveText("Completed", {
    timeout: 30_000,
  });
  const timeline = page.getByRole("slider", { name: "Execution timeline" });
  await timeline.focus();
  await timeline.press("End");
  await expect(page.getByLabel("Index 0: 10", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Index 3: 4", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Output", exact: true }).click();
  await expect(page.locator(".output-stream pre").first()).toHaveText("4\n");
  await expect(page.locator(".final-return")).toContainText("Exit code0");
});

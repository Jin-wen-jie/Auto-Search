import { expect, test } from "@playwright/test";

test("admin can login and see dashboard", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("用户名").fill("owner");
  await page.getByLabel("密码").fill("demo-password-for-testing");

  // Listen for the login API response
  const loginResponse = page.waitForResponse(
    (r) => r.url().includes("/api/auth/login") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "登录" }).click();
  const resp = await loginResponse;
  
  // Check if login was successful
  expect(resp.status()).toBe(200);
  const body = await resp.json();
  expect(body.ok).toBe(true);
  expect(body.forcePasswordChange).toBe(false);

  // Now the client should redirect to /dashboard
  await page.waitForURL("**/dashboard", { timeout: 10000 });
});

test("login page does not show signup", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByText("注册")).toHaveCount(0);
});

test("unauthenticated user is redirected to login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

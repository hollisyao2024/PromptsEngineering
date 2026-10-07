import { expect, test } from '@playwright/test';

// Replace the placeholder ids in the titles with real ones from the PRD atomic AC table and the test case list:
// "qa run" binds results to them through the JUnit case name. Use one describe per AC and one test per case.
test.describe('AC-EXAMPLE-001-01 应用首页可达', () => {
  test('TC-EXAMPLE-001 首页返回成功响应并渲染页面', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.ok()).toBe(true);
    await expect(page.locator('body')).toBeVisible();
  });
});

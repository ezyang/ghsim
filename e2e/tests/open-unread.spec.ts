import { test, expect } from '@playwright/test';
import mixedFixture from '../fixtures/notifications_mixed.json';
import { clearAppStorage } from './storage-utils';

test.describe('Open all button', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (window as typeof window & { openedUrls?: string[] }).openedUrls = [];
      window.open = ((url?: string | URL | null) => {
        const target = url ? url.toString() : '';
        (window as typeof window & { openedUrls: string[] }).openedUrls.push(target);
        return null;
      }) as typeof window.open;
    });

    await page.route('**/github/rest/user', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ login: 'testuser' }),
      });
    });

    await page.route('**/notifications/html/repo/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mixedFixture),
      });
    });

    await page.goto('notifications.html');
    await clearAppStorage(page);

    await page.locator('#repo-input').fill('test/repo');
    await page.locator('#sync-btn').click();
    await expect(page.locator('#status-bar')).toContainText('Synced 5 notifications');
  });

  test('opens all filtered notifications as new tabs', async ({ page }) => {
    const openUnreadBtn = page.locator('#open-unread-btn');
    await expect(openUnreadBtn).toBeVisible();

    await openUnreadBtn.click();

    const openedUrls = await page.evaluate(
      () => (window as typeof window & { openedUrls?: string[] }).openedUrls ?? []
    );
    expect(openedUrls).toEqual([
      'https://github.com/test/repo/issues/42',
      'https://github.com/test/repo/issues/41',
      'https://github.com/test/repo/issues/39',
    ]);
  });
});

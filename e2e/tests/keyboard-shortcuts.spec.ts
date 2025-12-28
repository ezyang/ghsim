import { test, expect } from '@playwright/test';
import mixedFixture from '../fixtures/notifications_mixed.json';

test.describe('Keyboard Shortcuts', () => {
  test.beforeEach(async ({ page }) => {
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

    const commentCache = {
      version: 1,
      threads: {
        'notif-2': {
          notificationUpdatedAt: mixedFixture.notifications[1].updated_at,
          lastReadAt: mixedFixture.notifications[1].last_read_at || null,
          unread: true,
          allComments: true,
          fetchedAt: new Date().toISOString(),
          comments: [],
          reviews: [
            {
              user: { login: 'reviewer' },
              state: 'APPROVED',
              submitted_at: '2024-12-27T11:00:00Z',
            },
          ],
        },
      },
    };

    await page.addInitScript(
      ({ cacheKey, prefetchKey, cacheValue }) => {
        localStorage.setItem(cacheKey, JSON.stringify(cacheValue));
        localStorage.setItem(prefetchKey, 'true');
      },
      {
        cacheKey: 'ghnotif_bulk_comment_cache_v1',
        prefetchKey: 'ghnotif_comment_prefetch_enabled',
        cacheValue: commentCache,
      }
    );

    await page.goto('notifications.html');

    await page.locator('#repo-input').fill('test/repo');
    await page.locator('#sync-btn').click();
    await expect(page.locator('.notification-item')).toHaveCount(5);
  });

  test('j/k moves the active selection', async ({ page }) => {
    await page.keyboard.press('j');

    await expect(page.locator('.notification-item').first()).toHaveClass(/keyboard-selected/);
    await expect(page.locator('.notification-item.keyboard-selected')).toHaveCount(1);

    await page.keyboard.press('j');
    await expect(page.locator('.notification-item').nth(1)).toHaveClass(/keyboard-selected/);
    await expect(page.locator('.notification-item.keyboard-selected')).toHaveCount(1);

    await page.keyboard.press('k');
    await expect(page.locator('.notification-item').first()).toHaveClass(/keyboard-selected/);
  });

  test('e marks the active notification as done', async ({ page }) => {
    await page.route('**/github/rest/notifications/threads/**', (route) => {
      route.fulfill({ status: 204 });
    });

    await page.keyboard.press('j');
    await page.keyboard.press('e');

    await expect(page.locator('#status-bar')).toContainText('Marked 1 notification as done');
    await expect(page.locator('[data-id="notif-1"]')).toHaveCount(0);
  });

  test('m unsubscribes the active approved notification', async ({ page }) => {
    await page.route(
      '**/github/rest/notifications/threads/**/subscription',
      (route) => {
        route.fulfill({ status: 204 });
      }
    );
    await page.route('**/github/rest/notifications/threads/**', (route) => {
      route.fulfill({ status: 204 });
    });

    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('m');

    await expect(page.locator('#status-bar')).toContainText(
      'Unsubscribed and marked 1 notification as done'
    );
    await expect(page.locator('[data-id="notif-2"]')).not.toBeAttached();
  });

  test('r refreshes the page', async ({ page }) => {
    const navigationPromise = page.waitForNavigation();
    await page.keyboard.press('r');
    await navigationPromise;

    // After reload, the page should be back to initial state
    await expect(page.locator('#empty-state')).toBeVisible();
  });

  test('marking notification as done moves selection to next notification without scrolling', async ({
    page,
  }) => {
    await page.route('**/github/rest/notifications/threads/**', (route) => {
      route.fulfill({ status: 204 });
    });

    // Press j to select the first notification
    await page.keyboard.press('j');
    await expect(page.locator('[data-id="notif-1"]')).toHaveClass(/keyboard-selected/);

    // Get the scroll position before marking as done
    const scrollBefore = await page.evaluate(() => window.scrollY);

    // Mark as done - this should move selection to next notification
    await page.keyboard.press('e');

    // Wait for the notification to be removed
    await expect(page.locator('[data-id="notif-1"]')).not.toBeAttached();

    // The selection should now be on the next notification (notif-2), not back to the first
    await expect(page.locator('[data-id="notif-2"]')).toHaveClass(/keyboard-selected/);

    // Scroll position should not have changed significantly (viewport stays stable)
    const scrollAfter = await page.evaluate(() => window.scrollY);
    expect(Math.abs(scrollAfter - scrollBefore)).toBeLessThan(10);
  });

  test('marking middle notification as done moves selection to next, not first', async ({
    page,
  }) => {
    await page.route('**/github/rest/notifications/threads/**', (route) => {
      route.fulfill({ status: 204 });
    });

    // Navigate to the third notification (notif-3)
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await page.keyboard.press('j');
    await expect(page.locator('[data-id="notif-3"]')).toHaveClass(/keyboard-selected/);

    // Mark as done - selection should move to notif-4, not notif-1
    await page.keyboard.press('e');

    // Wait for the notification to be removed
    await expect(page.locator('[data-id="notif-3"]')).not.toBeAttached();

    // The selection should be on notif-4 (the next one), NOT notif-1 (the first one)
    await expect(page.locator('[data-id="notif-4"]')).toHaveClass(/keyboard-selected/);
    await expect(page.locator('[data-id="notif-1"]')).not.toHaveClass(/keyboard-selected/);
  });

  test('Enter opens the active notification in a new tab', async ({ page, context }) => {
    // Navigate to first notification
    await page.keyboard.press('j');
    await expect(page.locator('[data-id="notif-1"]')).toHaveClass(/keyboard-selected/);

    // Listen for new page (popup/tab)
    const pagePromise = context.waitForEvent('page');

    // Press Enter to open the notification
    await page.keyboard.press('Enter');

    // Verify new tab was opened with the correct URL
    const newPage = await pagePromise;
    expect(newPage.url()).toBe('https://github.com/test/repo/issues/42');
  });

  test('Enter does nothing when no notification is selected', async ({ page, context }) => {
    // Verify no notification is selected
    await expect(page.locator('.notification-item.keyboard-selected')).toHaveCount(0);

    // Set up a promise that will reject if a new page opens
    let newPageOpened = false;
    context.on('page', () => {
      newPageOpened = true;
    });

    // Press Enter
    await page.keyboard.press('Enter');

    // Wait a moment to ensure no page opens
    await page.waitForTimeout(100);

    // No new page should have opened
    expect(newPageOpened).toBe(false);
  });
});

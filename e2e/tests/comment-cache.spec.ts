import { test, expect } from '@playwright/test';

test.describe('Comment cache', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/github/rest/user', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          login: 'testuser',
          name: 'Test User',
        }),
      });
    });

    await page.route('**/github/rest/rate_limit', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          resources: {
            core: {
              remaining: 42,
              limit: 60,
              reset: Math.floor(Date.now() / 1000) + 3600,
            },
          },
        }),
      });
    });
  });

  test('clear cache button removes stored comments', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('ghnotif_comment_prefetch_enabled', 'true');
      localStorage.setItem(
        'ghnotif_bulk_comment_cache_v1',
        JSON.stringify({
          version: 1,
          threads: {
            '123': {
              fetchedAt: new Date().toISOString(),
              comments: [],
            },
          },
        })
      );
    });

    await page.goto('notifications.html');

    const status = page.locator('#comment-cache-status');
    const clearBtn = page.locator('#clear-comment-cache-btn');

    await expect(status).toContainText('Comments cached: 1');
    await expect(clearBtn).toBeEnabled();

    await clearBtn.click();

    await expect(status).toContainText('Comments cached: 0');
    await expect(clearBtn).toBeDisabled();

    const cachedValue = await page.evaluate(() =>
      localStorage.getItem('ghnotif_bulk_comment_cache_v1')
    );
    expect(cachedValue).toBeNull();
  });
});

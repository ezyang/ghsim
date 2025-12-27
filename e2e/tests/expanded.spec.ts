import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';
import { join } from 'path';

const fixturesDir = join(__dirname, '..', 'fixtures');
const page1 = JSON.parse(
  readFileSync(join(fixturesDir, 'expanded_notifications_page1.json'), 'utf-8')
);
const page2 = JSON.parse(
  readFileSync(join(fixturesDir, 'expanded_notifications_page2.json'), 'utf-8')
);

test.describe('Expanded Notifications', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('expanded.html');
    await page.evaluate(() => localStorage.clear());
  });

  test('syncs first page and prefetches comments', async ({ page }) => {
    await page.route('**/notifications/html/repo/testowner/testrepo', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(page1),
      });
    });

    await page.route('**/github/rest/notifications**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'rest-thread-1',
            last_read_at: '2025-01-01T00:00:00Z',
            unread: true,
            repository: { full_name: 'testowner/testrepo' },
            subject: {
              type: 'Issue',
              url: 'https://api.github.com/repos/testowner/testrepo/issues/1',
            },
          },
        ]),
      });
    });

    await page.route(
      '**/github/rest/repos/testowner/testrepo/issues/1/comments**',
      (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([
            {
              id: 101,
              user: { login: 'commenter' },
              body: 'First expanded comment',
              created_at: '2025-01-01T01:30:00Z',
              updated_at: '2025-01-01T01:30:00Z',
            },
          ]),
        });
      }
    );

    await page.locator('#repo-input').fill('testowner/testrepo');
    await page.locator('#sync-btn').click();

    await expect(page.locator('.thread-card')).toHaveCount(1);
    await expect(page.locator('.thread-title')).toContainText('Expanded view issue');
    await expect(page.locator('.comment-body')).toContainText(
      'First expanded comment'
    );
  });

  test('loads next page without refetching previous comments', async ({ page }) => {
    let commentCalls = 0;

    await page.route('**/notifications/html/repo/testowner/testrepo', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(page1),
      });
    });

    await page.route('**/github/rest/notifications**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'rest-thread-1',
            last_read_at: '2025-01-01T00:00:00Z',
            unread: true,
            repository: { full_name: 'testowner/testrepo' },
            subject: {
              type: 'Issue',
              url: 'https://api.github.com/repos/testowner/testrepo/issues/1',
            },
          },
          {
            id: 'rest-thread-2',
            last_read_at: '2025-01-01T01:30:00Z',
            unread: false,
            repository: { full_name: 'testowner/testrepo' },
            subject: {
              type: 'Issue',
              url: 'https://api.github.com/repos/testowner/testrepo/issues/2',
            },
          },
        ]),
      });
    });

    await page.route(
      '**/notifications/html/repo/testowner/testrepo?after=cursor-2',
      (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(page2),
        });
      }
    );

    await page.route(
      '**/github/rest/repos/testowner/testrepo/issues/1/comments**',
      (route) => {
        commentCalls += 1;
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      }
    );

    await page.route(
      '**/github/rest/repos/testowner/testrepo/issues/2/comments**',
      (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      }
    );

    await page.locator('#repo-input').fill('testowner/testrepo');
    await page.locator('#sync-btn').click();

    await expect(page.locator('.thread-card')).toHaveCount(1);
    await page.locator('#load-more-btn').click();

    await expect(page.locator('.thread-card')).toHaveCount(2);
    expect(commentCalls).toBe(1);
  });

  test('skips auto-prefetch when toggle is disabled', async ({ page }) => {
    let commentCalls = 0;

    await page.route('**/notifications/html/repo/testowner/testrepo', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(page1),
      });
    });

    await page.route(
      '**/github/rest/repos/testowner/testrepo/issues/1/comments**',
      (route) => {
        commentCalls += 1;
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      }
    );

    await page.locator('#auto-prefetch').uncheck();
    await page.locator('#repo-input').fill('testowner/testrepo');
    await page.locator('#sync-btn').click();

    await expect(page.locator('.thread-card')).toHaveCount(1);
    await expect(page.locator('.comment-empty')).toContainText(
      'Waiting on prefetch'
    );
    expect(commentCalls).toBe(0);
  });

  test('loads next page from footer button', async ({ page }) => {
    await page.route('**/notifications/html/repo/testowner/testrepo', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(page1),
      });
    });

    await page.route(
      '**/notifications/html/repo/testowner/testrepo?after=cursor-2',
      (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(page2),
        });
      }
    );

    await page.route(
      '**/github/rest/repos/testowner/testrepo/issues/1/comments**',
      (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      }
    );

    await page.route(
      '**/github/rest/repos/testowner/testrepo/issues/2/comments**',
      (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([]),
        });
      }
    );

    await page.locator('#repo-input').fill('testowner/testrepo');
    await page.locator('#sync-btn').click();

    await expect(page.locator('#load-more-footer')).toBeEnabled();
    await page.locator('#load-more-footer').click();

    await expect(page.locator('.thread-card')).toHaveCount(2);
  });

  test('shows prefetch errors inline', async ({ page }) => {
    await page.route('**/notifications/html/repo/testowner/testrepo', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(page1),
      });
    });

    await page.route('**/github/rest/notifications**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 'rest-thread-1',
            last_read_at: '2025-01-01T00:00:00Z',
            unread: true,
            repository: { full_name: 'testowner/testrepo' },
            subject: {
              type: 'Issue',
              url: 'https://api.github.com/repos/testowner/testrepo/issues/1',
            },
          },
        ]),
      });
    });

    await page.route(
      '**/github/rest/repos/testowner/testrepo/issues/1/comments**',
      (route) => {
        route.fulfill({
          status: 500,
          contentType: 'text/plain',
          body: 'server blew up',
        });
      }
    );

    await page.locator('#repo-input').fill('testowner/testrepo');
    await page.locator('#sync-btn').click();

    await expect(page.locator('.comment-empty')).toContainText(
      'Prefetch error'
    );
  });
});

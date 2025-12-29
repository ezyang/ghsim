import { test, expect } from '@playwright/test';
import { clearAppStorage } from './storage-utils';

const fixture = {
  source_url: 'https://github.com/notifications?query=repo:test/repo',
  generated_at: '2024-12-27T12:00:00Z',
  repository: {
    owner: 'test',
    name: 'repo',
    full_name: 'test/repo',
  },
  notifications: [
    {
      id: 'notif-issue-1',
      unread: true,
      reason: 'subscribed',
      updated_at: '2024-12-27T11:30:00Z',
      subject: {
        title: 'Issue: flaky tests',
        url: 'https://github.com/test/repo/issues/11',
        type: 'Issue',
        number: 11,
        state: 'open',
        state_reason: null,
      },
      actors: [
        {
          login: 'alice',
          avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
        },
      ],
      ui: {
        saved: false,
        done: false,
      },
    },
    {
      id: 'notif-pr-author',
      unread: true,
      reason: 'author',
      updated_at: '2024-12-27T10:00:00Z',
      subject: {
        title: 'PR: add new endpoint',
        url: 'https://github.com/test/repo/pull/12',
        type: 'PullRequest',
        number: 12,
        state: 'open',
        state_reason: null,
      },
      actors: [
        {
          login: 'reviewer',
          avatar_url: 'https://avatars.githubusercontent.com/u/2?v=4',
        },
      ],
      ui: {
        saved: false,
        done: false,
      },
    },
    {
      id: 'notif-pr-comment',
      unread: false,
      reason: 'comment',
      updated_at: '2024-12-27T09:30:00Z',
      subject: {
        title: 'PR: improve docs',
        url: 'https://github.com/test/repo/pull/13',
        type: 'PullRequest',
        number: 13,
        state: 'open',
        state_reason: null,
      },
      actors: [
        {
          login: 'testuser',
          avatar_url: 'https://avatars.githubusercontent.com/u/3?v=4',
        },
      ],
      ui: {
        saved: false,
        done: false,
      },
    },
  ],
  pagination: {
    before_cursor: null,
    after_cursor: null,
    has_previous: false,
    has_next: false,
  },
};

test.describe('My PR classification', () => {
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
        body: JSON.stringify(fixture),
      });
    });

    await page.goto('notifications.html');
    await clearAppStorage(page);
  });

  test('uses author reason instead of actor for My PRs', async ({ page }) => {
    const input = page.locator('#repo-input');
    await input.fill('test/repo');
    await page.locator('#sync-btn').click();
    await expect(page.locator('#status-bar')).toContainText('Synced 3 notifications');

    await expect(page.locator('#view-issues .count')).toHaveText('1');
    await expect(page.locator('#view-my-prs .count')).toHaveText('1');
    await expect(page.locator('#view-others-prs .count')).toHaveText('1');

    await page.locator('#view-my-prs').click();
    await expect(page.locator('.notification-item')).toHaveCount(1);
    await expect(page.locator('[data-id="notif-pr-author"]')).toBeVisible();

    await page.locator('#view-others-prs').click();
    await expect(page.locator('.notification-item')).toHaveCount(1);
    await expect(page.locator('[data-id="notif-pr-comment"]')).toBeVisible();
  });
});

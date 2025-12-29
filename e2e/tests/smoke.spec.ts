import { test, expect } from '@playwright/test';

/**
 * Smoke tests for the GitHub notifications webapp.
 *
 * These tests verify that the basic page structure loads correctly.
 */

test.describe('Smoke Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Clear cached storage before each test for isolation
    await page.addInitScript(() => {
      localStorage.clear();
      indexedDB.deleteDatabase('ghnotif_cache');
    });
  });

  test('page loads without JavaScript errors', async ({ page }) => {
    const errors: string[] = [];

    // Collect any JavaScript errors
    page.on('pageerror', (error) => {
      errors.push(error.message);
    });

    await page.goto('notifications.html');

    // Wait for page to be fully loaded
    await page.waitForLoadState('domcontentloaded');

    // No JavaScript errors should have occurred
    expect(errors).toEqual([]);
  });

  test('page has correct title', async ({ page }) => {
    await page.goto('notifications.html');

    // Check page title contains something meaningful
    const title = await page.title();
    expect(title).toBeTruthy();
    expect(title.length).toBeGreaterThan(0);
  });

  test('page shows initial empty state', async ({ page }) => {
    await page.goto('notifications.html');

    // The page should have some content (not blank)
    const bodyText = await page.textContent('body');
    expect(bodyText).toBeTruthy();
  });

  test('page has main structural elements', async ({ page }) => {
    await page.goto('notifications.html');

    // Check for basic HTML structure
    // These selectors will be updated as we build out the UI
    const html = await page.content();

    // Should have doctype and html tag
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html');
  });
});

test.describe('API Mocking Setup', () => {
  test('can mock notifications API response', async ({ page }) => {
    // Set up route interception for notifications API
    await page.route('**/notifications/html/repo/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          source_url: 'https://github.com/notifications?query=repo:test/repo',
          generated_at: new Date().toISOString(),
          repository: {
            owner: 'test',
            name: 'repo',
            full_name: 'test/repo',
          },
          notifications: [],
          pagination: {
            before_cursor: null,
            after_cursor: null,
            has_previous: false,
            has_next: false,
          },
        }),
      });
    });

    await page.goto('notifications.html');

    // The mock is set up - actual verification will happen in later tests
    // For now, just verify the page loaded with mocking enabled
    await page.waitForLoadState('domcontentloaded');
  });

  test('can mock GitHub user API response', async ({ page }) => {
    // Set up route interception for user API
    await page.route('**/github/rest/user', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          login: 'testuser',
          name: 'Test User',
          avatar_url: 'https://avatars.githubusercontent.com/u/1?v=4',
        }),
      });
    });

    await page.goto('notifications.html');
    await page.waitForLoadState('domcontentloaded');
  });
});

import { test, expect } from '@playwright/test';
import mixedFixture from '../fixtures/notifications_mixed.json';

// Fixture with authenticity_token included
const fixtureWithToken = {
  ...mixedFixture,
  authenticity_token: 'test-csrf-token-12345',
};

/**
 * Undo Tests
 *
 * Tests for undo functionality after marking notifications as done or unsubscribing.
 */

test.describe('Undo', () => {
  test.beforeEach(async ({ page }) => {
    // Mock auth endpoint
    await page.route('**/github/rest/user', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ login: 'testuser' }),
      });
    });

    // Mock notifications endpoint with token
    await page.route('**/notifications/html/repo/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(fixtureWithToken),
      });
    });

    // Mock mark done API
    await page.route('**/github/rest/notifications/threads/**', (route) => {
      route.fulfill({ status: 204 });
    });

    await page.goto('notifications.html');
    await page.evaluate(() => localStorage.clear());

    // Sync to load notifications
    await page.locator('#repo-input').fill('test/repo');
    await page.locator('#sync-btn').click();
    await expect(page.locator('#status-bar')).toContainText('Synced 5 notifications');
  });

  test.describe('Undo via Keyboard', () => {
    test('pressing u triggers undo', async ({ page }) => {
      // Mock the undo action endpoint
      await page.route('**/notifications/html/action', (route) => {
        const body = route.request().postDataJSON();
        expect(body.action).toBe('unarchive');
        expect(body.notification_ids).toEqual(['notif-1']);
        expect(body.authenticity_token).toBe('test-csrf-token-12345');
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ok' }),
        });
      });

      await expect(page.locator('.notification-item')).toHaveCount(3);

      // Mark as done
      const markDoneResponse = page.waitForResponse('**/github/rest/notifications/threads/**');
      await page.locator('[data-id="notif-1"] .notification-done-btn').click();
      await markDoneResponse;
      await expect(page.locator('#status-bar')).toContainText('Done 1/1 (0 pending)');
      await expect(page.locator('.notification-item')).toHaveCount(2);

      // Press u to undo
      await page.keyboard.press('u');

      // Notification should be restored
      await expect(page.locator('#status-bar')).toContainText('Undo successful');
      await expect(page.locator('.notification-item')).toHaveCount(3);
    });

    test('pressing u does nothing when no undo available', async ({ page }) => {
      // Just press u without any action
      await page.keyboard.press('u');

      // Nothing should happen
      await expect(page.locator('#status-bar')).toContainText('Synced 5 notifications');
    });

    test('u key is ignored when typing in input', async ({ page }) => {
      const markDoneResponse = page.waitForResponse('**/github/rest/notifications/threads/**');
      await page.locator('[data-id="notif-1"] .notification-done-btn').click();
      await markDoneResponse;
      await expect(page.locator('#status-bar')).toContainText('Done 1/1 (0 pending)');
      await expect(page.locator('.notification-item')).toHaveCount(2);

      // Focus on repo input and type 'u'
      await page.locator('#repo-input').focus();
      await page.keyboard.press('u');

      // Undo should NOT be triggered
      await expect(page.locator('.notification-item')).toHaveCount(2);
    });
  });

  test.describe('Undo Stack', () => {
    test('only most recent action can be undone', async ({ page }) => {
      await page.route('**/notifications/html/action', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ok' }),
        });
      });

      // Mark two notifications as done
      let markDoneResponse = page.waitForResponse('**/github/rest/notifications/threads/**');
      await page.locator('[data-id="notif-1"] .notification-done-btn').click();
      await markDoneResponse;
      await expect(page.locator('#status-bar')).toContainText('Done 1/1 (0 pending)');
      await expect(page.locator('.notification-item')).toHaveCount(2);

      markDoneResponse = page.waitForResponse('**/github/rest/notifications/threads/**');
      await page.locator('[data-id="notif-3"] .notification-done-btn').click();
      await markDoneResponse;
      await expect(page.locator('#status-bar')).toContainText('Done 2/2 (0 pending)');
      await expect(page.locator('.notification-item')).toHaveCount(1);

      // Undo should only restore the second one
      await page.keyboard.press('u');
      await expect(page.locator('.notification-item')).toHaveCount(2);
      await expect(page.locator('[data-id="notif-3"]')).toBeVisible();
      await expect(page.locator('[data-id="notif-1"]')).not.toBeVisible();

      // Second undo should do nothing (stack is empty)
      await page.keyboard.press('u');
      await expect(page.locator('.notification-item')).toHaveCount(2);
    });

  });

  test.describe('Notification Restoration', () => {
    test('restored notification appears in correct sorted position', async ({ page }) => {
      await page.route('**/notifications/html/action', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ok' }),
        });
      });

      // Mark the first notification as done
      const markDoneResponse = page.waitForResponse('**/github/rest/notifications/threads/**');
      await page.locator('[data-id="notif-1"] .notification-done-btn').click();
      await markDoneResponse;
      await expect(page.locator('#status-bar')).toContainText('Done 1/1 (0 pending)');
      await expect(page.locator('.notification-item')).toHaveCount(2);

      // Undo
      await page.keyboard.press('u');

      // Should be restored to the list
      await expect(page.locator('.notification-item')).toHaveCount(3);
      await expect(page.locator('[data-id="notif-1"]')).toBeVisible();
    });

    test('localStorage is updated after undo', async ({ page }) => {
      await page.route('**/notifications/html/action', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ok' }),
        });
      });

      const markDoneResponse = page.waitForResponse('**/github/rest/notifications/threads/**');
      await page.locator('[data-id="notif-1"] .notification-done-btn').click();
      await markDoneResponse;
      await expect(page.locator('#status-bar')).toContainText('Done 1/1 (0 pending)');
      await expect(page.locator('.notification-item')).toHaveCount(2);

      // Check localStorage after mark done
      let savedNotifications = await page.evaluate(() => {
        const saved = localStorage.getItem('ghnotif_notifications');
        return saved ? JSON.parse(saved) : [];
      });
      expect(savedNotifications.length).toBe(4);

      // Undo
      await page.keyboard.press('u');
      await expect(page.locator('#status-bar')).toContainText('Undo successful');

      // Check localStorage after undo
      savedNotifications = await page.evaluate(() => {
        const saved = localStorage.getItem('ghnotif_notifications');
        return saved ? JSON.parse(saved) : [];
      });
      expect(savedNotifications.length).toBe(5);
    });
  });

  test.describe('Token Persistence', () => {
    test('undo after reload uses persisted authenticity token', async ({ page }) => {
      await page.route('**/notifications/html/action', (route) => {
        const body = route.request().postDataJSON();
        expect(body.authenticity_token).toBe('test-csrf-token-12345');
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ status: 'ok' }),
        });
      });

      await page.reload();
      await expect(page.locator('.notification-item')).toHaveCount(3);

      const markDoneResponse = page.waitForResponse('**/github/rest/notifications/threads/**');
      await page.locator('[data-id="notif-1"] .notification-done-btn').click();
      await markDoneResponse;

      await page.keyboard.press('u');
      await expect(page.locator('#status-bar')).toContainText('Undo successful');
    });
  });
});

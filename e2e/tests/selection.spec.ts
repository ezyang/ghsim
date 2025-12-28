import { test, expect } from '@playwright/test';
import mixedFixture from '../fixtures/notifications_mixed.json';

/**
 * Phase 6: Selection Tests
 *
 * Tests for notification selection including checkboxes, select all,
 * and shift-click range selection.
 */

test.describe('Selection', () => {
  test.beforeEach(async ({ page }) => {
    // Mock auth endpoint
    await page.route('**/github/rest/user', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ login: 'testuser' }),
      });
    });

    // Mock notifications endpoint
    await page.route('**/notifications/html/repo/**', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(mixedFixture),
      });
    });

    await page.goto('notifications.html');
    await page.evaluate(() => localStorage.clear());

    // Sync to load notifications
    await page.locator('#repo-input').fill('test/repo');
    await page.locator('#sync-btn').click();
    await expect(page.locator('#status-bar')).toContainText('Synced 5 notifications');
  });

  test.describe('Notification Checkboxes', () => {
    test('each notification has a checkbox', async ({ page }) => {
      const checkboxes = page.locator('.notification-checkbox');
      await expect(checkboxes).toHaveCount(5);
    });

    test('checkboxes are unchecked by default', async ({ page }) => {
      const checkboxes = page.locator('.notification-checkbox');
      const count = await checkboxes.count();

      for (let i = 0; i < count; i++) {
        await expect(checkboxes.nth(i)).not.toBeChecked();
      }
    });

    test('clicking checkbox selects notification', async ({ page }) => {
      const checkbox = page.locator('[data-id="notif-1"] .notification-checkbox');
      await checkbox.click();

      await expect(checkbox).toBeChecked();
    });

    test('selected notification has selected class', async ({ page }) => {
      const checkbox = page.locator('[data-id="notif-1"] .notification-checkbox');
      await checkbox.click();

      const item = page.locator('[data-id="notif-1"]');
      await expect(item).toHaveClass(/selected/);
    });

    test('clicking checkbox again deselects notification', async ({ page }) => {
      const checkbox = page.locator('[data-id="notif-1"] .notification-checkbox');
      await checkbox.click();
      await checkbox.click();

      await expect(checkbox).not.toBeChecked();
      await expect(page.locator('[data-id="notif-1"]')).not.toHaveClass(/selected/);
    });

    test('can select multiple notifications', async ({ page }) => {
      await page.locator('[data-id="notif-1"] .notification-checkbox').click();
      await page.locator('[data-id="notif-3"] .notification-checkbox').click();

      await expect(page.locator('[data-id="notif-1"]')).toHaveClass(/selected/);
      await expect(page.locator('[data-id="notif-3"]')).toHaveClass(/selected/);
      await expect(page.locator('[data-id="notif-2"]')).not.toHaveClass(/selected/);
    });

    test('checkbox has aria-label for accessibility', async ({ page }) => {
      const checkbox = page.locator('[data-id="notif-1"] .notification-checkbox');
      await expect(checkbox).toHaveAttribute('aria-label', /Select notification:/);
    });
  });

  test.describe('Select All', () => {
    test('select all row is visible when notifications exist', async ({ page }) => {
      const selectAllRow = page.locator('#select-all-row');
      await expect(selectAllRow).toBeVisible();
    });

    test('select all row is hidden before sync', async ({ page }) => {
      // Clear and reload
      await page.evaluate(() => localStorage.clear());
      await page.reload();

      const selectAllRow = page.locator('#select-all-row');
      await expect(selectAllRow).not.toBeVisible();
    });

    test('select all checkbox is unchecked by default', async ({ page }) => {
      const selectAll = page.locator('#select-all-checkbox');
      await expect(selectAll).not.toBeChecked();
    });

    test('clicking select all selects all notifications', async ({ page }) => {
      await page.locator('#select-all-checkbox').click();

      const checkboxes = page.locator('.notification-checkbox');
      const count = await checkboxes.count();

      for (let i = 0; i < count; i++) {
        await expect(checkboxes.nth(i)).toBeChecked();
      }
    });

    test('clicking select all again deselects all', async ({ page }) => {
      await page.locator('#select-all-checkbox').click();
      await page.locator('#select-all-checkbox').click();

      const checkboxes = page.locator('.notification-checkbox');
      const count = await checkboxes.count();

      for (let i = 0; i < count; i++) {
        await expect(checkboxes.nth(i)).not.toBeChecked();
      }
    });

    test('select all checkbox becomes checked when all are selected', async ({ page }) => {
      // Select all manually
      const checkboxes = page.locator('.notification-checkbox');
      const count = await checkboxes.count();

      for (let i = 0; i < count; i++) {
        await checkboxes.nth(i).click();
      }

      await expect(page.locator('#select-all-checkbox')).toBeChecked();
    });

    test('select all checkbox is indeterminate when some are selected', async ({ page }) => {
      // Select just one
      await page.locator('[data-id="notif-1"] .notification-checkbox').click();

      const selectAll = page.locator('#select-all-checkbox');
      const isIndeterminate = await selectAll.evaluate(
        (el: HTMLInputElement) => el.indeterminate
      );
      expect(isIndeterminate).toBe(true);
    });

    test('select all has aria-label', async ({ page }) => {
      const selectAll = page.locator('#select-all-checkbox');
      await expect(selectAll).toHaveAttribute('aria-label', 'Select all notifications');
    });
  });

  test.describe('Selection Count', () => {
    test('selection count is hidden when none selected', async ({ page }) => {
      const count = page.locator('#selection-count');
      await expect(count).toHaveText('');
    });

    test('selection count shows number of selected items', async ({ page }) => {
      await page.locator('[data-id="notif-1"] .notification-checkbox').click();

      const count = page.locator('#selection-count');
      await expect(count).toHaveText('1 selected');
    });

    test('selection count updates when more items selected', async ({ page }) => {
      await page.locator('[data-id="notif-1"] .notification-checkbox').click();
      await page.locator('[data-id="notif-2"] .notification-checkbox').click();
      await page.locator('[data-id="notif-3"] .notification-checkbox').click();

      const count = page.locator('#selection-count');
      await expect(count).toHaveText('3 selected');
    });

    test('selection count has highlight style when items selected', async ({ page }) => {
      await page.locator('[data-id="notif-1"] .notification-checkbox').click();

      const count = page.locator('#selection-count');
      await expect(count).toHaveClass(/has-selection/);
    });

    test('selection count updates after select all', async ({ page }) => {
      await page.locator('#select-all-checkbox').click();

      const count = page.locator('#selection-count');
      await expect(count).toHaveText('5 selected');
    });
  });

  test.describe('Shift-Click Range Selection', () => {
    test('shift-click selects range of notifications', async ({ page }) => {
      // Click first item
      await page.locator('[data-id="notif-1"] .notification-checkbox').click();

      // Shift-click third item
      await page.locator('[data-id="notif-3"] .notification-checkbox').click({
        modifiers: ['Shift'],
      });

      // Items 1, 2, 3 should be selected
      await expect(page.locator('[data-id="notif-1"]')).toHaveClass(/selected/);
      await expect(page.locator('[data-id="notif-2"]')).toHaveClass(/selected/);
      await expect(page.locator('[data-id="notif-3"]')).toHaveClass(/selected/);

      // Items 4, 5 should not be selected
      await expect(page.locator('[data-id="notif-4"]')).not.toHaveClass(/selected/);
      await expect(page.locator('[data-id="notif-5"]')).not.toHaveClass(/selected/);
    });

    test('shift-click works in reverse order', async ({ page }) => {
      // Click fourth item
      await page.locator('[data-id="notif-4"] .notification-checkbox').click();

      // Shift-click second item
      await page.locator('[data-id="notif-2"] .notification-checkbox').click({
        modifiers: ['Shift'],
      });

      // Items 2, 3, 4 should be selected
      await expect(page.locator('[data-id="notif-2"]')).toHaveClass(/selected/);
      await expect(page.locator('[data-id="notif-3"]')).toHaveClass(/selected/);
      await expect(page.locator('[data-id="notif-4"]')).toHaveClass(/selected/);

      // Items 1, 5 should not be selected
      await expect(page.locator('[data-id="notif-1"]')).not.toHaveClass(/selected/);
      await expect(page.locator('[data-id="notif-5"]')).not.toHaveClass(/selected/);
    });

    test('shift-click without previous selection works as regular click', async ({ page }) => {
      // Shift-click without any previous selection
      await page.locator('[data-id="notif-3"] .notification-checkbox').click({
        modifiers: ['Shift'],
      });

      // Only item 3 should be selected
      await expect(page.locator('[data-id="notif-3"]')).toHaveClass(/selected/);
      await expect(page.locator('[data-id="notif-1"]')).not.toHaveClass(/selected/);
      await expect(page.locator('[data-id="notif-2"]')).not.toHaveClass(/selected/);
    });

    test('selection count updates correctly after shift-click', async ({ page }) => {
      await page.locator('[data-id="notif-1"] .notification-checkbox').click();
      await page.locator('[data-id="notif-4"] .notification-checkbox').click({
        modifiers: ['Shift'],
      });

      const count = page.locator('#selection-count');
      await expect(count).toHaveText('4 selected');
    });
  });

  test.describe('Selection with Filters', () => {
    test('select all only selects filtered notifications', async ({ page }) => {
      // Switch to Open filter
      await page.locator('#filter-open').click();
      await expect(page.locator('.notification-item')).toHaveCount(2);

      // Select all (in Open filter)
      await page.locator('#select-all-checkbox').click();

      // Count should be 2
      await expect(page.locator('#selection-count')).toHaveText('2 selected');

      // Switch to All filter
      await page.locator('#filter-all').click();

      // Only 2 should be selected (the open ones)
      const selectedItems = page.locator('.notification-item.selected');
      await expect(selectedItems).toHaveCount(2);
    });

    test('selection persists when switching filters', async ({ page }) => {
      // Select an item
      await page.locator('[data-id="notif-1"] .notification-checkbox').click();

      // Switch to Closed filter
      await page.locator('#filter-closed').click();

      // Switch back to All
      await page.locator('#filter-all').click();

      // Item should still be selected
      await expect(page.locator('[data-id="notif-1"]')).toHaveClass(/selected/);
    });

    test('select all checkbox reflects filtered selection state', async ({ page }) => {
      // Select all open notifications
      await page.locator('#filter-open').click();
      await page.locator('#select-all-checkbox').click();

      // Select all should be checked
      await expect(page.locator('#select-all-checkbox')).toBeChecked();

      // Switch to All filter - select all should be indeterminate
      await page.locator('#filter-all').click();
      const isIndeterminate = await page
        .locator('#select-all-checkbox')
        .evaluate((el: HTMLInputElement) => el.indeterminate);
      expect(isIndeterminate).toBe(true);
    });
  });

  test.describe('Selection Visual Styling', () => {
    test('selected items have blue background', async ({ page }) => {
      await page.locator('[data-id="notif-1"] .notification-checkbox').click();
      // Move mouse away to avoid hover state
      await page.mouse.move(0, 0);

      const item = page.locator('[data-id="notif-1"]');
      await expect(item).toHaveCSS('background-color', 'rgb(221, 244, 255)');
    });

    test('unselected items do not have selected background', async ({ page }) => {
      const item = page.locator('[data-id="notif-1"]');
      await expect(item).not.toHaveClass(/selected/);
    });
  });
});

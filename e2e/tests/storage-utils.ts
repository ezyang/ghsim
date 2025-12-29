import type { Page } from '@playwright/test';
import {
  clearCacheStores,
  getCommentCache,
  getNotificationsCache,
  setCommentCache,
  setNotificationsCache,
} from './idb-utils';

export async function clearAppStorage(page: Page) {
  await clearCacheStores(page);
  await page.evaluate(() => localStorage.clear());
}

export async function seedNotificationsCache(page: Page, notifications: unknown) {
  await setNotificationsCache(page, notifications);
}

export async function readNotificationsCache(page: Page) {
  return getNotificationsCache(page);
}

export async function seedCommentCache(page: Page, cache: unknown) {
  await setCommentCache(page, cache);
}

export async function readCommentCache(page: Page) {
  return getCommentCache(page);
}

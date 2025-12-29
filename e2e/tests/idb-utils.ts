import type { Page } from '@playwright/test';

const CACHE_DB_NAME = 'ghnotif_cache';
const CACHE_DB_VERSION = 1;
const NOTIFICATIONS_STORE = 'notifications';
const COMMENT_CACHE_STORE = 'commentCache';
const CACHE_KEY = 'cache';

async function openCacheDb(page: Page) {
  await page.evaluate(
    ({ name, version, notificationsStore, commentStore }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(notificationsStore)) {
            db.createObjectStore(notificationsStore);
          }
          if (!db.objectStoreNames.contains(commentStore)) {
            db.createObjectStore(commentStore);
          }
        };
        request.onsuccess = () => {
          request.result.close();
          resolve();
        };
        request.onerror = () => reject(request.error);
      }),
    {
      name: CACHE_DB_NAME,
      version: CACHE_DB_VERSION,
      notificationsStore: NOTIFICATIONS_STORE,
      commentStore: COMMENT_CACHE_STORE,
    }
  );
}

export async function clearCacheDb(page: Page) {
  await page.evaluate(
    (name) =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase(name);
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      }),
    CACHE_DB_NAME
  );
}

export async function clearCacheStores(page: Page) {
  await openCacheDb(page);
  await page.evaluate(
    ({ name, version, notificationsStore, commentStore }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction([notificationsStore, commentStore], 'readwrite');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
          tx.objectStore(notificationsStore).clear();
          tx.objectStore(commentStore).clear();
        };
        request.onerror = () => reject(request.error);
      }),
    {
      name: CACHE_DB_NAME,
      version: CACHE_DB_VERSION,
      notificationsStore: NOTIFICATIONS_STORE,
      commentStore: COMMENT_CACHE_STORE,
    }
  );
}

export async function setNotificationsCache(page: Page, notifications: unknown) {
  await openCacheDb(page);
  await page.evaluate(
    ({ name, version, store, key, payload }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(store, 'readwrite');
          const putRequest = tx.objectStore(store).put(payload, key);
          putRequest.onsuccess = () => {
            db.close();
            resolve();
          };
          putRequest.onerror = () => {
            db.close();
            reject(putRequest.error);
          };
        };
        request.onerror = () => reject(request.error);
      }),
    {
      name: CACHE_DB_NAME,
      version: CACHE_DB_VERSION,
      store: NOTIFICATIONS_STORE,
      key: CACHE_KEY,
      payload: notifications,
    }
  );
}

export async function getNotificationsCache(page: Page) {
  await openCacheDb(page);
  return page.evaluate(
    ({ name, version, store, key }) =>
      new Promise<unknown>((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(store, 'readonly');
          const getRequest = tx.objectStore(store).get(key);
          getRequest.onsuccess = () => {
            db.close();
            resolve(getRequest.result ?? null);
          };
          getRequest.onerror = () => {
            db.close();
            reject(getRequest.error);
          };
        };
        request.onerror = () => reject(request.error);
      }),
    {
      name: CACHE_DB_NAME,
      version: CACHE_DB_VERSION,
      store: NOTIFICATIONS_STORE,
      key: CACHE_KEY,
    }
  );
}

export async function setCommentCache(page: Page, cache: unknown) {
  await openCacheDb(page);
  await page.evaluate(
    ({ name, version, store, key, payload }) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(store, 'readwrite');
          const putRequest = tx.objectStore(store).put(payload, key);
          putRequest.onsuccess = () => {
            db.close();
            resolve();
          };
          putRequest.onerror = () => {
            db.close();
            reject(putRequest.error);
          };
        };
        request.onerror = () => reject(request.error);
      }),
    {
      name: CACHE_DB_NAME,
      version: CACHE_DB_VERSION,
      store: COMMENT_CACHE_STORE,
      key: CACHE_KEY,
      payload: cache,
    }
  );
}

export async function getCommentCache(page: Page) {
  await openCacheDb(page);
  return page.evaluate(
    ({ name, version, store, key }) =>
      new Promise<unknown>((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(store, 'readonly');
          const getRequest = tx.objectStore(store).get(key);
          getRequest.onsuccess = () => {
            db.close();
            resolve(getRequest.result ?? null);
          };
          getRequest.onerror = () => {
            db.close();
            reject(getRequest.error);
          };
        };
        request.onerror = () => reject(request.error);
      }),
    {
      name: CACHE_DB_NAME,
      version: CACHE_DB_VERSION,
      store: COMMENT_CACHE_STORE,
      key: CACHE_KEY,
    }
  );
}

        function formatRateLimit(rateLimit, error) {
            if (error) {
                return `Rate limit error: ${error}`;
            }
            if (!rateLimit?.resources?.core) {
                return 'Rate limit: unknown';
            }
            const core = rateLimit.resources.core;
            const resetAt = core.reset
                ? new Date(core.reset * 1000).toLocaleTimeString()
                : 'unknown';
            return `Rate limit: ${core.remaining}/${core.limit} reset @ ${resetAt}`;
        }

        function updateRateLimitBox() {
            elements.rateLimitBox.textContent = formatRateLimit(
                state.rateLimit,
                state.rateLimitError
            );
        }

        async function refreshRateLimit() {
            try {
                const response = await fetch('/github/rest/rate_limit');
                if (!response.ok) {
                    throw new Error(`Request failed (${response.status})`);
                }
                const data = await response.json();
                state.rateLimit = data;
                state.rateLimitError = null;
            } catch (error) {
                state.rateLimitError = error.message || String(error);
            }
            updateRateLimitBox();
        }

        function getNotificationKey(notification) {
            return String(notification.id);
        }

        function getIssueNumber(notification) {
            const number = notification?.subject?.number;
            return typeof number === 'number' ? number : null;
        }

        function getNotificationMatchKey(notification) {
            const repo = parseRepoInput(state.repo || '');
            const number = notification?.subject?.number;
            const type = notification?.subject?.type || 'unknown';
            if (repo && typeof number === 'number') {
                return `${repo.owner}/${repo.repo}:${type}:${number}`;
            }
            return `id:${getNotificationKey(notification)}`;
        }

        function getNotificationDedupKey(notification) {
            return getNotificationMatchKey(notification) || getNotificationKey(notification);
        }

        function getUpdatedAtSignature(updatedAt) {
            const parsed = Date.parse(updatedAt);
            if (Number.isNaN(parsed)) {
                return String(updatedAt || '');
            }
            return `ms:${parsed}`;
        }

        function formatCursorLabel(cursor) {
            if (!cursor) {
                return 'initial';
            }
            const raw = String(cursor);
            if (raw.length <= 10) {
                return `after ${raw}`;
            }
            return `after ${raw.slice(0, 4)}...${raw.slice(-4)}`;
        }

        function countMissingLastReadAt(notifications) {
            return notifications.filter((notif) => !notif.last_read_at).length;
        }

        function buildPreviousMatchMap(notifications) {
            const map = new Map();
            notifications.forEach((notif, index) => {
                const key = getNotificationMatchKey(notif);
                if (!key || map.has(key)) {
                    return;
                }
                map.set(key, { updatedAt: getUpdatedAtSignature(notif.updated_at), index });
            });
            return map;
        }

        function findIncrementalOverlapIndex(notifications, previousMatchMap) {
            for (const notif of notifications) {
                const key = getNotificationMatchKey(notif);
                if (!key) {
                    continue;
                }
                const previous = previousMatchMap.get(key);
                if (previous && previous.updatedAt === getUpdatedAtSignature(notif.updated_at)) {
                    return previous.index;
                }
            }
            return null;
        }

        function mergeIncrementalNotifications(newNotifications, previousNotifications, startIndex) {
            const merged = newNotifications.slice();
            const seenKeys = new Set();
            merged.forEach((notif) => {
                const key = getNotificationDedupKey(notif);
                if (key) {
                    seenKeys.add(key);
                }
            });
            for (let i = startIndex; i < previousNotifications.length; i += 1) {
                const notif = previousNotifications[i];
                const key = getNotificationDedupKey(notif);
                if (key && seenKeys.has(key)) {
                    continue;
                }
                merged.push(notif);
                if (key) {
                    seenKeys.add(key);
                }
            }
            return merged;
        }

        function getRestNotificationMatchKey(notification) {
            const repo = notification?.repository?.full_name;
            const type = notification?.subject?.type || 'unknown';
            const url = notification?.subject?.url || '';
            const match = url.match(/\/(issues|pulls)\/(\d+)/);
            if (!repo || !match) {
                return null;
            }
            return `${repo}:${type}:${match[2]}`;
        }

        async function fetchJson(url) {
            const response = await fetch(url);
            if (!response.ok) {
                let detail = '';
                try {
                    detail = await response.text();
                } catch (error) {
                    detail = String(error);
                }
                throw new Error(`Request failed: ${url} (${response.status}) ${detail}`);
            }
            return response.json();
        }

        async function fetchRestNotificationsMap(targetKeys) {
            const result = new Map();
            const maxPages = 5;
            for (let page = 1; page <= maxPages; page += 1) {
                const remainingCount = targetKeys.size - result.size;
                const params = new URLSearchParams();
                params.set('all', 'true');
                params.set('per_page', '50');
                params.set('page', String(page));
                const url = `/github/rest/notifications?${params}`;
                let payload = [];
                try {
                    showStatus(
                        `Last read lookup: requesting REST page ${page} (${remainingCount} remaining)`,
                        'info',
                        { flash: true }
                    );
                    payload = await fetchJson(url);
                } catch (error) {
                    showStatus(`Rate limit fetch failed: ${error.message || error}`, 'error');
                    break;
                }
                if (!Array.isArray(payload) || payload.length === 0) {
                    break;
                }
                payload.forEach((notif) => {
                    const key = getRestNotificationMatchKey(notif);
                    if (key && targetKeys.has(key)) {
                        result.set(key, notif);
                    }
                });
                showStatus(
                    `Last read lookup: received ${payload.length} notifications (matched ${result.size}/${targetKeys.size})`,
                    'info'
                );
                const remaining = [...targetKeys].filter((id) => !result.has(id));
                if (remaining.length === 0) {
                    break;
                }
            }
            return result;
        }

        async function ensureLastReadAtData(notifications) {
            const missing = notifications.filter((notif) => !notif.last_read_at);
            if (!missing.length) {
                return notifications;
            }
            showStatus(
                `Last read lookup: ${missing.length} notifications missing last_read_at`,
                'info',
                { flash: true }
            );
            const cachedLastReadAt = new Map();
            missing.forEach((notif) => {
                const cached = state.commentCache.threads[getNotificationKey(notif)];
                if (cached?.lastReadAt && isCommentCacheFresh(cached)) {
                    cachedLastReadAt.set(getNotificationKey(notif), cached.lastReadAt);
                }
            });
            const missingKeys = new Set();
            missing.forEach((notif) => {
                if (cachedLastReadAt.has(getNotificationKey(notif))) {
                    return;
                }
                const key = getNotificationMatchKey(notif);
                if (key) {
                    missingKeys.add(key);
                }
            });
            const restMap =
                missingKeys.size > 0
                    ? await fetchRestNotificationsMap(missingKeys)
                    : new Map();
            const mergedNotifications = notifications.map((notif) => {
                const lastReadAtMissing = !notif.last_read_at;
                const cached = cachedLastReadAt.get(getNotificationKey(notif));
                if (cached && lastReadAtMissing) {
                    return { ...notif, last_read_at: cached, last_read_at_missing: true };
                }
                const rest = restMap.get(getNotificationMatchKey(notif));
                if (rest && rest.last_read_at && lastReadAtMissing) {
                    return {
                        ...notif,
                        last_read_at: rest.last_read_at,
                        last_read_at_missing: true,
                    };
                }
                if (lastReadAtMissing) {
                    return { ...notif, last_read_at_missing: true };
                }
                return notif;
            });
            await refreshRateLimit();
            return mergedNotifications;
        }
        // Check authentication status
        async function checkAuth() {
            try {
                const response = await fetch('/github/rest/user');
                const data = await response.json();

                if (response.ok && data.login) {
                    elements.authStatus.textContent = `Signed in as ${data.login}`;
                    elements.authStatus.className = 'auth-status authenticated';
                    state.currentUserLogin = data.login;
                } else {
                    elements.authStatus.textContent = 'Not authenticated';
                    elements.authStatus.className = 'auth-status error';
                    state.currentUserLogin = null;
                }
            } catch (e) {
                elements.authStatus.textContent = 'Auth check failed';
                elements.authStatus.className = 'auth-status error';
                state.currentUserLogin = null;
            }
        }

        // Handle sync button click
        async function handleSync({ mode = 'incremental' } = {}) {
            const repo = elements.repoInput.value.trim();
            if (!repo) {
                showStatus('Please enter a repository (owner/repo)', 'error');
                return;
            }
            if (state.loading) {
                return;
            }

            // Parse owner/repo
            const parts = repo.split('/');
            if (parts.length !== 2) {
                showStatus('Invalid format. Use owner/repo', 'error');
                return;
            }

            const [owner, repoName] = parts;
            const previousNotifications = state.notifications.slice();
            const previousSelected = new Set(state.selected);
            const syncMode = mode === 'full' ? 'full' : 'incremental';
            const syncLabel = syncMode === 'full' ? 'Full Sync' : 'Quick Sync';
            const previousMatchMap =
                syncMode === 'incremental' &&
                previousNotifications.length > 0 &&
                state.lastSyncedRepo === repo
                    ? buildPreviousMatchMap(previousNotifications)
                    : null;
            state.loading = true;
            state.error = null;
            state.notifications = [];
            state.selected.clear();
            state.authenticity_token = null;
            persistAuthenticityToken(null);
            clearUndoState();
            render();

            showStatus(`${syncLabel} starting for ${repo}...`, 'info', { flash: true });
            showStatus(`${syncLabel} in progress...`, 'info');

            try {
                const allNotifications = [];
                let afterCursor = null;
                let pageCount = 0;
                let overlapIndex = null;

                // Fetch all pages
                do {
                    pageCount++;
                    showStatus(
                        `${syncLabel}: requesting page ${pageCount} (${formatCursorLabel(afterCursor)})`,
                        'info',
                        { flash: true }
                    );

                    let url = `/notifications/html/repo/${encodeURIComponent(owner)}/${encodeURIComponent(repoName)}`;
                    if (afterCursor) {
                        url += `?after=${encodeURIComponent(afterCursor)}`;
                    }

                    const response = await fetch(url);

                    if (!response.ok) {
                        const errorData = await response.json().catch(() => ({}));
                        throw new Error(errorData.detail || `HTTP ${response.status}`);
                    }

                    const data = await response.json();
                    allNotifications.push(...data.notifications);
                    // Store authenticity_token from first page (valid for the session)
                    if (data.authenticity_token && !state.authenticity_token) {
                        state.authenticity_token = data.authenticity_token;
                        persistAuthenticityToken(data.authenticity_token);
                    }
                    afterCursor = data.pagination.has_next ? data.pagination.after_cursor : null;
                    if (previousMatchMap && overlapIndex === null) {
                        overlapIndex = findIncrementalOverlapIndex(
                            data.notifications,
                            previousMatchMap
                        );
                        if (overlapIndex !== null) {
                            showStatus(
                                `${syncLabel}: overlap found at index ${overlapIndex} (stopping early)`,
                                'info',
                                { flash: true }
                            );
                            afterCursor = null;
                        }
                    }
                    state.notifications = allNotifications.slice();
                    showStatus(
                        `${syncLabel}: received page ${pageCount} (${data.notifications.length} notifications, total ${allNotifications.length})`,
                        'info'
                    );
                    render();

                } while (afterCursor);

                let mergedNotifications = allNotifications;
                if (previousMatchMap && overlapIndex !== null) {
                    showStatus(
                        `${syncLabel}: merging fetched results with cached list`,
                        'info',
                        { flash: true }
                    );
                    mergedNotifications = mergeIncrementalNotifications(
                        allNotifications,
                        previousNotifications,
                        overlapIndex + 1
                    );
                    const carriedCount = mergedNotifications.length - allNotifications.length;
                    showStatus(
                        `${syncLabel}: merged ${allNotifications.length} fetched + ${carriedCount} cached`,
                        'info'
                    );
                } else if (previousMatchMap) {
                    showStatus(
                        `${syncLabel}: no overlap found, using fetched pages only`,
                        'info'
                    );
                }

                // Sort by updated_at descending
                showStatus(
                    `${syncLabel}: sorting ${mergedNotifications.length} notifications`,
                    'info',
                    { flash: true }
                );
                const sortedNotifications = mergedNotifications.sort((a, b) =>
                    new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
                );

                let notifications = sortedNotifications;
                if (state.commentPrefetchEnabled) {
                    const missingCount = countMissingLastReadAt(sortedNotifications);
                    if (missingCount > 0) {
                        showStatus(
                            `${syncLabel}: fetching last_read_at for ${missingCount} notifications`,
                            'info',
                            { flash: true }
                        );
                    } else {
                        showStatus(
                            `${syncLabel}: last_read_at already present`,
                            'info'
                        );
                    }
                    notifications = await ensureLastReadAtData(sortedNotifications);
                    const remainingMissing = countMissingLastReadAt(notifications);
                    const filledCount = Math.max(missingCount - remainingMissing, 0);
                    if (missingCount > 0) {
                        showStatus(
                            `${syncLabel}: filled last_read_at for ${filledCount}/${missingCount} notifications`,
                            'info'
                        );
                    }
                }

                state.notifications = notifications;
                state.loading = false;
                state.lastSyncedRepo = repo;
                localStorage.setItem(LAST_SYNCED_REPO_KEY, repo);

                // Save to localStorage
                persistNotifications();

                if (state.commentPrefetchEnabled) {
                    state.commentQueue = [];
                    scheduleCommentPrefetch(notifications);
                }

                showStatus(`Synced ${notifications.length} notifications`, 'success');
                render();

            } catch (e) {
                state.loading = false;
                state.error = e.message;
                state.notifications = previousNotifications;
                state.selected = previousSelected;
                showStatus(`Sync failed: ${e.message}`, 'error');
                render();
            }
        }

        // Show status message
        function showStatus(message, type) {
            elements.statusBar.textContent = message;
            elements.statusBar.className = `status-bar visible ${type}`;
        }

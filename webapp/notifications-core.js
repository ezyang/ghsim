// Comment-related constants are in notifications-comments.js
        const TYPE_FILTER_KEY = 'ghnotif_type_filter';
        const LAST_SYNCED_REPO_KEY = 'ghnotif_last_synced_repo';

        // Application state
        const state = {
            repo: null,
            notifications: [],
            loading: false,
            error: null,
            filter: 'all', // 'all', 'open', 'closed', 'needs-review', 'approved', 'uninteresting'
            typeFilter: 'all', // 'all', 'issue', 'pull'
            selected: new Set(), // Set of selected notification IDs
            activeNotificationId: null, // Keyboard selection cursor
            lastClickedId: null, // For shift-click range selection
            markingInProgress: false, // Whether Mark Done is in progress
            markProgress: { current: 0, total: 0 }, // Progress tracking
            commentPrefetchEnabled: false,
            commentExpandEnabled: false,
            commentHideUninteresting: false,
            commentQueue: [],
            commentQueueRunning: false,
            commentCache: loadCommentCache(),
            rateLimit: null,
            rateLimitError: null,
            currentUserLogin: null,
            commentBodyExpanded: new Set(),
            lastSyncedRepo: null,
            // Keyboard navigation
            lastGKeyTime: 0, // For vim-style 'gg' sequence
            // Undo support
            authenticity_token: null, // CSRF token for HTML form actions
            undoStack: [], // Stack of {action, notifications, timestamp}
            undoInProgress: false,
        };

        // DOM elements
        const elements = {
            repoInput: document.getElementById('repo-input'),
            syncBtn: document.getElementById('sync-btn'),
            fullSyncBtn: document.getElementById('full-sync-btn'),
            authStatus: document.getElementById('auth-status'),
            statusBar: document.getElementById('status-bar'),
            commentPrefetchToggle: document.getElementById('comment-prefetch-toggle'),
            commentExpandToggle: document.getElementById('comment-expand-toggle'),
            commentHideUninterestingToggle: document.getElementById('comment-hide-uninteresting-toggle'),
            commentCacheStatus: document.getElementById('comment-cache-status'),
            clearCommentCacheBtn: document.getElementById('clear-comment-cache-btn'),
            rateLimitBox: document.getElementById('rate-limit-box'),
            loading: document.getElementById('loading'),
            emptyState: document.getElementById('empty-state'),
            notificationsList: document.getElementById('notifications-list'),
            notificationCount: document.getElementById('notification-count'),
            filterTabs: document.querySelectorAll('.filter-tab'),
            typeFilterButtons: document.querySelectorAll('.type-filter-btn'),
            countAll: document.getElementById('count-all'),
            countOpen: document.getElementById('count-open'),
            countClosed: document.getElementById('count-closed'),
            countNeedsReview: document.getElementById('count-needs-review'),
            countApproved: document.getElementById('count-approved'),
            countUninteresting: document.getElementById('count-uninteresting'),
            selectAllRow: document.getElementById('select-all-row'),
            selectAllCheckbox: document.getElementById('select-all-checkbox'),
            selectionCount: document.getElementById('selection-count'),
            markDoneBtn: document.getElementById('mark-done-btn'),
            unsubscribeAllBtn: document.getElementById('unsubscribe-all-btn'),
            progressContainer: document.getElementById('progress-container'),
            progressBarFill: document.getElementById('progress-bar-fill'),
            progressText: document.getElementById('progress-text'),
            keyboardShortcutsOverlay: document.getElementById('keyboard-shortcuts-overlay'),
            keyboardShortcutsClose: document.getElementById('keyboard-shortcuts-close'),
        };

        function persistNotifications() {
            localStorage.setItem(
                'ghnotif_notifications',
                JSON.stringify(state.notifications)
            );
        }

        // loadCommentCache, saveCommentCache, isCommentCacheFresh are in notifications-comments.js

        // Initialize app
        function init() {
            // Load saved repo from localStorage
            const savedRepo = localStorage.getItem('ghnotif_repo');
            if (savedRepo) {
                elements.repoInput.value = savedRepo;
                state.repo = savedRepo;
            }

            // Load saved notifications from localStorage
            const savedNotifications = localStorage.getItem('ghnotif_notifications');
            if (savedNotifications) {
                try {
                    state.notifications = JSON.parse(savedNotifications);
                } catch (e) {
                    console.error('Failed to parse saved notifications:', e);
                }
            }
            state.lastSyncedRepo = localStorage.getItem(LAST_SYNCED_REPO_KEY);

            // Load saved filter from localStorage
            const savedFilter = localStorage.getItem('ghnotif_filter');
            if (
                savedFilter &&
                ['all', 'open', 'closed', 'needs-review', 'approved', 'uninteresting'].includes(
                    savedFilter
                )
            ) {
                state.filter = savedFilter;
            }

            const savedTypeFilter = localStorage.getItem(TYPE_FILTER_KEY);
            if (savedTypeFilter && ['all', 'issue', 'pull'].includes(savedTypeFilter)) {
                state.typeFilter = savedTypeFilter;
            }

            const savedCommentPrefetch = localStorage.getItem(COMMENT_PREFETCH_KEY);
            if (savedCommentPrefetch === 'true') {
                state.commentPrefetchEnabled = true;
            }
            elements.commentPrefetchToggle.checked = state.commentPrefetchEnabled;

            const savedCommentExpand = localStorage.getItem(COMMENT_EXPAND_KEY);
            if (savedCommentExpand === 'true') {
                state.commentExpandEnabled = true;
            }
            elements.commentExpandToggle.checked = state.commentExpandEnabled;

            const savedCommentHideUninteresting = localStorage.getItem(COMMENT_HIDE_UNINTERESTING_KEY);
            if (savedCommentHideUninteresting === 'true') {
                state.commentHideUninteresting = true;
            }
            elements.commentHideUninterestingToggle.checked = state.commentHideUninteresting;

            // Set up event listeners
            elements.syncBtn.addEventListener('click', () => handleSync({ mode: 'incremental' }));
            elements.fullSyncBtn.addEventListener('click', () => handleSync({ mode: 'full' }));
            elements.repoInput.addEventListener('input', handleRepoInput);
            elements.repoInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    handleSync({ mode: 'incremental' });
                }
            });

            // Filter tab click handlers
            elements.filterTabs.forEach(tab => {
                tab.addEventListener('click', () => {
                    const filter = tab.dataset.filter;
                    setFilter(filter);
                });
            });

            elements.typeFilterButtons.forEach(button => {
                button.addEventListener('click', () => {
                    const filter = button.dataset.type;
                    setTypeFilter(filter);
                });
            });

            elements.commentPrefetchToggle.addEventListener('change', (event) => {
                setCommentPrefetchEnabled(event.target.checked);
            });
            elements.commentExpandToggle.addEventListener('change', (event) => {
                setCommentExpandEnabled(event.target.checked);
            });
            elements.commentHideUninterestingToggle.addEventListener('change', (event) => {
                setCommentHideUninteresting(event.target.checked);
            });
            elements.clearCommentCacheBtn.addEventListener('click', handleClearCommentCache);

            // Select all checkbox handler
            elements.selectAllCheckbox.addEventListener('change', handleSelectAll);

            // Mark Done button handler
            elements.markDoneBtn.addEventListener('click', handleMarkDone);

            // Unsubscribe All button handler
            elements.unsubscribeAllBtn.addEventListener('click', handleUnsubscribeAll);

            // Keyboard shortcuts
            document.addEventListener('keydown', handleKeyDown);

            // Keyboard shortcuts overlay handlers
            elements.keyboardShortcutsClose.addEventListener('click', hideKeyboardShortcutsOverlay);
            elements.keyboardShortcutsOverlay.addEventListener('click', (e) => {
                // Close when clicking the backdrop (not the modal itself)
                if (e.target === elements.keyboardShortcutsOverlay) {
                    hideKeyboardShortcutsOverlay();
                }
            });

            // Check auth status
            checkAuth();
            refreshRateLimit();

            // Initial render
            render();
        }

        // Handle repo input changes
        function handleRepoInput() {
            const value = elements.repoInput.value.trim();
            state.repo = value || null;
            localStorage.setItem('ghnotif_repo', value);
        }

        function setCommentPrefetchEnabled(enabled) {
            state.commentPrefetchEnabled = enabled;
            localStorage.setItem(COMMENT_PREFETCH_KEY, String(enabled));
            if (!enabled) {
                render();
                return;
            }
            showStatus('Fetching comments for triage filters...', 'info', { flash: true });
            ensureLastReadAtData(state.notifications)
                .then((notifications) => {
                    state.notifications = notifications;
                    persistNotifications();
                    state.commentQueue = [];
                    scheduleCommentPrefetch(notifications);
                    render();
                })
                .catch((e) => {
                    showStatus(`Comment prefetch setup failed: ${e.message}`, 'error');
                    render();
                });
        }

        function setCommentExpandEnabled(enabled) {
            state.commentExpandEnabled = enabled;
            localStorage.setItem(COMMENT_EXPAND_KEY, String(enabled));
            render();
        }

        function setCommentHideUninteresting(enabled) {
            state.commentHideUninteresting = enabled;
            localStorage.setItem(COMMENT_HIDE_UNINTERESTING_KEY, String(enabled));
            render();
        }

        // Set the current filter
        function setFilter(filter) {
            if (
                !['all', 'open', 'closed', 'needs-review', 'approved', 'uninteresting'].includes(
                    filter
                )
            ) {
                return;
            }
            state.filter = filter;
            localStorage.setItem('ghnotif_filter', filter);
            if (
                ['uninteresting', 'needs-review', 'approved'].includes(filter) &&
                !state.commentPrefetchEnabled
            ) {
                showStatus('Enable comment fetching to evaluate triage filters.', 'info');
            }
            render();
        }

        function setTypeFilter(filter) {
            if (!['all', 'issue', 'pull'].includes(filter)) return;
            state.typeFilter = filter;
            localStorage.setItem(TYPE_FILTER_KEY, filter);
            render();
        }

        function matchesTypeFilter(notification) {
            if (state.typeFilter === 'issue') {
                return notification.subject.type === 'Issue';
            }
            if (state.typeFilter === 'pull') {
                return notification.subject.type === 'PullRequest';
            }
            return true;
        }

        function safeIsNotificationNeedsReview(notification) {
            return typeof isNotificationNeedsReview === 'function'
                ? isNotificationNeedsReview(notification)
                : false;
        }

        function safeIsNotificationApproved(notification) {
            return typeof isNotificationApproved === 'function'
                ? isNotificationApproved(notification)
                : false;
        }

        // Get filtered notifications based on current filter
        function getFilteredNotifications() {
            let filtered = state.notifications;
            if (state.filter !== 'all') {
                filtered = filtered.filter(notif => {
                    const notifState = notif.subject.state;
                    if (state.filter === 'open') {
                        return notifState === 'open' || notifState === 'draft';
                    }
                    if (state.filter === 'closed') {
                        return notifState === 'closed' || notifState === 'merged';
                    }
                    if (state.filter === 'needs-review') {
                        return safeIsNotificationNeedsReview(notif);
                    }
                    if (state.filter === 'approved') {
                        return safeIsNotificationApproved(notif);
                    }
                    if (state.filter === 'uninteresting') {
                        return isNotificationUninteresting(notif);
                    }
                    return true;
                });
            }
            return filtered.filter(matchesTypeFilter);
        }

        // Count notifications by filter category
        function getFilterCounts() {
            let open = 0;
            let closed = 0;
            let needsReview = 0;
            let approved = 0;
            let uninteresting = 0;
            const typedNotifications = state.notifications.filter(matchesTypeFilter);
            typedNotifications.forEach(notif => {
                const notifState = notif.subject.state;
                if (notifState === 'open' || notifState === 'draft') {
                    open++;
                } else if (notifState === 'closed' || notifState === 'merged') {
                    closed++;
                }
                if (safeIsNotificationNeedsReview(notif)) {
                    needsReview++;
                }
                if (safeIsNotificationApproved(notif)) {
                    approved++;
                }
                if (isNotificationUninteresting(notif)) {
                    uninteresting++;
                }
            });
            return {
                all: typedNotifications.length,
                open,
                closed,
                needsReview,
                approved,
                uninteresting,
            };
        }

        function updateCommentCacheStatus() {
            const cachedCount = Object.keys(state.commentCache.threads || {}).length;
            elements.clearCommentCacheBtn.disabled = cachedCount === 0;
            if (!state.commentPrefetchEnabled) {
                elements.commentCacheStatus.textContent = 'Comments: off';
                return;
            }
            elements.commentCacheStatus.textContent = `Comments cached: ${cachedCount}`;
        }

        function handleClearCommentCache() {
            state.commentCache = { version: 1, threads: {} };
            state.commentQueue = [];
            localStorage.removeItem(COMMENT_CACHE_KEY);
            if (state.commentPrefetchEnabled && state.notifications.length > 0) {
                scheduleCommentPrefetch(state.notifications);
                showStatus('Comment cache cleared. Refetching comments...', 'info');
            } else {
                showStatus('Comment cache cleared.', 'success');
            }
            render();
        }

        // Comment prefetching, classification, and display functions are in notifications-comments.js:
        // scheduleCommentPrefetch, runCommentQueue, toIssueComment, fetchAllIssueComments,
        // fetchPullRequestReviews, prefetchNotificationComments, getCommentStatus, getCommentItems,
        // filterCommentsAfterOwnComment, isNotificationUninteresting, isNotificationNeedsReview,
        // isNotificationApproved, hasApprovedReview, isUninterestingComment, isRevertRelated,
        // isBotAuthor, isBotInteractionComment

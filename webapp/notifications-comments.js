// notifications-comments.js
// Comment prefetching, caching, classification, and display logic
// This module expects the following globals from notifications.js:
//   state, getNotificationKey, getIssueNumber, parseRepoInput,
//   showStatus, refreshRateLimit, render, escapeHtml, renderMarkdown, fetchJson

const COMMENT_CACHE_KEY = 'ghnotif_bulk_comment_cache_v1';
const COMMENT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const COMMENT_CONCURRENCY = 4;
const COMMENT_PREFETCH_KEY = 'ghnotif_comment_prefetch_enabled';
const COMMENT_EXPAND_KEY = 'ghnotif_comment_expand_enabled';
const COMMENT_HIDE_UNINTERESTING_KEY = 'ghnotif_comment_hide_uninteresting';

function loadCommentCache() {
    const raw = localStorage.getItem(COMMENT_CACHE_KEY);
    if (!raw) {
        return { version: 1, threads: {} };
    }
    try {
        return JSON.parse(raw);
    } catch (e) {
        console.error('Failed to parse comment cache:', e);
        return { version: 1, threads: {} };
    }
}

function saveCommentCache() {
    localStorage.setItem(COMMENT_CACHE_KEY, JSON.stringify(state.commentCache));
}

function isCommentCacheFresh(cached) {
    if (!cached?.fetchedAt) {
        return false;
    }
    const fetchedAtMs = Date.parse(cached.fetchedAt);
    if (Number.isNaN(fetchedAtMs)) {
        return false;
    }
    return Date.now() - fetchedAtMs < COMMENT_CACHE_TTL_MS;
}

function scheduleCommentPrefetch(notifications) {
    if (!state.commentPrefetchEnabled) {
        return;
    }
    showStatus(
        `Comment prefetch: queued ${notifications.length} notifications (concurrency ${COMMENT_CONCURRENCY})`,
        'info',
        { flash: true }
    );
    notifications.forEach((notif) => {
        state.commentQueue.push(() => prefetchNotificationComments(notif));
    });
    runCommentQueue();
}

async function runCommentQueue() {
    if (state.commentQueueRunning) {
        return;
    }
    state.commentQueueRunning = true;
    showStatus(
        `Comment prefetch: starting ${state.commentQueue.length} requests`,
        'info',
        { flash: true }
    );
    while (state.commentQueue.length) {
        const batch = state.commentQueue.splice(0, COMMENT_CONCURRENCY);
        showStatus(
            `Comment prefetch: fetching ${batch.length} (remaining ${state.commentQueue.length})`,
            'info',
            { flash: true }
        );
        await Promise.all(batch.map((task) => task()));
        saveCommentCache();
        render();
    }
    await refreshRateLimit();
    state.commentQueueRunning = false;
}

function toIssueComment(issue) {
    if (!issue) {
        return null;
    }
    return {
        id: issue.id || `issue-${issue.number || 'unknown'}`,
        user: issue.user,
        body: issue.body ?? '',
        created_at: issue.created_at,
        updated_at: issue.updated_at,
        isIssue: true,
    };
}

async function fetchAllIssueComments(repo, issueNumber) {
    const issueUrl = `/github/rest/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/issues/${issueNumber}`;
    let issue = null;
    try {
        issue = await fetchJson(issueUrl);
    } catch (error) {
        issue = null;
    }
    const commentUrl = `/github/rest/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/issues/${issueNumber}/comments`;
    const commentPayload = await fetchJson(commentUrl);
    const comments = [];
    const issueComment = toIssueComment(issue);
    if (issueComment) {
        comments.push(issueComment);
    }
    if (Array.isArray(commentPayload)) {
        comments.push(...commentPayload);
    }
    return comments;
}

async function fetchPullRequestReviews(repo, issueNumber) {
    const reviewUrl = `/github/rest/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/pulls/${issueNumber}/reviews`;
    const reviewPayload = await fetchJson(reviewUrl);
    return Array.isArray(reviewPayload) ? reviewPayload : [];
}

async function prefetchNotificationComments(notification) {
    const threadId = getNotificationKey(notification);
    const cached = state.commentCache.threads[threadId];
    const shouldLoadAllComments = Boolean(
        notification.last_read_at_missing || !notification.last_read_at
    );
    if (
        cached &&
        cached.notificationUpdatedAt === notification.updated_at &&
        isCommentCacheFresh(cached) &&
        ((shouldLoadAllComments && cached.allComments) ||
            (!shouldLoadAllComments &&
                cached.lastReadAt === (notification.last_read_at || null)))
    ) {
        return;
    }

    const issueNumber = getIssueNumber(notification);
    if (!issueNumber) {
        state.commentCache.threads[threadId] = {
            notificationUpdatedAt: notification.updated_at,
            comments: [],
            error: 'No issue number found.',
            fetchedAt: new Date().toISOString(),
        };
        return;
    }

    try {
        const repo = parseRepoInput(state.repo || '');
        if (!repo) {
            throw new Error('Missing repository input.');
        }
        let lastReadAt = null;
        let allComments = false;
        let comments = [];
        let reviews = [];
        let reviewsError = null;
        if (shouldLoadAllComments) {
            allComments = true;
            comments = await fetchAllIssueComments(repo, issueNumber);
        } else {
            lastReadAt = notification.last_read_at || cached?.lastReadAt || null;
            if (!lastReadAt) {
                allComments = true;
                comments = await fetchAllIssueComments(repo, issueNumber);
            } else {
                let commentUrl = `/github/rest/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/issues/${issueNumber}/comments`;
                commentUrl += `?since=${encodeURIComponent(lastReadAt)}`;
                comments = await fetchJson(commentUrl);
            }
        }
        if (notification.subject?.type === 'PullRequest') {
            try {
                reviews = await fetchPullRequestReviews(repo, issueNumber);
            } catch (error) {
                reviewsError = error.message || String(error);
            }
        }

        state.commentCache.threads[threadId] = {
            notificationUpdatedAt: notification.updated_at,
            lastReadAt,
            unread: notification.unread,
            comments,
            allComments,
            reviews,
            reviewsError,
            fetchedAt: new Date().toISOString(),
        };
    } catch (error) {
        state.commentCache.threads[threadId] = {
            notificationUpdatedAt: notification.updated_at,
            comments: [],
            allComments: shouldLoadAllComments,
            error: error.message || String(error),
            fetchedAt: new Date().toISOString(),
        };
    }
}

function getCommentStatus(notification) {
    const cached = state.commentCache.threads[getNotificationKey(notification)];
    if (!state.commentPrefetchEnabled) {
        return { label: 'Comments: off', className: 'off' };
    }
    if (!cached) {
        return { label: 'Comments: pending', className: 'pending' };
    }
    if (cached.error) {
        return { label: 'Comments: error', className: 'error' };
    }
    const count = cached.comments ? cached.comments.length : 0;
    if (isNotificationApproved(notification)) {
        return { label: 'Approved', className: 'approved' };
    }
    if (isNotificationNeedsReview(notification)) {
        return { label: 'Needs review', className: 'needs-review' };
    }
    if (count === 0) {
        return { label: 'Uninteresting (0)', className: 'uninteresting' };
    }
    if (isNotificationUninteresting(notification)) {
        return { label: `Uninteresting (${count})`, className: 'uninteresting' };
    }
    return { label: `Interesting (${count})`, className: 'interesting' };
}

function getCommentItems(notification) {
    if (!state.commentExpandEnabled) {
        return '';
    }
    if (!state.commentPrefetchEnabled) {
        return '<li class="comment-item">Enable comment fetching to show comments.</li>';
    }
    const cached = state.commentCache.threads[getNotificationKey(notification)];
    if (!cached) {
        return '<li class="comment-item">Comments: pending...</li>';
    }
    if (cached.error) {
        return `<li class="comment-item">Comments error: ${escapeHtml(cached.error)}</li>`;
    }
    const comments = filterCommentsAfterOwnComment(cached.comments || []);
    if (comments.length === 0) {
        const label = cached.allComments ? 'No comments found.' : 'No unread comments found.';
        return `<li class="comment-item">${label}</li>`;
    }
    const visibleComments = state.commentHideUninteresting
        ? comments.filter((comment) => !isUninterestingComment(comment))
        : comments;
    if (visibleComments.length === 0) {
        return '<li class="comment-item">No interesting unread comments found.</li>';
    }
    return visibleComments
        .map((comment) => {
            const author = comment.user?.login || 'unknown';
            const timestamp = comment.updated_at || comment.created_at || '';
            const bodyRaw = comment.body || '';
            const renderedBody = renderMarkdown(bodyRaw);
            return `
                <li class="comment-item">
                    <div class="comment-meta">
                        <span>${escapeHtml(author)}</span>
                        <span>${escapeHtml(new Date(timestamp).toLocaleString())}</span>
                    </div>
                    <div class="comment-body markdown-body">${renderedBody}</div>
                </li>
            `;
        })
        .join('');
}

function filterCommentsAfterOwnComment(comments) {
    const login = (state.currentUserLogin || '').toLowerCase();
    if (!login) {
        return comments;
    }
    let lastOwnIndex = -1;
    for (let i = 0; i < comments.length; i += 1) {
        const author = String(comments[i]?.user?.login || '').toLowerCase();
        if (author === login) {
            lastOwnIndex = i;
        }
    }
    return lastOwnIndex === -1 ? comments : comments.slice(lastOwnIndex + 1);
}

function isNotificationUninteresting(notification) {
    if (!state.commentPrefetchEnabled) {
        return false;
    }
    const cached = state.commentCache.threads[getNotificationKey(notification)];
    if (!cached || cached.error) {
        return false;
    }
    const comments = cached.comments || [];
    if (notification.subject?.type === 'PullRequest') {
        if (isNotificationApproved(notification)) {
            return false;
        }
        if (comments.length === 0) {
            return false;
        }
    } else if (comments.length === 0) {
        return true;
    }
    return comments.every(isUninterestingComment);
}

function isNotificationNeedsReview(notification) {
    if (!state.commentPrefetchEnabled) {
        return false;
    }
    if (notification.subject?.type !== 'PullRequest') {
        return false;
    }
    if (isNotificationApproved(notification)) {
        return false;
    }
    const cached = state.commentCache.threads[getNotificationKey(notification)];
    if (!cached || cached.error) {
        return false;
    }
    const comments = cached.comments || [];
    return comments.length === 0;
}

function isNotificationApproved(notification) {
    if (!state.commentPrefetchEnabled) {
        return false;
    }
    if (notification.subject?.type !== 'PullRequest') {
        return false;
    }
    const cached = state.commentCache.threads[getNotificationKey(notification)];
    if (!cached || cached.error) {
        return false;
    }
    const reviews = Array.isArray(cached.reviews) ? cached.reviews : [];
    return hasApprovedReview(reviews);
}

function hasApprovedReview(reviews) {
    const latestByReviewer = new Map();
    reviews.forEach((review) => {
        const login = review?.user?.login;
        if (!login) {
            return;
        }
        const submittedAt = Date.parse(review.submitted_at || '');
        const existing = latestByReviewer.get(login);
        if (!existing || submittedAt > existing.submittedAt) {
            latestByReviewer.set(login, {
                submittedAt: Number.isNaN(submittedAt) ? 0 : submittedAt,
                state: String(review.state || '').toUpperCase(),
            });
        }
    });
    return Array.from(latestByReviewer.values()).some(
        (entry) => entry.state === 'APPROVED'
    );
}

function isUninterestingComment(comment) {
    const body = String(comment?.body || '');
    if (isRevertRelated(body)) {
        return false;
    }
    const author = comment?.user?.login || '';
    if (isBotAuthor(author)) {
        return true;
    }
    return isBotInteractionComment(body);
}

function isRevertRelated(body) {
    return /\brevert(ed|ing)?\b/i.test(body) || /\brollback\b/i.test(body);
}

function isBotAuthor(login) {
    if (!login) {
        return false;
    }
    const normalized = login.toLowerCase();
    if (normalized.endsWith('[bot]')) {
        return true;
    }
    const knownBots = new Set([
        'dr-ci',
        'dr-ci-bot',
        'bors',
        'homu',
        'mergify',
        'htmlpurifierbot',
        'github-actions',
        'dependabot',
        'dependabot-preview',
    ]);
    return knownBots.has(normalized);
}

function isBotInteractionComment(body) {
    const lines = String(body || '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
    if (lines.length === 0) {
        return false;
    }
    const commandPattern =
        '(?:label|unlabel|merge|close|reopen|rebase|retry|rerun|retest|backport|cherry-pick|assign|unassign|cc|triage|priority|kind|lgtm|r\\+)';
    const patterns = [
        new RegExp(`^/(?:${commandPattern})(?:\\s|$)`, 'i'),
        new RegExp(
            `^@?[\\w-]*bot\\b\\s+(?:${commandPattern})(?:\\s|$)`,
            'i'
        ),
        /^bors\b/i,
        /^@?bors\b/i,
        /^@?homu\b/i,
        /^@?mergify\b/i,
        /^@?dr[-.\s]?ci\b/i,
        /^r\+$/i,
    ];
    return lines.every((line) => patterns.some((pattern) => pattern.test(line)));
}

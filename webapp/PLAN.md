# GitHub Notifications UI - Incremental Build Plan

## Overview

Pure HTML+JS application for bulk managing GitHub notifications with:
- Sync from API (with pagination)
- Local storage persistence
- Filtering (open/closed)
- Bulk selection (including shift-click)
- Mark Done with rate limit handling

## API Endpoints (from existing server)

- `GET /notifications/html/repo/{owner}/{repo}` - Get notifications (supports `?fixture=` for mocking)
- `PATCH /github/rest/notifications/threads/{thread_id}` - Mark notification as done (not yet implemented, needs to be added)
- `GET /github/rest/user` - Check auth status

## Phase 1: E2E Testing Infrastructure

**Goal**: Set up Playwright testing with mock API support.

**Files to create**:
- `e2e/playwright.config.ts` - Playwright configuration
- `e2e/package.json` - Dependencies
- `e2e/fixtures/` - Directory for mock API responses
- `e2e/tests/smoke.spec.ts` - Basic smoke test

**E2E Tests**:
- Page loads without errors
- Shows initial empty state

---

## Phase 2: Basic UI Shell

**Goal**: Create the main HTML structure with GitHub-inspired styling.

**Features**:
- Semantic HTML structure
- GitHub-inspired CSS (colors, fonts, spacing)
- Repo input field (owner/repo format)
- Sync button
- Empty notifications list container
- Auth status display

**E2E Tests**:
- Page renders with all expected elements
- Repo input accepts text
- Sync button is visible

---

## Phase 3: Sync & Local Storage

**Goal**: Fetch notifications and persist to localStorage.

**Features**:
- Sync button fetches from API
- Pagination: traverse all pages automatically
- Store notifications in localStorage
- Display loading state during sync
- Handle API errors gracefully
- Show notification count after sync

**E2E Tests**:
- Clicking Sync calls the API (mock response)
- Notifications stored in localStorage after sync
- Multi-page pagination works correctly
- Loading state appears during sync
- Error state displays on API failure

---

## Phase 4: Notification Rendering

**Goal**: Display notifications in GitHub-like style.

**Features**:
- Notification list item with:
  - Issue/PR icon based on type
  - Title as link
  - Repository reference
  - Actor avatars
  - Timestamp (relative time)
  - State badge (open/closed/merged)
  - Unread indicator
- Sort by updated_at descending (most recent first)

**E2E Tests**:
- Notifications render with correct structure
- Correct icons for Issue vs PR
- State badges show correctly
- Timestamps display as relative time
- Sorting is correct

---

## Phase 5: Filtering

**Goal**: Filter notifications by state.

**Features**:
- Filter dropdown/tabs: All | Open | Closed
- Client-side filtering (no API call)
- Persist filter preference
- Show count per filter

**E2E Tests**:
- Filter dropdown shows options
- Selecting "Open" shows only open items
- Selecting "Closed" shows only closed items
- Filter persists on page reload
- Counts update correctly

---

## Phase 6: Selection

**Goal**: Bulk select notifications.

**Features**:
- Checkbox on each notification
- "Select all" checkbox in header
- Shift-click for range selection
- Selection count display
- Visual highlight for selected items

**E2E Tests**:
- Individual checkbox toggles selection
- Select all selects visible (filtered) items
- Shift-click selects range correctly
- Selection count updates correctly
- Visual selection state is correct

---

## Phase 7: Mark Done

**Goal**: Bulk mark notifications as done.

**Features**:
- "Mark Done" button (enabled when items selected)
- Bulk API calls with rate limit handling:
  - Sequential calls with delay
  - Respect X-RateLimit headers
  - Exponential backoff on 429
- Progress indicator:
  - "Processing X of Y..."
  - Progress bar
- Remove done items from list
- Update localStorage

**API Note**: Need to add endpoint to API server:
```
DELETE /github/rest/notifications/threads/{thread_id}
```
This marks a thread as "done" (removes from inbox).

**E2E Tests**:
- Mark Done button disabled when nothing selected
- Mark Done calls API for each selected item
- Progress indicator shows during operation
- Rate limit handling pauses appropriately
- Done items removed from list
- localStorage updated after Mark Done

---

## Phase 8: Error Handling & Polish

**Goal**: Robust error handling and UX polish.

**Features**:
- Rate limit banner with retry countdown
- Inline error messages
- Keyboard shortcuts:
  - `x` to toggle selection
  - `e` to mark done
  - `/` to focus repo input
- Responsive design
- Loading skeletons

**E2E Tests**:
- Rate limit banner appears on 429
- Countdown timer works
- Keyboard shortcuts function correctly
- Mobile viewport renders correctly

---

## Testing Strategy

### Mock API Responses

For E2E tests, use Playwright's route interception to mock API responses:

```typescript
await page.route('**/notifications/html/repo/**', (route) => {
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(mockNotificationsResponse)
  });
});
```

### Fixture Files

Store mock responses in `e2e/fixtures/`:
- `notifications_empty.json` - Empty notification list
- `notifications_mixed.json` - Mix of open/closed, read/unread
- `notifications_page1.json` - First page with pagination
- `notifications_page2.json` - Second page
- `rate_limit_response.json` - 429 response

### Test Isolation

Each test should:
1. Clear localStorage before running
2. Set up route mocks for API calls
3. Navigate to the page
4. Assert expected behavior

---

## File Structure

```
webapp/
├── index.html          # Main app entry point
├── css/
│   └── styles.css      # GitHub-inspired styles
└── js/
    ├── app.js          # Main application logic
    ├── api.js          # API client
    ├── storage.js      # localStorage management
    ├── ui.js           # DOM manipulation
    └── selection.js    # Selection logic

e2e/
├── playwright.config.ts
├── package.json
├── fixtures/
│   ├── notifications_empty.json
│   ├── notifications_mixed.json
│   └── ...
└── tests/
    ├── smoke.spec.ts
    ├── sync.spec.ts
    ├── rendering.spec.ts
    ├── filtering.spec.ts
    ├── selection.spec.ts
    └── mark-done.spec.ts
```

---

## Implementation Order

Each phase builds on the previous:

1. **Phase 1**: Can run tests (empty)
2. **Phase 2**: Page exists with structure
3. **Phase 3**: Data flows from API to storage to display
4. **Phase 4**: Data renders correctly
5. **Phase 5**: Data can be filtered
6. **Phase 6**: Items can be selected
7. **Phase 7**: Selected items can be acted upon
8. **Phase 8**: Edge cases handled gracefully

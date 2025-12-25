# ghsim

GitHub notification simulation and testing tool. Built to investigate whether GitHub's API can distinguish between "read" and "done" notification states, with the goal of building an alternative UI for bulk notification management.

## The Problem

GitHub's web UI has three notification states: **Unread**, **Read**, and **Done**. However, the REST API only exposes two states via the `unread` boolean field. We wanted to confirm whether the "Done" state is accessible via any API.

## Key Findings

### REST API Limitations

| State | `unread` field | `last_read_at` | Visible with `all=true` |
|-------|----------------|----------------|------------------------|
| UNREAD | `true` | `null` | Yes |
| READ | `false` | `<timestamp>` | Yes |
| **DONE** | `false` | `<timestamp>` | **Yes (identical to READ)** |

**Conclusion**: The REST API cannot distinguish READ from DONE. Both states have identical JSON responses.

### GraphQL API

- The public GraphQL schema has **no notifications support**
- `viewer.notifications` field does not exist
- Notifications were briefly added (Jan 10-14, 2025) then removed
- The mobile app uses undocumented internal GraphQL endpoints

### HTML Page Data

The web UI exposes additional data not available in the API:

| Field | Available in API | Available in HTML |
|-------|------------------|-------------------|
| `is_done` | No | Yes (via `is:done` query) |
| `is_saved` | No | Yes (via `is:saved` query) |
| `subject.state` (open/closed/merged) | No | Yes (via icon class) |
| `subject.number` | No | Yes |
| `actors` (avatars) | No | Yes |

### Pagination

HTML pagination uses cursor-based navigation:
- Cursor format: `Y3Vyc29yOjI1` = base64(`cursor:25`)
- Parameters: `before=` and `after=`
- Page size: 25 (fixed)
- Total count available from "X-Y of Z" text

## Setup

```bash
# Install dependencies
uv sync

# Install Playwright browsers
uv run playwright install chromium
```

## Usage

### 1. Authenticate Both Test Accounts

```bash
# Login interactively (opens browser for manual login)
uv run python -m ghsim.auth account1
uv run python -m ghsim.auth account2
```

Sessions are saved to `auth_state/{account}.json`.

### 2. Provision API Tokens

```bash
# Create classic PAT with repo, notifications, delete_repo scopes
uv run python -m ghsim.token account1
uv run python -m ghsim.token account2
```

Tokens are saved to `auth_state/{account}.token`.

### 3. Run Test Flows

```bash
# Basic notification test
uv run python -m ghsim.run_flow basic owner_account trigger_account

# Read vs Done state test (confirms API limitation)
uv run python -m ghsim.run_flow read_vs_done owner_account trigger_account

# Pagination test (creates 30 notifications)
uv run python -m ghsim.run_flow pagination owner_account trigger_account --num-issues 30
```

Options:
- `--headed` - Show browser window
- `--no-cleanup` - Keep test repo after run
- `--num-issues N` - Number of issues for pagination test

## Project Structure

```
ghsim/
├── auth.py              # Playwright login bootstrap
├── token.py             # Classic PAT provisioning via web UI
├── github_api.py        # REST API client (urllib, no deps)
├── notifications.py     # Legacy notification test script
├── run_flow.py          # Flow runner CLI
└── flows/
    ├── base.py              # Base class with common setup/teardown
    ├── basic_notification.py # Verifies notification generation
    ├── read_vs_done.py      # Tests read vs done API visibility
    └── pagination.py        # Triggers 26+ notifications for pagination

auth_state/              # Browser sessions and tokens (gitignored)
responses/               # Captured HTML/JSON/screenshots (gitignored)
```

## Proposed HTML Scraping API Schema

Since the REST API cannot access Done state, an alternative is to scrape the HTML. Proposed response format:

```json
{
  "notifications": [
    {
      "id": "NT_kwDOAZShobQyMTQ2Nzk2MDcxMjoyNjUxNzkyMQ",
      "unread": false,
      "reason": "subscribed",
      "updated_at": "2025-12-25T03:40:24Z",
      "subject": {
        "title": "Fix login bug",
        "url": "https://github.com/owner/repo/issues/1",
        "type": "Issue",
        "number": 1,
        "state": "open"
      },
      "repository": {
        "id": 1122575165,
        "full_name": "owner/repo"
      },
      "actors": [
        {"login": "username", "avatar_url": "https://..."}
      ],
      "is_saved": false,
      "is_done": false
    }
  ],
  "pagination": {
    "before_cursor": null,
    "after_cursor": "Y3Vyc29yOjI1",
    "range_start": 1,
    "range_end": 25,
    "total_count": 30
  }
}
```

### HTML Data Sources

| Field | HTML Source |
|-------|-------------|
| `id` | `data-notification-id` attribute |
| `unread` | CSS class `notification-read` vs `notification-unread` |
| `reason` | Text in `.f6.flex-self-center` |
| `updated_at` | `<relative-time datetime="...">` |
| `subject.type` | `data-hydro-click` JSON or icon class |
| `subject.state` | Icon: `octicon-issue-opened`, `octicon-git-merge`, etc. |
| `subject.number` | `#N` text |
| `is_done` | Current query contains `is:done` |
| `is_saved` | Bookmark icon visibility |

### Subject State Icon Mapping

| Icon Class | State |
|------------|-------|
| `octicon-issue-opened` + `color-fg-open` | `open` |
| `octicon-issue-closed` + `color-fg-closed` | `closed` |
| `octicon-git-pull-request` + `color-fg-open` | `open` |
| `octicon-git-merge` + `color-fg-done` | `merged` |
| `octicon-git-pull-request-closed` | `closed` |

## Next Steps

1. **Build HTML parser** - Extract structured data from notifications HTML
2. **Implement scraping API** - Playwright-based endpoint that returns JSON
3. **Add bulk actions** - Mark as Done, Save, Unsubscribe via form POST
4. **Build alternative UI** - Web interface for bulk notification management

## Test Accounts

The flows require two GitHub accounts:
- **Owner account**: Receives notifications, owns test repos
- **Trigger account**: Creates issues to trigger notifications

Both need:
- Browser session (`ghsim.auth`)
- Classic PAT with scopes: `repo`, `notifications`, `delete_repo` (`ghsim.token`)

## Evidence

Test results are saved to `responses/`:
- `state_unread_*.json` - API response when notification is unread
- `state_read_*.json` - API response after marking as read
- `state_done_*.json` - API response after marking as done (identical to read!)
- `pagination_page*.html` - HTML with pagination cursors
- `*.png` - Screenshots of web UI states

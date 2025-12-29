"""
Done Then Close flow - tests timestamp behavior when notification returns after being marked done.

This flow tests the specific scenario:
1. Second account creates an issue and posts a comment (triggers notification)
2. First account marks the notification as DONE
3. Second account closes the issue
4. Verify that the notification shows up with timestamp indicating only the closure is "new"

The hypothesis being tested: When a notification comes back after being marked done,
does the timestamp correctly reflect only the new activity (the closure), or does it
incorrectly pull all previous activity (including old comments)?
"""

from __future__ import annotations

import time
import urllib.parse
from datetime import datetime, timezone
from typing import Any

from playwright.sync_api import sync_playwright, Page

from ghinbox.flows.base import BaseFlow
from ghinbox.github_api import save_response, RESPONSES_DIR
from ghinbox.parser.notifications import parse_notifications_html


class DoneThenCloseFlow(BaseFlow):
    """Test timestamp behavior when a notification returns after being marked done."""

    name = "done_then_close"
    description = "Test timestamp behavior: done notification returns after issue close"

    def run(self) -> bool:
        """Run the done-then-close timestamp test."""
        if not self.validate_prerequisites():
            return False

        try:
            if not self.setup_test_repo():
                return False

            # Step 1: Create issue and add a comment
            print(f"\n{'=' * 60}")
            print("Step 1: Creating issue and adding comment")
            print(f"{'=' * 60}")

            issue = self.create_test_issue()
            issue_number = issue.get("number")
            if not isinstance(issue_number, int):
                print("ERROR: Issue number missing from API response")
                return False

            # Add a comment from trigger account
            assert self.trigger_api is not None
            comment_body = (
                f"Initial comment at {datetime.now(timezone.utc).isoformat()}"
            )
            self.trigger_api.create_issue_comment(
                self.owner_username, self.repo_name, issue_number, comment_body
            )
            print(f"Added comment to issue #{issue_number}")

            # Wait for notification
            notification = self.wait_for_notification()
            if not notification:
                print("ERROR: Notification not found via API")
                return False

            thread_id = notification.get("id")
            if not isinstance(thread_id, str):
                print("ERROR: Notification thread ID missing")
                return False

            print(f"Notification thread ID: {thread_id}")

            # Capture initial state (before done)
            print(f"\n{'=' * 60}")
            print("Snapshot 1: Before marking as done")
            print(f"{'=' * 60}")
            snapshot_before_done = self._capture_full_snapshot(
                label="before_done",
                thread_id=thread_id,
                issue_number=issue_number,
            )

            # Step 2: Mark as DONE via web UI
            print(f"\n{'=' * 60}")
            print("Step 2: Marking notification as DONE")
            print(f"{'=' * 60}")

            with sync_playwright() as p:
                context = self.create_browser_context(p)
                if context is None:
                    print("Failed to create browser context")
                    return False

                page = context.new_page()
                self._mark_as_done_via_ui(page)

                if context.browser:
                    context.browser.close()

            time.sleep(3)  # Let GitHub process the done state

            # Capture state after done
            print(f"\n{'=' * 60}")
            print("Snapshot 2: After marking as done")
            print(f"{'=' * 60}")
            snapshot_after_done = self._capture_full_snapshot(
                label="after_done",
                thread_id=thread_id,
                issue_number=issue_number,
            )

            # Record the time just before closing
            pre_close_time = datetime.now(timezone.utc).isoformat()
            print(f"Pre-close time: {pre_close_time}")

            # Step 3: Close the issue from trigger account
            print(f"\n{'=' * 60}")
            print("Step 3: Closing the issue")
            print(f"{'=' * 60}")

            self.trigger_api.close_issue(
                self.owner_username, self.repo_name, issue_number
            )
            print(f"Closed issue #{issue_number}")

            # Wait for notification to reappear
            print(f"\n{'=' * 60}")
            print("Waiting for notification to reappear after close")
            print(f"{'=' * 60}")

            notification_after_close = self._wait_for_notification_update(
                thread_id=thread_id,
                previous_updated_at=snapshot_after_done.get("notification_updated_at"),
            )

            if not notification_after_close:
                print("WARNING: Notification did not reappear or update after close")
                # Still capture state even if notification didn't update
            else:
                print("Notification updated after issue close")

            # Capture final state
            print(f"\n{'=' * 60}")
            print("Snapshot 3: After issue close")
            print(f"{'=' * 60}")
            snapshot_after_close = self._capture_full_snapshot(
                label="after_close",
                thread_id=thread_id,
                issue_number=issue_number,
            )

            # Also capture HTML state to see what the UI shows
            print(f"\n{'=' * 60}")
            print("Capturing HTML notification state")
            print(f"{'=' * 60}")

            with sync_playwright() as p:
                context = self.create_browser_context(p)
                if context is None:
                    print("Failed to create browser context")
                    return False

                page = context.new_page()
                self._capture_html_state(page)

                if context.browser:
                    context.browser.close()

            # Analysis
            print(f"\n{'=' * 60}")
            print("ANALYSIS: Timestamp Behavior")
            print(f"{'=' * 60}")
            self._analyze_timestamps(
                snapshot_before_done,
                snapshot_after_done,
                snapshot_after_close,
                pre_close_time,
            )

            return True

        finally:
            self.cleanup_test_repo()

    def _capture_full_snapshot(
        self,
        label: str,
        thread_id: str,
        issue_number: int,
    ) -> dict[str, Any]:
        """Capture comprehensive snapshot of notification and issue state."""
        assert self.owner_api is not None

        # Get notification from API
        notifications_all = self.owner_api.get_notifications(all_notifications=True)
        our_notification = next(
            (
                n
                for n in notifications_all
                if n.get("repository", {}).get("name") == self.repo_name
            ),
            None,
        )

        # Get thread details
        thread = self.owner_api.get_notification_thread(thread_id)

        # Get issue details
        issue = self.owner_api.get_issue(
            self.owner_username, self.repo_name, issue_number
        )

        # Get comments
        comments = self.owner_api.list_issue_comments(
            self.owner_username, self.repo_name, issue_number
        )

        # Get timeline events
        timeline = self.owner_api.list_issue_timeline(
            self.owner_username, self.repo_name, issue_number
        )

        snapshot = {
            "label": label,
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "notification": our_notification,
            "notification_updated_at": (
                our_notification.get("updated_at") if our_notification else None
            ),
            "notification_unread": (
                our_notification.get("unread") if our_notification else None
            ),
            "thread": thread,
            "thread_updated_at": thread.get("updated_at") if thread else None,
            "thread_last_read_at": thread.get("last_read_at") if thread else None,
            "issue": issue,
            "issue_state": issue.get("state") if issue else None,
            "issue_updated_at": issue.get("updated_at") if issue else None,
            "comments": comments,
            "comments_count": len(comments),
            "timeline": timeline,
            "timeline_count": len(timeline),
        }

        # Print summary
        print(f"Snapshot '{label}':")
        print(f"  Notification present: {our_notification is not None}")
        if our_notification:
            print(f"  Notification updated_at: {our_notification.get('updated_at')}")
            print(f"  Notification unread: {our_notification.get('unread')}")
        if thread:
            print(f"  Thread updated_at: {thread.get('updated_at')}")
            print(f"  Thread last_read_at: {thread.get('last_read_at')}")
        if issue:
            print(f"  Issue state: {issue.get('state')}")
            print(f"  Issue updated_at: {issue.get('updated_at')}")
        print(f"  Comments: {len(comments)}")
        print(f"  Timeline events: {len(timeline)}")

        # Save snapshot
        save_response(f"done_then_close_{label}", snapshot, "json")

        return snapshot

    def _wait_for_notification_update(
        self,
        thread_id: str,
        previous_updated_at: str | None,
        max_attempts: int = 10,
        wait_seconds: int = 3,
    ) -> dict[str, Any] | None:
        """Wait for the notification to update after closing the issue."""
        assert self.owner_api is not None

        for attempt in range(max_attempts):
            if attempt > 0:
                print(
                    f"  Attempt {attempt + 1}/{max_attempts}, waiting {wait_seconds}s..."
                )
                time.sleep(wait_seconds)

            # Check both unread notifications and all notifications
            notifications = self.owner_api.get_notifications(all_notifications=True)

            for notif in notifications:
                if notif.get("repository", {}).get("name") == self.repo_name:
                    current_updated_at = notif.get("updated_at")
                    if previous_updated_at is None:
                        return notif
                    if current_updated_at and current_updated_at != previous_updated_at:
                        return notif

        return None

    def _mark_as_done_via_ui(self, page: Page) -> None:
        """Mark the notification as done using the Done button."""
        query = f"repo:{self.owner_username}/{self.repo_name}"
        url = f"https://github.com/notifications?query={urllib.parse.quote(query)}"

        page.goto(url, wait_until="domcontentloaded")
        page.locator(".notifications-list-item, .blankslate").first.wait_for(
            state="attached", timeout=10000
        )

        RESPONSES_DIR.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(RESPONSES_DIR / "done_then_close_before_done.png"))
        print("Screenshot saved: done_then_close_before_done.png")

        # Find and click checkbox, then Done button
        notification_checkbox = page.locator(
            f'.notifications-list-item:has(a[href*="{self.repo_name}"]) input[type="checkbox"]'
        ).first

        if notification_checkbox.count() > 0:
            notification_checkbox.check()
            done_button = page.locator('button:has-text("Done")').first
            done_button.wait_for(state="visible", timeout=5000)
            print("Selected notification checkbox")
            done_button.click()
            page.locator(
                f'.notifications-list-item:has(a[href*="{self.repo_name}"])'
            ).wait_for(state="hidden", timeout=10000)
            print("Clicked Done button")
        else:
            # Try hover approach
            notification_row = page.locator(
                f'.notifications-list-item:has(a[href*="{self.repo_name}"])'
            ).first
            if notification_row.count() > 0:
                notification_row.hover()
                done_icon = notification_row.locator('button[aria-label*="Done"]').first
                done_icon.wait_for(state="visible", timeout=5000)
                done_icon.click()
                notification_row.wait_for(state="hidden", timeout=10000)
                print("Clicked Done icon on row")
            else:
                print("WARNING: Could not find notification to mark as done")

        page.screenshot(path=str(RESPONSES_DIR / "done_then_close_after_done.png"))
        print("Screenshot saved: done_then_close_after_done.png")

    def _capture_html_state(self, page: Page) -> None:
        """Capture the HTML state of notifications after the close event."""
        query = f"repo:{self.owner_username}/{self.repo_name}"
        url = f"https://github.com/notifications?query={urllib.parse.quote(query)}"

        page.goto(url, wait_until="domcontentloaded")
        time.sleep(2)  # Give time for notifications to load

        RESPONSES_DIR.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(RESPONSES_DIR / "done_then_close_final_state.png"))
        print("Screenshot saved: done_then_close_final_state.png")

        html_content = page.content()
        save_response("done_then_close_final_html", html_content, "html")

        # Parse the HTML
        parsed = parse_notifications_html(
            html=html_content,
            owner=self.owner_username,
            repo=self.repo_name,
            source_url=url,
        )
        save_response(
            "done_then_close_final_parsed", parsed.model_dump(mode="json"), "json"
        )

        # Report what we found
        print(f"Found {len(parsed.notifications)} notifications in HTML")
        for notif in parsed.notifications:
            print(f"  - {notif.subject.title}")
            print(f"    updated_at: {notif.updated_at}")
            print(f"    state: {notif.subject.state}")

    def _analyze_timestamps(
        self,
        before_done: dict[str, Any],
        after_done: dict[str, Any],
        after_close: dict[str, Any],
        pre_close_time: str,
    ) -> None:
        """Analyze timestamp behavior across the three snapshots."""
        print("\n" + "=" * 60)
        print("TIMESTAMP COMPARISON")
        print("=" * 60)

        print("\n1. NOTIFICATION TIMESTAMPS:")
        print(f"   Before done:  {before_done.get('notification_updated_at')}")
        print(f"   After done:   {after_done.get('notification_updated_at')}")
        print(f"   After close:  {after_close.get('notification_updated_at')}")

        print("\n2. THREAD TIMESTAMPS:")
        print(f"   Before done updated_at:   {before_done.get('thread_updated_at')}")
        print(f"   Before done last_read_at: {before_done.get('thread_last_read_at')}")
        print(f"   After done updated_at:    {after_done.get('thread_updated_at')}")
        print(f"   After done last_read_at:  {after_done.get('thread_last_read_at')}")
        print(f"   After close updated_at:   {after_close.get('thread_updated_at')}")
        print(f"   After close last_read_at: {after_close.get('thread_last_read_at')}")

        print("\n3. ISSUE TIMESTAMPS:")
        print(f"   Before done: {before_done.get('issue_updated_at')}")
        print(f"   After done:  {after_done.get('issue_updated_at')}")
        print(f"   After close: {after_close.get('issue_updated_at')}")

        print(f"\n4. PRE-CLOSE REFERENCE TIME: {pre_close_time}")

        # Key analysis
        print("\n" + "=" * 60)
        print("KEY FINDINGS")
        print("=" * 60)

        # Compare notification updated_at with pre_close_time
        after_close_updated = after_close.get("notification_updated_at")
        if after_close_updated:
            print(f"\nNotification updated_at after close: {after_close_updated}")
            print(f"Pre-close reference time:            {pre_close_time}")

            # Parse and compare times
            try:
                close_ts = self._parse_iso(after_close_updated)
                pre_ts = self._parse_iso(pre_close_time)
                if close_ts and pre_ts:
                    if close_ts >= pre_ts:
                        print(
                            "✓ Notification timestamp is at or after close time "
                            "(expected - reflects close event)"
                        )
                    else:
                        print(
                            "⚠ Notification timestamp is BEFORE close time "
                            "(unexpected - may be using old timestamp)"
                        )
            except Exception as e:
                print(f"Could not compare timestamps: {e}")

        # Check if notification reappeared as unread
        was_unread_before = before_done.get("notification_unread")
        is_unread_after = after_close.get("notification_unread")
        print(f"\nUnread status before done: {was_unread_before}")
        print(f"Unread status after close: {is_unread_after}")

        # Check last_read_at behavior
        last_read_before = before_done.get("thread_last_read_at")
        last_read_after = after_close.get("thread_last_read_at")
        print(f"\nlast_read_at before done: {last_read_before}")
        print(f"last_read_at after close: {last_read_after}")

        # Comments analysis
        print(f"\nComment count before done: {before_done.get('comments_count')}")
        print(f"Comment count after close: {after_close.get('comments_count')}")

        # Timeline analysis
        print(f"\nTimeline events before done: {before_done.get('timeline_count')}")
        print(f"Timeline events after close: {after_close.get('timeline_count')}")

        print("\n" + "=" * 60)
        print("IMPLICATIONS FOR COMMENT FETCHING")
        print("=" * 60)
        print("\nIf last_read_at is preserved after marking as done, then using it")
        print(
            "as a 'since' filter for comments should correctly return only new activity."
        )
        print("If last_read_at is cleared or reset, all comments would be fetched.")
        print("\nCheck the saved JSON files for detailed timeline and comment data.")

    def _parse_iso(self, ts: str | None) -> datetime | None:
        """Parse ISO datetime string."""
        if not ts:
            return None
        try:
            if ts.endswith("Z"):
                return datetime.fromisoformat(ts.replace("Z", "+00:00"))
            return datetime.fromisoformat(ts)
        except ValueError:
            return None

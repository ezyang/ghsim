"""
Notification timestamps flow - probes notification timestamp semantics and event loading.

This flow:
1. Creates a notification via a test issue
2. Captures notification thread timestamps before read
3. Marks the thread as read via API
4. Adds a follow-up comment to generate new activity
5. Captures issue events/timeline/comments using timestamps for filtering
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from ghinbox.flows.base import BaseFlow
from ghinbox.github_api import save_response


class NotificationTimestampsFlow(BaseFlow):
    """Probe notification timestamps and issue event retrieval semantics."""

    name = "notification_timestamps"
    description = "Probe notification timestamp meaning and event loading after read"

    def run(self) -> bool:
        if not self.validate_prerequisites():
            return False

        try:
            if not self.setup_test_repo():
                return False

            issue = self.create_test_issue()
            issue_number = issue.get("number")
            if not isinstance(issue_number, int):
                print("ERROR: Issue number missing from API response")
                return False

            notification = self.wait_for_notification()
            if not notification:
                print("ERROR: Notification not found via API")
                return False

            thread_id = notification.get("id")
            if not isinstance(thread_id, str):
                print("ERROR: Notification thread ID missing")
                return False

            print(f"\nNotification thread ID: {thread_id}")

            print(f"\n{'=' * 60}")
            print("Snapshot 1: Baseline timestamps")
            print(f"{'=' * 60}")
            baseline = self._capture_snapshot(
                label="baseline",
                thread_id=thread_id,
                issue_number=issue_number,
                since=None,
            )

            self._print_thread_timestamps("baseline", baseline.get("thread"))

            print(f"\n{'=' * 60}")
            print("Marking notification as READ (API)")
            print(f"{'=' * 60}")
            assert self.owner_api is not None, "Must call validate_prerequisites first"
            self.owner_api.mark_notification_read(thread_id)
            time.sleep(2)

            print(f"\n{'=' * 60}")
            print("Snapshot 2: After marking read")
            print(f"{'=' * 60}")
            after_read = self._capture_snapshot(
                label="after_read",
                thread_id=thread_id,
                issue_number=issue_number,
                since=None,
            )

            self._print_thread_timestamps("after_read", after_read.get("thread"))
            last_read_at_raw = self._get_thread_timestamp_raw(
                after_read.get("thread"), "last_read_at"
            )

            print(f"\n{'=' * 60}")
            print("Creating follow-up comment to trigger new activity")
            print(f"{'=' * 60}")
            assert self.trigger_api is not None, (
                "Must call validate_prerequisites first"
            )
            comment_body = f"Follow-up comment from ghinbox at {datetime.now(timezone.utc).isoformat()}"
            self.trigger_api.create_issue_comment(
                self.owner_username, self.repo_name, issue_number, comment_body
            )

            updated_thread = self._wait_for_thread_update(
                thread_id=thread_id,
                previous_timestamp=self._get_thread_timestamp(
                    baseline.get("thread"), "updated_at"
                ),
            )
            if not updated_thread:
                print("ERROR: Notification thread did not update after comment")
                return False

            print(f"\n{'=' * 60}")
            print("Snapshot 3: After new activity")
            print(f"{'=' * 60}")
            after_update = self._capture_snapshot(
                label="after_update",
                thread_id=thread_id,
                issue_number=issue_number,
                since=last_read_at_raw,
            )

            self._print_thread_timestamps("after_update", after_update.get("thread"))

            print(f"\n{'=' * 60}")
            print("ANALYSIS: Timestamp signals")
            print(f"{'=' * 60}")
            print(
                "Compare notification.updated_at, thread.updated_at, thread.last_read_at, "
                "issue.updated_at, and event/comment timestamps in saved responses."
            )
            print(
                "Filtered endpoints used 'since' when available to approximate "
                "events after last read."
            )

            return True
        finally:
            self.cleanup_test_repo()

    def _capture_snapshot(
        self,
        label: str,
        thread_id: str,
        issue_number: int,
        since: str | None,
    ) -> dict[str, Any]:
        assert self.owner_api is not None, "Must call validate_prerequisites first"

        notifications_all = self.owner_api.get_notifications(all_notifications=True)
        our_notification = next(
            (
                notif
                for notif in notifications_all
                if notif.get("repository", {}).get("name") == self.repo_name
            ),
            None,
        )

        thread = self.owner_api.get_notification_thread(thread_id)
        issue = self.owner_api.get_issue(
            self.owner_username, self.repo_name, issue_number
        )
        issue_events = self.owner_api.list_issue_events(
            self.owner_username, self.repo_name, issue_number
        )
        issue_timeline = self.owner_api.list_issue_timeline(
            self.owner_username, self.repo_name, issue_number, since=since
        )
        issue_comments = self.owner_api.list_issue_comments(
            self.owner_username, self.repo_name, issue_number, since=since
        )

        notifications_since = None
        if since:
            notifications_since = self.owner_api.get_notifications(
                all_notifications=True, since=since
            )

        snapshot = {
            "label": label,
            "captured_at": datetime.now(timezone.utc).isoformat(),
            "since": since,
            "notification": our_notification,
            "notification_all_count": len(notifications_all),
            "notifications_since": notifications_since,
            "thread": thread,
            "issue": issue,
            "issue_events": issue_events,
            "issue_timeline": issue_timeline,
            "issue_comments": issue_comments,
        }

        print(f"Notifications (all): {len(notifications_all)}")
        print(f"Issue events: {len(issue_events)}")
        print(f"Issue timeline (since={since}): {len(issue_timeline)}")
        print(f"Issue comments (since={since}): {len(issue_comments)}")
        if notifications_since is not None:
            print(f"Notifications (since={since}): {len(notifications_since)}")

        save_response(f"notification_timestamps_{label}", snapshot, "json")
        return snapshot

    def _wait_for_thread_update(
        self,
        thread_id: str,
        previous_timestamp: datetime | None,
        max_attempts: int = 6,
        wait_seconds: int = 5,
    ) -> dict[str, Any] | None:
        assert self.owner_api is not None, "Must call validate_prerequisites first"

        for attempt in range(max_attempts):
            if attempt > 0:
                time.sleep(wait_seconds)
            thread = self.owner_api.get_notification_thread(thread_id)
            updated_at = self._get_thread_timestamp(thread, "updated_at")
            if updated_at and previous_timestamp is None:
                return thread
            if updated_at and previous_timestamp and updated_at > previous_timestamp:
                return thread
        return None

    def _get_thread_timestamp(
        self, thread: dict[str, Any] | None, field: str
    ) -> datetime | None:
        raw_value = self._get_thread_timestamp_raw(thread, field)
        if not raw_value:
            return None
        return self._parse_iso_datetime(raw_value)

    def _get_thread_timestamp_raw(
        self, thread: dict[str, Any] | None, field: str
    ) -> str | None:
        if not thread:
            return None
        raw_value = thread.get(field)
        if not isinstance(raw_value, str):
            return None
        return raw_value

    def _parse_iso_datetime(self, value: str) -> datetime | None:
        try:
            if value.endswith("Z"):
                return datetime.fromisoformat(value.replace("Z", "+00:00"))
            return datetime.fromisoformat(value)
        except ValueError:
            return None

    def _print_thread_timestamps(
        self, label: str, thread: dict[str, Any] | None
    ) -> None:
        if not thread:
            print(f"No thread data for {label}")
            return
        print(f"Thread timestamps ({label}):")
        print(f"  updated_at: {thread.get('updated_at')}")
        print(f"  last_read_at: {thread.get('last_read_at')}")

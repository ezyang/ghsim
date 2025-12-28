"""
Comment prefetch validation flow - validate last_read_at usage for comment prefetching.

This flow:
1. Creates an issue to generate a notification
2. Marks the thread as read via API
3. Creates a follow-up comment
4. Fetches comments using since=thread.last_read_at and since=notification.last_read_at
5. Saves responses for comparison
"""

from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

from ghinbox.flows.base import BaseFlow
from ghinbox.github_api import save_response


class CommentPrefetchValidationFlow(BaseFlow):
    """Validate comment prefetch logic based on last_read_at timestamps."""

    name = "comment_prefetch_validation"
    description = "Validate last_read_at usage for comment prefetching"

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
            print("Snapshot 1: Baseline (unread)")
            print(f"{'=' * 60}")
            baseline = self._capture_state("baseline", thread_id, issue_number)
            self._print_state_summary("baseline", baseline)

            print(f"\n{'=' * 60}")
            print("Marking thread as read")
            print(f"{'=' * 60}")
            assert self.owner_api is not None, "Must call validate_prerequisites first"
            self.owner_api.mark_notification_read(thread_id)
            time.sleep(2)

            print(f"\n{'=' * 60}")
            print("Snapshot 2: After marking read")
            print(f"{'=' * 60}")
            after_read = self._capture_state("after_read", thread_id, issue_number)
            self._print_state_summary("after_read", after_read)

            print(f"\n{'=' * 60}")
            print("Creating follow-up comment")
            print(f"{'=' * 60}")
            assert self.trigger_api is not None, (
                "Must call validate_prerequisites first"
            )
            comment_body = f"Prefetch validation comment at {datetime.now(timezone.utc).isoformat()}"
            self.trigger_api.create_issue_comment(
                self.owner_username, self.repo_name, issue_number, comment_body
            )
            time.sleep(2)

            print(f"\n{'=' * 60}")
            print("Snapshot 3: After comment")
            print(f"{'=' * 60}")
            after_comment = self._capture_state(
                "after_comment", thread_id, issue_number
            )
            self._print_state_summary("after_comment", after_comment)

            print(f"\n{'=' * 60}")
            print("ANALYSIS: Comment prefetch windows")
            print(f"{'=' * 60}")
            self._print_comment_fetch_results(after_comment)

            return True
        finally:
            self.cleanup_test_repo()

    def _capture_state(
        self, label: str, thread_id: str, issue_number: int
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

        notification_last_read = self._get_last_read_at(our_notification)
        thread_last_read = self._get_last_read_at(thread)

        comments_since_notification = (
            self.owner_api.list_issue_comments(
                self.owner_username,
                self.repo_name,
                issue_number,
                since=notification_last_read,
            )
            if notification_last_read
            else []
        )
        comments_since_thread = (
            self.owner_api.list_issue_comments(
                self.owner_username,
                self.repo_name,
                issue_number,
                since=thread_last_read,
            )
            if thread_last_read
            else []
        )

        snapshot = {
            "label": label,
            "notification": our_notification,
            "thread": thread,
            "notification_last_read_at": notification_last_read,
            "thread_last_read_at": thread_last_read,
            "comments_since_notification": comments_since_notification,
            "comments_since_thread": comments_since_thread,
        }
        save_response(f"comment_prefetch_validation_{label}", snapshot, "json")
        return snapshot

    def _get_last_read_at(self, payload: dict[str, Any] | None) -> str | None:
        if not payload:
            return None
        value = payload.get("last_read_at")
        return value if isinstance(value, str) else None

    def _print_state_summary(self, label: str, snapshot: dict[str, Any]) -> None:
        notification = snapshot.get("notification") or {}
        thread = snapshot.get("thread") or {}
        print(f"State ({label}):")
        print(f"  notification.unread: {notification.get('unread')}")
        print(f"  notification.last_read_at: {notification.get('last_read_at')}")
        print(f"  notification.updated_at: {notification.get('updated_at')}")
        print(f"  thread.last_read_at: {thread.get('last_read_at')}")
        print(f"  thread.updated_at: {thread.get('updated_at')}")
        print(
            "  comments_since_notification:",
            len(snapshot.get("comments_since_notification") or []),
        )
        print(
            "  comments_since_thread:",
            len(snapshot.get("comments_since_thread") or []),
        )

    def _print_comment_fetch_results(self, snapshot: dict[str, Any]) -> None:
        print(f"notification.last_read_at: {snapshot.get('notification_last_read_at')}")
        print(f"thread.last_read_at: {snapshot.get('thread_last_read_at')}")
        print(
            "comments_since_notification:",
            len(snapshot.get("comments_since_notification") or []),
        )
        print(
            "comments_since_thread:",
            len(snapshot.get("comments_since_thread") or []),
        )

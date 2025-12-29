"""
Prod undo flow - verify GitHub undo restores a done notification.

This flow:
1. Creates a repo + issue to trigger a notification.
2. Fetches HTML notifications to capture authenticity_token + HTML notification ID.
3. Marks the notification as done via REST API.
4. Submits undo (unarchive) using the HTML authenticity_token.
5. Verifies the notification appears again in the HTML list.
"""

from __future__ import annotations

import json
import time
from typing import Any

from ghinbox.api.fetcher import NotificationsFetcher
from ghinbox.flows.base import BaseFlow
from ghinbox.github_api import RESPONSES_DIR, save_response
from ghinbox.parser.notifications import parse_notifications_html


class ProdUndoFlow(BaseFlow):
    """End-to-end undo verification using production GitHub state."""

    name = "prod_undo"
    description = "Verify undo restores a done notification in the HTML list"

    def run(self) -> bool:
        """Run the prod undo flow."""
        if not self.validate_prerequisites():
            return False

        try:
            if not self.setup_test_repo():
                return False

            issue = self.create_test_issue()
            notification = self.wait_for_notification()
            if not notification:
                print("ERROR: Notification not found via API")
                return False

            thread_id = notification.get("id")
            issue_number = issue.get("number")
            issue_url = issue.get("html_url")
            if not thread_id or not issue_url or not issue_number:
                print("ERROR: Missing thread ID or issue metadata for undo flow")
                return False

            print(f"\nNotification thread ID: {thread_id}")
            print(f"Issue URL: {issue_url}")

            with NotificationsFetcher(
                account=self.owner_account, headless=self.headless
            ) as fetcher:
                initial_parsed = self._fetch_notifications(fetcher, label="initial")
                if initial_parsed is None:
                    return False

                match = self._find_notification(
                    initial_parsed.notifications, issue_url, issue_number
                )
                if match is None:
                    print("ERROR: Notification not found in HTML list")
                    return False

                notification_id = match.id
                action_tokens = getattr(match.ui, "action_tokens", {}) or {}
                archive_token = action_tokens.get("archive")
                unarchive_token = action_tokens.get("unarchive")
                if not archive_token or not unarchive_token:
                    print("ERROR: per-notification action tokens missing from HTML")
                    return False
                print(f"HTML notification ID: {notification_id}")

                print(f"\n{'=' * 60}")
                print("Marking notification as DONE via HTML archive")
                print(f"{'=' * 60}")
                archive_result = fetcher.submit_notification_action(
                    action="archive",
                    notification_ids=[notification_id],
                    authenticity_token=archive_token,
                )
                save_response(
                    "prod_undo_archive_action_result",
                    {"status": archive_result.status, "error": archive_result.error},
                    "json",
                )
                if archive_result.response_html:
                    save_response(
                        "prod_undo_archive_action_response",
                        archive_result.response_html,
                        "html",
                    )
                if archive_result.status != "ok":
                    print(f"ERROR: Archive action failed: {archive_result.error}")
                    return False

                if not self._wait_for_notification_visibility(
                    fetcher,
                    issue_url,
                    issue_number,
                    expect_present=False,
                    label="after_html_archive",
                ):
                    print("ERROR: Notification still visible after HTML archive")
                    return False

                print(f"\n{'=' * 60}")
                print("Submitting UNDO via HTML action (after archive)")
                print(f"{'=' * 60}")
                undo_result = fetcher.submit_notification_action(
                    action="unarchive",
                    notification_ids=[notification_id],
                    authenticity_token=unarchive_token,
                )
                save_response(
                    "prod_undo_unarchive_after_archive_result",
                    {"status": undo_result.status, "error": undo_result.error},
                    "json",
                )
                if undo_result.response_html:
                    save_response(
                        "prod_undo_unarchive_after_archive_response",
                        undo_result.response_html,
                        "html",
                    )
                if undo_result.status != "ok":
                    print(f"ERROR: Undo action failed: {undo_result.error}")
                    return False

                if not self._wait_for_notification_visibility(
                    fetcher,
                    issue_url,
                    issue_number,
                    expect_present=True,
                    label="after_html_unarchive",
                ):
                    print("ERROR: Notification not visible after HTML undo")
                    return False

                print(f"\n{'=' * 60}")
                print("Marking notification as DONE via REST API")
                print(f"{'=' * 60}")
                assert self.owner_api is not None
                self.owner_api.delete(f"/notifications/threads/{thread_id}")

                if not self._wait_for_notification_visibility(
                    fetcher,
                    issue_url,
                    issue_number,
                    expect_present=False,
                    label="after_rest_done",
                ):
                    print("ERROR: Notification still visible after REST done")
                    return False

                print(f"\n{'=' * 60}")
                print("Submitting UNDO via HTML action (after REST done)")
                print(f"{'=' * 60}")
                undo_rest_result = fetcher.submit_notification_action(
                    action="unarchive",
                    notification_ids=[notification_id],
                    authenticity_token=unarchive_token,
                )
                save_response(
                    "prod_undo_unarchive_after_rest_result",
                    {
                        "status": undo_rest_result.status,
                        "error": undo_rest_result.error,
                    },
                    "json",
                )
                if undo_rest_result.response_html:
                    save_response(
                        "prod_undo_unarchive_after_rest_response",
                        undo_rest_result.response_html,
                        "html",
                    )
                if undo_rest_result.status != "ok":
                    print(f"ERROR: Undo action failed: {undo_rest_result.error}")
                    return False

                if not self._wait_for_notification_visibility(
                    fetcher,
                    issue_url,
                    issue_number,
                    expect_present=True,
                    label="after_rest_unarchive",
                ):
                    print("ERROR: Notification not visible after REST undo")
                    return False

            print(f"\n{'=' * 60}")
            print("Undo verification succeeded")
            print(f"{'=' * 60}")
            return True

        finally:
            self.cleanup_test_repo()

    def _fetch_notifications(
        self, fetcher: NotificationsFetcher, label: str | None = None
    ) -> Any | None:
        result = fetcher.fetch_repo_notifications(
            owner=self.owner_username,
            repo=self.repo_name,
        )
        if result.status != "ok":
            print(f"ERROR: Failed to fetch notifications HTML: {result.error}")
            return None

        parsed = parse_notifications_html(
            html=result.html,
            owner=self.owner_username,
            repo=self.repo_name,
            source_url=result.url,
        )
        if label:
            RESPONSES_DIR.mkdir(parents=True, exist_ok=True)
            save_response(f"prod_undo_{label}", result.html, "html")
            save_response(
                f"prod_undo_{label}",
                json.dumps(parsed.model_dump(mode="json"), indent=2, sort_keys=True),
                "json",
            )
        return parsed

    def _find_notification(
        self, notifications: list[Any], url: str, number: int
    ) -> Any | None:
        for notif in notifications:
            if getattr(notif.subject, "url", None) == url:
                return notif
            if getattr(notif.subject, "number", None) == number:
                return notif
        return None

    def _wait_for_notification_visibility(
        self,
        fetcher: NotificationsFetcher,
        issue_url: str,
        issue_number: int,
        expect_present: bool,
        label: str,
        max_attempts: int = 6,
        wait_seconds: int = 5,
    ) -> bool:
        for attempt in range(1, max_attempts + 1):
            parsed = self._fetch_notifications(
                fetcher, label=f"{label}_attempt{attempt}"
            )
            if parsed is None:
                return False

            match = self._find_notification(
                parsed.notifications, issue_url, issue_number
            )
            is_present = match is not None
            if is_present == expect_present:
                return True

            if attempt < max_attempts:
                print(
                    f"Waiting for notification visibility to be {expect_present} "
                    f"(attempt {attempt}/{max_attempts}, sleeping {wait_seconds}s)"
                )
                time.sleep(wait_seconds)

        return False

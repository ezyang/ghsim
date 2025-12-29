"""
Anchor Tracking flow - explores how GitHub updates notification link anchors.

This flow tests the hypothesis that the anchor in notification URLs
(e.g., #issuecomment-12345) indicates the first unread comment and
updates after you view the issue page.

Steps:
1. Create issue with initial comment
2. Capture notification HTML - note the anchor in the link
3. Add more comments
4. Capture notification HTML again - anchor should stay the same
5. View the issue page (marks as read)
6. Capture notification HTML - anchor should update to new comments
7. Add another comment
8. Capture notification HTML - anchor should point to newest comment
"""

from __future__ import annotations

import time
import urllib.parse
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright, Page

from ghinbox.flows.base import BaseFlow
from ghinbox.github_api import save_response, RESPONSES_DIR
from ghinbox.parser.notifications import parse_notifications_html


class AnchorTrackingFlow(BaseFlow):
    """Track how notification link anchors change with read state."""

    name = "anchor_tracking"
    description = "Track notification anchor changes to understand read state"

    def run(self) -> bool:
        """Run the anchor tracking test."""
        if not self.validate_prerequisites():
            return False

        try:
            if not self.setup_test_repo():
                return False

            # Step 1: Create issue
            print(f"\n{'=' * 60}")
            print("Step 1: Creating issue")
            print(f"{'=' * 60}")

            issue = self.create_test_issue()
            issue_number = issue.get("number")
            if not isinstance(issue_number, int):
                print("ERROR: Issue number missing")
                return False

            # Wait for notification
            notification = self.wait_for_notification()
            if not notification:
                print("ERROR: Notification not found")
                return False

            # Step 2: Capture initial anchor
            print(f"\n{'=' * 60}")
            print("Step 2: Capture initial notification anchor")
            print(f"{'=' * 60}")

            anchor_1 = self._capture_notification_anchor("step2_initial")

            # Step 3: Add first comment
            print(f"\n{'=' * 60}")
            print("Step 3: Adding first comment")
            print(f"{'=' * 60}")

            assert self.trigger_api is not None
            comment1 = self.trigger_api.create_issue_comment(
                self.owner_username,
                self.repo_name,
                issue_number,
                f"First comment at {datetime.now(timezone.utc).isoformat()}",
            )
            print(f"Comment 1 ID: {comment1.get('id')}")
            time.sleep(3)

            # Capture anchor after comment
            anchor_2 = self._capture_notification_anchor("step3_after_comment1")

            # Step 4: Add second comment
            print(f"\n{'=' * 60}")
            print("Step 4: Adding second comment")
            print(f"{'=' * 60}")

            comment2 = self.trigger_api.create_issue_comment(
                self.owner_username,
                self.repo_name,
                issue_number,
                f"Second comment at {datetime.now(timezone.utc).isoformat()}",
            )
            print(f"Comment 2 ID: {comment2.get('id')}")
            time.sleep(3)

            anchor_3 = self._capture_notification_anchor("step4_after_comment2")

            # Step 5: Read the notification by visiting issue page
            print(f"\n{'=' * 60}")
            print("Step 5: Reading notification (visiting issue page)")
            print(f"{'=' * 60}")

            with sync_playwright() as p:
                context = self.create_browser_context(p)
                if context is None:
                    print("Failed to create browser context")
                    return False

                page = context.new_page()
                self._visit_issue_page(page, issue_number)

                if context.browser:
                    context.browser.close()

            time.sleep(3)

            # Capture anchor after reading
            anchor_4 = self._capture_notification_anchor("step5_after_read")

            # Step 6: Add third comment (new activity after read)
            print(f"\n{'=' * 60}")
            print("Step 6: Adding third comment (after read)")
            print(f"{'=' * 60}")

            comment3 = self.trigger_api.create_issue_comment(
                self.owner_username,
                self.repo_name,
                issue_number,
                f"Third comment at {datetime.now(timezone.utc).isoformat()}",
            )
            print(f"Comment 3 ID: {comment3.get('id')}")
            time.sleep(3)

            anchor_5 = self._capture_notification_anchor("step6_after_comment3")

            # Analysis
            print(f"\n{'=' * 60}")
            print("ANALYSIS: Anchor Progression")
            print(f"{'=' * 60}")

            self._analyze_anchors(
                [
                    ("Initial (issue created)", anchor_1),
                    ("After comment 1", anchor_2),
                    ("After comment 2", anchor_3),
                    ("After reading issue", anchor_4),
                    ("After comment 3 (new)", anchor_5),
                ],
                [comment1.get("id"), comment2.get("id"), comment3.get("id")],
            )

            return True

        finally:
            self.cleanup_test_repo()

    def _capture_notification_anchor(self, label: str) -> dict[str, Any]:
        """Capture the notification HTML and extract the anchor."""
        with sync_playwright() as p:
            context = self.create_browser_context(p)
            if context is None:
                return {"error": "Failed to create browser context"}

            page = context.new_page()

            query = f"repo:{self.owner_username}/{self.repo_name}"
            url = f"https://github.com/notifications?query={urllib.parse.quote(query)}"

            page.goto(url, wait_until="domcontentloaded")
            page.locator(".notifications-list-item, .blankslate").first.wait_for(
                state="attached", timeout=10000
            )

            time.sleep(1)  # Let page fully render

            html_content = page.content()
            save_response(f"anchor_{label}_html", html_content, "html")

            # Parse HTML
            parsed = parse_notifications_html(
                html=html_content,
                owner=self.owner_username,
                repo=self.repo_name,
                source_url=url,
            )

            RESPONSES_DIR.mkdir(parents=True, exist_ok=True)
            page.screenshot(path=str(RESPONSES_DIR / f"anchor_{label}.png"))

            if context.browser:
                context.browser.close()

            # Extract anchor info
            result: dict[str, Any] = {
                "label": label,
                "notification_count": len(parsed.notifications),
            }

            if parsed.notifications:
                notif = parsed.notifications[0]
                full_url = notif.subject.url
                parsed_url = urlparse(full_url)

                result["full_url"] = full_url
                result["anchor"] = parsed_url.fragment or "(no anchor)"
                result["unread"] = notif.unread

                print(f"  [{label}] URL: {full_url}")
                print(f"  [{label}] Anchor: {result['anchor']}")
                print(f"  [{label}] Unread: {notif.unread}")
            else:
                result["full_url"] = None
                result["anchor"] = "(no notification found)"
                print(f"  [{label}] No notification found in HTML")

            save_response(f"anchor_{label}", result, "json")
            return result

    def _visit_issue_page(self, page: Page, issue_number: int) -> None:
        """Visit the issue page to mark notification as read."""
        issue_url = (
            f"https://github.com/{self.owner_username}/{self.repo_name}"
            f"/issues/{issue_number}"
        )
        print(f"Visiting: {issue_url}")

        page.goto(issue_url, wait_until="domcontentloaded")
        page.locator(".js-issue-title, .markdown-body").first.wait_for(
            state="attached", timeout=10000
        )

        RESPONSES_DIR.mkdir(parents=True, exist_ok=True)
        page.screenshot(path=str(RESPONSES_DIR / "anchor_issue_page.png"))
        print("Issue page loaded")

    def _analyze_anchors(
        self,
        anchors: list[tuple[str, dict[str, Any]]],
        comment_ids: list[int | None],
    ) -> None:
        """Analyze the progression of anchors."""
        print("\nANCHOR PROGRESSION:")
        print("-" * 60)

        for label, data in anchors:
            anchor = data.get("anchor", "?")
            unread = data.get("unread", "?")
            print(f"  {label}:")
            print(f"    Anchor: {anchor}")
            print(f"    Unread: {unread}")

        print("\nCOMMENT IDs (for reference):")
        print("-" * 60)
        for i, cid in enumerate(comment_ids, 1):
            print(f"  Comment {i}: issuecomment-{cid}")

        print("\nKEY OBSERVATIONS:")
        print("-" * 60)

        # Check if anchors reference comment IDs
        anchor_values = [a[1].get("anchor", "") for a in anchors]

        # Check for patterns
        if all(a == "(no anchor)" or not a for a in anchor_values):
            print("  - No anchors found in any notification links")
            print("  - Anchors may only appear for PRs or after activity?")
        else:
            print("  - Anchors found in notification links")

            # Check if anchor changed after reading
            before_read = anchors[2][1].get("anchor")  # After comment 2
            after_read = anchors[3][1].get("anchor")  # After reading

            if before_read != after_read:
                print(f"  - Anchor CHANGED after reading: {before_read} → {after_read}")
            else:
                print(f"  - Anchor did NOT change after reading: {before_read}")

            # Check if new comment after read updates anchor
            after_comment3 = anchors[4][1].get("anchor")
            if after_read != after_comment3:
                print(
                    f"  - Anchor updated after new comment: {after_read} → {after_comment3}"
                )
            else:
                print(f"  - Anchor same after new comment: {after_comment3}")

"""
Parser validation flow - cross-checks HTML parsing with the Notifications API.
"""

from __future__ import annotations

import base64
import time
import urllib.parse
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from playwright.sync_api import sync_playwright

from ghinbox.flows.base import BaseFlow
from ghinbox.github_api import RESPONSES_DIR, GitHubAPI, save_response
from ghinbox.parser.notifications import parse_notifications_html


@dataclass(frozen=True)
class ExpectedNotification:
    title: str
    subject_type: str
    state: str | None
    state_reason: str | None
    html_url: str | None = None


class ParserValidationFlow(BaseFlow):
    """
    Validate HTML parser output against the Notifications API.

    Creates a set of notifications that exercise multiple subject types and
    icon states, then cross-references HTML parsing with API results.
    """

    name = "parser_validation"
    description = "Validate HTML parser against API notifications"

    def run(self) -> bool:
        """Run the parser validation test."""
        if not self.validate_prerequisites():
            return False

        try:
            if not self.setup_test_repo():
                return False

            expected = self._create_notification_sources()
            expected_by_title = {item.title: item for item in expected}

            self._wait_for_expected_notifications(expected_by_title)

            html_content, source_url = self._fetch_notifications_html()
            parsed = parse_notifications_html(
                html=html_content,
                owner=self.owner_username,
                repo=self.repo_name,
                source_url=source_url,
            )

            save_response(
                "parser_validation_html",
                html_content,
                "html",
            )
            save_response(
                "parser_validation_json",
                parsed.model_dump(mode="json"),
                "json",
            )

            assert self.owner_api is not None
            api_notifications = self.owner_api.get_notifications(all_notifications=True)
            save_response(
                "parser_validation_api_notifications", api_notifications, "json"
            )

            self._validate_parsed_notifications(
                parsed, api_notifications, expected_by_title
            )

            print(f"\n{'=' * 60}")
            print("Parser validation successful")
            print(f"{'=' * 60}")
            print(f"Repository: {self.owner_username}/{self.repo_name}")
            print(f"Notifications validated: {len(expected_by_title)}")

            return True

        finally:
            self.cleanup_test_repo()

    def _create_notification_sources(self) -> list[ExpectedNotification]:
        """Create items to generate notifications for multiple types."""
        assert self.owner_api is not None
        assert self.trigger_api is not None

        expected: list[ExpectedNotification] = []
        timestamp = datetime.now().strftime("%Y%m%d%H%M%S")
        default_branch = self._get_default_branch()

        print(f"\n{'=' * 60}")
        print("Creating notification sources")
        print(f"{'=' * 60}")

        issue_open = self.trigger_api.create_issue(
            self.owner_username,
            self.repo_name,
            f"Parser Validation Issue Open {timestamp}",
            "Issue to validate open issue notifications.",
        )
        expected.append(
            ExpectedNotification(
                title=issue_open["title"],
                subject_type="Issue",
                state="open",
                state_reason=None,
                html_url=issue_open.get("html_url"),
            )
        )

        issue_completed = self.trigger_api.create_issue(
            self.owner_username,
            self.repo_name,
            f"Parser Validation Issue Completed {timestamp}",
            "Issue to validate completed issue notifications.",
        )
        self._close_issue(issue_completed["number"], state_reason="completed")
        expected.append(
            ExpectedNotification(
                title=issue_completed["title"],
                subject_type="Issue",
                state="closed",
                state_reason="completed",
                html_url=issue_completed.get("html_url"),
            )
        )

        issue_not_planned = self.trigger_api.create_issue(
            self.owner_username,
            self.repo_name,
            f"Parser Validation Issue Not Planned {timestamp}",
            "Issue to validate not planned issue notifications.",
        )
        self._close_issue(issue_not_planned["number"], state_reason="not_planned")
        expected.append(
            ExpectedNotification(
                title=issue_not_planned["title"],
                subject_type="Issue",
                state="closed",
                state_reason="not_planned",
                html_url=issue_not_planned.get("html_url"),
            )
        )

        pr_open = self._create_pull_request(
            title=f"Parser Validation PR Open {timestamp}",
            body="Open PR for parser validation.",
            draft=False,
            default_branch=default_branch,
            branch_suffix=f"open-{timestamp}",
        )
        expected.append(
            ExpectedNotification(
                title=pr_open["title"],
                subject_type="PullRequest",
                state="open",
                state_reason=None,
                html_url=pr_open.get("html_url"),
            )
        )

        pr_draft = self._create_pull_request(
            title=f"Parser Validation PR Draft {timestamp}",
            body="Draft PR for parser validation.",
            draft=True,
            default_branch=default_branch,
            branch_suffix=f"draft-{timestamp}",
        )
        expected.append(
            ExpectedNotification(
                title=pr_draft["title"],
                subject_type="PullRequest",
                state="draft",
                state_reason=None,
                html_url=pr_draft.get("html_url"),
            )
        )

        pr_merged = self._create_pull_request(
            title=f"Parser Validation PR Merged {timestamp}",
            body="Merged PR for parser validation.",
            draft=False,
            default_branch=default_branch,
            branch_suffix=f"merged-{timestamp}",
        )
        self._merge_pull_request(pr_merged["number"])
        expected.append(
            ExpectedNotification(
                title=pr_merged["title"],
                subject_type="PullRequest",
                state="merged",
                state_reason=None,
                html_url=pr_merged.get("html_url"),
            )
        )

        pr_closed = self._create_pull_request(
            title=f"Parser Validation PR Closed {timestamp}",
            body="Closed PR for parser validation.",
            draft=False,
            default_branch=default_branch,
            branch_suffix=f"closed-{timestamp}",
        )
        self._close_pull_request(pr_closed["number"])
        expected.append(
            ExpectedNotification(
                title=pr_closed["title"],
                subject_type="PullRequest",
                state="closed",
                state_reason=None,
                html_url=pr_closed.get("html_url"),
            )
        )

        release_title = f"parser-validation-{timestamp}"
        release = self._create_release(
            title=release_title,
            tag_name=release_title,
            target_commitish=default_branch,
        )
        expected.append(
            ExpectedNotification(
                title=release.get("name") or release_title,
                subject_type="Release",
                state=None,
                state_reason=None,
                html_url=release.get("html_url"),
            )
        )

        return expected

    def _get_default_branch(self) -> str:
        """Fetch the repository default branch."""
        assert self.owner_api is not None
        repo = self.owner_api.get(f"/repos/{self.owner_username}/{self.repo_name}")
        if not isinstance(repo, dict):
            raise RuntimeError("Failed to fetch repository info")
        return repo.get("default_branch", "main")

    def _close_issue(self, number: int, state_reason: str | None) -> None:
        """Close an issue with an optional state reason."""
        assert self.trigger_api is not None
        payload: dict[str, Any] = {"state": "closed"}
        if state_reason:
            payload["state_reason"] = state_reason
        self.trigger_api.patch(
            f"/repos/{self.owner_username}/{self.repo_name}/issues/{number}",
            payload,
        )

    def _create_pull_request(
        self,
        title: str,
        body: str,
        draft: bool,
        default_branch: str,
        branch_suffix: str,
    ) -> dict[str, Any]:
        """Create a pull request with a unique branch and commit."""
        assert self.trigger_api is not None

        branch_name = f"parser-validation-{branch_suffix}"
        filename = f"parser-validation-{branch_suffix}.md"

        self._create_branch_with_commit(
            api=self.trigger_api,
            base_branch=default_branch,
            branch_name=branch_name,
            filename=filename,
        )

        pr = self.trigger_api.post(
            f"/repos/{self.owner_username}/{self.repo_name}/pulls",
            {
                "title": title,
                "body": body,
                "head": branch_name,
                "base": default_branch,
                "draft": draft,
            },
        )
        if not isinstance(pr, dict):
            raise RuntimeError("Failed to create pull request")
        return pr

    def _create_branch_with_commit(
        self,
        api: GitHubAPI,
        base_branch: str,
        branch_name: str,
        filename: str,
    ) -> None:
        """Create a branch and a commit to ensure a PR diff."""
        ref = api.get(
            f"/repos/{self.owner_username}/{self.repo_name}/git/ref/heads/{base_branch}"
        )
        if not isinstance(ref, dict):
            raise RuntimeError("Failed to fetch base branch ref")
        sha = ref.get("object", {}).get("sha")
        if not sha:
            raise RuntimeError("Base branch ref missing SHA")

        api.post(
            f"/repos/{self.owner_username}/{self.repo_name}/git/refs",
            {
                "ref": f"refs/heads/{branch_name}",
                "sha": sha,
            },
        )

        content = f"Parser validation content for {branch_name}."
        payload = {
            "message": f"Add {filename}",
            "content": base64.b64encode(content.encode("utf-8")).decode("utf-8"),
            "branch": branch_name,
        }
        api.put(
            f"/repos/{self.owner_username}/{self.repo_name}/contents/{filename}",
            payload,
        )

    def _merge_pull_request(self, number: int) -> None:
        """Merge a pull request."""
        assert self.trigger_api is not None
        self.trigger_api.put(
            f"/repos/{self.owner_username}/{self.repo_name}/pulls/{number}/merge",
            {"merge_method": "merge"},
        )

    def _close_pull_request(self, number: int) -> None:
        """Close a pull request without merging."""
        assert self.trigger_api is not None
        self.trigger_api.patch(
            f"/repos/{self.owner_username}/{self.repo_name}/pulls/{number}",
            {"state": "closed"},
        )

    def _create_release(
        self,
        title: str,
        tag_name: str,
        target_commitish: str,
    ) -> dict[str, Any]:
        """Create a release via the REST API."""
        assert self.trigger_api is not None
        release = self.trigger_api.post(
            f"/repos/{self.owner_username}/{self.repo_name}/releases",
            {
                "tag_name": tag_name,
                "name": title,
                "target_commitish": target_commitish,
                "body": "Release for parser validation.",
            },
        )
        if not isinstance(release, dict):
            raise RuntimeError("Failed to create release")
        return release

    def _wait_for_expected_notifications(
        self,
        expected_by_title: dict[str, ExpectedNotification],
        max_attempts: int = 12,
        wait_seconds: int = 10,
    ) -> None:
        """Wait until all expected notifications appear in the API."""
        assert self.owner_api is not None

        remaining = set(expected_by_title.keys())
        for attempt in range(max_attempts):
            if attempt > 0:
                print(
                    f"Waiting {wait_seconds}s... (attempt {attempt + 1}/{max_attempts})"
                )
                time.sleep(wait_seconds)

            notifications = self.owner_api.get_notifications(all_notifications=True)
            for notif in notifications:
                if notif.get("repository", {}).get("name") != self.repo_name:
                    continue
                title = notif.get("subject", {}).get("title")
                if title in remaining:
                    remaining.remove(title)

            if not remaining:
                print("All expected notifications found via API.")
                return

            print(f"Still waiting for {len(remaining)} notifications.")

        raise AssertionError(f"Missing notifications in API: {sorted(remaining)}")

    def _fetch_notifications_html(self) -> tuple[str, str]:
        """Fetch notifications HTML for the test repository."""
        query = f"repo:{self.owner_username}/{self.repo_name}"
        url = f"https://github.com/notifications?query={urllib.parse.quote(query)}"

        with sync_playwright() as p:
            context = self.create_browser_context(p)
            if context is None:
                raise RuntimeError("Failed to create browser context")

            page = context.new_page()
            page.goto(url, wait_until="domcontentloaded")
            page.locator(".notifications-list-item, .blankslate").first.wait_for(
                state="attached", timeout=15000
            )

            RESPONSES_DIR.mkdir(parents=True, exist_ok=True)
            screenshot_path = RESPONSES_DIR / "parser_validation.png"
            page.screenshot(path=str(screenshot_path), full_page=True)
            print(f"Screenshot saved to: {screenshot_path}")

            html_content = page.content()

            if context.browser:
                context.browser.close()

        return html_content, url

    def _validate_parsed_notifications(
        self,
        parsed: Any,
        api_notifications: list[dict[str, Any]],
        expected_by_title: dict[str, ExpectedNotification],
    ) -> None:
        """Validate parsed HTML notifications against API results."""
        api_by_title: dict[str, dict[str, Any]] = {}
        for notif in api_notifications:
            if notif.get("repository", {}).get("name") != self.repo_name:
                continue
            title = notif.get("subject", {}).get("title")
            if isinstance(title, str):
                api_by_title[title] = notif

        html_by_title = {
            notif.subject.title: notif
            for notif in parsed.notifications
            if notif.subject.title in expected_by_title
        }

        missing_html = sorted(set(expected_by_title) - set(html_by_title))
        missing_api = sorted(set(expected_by_title) - set(api_by_title))
        if missing_html:
            raise AssertionError(f"Missing notifications in HTML: {missing_html}")
        if missing_api:
            raise AssertionError(f"Missing notifications in API: {missing_api}")

        for title, expected in expected_by_title.items():
            html_notif = html_by_title[title]
            api_notif = api_by_title[title]

            api_subject = api_notif.get("subject", {})
            api_type = api_subject.get("type", "Unknown")

            if html_notif.subject.type != api_type:
                raise AssertionError(
                    f"Type mismatch for '{title}': HTML={html_notif.subject.type} API={api_type}"
                )
            if html_notif.unread != api_notif.get("unread"):
                raise AssertionError(
                    f"Unread mismatch for '{title}': HTML={html_notif.unread} API={api_notif.get('unread')}"
                )
            if html_notif.reason != api_notif.get("reason"):
                raise AssertionError(
                    f"Reason mismatch for '{title}': HTML={html_notif.reason} API={api_notif.get('reason')}"
                )
            if html_notif.subject.title != title:
                raise AssertionError(
                    f"Title mismatch for '{title}': HTML={html_notif.subject.title}"
                )

            if (
                expected.state is not None
                and html_notif.subject.state != expected.state
            ):
                raise AssertionError(
                    f"State mismatch for '{title}': HTML={html_notif.subject.state} expected={expected.state}"
                )
            if (
                expected.state_reason is not None
                and html_notif.subject.state_reason != expected.state_reason
            ):
                raise AssertionError(
                    f"State reason mismatch for '{title}': HTML={html_notif.subject.state_reason} expected={expected.state_reason}"
                )
            if expected.html_url and html_notif.subject.url != expected.html_url:
                raise AssertionError(
                    f"URL mismatch for '{title}': HTML={html_notif.subject.url} expected={expected.html_url}"
                )

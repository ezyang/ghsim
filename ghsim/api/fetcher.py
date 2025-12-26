"""
Live HTML fetcher using Playwright.

Fetches notifications HTML from GitHub using an authenticated browser session.
"""

import time
import urllib.parse
from dataclasses import dataclass
from typing import Any

from playwright.sync_api import sync_playwright, BrowserContext

from ghsim.auth import create_authenticated_context


@dataclass
class FetchResult:
    """Result of fetching a notifications page."""

    html: str
    url: str
    status: str = "ok"
    error: str | None = None
    timing: dict | None = None


class NotificationsFetcher:
    """
    Fetches notifications HTML from GitHub using Playwright.

    This class manages a persistent browser context for an authenticated
    GitHub session, allowing multiple fetches without re-authenticating.
    """

    def __init__(self, account: str, headless: bool = True):
        """
        Initialize the fetcher.

        Args:
            account: The ghsim account name (must have valid auth state)
            headless: Whether to run browser in headless mode
        """
        self.account = account
        self.headless = headless
        self._playwright: Any = None
        self._context: BrowserContext | None = None

    def start(self) -> None:
        """Start the browser and create authenticated context."""
        if self._playwright is not None:
            return

        self._playwright = sync_playwright().start()
        self._context = create_authenticated_context(
            self._playwright, self.account, headless=self.headless
        )

        if self._context is None:
            raise RuntimeError(
                f"Failed to create authenticated context for '{self.account}'. "
                f"Run: python -m ghsim.auth {self.account}"
            )

    def stop(self) -> None:
        """Stop the browser and clean up."""
        if self._context and self._context.browser:
            self._context.browser.close()
        if self._playwright:
            self._playwright.stop()
        self._context = None
        self._playwright = None

    def fetch_repo_notifications(
        self,
        owner: str,
        repo: str,
        before: str | None = None,
        after: str | None = None,
    ) -> FetchResult:
        """
        Fetch notifications HTML for a specific repository.

        Args:
            owner: Repository owner
            repo: Repository name
            before: Pagination cursor for previous page
            after: Pagination cursor for next page

        Returns:
            FetchResult with HTML content and metadata
        """
        if self._context is None:
            self.start()

        assert self._context is not None

        # Build URL
        query = f"repo:{owner}/{repo}"
        url = f"https://github.com/notifications?query={urllib.parse.quote(query)}"

        if before:
            url += f"&before={urllib.parse.quote(before)}"
        if after:
            url += f"&after={urllib.parse.quote(after)}"

        try:
            timing = {}

            t0 = time.perf_counter()
            page = self._context.new_page()
            timing["new_page_ms"] = int((time.perf_counter() - t0) * 1000)

            t0 = time.perf_counter()
            page.goto(url, wait_until="domcontentloaded")
            timing["goto_ms"] = int((time.perf_counter() - t0) * 1000)

            # Wait for either notifications or empty state to be in DOM
            t0 = time.perf_counter()
            page.locator(".notifications-list-item, .blankslate").first.wait_for(
                state="attached",
                timeout=10000,
            )
            timing["wait_for_ms"] = int((time.perf_counter() - t0) * 1000)

            t0 = time.perf_counter()
            html = page.content()
            timing["content_ms"] = int((time.perf_counter() - t0) * 1000)

            t0 = time.perf_counter()
            page.close()
            timing["close_ms"] = int((time.perf_counter() - t0) * 1000)

            return FetchResult(html=html, url=url, timing=timing)

        except Exception as e:
            return FetchResult(
                html="",
                url=url,
                status="error",
                error=str(e),
            )

    def __enter__(self) -> "NotificationsFetcher":
        self.start()
        return self

    def __exit__(self, *args: Any) -> None:
        self.stop()


# Global fetcher instance (set by server on startup)
_global_fetcher: NotificationsFetcher | None = None


def get_fetcher() -> NotificationsFetcher | None:
    """Get the global fetcher instance."""
    return _global_fetcher


def set_fetcher(fetcher: NotificationsFetcher | None) -> None:
    """Set the global fetcher instance."""
    global _global_fetcher
    _global_fetcher = fetcher

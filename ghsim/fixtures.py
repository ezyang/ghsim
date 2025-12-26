"""
Fixture management CLI for test HTML files.

This module provides commands to manage test fixtures:
- list: Show available response files that can become fixtures
- update: Copy latest responses to tests/fixtures/ with stable names

Usage:
    python -m ghsim.fixtures list
    python -m ghsim.fixtures update [--force]
"""

import argparse
import difflib
import re
import shutil
import sys
from pathlib import Path

# Directories
RESPONSES_DIR = Path("responses")
FIXTURES_DIR = Path("tests/fixtures")

# Mapping from response file patterns to fixture names
# Pattern -> fixture name (without extension)
# Timestamp format: YYYYMMDD_HHMMSS
FIXTURE_MAPPING = {
    r"pagination_page1_\d{8}_\d{6}\.html": "pagination_page1",
    r"pagination_page2_\d{8}_\d{6}\.html": "pagination_page2",
    r"html_before_done_\d{8}_\d{6}\.html": "notification_before_done",
    r"html_after_done_\d{8}_\d{6}\.html": "notification_after_done",
    r"notifications_html_\d{8}_\d{6}\.html": "notifications_inbox",
}


def find_latest_response(pattern: str) -> Path | None:
    """Find the most recent response file matching the pattern."""
    if not RESPONSES_DIR.exists():
        return None

    regex = re.compile(pattern)
    matches = [f for f in RESPONSES_DIR.iterdir() if regex.match(f.name)]

    if not matches:
        return None

    # Sort by modification time, newest first
    matches.sort(key=lambda f: f.stat().st_mtime, reverse=True)
    return matches[0]


def list_responses() -> None:
    """List available response files and their fixture mappings."""
    print("Available response files:")
    print("=" * 60)

    if not RESPONSES_DIR.exists():
        print(f"  (responses directory not found: {RESPONSES_DIR})")
        return

    # Group files by fixture mapping
    for pattern, fixture_name in FIXTURE_MAPPING.items():
        latest = find_latest_response(pattern)
        fixture_path = FIXTURES_DIR / f"{fixture_name}.html"

        print(f"\n{fixture_name}.html:")
        print(f"  Pattern: {pattern}")

        if latest:
            print(f"  Latest:  {latest.name}")
            print(f"           (modified: {latest.stat().st_mtime})")
        else:
            print("  Latest:  (no matching files)")

        if fixture_path.exists():
            print(f"  Fixture: EXISTS ({fixture_path.stat().st_size} bytes)")
        else:
            print("  Fixture: NOT YET CREATED")

    # Also list any unmatched HTML files
    all_html = list(RESPONSES_DIR.glob("*.html"))
    matched_files = set()

    for pattern in FIXTURE_MAPPING:
        regex = re.compile(pattern)
        matched_files.update(f for f in all_html if regex.match(f.name))

    unmatched = [f for f in all_html if f not in matched_files]

    if unmatched:
        print("\n" + "-" * 60)
        print("Other HTML files (no fixture mapping):")
        for f in sorted(unmatched, key=lambda x: x.stat().st_mtime, reverse=True)[:10]:
            print(f"  {f.name}")


def show_diff(old_path: Path, new_path: Path) -> bool:
    """Show diff between old and new file. Returns True if different."""
    if not old_path.exists():
        print(f"  (new file, {new_path.stat().st_size} bytes)")
        return True

    old_content = old_path.read_text().splitlines(keepends=True)
    new_content = new_path.read_text().splitlines(keepends=True)

    if old_content == new_content:
        print("  (no changes)")
        return False

    # Show abbreviated diff
    diff = list(
        difflib.unified_diff(
            old_content[:50],
            new_content[:50],
            fromfile=str(old_path),
            tofile=str(new_path),
            lineterm="",
        )
    )

    if diff:
        print("  Changes (first 50 lines):")
        for line in diff[:20]:
            print(f"    {line.rstrip()}")
        if len(diff) > 20:
            print(f"    ... ({len(diff) - 20} more diff lines)")

    return True


def update_fixtures(force: bool = False) -> None:
    """Update test fixtures from latest response files."""
    print("Updating test fixtures from responses/")
    print("=" * 60)

    # Ensure fixtures directory exists
    FIXTURES_DIR.mkdir(parents=True, exist_ok=True)

    updates: list[tuple[Path, Path]] = []

    for pattern, fixture_name in FIXTURE_MAPPING.items():
        latest = find_latest_response(pattern)
        fixture_path = FIXTURES_DIR / f"{fixture_name}.html"

        print(f"\n{fixture_name}.html:")

        if not latest:
            print("  SKIP: No source file found")
            continue

        print(f"  From: {latest.name}")

        has_changes = show_diff(fixture_path, latest)

        if has_changes:
            updates.append((latest, fixture_path))

    if not updates:
        print("\n" + "-" * 60)
        print("No updates needed.")
        return

    print("\n" + "-" * 60)
    print(f"Files to update: {len(updates)}")

    if not force:
        response = input("\nProceed with update? [y/N] ")
        if response.lower() != "y":
            print("Aborted.")
            return

    # Perform updates
    for src, dst in updates:
        shutil.copy2(src, dst)
        print(f"  Updated: {dst.name}")

    print(f"\nUpdated {len(updates)} fixture(s).")


def main() -> int:
    """Main entry point for fixture management CLI."""
    parser = argparse.ArgumentParser(
        description="Manage test fixtures for HTML notifications parser",
    )
    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # list command
    subparsers.add_parser("list", help="List available response files")

    # update command
    update_parser = subparsers.add_parser(
        "update", help="Update fixtures from responses"
    )
    update_parser.add_argument(
        "--force", "-f", action="store_true", help="Skip confirmation prompt"
    )

    args = parser.parse_args()

    if args.command == "list":
        list_responses()
    elif args.command == "update":
        update_fixtures(force=args.force)
    else:
        parser.print_help()
        return 1

    return 0


if __name__ == "__main__":
    sys.exit(main())

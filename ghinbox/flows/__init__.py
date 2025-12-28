"""
Test flows for GitHub notification behavior verification.

Each flow tests a specific aspect of GitHub's notification system.
"""

from ghinbox.flows.basic_notification import BasicNotificationFlow
from ghinbox.flows.comment_fetch_marks_read import CommentFetchMarksReadFlow
from ghinbox.flows.comment_prefetch_validation import CommentPrefetchValidationFlow
from ghinbox.flows.notification_timestamps import NotificationTimestampsFlow
from ghinbox.flows.pagination import PaginationFlow
from ghinbox.flows.parser_validation import ParserValidationFlow
from ghinbox.flows.prod_notifications_snapshot import ProdNotificationsSnapshotFlow
from ghinbox.flows.read_vs_done import ReadVsDoneFlow

__all__ = [
    "BasicNotificationFlow",
    "CommentFetchMarksReadFlow",
    "CommentPrefetchValidationFlow",
    "NotificationTimestampsFlow",
    "PaginationFlow",
    "ParserValidationFlow",
    "ProdNotificationsSnapshotFlow",
    "ReadVsDoneFlow",
]

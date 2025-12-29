"""
Test flows for GitHub notification behavior verification.

Each flow tests a specific aspect of GitHub's notification system.
"""

from ghinbox.flows.anchor_tracking import AnchorTrackingFlow
from ghinbox.flows.basic_notification import BasicNotificationFlow
from ghinbox.flows.comment_fetch_marks_read import CommentFetchMarksReadFlow
from ghinbox.flows.comment_prefetch_validation import CommentPrefetchValidationFlow
from ghinbox.flows.done_then_close import DoneThenCloseFlow
from ghinbox.flows.notification_timestamps import NotificationTimestampsFlow
from ghinbox.flows.pagination import PaginationFlow
from ghinbox.flows.parser_validation import ParserValidationFlow
from ghinbox.flows.prod_notifications_snapshot import ProdNotificationsSnapshotFlow
from ghinbox.flows.prod_undo import ProdUndoFlow
from ghinbox.flows.read_vs_done import ReadVsDoneFlow

__all__ = [
    "AnchorTrackingFlow",
    "BasicNotificationFlow",
    "CommentFetchMarksReadFlow",
    "CommentPrefetchValidationFlow",
    "DoneThenCloseFlow",
    "NotificationTimestampsFlow",
    "PaginationFlow",
    "ParserValidationFlow",
    "ProdNotificationsSnapshotFlow",
    "ProdUndoFlow",
    "ReadVsDoneFlow",
]

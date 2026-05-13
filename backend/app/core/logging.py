"""Logging configuration.

Keeps stdlib logging for library compatibility but applies a consistent format.
In production you'll likely want to pipe stdout to a file or log collector.
"""

import logging
import sys

from app.core.config import get_settings


def configure_logging() -> None:
    settings = get_settings()
    root = logging.getLogger()
    root.setLevel(settings.log_level)

    # Remove uvicorn's default handlers so we don't double-log
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).handlers.clear()
        logging.getLogger(name).propagate = True

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(
            "%(asctime)s %(levelname)-7s %(name)s | %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )

    # Clear pre-existing root handlers (e.g. from reloader) before attaching
    root.handlers.clear()
    root.addHandler(handler)

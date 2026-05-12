from __future__ import annotations

import logging
import sys
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

DEFAULT_LOG_DIR = "logs"
DEFAULT_LOG_FILE = "openoii.log"
DEFAULT_LOG_FORMAT = (
    "%(asctime)s %(levelname)s [%(name)s] "
    "%(filename)s:%(lineno)d - %(message)s"
)
DEFAULT_DATE_FORMAT = "%Y-%m-%d %H:%M:%S"
MANAGED_HANDLER_ATTR = "_openoii_managed_handler"


def configure_logging(settings: Any) -> None:
    """Configure application logging for console and rotating file output."""
    log_level = _normalize_level(getattr(settings, "log_level", "INFO"))
    log_dir = Path(getattr(settings, "log_dir", DEFAULT_LOG_DIR))
    log_file = getattr(settings, "log_file", DEFAULT_LOG_FILE)
    max_bytes = int(getattr(settings, "log_max_bytes", 10 * 1024 * 1024))
    backup_count = int(getattr(settings, "log_backup_count", 5))
    log_to_file = bool(getattr(settings, "log_to_file", True))

    formatter = logging.Formatter(DEFAULT_LOG_FORMAT, datefmt=DEFAULT_DATE_FORMAT)

    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)
    _remove_managed_handlers(root_logger)
    root_logger.addHandler(_build_stream_handler(log_level, formatter))

    if log_to_file:
        root_logger.addHandler(
            _build_file_handler(
                log_dir=log_dir,
                log_file=log_file,
                max_bytes=max_bytes,
                backup_count=backup_count,
                level=log_level,
                formatter=formatter,
            )
        )

    for logger_name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logger = logging.getLogger(logger_name)
        logger.setLevel(log_level)
        _remove_managed_handlers(logger)
        logger.propagate = True


def _normalize_level(value: str) -> int:
    level = getattr(logging, value.upper(), None)
    if isinstance(level, int):
        return level
    return logging.INFO


def _build_stream_handler(level: int, formatter: logging.Formatter) -> logging.Handler:
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)
    handler.setFormatter(formatter)
    setattr(handler, MANAGED_HANDLER_ATTR, True)
    return handler


def _build_file_handler(
    *,
    log_dir: Path,
    log_file: str,
    max_bytes: int,
    backup_count: int,
    level: int,
    formatter: logging.Formatter,
) -> logging.Handler:
    log_dir.mkdir(parents=True, exist_ok=True)
    handler = RotatingFileHandler(
        log_dir / log_file,
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8",
    )
    handler.setLevel(level)
    handler.setFormatter(formatter)
    setattr(handler, MANAGED_HANDLER_ATTR, True)
    return handler


def _remove_managed_handlers(logger: logging.Logger) -> None:
    for handler in list(logger.handlers):
        if not getattr(handler, MANAGED_HANDLER_ATTR, False):
            continue
        logger.removeHandler(handler)
        handler.close()

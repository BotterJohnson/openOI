from __future__ import annotations

import logging
from pathlib import Path
from types import SimpleNamespace

from app.logging_config import configure_logging


def test_configure_logging_writes_rotating_file(tmp_path: Path) -> None:
    settings = SimpleNamespace(
        log_level="INFO",
        log_to_file=True,
        log_dir=str(tmp_path),
        log_file="app.log",
        log_max_bytes=1024 * 1024,
        log_backup_count=1,
    )

    configure_logging(settings)
    logger = logging.getLogger("tests.logging")
    logger.error("request failed", extra={"path": "/x", "method": "GET"})

    for handler in logging.getLogger().handlers:
        handler.flush()

    log_content = (tmp_path / "app.log").read_text(encoding="utf-8")
    assert "ERROR [tests.logging]" in log_content
    assert "request failed" in log_content


def test_configure_logging_replaces_existing_handlers(tmp_path: Path) -> None:
    settings = SimpleNamespace(
        log_level="INFO",
        log_to_file=True,
        log_dir=str(tmp_path),
        log_file="app.log",
        log_max_bytes=1024 * 1024,
        log_backup_count=1,
    )

    configure_logging(settings)
    configure_logging(settings)

    managed_handlers = [
        handler
        for handler in logging.getLogger().handlers
        if getattr(handler, "_openoii_managed_handler", False)
    ]
    assert len(managed_handlers) == 2

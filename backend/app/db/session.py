from __future__ import annotations

from collections.abc import AsyncGenerator
import os
from pathlib import Path
import subprocess
import sys

from sqlalchemy import func, update
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlmodel import SQLModel

from app.config import get_settings
from app.models import agent_run, artifact, config_item, message, project, run, stage  # noqa: F401
from app.orchestration.persistence import ensure_postgres_checkpointer_setup

ALEMBIC_INI = Path(__file__).resolve().parents[2] / "alembic.ini"
ALEMBIC_DIR = Path(__file__).resolve().parents[2] / "alembic"


def _build_engine() -> AsyncEngine:
    settings = get_settings()
    return create_async_engine(settings.database_url, echo=settings.db_echo, pool_pre_ping=True)


engine: AsyncEngine = _build_engine()
async_session_maker: async_sessionmaker[AsyncSession] = async_sessionmaker(
    engine, class_=AsyncSession, expire_on_commit=False
)


def _run_alembic_upgrade() -> None:
    settings = get_settings()
    env = os.environ.copy()
    env["DATABASE_URL"] = settings.database_url.replace("+asyncpg", "+psycopg2")
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=str(ALEMBIC_INI.parent),
        capture_output=True,
        text=True,
        timeout=30,
        env=env,
    )
    if result.returncode != 0:
        raise RuntimeError(f"alembic upgrade failed: {result.stderr}")


async def _ensure_metadata_tables() -> None:
    async with engine.begin() as conn:
        await conn.run_sync(SQLModel.metadata.create_all)


async def init_db() -> None:
    """Initialize database tables and cleanup stale runs."""
    import logging
    log = logging.getLogger("openOii.init_db")
    settings = get_settings()
    agent_run_table = SQLModel.metadata.tables["agentrun"]
    project_table = SQLModel.metadata.tables["project"]

    try:
        _run_alembic_upgrade()
        log.info("init_db: alembic upgrade done")
    except Exception as e:
        log.exception("init_db: alembic upgrade failed")
        raise RuntimeError("Database migration failed") from e

    await _ensure_metadata_tables()

    log.info("init_db: starting DB session cleanup")
    async with async_session_maker() as session:
        from app.services.config_service import ConfigService
        from app.models.agent_run import AgentRun
        from app.models.project import Project

        config_service = ConfigService(session)
        await config_service.ensure_initialized()
        await config_service.apply_settings_overrides()

        await session.execute(
            update(AgentRun)
            .where(agent_run_table.c.status.in_(["queued", "running"]))
            .values(status="cancelled", error="Service restarted")
        )

        await session.execute(
            update(Project)
            .where((project_table.c.style.is_(None)) | (func.trim(project_table.c.style) == ""))
            .values(style="anime")
        )
        await session.commit()

    await ensure_postgres_checkpointer_setup(settings.database_url)


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_maker() as session:
        yield session

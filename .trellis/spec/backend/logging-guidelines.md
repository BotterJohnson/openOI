# Logging Guidelines

> Structured logging conventions for the backend.

---

## Setup

Every module that logs declares its own module-scoped logger:

```python
import logging

logger = logging.getLogger(__name__)
```

Do not import a shared `logger` from another module. Each `__name__` becomes the channel — that's the value that ends up in log filters and grep.

The root logger is configured centrally by `app.logging_config.configure_logging()` during `create_app()`. It installs console output plus a rotating file handler by default. Uvicorn loggers propagate into the same handlers so API, WS, startup, and server logs land in one place.

Settings:

- `LOG_LEVEL` controls the root level and defaults to `INFO`.
- `LOG_TO_FILE=true` enables rotating file output.
- `LOG_DIR=logs` and `LOG_FILE=openoii.log` write to `backend/logs/openoii.log` when running from `backend/`.
- `LOG_MAX_BYTES` and `LOG_BACKUP_COUNT` control rotation.

Do not call `logging.basicConfig()` or attach ad-hoc file handlers from feature modules. Add new logging behavior to `app.logging_config` instead.

---

## Levels

| Level | Use for | Example |
|---|---|---|
| `DEBUG` | Verbose tracing, only useful during local development. | `logger.debug("Full URL: %s", url)` |
| `INFO` | Successful state transitions and durable side effects (file saved, task started, run completed). | `logger.info("Doubao video task created: %s", task_id)` |
| `WARNING` | Recoverable problem; degraded behavior; suspicious input. | `logger.warning("Path traversal attempt detected: %s", url)` |
| `ERROR` | Operation failed but the process continues. | `logger.error("Failed to save feedback for run %s: %s", run_id, e)` |
| `EXCEPTION` (`logger.exception`) | Unexpected exception with traceback. | `logger.exception("Unhandled exception", extra={...})` |

Rules:

- Production noise budget is at `INFO` — don't log at `INFO` in tight loops.
- `DEBUG` is acceptable in inner loops; it must be off by default.
- Reserve `ERROR` for things that need attention. If it's expected (e.g., a 404 on lookup), don't log at `ERROR`.

---

## Format

Two patterns coexist in the codebase. The codebase tolerates both, but new code should prefer **percent-style** for the reasons below.

### Preferred: percent-style with positional args

```python
logger.info("Inlining local image for Doubao request: %s", local_path)
logger.warning("Failed to delete file %s: %s", path, e)
```

Reasons:

- The string is not formatted unless the level is enabled, saving CPU when `DEBUG` is off.
- Aggregators / log shippers can group by template.

### Acceptable: f-strings (legacy / brevity)

```python
logger.info(f"Doubao video task created: {task_id}")
```

Used heavily in older modules (`services/doubao_video.py`, `services/image.py`). Don't bulk-rewrite, but don't introduce more if a percent-form is equally readable.

### Forbidden

- `logger.info("done " + str(value))` — concatenation defeats lazy formatting and adds nothing over f-strings.
- `print(...)` — never. Use a logger.

---

## Structured Context (`extra=`)

Use `extra={...}` for fields you want a log aggregator to index. The global exception handler in `app/main.py` does this:

```python
logger.error(
    "AppException: %s",
    exc.message,
    extra={
        "error_code": exc.code,
        "status_code": exc.status_code,
        "details": exc.details,
        "path": str(request.url.path),
        "method": request.method,
    },
)
```

Convention:

- Keys are `snake_case`.
- Reuse keys across the codebase: `project_id`, `run_id`, `shot_id`, `error_code`, `status_code`, `path`, `method`, `task_id`, `provider`.
- Don't put large blobs (full prompts, images, base64) in `extra` — truncate or reference by id.

---

## Tracebacks

Two ways to attach a traceback:

```python
logger.exception("Unexpected failure")              # Preferred at top-level handlers
logger.error("WebSocket message error: %s", e, exc_info=True)  # Existing pattern in main.py
```

`logger.exception()` only works inside an `except` block. `exc_info=True` works anywhere there is a current exception.

---

## What to Log

### Always

- Service start / completion of long-running tasks (image gen, video gen, run start).
- External provider request milestones (sent, received, status code on failure).
- Skipped work and why (`logger.debug("Not a local file, skipping: %s", url)`).
- Recovery decisions (`logger.warning("Failed to cache external image, using original URL: %s", exc)`).

### Never

- Full secrets, API keys, auth headers, or `Authorization` values.
- User passwords or full tokens. If a token is essential, log only the last 4 chars.
- The full body of an LLM prompt (use the first 50–100 chars or a hash).
- Per-row info inside a tight bulk loop.

---

## WebSocket Logging

WS logging is event-flow logging — it traces the full lifecycle:

```python
logger.info("WebSocket disconnected for project %s", project_id)
logger.error("WebSocket message error: %s", e, exc_info=True)
logger.error("WebSocket connection error: %s", e, exc_info=True)
```

Use the project id and (when available) run id as positional args / `extra` so cross-referencing with the run table is easy.

---

## In Tests

- Don't assert on log lines for behavior — assert on observable state (DB rows, response bodies, stub call args).
- If you must assert, use `caplog` (pytest fixture) and match by `record.message` or `record.levelname`, not full formatted text.

---

## Common Mistakes

1. **Using `logger.error(str(e))` and re-raising** — loses the traceback. Use `logger.exception` or `exc_info=True`.
2. **Logging an exception twice** — once in a service, again at the global handler. Pick one (usually let the global handler do it).
3. **`logger.info` inside a `for` over many rows** — produces O(n) log lines. Aggregate to a single summary line: `"Cleaned %d files"`.
4. **Embedding base64 / image bytes in a log call** — bloats log files; sanitize first.
5. **Leaking `Authorization` / `X-Admin-Token` headers in debug logs**.

---

## Examples

- Per-module logger pattern: any file under `app/services/`, e.g. `app/services/doubao_video.py:20`.
- Logging setup: `app/logging_config.py`.
- Structured context with `extra=`: `app/main.py` exception handlers.
- Lifecycle logs (start / progress / done / fail): `app/services/doubao_video.py` task creation flow.
- Path-traversal warning pattern: `app/services/file_cleaner.py:51`.

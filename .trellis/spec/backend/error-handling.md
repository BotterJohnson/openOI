# Error Handling

> Error types, handling strategies, and HTTP error responses.

---

## Overview

The backend has two parallel error mechanisms:

1. **`AppException` hierarchy** (`app/exceptions.py`) — used by services and the orchestration/agent layers. Mapped to a consistent JSON envelope by the global handler in `app/main.py`.
2. **`HTTPException`** (FastAPI built-in) — used directly inside API route handlers for simple `404 Not Found`-style branches.

Both are valid in this codebase, but they have different roles. Don't mix them inside one layer.

---

## The `AppException` Hierarchy

Defined in `app/exceptions.py`:

| Class | HTTP | Code | Use for |
|-------|------|------|---------|
| `AppException` | 500 | `APP_ERROR` | Base; do not raise directly. |
| `ValidationError` | 400 | `VALIDATION_ERROR` | Input failed semantic validation that pydantic can't express. |
| `NotFoundError(resource, resource_id)` | 404 | `NOT_FOUND` | Resource lookup miss inside a service. |
| `PermissionError` | 403 | `PERMISSION_DENIED` | Access denied. |
| `ConflictError` | 409 | `CONFLICT` | Concurrent / duplicate / state-conflict. |
| `BusinessError` | 422 | `BUSINESS_ERROR` (overridable) | Business rule violation. |

Every `AppException` carries: `message`, `code`, `status_code`, `details: dict`. The global handler turns it into:

```json
{
  "error": {
    "code": "<code>",
    "message": "<message>",
    "details": {...}
  }
}
```

---

## When to Use Which

### Inside services (`app/services/*`) and orchestration (`app/orchestration/*`, `app/agents/*`)

**Always raise `AppException` subclasses**, never `HTTPException`. Services don't know they're being called from HTTP.

```python
from app.exceptions import BusinessError, NotFoundError

async def do_something(session: AsyncSession, project_id: int) -> None:
    project = await session.get(Project, project_id)
    if not project:
        raise NotFoundError("Project", project_id)

    if project.status == "running":
        raise BusinessError(
            "Project already running",
            code="PROJECT_RUNNING",
            details={"project_id": project_id, "status": project.status},
        )
```

### Inside routes (`app/api/v1/routes/*`)

Two acceptable patterns, used in different situations:

**Pattern A — Direct `HTTPException` for trivial 404/409 in handler logic** (this is the dominant pattern in the codebase, e.g., `projects.py`, `characters.py`, `generation.py`):

```python
from fastapi import HTTPException

@router.get("/{project_id}")
async def get_project(project_id: int, session: AsyncSession = SessionDep):
    project = await session.get(Project, project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    ...
```

**Pattern B — Re-raise from services as-is**: when calling a service that raises `AppException`, do nothing. The global handler turns it into a JSON response automatically.

```python
@router.delete("/{project_id}", status_code=204)
async def delete_project(project_id: int, session: AsyncSession = SessionDep):
    await delete_project_by_id(session, project_id)  # may raise NotFoundError → 404
    return None
```

**Mixing inside one route is fine** — see `app/api/v1/routes/generation.py` which uses both `HTTPException(404)` and `raise BusinessError(...)`.

---

## Global Exception Handlers

Registered in `app/main.py:create_app()`:

- `HTTPException` / framework 404s → logged at `WARNING` for 4xx and `ERROR` for 5xx with `{status_code, path, method}` extras → returns FastAPI-compatible `{"detail": ...}` response bodies.
- `RequestValidationError` → logged at `WARNING` with `{status_code, path, method, details}` extras → returns FastAPI-compatible `422 {"detail": [...]}` response bodies.
- `AppException` → logged at `ERROR` level with `{code, status_code, details, path, method}` extras → returns the JSON envelope.
- bare `Exception` → logged at `EXCEPTION` level (full traceback) → returns `500 INTERNAL_ERROR`. In `environment="development"` the response body includes `details.error = str(exc)`; in other environments details are stripped.

This means:

- **Don't wrap unknown errors in your own try/except just to log them** — let them bubble. The global handler logs and produces a clean response.
- **Do wrap errors when you want to translate them** into a domain-meaningful `AppException` (e.g., catch a low-level `httpx.HTTPError` from a provider call and re-raise as `BusinessError`).

---

## Try / Except Discipline

### Required

- Catch only the specific exception types you handle.
- Always log the original error before transforming it.
- Use `logger.exception(...)` (not `logger.error(str(e))`) when you want the traceback.

### Forbidden

- `except:` (bare).
- `except Exception: pass` (silent swallow). The only exception in the codebase is the WebSocket "client already disconnected, ignore final send error" case in `app/main.py` — and even there it's narrowly scoped.
- `except Exception as e: raise HTTPException(500, str(e))` — leaks internals; let the global handler do it.

### Acceptable

```python
try:
    result = await provider.generate(...)
except httpx.HTTPError as exc:
    logger.warning("Provider call failed: %s", exc)
    raise BusinessError(
        "图像生成失败",
        code="IMAGE_PROVIDER_FAILED",
        details={"provider": provider.name},
    ) from exc
```

Always preserve the chain with `from exc` when re-raising.

---

## WebSocket Errors

The WS endpoint in `app/main.py` does its own error envelope (does **not** go through the global handler). Errors are sent as messages, not HTTP responses:

```python
await ws_manager.send_event(
    project_id,
    {
        "type": "error",
        "data": {
            "code": "WS_INVALID_RUN",
            "message": "无效的 run_id 或不属于当前项目",
        },
    },
)
```

WS error codes used today: `WS_INVALID_RUN`, `WS_SAVE_ERROR`, `WS_MESSAGE_ERROR`, `WS_CONNECTION_ERROR`. Add new `WS_*` codes if you handle a new failure mode in a WS branch.

---

## Validation

Prefer **pydantic** validation in `app/schemas/*` over manual checks. Only raise `ValidationError` for cross-field semantic rules pydantic can't express.

```python
# Bad - reinventing pydantic
if not isinstance(payload.title, str) or not payload.title:
    raise ValidationError("title required")

# Good - let pydantic enforce, only handle semantic rules
class ProjectCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
```

---

## Common Mistakes to Avoid

1. **Raising `HTTPException` from a service**. The service then can only be called from HTTP contexts; orchestration / WS / background tasks break.
2. **Returning errors instead of raising them** (`return {"error": ...}`). Always raise; the handler will format.
3. **Silent `try/except` around `await session.commit()`**. Hides DB constraint violations.
4. **Using `details=` for sensitive data** (API keys, full tokens). The detail dict goes into the response body and the log.
5. **Logging then re-raising the same exception** in a route — the global handler already logs it; double logs make tracing harder.

---

## Examples

- Custom exception classes: `app/exceptions.py`.
- Global handlers + dev-mode detail leak: `app/main.py:create_app`.
- Service raising `BusinessError`: `app/api/v1/routes/generation.py:start_generation` (line ~125).
- Route mixing `HTTPException` + `BusinessError`: `app/api/v1/routes/generation.py`.
- WS error envelope: `app/main.py` `WS_*` blocks.

# AGENTS.md

## 先看这个
- openOii 是“故事想法 → 漫剧成片”的长链路生成应用；改动生成、恢复、进度推送时，优先保 resumability 和现有执行流。
- 这是双包仓库，没有根级统一脚本：后端在 `backend/` 用 `uv`，前端在 `frontend/` 用 `pnpm`。
- 当前 GitHub Actions 只有镜像构建/推送：`.github/workflows/docker-publish.yml`。本地要自己跑测试/构建，CI 不会替你兜底。

## 关键入口
- 后端 FastAPI 入口：`backend/app/main.py`。
- API 聚合：`backend/app/api/v1/router.py`，默认前缀 `/api/v1`。
- 生成链路 HTTP 入口：`backend/app/api/v1/routes/generation.py`（`/{project_id}/generate|resume|cancel|feedback`）。
- 真正的编排/持久化逻辑在 `backend/app/orchestration/`；API 层主要负责建 run、起后台任务、回传控制面。
- WebSocket 入口：`/ws/projects/{project_id}`。
- 前端入口：`frontend/app/main.tsx`；路由在 `frontend/app/App.tsx`。

## 开发命令

### 后端
```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 18765
uv run pytest
uv run pytest tests/test_api/test_generation.py -q
uv run ruff check app tests
```

### 前端
```bash
cd frontend
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm exec vitest run app/pages/ProjectPage.test.tsx
pnpm exec tsc --noEmit
pnpm e2e
pnpm e2e:install
```

### Docker
```bash
cp backend/.env.example backend/.env
docker-compose up -d
docker-compose -f docker-compose.dev.yml up -d
docker-compose logs -f backend
docker-compose down
```

## 验证习惯
- 前端改动：先跑相关 `vitest`，再跑 `pnpm build`（这里已经包含 `tsc`）。
- 后端改动：先跑相关 `pytest`，再按需要跑全量 `uv run pytest`。
- 改依赖时同步更新锁文件：`backend/uv.lock`、`frontend/pnpm-lock.yaml`。
- E2E 配置在 `frontend/playwright.config.ts`；它只会自动起前端 `pnpm dev`。测试要打真实 API 时，后端要自己另起。

## 易错点
- `frontend/app/utils/runtimeBase.ts` 会在开发环境按当前页面 hostname 自动推导后端 `18765` 端口，并自动对齐 `localhost`/`127.0.0.1`。默认通常不需要写 `frontend/.env.local`；只有后端不在默认地址时再配 `VITE_API_URL` / `VITE_WS_URL`。
- `frontend/app/main.tsx` 里的 MSW 默认关闭；只有 `VITE_ENABLE_MSW=true` 才会启用 mock worker。
- `backend/app/config.py` 里测试与运行时的配置读取路径不同：测试里直接 `Settings()` 不会自动读仓库 `.env`，运行时走 `get_settings()` 才会加载 `.env`。
- `backend/app/db/session.py:init_db()` 启动时会 `create_all()`、初始化配置、把遗留 `queued/running` run 标成 `cancelled`，并调用 `ensure_postgres_checkpointer_setup()`。改模型/持久化时要同时考虑启动初始化和 Alembic。
- Alembic 版本文件在 `backend/alembic/versions/`，但 `backend/alembic.ini` 默认指向本地 SQLite；跑迁移前先确认 `DATABASE_URL`/环境变量覆盖正确。
- 生成/恢复/取消流程同时依赖数据库状态、Redis confirm 信号和进程内 `task_manager`；不要把当前实现当成天然多实例安全。
- Docker 场景下，若图像/视频服务跑在宿主机，`backend/.env` 里不能继续用 `localhost`；按 README 改成 `host.docker.internal` 或宿主机 IP。
- 静态媒体输出在 `backend/app/static`，Compose 也把这个目录挂出来；改导出/拼接逻辑时不要忽略它。
- `backend/Dockerfile` 会执行 `uv sync --frozen --no-dev --extra agents`；改后端依赖后记得更新 `uv.lock`，并注意运行时会带上 `agents` 可选依赖。

## 测试分布
- 后端测试在 `backend/tests/`，重点是 `test_api/`、`test_orchestration/`、`test_services/`、`test_agents/`，另有 `test_migrations.py` 和 `integration/`。
- 前端单测与组件同目录；E2E 在 `frontend/tests/e2e/`。
- <!-- TRELLIS:START -->

## 更改历史

- 在你不知道当前项目背景的前提下，请先参review文件下的更改历史

# Trellis Instructions

These instructions are for AI assistants working in this project.

Use the `/trellis:start` command when starting a new session to:
- Initialize your developer identity
- Understand current project context
- Read relevant guidelines

Use `@/.trellis/` to learn:
- Development workflow (`workflow.md`)
- Project structure guidelines (`spec/`)
- Developer workspace (`workspace/`)

If you're using Codex, project-scoped helpers may also live in:
- `.agents/skills/` for reusable Trellis skills
- `.codex/agents/` for optional custom subagents

Keep this managed block so 'trellis update' can refresh the instructions.

<!-- TRELLIS:END -->

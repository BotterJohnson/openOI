# 2026-05-12 文本链路进度改动记录

## 记录范围

本记录只覆盖本次已经确认落地的“第一期文本生成链路进度可视化”相关改动，不包含仓库里其他同时存在但未在本轮核实归属的修改。

## 本次主要改了什么

### 1. 后端增加了文本阶段生命周期

为第一期文本链路补齐了 8 个可追踪的文本阶段：

1. `text_intake` 题材理解
2. `text_story_outline` 故事大纲
3. `text_chapter_flow` 章节剧情流程
4. `text_arrangement` 编排过程
5. `text_chapter_prose` 故事正文
6. `text_storyboard` 分镜脚本
7. `text_video_prompts` 视频提示词
8. `text_consistency_review` 一致性检查

落地内容：

- 在 `PlanAgent` 内预先 seed 全部文本阶段，初始状态为 `pending`
- 文本生成开始后，当前阶段会切到 `running`
- 阶段完成后会落库为 `completed`
- 缺失关键内容时会标记为 `needs_review`
- 调用失败或持久化失败时会标记为 `failed`
- 后端增加日志，能看到卡在哪个文本阶段

### 2. 后端增加了文本阶段 WebSocket 事件

新增以下事件类型：

- `text_stage_started`
- `text_stage_updated`
- `text_stage_completed`
- `text_stage_failed`

这样前端不需要等整轮任务结束，能够实时接收阶段状态变化。

### 3. 后端增加了文本阶段查询接口

新增接口：

- `GET /api/v1/projects/{project_id}/text-stages`

这个接口现在支持返回：

- 已完成且有产物的文本阶段
- 还在 `pending` / `running` 但尚未产出 artifact 的文本阶段

意义是页面刷新后仍能恢复当前文本阶段状态，不会丢失进度。

### 4. 前端增加了文本工作台和阶段面板

项目页新增了“文本生成工作台”，包含：

- `开始生成`
- `下一步`
- `打开对话`
- 运行中时的 `停止`

同时新增 `TextStagePanel`，用于展示：

- 当前正在执行的子目标
- 已完成数量
- 每个文本阶段当前状态：`等待中 / 进行中 / 已完成 / 需复核 / 失败`
- 每个阶段的简要预览内容

### 5. 前端接入文本阶段实时状态同步

前端 WebSocket 已接入文本阶段生命周期事件，收到事件后会直接更新 store 中的 `textStages`。

这样用户在页面上可以直接看到：

- 当前卡在哪个子目标
- 哪些步骤已经完成
- 哪个步骤失败

### 6. 启动生成与阶段推进的交互补齐

本次顺手补了项目页工作流操作：

- 文本生成从 `plan` 阶段显式启动
- 点击 `下一步` 时，会按当前阶段推进到 `render` 或 `compose`
- 新一轮开始前会清空旧的 `textStages`

## 涉及文件

### 后端

- `backend/app/agents/plan.py`
- `backend/app/api/v1/routes/projects.py`
- `backend/app/schemas/ws.py`
- `backend/app/ws/manager.py`

### 前端

- `frontend/app/components/project/TextStagePanel.tsx`
- `frontend/app/hooks/useWebSocket.ts`
- `frontend/app/pages/ProjectPage.tsx`
- `frontend/app/types/index.ts`

### 测试

- `backend/tests/test_agents/test_plan.py`
- `backend/tests/test_api/test_projects.py`
- `frontend/app/hooks/useWebSocket.test.ts`
- `frontend/app/pages/ProjectPage.test.tsx`

## 已验证结果

已跑通的验证：

- 后端：`uv run pytest tests/test_api/test_projects.py tests/test_agents/test_plan.py -q`
- 前端：`pnpm exec vitest run app/hooks/useWebSocket.test.ts app/pages/ProjectPage.test.tsx`
- 前端构建：`pnpm build`

已确认通过：

- 文本阶段会被写入并持久化
- WebSocket 会推送文本阶段实时状态
- 前端会显示当前子目标和阶段进度
- 页面刷新后可通过 `/text-stages` 恢复阶段状态

## 当前已知点

1. `text_intake` 当前会出现两次 completed 事件
   - 一次来自实时 intake 完成
   - 一次来自统一持久化阶段
   - 目前测试已接受这个行为，但后续可去重

2. 这次改动的重点是“文本链路进度透明化”
   - 没有把 8 个文本阶段拆成 8 次独立 LLM 调用
   - 仍保持现有编排流，优先保 resumability 和当前执行模型

3. 还需要真实联调确认
   - 浏览器里实际生成时的进度展示
   - 后端日志中的阶段推进输出
   - 长时间运行时的卡顿提示体验

## 结论

这次改动已经补齐了第一期文本生成阶段最核心的一块：用户现在能看到“当前子目标是什么、是否在运行、卡在哪一步、哪些步骤已经完成”，后台也有对应阶段日志和状态落库，前后端链路已经接上。

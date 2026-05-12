from __future__ import annotations

import json
import logging
from typing import Any

from sqlalchemy import select

from app.agents.base import AgentContext, BaseAgent, CompletionInfo
from app.agents.prompts.plan import SYSTEM_PROMPT
from app.agents.utils import extract_json
from app.db.utils import utcnow
from app.models.artifact import Artifact
from app.models.project import Character, Shot
from app.models.run import Run
from app.models.stage import Stage

logger = logging.getLogger(__name__)

TEXT_STAGE_SPECS: tuple[tuple[str, str], ...] = (
    ("text_intake", "题材理解"),
    ("text_story_outline", "故事大纲"),
    ("text_chapter_flow", "章节剧情流程"),
    ("text_arrangement", "编排过程"),
    ("text_chapter_prose", "故事正文"),
    ("text_storyboard", "分镜脚本"),
    ("text_video_prompts", "视频提示词"),
    ("text_consistency_review", "一致性检查"),
)

TEXT_STAGE_DISPLAY_NAMES: dict[str, str] = dict(TEXT_STAGE_SPECS)


def _character_to_description(item: dict) -> str:
    parts: list[str] = []
    for key in ["personality_traits", "goals", "fears", "voice_notes", "costume_notes"]:
        value = item.get(key)
        if isinstance(value, str) and value.strip():
            parts.append(f"{key}: {value.strip()}")
        elif isinstance(value, list):
            vals = [v for v in value if isinstance(v, str) and v.strip()]
            if vals:
                parts.append(f"{key}: {', '.join(vals)}")

    description = item.get("description")
    if isinstance(description, str) and description.strip():
        parts.insert(0, description.strip())

    return "\n".join(parts) if parts else json.dumps(item, ensure_ascii=False)


def _compose_image_prompt(shot_data: dict, visual_bible: str) -> str:
    if isinstance(shot_data.get("image_prompt"), str) and shot_data["image_prompt"].strip():
        return shot_data["image_prompt"].strip()

    parts = []
    scene = shot_data.get("scene")
    if isinstance(scene, str) and scene.strip():
        parts.append(scene.strip())
    action = shot_data.get("action")
    if isinstance(action, str) and action.strip():
        parts.append(action.strip())
    expression = shot_data.get("expression")
    if isinstance(expression, str) and expression.strip():
        parts.append(expression.strip())
    camera = shot_data.get("camera")
    if isinstance(camera, str) and camera.strip():
        parts.append(camera.strip())
    lighting = shot_data.get("lighting")
    if isinstance(lighting, str) and lighting.strip():
        parts.append(lighting.strip())

    if parts:
        composed = "，".join(parts)
        if visual_bible:
            composed = f"{composed}。{visual_bible}"
        return composed

    return shot_data.get("description", "")


def _compose_video_prompt(shot_data: dict) -> str:
    if isinstance(shot_data.get("video_prompt"), str) and shot_data["video_prompt"].strip():
        return shot_data["video_prompt"].strip()

    parts = []
    camera = shot_data.get("camera")
    if isinstance(camera, str) and camera.strip():
        parts.append(camera.strip())
    action = shot_data.get("action")
    if isinstance(action, str) and action.strip():
        parts.append(action.strip())

    if parts:
        return "，".join(parts)

    return shot_data.get("description", "")


def _chapter_data(data: dict[str, Any]) -> dict[str, Any]:
    chapter = data.get("chapter")
    return chapter if isinstance(chapter, dict) else {}


def _story_outline_data(data: dict[str, Any]) -> dict[str, Any]:
    outline = data.get("story_outline")
    if isinstance(outline, dict):
        return outline
    return {
        "premise": data.get("user_message") or "",
        "worldview": (data.get("story_breakdown") or {}).get("setting")
        if isinstance(data.get("story_breakdown"), dict)
        else None,
        "main_conflict": (data.get("story_breakdown") or {}).get("logline")
        if isinstance(data.get("story_breakdown"), dict)
        else None,
        "chapters": [],
    }


def _storyboard_from_shots(data: dict[str, Any]) -> list[dict[str, Any]]:
    raw_shots = data.get("shots") or []
    if not isinstance(raw_shots, list):
        return []
    storyboard: list[dict[str, Any]] = []
    for idx, shot in enumerate(raw_shots):
        if not isinstance(shot, dict):
            continue
        storyboard.append(
            {
                "order": shot.get("order") if isinstance(shot.get("order"), int) else idx + 1,
                "scene": shot.get("scene"),
                "beat": shot.get("description") or shot.get("action"),
                "camera": shot.get("camera"),
                "dialogue": shot.get("dialogue"),
            }
        )
    return storyboard


def _video_prompts_from_shots(data: dict[str, Any]) -> list[dict[str, Any]]:
    raw_shots = data.get("shots") or []
    if not isinstance(raw_shots, list):
        return []
    prompts: list[dict[str, Any]] = []
    for idx, shot in enumerate(raw_shots):
        if not isinstance(shot, dict):
            continue
        prompt = _compose_video_prompt(shot)
        if not prompt:
            continue
        prompts.append(
            {
                "order": shot.get("order") if isinstance(shot.get("order"), int) else idx + 1,
                "prompt": prompt,
                "negative_prompt": shot.get("negative_prompt"),
                "duration": shot.get("duration"),
            }
        )
    return prompts


class PlanAgent(BaseAgent):
    name = "plan"

    async def _ensure_lineage_run(self, ctx: AgentContext) -> Run:
        if ctx.project.id is None or ctx.run.id is None:
            raise RuntimeError("Project and agent run must be persisted before text stages")

        thread_id = ctx.run.thread_id or f"agent-run-{ctx.run.id}"
        res = await ctx.session.execute(select(Run).where(Run.thread_id == thread_id))
        run = res.scalars().first()
        if run is not None:
            if run.status != ctx.run.status:
                run.status = ctx.run.status
                run.updated_at = utcnow()
                ctx.session.add(run)
                await ctx.session.flush()
            return run

        run = Run(
            project_id=ctx.project.id,
            thread_id=thread_id,
            status=ctx.run.status,
            source="agentrun",
        )
        ctx.session.add(run)
        await ctx.session.flush()
        return run

    def _build_text_stage_payloads(self, ctx: AgentContext, data: dict[str, Any]) -> dict[str, Any]:
        chapter = _chapter_data(data)
        story_outline = _story_outline_data(data)
        story_breakdown = (
            data.get("story_breakdown") if isinstance(data.get("story_breakdown"), dict) else {}
        )

        storyboard_script = chapter.get("storyboard_script")
        if not isinstance(storyboard_script, list) or not storyboard_script:
            storyboard_script = _storyboard_from_shots(data)

        video_prompts = chapter.get("video_prompts")
        if not isinstance(video_prompts, list) or not video_prompts:
            video_prompts = _video_prompts_from_shots(data)

        plot_flow = chapter.get("plot_flow")
        if not isinstance(plot_flow, list):
            plot_flow = []

        shots = data.get("shots") if isinstance(data.get("shots"), list) else []
        characters = data.get("characters") if isinstance(data.get("characters"), list) else []
        consistency_warnings: list[str] = []
        if shots and video_prompts and len(video_prompts) != len(shots):
            consistency_warnings.append("视频提示词数量与分镜数量不一致")
        if shots and storyboard_script and len(storyboard_script) != len(shots):
            consistency_warnings.append("分镜脚本数量与分镜数量不一致")

        return {
            "text_intake": {
                "title": "题材理解",
                "user_input": ctx.project.story or ctx.project.title,
                "genre": story_breakdown.get("genre") or [],
                "tone": story_breakdown.get("tone"),
                "logline": story_breakdown.get("logline"),
                "themes": story_breakdown.get("themes") or [],
            },
            "text_story_outline": {
                "title": "故事大纲",
                **story_outline,
            },
            "text_chapter_flow": {
                "title": chapter.get("title") or "第 1 章",
                "chapter_order": chapter.get("order") or 1,
                "plot_flow": plot_flow,
            },
            "text_arrangement": {
                "title": "编排过程",
                "arrangement": chapter.get("arrangement") or "",
            },
            "text_chapter_prose": {
                "title": chapter.get("title") or "第 1 章正文",
                "prose": chapter.get("prose") or "",
            },
            "text_storyboard": {
                "title": "分镜脚本",
                "storyboard_script": storyboard_script,
            },
            "text_video_prompts": {
                "title": "视频提示词",
                "video_prompts": video_prompts,
            },
            "text_consistency_review": {
                "title": "一致性检查",
                "status": "passed" if not consistency_warnings else "warning",
                "warnings": consistency_warnings,
                "character_count": len(characters),
                "shot_count": len(shots),
                "video_prompt_count": len(video_prompts),
            },
        }

    async def _emit_text_stage_event(
        self,
        ctx: AgentContext,
        *,
        event_type: str,
        stage: Stage,
        name: str,
        order: int,
        artifact: Artifact | None = None,
        content: dict[str, Any] | None = None,
    ) -> None:
        if ctx.project.id is None:
            raise RuntimeError("Project must be persisted before text stage events")

        await ctx.ws.send_event(
            ctx.project.id,
            {
                "type": event_type,
                "data": {
                    "run_id": ctx.run.id,
                    "project_id": ctx.project.id,
                    "stage": stage.name,
                    "name": name,
                    "status": stage.status,
                    "order": order,
                    "artifact_id": artifact.id if artifact and artifact.id is not None else 0,
                    "content": content,
                },
            },
        )

    async def _set_text_stage_status(
        self,
        ctx: AgentContext,
        stage: Stage,
        *,
        status: str,
        order: int,
        artifact: Artifact | None = None,
        content: dict[str, Any] | None = None,
        event_type: str = "text_stage_updated",
    ) -> None:
        stage.status = status
        stage.updated_at = utcnow()
        ctx.session.add(stage)
        await ctx.session.commit()
        await ctx.session.refresh(stage)
        await self._emit_text_stage_event(
            ctx,
            event_type=event_type,
            stage=stage,
            name=TEXT_STAGE_DISPLAY_NAMES.get(stage.name, stage.name),
            order=order,
            artifact=artifact,
            content=content,
        )

    async def _seed_text_stages(self, ctx: AgentContext) -> tuple[Run, dict[str, Stage]]:
        if ctx.project.id is None:
            raise RuntimeError("Project must be persisted before text stages")

        lineage_run = await self._ensure_lineage_run(ctx)
        if lineage_run.id is None:
            raise RuntimeError("Lineage run must be persisted before text stages")

        stage_map: dict[str, Stage] = {}
        for index, (stage_name, display_name) in enumerate(TEXT_STAGE_SPECS, start=1):
            stage = Stage(
                project_id=ctx.project.id,
                run_id=lineage_run.id,
                name=stage_name,
                status="pending",
                version=1,
                source="text_pipeline",
            )
            ctx.session.add(stage)
            await ctx.session.flush()
            stage_map[stage_name] = stage
            await self._emit_text_stage_event(
                ctx,
                event_type="text_stage_updated",
                stage=stage,
                name=display_name,
                order=index,
            )

        await ctx.session.commit()
        logger.info(
            "Seeded text stages for project_id=%s run_id=%s lineage_run_id=%s",
            ctx.project.id,
            ctx.run.id,
            lineage_run.id,
        )
        return lineage_run, stage_map

    async def _persist_text_stages(
        self,
        ctx: AgentContext,
        data: dict[str, Any],
        lineage_run: Run,
        stage_map: dict[str, Stage],
    ) -> None:
        payloads = self._build_text_stage_payloads(ctx, data)
        for index, (stage_name, display_name) in enumerate(TEXT_STAGE_SPECS, start=1):
            stage = stage_map[stage_name]
            payload = payloads.get(stage_name, {})
            status = "completed"
            if stage_name in {"text_chapter_prose", "text_storyboard", "text_video_prompts"}:
                empty = not any(
                    payload.get(key)
                    for key in ("prose", "storyboard_script", "video_prompts")
                    if isinstance(payload, dict)
                )
                if empty:
                    status = "needs_review"

            logger.info(
                "Persisting text stage=%s project_id=%s run_id=%s status=%s",
                stage_name,
                ctx.project.id,
                ctx.run.id,
                status,
            )
            artifact = Artifact(
                project_id=ctx.project.id,
                run_id=lineage_run.id,
                stage_id=stage.id,
                name=display_name,
                artifact_type="text",
                uri=f"db://artifact/{stage_name}",
                content=payload if isinstance(payload, dict) else {"value": payload},
                version=1,
                source="llm",
            )
            ctx.session.add(artifact)
            await ctx.session.commit()
            await ctx.session.refresh(artifact)
            await self._set_text_stage_status(
                ctx,
                stage,
                status=status,
                order=index,
                artifact=artifact,
                content=artifact.content,
                event_type="text_stage_completed",
            )

            if index < len(TEXT_STAGE_SPECS):
                next_name = TEXT_STAGE_SPECS[index][0]
                next_stage = stage_map[next_name]
                if next_stage.status == "pending":
                    logger.info(
                        "Starting next text stage=%s project_id=%s run_id=%s",
                        next_name,
                        ctx.project.id,
                        ctx.run.id,
                    )
                    await self._set_text_stage_status(
                        ctx,
                        next_stage,
                        status="running",
                        order=index + 1,
                        event_type="text_stage_started",
                    )

    async def _mark_text_stage_failed(
        self,
        ctx: AgentContext,
        stage_map: dict[str, Stage],
        stage_name: str,
        error_message: str,
    ) -> None:
        stage = stage_map.get(stage_name)
        if stage is None:
            return
        logger.error(
            "Text stage failed stage=%s project_id=%s run_id=%s error=%s",
            stage_name,
            ctx.project.id,
            ctx.run.id,
            error_message,
        )
        order = next(
            index for index, (name, _) in enumerate(TEXT_STAGE_SPECS, start=1) if name == stage_name
        )
        await self._set_text_stage_status(
            ctx,
            stage,
            status="failed",
            order=order,
            content={"error": error_message},
            event_type="text_stage_failed",
        )
        await ctx.session.commit()

    async def _get_existing_state(self, ctx: AgentContext) -> dict[str, Any]:
        char_res = await ctx.session.execute(
            select(Character).where(Character.project_id == ctx.project.id)
        )
        characters = [
            {"id": c.id, "name": c.name, "description": c.description}
            for c in char_res.scalars().all()
        ]

        shot_res = await ctx.session.execute(
            select(Shot).where(Shot.project_id == ctx.project.id).order_by(Shot.order)
        )
        shots = [
            {
                "id": s.id,
                "order": s.order,
                "description": s.description,
                "scene": s.scene,
                "action": s.action,
                "expression": s.expression,
                "camera": s.camera,
                "lighting": s.lighting,
                "dialogue": s.dialogue,
                "sfx": s.sfx,
            }
            for s in shot_res.scalars().all()
        ]

        return {"characters": characters, "shots": shots}

    async def _apply_incremental_changes(
        self, ctx: AgentContext, data: dict, visual_bible: str
    ) -> tuple[int, int]:
        preserve_ids = data.get("preserve_ids") or {}
        preserve_char_ids = set(preserve_ids.get("characters") or [])
        preserve_shot_ids = set(preserve_ids.get("shots") or [])

        char_res = await ctx.session.execute(
            select(Character).where(Character.project_id == ctx.project.id)
        )
        deleted_char_ids = []
        for char in char_res.scalars().all():
            if char.id not in preserve_char_ids:
                deleted_char_ids.append(char.id)
                await ctx.session.delete(char)

        deleted_shot_ids = []
        shot_res = await ctx.session.execute(select(Shot).where(Shot.project_id == ctx.project.id))
        for shot in shot_res.scalars().all():
            if shot.id not in preserve_shot_ids:
                deleted_shot_ids.append(shot.id)
                await ctx.session.delete(shot)

        await ctx.session.flush()

        for char_id in deleted_char_ids:
            await ctx.ws.send_event(
                ctx.project.id,
                {"type": "character_deleted", "data": {"character_id": char_id}},
            )
        for shot_id in deleted_shot_ids:
            await ctx.ws.send_event(
                ctx.project.id,
                {"type": "shot_deleted", "data": {"shot_id": shot_id}},
            )

        new_char_count = 0
        raw_characters = data.get("characters") or []
        if isinstance(raw_characters, list):
            for item in raw_characters:
                if not isinstance(item, dict):
                    continue
                name = item.get("name")
                if not (isinstance(name, str) and name.strip()):
                    continue
                char_id = item.get("id")
                if char_id is None:
                    new_char = Character(
                        project_id=ctx.project.id,
                        name=name.strip(),
                        description=_character_to_description(item),
                        image_url=None,
                    )
                    ctx.session.add(new_char)
                    new_char_count += 1
                else:
                    existing_char = await ctx.session.get(Character, char_id)
                    if existing_char and existing_char.project_id == ctx.project.id:
                        existing_char.name = name.strip()
                        existing_char.description = _character_to_description(item)
                        ctx.session.add(existing_char)

        await ctx.session.flush()

        new_shot_count = 0
        raw_shots = data.get("shots") or []
        if isinstance(raw_shots, list):
            for idx, shot_data in enumerate(raw_shots):
                if not isinstance(shot_data, dict):
                    continue
                shot_id = shot_data.get("id")
                shot_desc = shot_data.get("description")
                if not (isinstance(shot_desc, str) and shot_desc.strip()):
                    continue
                shot_order = (
                    shot_data.get("order") if isinstance(shot_data.get("order"), int) else idx + 1
                )
                image_prompt = _compose_image_prompt(shot_data, visual_bible)
                video_prompt = _compose_video_prompt(shot_data)

                if shot_id is None:
                    new_shot = Shot(
                        project_id=ctx.project.id,
                        order=shot_order,
                        description=shot_desc.strip(),
                        prompt=video_prompt,
                        image_prompt=image_prompt,
                        scene=shot_data.get("scene"),
                        action=shot_data.get("action"),
                        expression=shot_data.get("expression"),
                        camera=shot_data.get("camera"),
                        lighting=shot_data.get("lighting"),
                        dialogue=shot_data.get("dialogue"),
                        sfx=shot_data.get("sfx"),
                        video_url=None,
                        image_url=None,
                    )
                    ctx.session.add(new_shot)
                    new_shot_count += 1
                else:
                    existing_shot = await ctx.session.get(Shot, shot_id)
                    if existing_shot and existing_shot.project_id == ctx.project.id:
                        existing_shot.order = shot_order
                        existing_shot.description = shot_desc.strip()
                        existing_shot.prompt = video_prompt
                        existing_shot.image_prompt = image_prompt
                        existing_shot.scene = shot_data.get("scene")
                        existing_shot.action = shot_data.get("action")
                        existing_shot.expression = shot_data.get("expression")
                        existing_shot.camera = shot_data.get("camera")
                        existing_shot.lighting = shot_data.get("lighting")
                        existing_shot.dialogue = shot_data.get("dialogue")
                        existing_shot.sfx = shot_data.get("sfx")
                        ctx.session.add(existing_shot)

        await ctx.session.flush()
        return new_char_count, new_shot_count

    async def _call_plan_llm(self, ctx: AgentContext) -> dict[str, Any]:
        """Call LLM for planning and cache the result in ctx."""
        lineage_run, stage_map = await self._seed_text_stages(ctx)
        await self._set_text_stage_status(
            ctx,
            stage_map["text_intake"],
            status="running",
            order=1,
            event_type="text_stage_started",
        )

        is_incremental = ctx.rerun_mode == "incremental"
        payload: dict[str, Any] = {
            "project": {
                "id": ctx.project.id,
                "title": ctx.project.title,
                "story": ctx.project.story,
                "style": ctx.project.style,
                "status": ctx.project.status,
                "target_shot_count": getattr(ctx.project, "target_shot_count", None),
                "character_hints": getattr(ctx.project, "character_hints", None) or None,
            },
            "mode": ctx.rerun_mode,
        }
        if ctx.user_feedback:
            payload["user_feedback"] = ctx.user_feedback

        if is_incremental:
            existing_state = await self._get_existing_state(ctx)
            payload["existing_state"] = existing_state

        user_prompt = json.dumps(payload, ensure_ascii=False)
        intake_payload = {
            "title": "题材理解",
            "user_input": ctx.project.story or ctx.project.title,
            "genre": [ctx.project.title] if ctx.project.title else [],
            "tone": None,
            "logline": None,
            "themes": [],
        }
        await self._set_text_stage_status(
            ctx,
            stage_map["text_intake"],
            status="completed",
            order=1,
            content=intake_payload,
            event_type="text_stage_completed",
        )
        await self._set_text_stage_status(
            ctx,
            stage_map["text_story_outline"],
            status="running",
            order=2,
            event_type="text_stage_started",
        )

        logger.info(
            "Calling plan llm project_id=%s run_id=%s mode=%s",
            ctx.project.id,
            ctx.run.id,
            ctx.rerun_mode,
        )
        resp = None
        try:
            resp = await self.call_llm(
                ctx, system_prompt=SYSTEM_PROMPT, user_prompt=user_prompt, max_tokens=8192
            )
            data = extract_json(resp.text)
            logger.info(
                "Plan llm response parsed project_id=%s run_id=%s",
                ctx.project.id,
                ctx.run.id,
            )
        except Exception as exc:
            if resp is not None:
                logger.error(
                    "Plan llm raw response project_id=%s run_id=%s text=%s",
                    ctx.project.id,
                    ctx.run.id,
                    resp.text[:1000],
                )
            await self._mark_text_stage_failed(
                ctx,
                stage_map,
                "text_story_outline",
                str(exc) or "文本模型调用失败",
            )
            raise

        # Apply project updates from LLM
        project_update = data.get("project_update") or {}
        updated_fields: dict = {}
        if isinstance(project_update, dict):
            for key in ("title", "style", "status", "summary"):
                val = project_update.get(key)
                if isinstance(val, str) and val.strip():
                    setattr(ctx.project, key, val.strip())
                    updated_fields[key] = val.strip()

        if "status" not in updated_fields:
            ctx.project.status = "planning"
            updated_fields["status"] = ctx.project.status

        ctx.project.updated_at = utcnow()
        ctx.session.add(ctx.project)
        await ctx.session.commit()

        if updated_fields:
            await ctx.ws.send_event(
                ctx.project.id,
                {
                    "type": "project_updated",
                    "data": {"project": {"id": ctx.project.id, **updated_fields}},
                },
            )

        try:
            await self._persist_text_stages(ctx, data, lineage_run, stage_map)
        except Exception as exc:
            running_stage_name = next(
                (name for name, stage in stage_map.items() if stage.status == "running"),
                "text_story_outline",
            )
            await self._mark_text_stage_failed(
                ctx,
                stage_map,
                running_stage_name,
                str(exc) or "文本阶段持久化失败",
            )
            raise

        # Cache for run_shots()
        ctx.plan_data = data
        return data

    async def run_characters(self, ctx: AgentContext) -> None:
        is_incremental = ctx.rerun_mode == "incremental"
        if is_incremental:
            await self.send_message(ctx, "正在增量更新角色...", progress=0.0, is_loading=True)
        else:
            await self.send_message(ctx, "正在规划角色设定...", progress=0.0, is_loading=True)

        data = await self._call_plan_llm(ctx)
        user_message = data.get("user_message") or ""

        if is_incremental:
            visual_bible = data.get("visual_bible") or ""
            new_char_count, _ = await self._apply_incremental_changes(ctx, data, visual_bible)

            char_res = await ctx.session.execute(
                select(Character).where(Character.project_id == ctx.project.id)
            )
            final_chars = list(char_res.scalars().all())
            for char in final_chars:
                await self.send_character_event(ctx, char, "character_updated")

            char_names = [c.name for c in final_chars]
            ctx.completion_info = CompletionInfo(
                completed=user_message or "角色增量更新完成",
                details=f"更新后共 {len(final_chars)} 个角色",
                next="接下来生成分镜脚本",
                question="角色设定是否满意？",
            )
            await self.send_message(
                ctx,
                user_message or f"角色更新完成（{len(final_chars)} 个）",
                summary=f"{len(final_chars)} 个角色",
                progress=1.0,
            )
            return

        raw_characters = data.get("characters") or []
        lines: list[str] = []
        new_characters: list[Character] = []
        if isinstance(raw_characters, list) and raw_characters:
            char_names: list[str] = []
            for item in raw_characters:
                if not isinstance(item, dict):
                    continue
                name = item.get("name")
                if not (isinstance(name, str) and name.strip()):
                    continue
                char_names.append(name.strip())
                new_characters.append(
                    Character(
                        project_id=ctx.project.id,
                        name=name.strip(),
                        description=_character_to_description(item),
                        image_url=None,
                    )
                )
            if new_characters:
                ctx.session.add_all(new_characters)
                await ctx.session.flush()
                for character in new_characters:
                    await self.send_character_event(ctx, character, "character_created")
                lines.append(f"角色：{', '.join(char_names)}")

        ctx.completion_info = CompletionInfo(
            completed=user_message or "角色设定已生成",
            details=f"共 {len(new_characters) if isinstance(raw_characters, list) else 0} 个角色",
            next="接下来生成分镜脚本",
            question="角色设定是否满意？",
        )
        await self.send_message(
            ctx, user_message or "\n".join(lines) or "角色规划完成", progress=1.0
        )

    async def run_shots(self, ctx: AgentContext) -> None:
        data = getattr(ctx, "plan_data", None)
        if not data:
            raise RuntimeError(
                "run_shots called without cached plan_data; run_characters must run first"
            )

        is_incremental = ctx.rerun_mode == "incremental"
        visual_bible = data.get("visual_bible") or ""
        user_message = data.get("user_message") or ""

        if is_incremental:
            await self.send_message(ctx, "正在增量更新分镜...", progress=0.0, is_loading=True)
            _, new_shot_count = await self._apply_incremental_changes(ctx, data, visual_bible)

            shot_res = await ctx.session.execute(
                select(Shot).where(Shot.project_id == ctx.project.id).order_by(Shot.order.asc())
            )
            final_shots = list(shot_res.scalars().all())
            for shot in final_shots:
                await self.send_shot_event(ctx, shot, "shot_updated")

            lines = [f"{len(final_shots)} 个分镜"]
            summary = ctx.project.summary or f"{len(final_shots)}个分镜"
            ctx.completion_info = CompletionInfo(
                completed=user_message or "分镜增量更新完成",
                details=f"更新后共 {len(final_shots)} 个分镜",
                next="接下来为角色和分镜生成参考图片",
                question="分镜是否符合预期？",
            )
            await self.send_message(
                ctx,
                user_message or "\n".join(lines) or "分镜更新完成",
                summary=summary,
                progress=1.0,
            )
            return

        await self.send_message(ctx, "正在生成分镜脚本...", progress=0.0, is_loading=True)

        raw_shots = data.get("shots") or []
        if not isinstance(raw_shots, list) or not raw_shots:
            raise ValueError("LLM 响应未返回任何分镜")

        new_shots: list[Shot] = []
        fallback_order = 1
        for idx, shot_data in enumerate(raw_shots):
            if not isinstance(shot_data, dict):
                continue
            shot_desc = shot_data.get("description")
            if not (isinstance(shot_desc, str) and shot_desc.strip()):
                continue
            order = shot_data.get("order")
            if isinstance(order, int) and order > 0:
                shot_order = order
            else:
                shot_order = fallback_order
            fallback_order = max(fallback_order, shot_order + 1)

            image_prompt = _compose_image_prompt(shot_data, visual_bible)
            video_prompt = _compose_video_prompt(shot_data)

            new_shots.append(
                Shot(
                    project_id=ctx.project.id,
                    order=shot_order,
                    description=shot_desc.strip(),
                    prompt=video_prompt,
                    image_prompt=image_prompt,
                    scene=shot_data.get("scene"),
                    action=shot_data.get("action"),
                    expression=shot_data.get("expression"),
                    camera=shot_data.get("camera"),
                    lighting=shot_data.get("lighting"),
                    dialogue=shot_data.get("dialogue"),
                    sfx=shot_data.get("sfx"),
                    video_url=None,
                    image_url=None,
                )
            )

        if not new_shots:
            raise ValueError("LLM 响应的分镜列表为空或无效")

        new_shots.sort(key=lambda s: s.order)
        ctx.session.add_all(new_shots)
        await ctx.session.flush()
        for shot in new_shots:
            await self.send_shot_event(ctx, shot, "shot_created")
        await ctx.session.commit()

        raw_characters = data.get("characters") or []
        char_count = len(raw_characters) if isinstance(raw_characters, list) else 0

        summary = ctx.project.summary or f"{char_count}个角色，{len(new_shots)}个分镜"
        ctx.project.summary = summary
        ctx.project.updated_at = utcnow()
        ctx.session.add(ctx.project)

        ctx.completion_info = CompletionInfo(
            completed=user_message or "分镜脚本已生成",
            details=f"共 {len(new_shots)} 个分镜",
            next="接下来为角色和分镜生成参考图片",
            question="分镜是否符合预期？",
        )
        await self.send_message(
            ctx, user_message or f"{len(new_shots)} 个分镜已生成", summary=summary, progress=1.0
        )

    async def run(self, ctx: AgentContext) -> None:
        """Legacy entry point — runs both sub-steps sequentially."""
        await self.run_characters(ctx)
        await self.run_shots(ctx)

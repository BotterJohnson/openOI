from __future__ import annotations

import json

import pytest
from sqlalchemy import select

from app.agents.plan import (
    TEXT_STAGE_SPECS,
    PlanAgent,
    _character_to_description,
    _compose_image_prompt,
    _compose_video_prompt,
)
from app.models.artifact import Artifact
from app.models.project import Character, Shot
from app.models.stage import Stage
from tests.agent_fixtures import FakeLLM, make_context
from tests.factories import create_character, create_project, create_run, create_shot


class TestCharacterToDescription:
    def test_plain_description(self):
        assert _character_to_description({"description": "a hero"}) == "a hero"

    def test_description_with_personality_traits(self):
        result = _character_to_description(
            {
                "description": "a hero",
                "personality_traits": ["brave", "kind"],
            }
        )
        assert "a hero" in result
        assert "brave, kind" in result

    def test_list_traits_only(self):
        result = _character_to_description({"personality_traits": ["cool"]})
        assert "cool" in result

    def test_empty_dict_falls_back_to_json(self):
        result = _character_to_description({})
        assert json.loads(result) == {}

    def test_goals_and_costume(self):
        result = _character_to_description(
            {
                "description": "warrior",
                "goals": "save world",
                "costume_notes": "armor",
            }
        )
        assert "warrior" in result
        assert "save world" in result
        assert "armor" in result

    def test_empty_list_traits_ignored(self):
        result = _character_to_description({"description": "x", "personality_traits": []})
        assert result == "x"

    def test_non_string_description_ignored(self):
        result = _character_to_description({"description": 123})
        assert "123" in result

    def test_non_string_list_items_filtered(self):
        result = _character_to_description({"personality_traits": ["ok", 42, None]})
        assert "ok" in result
        assert "42" not in result


class TestComposeImagePrompt:
    def test_existing_image_prompt(self):
        assert (
            _compose_image_prompt({"image_prompt": "  anime style girl  "}, "")
            == "anime style girl"
        )

    def test_compose_from_fields(self):
        result = _compose_image_prompt(
            {
                "scene": "forest",
                "action": "running",
                "expression": "happy",
            },
            "warm palette",
        )
        assert "forest" in result
        assert "running" in result
        assert "warm palette" in result

    def test_empty_shot_returns_description(self):
        result = _compose_image_prompt({"description": "fallback"}, "")
        assert result == "fallback"

    def test_no_visual_bible(self):
        result = _compose_image_prompt({"scene": "room", "action": "sitting"}, "")
        assert "room" in result
        assert "sitting" in result

    def test_camera_and_lighting(self):
        result = _compose_image_prompt(
            {
                "camera": "close-up",
                "lighting": "backlit",
            },
            "",
        )
        assert "close-up" in result
        assert "backlit" in result


class TestComposeVideoPrompt:
    def test_existing_video_prompt(self):
        assert _compose_video_prompt({"video_prompt": "  zoom in  "}) == "zoom in"

    def test_compose_from_camera_action(self):
        result = _compose_video_prompt({"camera": "pan left", "action": "walk"})
        assert "pan left" in result
        assert "walk" in result

    def test_fallback_to_description(self):
        assert _compose_video_prompt({"description": "fallback"}) == "fallback"

    def test_empty_fields(self):
        assert _compose_video_prompt({}) == ""


@pytest.mark.asyncio
async def test_plan_agent_full_mode_creates_characters_and_shots(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"title": "New Title", "status": "planning"},
            "visual_bible": "anime style, warm palette",
            "story_breakdown": {
                "logline": "A hero saves the world",
                "genre": ["action"],
                "themes": ["courage"],
            },
            "characters": [
                {"name": "Hero", "description": "brave warrior", "personality_traits": ["brave"]},
            ],
            "shots": [
                {
                    "order": 1,
                    "description": "Hero enters the forest",
                    "scene": "forest",
                    "action": "walking",
                    "camera": "wide shot",
                    "lighting": "golden hour",
                    "dialogue": None,
                    "sfx": "wind",
                    "duration": 5.0,
                    "image_prompt": "anime style hero in forest",
                    "video_prompt": "slow zoom",
                },
            ],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)
    ctx.rerun_mode = "full"

    await PlanAgent().run(ctx)

    chars = (
        (await test_session.execute(select(Character).where(Character.project_id == project.id)))
        .scalars()
        .all()
    )
    assert len(chars) == 1
    assert chars[0].name == "Hero"

    shots = (
        (await test_session.execute(select(Shot).where(Shot.project_id == project.id)))
        .scalars()
        .all()
    )
    assert len(shots) == 1
    assert shots[0].description == "Hero enters the forest"
    assert shots[0].scene == "forest"
    assert shots[0].image_prompt == "anime style hero in forest"

    events = ctx.ws.events
    project_events = [e for pid, e in events if e["type"] == "project_updated"]
    assert len(project_events) >= 1


@pytest.mark.asyncio
async def test_plan_agent_persists_phase1_text_stages_for_minimal_genre_input(
    test_session, test_settings
):
    project = await create_project(test_session, title="修仙", story="修仙")
    run = await create_run(test_session, project_id=project.id, status="running")

    llm_output = json.dumps(
        {
            "agent": "plan",
            "user_message": "已将修仙题材扩展为废柴少年逆袭的第一章。",
            "project_update": {
                "title": "剑骨初醒",
                "status": "planning",
                "summary": "少年林玄在宗门大比前夜觉醒剑骨。",
            },
            "visual_bible": "donghua style, cold moonlight, ink-like sword aura",
            "story_breakdown": {
                "logline": "被轻视的少年在危机中觉醒上古剑骨。",
                "genre": ["修仙", "热血"],
                "themes": ["逆袭", "守护"],
                "setting": "青岚宗外门",
                "tone": "紧张热血",
            },
            "story_outline": {
                "premise": "外门弟子林玄被同门欺压，却在禁地听见剑灵呼唤。",
                "worldview": "宗门以灵根定阶，上古剑骨被视为禁忌传承。",
                "main_conflict": "林玄必须隐藏剑骨，同时赢下宗门大比。",
                "chapter_count_plan": "第一卷 6 章完成觉醒与入内门。",
                "chapters": [
                    {
                        "order": 1,
                        "title": "剑骨初醒",
                        "summary": "林玄被逼入禁地后觉醒剑骨。",
                        "hook": "剑灵喊出他失踪姐姐的名字。",
                    }
                ],
            },
            "chapter": {
                "order": 1,
                "title": "剑骨初醒",
                "plot_flow": ["被同门挑衅", "误入禁地", "剑灵苏醒", "反击成功"],
                "arrangement": "先压低主角处境，再用禁地奇遇制造爽点和悬念。",
                "prose": "暮色压住青岚宗外门。林玄握着断剑，听见石壁深处传来低语。",
                "storyboard_script": [
                    {
                        "order": 1,
                        "scene": "青岚宗演武场",
                        "beat": "林玄被同门逼退",
                        "camera": "低角度中景推近",
                        "dialogue": "你也配参加大比？",
                    }
                ],
                "video_prompts": [
                    {
                        "order": 1,
                        "prompt": "donghua style, young cultivator steps back in moonlit arena",
                        "negative_prompt": "blurry",
                        "duration": 3.5,
                    }
                ],
            },
            "characters": [
                {"name": "林玄", "description": "外门少年，沉默坚韧"},
            ],
            "shots": [
                {
                    "order": 1,
                    "description": "林玄在演武场被同门逼退",
                    "scene": "青岚宗演武场",
                    "action": "握紧断剑后退",
                    "camera": "低角度中景推近",
                    "lighting": "冷月光",
                    "video_prompt": "donghua style, slow push-in on a bullied young cultivator",
                }
            ],
        },
        ensure_ascii=False,
    )

    ctx = await make_context(
        test_session, test_settings, project=project, run=run, llm=FakeLLM(llm_output)
    )

    await PlanAgent().run(ctx)

    stages = (
        (
            await test_session.execute(
                select(Stage).where(Stage.project_id == project.id).order_by(Stage.id)
            )
        )
        .scalars()
        .all()
    )
    assert [stage.name for stage in stages] == [name for name, _ in TEXT_STAGE_SPECS]
    assert {stage.status for stage in stages} == {"completed"}

    artifacts = (
        (
            await test_session.execute(
                select(Artifact).where(Artifact.project_id == project.id).order_by(Artifact.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(artifacts) == len(TEXT_STAGE_SPECS)
    outline = next(
        artifact for artifact in artifacts if artifact.uri.endswith("text_story_outline")
    )
    assert outline.content["premise"].startswith("外门弟子林玄")
    prose = next(artifact for artifact in artifacts if artifact.uri.endswith("text_chapter_prose"))
    assert "暮色压住青岚宗外门" in prose.content["prose"]

    text_events = [event for _, event in ctx.ws.events if event["type"] == "text_stage_completed"]
    completed_stage_names = [event["data"]["stage"] for event in text_events]
    assert completed_stage_names[0] == "text_intake"
    assert completed_stage_names.count("text_intake") == 2
    assert set(completed_stage_names) == {name for name, _ in TEXT_STAGE_SPECS}
    started_events = [event for _, event in ctx.ws.events if event["type"] == "text_stage_started"]
    assert started_events[0]["data"]["stage"] == "text_intake"
    assert started_events[1]["data"]["stage"] == "text_story_outline"


@pytest.mark.asyncio
async def test_plan_agent_composes_image_prompt_when_missing(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "warm tones",
            "shots": [
                {
                    "order": 1,
                    "description": "A sunset scene",
                    "scene": "beach",
                    "action": "standing",
                    "expression": "calm",
                    "camera": "medium shot",
                    "lighting": "sunset",
                },
            ],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run(ctx)

    shots = (
        (await test_session.execute(select(Shot).where(Shot.project_id == project.id)))
        .scalars()
        .all()
    )
    assert len(shots) == 1
    composed = shots[0].image_prompt
    assert "beach" in composed
    assert "warm tones" in composed


@pytest.mark.asyncio
async def test_plan_agent_composes_video_prompt_when_missing(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "cool tones",
            "shots": [
                {
                    "order": 1,
                    "description": "night scene",
                    "camera": "tracking shot",
                    "action": "running",
                },
            ],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run(ctx)

    shots = (
        (await test_session.execute(select(Shot).where(Shot.project_id == project.id)))
        .scalars()
        .all()
    )
    assert len(shots) == 1
    assert "tracking shot" in shots[0].prompt
    assert "running" in shots[0].prompt


@pytest.mark.asyncio
async def test_plan_agent_no_shots_raises(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "test",
            "shots": [],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    with pytest.raises(ValueError, match="分镜"):
        await PlanAgent().run(ctx)


@pytest.mark.asyncio
async def test_plan_agent_empty_shots_raises(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "test",
            "shots": [{"order": 1, "description": ""}],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    with pytest.raises(ValueError, match="分镜"):
        await PlanAgent().run(ctx)


@pytest.mark.asyncio
async def test_plan_agent_incremental_mode(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    char1 = await create_character(test_session, project_id=project.id, name="Old Hero")
    shot1 = await create_shot(test_session, project_id=project.id, order=1, description="Old shot")
    await test_session.commit()

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "warm palette",
            "preserve_ids": {"characters": [char1.id], "shots": [shot1.id]},
            "characters": [
                {"id": char1.id, "name": "Updated Hero", "description": "stronger"},
            ],
            "shots": [
                {"id": shot1.id, "order": 1, "description": "New shot desc", "scene": "castle"},
            ],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)
    ctx.rerun_mode = "incremental"

    await PlanAgent().run(ctx)

    await test_session.refresh(char1)
    assert char1.name == "Updated Hero"

    await test_session.refresh(shot1)
    assert shot1.description == "New shot desc"
    assert shot1.scene == "castle"


@pytest.mark.asyncio
async def test_plan_agent_incremental_deletes_unpreserved(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    char1 = await create_character(test_session, project_id=project.id, name="Keep")
    await create_character(test_session, project_id=project.id, name="Delete")
    await test_session.commit()

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "warm",
            "preserve_ids": {"characters": [char1.id], "shots": []},
            "characters": [],
            "shots": [
                {"order": 1, "description": "New shot"},
            ],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)
    ctx.rerun_mode = "incremental"

    await PlanAgent().run(ctx)

    chars = (
        (await test_session.execute(select(Character).where(Character.project_id == project.id)))
        .scalars()
        .all()
    )
    assert len(chars) == 1
    assert chars[0].name == "Keep"

    deleted_events = [e for pid, e in ctx.ws.events if e["type"] == "character_deleted"]
    assert len(deleted_events) == 1


@pytest.mark.asyncio
async def test_plan_agent_incremental_new_character(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "dark",
            "preserve_ids": {"characters": [], "shots": []},
            "characters": [
                {"name": "New Char", "description": "fresh face"},
            ],
            "shots": [
                {"order": 1, "description": "Opening"},
            ],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)
    ctx.rerun_mode = "incremental"

    await PlanAgent().run(ctx)

    chars = (
        (await test_session.execute(select(Character).where(Character.project_id == project.id)))
        .scalars()
        .all()
    )
    assert len(chars) == 1
    assert chars[0].name == "New Char"


@pytest.mark.asyncio
async def test_plan_agent_sends_ws_events(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "anime palette",
            "characters": [{"name": "A", "description": "desc"}],
            "shots": [{"order": 1, "description": "Shot 1"}],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run(ctx)

    event_types = [e["type"] for pid, e in ctx.ws.events]
    assert "project_updated" in event_types
    assert "character_created" in event_types
    assert "shot_created" in event_types
    assert "run_message" in event_types


@pytest.mark.asyncio
async def test_plan_agent_with_user_feedback(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "v",
            "shots": [{"order": 1, "description": "Test"}],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)
    ctx.user_feedback = "Make it darker"

    await PlanAgent().run(ctx)

    msg_events = [e for pid, e in ctx.ws.events if e["type"] == "run_message"]
    assert len(msg_events) >= 1


@pytest.mark.asyncio
async def test_plan_agent_project_update_style(test_session, test_settings):
    project = await create_project(test_session, style="anime")
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"style": "cinematic", "status": "planning"},
            "visual_bible": "film grain",
            "shots": [{"order": 1, "description": "Scene"}],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run(ctx)

    await test_session.refresh(project)
    assert project.style == "cinematic"


@pytest.mark.asyncio
async def test_plan_agent_multiple_shots_sorted_by_order(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "test",
            "shots": [
                {"order": 3, "description": "Third"},
                {"order": 1, "description": "First"},
                {"order": 2, "description": "Second"},
            ],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run(ctx)

    shots = (
        (
            await test_session.execute(
                select(Shot).where(Shot.project_id == project.id).order_by(Shot.order)
            )
        )
        .scalars()
        .all()
    )
    assert [s.order for s in shots] == [1, 2, 3]


@pytest.mark.asyncio
async def test_plan_agent_shot_fallback_order(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "test",
            "shots": [
                {"description": "No order given"},
            ],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run(ctx)

    shots = (
        (await test_session.execute(select(Shot).where(Shot.project_id == project.id)))
        .scalars()
        .all()
    )
    assert shots[0].order == 1


@pytest.mark.asyncio
async def test_plan_agent_invalid_character_entry_ignored(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "test",
            "characters": [
                "not a dict",
                {"description": "no name"},
                42,
                {"name": "Valid", "description": "ok"},
            ],
            "shots": [{"order": 1, "description": "Shot"}],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run(ctx)

    chars = (
        (await test_session.execute(select(Character).where(Character.project_id == project.id)))
        .scalars()
        .all()
    )
    assert len(chars) == 1
    assert chars[0].name == "Valid"


@pytest.mark.asyncio
async def test_plan_agent_incremental_new_shot(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    existing_shot = await create_shot(
        test_session, project_id=project.id, order=1, description="Keep"
    )
    await test_session.commit()

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "test",
            "preserve_ids": {"characters": [], "shots": [existing_shot.id]},
            "characters": [],
            "shots": [
                {"id": existing_shot.id, "order": 1, "description": "Updated"},
                {"order": 2, "description": "New shot"},
            ],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)
    ctx.rerun_mode = "incremental"

    await PlanAgent().run(ctx)

    shots = (
        (
            await test_session.execute(
                select(Shot).where(Shot.project_id == project.id).order_by(Shot.order)
            )
        )
        .scalars()
        .all()
    )
    assert len(shots) == 2


@pytest.mark.asyncio
async def test_plan_agent_incremental_wrong_project_char_ignored(test_session, test_settings):
    project1 = await create_project(test_session, title="P1")
    project2 = await create_project(test_session, title="P2")
    run = await create_run(test_session, project_id=project2.id)

    char_p1 = await create_character(test_session, project_id=project1.id, name="P1 Char")
    await test_session.commit()

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning"},
            "visual_bible": "test",
            "preserve_ids": {"characters": [], "shots": []},
            "characters": [
                {"id": char_p1.id, "name": "Hacked", "description": "should not update"},
            ],
            "shots": [{"order": 1, "description": "Shot"}],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project2, run=run, llm=llm)
    ctx.rerun_mode = "incremental"

    await PlanAgent().run(ctx)

    await test_session.refresh(char_p1)
    assert char_p1.name == "P1 Char"


@pytest.mark.asyncio
async def test_plan_agent_project_update_summary(test_session, test_settings):
    project = await create_project(test_session)
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {"status": "planning", "summary": "A brave hero story"},
            "visual_bible": "test",
            "shots": [{"order": 1, "description": "Shot"}],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run(ctx)

    await test_session.refresh(project)
    assert project.summary == "A brave hero story"


@pytest.mark.asyncio
async def test_plan_agent_default_status_planning(test_session, test_settings):
    project = await create_project(test_session, status="draft")
    run = await create_run(test_session, project_id=project.id)

    llm_output = json.dumps(
        {
            "agent": "plan",
            "project_update": {},
            "visual_bible": "test",
            "shots": [{"order": 1, "description": "Shot"}],
        },
        ensure_ascii=False,
    )

    llm = FakeLLM(llm_output)
    ctx = await make_context(test_session, test_settings, project=project, run=run, llm=llm)

    await PlanAgent().run(ctx)

    await test_session.refresh(project)
    assert project.status == "planning"

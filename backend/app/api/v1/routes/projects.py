from __future__ import annotations

from datetime import datetime
from typing import cast

from fastapi import APIRouter, HTTPException, UploadFile, File, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import InstrumentedAttribute

from app.api.deps import SessionDep, SettingsDep, get_or_404
from app.config import Settings
from app.db.utils import utcnow
from app.models.message import Message
from app.models.artifact import Artifact
from app.models.project import Character, Project, Shot
from app.models.stage import Stage
from app.schemas.project import (
    CharacterRead,
    MessageRead,
    ProjectCreate,
    ProjectBatchDeleteRequest,
    ProjectProviderSettingsRead,
    ProjectListRead,
    ProjectRead,
    ProjectUpdate,
    ShotRead,
    TextStageRead,
)
from app.services.file_cleaner import get_local_path
from app.services.project_deletion import delete_project_by_id, delete_projects_by_ids
from app.services.provider_resolution import resolve_project_provider_settings_async

router = APIRouter()

TEXT_STAGE_ORDER: tuple[str, ...] = (
    "text_intake",
    "text_story_outline",
    "text_chapter_flow",
    "text_arrangement",
    "text_chapter_prose",
    "text_storyboard",
    "text_video_prompts",
    "text_consistency_review",
)

TEXT_STAGE_DISPLAY_NAMES: dict[str, str] = {
    "text_intake": "题材理解",
    "text_story_outline": "故事大纲",
    "text_chapter_flow": "章节剧情流程",
    "text_arrangement": "编排过程",
    "text_chapter_prose": "故事正文",
    "text_storyboard": "分镜脚本",
    "text_video_prompts": "视频提示词",
    "text_consistency_review": "一致性检查",
}


async def _project_provider_settings(
    project: Project, settings: Settings
) -> ProjectProviderSettingsRead:
    return (
        await resolve_project_provider_settings_async(project, settings, probe_mode="cache_only")
    ).as_project_provider_settings()


async def _project_read_model(project: Project, settings: Settings) -> ProjectRead:
    return ProjectRead(
        id=project.id if project.id is not None else 0,
        title=project.title,
        story=project.story,
        style=project.style,
        summary=project.summary,
        video_url=project.video_url,
        status=project.status,
        target_shot_count=project.target_shot_count,
        character_hints=project.character_hints or [],
        creation_mode=project.creation_mode,
        reference_images=project.reference_images or [],
        provider_settings=await _project_provider_settings(project, settings),
        created_at=project.created_at,
        updated_at=project.updated_at,
    )


@router.post("", response_model=ProjectRead, status_code=status.HTTP_201_CREATED)
async def create_project(
    payload: ProjectCreate,
    session: AsyncSession = SessionDep,
    settings: Settings = SettingsDep,
):
    style = (payload.style or "").strip() or "anime"
    project = Project(
        title=payload.title,
        story=payload.story,
        style=style,
        status=payload.status or "draft",
        target_shot_count=payload.target_shot_count,
        character_hints=payload.character_hints or [],
        creation_mode=payload.creation_mode,
        reference_images=payload.reference_images or [],
        text_provider_override=payload.text_provider_override,
        image_provider_override=payload.image_provider_override,
        video_provider_override=payload.video_provider_override,
    )
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return await _project_read_model(project, settings)


@router.get("", response_model=ProjectListRead)
async def list_projects(session: AsyncSession = SessionDep, settings: Settings = SettingsDep):
    project_created_at_col = cast(InstrumentedAttribute[datetime], cast(object, Project.created_at))
    res = await session.execute(select(Project).order_by(project_created_at_col.desc()))
    items = res.scalars().all()
    return {
        "items": [await _project_read_model(p, settings) for p in items],
        "total": len(items),
    }


@router.get("/{project_id}", response_model=ProjectRead)
async def get_project(
    project_id: int,
    session: AsyncSession = SessionDep,
    settings: Settings = SettingsDep,
):
    project = await get_or_404(session, Project, project_id)
    return await _project_read_model(project, settings)


@router.get("/{project_id}/final-video")
async def download_final_video(project_id: int, session: AsyncSession = SessionDep):
    project = await get_or_404(session, Project, project_id, detail="Final video not found")
    if not project.video_url:
        raise HTTPException(status_code=404, detail="Final video not found")

    path = get_local_path(project.video_url)
    if path is None or not path.exists():
        raise HTTPException(status_code=404, detail="Final video not found")

    return FileResponse(path, filename=path.name)


@router.put("/{project_id}", response_model=ProjectRead)
@router.patch("/{project_id}", response_model=ProjectRead)
async def update_project(
    project_id: int,
    payload: ProjectUpdate,
    session: AsyncSession = SessionDep,
    settings: Settings = SettingsDep,
):
    project = await get_or_404(session, Project, project_id)
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        if k == "style":
            v = (v or "").strip() or "anime"
        setattr(project, k, v)
    project.updated_at = utcnow()
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return await _project_read_model(project, settings)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(project_id: int, session: AsyncSession = SessionDep):
    """完全删除项目及所有关联数据（包括文件）"""
    await delete_project_by_id(session, project_id)
    return None


@router.post("/batch-delete", status_code=status.HTTP_204_NO_CONTENT)
async def batch_delete_projects(
    payload: ProjectBatchDeleteRequest, session: AsyncSession = SessionDep
):
    await delete_projects_by_ids(session, payload.ids)
    return None


@router.post("/{project_id}/upload-reference", response_model=dict)
async def upload_reference_image(
    project_id: int,
    file: UploadFile = File(...),
    session: AsyncSession = SessionDep,
):
    import uuid
    from pathlib import Path

    project = await get_or_404(session, Project, project_id)

    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are accepted")

    ref_dir = Path(__file__).parent.parent.parent / "static" / "references"
    ref_dir.mkdir(parents=True, exist_ok=True)

    ext = file.content_type.split("/")[-1]
    if ext == "jpeg":
        ext = "jpg"
    filename = f"{uuid.uuid4().hex[:12]}.{ext}"
    dest = ref_dir / filename

    content = await file.read()
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Image must be under 10MB")

    dest.write_bytes(content)

    url_path = f"/static/references/{filename}"

    images = list(project.reference_images or [])
    images.append(url_path)
    project.reference_images = images
    project.updated_at = utcnow()
    session.add(project)
    await session.commit()

    return {"url": url_path, "reference_images": images}


@router.get("/{project_id}/characters", response_model=list[CharacterRead])
async def list_characters(project_id: int, session: AsyncSession = SessionDep):
    await get_or_404(session, Project, project_id)
    character_project_id_col = cast(InstrumentedAttribute[int], cast(object, Character.project_id))
    res = await session.execute(select(Character).where(character_project_id_col == project_id))
    return [CharacterRead.model_validate(c) for c in res.scalars().all()]


@router.get("/{project_id}/shots", response_model=list[ShotRead])
async def list_shots(project_id: int, session: AsyncSession = SessionDep):
    await get_or_404(session, Project, project_id)
    shot_project_id_col = cast(InstrumentedAttribute[int], cast(object, Shot.project_id))
    shot_order_col = cast(InstrumentedAttribute[int], cast(object, Shot.order))
    res = await session.execute(
        select(Shot).where(shot_project_id_col == project_id).order_by(shot_order_col.asc())
    )
    return [ShotRead.model_validate(s) for s in res.scalars().all()]


@router.get("/{project_id}/messages", response_model=list[MessageRead])
async def list_messages(project_id: int, session: AsyncSession = SessionDep):
    """获取项目的所有消息记录"""
    await get_or_404(session, Project, project_id)
    message_project_id_col = cast(InstrumentedAttribute[int], cast(object, Message.project_id))
    message_created_at_col = cast(InstrumentedAttribute[datetime], cast(object, Message.created_at))
    res = await session.execute(
        select(Message)
        .where(message_project_id_col == project_id)
        .order_by(message_created_at_col.asc())
    )
    return [MessageRead.model_validate(m) for m in res.scalars().all()]


@router.get("/{project_id}/text-stages", response_model=list[TextStageRead])
async def list_text_stages(project_id: int, session: AsyncSession = SessionDep):
    await get_or_404(session, Project, project_id)
    stage_project_id_col = cast(InstrumentedAttribute[int], cast(object, Stage.project_id))
    stage_name_col = cast(InstrumentedAttribute[str], cast(object, Stage.name))
    stage_created_at_col = cast(InstrumentedAttribute[datetime], cast(object, Stage.created_at))
    stage_id_col = cast(InstrumentedAttribute[int], cast(object, Stage.id))
    artifact_stage_id_col = cast(InstrumentedAttribute[int], cast(object, Artifact.stage_id))
    artifact_created_at_col = cast(
        InstrumentedAttribute[datetime], cast(object, Artifact.created_at)
    )

    stage_res = await session.execute(
        select(Stage)
        .where(stage_project_id_col == project_id)
        .where(stage_name_col.in_(TEXT_STAGE_ORDER))
        .order_by(stage_created_at_col.asc(), stage_id_col.asc())
    )
    stages = stage_res.scalars().all()

    artifact_res = await session.execute(
        select(Artifact)
        .join(Stage, artifact_stage_id_col == stage_id_col)
        .where(stage_project_id_col == project_id)
        .where(stage_name_col.in_(TEXT_STAGE_ORDER))
        .order_by(artifact_created_at_col.asc())
    )
    artifacts = artifact_res.scalars().all()

    latest_stage_by_name: dict[str, Stage] = {}
    for stage in stages:
        latest_stage_by_name[stage.name] = stage

    latest_artifact_by_stage_id: dict[int, Artifact] = {}
    for artifact in artifacts:
        latest_artifact_by_stage_id[artifact.stage_id] = artifact

    items: list[TextStageRead] = []
    for index, stage_name in enumerate(TEXT_STAGE_ORDER, start=1):
        stage = latest_stage_by_name.get(stage_name)
        if stage is None:
            continue
        artifact = latest_artifact_by_stage_id.get(stage.id or 0)
        items.append(
            TextStageRead(
                stage=stage.name,
                name=(
                    artifact.name
                    if artifact is not None and artifact.name
                    else TEXT_STAGE_DISPLAY_NAMES.get(stage.name, stage.name)
                ),
                status=stage.status,
                order=index,
                artifact_id=artifact.id if artifact is not None and artifact.id is not None else 0,
                run_id=stage.run_id,
                content=artifact.content if artifact is not None else None,
                created_at=stage.created_at,
                updated_at=artifact.updated_at if artifact is not None else stage.updated_at,
            )
        )
    return items

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


TextProviderKey = Literal["anthropic", "openai"]
ImageProviderKey = Literal["openai"]
VideoProviderKey = Literal["openai", "doubao"]


class ProjectProviderEntry(BaseModel):
    class Capabilities(BaseModel):
        generate: bool | None = None
        stream: bool | None = None

    selected_key: str
    source: Literal["project", "default"]
    resolved_key: str | None
    valid: bool
    status: Literal["valid", "degraded", "invalid"] | None = None
    reason_code: str | None
    reason_message: str | None
    capabilities: Capabilities | None = None


class ProjectProviderSettingsRead(BaseModel):
    text: ProjectProviderEntry
    image: ProjectProviderEntry
    video: ProjectProviderEntry


class ProviderResolution(BaseModel):
    valid: bool
    text: ProjectProviderEntry
    image: ProjectProviderEntry
    video: ProjectProviderEntry

    def as_project_provider_settings(self) -> ProjectProviderSettingsRead:
        return ProjectProviderSettingsRead(
            text=self.text,
            image=self.image,
            video=self.video,
        )

    def as_error_details(self) -> dict[str, object]:
        return {
            "valid": self.valid,
            "modalities": self.as_project_provider_settings().model_dump(),
        }


class ProjectCreate(BaseModel):
    title: str = Field(min_length=1)
    story: str | None = None
    style: str | None = None
    status: str | None = None
    target_shot_count: int | None = None
    character_hints: list[str] | None = None
    creation_mode: str | None = None
    reference_images: list[str] | None = None
    text_provider_override: TextProviderKey | None = None
    image_provider_override: ImageProviderKey | None = None
    video_provider_override: VideoProviderKey | None = None


class ProjectUpdate(BaseModel):
    title: str | None = None
    story: str | None = None
    style: str | None = None
    status: str | None = None
    target_shot_count: int | None = None
    character_hints: list[str] | None = None
    creation_mode: str | None = None
    reference_images: list[str] | None = None
    text_provider_override: TextProviderKey | None = None
    image_provider_override: ImageProviderKey | None = None
    video_provider_override: VideoProviderKey | None = None


class ProjectBatchDeleteRequest(BaseModel):
    ids: list[int] = Field(min_length=1)


class ProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    title: str
    story: str | None
    style: str | None
    summary: str | None
    video_url: str | None
    status: str
    target_shot_count: int | None = None
    character_hints: list[str] = Field(default_factory=list)
    creation_mode: str | None = None
    reference_images: list[str] = Field(default_factory=list)
    provider_settings: ProjectProviderSettingsRead
    created_at: datetime
    updated_at: datetime


class ProjectListRead(BaseModel):
    items: list[ProjectRead]
    total: int


class CharacterRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    name: str
    description: str | None
    image_url: str | None
    approval_state: Literal["draft", "approved", "superseded"]
    approval_version: int
    approved_at: datetime | None
    approved_name: str | None
    approved_description: str | None
    approved_image_url: str | None


class ShotRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    order: int
    description: str
    prompt: str | None = None
    image_prompt: str | None = None
    image_url: str | None = None
    video_url: str | None = None
    duration: float | None = None
    camera: str | None = None
    motion_note: str | None = None
    scene: str | None = None
    action: str | None = None
    expression: str | None = None
    lighting: str | None = None
    dialogue: str | None = None
    sfx: str | None = None
    seed: int | None = None
    character_ids: list[int]
    approval_state: Literal["draft", "approved", "superseded"]
    approval_version: int
    approved_at: datetime | None = None
    approved_description: str | None = None
    approved_prompt: str | None = None
    approved_image_prompt: str | None = None
    approved_duration: float | None = None
    approved_camera: str | None = None
    approved_motion_note: str | None = None
    approved_scene: str | None = None
    approved_action: str | None = None
    approved_expression: str | None = None
    approved_lighting: str | None = None
    approved_dialogue: str | None = None
    approved_sfx: str | None = None
    approved_character_ids: list[int] = Field(default_factory=list)


class ShotUpdate(BaseModel):
    order: int | None = Field(default=None, ge=1)
    description: str | None = None
    prompt: str | None = None
    image_prompt: str | None = None
    duration: float | None = Field(default=None, gt=0)
    camera: str | None = None
    motion_note: str | None = None
    scene: str | None = None
    action: str | None = None
    expression: str | None = None
    lighting: str | None = None
    dialogue: str | None = None
    sfx: str | None = None
    seed: int | None = None
    character_ids: list[int] | None = None


class CharacterUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1)
    description: str | None = None
    image_url: str | None = None


class RegenerateRequest(BaseModel):
    type: Literal["image", "video"]
    description: str | None = None
    image_url: str | None = None


class GenerateRequest(BaseModel):
    seed: int | None = None
    notes: str | None = None
    auto_mode: bool = False
    start_stage: Literal["plan", "render", "compose"] | None = None


class ResumeRequest(BaseModel):
    run_id: int
    auto_mode: bool = False


class AgentRunRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    status: str
    current_agent: str | None
    progress: float
    error: str | None
    thread_id: str | None = None
    resource_type: str | None  # 资源类型：character|shot|project
    resource_id: int | None  # 资源 ID
    provider_snapshot: ProjectProviderSettingsRead | None = None
    created_at: datetime
    updated_at: datetime


class RecoveryStageRead(BaseModel):
    name: str
    status: Literal["completed", "current", "pending", "blocked"]
    artifact_count: int = 0


class RecoverySummaryRead(BaseModel):
    project_id: int
    run_id: int
    thread_id: str
    current_stage: str
    next_stage: str | None = None
    preserved_stages: list[str] = Field(default_factory=list)
    stage_history: list[RecoveryStageRead] = Field(default_factory=list)
    resumable: bool = True


class RecoveryControlRead(BaseModel):
    state: Literal["active", "recoverable"]
    detail: str
    available_actions: list[Literal["resume", "cancel"]] = Field(
        default_factory=lambda: ["resume", "cancel"]
    )
    thread_id: str
    active_run: AgentRunRead
    recovery_summary: RecoverySummaryRead


class FeedbackRequest(BaseModel):
    content: str = Field(min_length=1)
    run_id: int | None = None
    feedback_type: str | None = None
    entity_type: str | None = None
    entity_id: int | None = None


class MessageRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    run_id: int | None
    agent: str
    role: str
    content: str
    summary: str | None
    progress: float | None
    is_loading: bool
    created_at: datetime


class TextStageRead(BaseModel):
    stage: str
    name: str
    status: str
    order: int
    artifact_id: int
    run_id: int
    content: dict[str, object] | None = None
    created_at: datetime
    updated_at: datetime


class AssetCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    asset_type: Literal["character", "scene"]
    description: str | None = None
    image_url: str | None = None
    metadata_json: str | None = None
    source_project_id: int | None = None
    tags: str | None = None


class UseAssetInProjectRequest(BaseModel):
    project_id: int


class AssetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    asset_type: str
    description: str | None
    image_url: str | None
    metadata_json: str | None
    source_project_id: int | None
    tags: str | None
    created_at: datetime
    updated_at: datetime


class AssetListRead(BaseModel):
    items: list[AssetRead]
    total: int

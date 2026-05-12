import type React from "react";

export interface ProjectProviderEntry {
	selected_key: string;
	source: "project" | "default";
	resolved_key: string | null;
	valid: boolean;
	status?: "valid" | "degraded" | "invalid" | null;
	reason_code: string | null;
	reason_message: string | null;
	capabilities?: {
		generate?: boolean | null;
		stream?: boolean | null;
	} | null;
}

export interface ProjectProviderSettings {
	text: ProjectProviderEntry;
	image: ProjectProviderEntry;
	video: ProjectProviderEntry;
}

export interface ProjectProviderOverridesPayload {
	text_provider_override?: string | null;
	image_provider_override?: string | null;
	video_provider_override?: string | null;
}

export type PipelineStageKey = "plan" | "render" | "compose";

export interface GenerateProjectPayload {
	seed?: number;
	notes?: string;
	auto_mode?: boolean;
	start_stage?: PipelineStageKey;
}

export interface CreateProjectPayload extends ProjectProviderOverridesPayload {
	title: string;
	story?: string;
	style?: string;
	target_shot_count?: number;
	character_hints?: string[];
	creation_mode?: string;
	reference_images?: string[];
}

export type UpdateProjectPayload = Partial<
	Pick<
		Project,
		| "title"
		| "story"
		| "style"
		| "target_shot_count"
		| "character_hints"
		| "creation_mode"
		| "reference_images"
	> &
		ProjectProviderOverridesPayload
>;

// Project types
export interface Project {
	id: number;
	title: string;
	story: string | null;
	style: string | null;
	summary: string | null; // 剧情摘要
	video_url: string | null; // 最终拼接视频
	status: string;
	target_shot_count: number | null;
	character_hints: string[];
	creation_mode: string | null;
	reference_images: string[];
	created_at: string;
	updated_at: string;
	provider_settings: ProjectProviderSettings;
}

export interface Character {
	id: number;
	project_id: number;
	name: string;
	description: string | null;
	image_url: string | null;
	approval_state: ReviewState;
	approval_version: number;
	approved_at: string | null;
	approved_name: string | null;
	approved_description: string | null;
	approved_image_url: string | null;
}

export interface Shot {
	id: number;
	project_id: number;
	order: number;
	description: string;
	prompt: string | null; // 视频生成 prompt
	image_prompt: string | null; // 首帧图片生成 prompt
	image_url: string | null; // 首帧图片
	video_url: string | null; // 分镜视频
	duration: number | null;
	camera: string | null;
	motion_note: string | null;
	scene: string | null;
	action: string | null;
	expression: string | null;
	lighting: string | null;
	dialogue: string | null;
	sfx: string | null;
	seed: number | null;
	character_ids: number[];
	approval_state: ReviewState;
	approval_version: number;
	approved_at: string | null;
	approved_description: string | null;
	approved_prompt: string | null;
	approved_image_prompt: string | null;
	approved_duration: number | null;
	approved_camera: string | null;
	approved_motion_note: string | null;
	approved_scene: string | null;
	approved_action: string | null;
	approved_expression: string | null;
	approved_lighting: string | null;
	approved_dialogue: string | null;
	approved_sfx: string | null;
	approved_character_ids: number[];
}

export type ReviewState = "draft" | "approved" | "superseded";

export interface CharacterUpdatePayload {
	name?: string | null;
	description?: string | null;
	image_url?: string | null;
}

export interface ShotUpdatePayload {
	order?: number | null;
	description?: string | null;
	prompt?: string | null;
	image_prompt?: string | null;
	duration?: number | null;
	camera?: string | null;
	motion_note?: string | null;
	scene?: string | null;
	action?: string | null;
	expression?: string | null;
	lighting?: string | null;
	dialogue?: string | null;
	sfx?: string | null;
	seed?: number | null;
	character_ids?: number[] | null;
}

export interface AgentRun {
	id: number;
	project_id: number;
	status: string;
	current_agent: string | null;
	progress: number;
	error: string | null;
	thread_id: string | null;
	resource_type: string | null;
	resource_id: number | null;
	provider_snapshot?: ProjectProviderSettings | null;
	created_at: string;
	updated_at: string;
}

export interface RecoveryStageRead {
	name: string;
	status: "completed" | "current" | "pending" | "blocked";
	artifact_count: number;
}

export interface RecoverySummaryRead {
	project_id: number;
	run_id: number;
	thread_id: string;
	current_stage: string;
	next_stage: string | null;
	preserved_stages: string[];
	stage_history: RecoveryStageRead[];
	resumable: boolean;
}

export interface RecoveryControlRead {
	state: "active" | "recoverable";
	detail: string;
	available_actions: Array<"resume" | "cancel">;
	thread_id: string;
	active_run: AgentRun;
	recovery_summary: RecoverySummaryRead;
}

export interface RunProgressEventData {
	run_id: number;
	project_id?: number;
	current_agent?: string | null;
	current_stage?: string | null;
	stage?: string | null;
	next_stage?: string | null;
	progress: number;
	recovery_summary?: RecoverySummaryRead | null;
}

export interface RunAwaitingConfirmEventData {
	run_id: number;
	project_id?: number;
	agent: string;
	gate?: string | null;
	current_stage?: string | null;
	stage?: string | null;
	next_stage?: string | null;
	recovery_summary: RecoverySummaryRead;
	preserved_stages?: string[];
	message?: string | null;
	completed?: string | null;
	next_step?: string | null;
	question?: string | null;
	auto_mode?: boolean;
}

export interface RunStartedEventData {
	run_id: number;
	project_id?: number;
	provider_snapshot?: ProjectProviderSettings | null;
	current_stage?: string | null;
	stage?: string | null;
	next_stage?: string | null;
	progress?: number;
	current_agent?: string | null;
	recovery_summary?: RecoverySummaryRead | null;
	preserved_stages?: string[];
}

export interface RunCompletedEventData {
	run_id?: number;
	project_id?: number;
	current_stage?: string | null;
	current_agent?: string | null;
	message?: string | null;
	video_generation_pending?: boolean | null;
}

export interface RunFailedEventData {
	run_id?: number;
	project_id?: number;
	error?: string | null;
	agent?: string | null;
	current_stage?: string | null;
}

export interface RunCancelledEventData {
	run_id?: number;
	project_id?: number;
	run_ids?: number[];
	cancelled_count?: number;
}

export interface RunConfirmedEventData {
	run_id: number;
	project_id?: number;
	agent: string;
	gate?: string | null;
	current_stage?: string | null;
	stage?: string | null;
	next_stage?: string | null;
	recovery_summary?: RecoverySummaryRead | null;
	auto_mode?: boolean;
}

export type TextStageKey =
	| "text_intake"
	| "text_story_outline"
	| "text_chapter_flow"
	| "text_arrangement"
	| "text_chapter_prose"
	| "text_storyboard"
	| "text_video_prompts"
	| "text_consistency_review";

export interface TextStage {
	stage: TextStageKey;
	name: string;
	status: "pending" | "running" | "completed" | "failed" | "needs_review" | string;
	order: number;
	artifact_id: number;
	run_id: number;
	content?: Record<string, unknown> | null;
	created_at?: string;
	updated_at?: string;
}

export interface TextStageEventData {
	run_id?: number;
	project_id?: number;
	stage: TextStageKey;
	name: string;
	status: string;
	order: number;
	artifact_id: number;
	content?: Record<string, unknown> | null;
}

// WebSocket event types
export type WsEventType =
	| "connected"
	| "pong"
	| "echo"
	| "error"
	| "run_started"
	| "run_progress"
	| "run_message"
	| "run_completed"
	| "run_failed"
	| "run_awaiting_confirm"
	| "run_confirmed"
	| "run_cancelled"
	| "character_created"
	| "character_updated"
	| "character_deleted"
	| "shot_created"
	| "shot_updated"
	| "shot_deleted"
	| "project_updated"
	| "data_cleared"
	| "text_stage_started"
	| "text_stage_updated"
	| "text_stage_completed"
	| "text_stage_failed";

export interface WsEvent {
	type: WsEventType;
	data: Record<string, unknown>;
}

export interface AgentMessage {
	id?: string; // 唯一标识符（前端生成）
	agent: string;
	role: string;
	content: string;
	summary?: string; // 摘要（用于确认环节显示）
	icon?: React.ComponentType<React.SVGProps<SVGSVGElement>>;
	timestamp?: string;
	progress?: number; // 0-1 之间的进度值
	isLoading?: boolean; // 是否正在加载
}

export interface BlockingClip {
	shot_id: number;
	order: number;
	status: string;
	reason: string;
}

export interface ProjectUpdatedPayload {
	id: number;
	title?: string | null;
	story?: string | null;
	style?: string | null;
	summary?: string | null;
	video_url?: string | null;
	status?: string | null;
	target_shot_count?: number | null;
	character_hints?: string[] | null;
	creation_mode?: string | null;
	reference_images?: string[] | null;
	blocking_clips?: BlockingClip[] | null;
}

export interface Message {
	id: number;
	project_id: number;
	run_id: number | null;
	agent: string;
	role: string;
	content: string;
	summary: string | null;
	progress: number | null;
	is_loading: boolean;
	created_at: string;
}

// 工作流阶段类型（与后端 Phase2 graph 对齐）
export type WorkflowStage =
	| "plan"
	| "plan_approval"
	| "render"
	| "render_approval"
	| "compose"
	| "review";

// Config types
export type ConfigValue = string | number | boolean | null;

// 后端 API 返回的配置项格式
export interface ConfigItem {
	key: string;
	value: string | null;
	is_sensitive: boolean;
	is_masked: boolean;
	source: "db" | "env" | "default";
}

export interface ConfigSection {
	key: string;
	title: string;
	items: ConfigItem[];
}

export type AppConfig = ConfigItem[];

export const AGENT_NAME_MAP: Record<string, string> = {
	plan: "规划",
	character: "角色",
	shot: "分镜",
	compose: "合成",
	review: "审查",
};

export interface Asset {
	id: number;
	name: string;
	asset_type: "character" | "scene";
	description: string | null;
	image_url: string | null;
	metadata_json: string | null;
	source_project_id: number | null;
	tags: string | null;
	created_at: string;
	updated_at: string;
}

export interface AssetList {
	items: Asset[];
	total: number;
}

export interface AssetCreatePayload {
	name: string;
	asset_type: "character" | "scene";
	description?: string | null;
	image_url?: string | null;
	metadata_json?: string | null;
	source_project_id?: number | null;
	tags?: string | null;
}

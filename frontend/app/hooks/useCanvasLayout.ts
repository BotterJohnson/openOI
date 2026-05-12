import { useMemo } from "react";
import { createShapeId, type TLShapePartial } from "tldraw";
import { SHAPE_TYPES } from "~/components/canvas/shapes";
import type {
	CharacterSectionShape,
	ComposeSectionShape,
	PlanSectionShape,
	StoryboardSectionShape,
} from "~/components/canvas/shapes";
import type { Character, Shot, TextStage, WorkflowStage } from "~/types";

type SectionKey = "plan" | "render" | "compose";
type SectionState = "draft" | "generating" | "blocked" | "complete";

interface LayoutConfig {
	startX: number;
	startY: number;
	boardWidth: number;
}

const DEFAULT_CONFIG: LayoutConfig = {
	startX: 100,
	startY: 100,
	boardWidth: Math.min(
		920,
		(typeof window !== "undefined" ? window.innerWidth : 960) - 40,
	),
};

const SECTION_ORDER: SectionKey[] = ["plan", "render", "compose"];

const SECTION_LABELS: Record<SectionKey, string> = {
	plan: "规划",
	render: "渲染",
	compose: "合成",
};

const SECTION_PLACEHOLDER_TEXT: Record<SectionKey, string> = {
	plan: "等待规划生成...",
	render: "等待角色和分镜渲染生成...",
	compose: "等待视频合成...",
};

const SECTION_STATUS_LABELS: Record<SectionState, string> = {
	draft: "待生成",
	generating: "生成中",
	blocked: "待生成",
	complete: "已完成",
};

// Layout constants
const CARD_GAP = 16;
const SECTION_GAP = 24;
const PLAN_SECTION_DEFAULT_H = 200;
const CARD_DEFAULT_H = 380;
const COMPOSE_DEFAULT_H = 300;
// Default heights for section containers (will be updated by useDomSize)
const CHARACTER_SECTION_DEFAULT_H = 400;
const STORYBOARD_SECTION_DEFAULT_H = 400;

interface UseCanvasLayoutProps {
	projectId: number;
	story: string | null;
	summary: string | null;
	characters: Character[];
	shots: Shot[];
	textStages: TextStage[];
	videoUrl: string | null;
	videoTitle: string;
	visibleSections: readonly SectionKey[];
	isGenerating: boolean;
	awaitingConfirm: boolean;
	currentRunId: number | null;
	currentStage: WorkflowStage;
	config?: Partial<LayoutConfig>;
}

function deriveSectionState(
	key: SectionKey,
	data: {
		story: string | null;
		summary: string | null;
		characters: Character[];
		shots: Shot[];
		textStages: TextStage[];
		videoUrl: string | null;
		isGenerating: boolean;
		awaitingConfirm: boolean;
		currentRunId: number | null;
	},
): SectionState {
	const isActive =
		data.isGenerating || data.awaitingConfirm || Boolean(data.currentRunId);
	const hasContent = Boolean(data.story) || Boolean(data.summary);
	const hasTextStages = data.textStages.length > 0;
	const hasCharImages = data.characters.some((c) => Boolean(c.image_url));
	const hasStoryboardImg = data.shots.some((s) => Boolean(s.image_url));

	switch (key) {
		case "plan":
			return isActive && !hasContent && !hasTextStages
				? "generating"
				: hasContent || hasTextStages
					? "complete"
					: "draft";
		case "render":
			if (data.characters.length === 0 && data.shots.length === 0)
				return "blocked";
			if (hasCharImages && hasStoryboardImg) return "complete";
			if (isActive) return "generating";
			return "draft";
		case "compose":
			return data.videoUrl
				? "complete"
				: data.shots.length === 0
					? "blocked"
					: isActive
						? "generating"
						: "draft";
	}
}

function isPlaceholder(
	key: SectionKey,
	data: {
		story: string | null;
		summary: string | null;
		characters: Character[];
		shots: Shot[];
		textStages: TextStage[];
		videoUrl: string | null;
	},
): boolean {
	switch (key) {
		case "plan":
			return !data.story && !data.summary && data.textStages.length === 0;
		case "render":
			return data.characters.length === 0 && data.shots.length === 0;
		case "compose":
			return !data.videoUrl;
	}
}

export type { SectionKey, SectionState };
export {
	SECTION_ORDER,
	SECTION_LABELS,
	SECTION_PLACEHOLDER_TEXT,
	SECTION_STATUS_LABELS,
};

export interface CanvasLayoutResult {
	shapes: TLShapePartial[];
}

export function useCanvasLayout({
	projectId,
	story,
	summary,
	characters,
	shots,
	textStages,
	videoUrl,
	videoTitle,
	visibleSections,
	isGenerating,
	awaitingConfirm,
	currentRunId,
	currentStage: _currentStage,
	config: customConfig,
}: UseCanvasLayoutProps) {
	const config = useMemo(
		() => ({ ...DEFAULT_CONFIG, ...customConfig }),
		[customConfig],
	);

	const sectionData = useMemo(
		() => ({
			story,
			summary,
			characters,
			shots,
			textStages,
			videoUrl,
			isGenerating,
			awaitingConfirm,
			currentRunId,
		}),
		[
			story,
			summary,
			characters,
			shots,
			textStages,
			videoUrl,
			isGenerating,
			awaitingConfirm,
			currentRunId,
		],
	);

	const result = useMemo(() => {
		const visibleSet = new Set(visibleSections);
		const visibleList = SECTION_ORDER.filter((s) => visibleSet.has(s));
		const sectionStates: Partial<Record<SectionKey, SectionState>> = {};
		const placeholders: Partial<Record<SectionKey, boolean>> = {};
		const statusLabels: Partial<Record<SectionKey, string>> = {};
		const placeholderTexts: Partial<Record<SectionKey, string>> = {};

		for (const section of visibleList) {
			const state = deriveSectionState(section, sectionData);
			sectionStates[section] = state;
			placeholders[section] = isPlaceholder(section, sectionData);
			statusLabels[section] = SECTION_STATUS_LABELS[state];
			placeholderTexts[section] = SECTION_PLACEHOLDER_TEXT[section];
		}

		const shapes: TLShapePartial[] = [];
		const { startX, startY, boardWidth } = config;
		let currentY = startY;

		// --- Plan Section (full width) ---
		if (visibleSet.has("plan")) {
			shapes.push({
				id: createShapeId("plan-section"),
				type: SHAPE_TYPES.PLAN_SECTION,
				x: startX,
				y: currentY,
				props: {
					w: boardWidth,
					h: PLAN_SECTION_DEFAULT_H,
					projectId,
					story: story || "",
					summary: summary || "",
					characters,
					shots,
					textStages,
					sectionState: sectionStates.plan ?? "draft",
					placeholder: placeholders.plan ?? true,
					statusLabel: statusLabels.plan ?? "待生成",
					placeholderText: placeholderTexts.plan ?? "等待规划生成...",
				},
			} satisfies TLShapePartial<PlanSectionShape>);
			currentY += PLAN_SECTION_DEFAULT_H + SECTION_GAP;
		}

		// --- Render Section (characters + shots grouped together) ---
		if (visibleSet.has("render")) {
			// Character Section (container for character cards)
			const charSectionId = createShapeId("character-section");
			const charRows = Math.max(1, Math.ceil(characters.length / 2));
			const charSectionH =
				characters.length > 0
					? charRows * (CARD_DEFAULT_H + CARD_GAP)
					: CHARACTER_SECTION_DEFAULT_H;

			shapes.push({
				id: charSectionId,
				type: SHAPE_TYPES.CHARACTER_SECTION,
				x: startX,
				y: currentY,
				props: {
					w: boardWidth,
					h: charSectionH,
					characters,
					sectionState: sectionStates.render ?? "draft",
					placeholder: characters.length === 0,
					statusLabel: statusLabels.render ?? "待生成",
					placeholderText: placeholderTexts.render ?? "等待角色渲染生成...",
					sectionTitle: "角色",
				},
			} satisfies TLShapePartial<CharacterSectionShape>);
			currentY += charSectionH + SECTION_GAP;

			// Storyboard/Shot Section (container for shot cards)
			const shotSectionId = createShapeId("storyboard-section");
			const shotRows = Math.max(1, Math.ceil(shots.length / 2));
			const shotSectionH =
				shots.length > 0
					? shotRows * (CARD_DEFAULT_H + CARD_GAP)
					: STORYBOARD_SECTION_DEFAULT_H;

			shapes.push({
				id: shotSectionId,
				type: SHAPE_TYPES.STORYBOARD_SECTION,
				x: startX,
				y: currentY,
				props: {
					w: boardWidth,
					h: shotSectionH,
					shots,
					sectionTitle: "分镜画面",
					sectionState: sectionStates.render ?? "draft",
					placeholder: shots.length === 0,
					statusLabel: statusLabels.render ?? "待生成",
					placeholderText: "等待分镜画面生成...",
				},
			} satisfies TLShapePartial<StoryboardSectionShape>);
			currentY += shotSectionH + SECTION_GAP;
		}

		// --- Compose Section (full width) ---
		if (visibleSet.has("compose")) {
			shapes.push({
				id: createShapeId("compose-section"),
				type: SHAPE_TYPES.COMPOSE_SECTION,
				x: startX,
				y: currentY,
				props: {
					w: boardWidth,
					h: COMPOSE_DEFAULT_H,
					projectId,
					videoUrl: videoUrl || "",
					videoTitle,
					downloadUrl: `/api/v1/projects/${projectId}/final-video`,
					sectionState: sectionStates.compose ?? "draft",
					placeholder: placeholders.compose ?? true,
					statusLabel: statusLabels.compose ?? "待生成",
					placeholderText: placeholderTexts.compose ?? "等待视频合成...",
				},
			} satisfies TLShapePartial<ComposeSectionShape>);
		}

		return { shapes };
	}, [
		story,
		summary,
		characters,
		shots,
		videoUrl,
		videoTitle,
		config,
		sectionData,
		visibleSections,
		projectId,
	]);

	return result;
}

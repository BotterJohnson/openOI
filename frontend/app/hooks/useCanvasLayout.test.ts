import { describe, it, expect } from "vitest";
import { useCanvasLayout } from "./useCanvasLayout";
import { renderHook } from "@testing-library/react";
import type { SectionKey } from "./useCanvasLayout";
import type { Character, Shot } from "~/types";

const defaultProps = {
	projectId: 1,
	story: "test story",
	summary: "test summary",
	characters: [] as Character[],
	shots: [] as Shot[],
	textStages: [],
	videoUrl: null as string | null,
	videoTitle: "Video",
	visibleSections: ["plan"] as SectionKey[],
	isGenerating: false,
	awaitingConfirm: false,
	currentRunId: null as number | null,
	currentStage: "plan" as const,
};

function makeCharacter(id: number, name: string): Character {
	return {
		id,
		project_id: 1,
		name,
		description: "",
		image_url: null,
		approval_state: "draft",
		approval_version: 1,
		approved_at: null,
		approved_name: null,
		approved_description: null,
		approved_image_url: null,
	} as unknown as Character;
}

function makeShot(id: number, order: number): Shot {
	return {
		id,
		project_id: 1,
		order,
		description: "",
		prompt: "",
		image_prompt: "",
		image_url: null,
		video_url: null,
		seed: null,
		duration: null,
		camera: null,
		motion_note: null,
		scene: null,
		action: null,
		expression: null,
		lighting: null,
		dialogue: null,
		sfx: null,
		character_ids: [],
		approval_state: "draft",
		approval_version: 1,
		approved_at: null,
		approved_description: null,
		approved_prompt: null,
		approved_image_prompt: null,
		approved_duration: null,
		approved_camera: null,
		approved_motion_note: null,
		approved_scene: null,
		approved_action: null,
		approved_expression: null,
		approved_lighting: null,
		approved_dialogue: null,
		approved_sfx: null,
		approved_character_ids: [],
	} as unknown as Shot;
}

describe("useCanvasLayout", () => {
	it("returns a plan-section shape when plan is visible", () => {
		const { result } = renderHook(() =>
			useCanvasLayout({
				...defaultProps,
				visibleSections: ["plan"] as SectionKey[],
			}),
		);
		const types = result.current.shapes.map((s) => s.type);
		expect(types).toContain("plan-section");
	});

	it("does not return plan-section when plan is not visible", () => {
		const { result } = renderHook(() =>
			useCanvasLayout({
				...defaultProps,
				visibleSections: [] as SectionKey[],
			}),
		);
		const types = result.current.shapes.map((s) => s.type);
		expect(types).not.toContain("plan-section");
	});

	it("creates a character-section with characters prop", () => {
		const characters = [makeCharacter(1, "Alice"), makeCharacter(2, "Bob")];
		const { result } = renderHook(() =>
			useCanvasLayout({
				...defaultProps,
				characters,
				visibleSections: ["plan", "render"] as SectionKey[],
			}),
		);
		const charSection = result.current.shapes.find(
			(s) => s.type === "character-section",
		);
		expect(charSection).toBeDefined();
		expect(
			(charSection!.props as Record<string, unknown>).characters,
		).toHaveLength(2);
	});

	it("creates a storyboard-section with shots prop", () => {
		const shots = [makeShot(10, 1), makeShot(20, 2)];
		const { result } = renderHook(() =>
			useCanvasLayout({
				...defaultProps,
				shots,
				visibleSections: ["plan", "render"] as SectionKey[],
			}),
		);
		const shotSection = result.current.shapes.find(
			(s) => s.type === "storyboard-section",
		);
		expect(shotSection).toBeDefined();
		expect((shotSection!.props as Record<string, unknown>).shots).toHaveLength(
			2,
		);
	});

	it("creates a compose-section shape when compose is visible", () => {
		const { result } = renderHook(() =>
			useCanvasLayout({
				...defaultProps,
				videoUrl: "http://example.com/video.mp4",
				visibleSections: ["plan", "render", "compose"] as SectionKey[],
			}),
		);
		const types = result.current.shapes.map((s) => s.type);
		expect(types).toContain("compose-section");
	});

	it("does not create compose-section when compose is not visible", () => {
		const { result } = renderHook(() =>
			useCanvasLayout({
				...defaultProps,
				videoUrl: "http://example.com/video.mp4",
				visibleSections: ["plan"] as SectionKey[],
			}),
		);
		const types = result.current.shapes.map((s) => s.type);
		expect(types).not.toContain("compose-section");
	});

	it("assigns stable shape IDs to section shapes", () => {
		const characters = [makeCharacter(42, "Test")];
		const { result } = renderHook(() =>
			useCanvasLayout({
				...defaultProps,
				characters,
				visibleSections: ["plan", "render"] as SectionKey[],
			}),
		);
		const charSection = result.current.shapes.find(
			(s) => s.type === "character-section",
		);
		expect(charSection).toBeDefined();
		// Shape ID should be stable across re-renders
		const { result: result2 } = renderHook(() =>
			useCanvasLayout({
				...defaultProps,
				characters,
				visibleSections: ["plan", "render"] as SectionKey[],
			}),
		);
		const charSection2 = result2.current.shapes.find(
			(s) => s.type === "character-section",
		);
		expect(charSection2?.id).toBe(charSection?.id);
	});

	it("marks plan section state as generating when generating", () => {
		const { result } = renderHook(() =>
			useCanvasLayout({
				...defaultProps,
				isGenerating: true,
				story: null,
				summary: null,
				visibleSections: ["plan"] as SectionKey[],
			}),
		);
		const planShape = result.current.shapes.find(
			(s) => s.type === "plan-section",
		);
		expect(planShape?.props).toBeDefined();
		expect((planShape!.props as Record<string, unknown>).sectionState).toBe(
			"generating",
		);
	});

	it("marks plan section state as complete when story exists", () => {
		const { result } = renderHook(() =>
			useCanvasLayout({
				...defaultProps,
				story: "hello",
				summary: "world",
				visibleSections: ["plan"] as SectionKey[],
			}),
		);
		const planShape = result.current.shapes.find(
			(s) => s.type === "plan-section",
		);
		expect(planShape?.props).toBeDefined();
		expect((planShape!.props as Record<string, unknown>).sectionState).toBe(
			"complete",
		);
	});

	it("passes text stages into the plan section and marks it complete", () => {
		const textStages = [
			{
				stage: "text_chapter_prose",
				name: "故事正文",
				status: "completed",
				order: 5,
				artifact_id: 10,
				run_id: 1,
				content: { prose: "暮色压住青岚宗外门。" },
			},
		] as never;
		const { result } = renderHook(() =>
			useCanvasLayout({
				...defaultProps,
				story: null,
				summary: null,
				textStages,
				visibleSections: ["plan"] as SectionKey[],
			}),
		);
		const planShape = result.current.shapes.find(
			(s) => s.type === "plan-section",
		);
		expect((planShape!.props as Record<string, unknown>).sectionState).toBe(
			"complete",
		);
		expect((planShape!.props as Record<string, unknown>).textStages).toEqual(
			textStages,
		);
	});
});

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type Editor,
	type TLComponents,
	Tldraw,
	type TLShapePartial,
} from "tldraw";
import "tldraw/tldraw.css";
import { useQuery } from "@tanstack/react-query";
import { useCanvasLayout } from "~/hooks/useCanvasLayout";
import type { SectionKey } from "~/hooks/useCanvasLayout";
import { SECTION_ORDER } from "~/hooks/useCanvasLayout";
import {
	getStaticUrl,
	projectsApi,
	assetsApi,
	charactersApi,
	shotsApi,
} from "~/services/api";
import { useEditorStore, useShallow } from "~/stores/editorStore";
import { CanvasToolbar } from "./CanvasToolbar";
import { canvasEvents, type CanvasEvents } from "./canvasEvents";
import { ImagePreviewModal, VideoPreviewModal } from "./PreviewModals";
import { customShapeUtils } from "./shapes";
import { getPipelineStageIndex } from "~/utils/pipeline";
import { toast } from "~/utils/toast";
import { ShapeContextMenu } from "./ShapeContextMenu";

interface InfiniteCanvasProps {
	projectId: number;
}

const components: TLComponents = {
	PageMenu: null,
	MainMenu: null,
	Toolbar: null,
	StylePanel: null,
	NavigationPanel: undefined,
	Minimap: undefined,
	HelpMenu: null,
	DebugPanel: null,
	DebugMenu: null,
	MenuPanel: null,
	TopPanel: null,
	SharePanel: null,
	ActionsMenu: null,
	QuickActions: null,
	KeyboardShortcutsDialog: null,
	HelperButtons: null,
	ZoomMenu: null,
	ContextMenu: null,
};

/** Shape types from the old monolithic layout that should be cleaned up */
const STALE_SHAPE_TYPES = new Set([
	"connector",
	"ConnectorShape",
	"arrow",
	"storyboard-board",
]);

export function InfiniteCanvas({ projectId }: InfiniteCanvasProps) {
	const editorRef = useRef<Editor | null>(null);
	const canvasContainerRef = useRef<HTMLDivElement | null>(null);
	const [isInitialized, setIsInitialized] = useState(false);
	const lastAppliedShapesSignatureRef = useRef<string | null>(null);
	const shapesRef = useRef<TLShapePartial[]>([]);
	const shapesSignatureRef = useRef("");

	const {
		characters,
		shots,
		textStages,
		projectVideoUrl,
		projectTitle,
		projectSummary,
		projectStory,
		currentStage,
		isGenerating,
		awaitingConfirm,
		recoverySummary,
		currentRunId,
	} = useEditorStore(
		useShallow((s) => ({
			characters: s.characters,
			shots: s.shots,
			textStages: s.textStages,
			projectVideoUrl: s.projectVideoUrl,
			projectTitle: s.projectTitle,
			projectSummary: s.projectSummary,
			projectStory: s.projectStory,
			currentStage: s.currentStage,
			isGenerating: s.isGenerating,
			awaitingConfirm: s.awaitingConfirm,
			recoverySummary: s.recoverySummary,
			currentRunId: s.currentRunId,
		})),
	);

	const { data: project } = useQuery({
		queryKey: ["project", projectId],
		queryFn: () => projectsApi.get(projectId),
	});

	const [previewImage, setPreviewImage] = useState<{
		src: string;
		alt: string;
	} | null>(null);
	const [previewVideo, setPreviewVideo] = useState<{
		src: string;
		title: string;
	} | null>(null);

	const rawVideoUrl = projectVideoUrl || project?.video_url;
	const finalVideoUrl = rawVideoUrl ? getStaticUrl(rawVideoUrl) : null;
	const story = projectStory ?? project?.story ?? null;
	const summary = projectSummary ?? project?.summary ?? null;
	const videoTitle = projectTitle ?? project?.title ?? "最终视频";

	const currentStageIndex = useMemo(
		() => getPipelineStageIndex(recoverySummary?.current_stage ?? currentStage),
		[recoverySummary, currentStage],
	);

	const visibleSections = useMemo((): SectionKey[] => {
		const sectionIndex = Math.max(
			currentStageIndex >= 0 ? currentStageIndex : 0,
			recoverySummary?.preserved_stages?.reduce(
				(max, s) => Math.max(max, getPipelineStageIndex(s)),
				0,
			) ?? 0,
		);

		return SECTION_ORDER.filter((section) => {
			if (section === "plan") return true;
			if (section === "render")
				return (
					characters.length > 0 ||
					shots.some((s) => Boolean(s.image_url)) ||
					sectionIndex >= 1
				);
			if (section === "compose")
				return (
					Boolean(finalVideoUrl) ||
					shots.some((s) => Boolean(s.video_url)) ||
					sectionIndex >= 2
				);
			return false;
		});
	}, [characters, shots, finalVideoUrl, currentStageIndex, recoverySummary]);

	const layout = useCanvasLayout({
		projectId,
		story,
		summary,
		characters,
		shots,
		textStages,
		videoUrl: finalVideoUrl,
		videoTitle,
		visibleSections,
		isGenerating,
		awaitingConfirm,
		currentRunId,
		currentStage,
	});

	const shapesSignature = useMemo(() => JSON.stringify(layout), [layout]);
	shapesRef.current = layout.shapes;
	shapesSignatureRef.current = shapesSignature;

	const handleShapeAction = useCallback(
		(data: CanvasEvents["shape-action"]) => {
			if (
				data.action === "add-to-assets" &&
				data.entityType === "character" &&
				data.entityId
			) {
				assetsApi
					.createFromCharacter(data.entityId)
					.then(() => {
						toast.success({ title: "资产库", message: "已添加到资产库" });
					})
					.catch(() => {
						toast.error({ title: "资产库", message: "添加失败" });
					});
				return;
			}

			if (
				data.action === "add-to-assets" &&
				data.entityType === "shot" &&
				data.entityId
			) {
				assetsApi
					.createFromShot(data.entityId)
					.then(() => {
						toast.success({ title: "资产库", message: "已保存为场景资产" });
					})
					.catch(() => {
						toast.error({ title: "资产库", message: "保存失败" });
					});
				return;
			}

			if (data.action === "approve") {
				const request =
					data.entityType === "character"
						? charactersApi.approve(data.entityId)
						: shotsApi.approve(data.entityId);
				request
					.then(() => {
						toast.success({ title: "审批", message: "已批准" });
					})
					.catch(() => {
						toast.error({ title: "审批", message: "批准失败" });
					});
				return;
			}

			if (data.action === "regenerate") {
				const request =
					data.entityType === "character"
						? charactersApi.regenerate(data.entityId)
						: shotsApi.regenerate(data.entityId, "image");
				request
					.then(() => {
						toast.success({ title: "重新生成", message: "任务已启动" });
					})
					.catch(() => {
						toast.error({ title: "重新生成", message: "启动失败" });
					});
				return;
			}

			if (
				data.action === "edit" &&
				data.entityType === "shot" &&
				data.shotPatch
			) {
				shotsApi
					.update(data.entityId, data.shotPatch)
					.then(() => {
						toast.success({ title: "镜头", message: "已保存修改" });
					})
					.catch(() => {
						toast.error({ title: "镜头", message: "保存失败" });
					});
				return;
			}

			if (data.action === "edit") {
				const content = data.feedbackContent?.trim();
				if (!content) return;
				projectsApi
					.feedback(
						projectId,
						content,
						currentRunId ?? undefined,
						data.feedbackType,
						data.entityType,
						data.entityId,
					)
					.then(() => {
						toast.success({ title: "修改意见", message: "已提交" });
					})
					.catch(() => {
						toast.error({ title: "修改意见", message: "提交失败" });
					});
			}
		},
		[projectId, currentRunId],
	);

	useEffect(() => {
		const unsubscribers = [
			canvasEvents.on("preview-image", setPreviewImage),
			canvasEvents.on("preview-video", setPreviewVideo),
			canvasEvents.on("shape-action", handleShapeAction),
		];
		return () => {
			unsubscribers.forEach((unsub) => unsub());
		};
	}, [handleShapeAction]);

	const handleMount = useCallback((editor: Editor) => {
		editorRef.current = editor;

		editor.setCameraOptions({
			...editor.getCameraOptions(),
			wheelBehavior: "zoom",
		});

		// Delete any stale shapes from previous layout architectures
		const allShapes = editor.getCurrentPageShapes();
		const staleShapeIds = allShapes
			.filter((s) => STALE_SHAPE_TYPES.has(s.type))
			.map((s) => s.id);
		if (staleShapeIds.length > 0) {
			editor.deleteShapes(staleShapeIds);
		}

		// Create initial shapes (parents first, then children with parentId)
		const currentShapes = shapesRef.current;
		const currentSignature = shapesSignatureRef.current;

		if (currentShapes.length > 0) {
			const parents = currentShapes.filter((s) => !s.parentId);
			const children = currentShapes.filter((s) => s.parentId);
			editor.run(() => {
				if (parents.length > 0) editor.createShapes(parents);
				if (children.length > 0) editor.createShapes(children);
			});
			lastAppliedShapesSignatureRef.current = currentSignature;
			setTimeout(() => {
				editor.zoomToFit({ animation: { duration: 300 } });
			}, 100);
		} else {
			lastAppliedShapesSignatureRef.current = currentSignature;
		}

		setIsInitialized(true);
	}, []);

	useEffect(() => {
		const container = canvasContainerRef.current;
		if (!container) return;

		const handleWheel = (event: WheelEvent) => {
			if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.shiftKey) {
				return;
			}

			const primaryScroller = container.closest(".project-page-scroll");
			if (!(primaryScroller instanceof HTMLElement)) {
				return;
			}

			if (Math.abs(event.deltaY) < Math.abs(event.deltaX)) {
				return;
			}

			const canScrollDown =
				primaryScroller.scrollTop + primaryScroller.clientHeight <
				primaryScroller.scrollHeight;
			const canScrollUp = primaryScroller.scrollTop > 0;
			const wantsDown = event.deltaY > 0;
			const wantsUp = event.deltaY < 0;

			if ((wantsDown && canScrollDown) || (wantsUp && canScrollUp)) {
				primaryScroller.scrollBy({ top: event.deltaY });
				event.preventDefault();
			}
		};

		container.addEventListener("wheel", handleWheel, { passive: false });
		return () => {
			container.removeEventListener("wheel", handleWheel);
		};
	}, []);

	// Sync shapes when layout changes — preserve user-dragged positions
	useEffect(() => {
		const editor = editorRef.current;
		if (!editor || !isInitialized) return;
		if (lastAppliedShapesSignatureRef.current === shapesSignature) return;

		const desiredShapes = layout.shapes;
		if (desiredShapes.length === 0) return;

		const existingShapes = editor.getCurrentPageShapes();
		const existingMap = new Map(existingShapes.map((s) => [s.id, s]));
		const desiredIds = new Set(desiredShapes.map((s) => s.id));

		editor.run(() => {
			// Delete shapes that are no longer in the layout
			const toDelete = existingShapes.filter(
				(s) => !desiredIds.has(s.id) && !STALE_SHAPE_TYPES.has(s.type),
			);
			if (toDelete.length > 0) {
				editor.deleteShapes(toDelete.map((s) => s.id));
			}

			// Separate parents (no parentId) from children (have parentId)
			const parents: TLShapePartial[] = [];
			const children: TLShapePartial[] = [];
			for (const desired of desiredShapes) {
				if (desired.parentId) {
					children.push(desired);
				} else {
					parents.push(desired);
				}
			}

			// Create/update parents first, then children (parentId requires parent to exist)
			const parentsToCreate: TLShapePartial[] = [];
			const parentsToUpdate: TLShapePartial[] = [];

			for (const desired of parents) {
				const existing = existingMap.get(desired.id);
				if (!existing) {
					parentsToCreate.push(desired);
				} else {
					parentsToUpdate.push({
						...desired,
						x: existing.x,
						y: existing.y,
					});
				}
			}

			if (parentsToCreate.length > 0) {
				editor.createShapes(parentsToCreate);
			}
			if (parentsToUpdate.length > 0) {
				editor.updateShapes(parentsToUpdate);
			}

			// Now create/update children
			const childrenToCreate: TLShapePartial[] = [];
			const childrenToUpdate: TLShapePartial[] = [];

			for (const desired of children) {
				const existing = existingMap.get(desired.id);
				if (!existing) {
					childrenToCreate.push(desired);
				} else {
					// Preserve user-dragged position for children too
					childrenToUpdate.push({
						...desired,
						x: existing.x,
						y: existing.y,
					});
				}
			}

			if (childrenToCreate.length > 0) {
				editor.createShapes(childrenToCreate);
			}
			if (childrenToUpdate.length > 0) {
				editor.updateShapes(childrenToUpdate);
			}
		});

		// If this is the first time we're adding shapes, zoom to fit
		if (existingShapes.length === 0 && desiredShapes.length > 0) {
			setTimeout(() => {
				editor.zoomToFit({ animation: { duration: 400 } });
			}, 100);
		}

		lastAppliedShapesSignatureRef.current = shapesSignature;
	}, [layout, shapesSignature, isInitialized]);

	return (
		<>
			<div
				ref={canvasContainerRef}
				className="h-full w-full infinite-canvas-container relative"
			>
				<Tldraw
					shapeUtils={customShapeUtils}
					components={components}
					onMount={handleMount}
					persistenceKey={`openoii-canvas-project-${projectId}`}
				>
					<CanvasToolbar />
					<ShapeContextMenu />
				</Tldraw>
			</div>

			{previewImage && (
				<ImagePreviewModal
					src={previewImage.src}
					alt={previewImage.alt}
					onClose={() => setPreviewImage(null)}
				/>
			)}

			{previewVideo && (
				<VideoPreviewModal
					src={previewVideo.src}
					title={previewVideo.title}
					onClose={() => setPreviewVideo(null)}
					showDownload={false}
				/>
			)}
		</>
	);
}

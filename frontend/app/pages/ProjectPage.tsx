import { ArrowPathIcon, StopIcon } from "@heroicons/react/24/outline";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
	Link,
	useNavigate,
	useParams,
	useSearchParams,
} from "react-router-dom";
import { ChatDrawer } from "~/components/chat/ChatDrawer";
import { TopBar } from "~/components/layout/TopBar";
import { StagePipeline } from "~/components/layout/StagePipeline";
import { StageView } from "~/components/layout/StageView";
import { AssetDrawer } from "~/components/panels/AssetDrawer";
import { HistoryDrawer } from "~/components/panels/HistoryDrawer";
import { TextStagePanel } from "~/components/project/TextStagePanel";
import { Button } from "~/components/ui/Button";
import { Card } from "~/components/ui/Card";
import { useProjectWebSocket } from "~/hooks/useWebSocket";
import { projectsApi } from "~/services/api";
import { useChatPanelStore } from "~/stores/chatPanelStore";
import { useEditorStore, useShallow } from "~/stores/editorStore";
import type {
	PipelineStageKey,
	ProjectProviderSettings,
	RecoveryControlRead,
	TextStage,
} from "~/types";
import { ApiError } from "~/types/errors";
import { toast } from "~/utils/toast";
import { isWorkflowStage } from "~/utils/workflowStage";

const TEXT_STAGE_STATUS_PRIORITY: Record<string, number> = {
	pending: 0,
	running: 1,
	completed: 2,
	needs_review: 2,
	failed: 2,
};

function mergeFetchedTextStages(
	currentStages: TextStage[],
	fetchedStages: TextStage[],
): TextStage[] {
	const merged = new Map(currentStages.map((stage) => [stage.stage, stage]));

	for (const fetched of fetchedStages) {
		const existing = merged.get(fetched.stage);
		if (!existing) {
			merged.set(fetched.stage, fetched);
			continue;
		}

		const existingPriority = TEXT_STAGE_STATUS_PRIORITY[existing.status] ?? 0;
		const fetchedPriority = TEXT_STAGE_STATUS_PRIORITY[fetched.status] ?? 0;
		const existingUpdatedAt = existing.updated_at ?? "";
		const fetchedUpdatedAt = fetched.updated_at ?? "";

		if (
			fetchedPriority > existingPriority ||
			(fetchedPriority === existingPriority && fetchedUpdatedAt > existingUpdatedAt)
		) {
			merged.set(fetched.stage, { ...existing, ...fetched });
			continue;
		}

		merged.set(fetched.stage, {
			...fetched,
			...existing,
			content: existing.content ?? fetched.content ?? null,
			artifact_id: Math.max(existing.artifact_id ?? 0, fetched.artifact_id ?? 0),
		});
	}

	return [...merged.values()].sort((a, b) => a.order - b.order);
}

function feedbackTypeForStage(stage: PipelineStageKey | "review" | string | null | undefined) {
	if (stage === "render") return "character";
	if (stage === "compose") return "compose";
	return "plan";
}

export function ProjectPage() {
	const { id } = useParams<{ id: string }>();
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const projectId = parseInt(id || "0", 10);
	const queryClient = useQueryClient();
	const {
		isGenerating: storeIsGenerating,
		currentRunId: storeCurrentRunId,
		currentStage: storeCurrentStage,
		awaitingConfirm: storeAwaitingConfirm,
		recoveryControl: storeRecoveryControl,
		runMode: storeRunMode,
		textStages: storeTextStages,
	} = useEditorStore(
		useShallow((s) => ({
			isGenerating: s.isGenerating,
			currentRunId: s.currentRunId,
			currentStage: s.currentStage,
			awaitingConfirm: s.awaitingConfirm,
			recoveryControl: s.recoveryControl,
			runMode: s.runMode,
			textStages: s.textStages,
		})),
	);
	const hasActiveRun = storeIsGenerating || Boolean(storeCurrentRunId);
	const hasRecovery = Boolean(storeRecoveryControl);
	const [assetsOpen, setAssetsOpen] = useState(false);
	const [historyOpen, setHistoryOpen] = useState(false);
	const autoStartTriggered = useRef(false);
	const generateRequestTokenRef = useRef(0);
	const retryCount = useRef(0);
	const openChat = useChatPanelStore((s) => s.open);

	const { send } = useProjectWebSocket(projectId);

	const syncStoreWithActiveRun = (run: {
		id: number;
		current_agent?: string | null;
		progress?: number | null;
		provider_snapshot?: ProjectProviderSettings | null;
	}) => {
		const s = useEditorStore.getState();
		s.setGenerating(true);
		s.setCurrentRunId(run.id);
		s.setCurrentAgent(run.current_agent ?? "orchestrator");
		s.setProgress(typeof run.progress === "number" ? run.progress : 0);
		s.setCurrentRunProviderSnapshot(run.provider_snapshot ?? null);
		s.setAwaitingConfirm(false, null, run.id);
		s.setRecoveryControl(null);
		s.setRecoverySummary(null);
		s.setRecoveryGate(null);
	};

	const {
		data: project,
		isLoading: projectLoading,
		error: projectError,
	} = useQuery({
		queryKey: ["project", projectId],
		queryFn: () => projectsApi.get(projectId),
		enabled: projectId > 0,
		retry: 1,
	});

	useEffect(() => {
		if (projectError) {
			const apiError = projectError instanceof ApiError ? projectError : null;
			toast.error({
				title: "无法加载项目",
				message: apiError?.message || "项目数据获取失败，请重试",
				actions: [
					{
						label: "重试",
						onClick: () =>
							queryClient.invalidateQueries({
								queryKey: ["project", projectId],
							}),
					},
				],
			});
		}
	}, [projectError, projectId, queryClient]);

	const { data: characters } = useQuery({
		queryKey: ["characters", projectId],
		queryFn: () => projectsApi.getCharacters(projectId),
		enabled: !!project,
	});

	const { data: shots } = useQuery({
		queryKey: ["shots", projectId],
		queryFn: () => projectsApi.getShots(projectId),
		enabled: !!project,
	});

	const { data: messages } = useQuery({
		queryKey: ["messages", projectId],
		queryFn: () => projectsApi.getMessages(projectId),
		enabled: !!project,
	});

	const { data: textStages } = useQuery({
		queryKey: ["text-stages", projectId],
		queryFn: () => projectsApi.getTextStages(projectId),
		enabled: !!project,
	});

	useEffect(() => {
		if (characters) {
			useEditorStore.getState().setCharacters(characters);
		}
	}, [characters]);

	useEffect(() => {
		if (shots) {
			useEditorStore.getState().setShots(shots);
		}
	}, [shots]);

	useEffect(() => {
		if (textStages) {
			const editorStore = useEditorStore.getState();
			editorStore.setTextStages(
				mergeFetchedTextStages(editorStore.textStages, textStages),
			);
		}
	}, [textStages]);

	useEffect(() => {
		if (project?.video_url) {
			useEditorStore.getState().setProjectVideoUrl(project.video_url);
		}
	}, [project?.video_url]);

	useEffect(() => {
		if (projectId <= 0) return;

		generateRequestTokenRef.current += 1;
		const editorStore = useEditorStore.getState();

		editorStore.clearMessages();
		editorStore.clearTextStages();
		editorStore.resetRunState();
		editorStore.setCurrentStage("plan");
		editorStore.setSelectedShot(null);
		editorStore.setSelectedCharacter(null);
		editorStore.setHighlightedMessage(null);
		editorStore.setProjectVideoUrl(null);
	}, [projectId]);

	const messagesLoadedRef = useRef(false);
	useEffect(() => {
		if (messages && !messagesLoadedRef.current) {
			messagesLoadedRef.current = true;
			const editorStore = useEditorStore.getState();
			messages.forEach((msg) => {
				editorStore.addMessage({
					id: `db_${msg.id}`,
					agent: msg.agent,
					role: msg.role,
					content: msg.content,
					timestamp: msg.created_at,
					progress: msg.progress ?? undefined,
					// 从数据库加载的消息不再显示为加载中
					isLoading: false,
				});
			});
		}
	}, [messages]);

	const generateMutation = useMutation({
		mutationFn: ({
			requestToken,
			startStage,
		}: {
			requestToken: number;
			startStage?: PipelineStageKey;
		}) =>
			projectsApi
				.generate(projectId, {
					auto_mode: storeRunMode === "yolo",
					start_stage: startStage,
				})
				.then((run) => ({ run, requestToken })),
		onSuccess: ({ run, requestToken }) => {
			if (requestToken !== generateRequestTokenRef.current) return;
			syncStoreWithActiveRun(run);
			retryCount.current = 0;
		},
		onError: async (error: Error | ApiError, variables) => {
			if (variables?.requestToken !== generateRequestTokenRef.current) return;
			const apiError = error instanceof ApiError ? error : null;
			const isConflict =
				apiError?.status === 409 || error.message.includes("409");

			if (isConflict) {
				retryCount.current = 0;
				const control = apiError?.response as RecoveryControlRead | undefined;
				if (control) {
					useEditorStore.getState().setRecoveryControl(control);
					useEditorStore
						.getState()
						.setRecoverySummary(control.recovery_summary);
					useEditorStore.getState().setCurrentRunId(control.active_run.id);
					useEditorStore.getState().setGenerating(control.state === "active");
					if (control.state === "active") {
						useEditorStore
							.getState()
							.setCurrentAgent(control.active_run.current_agent);
						useEditorStore.getState().setProgress(control.active_run.progress);
					}
					if (
						control.state === "recoverable" &&
						useEditorStore.getState().runMode === "yolo"
					) {
						resumeMutation.mutate(control);
						return;
					}
				} else {
					toast.warning({
						title: "请稍等片刻",
						message: "另一个任务正在进行，完成后再试",
					});
				}
			} else {
				toast.error({
					title: "生成失败",
					message:
						apiError?.message ||
						error.message ||
						"生成过程出错，请重试或联系支持",
					details: import.meta.env.DEV
						? JSON.stringify(apiError?.details)
						: undefined,
				});
			}
		},
	});

	const storeCurrentAgent = useEditorStore((s) => s.currentAgent);

	const feedbackMutation = useMutation({
		mutationFn: (content: string) =>
			projectsApi.feedback(
				projectId,
				content,
				undefined,
				feedbackTypeForStage(useEditorStore.getState().currentStage),
			),
		onError: (error: Error | ApiError) => {
			const apiError = error instanceof ApiError ? error : null;
			const isConflict =
				apiError?.status === 409 || error.message.includes("409");

			if (isConflict) {
				toast.info({
					title: "AI 正在思考",
					message: "请等待当前任务完成",
				});
			} else {
				toast.error({
					title: "提交失败",
					message: apiError?.message || error.message || "无法发送反馈，请重试",
				});
			}
		},
	});

	const cancelMutation = useMutation({
		mutationFn: () => projectsApi.cancel(projectId),
		onSettled: () => {
			useEditorStore.getState().resetRunState();
			useEditorStore.getState().addMessage({
				agent: "system",
				role: "system",
				content: "生成已停止",
				icon: StopIcon,
				timestamp: new Date().toISOString(),
			});
		},
	});

	const resumeMutation = useMutation({
		mutationFn: (controlOverride?: RecoveryControlRead | null) => {
			const control =
				controlOverride ?? useEditorStore.getState().recoveryControl;
			if (!control) {
				throw new Error("没有可恢复的运行");
			}
			const autoMode = useEditorStore.getState().runMode === "yolo";
			return projectsApi.resume(projectId, control.active_run.id, autoMode);
		},
		onSuccess: (run, controlOverride) => {
			const control =
				controlOverride ?? useEditorStore.getState().recoveryControl;
			const s = useEditorStore.getState();
			s.setGenerating(true);
			s.setCurrentRunId(run.id);
			s.setCurrentAgent(run.current_agent);
			s.setProgress(run.progress);
			s.setCurrentRunProviderSnapshot(run.provider_snapshot ?? null);
			if (control) {
				const nextStage =
					control.recovery_summary.next_stage ??
					control.recovery_summary.current_stage;
				if (isWorkflowStage(nextStage)) {
					s.setCurrentStage(nextStage);
				}
			}
			s.setRecoveryControl(null);
			s.setRecoverySummary(null);
			s.setRecoveryGate(null);
		},
		onError: (error: Error | ApiError) => {
			const apiError = error instanceof ApiError ? error : null;
			toast.error({
				title: "恢复失败",
				message:
					apiError?.message || error.message || "无法恢复当前运行，请重试",
			});
		},
	});

	const handleGenerate = async () => {
		if (generateMutation.isPending || hasActiveRun) return;
		const requestToken = generateRequestTokenRef.current + 1;
		generateRequestTokenRef.current = requestToken;
		useEditorStore.getState().clearMessages();
		useEditorStore.getState().clearTextStages();
		useEditorStore.getState().setCurrentStage("plan");
		generateMutation.mutate({ requestToken, startStage: "plan" });
	};

	const handleAdvanceStage = async () => {
		if (generateMutation.isPending || hasActiveRun) return;
		const current = storeCurrentStage;
		let startStage: PipelineStageKey = "plan";
		if (current === "plan") startStage = "render";
		if (current === "render") startStage = "compose";
		if (current === "compose") return;
		const requestToken = generateRequestTokenRef.current + 1;
		generateRequestTokenRef.current = requestToken;
		generateMutation.mutate({ requestToken, startStage });
	};

	const handleFeedback = (content: string) => {
		feedbackMutation.mutate(content);
		useEditorStore.getState().addMessage({
			agent: "user",
			role: "user",
			content,
			timestamp: new Date().toISOString(),
		});
	};

	const handleConfirm = (feedback?: string) => {
		const runId = storeCurrentRunId;
		if (runId) {
			send({ type: "confirm", data: { run_id: runId, feedback } });
			if (feedback) {
				useEditorStore.getState().addMessage({
					agent: "user",
					role: "user",
					content: feedback,
					timestamp: new Date().toISOString(),
				});
			}
		}
	};

	const handleCancel = () => {
		const activeRunId =
			storeCurrentRunId ?? storeRecoveryControl?.active_run.id ?? null;
		if (
			!activeRunId &&
			!storeIsGenerating &&
			storeRecoveryControl?.state !== "active"
		) {
			return;
		}
		generateRequestTokenRef.current += 1;
		cancelMutation.mutate();
	};

	const handleResume = () => {
		const control = useEditorStore.getState().recoveryControl;
		if (!control) return;
		resumeMutation.mutate(control);
	};

	useEffect(() => {
		if (!storeIsGenerating) {
			const progress = useEditorStore.getState().progress;
			if (progress === 1) {
				queryClient.invalidateQueries({ queryKey: ["characters", projectId] });
				queryClient.invalidateQueries({ queryKey: ["shots", projectId] });
			}
		}
	}, [storeIsGenerating, projectId, queryClient]);

	const projectUpdatedAt = useEditorStore((state) => state.projectUpdatedAt);
	useEffect(() => {
		if (projectUpdatedAt) {
			queryClient.invalidateQueries({ queryKey: ["project", projectId] });
			queryClient.invalidateQueries({ queryKey: ["projects"] });
		}
	}, [projectUpdatedAt, projectId, queryClient]);

	useEffect(() => {
		const autoStart = searchParams.get("autoStart");
		if (
			autoStart === "true" &&
			project &&
			!autoStartTriggered.current &&
			!hasActiveRun
		) {
			const editorStore = useEditorStore.getState();
			autoStartTriggered.current = true;
			setSearchParams({}, { replace: true });
			const requestToken = generateRequestTokenRef.current + 1;
			generateRequestTokenRef.current = requestToken;
			editorStore.clearMessages();
			editorStore.clearTextStages();
			editorStore.setCurrentStage("plan");
			generateMutation.mutate({ requestToken, startStage: "plan" });
		}
	}, [project, searchParams, setSearchParams, generateMutation]);

	if (projectLoading) {
		return (
			<div className="min-h-screen flex items-center justify-center flex-col gap-4 bg-base-100">
				<ArrowPathIcon className="w-6 h-6 animate-pulse text-base-content/60" />
				<p className="font-sketch text-2xl text-base-content/80">
					正在加载项目...
				</p>
			</div>
		);
	}

	if (!project) {
		return (
			<div className="min-h-screen flex items-center justify-center bg-base-100">
				<Card className="text-center">
					<h1 className="text-2xl font-heading font-bold mb-4">项目未找到</h1>
					<Link to="/">
						<Button variant="primary">返回首页</Button>
					</Link>
				</Card>
			</div>
		);
	}

	return (
		<div className="h-screen flex flex-col bg-base-100 font-sans overflow-hidden">
			<TopBar
				onToggleAssets={() => setAssetsOpen((v) => !v)}
				onToggleHistory={() => setHistoryOpen((v) => !v)}
				assetsOpen={assetsOpen}
				historyOpen={historyOpen}
				projectId={projectId}
			/>
			<StagePipeline
				currentStage={storeCurrentStage}
				isGenerating={storeIsGenerating}
				awaitingConfirm={storeAwaitingConfirm}
				hasRecovery={hasRecovery}
				onResume={handleResume}
				onCancel={handleCancel}
			/>

			<div className="flex-1 flex overflow-hidden">
				<div className="project-page-scroll flex-1 min-w-0 overflow-y-auto">
					<div className="space-y-4 p-4">
						<Card className="rounded-lg border border-base-content/10 p-4">
							<div className="flex flex-wrap items-center justify-between gap-3">
								<div>
									<h2 className="m-0 text-lg font-heading font-bold text-base-content">
										文本生成工作台
									</h2>
									<p className="m-0 mt-1 text-sm text-base-content/60">
										当前阶段：{storeCurrentStage}
									</p>
									<p className="m-0 mt-1 text-xs text-base-content/45">
										{storeTextStages.find((stage) => stage.status === "running")?.name ??
											(storeIsGenerating ? "文本任务执行中" : "等待开始")}
									</p>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<Button
										variant="primary"
										onClick={handleGenerate}
										disabled={hasActiveRun || generateMutation.isPending}
									>
										开始生成
									</Button>
									<Button
										variant="secondary"
										onClick={handleAdvanceStage}
										disabled={
											hasActiveRun ||
											generateMutation.isPending ||
											storeCurrentStage === "compose"
										}
									>
										下一步
									</Button>
									<Button
										variant="ghost"
										onClick={openChat}
									>
										打开对话
									</Button>
									{hasActiveRun && (
										<Button variant="error" onClick={handleCancel}>
											停止
										</Button>
									)}
								</div>
							</div>
						</Card>
						<TextStagePanel stages={storeTextStages} />
					</div>
					<div className="relative h-[calc(100%-1rem)] min-h-[32rem] overflow-hidden">
					<StageView projectId={projectId} />
					</div>
				</div>

				<ChatDrawer
					onSendFeedback={handleFeedback}
					onConfirm={handleConfirm}
					onGenerate={handleGenerate}
					onCancel={handleCancel}
					isGenerating={hasActiveRun}
					generateDisabled={false}
					generateDisabledReason={undefined}
				/>
			</div>

			<AssetDrawer
				open={assetsOpen}
				onClose={() => setAssetsOpen(false)}
				projectId={project.id}
			/>
			<HistoryDrawer
				open={historyOpen}
				onClose={() => setHistoryOpen(false)}
				onNavigate={(id) => navigate(`/project/${id}`)}
			/>
		</div>
	);
}

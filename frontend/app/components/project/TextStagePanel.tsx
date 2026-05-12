import { ChevronDownIcon, ChevronUpIcon, DocumentTextIcon } from "@heroicons/react/24/outline";
import { useState } from "react";
import type { TextStage } from "~/types";
import { Card } from "~/components/ui/Card";

function stringifyValue(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return JSON.stringify(value, null, 2);
}

function stageSummary(stage: TextStage): string {
	const content = stage.content ?? {};
	const candidates = [
		content.logline,
		content.premise,
		content.main_conflict,
		content.plot_flow,
		content.arrangement,
		content.prose,
		content.storyboard_script,
		content.video_prompts,
		content.warnings,
	];
	const first = candidates.find((value) => {
		if (Array.isArray(value)) return value.length > 0;
		return Boolean(stringifyValue(value).trim());
	});
	const text = stringifyValue(first).trim();
	if (!text) return "";
	return text.length > 120 ? `${text.slice(0, 120)}...` : text;
}

function stageDetail(stage: TextStage): string {
	const content = stage.content ?? {};
	const detailKeysByStage: Partial<Record<TextStage["stage"], string[]>> = {
		text_intake: ["user_input", "logline", "themes"],
		text_story_outline: ["premise", "worldview", "main_conflict", "chapter_count_plan"],
		text_chapter_flow: ["plot_flow"],
		text_arrangement: ["arrangement"],
		text_chapter_prose: ["prose"],
		text_storyboard: ["storyboard_script"],
		text_video_prompts: ["video_prompts"],
		text_consistency_review: ["warnings", "character_count", "shot_count", "video_prompt_count"],
	};
	const keys = detailKeysByStage[stage.stage] ?? [];
	const lines = keys
		.map((key) => {
			const value = stringifyValue(content[key as keyof typeof content]).trim();
			if (!value) return "";
			return value;
		})
		.filter(Boolean);
	return lines.join("\n\n");
}

function stageStatusMeta(stage: TextStage) {
	if (stage.status === "running") {
		return {
			label: "进行中",
			className: "bg-info/15 text-info",
			cardClassName: "border-info/30 ring-1 ring-info/20",
		};
	}
	if (stage.status === "failed") {
		return {
			label: "失败",
			className: "bg-error/15 text-error",
			cardClassName: "border-error/30",
		};
	}
	if (stage.status === "needs_review") {
		return {
			label: "需复核",
			className: "bg-warning/15 text-warning",
			cardClassName: "border-warning/30",
		};
	}
	if (stage.status === "completed") {
		return {
			label: "已完成",
			className: "bg-success/10 text-success",
			cardClassName: "border-base-content/10",
		};
	}
	return {
		label: "等待中",
		className: "bg-base-200 text-base-content/60",
		cardClassName: "border-base-content/10 opacity-80",
	};
}

function stageHint(stage: TextStage): string | null {
	if (stage.stage === "text_storyboard") {
		return "这是规划稿里的分镜脚本草案，不是独立可执行的渲染接口。真正出图走后面的渲染阶段。";
	}
	if (stage.stage === "text_video_prompts") {
		return "这是规划稿里的视频提示词参考，不是单独执行接口。真正出视频走后面的合成阶段。";
	}
	return null;
}

function StageCard({ stage }: { stage: TextStage }) {
	const [expanded, setExpanded] = useState(false);
	const meta = stageStatusMeta(stage);
	const summary = stageSummary(stage);
	const detail = stageDetail(stage);
	const hint = stageHint(stage);
	const canExpand = Boolean(detail && detail !== summary);

	return (
		<section className={`rounded-lg border bg-base-100 p-3 transition ${meta.cardClassName}`}>
			<div className="mb-2 flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h3 className="m-0 text-sm font-heading font-bold text-base-content">
						{stage.order}. {stage.name}
					</h3>
					{hint && (
						<p className="m-0 mt-1 text-[11px] leading-relaxed text-base-content/45">
							{hint}
						</p>
					)}
				</div>
				<span className={`shrink-0 rounded px-2 py-0.5 text-[11px] ${meta.className}`}>
					{meta.label}
				</span>
			</div>

			{summary ? (
				<>
					<p className="m-0 whitespace-pre-wrap break-words text-xs leading-relaxed text-base-content/70">
						{summary}
					</p>
					{canExpand && (
						<div className="mt-3">
							<button
								type="button"
								onClick={() => setExpanded((value) => !value)}
								className="inline-flex items-center gap-1 rounded-md border border-base-content/10 px-2 py-1 text-xs text-base-content/60 transition hover:bg-base-200"
							>
								{expanded ? (
									<>
										<ChevronUpIcon className="h-3.5 w-3.5" />
										收起详情
									</>
								) : (
									<>
										<ChevronDownIcon className="h-3.5 w-3.5" />
										展开详情
									</>
								)}
							</button>
							{expanded && (
								<pre className="m-0 mt-3 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-base-200/40 p-3 text-xs leading-relaxed text-base-content/70">
									{detail}
								</pre>
							)}
						</div>
					)}
				</>
			) : (
				<p className="m-0 text-xs text-base-content/45">
					{stage.status === "running" ? "该环节正在生成..." : "等待该环节产物"}
				</p>
			)}
		</section>
	);
}

export function TextStagePanel({ stages }: { stages: TextStage[] }) {
	if (stages.length === 0) return null;
	const completedCount = stages.filter(
		(stage) => stage.status === "completed" || stage.status === "needs_review",
	).length;
	const currentStage = stages.find((stage) => stage.status === "running");

	return (
		<Card
			title={
				<span className="flex items-center gap-2">
					<DocumentTextIcon className="h-5 w-5" />
					文本流水线
				</span>
			}
			className="rounded-lg border border-base-content/10 p-4"
		>
			<div className="mb-4 flex flex-wrap items-center justify-between gap-3">
				<div className="text-sm text-base-content/65">
					{currentStage ? `当前子目标：${currentStage.name}` : "当前子目标：等待调度"}
				</div>
				<div className="text-xs text-base-content/50">
					已完成 {completedCount} / {stages.length}
				</div>
			</div>
			<div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
				{stages.map((stage) => (
					<StageCard key={stage.stage} stage={stage} />
				))}
			</div>
		</Card>
	);
}

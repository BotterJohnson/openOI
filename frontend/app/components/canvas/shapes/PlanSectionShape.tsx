import {
	HTMLContainer,
	Rectangle2d,
	ShapeUtil,
	T,
	type Geometry2d,
	type RecordProps,
} from "tldraw";
import type {
	PlanSectionShape,
	ReviewedCharacter,
	ReviewedShot,
} from "./types";
import type { TextStage } from "~/types";
import { SectionShell } from "./SectionShell";
import {
	getWorkspaceSectionPlaceholderText,
	getWorkspaceSectionStatusLabel,
} from "~/utils/workspaceStatus";
import { useDomSize, getShapeSize } from "~/hooks/useDomSize";

function stringifyValue(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return JSON.stringify(value, null, 2);
}

function stagePreview(stage: TextStage): string {
	const content = stage.content ?? {};
	const candidates = [
		content.logline,
		content.premise,
		content.main_conflict,
		content.arrangement,
		content.prose,
		content.plot_flow,
		content.storyboard_script,
		content.video_prompts,
		content.warnings,
	];
	const first = candidates.find((value) => {
		if (Array.isArray(value)) return value.length > 0;
		return Boolean(stringifyValue(value).trim());
	});
	const text = stringifyValue(first);
	return text.length > 360 ? `${text.slice(0, 360)}...` : text;
}

function stageHint(stage: TextStage): string | null {
	if (stage.stage === "text_storyboard") {
		return "规划稿分镜，不是独立执行接口";
	}
	if (stage.stage === "text_video_prompts") {
		return "规划稿提示词，不是独立执行接口";
	}
	return null;
}

function TextStagePanel({ stage }: { stage: TextStage }) {
	const preview = stagePreview(stage);
	const isWarning =
		stage.status === "needs_review" ||
		(stage.content?.status && stage.content.status !== "passed");
	const hint = stageHint(stage);

	return (
		<div className="rounded-lg border border-base-content/10 bg-base-100 p-3">
			<div className="mb-2 flex items-center justify-between gap-3">
				<div className="min-w-0">
					<p className="m-0 text-sm font-semibold text-base-content">
						{stage.order}. {stage.name}
					</p>
					{hint && (
						<p className="m-0 mt-1 text-[11px] text-base-content/45">{hint}</p>
					)}
				</div>
				<span
					className={`shrink-0 rounded px-2 py-0.5 text-[11px] ${
						isWarning
							? "bg-warning/15 text-warning"
							: "bg-success/10 text-success"
					}`}
				>
					{isWarning ? "需复核" : "已完成"}
				</span>
			</div>
			{preview ? (
				<pre className="m-0 max-h-32 overflow-hidden whitespace-pre-wrap break-words text-xs leading-relaxed text-base-content/65">
					{preview}
				</pre>
			) : (
				<p className="m-0 text-xs text-base-content/45">等待该环节产物</p>
			)}
		</div>
	);
}

export class PlanSectionShapeUtil extends ShapeUtil<PlanSectionShape> {
	static override type = "plan-section" as const;

	static override props: RecordProps<PlanSectionShape> = {
		w: T.number,
		h: T.number,
		projectId: T.number,
		story: T.string,
		summary: T.string,
		characters: T.any,
		shots: T.any,
		textStages: T.any,
		sectionState: T.string,
		placeholder: T.boolean,
		statusLabel: T.string,
		placeholderText: T.string,
	};

	getDefaultProps(): PlanSectionShape["props"] {
		return {
			w: 920,
			h: 200,
			projectId: 0,
			story: "",
			summary: "",
			characters: [],
			shots: [],
			textStages: [],
			sectionState: "draft",
			placeholder: true,
			statusLabel: getWorkspaceSectionStatusLabel("draft"),
			placeholderText: getWorkspaceSectionPlaceholderText("plan"),
		};
	}

	override canEdit() {
		return true;
	}
	override canResize() {
		return false;
	}
	override canCull() {
		return false;
	}

	getGeometry(shape: PlanSectionShape): Geometry2d {
		const size = this.editor ? getShapeSize(this.editor, shape.id) : undefined;
		return new Rectangle2d({
			width: shape.props.w,
			height: size?.height ?? shape.props.h,
			isFilled: true,
		});
	}

	component(shape: PlanSectionShape) {
		const {
			w,
			story,
			summary,
			characters,
			shots,
			textStages,
			placeholder,
			placeholderText,
			statusLabel,
		} = shape.props;
		const ref = useDomSize(shape, this.editor ?? null);
		const typedCharacters = characters as ReviewedCharacter[];
		const typedShots = shots as ReviewedShot[];
		const typedTextStages = textStages as TextStage[];

		return (
			<HTMLContainer
				style={{ width: w, pointerEvents: "all", overflow: "visible" }}
			>
				<div ref={ref} style={{ width: w }}>
					<SectionShell
						sectionKey="plan"
						sectionTitle="编剧规划"
						statusLabel={statusLabel}
						placeholder={placeholder}
						placeholderText={placeholderText}
					>
						<div className="space-y-4">
							{typedTextStages.length > 0 && (
								<div className="grid grid-cols-1 gap-3">
									{typedTextStages.map((stage) => (
										<TextStagePanel key={stage.stage} stage={stage} />
									))}
								</div>
							)}
							{typedTextStages.length === 0 && (story || summary) && (
								<div className="rounded-xl bg-secondary/10 p-4">
									{story && (
										<p className="m-0 whitespace-pre-wrap text-sm leading-relaxed text-base-content/80">
											{story}
										</p>
									)}
									{summary && (
										<p className="mt-3 border-t border-base-content/10 pt-3 text-xs leading-relaxed text-base-content/55">
											{summary}
										</p>
									)}
								</div>
							)}
							{typedShots.length > 0 && (
								<div className="overflow-hidden rounded-xl border border-base-content/10">
									<table className="w-full text-xs">
										<thead className="bg-base-200/80">
											<tr>
												<th className="w-10 px-3 py-2 text-left font-semibold">
													#
												</th>
												<th className="px-3 py-2 text-left font-semibold">
													描述
												</th>
												<th className="w-20 px-3 py-2 text-left font-semibold">
													运镜
												</th>
												<th className="w-16 px-3 py-2 text-left font-semibold">
													时长
												</th>
												<th className="w-28 px-3 py-2 text-left font-semibold">
													角色
												</th>
											</tr>
										</thead>
										<tbody>
											{typedShots.map((shot, i) => {
												const characterNames = shot.character_ids
													?.map(
														(id) =>
															typedCharacters.find((c) => c.id === id)?.name,
													)
													.filter(Boolean);
												return (
													<tr
														key={shot.id}
														className={
															i % 2 === 0 ? "bg-base-100" : "bg-base-200/30"
														}
													>
														<td className="px-3 py-2 font-mono text-base-content/60">
															{shot.order}
														</td>
														<td className="px-3 py-2 text-base-content/80">
															{shot.description}
														</td>
														<td className="px-3 py-2 text-base-content/60">
															{shot.camera || "-"}
														</td>
														<td className="px-3 py-2 text-base-content/60">
															{shot.duration ? `${shot.duration}s` : "-"}
														</td>
														<td className="px-3 py-2 text-base-content/60">
															{characterNames?.length
																? characterNames.join("、")
																: "-"}
														</td>
													</tr>
												);
											})}
										</tbody>
									</table>
								</div>
							)}
						</div>
					</SectionShell>
				</div>
			</HTMLContainer>
		);
	}

	indicator(shape: PlanSectionShape) {
		const size = this.editor ? getShapeSize(this.editor, shape.id) : undefined;
		return (
			<rect
				width={shape.props.w}
				height={size?.height ?? shape.props.h}
				rx={24}
			/>
		);
	}
}

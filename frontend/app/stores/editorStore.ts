import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import type {
	AgentMessage,
	BlockingClip,
	Character,
	ProjectProviderSettings,
	RecoveryControlRead,
	RecoverySummaryRead,
	RunAwaitingConfirmEventData,
	Shot,
	TextStage,
	WorkflowStage,
} from "~/types";

export type RunMode = "manual" | "yolo";

interface EditorState {
	selectedShotId: number | null;
	selectedCharacterId: number | null;
	highlightedMessageIndex: number | null;
	isGenerating: boolean;
	currentStage: WorkflowStage;
	currentAgent: string | null;
	progress: number;
	messages: AgentMessage[];
	recoveryControl: RecoveryControlRead | null;
	recoverySummary: RecoverySummaryRead | null;
	recoveryGate: RunAwaitingConfirmEventData | null;
	awaitingConfirm: boolean;
	awaitingAgent: string | null;
	currentRunId: number | null;
	currentRunProviderSnapshot: ProjectProviderSettings | null;
	runMode: RunMode;
	characters: Character[];
	shots: Shot[];
	textStages: TextStage[];
	projectVideoUrl: string | null;
	projectStatus: string | null;
	projectUpdatedAt: number | null;
	projectTitle: string | null;
	projectSummary: string | null;
	projectStory: string | null;
	projectStyle: string | null;
	projectTargetShotCount: number | null;
	projectCharacterHints: string[] | null;
	projectReferenceImages: string[] | null;
	blockingClips: BlockingClip[] | null;

	setSelectedShot: (id: number | null) => void;
	setSelectedCharacter: (id: number | null) => void;
	setHighlightedMessage: (index: number | null) => void;
	setGenerating: (isGenerating: boolean) => void;
	setCurrentStage: (stage: WorkflowStage) => void;
	setCurrentAgent: (agent: string | null) => void;
	setProgress: (progress: number) => void;
	addMessage: (message: AgentMessage) => void;
	setMessages: (messages: AgentMessage[]) => void;
	clearMessages: () => void;
	setRecoveryControl: (control: RecoveryControlRead | null) => void;
	setRecoverySummary: (summary: RecoverySummaryRead | null) => void;
	setRecoveryGate: (gate: RunAwaitingConfirmEventData | null) => void;
	setCharacters: (characters: Character[]) => void;
	setShots: (shots: Shot[]) => void;
	setTextStages: (stages: TextStage[]) => void;
	upsertTextStage: (stage: TextStage) => void;
	clearTextStages: () => void;
	setProjectVideoUrl: (url: string | null) => void;
	setProjectStatus: (status: string | null) => void;
	setProjectUpdatedAt: (timestamp: number) => void;
	setProjectTitle: (title: string | null) => void;
	setProjectSummary: (summary: string | null) => void;
	setProjectStory: (story: string | null) => void;
	setProjectStyle: (style: string | null) => void;
	setProjectTargetShotCount: (count: number | null) => void;
	setProjectCharacterHints: (hints: string[] | null) => void;
	setProjectReferenceImages: (images: string[] | null) => void;
	setBlockingClips: (clips: BlockingClip[] | null) => void;
	setAwaitingConfirm: (
		awaiting: boolean,
		agent?: string | null,
		runId?: number | null,
	) => void;
	setCurrentRunId: (runId: number | null) => void;
	setCurrentRunProviderSnapshot: (
		snapshot: ProjectProviderSettings | null,
	) => void;
	setRunMode: (mode: RunMode) => void;
	updateCharacter: (character: Character) => void;
	updateShot: (shot: Shot) => void;
	removeCharacter: (characterId: number) => void;
	removeShot: (shotId: number) => void;
	resetRunState: () => void;
	reset: () => void;
}

const initialRunState = {
	isGenerating: false,
	currentAgent: null,
	progress: 0,
	recoveryControl: null,
	recoverySummary: null,
	recoveryGate: null,
	awaitingConfirm: false,
	awaitingAgent: null,
	currentRunId: null,
	currentRunProviderSnapshot: null,
};

const initialState = {
	selectedShotId: null,
	selectedCharacterId: null,
	highlightedMessageIndex: null,
	currentStage: "plan" as WorkflowStage,
	runMode: "manual" as RunMode,
	messages: [],
	characters: [],
	shots: [],
	textStages: [],
	projectVideoUrl: null,
	projectStatus: null,
	projectUpdatedAt: null,
	projectTitle: null,
	projectSummary: null,
	projectStory: null,
	projectStyle: null,
	projectTargetShotCount: null,
	projectCharacterHints: null,
	projectReferenceImages: null,
	blockingClips: null,
	...initialRunState,
};

export const useEditorStore = create<EditorState>()(
	devtools(
		(set) => ({
			...initialState,

			setSelectedShot: (id) =>
				set({ selectedShotId: id }, false, "setSelectedShot"),
			setSelectedCharacter: (id) =>
				set({ selectedCharacterId: id }, false, "setSelectedCharacter"),
			setHighlightedMessage: (index) =>
				set({ highlightedMessageIndex: index }, false, "setHighlightedMessage"),
			setGenerating: (isGenerating) =>
				set({ isGenerating }, false, "setGenerating"),
			setCurrentStage: (stage) =>
				set({ currentStage: stage }, false, "setCurrentStage"),
			setCurrentAgent: (agent) =>
				set({ currentAgent: agent }, false, "setCurrentAgent"),
			setProgress: (progress) => set({ progress }, false, "setProgress"),
			addMessage: (message) =>
				set(
					(state) => ({ messages: [...state.messages, message] }),
					false,
					"addMessage",
				),
			setMessages: (messages) => set({ messages }, false, "setMessages"),
			clearMessages: () =>
				set(
					{ messages: [], highlightedMessageIndex: null },
					false,
					"clearMessages",
				),
			setRecoveryControl: (control) =>
				set({ recoveryControl: control }, false, "setRecoveryControl"),
			setRecoverySummary: (summary) =>
				set({ recoverySummary: summary }, false, "setRecoverySummary"),
			setRecoveryGate: (gate) =>
				set({ recoveryGate: gate }, false, "setRecoveryGate"),
			setCharacters: (characters) =>
				set({ characters }, false, "setCharacters"),
			setShots: (shots) => set({ shots }, false, "setShots"),
			setTextStages: (textStages) =>
				set(
					{ textStages: [...textStages].sort((a, b) => a.order - b.order) },
					false,
					"setTextStages",
				),
			upsertTextStage: (stage) =>
				set(
					(state) => {
						const next = state.textStages.some((s) => s.stage === stage.stage)
							? state.textStages.map((s) =>
									s.stage === stage.stage ? { ...s, ...stage } : s,
								)
							: [...state.textStages, stage];
						return { textStages: next.sort((a, b) => a.order - b.order) };
					},
					false,
					"upsertTextStage",
				),
			clearTextStages: () =>
				set({ textStages: [] }, false, "clearTextStages"),
			setProjectVideoUrl: (url) =>
				set({ projectVideoUrl: url }, false, "setProjectVideoUrl"),
			setProjectStatus: (status) =>
				set({ projectStatus: status }, false, "setProjectStatus"),
			setProjectUpdatedAt: (timestamp) =>
				set({ projectUpdatedAt: timestamp }, false, "setProjectUpdatedAt"),
			setProjectTitle: (title) =>
				set({ projectTitle: title }, false, "setProjectTitle"),
			setProjectSummary: (summary) =>
				set({ projectSummary: summary }, false, "setProjectSummary"),
			setProjectStory: (story) =>
				set({ projectStory: story }, false, "setProjectStory"),
			setProjectStyle: (style) =>
				set({ projectStyle: style }, false, "setProjectStyle"),
			setProjectTargetShotCount: (count) =>
				set(
					{ projectTargetShotCount: count },
					false,
					"setProjectTargetShotCount",
				),
			setProjectCharacterHints: (hints) =>
				set(
					{ projectCharacterHints: hints },
					false,
					"setProjectCharacterHints",
				),
			setProjectReferenceImages: (images) =>
				set(
					{ projectReferenceImages: images },
					false,
					"setProjectReferenceImages",
				),
			setBlockingClips: (clips) =>
				set({ blockingClips: clips }, false, "setBlockingClips"),
			setAwaitingConfirm: (awaiting, agent = null, runId) =>
				set(
					(state) => ({
						awaitingConfirm: awaiting,
						awaitingAgent: agent,
						currentRunId: runId !== undefined ? runId : state.currentRunId,
					}),
					false,
					"setAwaitingConfirm",
				),
			setCurrentRunId: (runId) =>
				set({ currentRunId: runId }, false, "setCurrentRunId"),
			setCurrentRunProviderSnapshot: (snapshot) =>
				set(
					{ currentRunProviderSnapshot: snapshot },
					false,
					"setCurrentRunProviderSnapshot",
				),
			setRunMode: (mode) => set({ runMode: mode }, false, "setRunMode"),
			updateCharacter: (character) =>
				set(
					(state) => ({
						characters: state.characters.some((c) => c.id === character.id)
							? state.characters.map((c) =>
									c.id === character.id ? character : c,
								)
							: [...state.characters, character],
					}),
					false,
					"updateCharacter",
				),
			updateShot: (shot) =>
				set(
					(state) => ({
						shots: state.shots.some((s) => s.id === shot.id)
							? state.shots.map((s) => (s.id === shot.id ? shot : s))
							: [...state.shots, shot],
					}),
					false,
					"updateShot",
				),
			removeCharacter: (characterId) =>
				set(
					(state) => ({
						characters: state.characters.filter((c) => c.id !== characterId),
					}),
					false,
					"removeCharacter",
				),
			removeShot: (shotId) =>
				set(
					(state) => ({
						shots: state.shots.filter((s) => s.id !== shotId),
					}),
					false,
					"removeShot",
				),
			resetRunState: () => set(initialRunState, false, "resetRunState"),
			reset: () => set(initialState, false, "reset"),
		}),
		{ name: "EditorStore", enabled: import.meta.env.DEV },
	),
);

export { useShallow };

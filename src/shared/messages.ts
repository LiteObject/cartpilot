import type {
    ClarificationRequest,
    ConfirmationRequest,
    ExtensionSettings,
    ItemResult,
    ProgressEvent,
    RunState,
    RunStatus,
    SupportedSite
} from "./types";

export type ConfirmationDecision = "confirm" | "skip" | "cancel";

export type UiToBackgroundMessage =
    | { type: "GET_BOOTSTRAP" }
    | { type: "GET_RUN_STATE" }
    | { type: "SAVE_SETTINGS"; settings: ExtensionSettings }
    | { type: "START_RUN"; items: string[]; settings: ExtensionSettings }
    | { type: "CANCEL_RUN" }
    | { type: "SUBMIT_CLARIFICATION"; answer: string }
    | { type: "SUBMIT_CONFIRMATION"; decision: ConfirmationDecision };

export type BackgroundToContentMessage =
    | {
        type: "CONTENT_START_RUN";
        runId: string;
        items: string[];
        settings: ExtensionSettings;
        site: SupportedSite;
    }
    | { type: "CONTENT_CANCEL_RUN"; runId: string }
    | { type: "CONTENT_RESOLVE_CLARIFICATION"; answer: string }
    | { type: "CONTENT_RESOLVE_CONFIRMATION"; decision: ConfirmationDecision };

export type ContentToBackgroundMessage =
    | { type: "FLOW_PROGRESS"; progress: ProgressEvent }
    | { type: "FLOW_SET_STATUS"; status: RunStatus; currentItem: string | null }
    | { type: "FLOW_REQUEST_CLARIFICATION"; request: ClarificationRequest }
    | { type: "FLOW_REQUEST_CONFIRMATION"; request: ConfirmationRequest }
    | { type: "FLOW_CLEAR_PENDING" }
    | { type: "FLOW_ITEM_RESULT"; result: ItemResult }
    | { type: "FLOW_COMPLETE" }
    | { type: "FLOW_CANCELLED" }
    | { type: "FLOW_ERROR"; error: string };

export type RuntimeMessage = UiToBackgroundMessage | BackgroundToContentMessage | ContentToBackgroundMessage;

export interface MessageResponse<T = unknown> {
    ok: boolean;
    data?: T;
    error?: string;
}

export interface BootstrapResponse {
    settings: ExtensionSettings;
    runState: RunState;
    activeSite: string;
}
export type SupportedSite = "walmart" | "heb";
export type SiteId = SupportedSite | "unsupported";

export type RunStatus = "idle" | "running" | "waiting" | "completed" | "cancelled" | "error";

export type PriceIntent = "none" | "cheapest" | "cheapest-unit-price";

export type ProgressStage =
    | "queued"
    | "normalizing"
    | "searching"
    | "scraping"
    | "selecting"
    | "awaiting-clarification"
    | "awaiting-confirmation"
    | "adding"
    | "completed"
    | "cancelled"
    | "error";

export interface LlmConfig {
    provider: "ollama";
    endpoint: string;
    model: string;
    temperature: number;
}

export interface RunConfig {
    dryRun: boolean;
    maxResults: number;
    minHumanDelayMs: number;
    maxHumanDelayMs: number;
}

export interface ExtensionSettings {
    llm: LlmConfig;
    run: RunConfig;
}

export interface ProductCandidate {
    id: string;
    title: string;
    price: number | null;
    unitPrice: number | null;
    rating: number | null;
    productUrl: string | null;
    hasDirectAdd: boolean;
    summary: string;
}

export interface NormalizationResult {
    normalizedQuery: string;
    needsClarification: boolean;
    clarificationQuestion: string | null;
}

export interface ProductSelectionResult {
    selectedIndex: number | null;
    needsClarification: boolean;
    clarificationQuestion: string | null;
    reason: string;
}

export interface ItemResult {
    item: string;
    normalizedQuery?: string;
    selectedProduct?: ProductCandidate;
    outcome: "added" | "skipped" | "error" | "cancelled";
    reason?: string;
}

export interface ProgressEvent {
    stage: ProgressStage;
    message: string;
    item?: string;
    product?: ProductCandidate;
    timestamp: number;
}

export interface ClarificationRequest {
    id: string;
    item: string;
    question: string;
    context?: string;
}

export interface ConfirmationRequest {
    id: string;
    item: string;
    product: ProductCandidate;
}

export interface RunState {
    runId: string | null;
    tabId: number | null;
    site: SiteId;
    status: RunStatus;
    itemQueue: string[];
    currentItem: string | null;
    progress: ProgressEvent[];
    results: ItemResult[];
    pendingClarification: ClarificationRequest | null;
    pendingConfirmation: ConfirmationRequest | null;
    error: string | null;
    startedAt: number | null;
    completedAt: number | null;
    dryRun: boolean;
}

export interface BootstrapData {
    settings: ExtensionSettings;
    runState: RunState;
    activeSite: SiteId;
}
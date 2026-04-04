import type { ExtensionSettings, RunState, SiteId } from "./types";

export const STORAGE_KEYS = {
    settings: "cartpilot.settings",
    runState: "cartpilot.runState"
} as const;

export const DEFAULT_SETTINGS: ExtensionSettings = {
    llm: {
        provider: "ollama",
        endpoint: "http://127.0.0.1:11434/api/generate",
        model: "",
        temperature: 0.1
    },
    run: {
        dryRun: true,
        maxResults: 5,
        minHumanDelayMs: 350,
        maxHumanDelayMs: 900
    }
};

export function mergeSettings(input?: Partial<ExtensionSettings> | null): ExtensionSettings {
    return {
        llm: {
            ...DEFAULT_SETTINGS.llm,
            ...(input?.llm ?? {})
        },
        run: {
            ...DEFAULT_SETTINGS.run,
            ...(input?.run ?? {})
        }
    };
}

export function createIdleRunState(site: SiteId = "unsupported", dryRun = DEFAULT_SETTINGS.run.dryRun): RunState {
    return {
        runId: null,
        tabId: null,
        site,
        status: "idle",
        itemQueue: [],
        currentItem: null,
        progress: [],
        results: [],
        pendingClarification: null,
        pendingConfirmation: null,
        error: null,
        startedAt: null,
        completedAt: null,
        dryRun
    };
}

export function sanitizeItems(items: string[]): string[] {
    return items
        .flatMap((item) => item.split(","))
        .map((item) => item.trim())
        .filter(Boolean);
}
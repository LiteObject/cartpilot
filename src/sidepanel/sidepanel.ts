import type { UiToBackgroundMessage, MessageResponse } from "../shared/messages";
import { getSiteLabel } from "../shared/site";
import type { BootstrapData, ExtensionSettings, ItemResult, ProgressEvent, RunState } from "../shared/types";

interface PanelElements {
    siteBadge: HTMLSpanElement;
    statusBadge: HTMLSpanElement;
    llmSettingsDetails: HTMLDetailsElement;
    itemsInput: HTMLTextAreaElement;
    endpointInput: HTMLInputElement;
    modelInput: HTMLSelectElement;
    temperatureInput: HTMLInputElement;
    dryRunToggle: HTMLInputElement;
    startButton: HTMLButtonElement;
    cancelButton: HTMLButtonElement;
    refreshModelsButton: HTMLButtonElement;
    feedbackText: HTMLParagraphElement;
    pendingPanel: HTMLElement;
    pendingTitle: HTMLParagraphElement;
    pendingContext: HTMLParagraphElement;
    clarificationForm: HTMLFormElement;
    clarificationInput: HTMLInputElement;
    confirmationActions: HTMLDivElement;
    confirmButton: HTMLButtonElement;
    skipButton: HTMLButtonElement;
    cancelRunButton: HTMLButtonElement;
    resultsList: HTMLUListElement;
    progressList: HTMLUListElement;
}

let elements: PanelElements;
let hydratedSettings = false;
let lastFetchedEndpoint = "";
let lastSavedSettingsSnapshot = "";
let settingsSaveDebounce: ReturnType<typeof setTimeout> | null = null;
let savingSettings: Promise<void> | null = null;
let queuedSettingsSave = false;

interface OllamaTagsResponse {
    models?: Array<{ name: string }>;
}

function resolveBaseUrl(endpoint: string): string {
    const normalized = endpoint.trim().replace(/\/+$/, "");
    return normalized.replace(/\/api\/generate$/, "");
}

function serializeSettings(settings: ExtensionSettings): string {
    return JSON.stringify(settings);
}

async function persistSettingsIfNeeded(): Promise<void> {
    if (!hydratedSettings) {
        return;
    }

    const settings = readSettingsFromForm();
    const snapshot = serializeSettings(settings);

    if (snapshot === lastSavedSettingsSnapshot) {
        return;
    }

    if (savingSettings) {
        queuedSettingsSave = true;
        return;
    }

    savingSettings = (async () => {
        const currentSettings = readSettingsFromForm();
        const currentSnapshot = serializeSettings(currentSettings);

        if (currentSnapshot === lastSavedSettingsSnapshot) {
            return;
        }

        const savedSettings = await sendMessage<ExtensionSettings>({
            type: "SAVE_SETTINGS",
            settings: currentSettings
        });

        lastSavedSettingsSnapshot = serializeSettings(savedSettings);
        console.debug("CartPilot: settings auto-saved.");
    })();

    try {
        await savingSettings;
    } finally {
        savingSettings = null;
    }

    if (queuedSettingsSave) {
        queuedSettingsSave = false;
        await persistSettingsIfNeeded();
    }
}

function scheduleSettingsSave(delayMs = 350): void {
    if (!hydratedSettings) {
        return;
    }

    if (settingsSaveDebounce) {
        clearTimeout(settingsSaveDebounce);
    }

    settingsSaveDebounce = setTimeout(() => {
        settingsSaveDebounce = null;
        void persistSettingsIfNeeded().catch((error) => setFeedback(String(error), "danger"));
    }, delayMs);
}

async function fetchAndPopulateModels(preserveSelection?: string, saveAfterLoad = false): Promise<void> {
    const endpoint = elements.endpointInput.value.trim();
    if (!endpoint) {
        if (saveAfterLoad) {
            await persistSettingsIfNeeded();
        }
        return;
    }

    const baseUrl = resolveBaseUrl(endpoint);
    const tagsUrl = `${baseUrl}/api/tags`;

    elements.modelInput.disabled = true;
    elements.refreshModelsButton.disabled = true;

    try {
        const response = await fetch(tagsUrl);
        if (!response.ok) throw new Error(`${response.status}`);

        const data = (await response.json()) as OllamaTagsResponse;
        const models = data.models ?? [];

        elements.modelInput.replaceChildren();

        if (models.length === 0) {
            const opt = document.createElement("option");
            opt.value = "";
            opt.disabled = true;
            opt.selected = true;
            opt.textContent = "No models found";
            elements.modelInput.append(opt);
            return;
        }

        const placeholder = document.createElement("option");
        placeholder.value = "";
        placeholder.disabled = true;
        placeholder.textContent = "Select a model\u2026";
        elements.modelInput.append(placeholder);

        for (const model of models) {
            const opt = document.createElement("option");
            opt.value = model.name;
            opt.textContent = model.name;
            elements.modelInput.append(opt);
        }

        if (preserveSelection && models.some((m) => m.name === preserveSelection)) {
            elements.modelInput.value = preserveSelection;
        } else {
            placeholder.selected = true;
        }

        lastFetchedEndpoint = endpoint;
    } catch {
        elements.modelInput.replaceChildren();
        const opt = document.createElement("option");
        opt.value = preserveSelection ?? "";
        opt.textContent = preserveSelection ? `${preserveSelection} (offline)` : "Failed to load models";
        elements.modelInput.append(opt);
    } finally {
        elements.modelInput.disabled = false;
        elements.refreshModelsButton.disabled = false;
    }

    if (saveAfterLoad) {
        await persistSettingsIfNeeded();
    }
}

function getElement<T extends HTMLElement>(id: string): T {
    const element = document.getElementById(id);

    if (!element) {
        throw new Error(`Missing side panel element: ${id}`);
    }

    return element as T;
}

async function sendMessage<T>(message: UiToBackgroundMessage): Promise<T> {
    const response = (await chrome.runtime.sendMessage(message)) as MessageResponse<T>;

    if (!response.ok) {
        throw new Error(response.error ?? "Extension request failed.");
    }

    return response.data as T;
}

function setFeedback(message: string, tone: "default" | "danger" | "success" = "default"): void {
    elements.feedbackText.textContent = message;
    if (tone === "default") {
        elements.feedbackText.removeAttribute("data-tone");
        return;
    }
    elements.feedbackText.dataset.tone = tone;
}

function readSettingsFromForm(): ExtensionSettings {
    return {
        llm: {
            provider: "ollama",
            endpoint: elements.endpointInput.value.trim(),
            model: elements.modelInput.value,
            temperature: Number.parseFloat(elements.temperatureInput.value || "0.1") || 0.1
        },
        run: {
            dryRun: elements.dryRunToggle.checked,
            maxResults: 5,
            minHumanDelayMs: 350,
            maxHumanDelayMs: 900
        }
    };
}

function applySettingsToForm(settings: ExtensionSettings): void {
    elements.endpointInput.value = settings.llm.endpoint;
    elements.temperatureInput.value = settings.llm.temperature.toString();
    elements.dryRunToggle.checked = settings.run.dryRun;
    void fetchAndPopulateModels(settings.llm.model);
}

function formatStatus(status: RunState["status"]): string {
    switch (status) {
        case "idle":
            return "Idle";
        case "running":
            return "Running";
        case "waiting":
            return "Waiting";
        case "completed":
            return "Completed";
        case "cancelled":
            return "Cancelled";
        case "error":
            return "Error";
    }
}

function applyStatusBadge(status: RunState["status"]): void {
    elements.statusBadge.textContent = formatStatus(status);

    if (status === "error" || status === "cancelled") {
        elements.statusBadge.dataset.tone = "danger";
        return;
    }

    if (status === "waiting") {
        elements.statusBadge.dataset.tone = "warn";
        return;
    }

    if (status === "idle") {
        elements.statusBadge.removeAttribute("data-tone");
        return;
    }

    elements.statusBadge.removeAttribute("data-tone");
}

function renderResults(results: ItemResult[]): void {
    elements.resultsList.replaceChildren();

    if (results.length === 0) {
        const item = document.createElement("li");
        item.className = "list-item";
        item.textContent = "No item outcomes yet.";
        elements.resultsList.append(item);
        return;
    }

    for (const result of results.slice().reverse()) {
        const item = document.createElement("li");
        item.className = "list-item";

        const title = document.createElement("strong");
        title.textContent = `${result.item} • ${result.outcome}`;

        const detail = document.createElement("div");
        detail.textContent = result.selectedProduct?.summary ?? result.normalizedQuery ?? "No product selected.";

        const reason = document.createElement("small");
        reason.textContent = result.reason ?? "";

        item.append(title, detail, reason);
        elements.resultsList.append(item);
    }
}

function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit"
    });
}

function renderProgress(progress: ProgressEvent[]): void {
    elements.progressList.replaceChildren();

    if (progress.length === 0) {
        const item = document.createElement("li");
        item.className = "list-item";
        item.textContent = "Run activity will appear here.";
        elements.progressList.append(item);
        return;
    }

    for (const event of progress.slice(-8).reverse()) {
        const item = document.createElement("li");
        item.className = "list-item";

        const title = document.createElement("strong");
        title.textContent = event.message;

        const meta = document.createElement("small");
        meta.textContent = [event.item, formatTime(event.timestamp)].filter(Boolean).join(" • ");

        item.append(title, meta);
        elements.progressList.append(item);
    }
}

function renderPending(runState: RunState): void {
    const clarification = runState.pendingClarification;
    const confirmation = runState.pendingConfirmation;
    const hasPending = Boolean(clarification || confirmation);

    elements.pendingPanel.hidden = !hasPending;
    elements.clarificationForm.hidden = true;
    elements.confirmationActions.hidden = true;

    if (!hasPending) {
        elements.pendingTitle.textContent = "";
        elements.pendingContext.textContent = "";
        return;
    }

    if (clarification) {
        elements.pendingTitle.textContent = clarification.question;
        elements.pendingContext.textContent = clarification.context ?? `Item: ${clarification.item}`;
        elements.clarificationForm.hidden = false;
        return;
    }

    if (confirmation) {
        elements.pendingTitle.textContent = `Confirm this selection for ${confirmation.item}`;
        elements.pendingContext.textContent = confirmation.product.summary;
        elements.confirmationActions.hidden = false;
    }
}

function renderBootstrap(bootstrap: BootstrapData): void {
    if (!hydratedSettings) {
        applySettingsToForm(bootstrap.settings);
        lastSavedSettingsSnapshot = serializeSettings(bootstrap.settings);
        hydratedSettings = true;
    }

    elements.siteBadge.textContent = `Site: ${getSiteLabel(bootstrap.activeSite)}`;
    elements.siteBadge.dataset.tone = bootstrap.activeSite === "unsupported" ? "warn" : "";
    applyStatusBadge(bootstrap.runState.status);
    renderResults(bootstrap.runState.results);
    renderProgress(bootstrap.runState.progress);
    renderPending(bootstrap.runState);

    elements.startButton.disabled = bootstrap.runState.status === "running" || bootstrap.runState.status === "waiting";
    elements.cancelButton.disabled = bootstrap.runState.status === "idle" || bootstrap.runState.status === "completed";

    if (bootstrap.runState.error) {
        setFeedback(bootstrap.runState.error, "danger");
        return;
    }

    if (bootstrap.runState.status === "completed") {
        setFeedback("Run completed.", "success");
        return;
    }

    if (bootstrap.runState.status === "waiting") {
        setFeedback("CartPilot is waiting for your input.");
        return;
    }

    if (bootstrap.runState.status === "running") {
        setFeedback(bootstrap.runState.currentItem ? `Working on ${bootstrap.runState.currentItem}...` : "Run in progress.");
        return;
    }

    if (bootstrap.activeSite === "unsupported") {
        setFeedback("Open Walmart or H-E-B before starting a run.");
        return;
    }

    setFeedback("Ready.");
}

async function refresh(): Promise<void> {
    const bootstrap = await sendMessage<BootstrapData>({ type: "GET_BOOTSTRAP" });
    renderBootstrap(bootstrap);
}

function parseItems(): string[] {
    return elements.itemsInput.value
        .split(/[\n,]+/)
        .map((item) => item.trim())
        .filter(Boolean);
}

async function handleStartRun(): Promise<void> {
    const items = parseItems();

    if (items.length === 0) {
        setFeedback("Enter at least one grocery item.", "danger");
        return;
    }

    const settings = readSettingsFromForm();
    const bootstrap = await sendMessage<BootstrapData>({
        type: "START_RUN",
        items,
        settings
    });
    renderBootstrap(bootstrap);
    setFeedback(
        elements.modelInput.value
            ? "Run started."
            : "Run started. No Ollama model is selected, so heuristic fallback is active.",
        elements.modelInput.value ? "success" : "default"
    );
}

async function handleCancelRun(): Promise<void> {
    await sendMessage<RunState>({ type: "CANCEL_RUN" });
    await refresh();
}

async function handleClarificationSubmit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const answer = elements.clarificationInput.value.trim();

    if (!answer) {
        setFeedback("Enter an answer before submitting.", "danger");
        return;
    }

    await sendMessage<RunState>({
        type: "SUBMIT_CLARIFICATION",
        answer
    });

    elements.clarificationInput.value = "";
    await refresh();
}

async function handleConfirmation(decision: "confirm" | "skip" | "cancel"): Promise<void> {
    await sendMessage<RunState>({
        type: "SUBMIT_CONFIRMATION",
        decision
    });
    await refresh();
}

function bindEvents(): void {
    document.addEventListener("click", (event) => {
        if (!elements.llmSettingsDetails.open) return;

        const target = event.target;
        if (target instanceof Node && !elements.llmSettingsDetails.contains(target)) {
            elements.llmSettingsDetails.open = false;
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && elements.llmSettingsDetails.open) {
            elements.llmSettingsDetails.open = false;
        }
    });

    elements.startButton.addEventListener("click", () => {
        void handleStartRun().catch((error) => setFeedback(String(error), "danger"));
    });

    elements.cancelButton.addEventListener("click", () => {
        void handleCancelRun().catch((error) => setFeedback(String(error), "danger"));
    });

    elements.clarificationForm.addEventListener("submit", (event) => {
        void handleClarificationSubmit(event).catch((error) => setFeedback(String(error), "danger"));
    });

    elements.confirmButton.addEventListener("click", () => {
        void handleConfirmation("confirm").catch((error) => setFeedback(String(error), "danger"));
    });

    elements.skipButton.addEventListener("click", () => {
        void handleConfirmation("skip").catch((error) => setFeedback(String(error), "danger"));
    });

    elements.cancelRunButton.addEventListener("click", () => {
        void handleConfirmation("cancel").catch((error) => setFeedback(String(error), "danger"));
    });

    elements.refreshModelsButton.addEventListener("click", () => {
        void fetchAndPopulateModels(elements.modelInput.value, true).catch((error) => setFeedback(String(error), "danger"));
    });

    let endpointDebounce: ReturnType<typeof setTimeout> | null = null;
    elements.endpointInput.addEventListener("input", () => {
        if (endpointDebounce) clearTimeout(endpointDebounce);
        endpointDebounce = setTimeout(() => {
            const current = elements.endpointInput.value.trim();
            if (current && current !== lastFetchedEndpoint) {
                void fetchAndPopulateModels(elements.modelInput.value, true).catch((error) =>
                    setFeedback(String(error), "danger")
                );
                return;
            }
            scheduleSettingsSave(0);
        }, 600);
    });

    elements.endpointInput.addEventListener("change", () => {
        scheduleSettingsSave(0);
    });

    elements.temperatureInput.addEventListener("input", () => {
        scheduleSettingsSave(450);
    });

    elements.temperatureInput.addEventListener("change", () => {
        scheduleSettingsSave(0);
    });

    elements.modelInput.addEventListener("change", () => {
        scheduleSettingsSave(0);
    });

    elements.dryRunToggle.addEventListener("change", () => {
        scheduleSettingsSave(0);
    });

    window.setInterval(() => {
        void refresh().catch((error) => setFeedback(String(error), "danger"));
    }, 1000);
}

function init(): void {
    elements = {
        siteBadge: getElement("siteBadge"),
        statusBadge: getElement("statusBadge"),
        llmSettingsDetails: getElement("llmSettingsDetails"),
        itemsInput: getElement("itemsInput"),
        endpointInput: getElement("endpointInput"),
        modelInput: getElement("modelInput"),
        temperatureInput: getElement("temperatureInput"),
        dryRunToggle: getElement("dryRunToggle"),
        startButton: getElement("startButton"),
        cancelButton: getElement("cancelButton"),
        refreshModelsButton: getElement("refreshModelsButton"),
        feedbackText: getElement("feedbackText"),
        pendingPanel: getElement("pendingPanel"),
        pendingTitle: getElement("pendingTitle"),
        pendingContext: getElement("pendingContext"),
        clarificationForm: getElement("clarificationForm"),
        clarificationInput: getElement("clarificationInput"),
        confirmationActions: getElement("confirmationActions"),
        confirmButton: getElement("confirmButton"),
        skipButton: getElement("skipButton"),
        cancelRunButton: getElement("cancelRunButton"),
        resultsList: getElement("resultsList"),
        progressList: getElement("progressList")
    };

    bindEvents();
    void refresh().catch((error) => setFeedback(String(error), "danger"));
}

window.addEventListener("DOMContentLoaded", init);
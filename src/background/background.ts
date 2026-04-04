import { DEFAULT_SETTINGS, STORAGE_KEYS, createIdleRunState, mergeSettings, sanitizeItems } from "../shared/config";
import type {
  BackgroundToContentMessage,
  ContentToBackgroundMessage,
  MessageResponse,
  UiToBackgroundMessage,
  RuntimeMessage
} from "../shared/messages";
import { getCurrentSite, isSupportedSite } from "../shared/site";
import type { BootstrapData, ExtensionSettings, RunState, SiteId } from "../shared/types";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingReceiverError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return message.includes("receiving end does not exist") || message.includes("could not establish connection");
}

function createRunId(): string {
  return `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function storageGet<T>(key: string): Promise<T | undefined> {
  const values = await chrome.storage.local.get(key);
  return values[key] as T | undefined;
}

async function storageSet(key: string, value: unknown): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

function hydrateRunState(stored: Partial<RunState> | undefined, activeSite: SiteId): RunState {
  if (!stored) {
    return createIdleRunState(activeSite, DEFAULT_SETTINGS.run.dryRun);
  }

  return {
    ...createIdleRunState(stored.site ?? activeSite, stored.dryRun ?? DEFAULT_SETTINGS.run.dryRun),
    ...stored,
    progress: stored.progress ?? [],
    results: stored.results ?? [],
    pendingClarification: stored.pendingClarification ?? null,
    pendingConfirmation: stored.pendingConfirmation ?? null,
    error: stored.error ?? null,
    currentItem: stored.currentItem ?? null,
    runId: stored.runId ?? null,
    tabId: stored.tabId ?? null,
    startedAt: stored.startedAt ?? null,
    completedAt: stored.completedAt ?? null
  };
}

async function getSettings(): Promise<ExtensionSettings> {
  const stored = await storageGet<Partial<ExtensionSettings>>(STORAGE_KEYS.settings);
  return mergeSettings(stored);
}

async function saveSettings(settings: ExtensionSettings): Promise<ExtensionSettings> {
  const merged = mergeSettings(settings);
  await storageSet(STORAGE_KEYS.settings, merged);
  return merged;
}

async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab ?? null;
}

async function getActiveSite(): Promise<{ tab: chrome.tabs.Tab | null; site: SiteId }> {
  const tab = await getActiveTab();
  return {
    tab,
    site: getCurrentSite(tab?.url)
  };
}

async function getRunState(activeSite?: SiteId): Promise<RunState> {
  const stored = await storageGet<Partial<RunState>>(STORAGE_KEYS.runState);
  return hydrateRunState(stored, activeSite ?? "unsupported");
}

async function setRunState(runState: RunState): Promise<RunState> {
  await storageSet(STORAGE_KEYS.runState, runState);
  return runState;
}

async function updateRunState(mutator: (runState: RunState) => RunState | Promise<RunState>): Promise<RunState> {
  const { site } = await getActiveSite();
  const current = await getRunState(site);
  const next = await mutator(current);
  return setRunState(next);
}

async function injectContentScript(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ["content/content.js"]
  });
}

async function sendToTab(tabId: number, message: BackgroundToContentMessage): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (error) {
    if (isMissingReceiverError(error)) {
      try {
        await injectContentScript(tabId);
        await chrome.tabs.sendMessage(tabId, message);
        return;
      } catch (retryError) {
        throw new Error(
          `Unable to reach the page automation script. Refresh the tab and try again. ${errorMessage(retryError)}`
        );
      }
    }

    throw new Error(`Unable to reach the page automation script. Refresh the tab and try again. ${errorMessage(error)}`);
  }
}

async function isTabAlive(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.get(tabId);
    return true;
  } catch {
    return false;
  }
}

async function getBootstrapData(): Promise<BootstrapData> {
  const [{ site }, settings] = await Promise.all([getActiveSite(), getSettings()]);
  const runState = await getRunState(site);

  if (runState.status === "idle" && runState.site !== site) {
    const resetState = createIdleRunState(site, settings.run.dryRun);
    await setRunState(resetState);
    return { settings, runState: resetState, activeSite: site };
  }

  if (
    (runState.status === "running" || runState.status === "waiting") &&
    (!runState.tabId || !(await isTabAlive(runState.tabId)))
  ) {
    console.debug("CartPilot: stale run detected — tab no longer exists. Resetting state.");
    const staleState: RunState = {
      ...runState,
      status: "error",
      error: "Run lost — the tab was closed or refreshed. Please start a new run.",
      currentItem: null,
      pendingClarification: null,
      pendingConfirmation: null,
      completedAt: Date.now()
    };
    await setRunState(staleState);
    return { settings, runState: staleState, activeSite: site };
  }

  return { settings, runState, activeSite: site };
}

async function startRun(items: string[], settings: ExtensionSettings): Promise<BootstrapData> {
  const mergedSettings = await saveSettings(settings);
  const normalizedItems = sanitizeItems(items);

  if (normalizedItems.length === 0) {
    throw new Error("Enter at least one grocery item before starting a run.");
  }

  const { tab, site } = await getActiveSite();

  if (!tab?.id) {
    throw new Error("Open a supported grocery tab before starting CartPilot.");
  }

  if (!isSupportedSite(site)) {
    throw new Error("CartPilot v1 only runs on Walmart and H-E-B pages.");
  }

  const runState: RunState = {
    ...createIdleRunState(site, mergedSettings.run.dryRun),
    runId: createRunId(),
    tabId: tab.id,
    status: "running",
    itemQueue: normalizedItems,
    startedAt: Date.now(),
    progress: [
      {
        stage: "queued",
        message: `Starting cart build on ${site}.`,
        timestamp: Date.now()
      }
    ]
  };

  await setRunState(runState);

  try {
    await sendToTab(tab.id, {
      type: "CONTENT_START_RUN",
      runId: runState.runId as string,
      items: normalizedItems,
      settings: mergedSettings,
      site
    });
  } catch (error) {
    const failedState: RunState = {
      ...runState,
      status: "error",
      error: errorMessage(error),
      completedAt: Date.now()
    };
    await setRunState(failedState);
    throw error;
  }

  return {
    settings: mergedSettings,
    runState,
    activeSite: site
  };
}

async function cancelRun(): Promise<RunState> {
  const runState = await getRunState();

  if (runState.tabId && runState.runId) {
    try {
      await sendToTab(runState.tabId, {
        type: "CONTENT_CANCEL_RUN",
        runId: runState.runId
      });
    } catch (error) {
      console.debug("CartPilot: could not reach content script during cancel, forcing state reset.", errorMessage(error));
    }
  }

  return updateRunState((current) => ({
    ...current,
    status: "cancelled",
    currentItem: null,
    pendingClarification: null,
    pendingConfirmation: null,
    completedAt: Date.now(),
    progress: [
      ...current.progress,
      {
        stage: "cancelled",
        message: "Run cancelled.",
        timestamp: Date.now(),
        item: current.currentItem ?? undefined
      }
    ]
  }));
}

async function forwardClarification(answer: string): Promise<RunState> {
  const runState = await getRunState();

  if (!runState.tabId) {
    throw new Error("No active run is waiting for clarification.");
  }

  await sendToTab(runState.tabId, {
    type: "CONTENT_RESOLVE_CLARIFICATION",
    answer
  });

  return updateRunState((current) => ({
    ...current,
    status: "running",
    pendingClarification: null
  }));
}

async function forwardConfirmation(decision: "confirm" | "skip" | "cancel"): Promise<RunState> {
  const runState = await getRunState();

  if (!runState.tabId) {
    throw new Error("No active run is waiting for confirmation.");
  }

  await sendToTab(runState.tabId, {
    type: "CONTENT_RESOLVE_CONFIRMATION",
    decision
  });

  return updateRunState((current) => ({
    ...current,
    status: decision === "cancel" ? "cancelled" : "running",
    pendingConfirmation: null,
    completedAt: decision === "cancel" ? Date.now() : current.completedAt
  }));
}

async function applyFlowMessage(message: ContentToBackgroundMessage, sender: chrome.runtime.MessageSender): Promise<RunState> {
  return updateRunState((current) => {
    switch (message.type) {
      case "FLOW_PROGRESS": {
        const progress = [...current.progress, message.progress].slice(-150);
        return { ...current, progress };
      }

      case "FLOW_SET_STATUS":
        return {
          ...current,
          status: message.status,
          currentItem: message.currentItem,
          tabId: sender.tab?.id ?? current.tabId
        };

      case "FLOW_REQUEST_CLARIFICATION":
        return {
          ...current,
          status: "waiting",
          currentItem: message.request.item,
          pendingClarification: message.request,
          pendingConfirmation: null,
          tabId: sender.tab?.id ?? current.tabId
        };

      case "FLOW_REQUEST_CONFIRMATION":
        return {
          ...current,
          status: "waiting",
          currentItem: message.request.item,
          pendingClarification: null,
          pendingConfirmation: message.request,
          tabId: sender.tab?.id ?? current.tabId
        };

      case "FLOW_CLEAR_PENDING":
        return {
          ...current,
          status: current.status === "waiting" ? "running" : current.status,
          pendingClarification: null,
          pendingConfirmation: null
        };

      case "FLOW_ITEM_RESULT":
        return {
          ...current,
          results: [...current.results, message.result],
          pendingClarification: null,
          pendingConfirmation: null
        };

      case "FLOW_COMPLETE":
        return {
          ...current,
          status: "completed",
          currentItem: null,
          pendingClarification: null,
          pendingConfirmation: null,
          completedAt: Date.now()
        };

      case "FLOW_CANCELLED":
        return {
          ...current,
          status: "cancelled",
          currentItem: null,
          pendingClarification: null,
          pendingConfirmation: null,
          completedAt: Date.now()
        };

      case "FLOW_ERROR":
        return {
          ...current,
          status: "error",
          error: message.error,
          pendingClarification: null,
          pendingConfirmation: null,
          completedAt: Date.now()
        };
    }
  });
}

async function handleUiMessage(message: UiToBackgroundMessage): Promise<unknown> {
  switch (message.type) {
    case "GET_BOOTSTRAP":
      return getBootstrapData();

    case "GET_RUN_STATE": {
      const { site } = await getActiveSite();
      return getRunState(site);
    }

    case "SAVE_SETTINGS":
      return saveSettings(message.settings);

    case "START_RUN":
      return startRun(message.items, message.settings);

    case "CANCEL_RUN":
      return cancelRun();

    case "SUBMIT_CLARIFICATION":
      return forwardClarification(message.answer.trim());

    case "SUBMIT_CONFIRMATION":
      return forwardConfirmation(message.decision);
  }
}

async function configureSidePanel(): Promise<void> {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

async function initializeExtensionState(): Promise<void> {
  const settings = await getSettings();
  await storageSet(STORAGE_KEYS.settings, settings);
  const { site } = await getActiveSite();
  const runState = await getRunState(site);
  await storageSet(STORAGE_KEYS.runState, runState);
}

async function handleMessage(message: RuntimeMessage, sender: chrome.runtime.MessageSender): Promise<unknown> {
  if (message.type.startsWith("FLOW_")) {
    return applyFlowMessage(message as ContentToBackgroundMessage, sender);
  }

  return handleUiMessage(message as UiToBackgroundMessage);
}

chrome.runtime.onInstalled.addListener(() => {
  void Promise.all([configureSidePanel(), initializeExtensionState()]);
});

chrome.runtime.onStartup.addListener(() => {
  void configureSidePanel();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void handleMessage(message as RuntimeMessage, sender)
    .then((data) => {
      sendResponse({ ok: true, data } as MessageResponse);
    })
    .catch((error) => {
      sendResponse({ ok: false, error: errorMessage(error) } as MessageResponse);
    });

  return true;
});
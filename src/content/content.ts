import { extractPriceIntent, normalizeQuery, selectProduct } from "../llm/llm";
import type {
    BackgroundToContentMessage,
    ConfirmationDecision,
    ContentToBackgroundMessage,
    MessageResponse
} from "../shared/messages";
import type {
    ConfirmationRequest,
    ExtensionSettings,
    ItemResult,
    ProductCandidate,
    ProgressStage,
    SupportedSite
} from "../shared/types";
import { createId } from "../utils/dom";
import { getSiteAdapter } from "../siteAdapters";

class CancelledError extends Error {
    public constructor() {
        super("Run cancelled.");
        this.name = "CancelledError";
    }
}

let activeRunId: string | null = null;
let cancelRequested = false;
let pendingClarificationResolver: ((answer: string) => void) | null = null;
let pendingConfirmationResolver: ((decision: ConfirmationDecision) => void) | null = null;

function isActiveRun(runId: string): boolean {
    return activeRunId === runId;
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function sendToBackground(message: ContentToBackgroundMessage): Promise<void> {
    const response = (await chrome.runtime.sendMessage(message)) as MessageResponse;

    if (!response.ok) {
        throw new Error(response.error ?? "Background message failed.");
    }
}

async function reportProgress(
    stage: ProgressStage,
    message: string,
    item?: string,
    product?: ProductCandidate
): Promise<void> {
    await sendToBackground({
        type: "FLOW_PROGRESS",
        progress: {
            stage,
            message,
            item,
            product,
            timestamp: Date.now()
        }
    });
}

async function setStatus(status: "running" | "waiting" | "cancelled" | "completed" | "error", currentItem: string | null) {
    await sendToBackground({
        type: "FLOW_SET_STATUS",
        status,
        currentItem
    });
}

function assertNotCancelled(): void {
    if (cancelRequested) {
        throw new CancelledError();
    }
}

async function waitForClarification(item: string, question: string, context?: string): Promise<string> {
    await setStatus("waiting", item);
    await sendToBackground({
        type: "FLOW_REQUEST_CLARIFICATION",
        request: {
            id: createId("clarify"),
            item,
            question,
            context
        }
    });

    const answer = await new Promise<string>((resolve) => {
        pendingClarificationResolver = resolve;
    });

    pendingClarificationResolver = null;
    await sendToBackground({ type: "FLOW_CLEAR_PENDING" });

    if (cancelRequested) {
        throw new CancelledError();
    }

    if (!answer.trim()) {
        throw new Error("Clarification answer was empty.");
    }

    assertNotCancelled();
    await setStatus("running", item);
    return answer.trim();
}

async function waitForConfirmation(item: string, product: ProductCandidate): Promise<ConfirmationDecision> {
    const request: ConfirmationRequest = {
        id: createId("confirm"),
        item,
        product
    };

    await setStatus("waiting", item);
    await sendToBackground({
        type: "FLOW_REQUEST_CONFIRMATION",
        request
    });

    const decision = await new Promise<ConfirmationDecision>((resolve) => {
        pendingConfirmationResolver = resolve;
    });

    pendingConfirmationResolver = null;
    await sendToBackground({ type: "FLOW_CLEAR_PENDING" });

    if (decision === "cancel") {
        throw new CancelledError();
    }

    assertNotCancelled();
    await setStatus("running", item);
    return decision;
}

async function processItem(item: string, site: SupportedSite, settings: ExtensionSettings): Promise<ItemResult> {
    const adapter = getSiteAdapter(site);
    const { intent: priceIntent, cleanedItem } = extractPriceIntent(item);
    let extraContext = "";

    for (let attempt = 0; attempt < 3; attempt += 1) {
        assertNotCancelled();
        await reportProgress("normalizing", `Normalizing ${item}...`, item);

        const normalization = await normalizeQuery(cleanedItem, settings.llm, extraContext || undefined);
        const normalizedQuery = normalization.normalizedQuery;

        if (normalization.needsClarification && normalization.clarificationQuestion) {
            const answer = await waitForClarification(item, normalization.clarificationQuestion, normalizedQuery);
            extraContext = [extraContext, answer].filter(Boolean).join(" ").trim();
            continue;
        }

        await reportProgress("searching", `Searching for ${normalizedQuery}...`, item);
        await adapter.search(normalizedQuery);

        assertNotCancelled();
        await reportProgress("scraping", `Scraping ${site} results for ${item}...`, item);
        const scrapedProducts = await adapter.getTopProducts(settings.run.maxResults);

        if (scrapedProducts.length === 0) {
            return {
                item,
                normalizedQuery,
                outcome: "error",
                reason: "No products were found on the current site."
            };
        }

        const candidates = scrapedProducts.map((product) => product.candidate);
        await reportProgress("selecting", `Selecting the best match for ${item}...`, item);

        const selection = await selectProduct(item, normalizedQuery, candidates, settings.llm, priceIntent);

        if (selection.needsClarification && selection.clarificationQuestion) {
            const answer = await waitForClarification(item, selection.clarificationQuestion, normalizedQuery);
            extraContext = [extraContext, answer].filter(Boolean).join(" ").trim();
            continue;
        }

        if (selection.selectedIndex === null || !scrapedProducts[selection.selectedIndex]) {
            return {
                item,
                normalizedQuery,
                outcome: "error",
                reason: selection.reason || "The product selection step returned no valid match."
            };
        }

        const chosenProduct = scrapedProducts[selection.selectedIndex];
        let clearHighlight: () => void = () => { };

        if (settings.run.dryRun) {
            clearHighlight = adapter.highlightProduct(chosenProduct);
            await reportProgress(
                "awaiting-confirmation",
                `Dry-run mode is waiting for confirmation on ${item}.`,
                item,
                chosenProduct.candidate
            );
            const decision = await waitForConfirmation(item, chosenProduct.candidate);
            clearHighlight();

            if (decision === "skip") {
                return {
                    item,
                    normalizedQuery,
                    selectedProduct: chosenProduct.candidate,
                    outcome: "skipped",
                    reason: "Skipped by the user during dry-run confirmation."
                };
            }
        }

        try {
            await reportProgress("adding", `Adding ${chosenProduct.candidate.title} to cart...`, item, chosenProduct.candidate);
            await adapter.addToCart(chosenProduct);
            await reportProgress("completed", `Added ${chosenProduct.candidate.title} to cart.`, item, chosenProduct.candidate);

            return {
                item,
                normalizedQuery,
                selectedProduct: chosenProduct.candidate,
                outcome: "added",
                reason: selection.reason
            };
        } finally {
            clearHighlight();
        }
    }

    return {
        item,
        outcome: "error",
        reason: "Too many clarification loops for this item."
    };
}

async function runCartFlow(runId: string, items: string[], site: SupportedSite, settings: ExtensionSettings): Promise<void> {
    activeRunId = runId;
    cancelRequested = false;
    pendingClarificationResolver = null;
    pendingConfirmationResolver = null;

    await setStatus("running", null);

    try {
        for (const item of items) {
            assertNotCancelled();
            await setStatus("running", item);
            const result = await processItem(item, site, settings);
            await sendToBackground({ type: "FLOW_ITEM_RESULT", result });
        }

        await sendToBackground({ type: "FLOW_COMPLETE" });
    } catch (error) {
        if (error instanceof CancelledError) {
            await sendToBackground({ type: "FLOW_CANCELLED" });
            return;
        }

        await sendToBackground({
            type: "FLOW_ERROR",
            error: errorMessage(error)
        });
    } finally {
        activeRunId = null;
        cancelRequested = false;
        pendingClarificationResolver = null;
        pendingConfirmationResolver = null;
    }
}

chrome.runtime.onMessage.addListener((message: BackgroundToContentMessage, _sender, sendResponse) => {
    switch (message.type) {
        case "CONTENT_START_RUN": {
            void runCartFlow(message.runId, message.items, message.site, message.settings);
            sendResponse({ ok: true } as MessageResponse);
            return false;
        }

        case "CONTENT_CANCEL_RUN": {
            if (isActiveRun(message.runId)) {
                cancelRequested = true;
                pendingClarificationResolver?.("");
                pendingConfirmationResolver?.("cancel");
            }
            sendResponse({ ok: true } as MessageResponse);
            return false;
        }

        case "CONTENT_RESOLVE_CLARIFICATION": {
            pendingClarificationResolver?.(message.answer);
            sendResponse({ ok: true } as MessageResponse);
            return false;
        }

        case "CONTENT_RESOLVE_CONFIRMATION": {
            pendingConfirmationResolver?.(message.decision);
            sendResponse({ ok: true } as MessageResponse);
            return false;
        }
    }
});
import type { SiteId, SupportedSite } from "./types";

export function getCurrentSite(urlString?: string | null): SiteId {
    if (!urlString) {
        return "unsupported";
    }

    try {
        const url = new URL(urlString);
        const hostname = url.hostname.toLowerCase();

        if (hostname.endsWith("walmart.com")) {
            return "walmart";
        }

        if (hostname.endsWith("heb.com")) {
            return "heb";
        }
    } catch {
        return "unsupported";
    }

    return "unsupported";
}

export function isSupportedSite(site: SiteId): site is SupportedSite {
    return site === "walmart" || site === "heb";
}

export function getSiteLabel(site: SiteId): string {
    switch (site) {
        case "walmart":
            return "Walmart";
        case "heb":
            return "H-E-B";
        default:
            return "Unsupported site";
    }
}
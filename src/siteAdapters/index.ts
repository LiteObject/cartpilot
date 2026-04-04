import type { SupportedSite } from "../shared/types";
import { hebAdapter } from "./heb";
import type { SiteAdapter } from "./base";
import { walmartAdapter } from "./walmart";

const adapters: Record<SupportedSite, SiteAdapter> = {
    walmart: walmartAdapter,
    heb: hebAdapter
};

export function getSiteAdapter(site: SupportedSite): SiteAdapter {
    return adapters[site];
}
/*
    Grok API Service - handles streaming communication with the Grok AI.
    
    This service now operates entirely in the browser:
    - Distillation is performed in the browser
    - AI queries are sent directly to xAI API (no backend required)
*/

import type { DistilledSchematic, RepoClearCacheResponse } from "../../services/api";
import { distillService, type DistillResult } from "../../services/distill-service";
import { createFocusedDistillation } from "../../../kicad/distill";
import type { SelectedComponent, GrokContext } from "./types";
import { xaiClient, Message } from "../../services/xai-client";
import { xaiSettings } from "../../services/xai-settings";
import { SYSTEM_PROMPT } from "../../services/system-prompt";

/** Callback types for streaming events */
export interface StreamCallbacks {
    onStart?: () => void;
    onChunk?: (content: string) => void;
    onComplete?: (fullContent: string) => void;
    onError?: (error: string) => void;
}

/** Response type for repository initialization (browser-based) */
export interface RepoInitResponse {
    repo: string;
    commit: string;
    cached: boolean;
    component_count: number;
    net_count: number;
    schematic_files: string[];
    distilled: DistilledSchematic;
}

/** Callback types for initialization events */
export interface InitCallbacks {
    onStart?: () => void;
    onComplete?: (response: RepoInitResponse) => void;
    onError?: (error: string) => void;
}

/**
 * Build semantic context for selected components from distilled data.
 * This replicates the backend's build_component_context function.
 */
function buildComponentContext(
    distilled: DistilledSchematic,
    componentIds: string[],
): { selectedContext: string; schematicSummary: string } {
    // Filter to selected components
    const components = distilled.components.filter(
        (c) => componentIds.includes(c.reference)
    );

    // Build detailed component descriptions
    const componentDetails: string[] = [];
    for (const comp of components) {
        const category = comp.category || "other";
        let detail = `**${comp.reference}** (${category})\n  - Type: ${comp.lib_id}\n  - Value: ${comp.value}`;

        if (comp.footprint) {
            detail += `\n  - Footprint: ${comp.footprint}`;
        }

        if (comp.sheet_path && comp.sheet_path !== "/") {
            detail += `\n  - Sheet: ${comp.sheet_path}`;
        }

        // Add pin connections
        if (comp.pins && comp.pins.length > 0) {
            const pinStrs = comp.pins.map((pin) => {
                const name = pin.name || "";
                const net = pin.net || "NC";
                if (!name) {
                    return `Pin ${pin.number} → ${net}`;
                }
                return `Pin ${pin.number} (${name}) → ${net}`;
            });
            if (pinStrs.length > 0) {
                detail += `\n  - Pins:\n    ${pinStrs.join("\n    ")}`;
            }
        }

        // Add properties if any
        if (comp.properties) {
            const propStrs = Object.entries(comp.properties)
                .filter(([k]) => !k.startsWith("ki_"))
                .map(([k, v]) => `${k}: ${v}`);
            if (propStrs.length > 0) {
                detail += `\n  - Properties: ${propStrs.join(", ")}`;
            }
        }

        componentDetails.push(detail);
    }

    // Find nearby components from proximities
    const nearbyRefs = new Set<string>();
    if (distilled.proximities) {
        for (const prox of distilled.proximities) {
            if ((prox.score || 0) > 0.3) {
                if (componentIds.includes(prox.ref_a) && !componentIds.includes(prox.ref_b)) {
                    nearbyRefs.add(prox.ref_b);
                }
                if (componentIds.includes(prox.ref_b) && !componentIds.includes(prox.ref_a)) {
                    nearbyRefs.add(prox.ref_a);
                }
            }
        }
    }

    // Get details for nearby components (limit to 10)
    const nearbyDetails: string[] = [];
    const nearbyRefsArray = Array.from(nearbyRefs).slice(0, 10);
    for (const ref of nearbyRefsArray) {
        const comp = distilled.components.find((c) => c.reference === ref);
        if (comp) {
            nearbyDetails.push(`${comp.reference} (${comp.value}, ${comp.category || "other"})`);
        }
    }

    // Build schematic overview
    const schematicSummary = `The schematic contains ${distilled.components.length} total components and ${Object.keys(distilled.nets).length} nets.`;

    // Build selected context
    let selectedContext: string;
    if (componentDetails.length === 0) {
        selectedContext = "No specific components selected.";
    } else {
        selectedContext = `## Selected Components (${componentDetails.length})\n\n${componentDetails.join("\n\n")}`;
        
        if (nearbyDetails.length > 0) {
            selectedContext += `\n\n## Nearby/Related Components\n${nearbyDetails.join(", ")}`;
        }
    }

    return { selectedContext, schematicSummary };
}

/**
 * Service for interacting with the Grok AI.
 * All operations are performed in the browser - no backend required.
 */
export class GrokAPIService {
    private _distillResult: DistillResult | null = null;
    private _currentRepo: string | null = null;
    private _currentCommit: string | null = null;

    /**
     * Check if the xAI API is configured.
     */
    get isConfigured(): boolean {
        return xaiSettings.isConfigured;
    }

    /**
     * Initialize a repository by distilling its schematic files in the browser.
     * This prepares the semantic representation for AI analysis.
     * Results are cached locally (no backend required for distillation).
     */
    async initRepository(
        repo: string,
        commit: string,
        callbacks?: InitCallbacks,
    ): Promise<RepoInitResponse> {
        // Return cached if same repo/commit
        if (
            this._distillResult &&
            this._currentRepo === repo &&
            this._currentCommit === commit
        ) {
            const response = this.buildInitResponse(this._distillResult, true);
            return response;
        }

        callbacks?.onStart?.();

        try {
            // Distill in browser using the distill service
            const result = await distillService.distillRepository(repo, commit);
            
            this._distillResult = result;
            this._currentRepo = repo;
            this._currentCommit = commit;
            
            const response = this.buildInitResponse(result, false);
            callbacks?.onComplete?.(response);
            return response;
        } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to initialize repository";
            callbacks?.onError?.(message);
            throw err;
        }
    }

    /**
     * Build a RepoInitResponse from a DistillResult
     */
    private buildInitResponse(result: DistillResult, cached: boolean): RepoInitResponse {
        return {
            repo: result.repo,
            commit: result.commit,
            cached,
            component_count: result.component_count,
            net_count: result.net_count,
            schematic_files: result.schematic_files,
            distilled: result.distilled,
        };
    }

    /**
     * Fetches and caches the distilled schematic for a repo/commit.
     * Uses browser-based distillation (no backend required).
     */
    async getDistilledSchematic(
        repo: string,
        commit: string,
    ): Promise<DistilledSchematic> {
        // If we already have it cached for this repo/commit
        if (
            this._distillResult &&
            this._currentRepo === repo &&
            this._currentCommit === commit
        ) {
            return this._distillResult.distilled;
        }

        // Distill in browser
        const result = await distillService.distillRepository(repo, commit);
        this._distillResult = result;
        this._currentRepo = repo;
        this._currentCommit = commit;
        return result.distilled;
    }

    /**
     * Clears the local cached distilled schematic.
     * Call this when the repo/commit changes.
     */
    clearCache(): void {
        // Clear the distill service cache BEFORE nulling the repo
        if (this._currentRepo) {
            distillService.clearCache(this._currentRepo);
        }
        this._distillResult = null;
        this._currentRepo = null;
        this._currentCommit = null;
    }

    /**
     * Clears local cache for the current repo.
     * (No server-side cache to clear since distillation is browser-based)
     */
    async clearServerCache(
        repo: string,
        commit?: string,
    ): Promise<RepoClearCacheResponse> {
        // Clear local caches
        this.clearCache();
        distillService.clearCache(repo, commit);
        
        // Return a success response (no server call needed)
        return {
            repo,
            cleared: true,
            message: `Cache cleared for ${repo}${commit ? ` at ${commit.slice(0, 8)}` : ""}`,
        };
    }

    /**
     * Get the current initialization response if available.
     */
    getInitResponse(): RepoInitResponse | null {
        if (!this._distillResult) return null;
        return this.buildInitResponse(this._distillResult, true);
    }

    /**
     * Aborts any in-progress streaming request.
     */
    abort(): void {
        xaiClient.abort();
    }

    /**
     * Streams a query to the Grok AI and processes the response.
     * Now communicates directly with xAI API (no backend required).
     *
     * @param context - Repository context (repo and commit)
     * @param components - Selected components to query about
     * @param query - The user's question
     * @param callbacks - Callbacks for streaming events
     * @param thinkingMode - Whether to enable reasoning/thinking mode
     * @returns Promise that resolves when streaming is complete
     */
    async streamQuery(
        context: GrokContext,
        components: SelectedComponent[],
        query: string,
        callbacks: StreamCallbacks,
        thinkingMode: boolean = false,
    ): Promise<void> {
        const { repo, commit } = context;

        // Check if API is configured
        if (!xaiSettings.isConfigured) {
            callbacks.onError?.(
                "xAI API key not configured. Please add your API key in the settings panel on the landing page.",
            );
            return;
        }

        if (!repo || !commit) {
            callbacks.onError?.(
                "Repository context not available. Please load a schematic from GitHub.",
            );
            return;
        }

        try {
            // Fetch distilled schematic if needed
            const fullDistilled = await this.getDistilledSchematic(repo, commit);

            const componentIds = components.map((c) => c.reference);

            // Create focused distillation for selected components
            // This includes selected + connected + nearby components with relevant nets
            const distilled = componentIds.length > 0
                ? createFocusedDistillation(fullDistilled, componentIds)
                : fullDistilled;

            console.log(
                `[GrokAPIService] Sending focused context: ${distilled.components.length} components, ` +
                `${Object.keys(distilled.nets).length} nets, ${distilled.proximities.length} proximities`
            );

            // Build rich semantic context from distilled data
            const { selectedContext, schematicSummary } = buildComponentContext(distilled, componentIds);

            // Build system and user messages
            const systemPrompt = `${SYSTEM_PROMPT}\n\n---\n\n## Schematic Context\n${schematicSummary}`;
            const userPrompt = `${selectedContext}\n\n---\n\n## User's Question\n${query}`;

            console.log(
                `[GrokAPIService] Using system prompt (${systemPrompt.length} chars), context (${userPrompt.length} chars), thinking_mode: ${thinkingMode}`
            );

            const messages = [
                Message.system(systemPrompt),
                Message.user(userPrompt),
            ];

            // Accumulate full content for the final callback
            let fullContent = "";
            let thinkingContent = "";

            // Stream the query using the XAI client
            await xaiClient.streamChatCompletion(
                messages,
                {
                    onStart: () => {
                        callbacks.onStart?.();
                    },
                    onChunk: (content, isThinking) => {
                        if (isThinking) {
                            thinkingContent += content;
                            // Wrap thinking content in a special marker
                            callbacks.onChunk?.(`<thinking>${content}</thinking>`);
                        } else {
                            fullContent += content;
                            callbacks.onChunk?.(fullContent);
                        }
                    },
                    onComplete: () => {
                        callbacks.onComplete?.(fullContent);
                    },
                    onError: (error) => {
                        callbacks.onError?.(error);
                    },
                },
                thinkingMode,
            );
        } catch (err) {
            console.error("[GrokAPIService] Stream error:", err);
            callbacks.onError?.(
                err instanceof Error
                    ? err.message
                    : "Failed to connect to Grok AI",
            );
        }
    }
}

/** Singleton instance for convenience */
export const grokAPI = new GrokAPIService();

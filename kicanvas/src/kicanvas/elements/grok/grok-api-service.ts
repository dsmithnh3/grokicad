/*
    Grok API Service - handles streaming communication with the Grok AI backend.
    Distillation is now performed entirely in the browser.
*/

import type { DistilledSchematic, RepoClearCacheResponse } from "../../services/api";
import { distillService, type DistillResult } from "../../services/distill-service";
import { createFocusedDistillation } from "../../../kicad/distill";
import type { SelectedComponent, GrokContext } from "./types";
import { API_BASE_URL } from "../../../config";

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

/** Request payload for the Grok selection stream endpoint */
export interface GrokStreamRequest {
    repo: string;
    commit: string;
    component_ids: string[];
    query: string;
    distilled: DistilledSchematic;
    thinking_mode: boolean;
}

/**
 * Service for interacting with the Grok AI backend.
 * Distillation is performed in the browser; only AI queries go to the backend.
 */
export class GrokAPIService {
    private _distillResult: DistillResult | null = null;
    private _currentRepo: string | null = null;
    private _currentCommit: string | null = null;
    private _abortController: AbortController | null = null;

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
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
    }

    /**
     * Streams a query to the Grok AI backend and processes the response.
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

        if (!repo || !commit) {
            callbacks.onError?.(
                "Repository context not available. Please load a schematic from GitHub.",
            );
            return;
        }

        // Abort any existing request
        this.abort();
        const abortController = new AbortController();
        this._abortController = abortController;

        callbacks.onStart?.();

        try {
            // Fetch distilled schematic if needed
            const fullDistilled = await this.getDistilledSchematic(repo, commit);

            // Check if we were aborted during the async operation
            if (abortController.signal.aborted) {
                return;
            }

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

            const response = await fetch(
                `${API_BASE_URL}/grok/selection/stream`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Accept: "text/event-stream",
                    },
                    body: JSON.stringify({
                        repo,
                        commit,
                        component_ids: componentIds,
                        query,
                        distilled,
                        thinking_mode: thinkingMode,
                    } satisfies GrokStreamRequest),
                    signal: abortController.signal,
                },
            );

            if (!response.ok) {
                throw new Error(
                    `HTTP ${response.status}: ${response.statusText}`,
                );
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let fullContent = "";

            if (reader) {
                let done = false;
                while (!done) {
                    const result = await reader.read();
                    done = result.done;

                    if (result.value) {
                        const chunk = decoder.decode(result.value);
                        const lines = chunk.split("\n");

                        for (const line of lines) {
                            if (line.startsWith("data: ")) {
                                const data = line.slice(6);

                                if (data === "[DONE]") {
                                    done = true;
                                    break;
                                } else if (data.startsWith("[ERROR:")) {
                                    callbacks.onError?.(data);
                                    done = true;
                                    break;
                                } else {
                                    fullContent += data;
                                    callbacks.onChunk?.(fullContent);
                                }
                            }
                        }
                    }
                }
            }

            callbacks.onComplete?.(fullContent);
        } catch (err) {
            // Don't report abort errors
            if (err instanceof Error && err.name === "AbortError") {
                return;
            }

            console.error("[GrokAPIService] Stream error:", err);
            callbacks.onError?.(
                err instanceof Error
                    ? err.message
                    : "Failed to connect to Grok AI",
            );
        } finally {
            this._abortController = null;
        }
    }
}

/** Singleton instance for convenience */
export const grokAPI = new GrokAPIService();

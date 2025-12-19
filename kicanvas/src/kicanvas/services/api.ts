/*
    API service for communicating with the groki backend.
    Git operations are handled entirely in the frontend using isomorphic-git.
    Distillation is now handled in the browser (see distill-service.ts).
    Backend is only used for AI features that require server-side processing.
*/

import { API_BASE_URL } from "../../config";
import { GitService } from "./git-service";

// Re-export distillation types from the kicad module
export type {
    DistilledSchematic,
    DistilledComponent,
    DistilledPin,
    DistilledNet,
    ProximityEdge,
} from "../../kicad/distill";

console.log(`[API] Using backend URL: ${API_BASE_URL}`);

// ============================================================================
// DigiKey Types
// ============================================================================

export interface DigiKeyParameter {
    name: string;
    value: string;
}

export interface DigiKeyPartInfo {
    digikey_part_number: string | null;
    manufacturer_part_number: string | null;
    manufacturer: string | null;
    description: string | null;
    detailed_description: string | null;
    product_url: string | null;
    datasheet_url: string | null;
    photo_url: string | null;
    quantity_available: number | null;
    unit_price: number | null;
    product_status: string | null;
    is_obsolete: boolean;
    lifecycle_status: string | null;
    category: string | null;
    parameters: DigiKeyParameter[];
}

export interface DigiKeySearchResponse {
    query: string;
    success: boolean;
    error: string | null;
    parts: DigiKeyPartInfo[];
    total_count: number;
}

export interface DigiKeyStatusResponse {
    configured: boolean;
    message: string;
}

export interface GrokObsoleteReplacementRequest {
    manufacturer_part_number: string;
    manufacturer: string | null;
    description: string | null;
    category: string | null;
    datasheet_url: string | null;
    product_url: string | null;
    parameters: DigiKeyParameter[];
}

export interface GrokObsoleteReplacementResponse {
    original_part: string;
    analysis: string;
    success: boolean;
    error: string | null;
}

export interface CommitInfo {
    commit_hash: string;
    commit_date: string | null;
    message: string | null;
    has_schematic_changes: boolean;
}

export interface RepoCommitsResponse {
    repo: string;
    commits: CommitInfo[];
}

export interface SchematicFile {
    path: string;
    content: string;
}

export interface CommitFilesResponse {
    repo: string;
    commit: string;
    files: SchematicFile[];
}

export interface CommitInfoResponse {
    repo: string;
    commit: string;
    commit_date: string | null;
    message: string | null;
    blurb: string | null;
    description: string | null;
    changed_files: string[];
}

// Cache clear response type (used by grok-api-service for compatibility)
export interface RepoClearCacheResponse {
    repo: string;
    cleared: boolean;
    message: string;
}

export interface GrokSelectionRequest {
    repo: string;
    commit: string;
    component_ids: string[];
    query: string;
}

export class GrokiAPI {
    private static baseUrl = API_BASE_URL;

    /**
     * Set the API base URL (useful for testing or different environments)
     */
    static setBaseUrl(url: string): void {
        this.baseUrl = url;
    }

    // ========================================================================
    // Git Operations (Frontend-only using isomorphic-git)
    // ========================================================================

    /**
     * Get all commits with a flag indicating if they modify .kicad_sch files.
     * Uses isomorphic-git in the browser - no backend required.
     */
    static async getCommits(repo: string): Promise<CommitInfo[]> {
        return GitService.getAllCommits(repo);
    }

    /**
     * Get all .kicad_sch files at a specific commit.
     * Uses isomorphic-git in the browser - no backend required.
     */
    static async getCommitFiles(
        repo: string,
        commit: string,
    ): Promise<SchematicFile[]> {
        return GitService.getSchematicFiles(repo, commit);
    }

    /**
     * Get detailed information about a specific commit.
     * Uses isomorphic-git in the browser - no backend required.
     */
    static async getCommitInfo(
        repo: string,
        commit: string,
    ): Promise<CommitInfoResponse> {
        const [commitInfo, changedFiles] = await Promise.all([
            GitService.getCommitInfo(repo, commit),
            GitService.getChangedSchematicFiles(repo, commit),
        ]);

        return {
            repo,
            commit,
            commit_date: commitInfo.commit_date,
            message: commitInfo.message,
            blurb: null, // No backend storage for blurbs anymore
            description: null, // No backend storage for descriptions anymore
            changed_files: changedFiles,
        };
    }

    /**
     * Get the latest commit hash for a repository.
     * Uses isomorphic-git in the browser - no backend required.
     */
    static async getLatestCommit(repo: string): Promise<string> {
        return GitService.getLatestCommit(repo);
    }

    /**
     * Invalidate the local git cache for a repository.
     * This clears the in-memory clone and forces a fresh fetch.
     */
    static invalidateGitCache(repo: string): void {
        GitService.invalidateCache(repo);
    }

    // ========================================================================
    // Backend API Methods (AI features only - distillation is browser-based)
    // ========================================================================

    /**
     * Create an EventSource for streaming Grok selection analysis
     * Returns the URL to connect to - caller manages the EventSource
     */
    static getGrokSelectionStreamUrl(
        repo: string,
        commit: string,
        componentIds: string[],
        query: string,
    ): string {
        const params = new URLSearchParams({
            repo,
            commit,
            query,
            component_ids: componentIds.join(","),
        });
        return `${this.baseUrl}/grok/selection/stream?${params.toString()}`;
    }

    /**
     * Extract repo identifier from a GitHub URL
     * e.g., "https://github.com/owner/repo" -> "owner/repo"
     */
    static extractRepoFromUrl(url: string): string | null {
        try {
            const parsed = new URL(url, "https://github.com");
            const pathParts = parsed.pathname.split("/").filter(Boolean);

            if (pathParts.length >= 2) {
                return `${pathParts[0]}/${pathParts[1]}`;
            }
            return null;
        } catch {
            return null;
        }
    }

    // ========================================================================
    // DigiKey API Methods
    // ========================================================================

    /**
     * Check if DigiKey integration is configured on the backend
     */
    static async getDigiKeyStatus(): Promise<DigiKeyStatusResponse> {
        try {
            const response = await fetch(`${this.baseUrl}/digikey/status`, {
                method: "GET",
                headers: {
                    "Content-Type": "application/json",
                },
            });

            if (!response.ok) {
                return {
                    configured: false,
                    message: `Failed to check DigiKey status: ${response.status}`,
                };
            }

            return await response.json();
        } catch (e) {
            return {
                configured: false,
                message:
                    e instanceof Error
                        ? e.message
                        : "Failed to connect to backend",
            };
        }
    }

    /**
     * Search DigiKey for part information
     * @param query - Search query (part number, keyword, etc.)
     * @param mpn - Optional manufacturer part number for more precise search
     */
    static async searchDigiKey(
        query: string,
        mpn?: string,
    ): Promise<DigiKeySearchResponse> {
        try {
            const response = await fetch(`${this.baseUrl}/digikey/search`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ query, mpn }),
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => "");
                return {
                    query: mpn || query,
                    success: false,
                    error: `Search failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`,
                    parts: [],
                    total_count: 0,
                };
            }

            return await response.json();
        } catch (e) {
            return {
                query: mpn || query,
                success: false,
                error:
                    e instanceof Error
                        ? e.message
                        : "Failed to connect to backend",
                parts: [],
                total_count: 0,
            };
        }
    }

    // ========================================================================
    // Grok AI Methods
    // ========================================================================

    /**
     * Find replacement parts for an obsolete component using Grok AI
     * @param part - The obsolete DigiKey part information
     */
    static async findObsoleteReplacement(
        part: DigiKeyPartInfo,
    ): Promise<GrokObsoleteReplacementResponse> {
        try {
            const request: GrokObsoleteReplacementRequest = {
                manufacturer_part_number:
                    part.manufacturer_part_number || "Unknown",
                manufacturer: part.manufacturer,
                description: part.description,
                category: part.category,
                datasheet_url: part.datasheet_url,
                product_url: part.product_url,
                parameters: part.parameters,
            };

            const response = await fetch(
                `${this.baseUrl}/grok/obsolete/replacement`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify(request),
                },
            );

            if (!response.ok) {
                const errorText = await response.text().catch(() => "");
                return {
                    original_part: part.manufacturer_part_number || "Unknown",
                    analysis: "",
                    success: false,
                    error: `Request failed: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`,
                };
            }

            return await response.json();
        } catch (e) {
            return {
                original_part: part.manufacturer_part_number || "Unknown",
                analysis: "",
                success: false,
                error:
                    e instanceof Error
                        ? e.message
                        : "Failed to connect to backend",
            };
        }
    }
}

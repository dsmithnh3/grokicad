/*
    API service for GrokiCAD.
    Git operations are handled via GitHub REST API.
    Distillation is handled in the browser (see distill-service.ts).
    DigiKey integration uses OAuth 3-legged flow via Cloudflare Worker (see digikey-client.ts).
*/

import { GitService } from "./git-service";

// Re-export distillation types from the kicad module
export type {
    DistilledSchematic,
    DistilledComponent,
    DistilledPin,
    DistilledNet,
    ProximityEdge,
} from "../../kicad/distill";

// Re-export DigiKey types and client from the new module
export type {
    DigiKeyParameter,
    DigiKeyPartInfo,
    DigiKeySearchResponse,
    DigiKeyStatusResponse,
} from "./digikey-client";
export { DigiKeyClient } from "./digikey-client";

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
    // Note: DigiKey API methods have been moved to DigiKeyClient.
    // Import { DigiKeyClient } from "./digikey-client" for DigiKey integration.

    // ========================================================================
    // Git Operations (via GitHub REST API - lazy loading)
    // ========================================================================

    /**
     * Get initial commits (first page only for fast loading).
     * For more commits, use getCommitsPage().
     */
    static async getCommits(
        repo: string,
        onProgress?: (progress: {
            phase: string;
            loaded: number;
            total: number;
        }) => void,
    ): Promise<CommitInfo[]> {
        return GitService.getAllCommits(repo, onProgress);
    }

    /**
     * Get a page of commits (for lazy loading / infinite scroll).
     * @param repo - Repository slug (owner/repo)
     * @param page - Page number (1-indexed)
     * @param perPage - Commits per page (default 20)
     * @returns Commits and whether there are more pages
     */
    static async getCommitsPage(
        repo: string,
        page: number = 1,
        perPage: number = 20,
    ): Promise<{ commits: CommitInfo[]; hasMore: boolean }> {
        return GitService.getCommitsPage(repo, page, perPage);
    }

    /**
     * Get all .kicad_sch files at a specific commit.
     */
    static async getCommitFiles(
        repo: string,
        commit: string,
    ): Promise<SchematicFile[]> {
        return GitService.getSchematicFiles(repo, commit);
    }

    /**
     * Get detailed information about a specific commit.
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
            blurb: null,
            description: null,
            changed_files: changedFiles,
        };
    }

    /**
     * Get the latest commit hash for a repository.
     */
    static async getLatestCommit(repo: string): Promise<string> {
        return GitService.getLatestCommit(repo);
    }

    /**
     * Invalidate the local cache for a repository.
     */
    static invalidateGitCache(repo: string): void {
        GitService.invalidateCache(repo);
    }

    // ========================================================================
    // Utility Methods
    // ========================================================================

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
}

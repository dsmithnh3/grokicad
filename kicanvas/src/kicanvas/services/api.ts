/*
    API service for communicating with the groki backend.
    Git operations are handled entirely in the frontend using isomorphic-git.
    Distillation is now handled in the browser (see distill-service.ts).
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
    // Git Operations (Frontend-only using isomorphic-git)
    // ========================================================================

    /**
     * Get all commits with a flag indicating if they modify .kicad_sch files.
     * Uses isomorphic-git in the browser - no backend required.
     */
    static async getCommits(repo: string, onProgress?: (progress: { phase: string; loaded: number; total: number }) => void): Promise<CommitInfo[]> {
        return GitService.getAllCommits(repo, onProgress);
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

/*
    Frontend Git Service using GitHub REST API.
    
    Designed for lazy, efficient loading:
    - Only fetch what's needed, when it's needed
    - Paginate commit history
    - Cache aggressively
    - Minimize API calls
*/

import { GitHubAPI, GitHubAPIError, type CommitInfo, type SchematicFile, type CachedRepoInfo } from "./github-api";

// Re-export types for backward compatibility
export type { CommitInfo, SchematicFile, CachedRepoInfo };
export { GitHubAPIError as GitServiceError };

// ============================================================================
// Configuration
// ============================================================================

/** Progress callback for operations */
export interface CloneProgress {
    phase: "Counting" | "Compressing" | "Receiving" | "Fetching" | "Processing";
    loaded: number;
    total: number;
}

export type CloneProgressCallback = (progress: CloneProgress) => void;

/** Configuration options for the GitService */
export interface GitServiceConfig {
    /** Maximum commits per page */
    commitsPerPage: number;
    /** Enable debug logging */
    debug: boolean;
}

const DEFAULT_CONFIG: GitServiceConfig = {
    commitsPerPage: 20,
    debug: false,
};

// ============================================================================
// Git Service
// ============================================================================

/**
 * Frontend git service using GitHub REST API.
 * 
 * Key design principles:
 * - LAZY: Don't fetch until needed
 * - EFFICIENT: Minimal API calls
 * - PAGINATED: Load history incrementally
 */
export class GitService {
    private static config: GitServiceConfig = { ...DEFAULT_CONFIG };

    /**
     * Configure the GitService
     */
    static configure(config: Partial<GitServiceConfig>): void {
        this.config = { ...this.config, ...config };
        GitHubAPI.setDebug(config.debug ?? false);
    }

    /**
     * Get current configuration
     */
    static getConfig(): Readonly<GitServiceConfig> {
        return { ...this.config };
    }

    private static log(message: string, ...args: unknown[]): void {
        if (this.config.debug) {
            console.log(`[GitService] ${message}`, ...args);
        }
    }

    /**
     * Validate and sanitize repository slug format
     */
    private static validateAndSanitizeRepoSlug(repoSlug: string): string {
        const { owner, repo } = GitHubAPI.validateRepoSlug(repoSlug);
        return `${owner}/${repo}`;
    }

    /**
     * Check if a repository has been accessed before
     */
    static async isRepoCached(repoSlug: string): Promise<boolean> {
        try {
            const sanitizedSlug = this.validateAndSanitizeRepoSlug(repoSlug);
            return GitHubAPI.isRepoCached(sanitizedSlug);
        } catch {
            return false;
        }
    }

    /**
     * Get list of all recently accessed repositories
     */
    static async getCachedRepos(): Promise<CachedRepoInfo[]> {
        return GitHubAPI.getCachedRepos();
    }

    /**
     * Validate repository exists (lightweight check)
     */
    static async ensureRepo(
        repoSlug: string,
        onProgress?: CloneProgressCallback,
    ): Promise<void> {
        const sanitizedSlug = this.validateAndSanitizeRepoSlug(repoSlug);

        onProgress?.({ phase: "Fetching", loaded: 0, total: 1 });

        try {
            await GitHubAPI.getRepoInfo(sanitizedSlug);
            this.log(`Validated repo: ${sanitizedSlug}`);
            onProgress?.({ phase: "Fetching", loaded: 1, total: 1 });
        } catch (error) {
            if (error instanceof GitHubAPIError) {
                throw error;
            }
            throw new GitHubAPIError(
                `Failed to access ${sanitizedSlug}: ${error instanceof Error ? error.message : String(error)}`,
                "API_ERROR",
                error,
            );
        }
    }

    /**
     * Invalidate cache for a repository
     */
    static async invalidateCache(repoSlug: string): Promise<void> {
        try {
            const sanitizedSlug = this.validateAndSanitizeRepoSlug(repoSlug);
            GitHubAPI.invalidateCache(sanitizedSlug);
            this.log(`Invalidated cache for ${sanitizedSlug}`);
        } catch (e) {
            console.warn(`[GitService] Failed to invalidate cache for ${repoSlug}:`, e);
        }
    }

    /**
     * Clear ALL cached data
     */
    static async clearAllCaches(): Promise<void> {
        try {
            GitHubAPI.clearAllCaches();
            console.log("[GitService] Cleared all caches");
        } catch (e) {
            console.error("[GitService] Failed to clear caches:", e);
            throw new GitHubAPIError("Failed to clear caches", "API_ERROR", e);
        }
    }

    /**
     * Get cache statistics
     */
    static async getCacheStats(): Promise<{
        repoCount: number;
        repos: CachedRepoInfo[];
    }> {
        const repos = GitHubAPI.getCachedRepos();
        return {
            repoCount: repos.length,
            repos,
        };
    }

    /**
     * Get storage quota (null - we don't use local storage for cloning)
     */
    static async getStorageQuota(): Promise<{
        usage: number;
        quota: number;
        usagePercent: number;
    } | null> {
        return GitHubAPI.getStorageQuota();
    }

    // ========================================================================
    // LAZY COMMIT LOADING
    // ========================================================================

    /**
     * Get a page of commits (for lazy loading in UI)
     */
    static async getCommitsPage(
        repoSlug: string,
        page: number = 1,
        perPage: number = 20,
    ): Promise<{ commits: CommitInfo[]; hasMore: boolean }> {
        const sanitizedSlug = this.validateAndSanitizeRepoSlug(repoSlug);
        return GitHubAPI.getCommitsPage(sanitizedSlug, { page, perPage });
    }

    /**
     * Get initial commits for display (just first page)
     * Much faster than loading entire history
     */
    static async getAllCommits(
        repoSlug: string,
        onProgress?: CloneProgressCallback,
    ): Promise<CommitInfo[]> {
        const sanitizedSlug = this.validateAndSanitizeRepoSlug(repoSlug);

        this.log(`Getting initial commits for ${sanitizedSlug}...`);
        const startTime = performance.now();

        onProgress?.({ phase: "Fetching", loaded: 0, total: 1 });

        // Just get the first page - lazy load more as needed
        const { commits } = await GitHubAPI.getCommitsPage(sanitizedSlug, {
            perPage: this.config.commitsPerPage,
        });

        onProgress?.({ phase: "Processing", loaded: 1, total: 1 });

        const elapsed = performance.now() - startTime;
        this.log(`Got ${commits.length} commits for ${sanitizedSlug} in ${elapsed.toFixed(0)}ms`);

        return commits;
    }

    // ========================================================================
    // SCHEMATIC FILES
    // ========================================================================

    /**
     * Get all .kicad_sch and .kicad_pro files at a specific commit
     */
    static async getSchematicFiles(
        repoSlug: string,
        commitHash: string,
    ): Promise<SchematicFile[]> {
        const sanitizedSlug = this.validateAndSanitizeRepoSlug(repoSlug);

        this.log(`Getting schematic files for ${sanitizedSlug}@${commitHash.slice(0, 7)}...`);

        const files = await GitHubAPI.getSchematicFiles(sanitizedSlug, commitHash);

        this.log(`Found ${files.length} KiCad files`);
        return files;
    }

    /**
     * Get changed .kicad_sch file paths for a specific commit
     */
    static async getChangedSchematicFiles(
        repoSlug: string,
        commitHash: string,
    ): Promise<string[]> {
        const sanitizedSlug = this.validateAndSanitizeRepoSlug(repoSlug);
        return GitHubAPI.getChangedSchematicFiles(sanitizedSlug, commitHash);
    }

    /**
     * Get commit info for a specific commit
     */
    static async getCommitInfo(
        repoSlug: string,
        commitHash: string,
    ): Promise<CommitInfo> {
        const sanitizedSlug = this.validateAndSanitizeRepoSlug(repoSlug);
        return GitHubAPI.getCommitInfo(sanitizedSlug, commitHash);
    }

    /**
     * Get the latest commit hash on the default branch
     */
    static async getLatestCommit(repoSlug: string): Promise<string> {
        const sanitizedSlug = this.validateAndSanitizeRepoSlug(repoSlug);
        return GitHubAPI.getLatestCommit(sanitizedSlug);
    }

    /**
     * @deprecated No longer needed with GitHub API
     */
    static setCorsProxy(_url: string): void {
        console.warn("[GitService] setCorsProxy is deprecated and has no effect");
    }
}

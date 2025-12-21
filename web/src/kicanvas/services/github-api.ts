/*
    GitHub API Service
    
    Provides lazy, on-demand access to GitHub repositories via the REST API.
    Designed for efficiency - only fetches what's needed, when it's needed.
    
    Key principles:
    - Lazy loading: Don't fetch data until it's requested
    - Pagination: Only fetch visible items, not entire history
    - Caching: Aggressive caching with ETags
    - Minimal API calls: Avoid redundant requests
*/

import { GitHubAuthService } from "./github-auth";

// ============================================================================
// Types
// ============================================================================

export interface GitHubCommit {
    sha: string;
    commit: {
        author: {
            name: string;
            email: string;
            date: string;
        };
        message: string;
        tree: {
            sha: string;
        };
    };
    parents: Array<{ sha: string }>;
}

export interface GitHubTreeEntry {
    path: string;
    mode: string;
    type: "blob" | "tree";
    sha: string;
    size?: number;
}

export interface GitHubTree {
    sha: string;
    tree: GitHubTreeEntry[];
    truncated: boolean;
}

export interface GitHubBlob {
    sha: string;
    content: string;
    encoding: "base64" | "utf-8";
    size: number;
}

export interface GitHubRateLimit {
    limit: number;
    remaining: number;
    reset: number;
    used: number;
}

export interface CommitInfo {
    commit_hash: string;
    commit_date: string | null;
    message: string | null;
    has_schematic_changes: boolean;
}

export interface SchematicFile {
    path: string;
    content: string;
}

export interface CachedRepoInfo {
    slug: string;
    lastAccessed: string;
    defaultBranch: string;
}

// ============================================================================
// Error Types
// ============================================================================

export class GitHubAPIError extends Error {
    public readonly code:
        | "NOT_FOUND"
        | "RATE_LIMITED"
        | "UNAUTHORIZED"
        | "FORBIDDEN"
        | "NETWORK_ERROR"
        | "INVALID_REPO"
        | "API_ERROR";

    constructor(
        message: string,
        code: GitHubAPIError["code"],
        public override readonly cause?: unknown,
    ) {
        super(message);
        this.name = "GitHubAPIError";
        this.code = code;
    }
}

// ============================================================================
// Cache
// ============================================================================

interface CacheEntry<T> {
    data: T;
    timestamp: number;
    etag?: string;
}

class APICache {
    private cache = new Map<string, CacheEntry<unknown>>();
    private readonly maxAge = 5 * 60 * 1000; // 5 minutes default

    get<T>(key: string): T | null {
        const entry = this.cache.get(key);
        if (!entry) return null;

        if (Date.now() - entry.timestamp > this.maxAge) {
            this.cache.delete(key);
            return null;
        }

        return entry.data as T;
    }

    set<T>(key: string, data: T, etag?: string): void {
        this.cache.set(key, {
            data,
            timestamp: Date.now(),
            etag,
        });
    }

    getEtag(key: string): string | undefined {
        return this.cache.get(key)?.etag;
    }

    delete(key: string): void {
        // Delete all entries that start with this key
        for (const k of this.cache.keys()) {
            if (k.startsWith(key)) {
                this.cache.delete(k);
            }
        }
    }

    clear(): void {
        this.cache.clear();
    }
}

// ============================================================================
// GitHub API Service
// ============================================================================

/**
 * GitHub API service for repository access.
 * Uses lazy loading - only fetches what's needed.
 */
export class GitHubAPI {
    private static cache = new APICache();
    private static repoMetadata = new Map<string, CachedRepoInfo>();
    private static lastRateLimit: GitHubRateLimit | null = null;
    private static debug = false;

    /**
     * Enable/disable debug logging
     */
    static setDebug(enabled: boolean): void {
        this.debug = enabled;
    }

    private static log(message: string, ...args: unknown[]): void {
        if (this.debug) {
            console.log(`[GitHubAPI] ${message}`, ...args);
        }
    }

    /**
     * Get request headers with optional authentication
     */
    private static getHeaders(): HeadersInit {
        const headers: HeadersInit = {
            Accept: "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        };

        const token = GitHubAuthService.getAccessToken();
        if (token) {
            (headers as Record<string, string>)[
                "Authorization"
            ] = `Bearer ${token}`;
        }

        return headers;
    }

    /**
     * Make an authenticated API request
     */
    private static async fetch<T>(
        url: string,
        options: RequestInit = {},
    ): Promise<T> {
        const headers = this.getHeaders();

        // Add conditional request headers if we have a cached etag
        const cachedEtag = this.cache.getEtag(url);
        if (cachedEtag) {
            (headers as Record<string, string>)["If-None-Match"] = cachedEtag;
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers: { ...headers, ...options.headers },
            });

            // Track rate limits
            const rateLimit = response.headers.get("X-RateLimit-Limit");
            const rateRemaining = response.headers.get("X-RateLimit-Remaining");
            const rateReset = response.headers.get("X-RateLimit-Reset");
            const rateUsed = response.headers.get("X-RateLimit-Used");

            if (rateLimit && rateRemaining && rateReset) {
                this.lastRateLimit = {
                    limit: parseInt(rateLimit, 10),
                    remaining: parseInt(rateRemaining, 10),
                    reset: parseInt(rateReset, 10),
                    used: parseInt(rateUsed || "0", 10),
                };
            }

            // Handle 304 Not Modified - return cached data
            if (response.status === 304) {
                const cached = this.cache.get<T>(url);
                if (cached) {
                    return cached;
                }
            }

            // Handle errors
            if (!response.ok) {
                await this.handleError(response, url);
            }

            const data = await response.json();

            // Cache the response
            const etag = response.headers.get("ETag");
            this.cache.set(url, data, etag || undefined);

            return data as T;
        } catch (error) {
            if (error instanceof GitHubAPIError) {
                throw error;
            }
            throw new GitHubAPIError(
                `Network error: ${
                    error instanceof Error ? error.message : String(error)
                }`,
                "NETWORK_ERROR",
                error,
            );
        }
    }

    /**
     * Handle API error responses
     */
    private static async handleError(
        response: Response,
        url: string,
    ): Promise<never> {
        let errorMessage = `GitHub API error: ${response.status}`;

        try {
            const errorBody = await response.json();
            errorMessage = errorBody.message || errorMessage;
        } catch {
            // Ignore JSON parse errors
        }

        switch (response.status) {
            case 401:
                throw new GitHubAPIError(errorMessage, "UNAUTHORIZED");
            case 403:
                if (this.lastRateLimit && this.lastRateLimit.remaining === 0) {
                    const resetDate = new Date(this.lastRateLimit.reset * 1000);
                    throw new GitHubAPIError(
                        `Rate limit exceeded. Resets at ${resetDate.toLocaleTimeString()}`,
                        "RATE_LIMITED",
                    );
                }
                throw new GitHubAPIError(errorMessage, "FORBIDDEN");
            case 404:
                throw new GitHubAPIError(
                    `Repository not found: ${url}`,
                    "NOT_FOUND",
                );
            default:
                throw new GitHubAPIError(errorMessage, "API_ERROR");
        }
    }

    /**
     * Get the last known rate limit info
     */
    static getRateLimit(): GitHubRateLimit | null {
        return this.lastRateLimit;
    }

    /**
     * Validate and parse a repository slug
     */
    static validateRepoSlug(repoSlug: string): { owner: string; repo: string } {
        if (!repoSlug || typeof repoSlug !== "string") {
            throw new GitHubAPIError(
                "Repository slug is required",
                "INVALID_REPO",
            );
        }

        const sanitized = repoSlug.trim();
        const parts = sanitized.split("/");

        if (parts.length !== 2 || !parts[0] || !parts[1]) {
            throw new GitHubAPIError(
                `Invalid repository format: "${repoSlug}". Expected "owner/repo"`,
                "INVALID_REPO",
            );
        }

        const validPattern = /^[a-zA-Z0-9._-]+$/;
        if (!validPattern.test(parts[0]) || !validPattern.test(parts[1])) {
            throw new GitHubAPIError(
                `Invalid repository format: "${repoSlug}". Invalid characters.`,
                "INVALID_REPO",
            );
        }

        return { owner: parts[0], repo: parts[1] };
    }

    // ========================================================================
    // Repository Info
    // ========================================================================

    /**
     * Get repository information including default branch
     */
    static async getRepoInfo(
        repoSlug: string,
    ): Promise<{ default_branch: string }> {
        const { owner, repo } = this.validateRepoSlug(repoSlug);
        const url = `https://api.github.com/repos/${owner}/${repo}`;

        this.log(`Fetching repo info for ${repoSlug}`);
        const data = await this.fetch<{ default_branch: string }>(url);

        // Update metadata
        this.repoMetadata.set(repoSlug, {
            slug: repoSlug,
            lastAccessed: new Date().toISOString(),
            defaultBranch: data.default_branch,
        });

        return data;
    }

    /**
     * Check if we have accessed this repo before
     */
    static isRepoCached(repoSlug: string): boolean {
        return this.repoMetadata.has(repoSlug);
    }

    /**
     * Get list of recently accessed repos
     */
    static getCachedRepos(): CachedRepoInfo[] {
        return Array.from(this.repoMetadata.values()).sort(
            (a, b) =>
                new Date(b.lastAccessed).getTime() -
                new Date(a.lastAccessed).getTime(),
        );
    }

    /**
     * Clear cache for a specific repo
     */
    static invalidateCache(repoSlug: string): void {
        const { owner, repo } = this.validateRepoSlug(repoSlug);
        this.cache.delete(`https://api.github.com/repos/${owner}/${repo}`);
        this.repoMetadata.delete(repoSlug);
        this.log(`Invalidated cache for ${repoSlug}`);
    }

    /**
     * Clear all caches
     */
    static clearAllCaches(): void {
        this.cache.clear();
        this.repoMetadata.clear();
        this.log("Cleared all caches");
    }

    // ========================================================================
    // Commits - LAZY LOADING
    // ========================================================================

    /**
     * Get the latest commit (just one - for initial load)
     */
    static async getLatestCommit(repoSlug: string): Promise<string> {
        const { owner, repo } = this.validateRepoSlug(repoSlug);
        const url = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`;

        this.log(`Fetching latest commit for ${repoSlug}`);
        const commits = await this.fetch<GitHubCommit[]>(url);

        if (commits.length === 0) {
            throw new GitHubAPIError(
                "No commits found in repository",
                "NOT_FOUND",
            );
        }

        // Update metadata
        if (!this.repoMetadata.has(repoSlug)) {
            await this.getRepoInfo(repoSlug);
        } else {
            const meta = this.repoMetadata.get(repoSlug)!;
            meta.lastAccessed = new Date().toISOString();
        }

        return commits[0]!.sha;
    }

    /**
     * Get a page of commits (lazy - for history panel)
     * Only fetches when user scrolls/requests more
     */
    static async getCommitsPage(
        repoSlug: string,
        options: {
            page?: number;
            perPage?: number;
            sha?: string;
        } = {},
    ): Promise<{ commits: CommitInfo[]; hasMore: boolean }> {
        const { owner, repo } = this.validateRepoSlug(repoSlug);
        const { page = 1, perPage = 20, sha } = options;

        const url = new URL(
            `https://api.github.com/repos/${owner}/${repo}/commits`,
        );
        url.searchParams.set("per_page", String(perPage));
        url.searchParams.set("page", String(page));
        if (sha) url.searchParams.set("sha", sha);

        this.log(`Fetching commits page ${page} for ${repoSlug}`);
        const commits = await this.fetch<GitHubCommit[]>(url.toString());

        // Convert to CommitInfo - don't check for schematic changes here (lazy)
        const results: CommitInfo[] = commits.map((commit) => ({
            commit_hash: commit.sha,
            commit_date: commit.commit.author.date,
            message: commit.commit.message.split("\n")[0] ?? null,
            has_schematic_changes: true, // Assume true, check lazily if needed
        }));

        return {
            commits: results,
            hasMore: commits.length === perPage, // If we got a full page, there might be more
        };
    }

    /**
     * Get a single commit's info
     */
    static async getCommit(
        repoSlug: string,
        sha: string,
    ): Promise<GitHubCommit> {
        const { owner, repo } = this.validateRepoSlug(repoSlug);
        const url = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`;
        return this.fetch<GitHubCommit>(url);
    }

    /**
     * Get commit info for a specific commit
     */
    static async getCommitInfo(
        repoSlug: string,
        commitSha: string,
    ): Promise<CommitInfo> {
        const commit = await this.getCommit(repoSlug, commitSha);

        return {
            commit_hash: commitSha,
            commit_date: commit.commit.author.date,
            message: commit.commit.message.split("\n")[0] ?? null,
            has_schematic_changes: true, // Assume true for single commits
        };
    }

    // ========================================================================
    // Trees and Blobs
    // ========================================================================

    /**
     * Get a tree (directory listing) recursively
     */
    static async getTree(
        repoSlug: string,
        treeSha: string,
    ): Promise<GitHubTree> {
        const { owner, repo } = this.validateRepoSlug(repoSlug);
        const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`;
        return this.fetch<GitHubTree>(url);
    }

    /**
     * Get tree at a specific commit
     */
    static async getTreeAtCommit(
        repoSlug: string,
        commitSha: string,
    ): Promise<GitHubTree> {
        const commit = await this.getCommit(repoSlug, commitSha);
        return this.getTree(repoSlug, commit.commit.tree.sha);
    }

    /**
     * Get a blob (file content)
     */
    static async getBlob(repoSlug: string, blobSha: string): Promise<string> {
        const { owner, repo } = this.validateRepoSlug(repoSlug);
        const url = `https://api.github.com/repos/${owner}/${repo}/git/blobs/${blobSha}`;

        const blob = await this.fetch<GitHubBlob>(url);

        if (blob.encoding === "base64") {
            // Decode base64 content
            return atob(blob.content.replace(/\n/g, ""));
        }

        return blob.content;
    }

    // ========================================================================
    // Schematic-specific Methods
    // ========================================================================

    /**
     * Get all .kicad_sch and .kicad_pro files at a specific commit
     * This is the main method for loading schematics
     */
    static async getSchematicFiles(
        repoSlug: string,
        commitSha: string,
    ): Promise<SchematicFile[]> {
        this.log(
            `Getting schematic files for ${repoSlug}@${commitSha.slice(0, 7)}`,
        );

        const tree = await this.getTreeAtCommit(repoSlug, commitSha);

        // Filter for KiCad files
        const kicadFiles = tree.tree.filter(
            (entry) =>
                entry.type === "blob" &&
                (entry.path.endsWith(".kicad_sch") ||
                    entry.path.endsWith(".kicad_pro")),
        );

        this.log(`Found ${kicadFiles.length} KiCad files`);

        // Fetch file contents in parallel (with concurrency limit)
        const files: SchematicFile[] = [];
        const concurrency = 5;

        for (let i = 0; i < kicadFiles.length; i += concurrency) {
            const batch = kicadFiles.slice(i, i + concurrency);
            const results = await Promise.all(
                batch.map(async (entry) => {
                    try {
                        const content = await this.getBlob(repoSlug, entry.sha);
                        return { path: entry.path, content };
                    } catch (error) {
                        console.warn(
                            `[GitHubAPI] Failed to fetch ${entry.path}:`,
                            error,
                        );
                        return null;
                    }
                }),
            );

            for (const result of results) {
                if (result) {
                    files.push(result);
                }
            }
        }

        return files;
    }

    /**
     * Get changed .kicad_sch file paths for a specific commit
     * Only called when user views a specific commit's changes
     */
    static async getChangedSchematicFiles(
        repoSlug: string,
        commitSha: string,
    ): Promise<string[]> {
        const { owner, repo } = this.validateRepoSlug(repoSlug);

        // Get the commit with files
        const url = `https://api.github.com/repos/${owner}/${repo}/commits/${commitSha}`;

        interface CommitWithFiles extends GitHubCommit {
            files?: Array<{ filename: string; status: string }>;
        }

        const commit = await this.fetch<CommitWithFiles>(url);

        return (commit.files ?? [])
            .filter((file) => file.filename.endsWith(".kicad_sch"))
            .map((file) => file.filename);
    }

    // ========================================================================
    // Compatibility Methods (for existing code)
    // ========================================================================

    /**
     * Get all commits with schematic change detection
     * @deprecated Use getCommitsPage for lazy loading instead
     */
    static async getAllCommits(
        repoSlug: string,
        onProgress?: (progress: {
            phase: string;
            loaded: number;
            total: number;
        }) => void,
    ): Promise<CommitInfo[]> {
        onProgress?.({ phase: "Fetching", loaded: 0, total: 0 });

        // Just get the first page for initial display
        const { commits } = await this.getCommitsPage(repoSlug, {
            perPage: 50,
        });

        onProgress?.({
            phase: "Processing",
            loaded: commits.length,
            total: commits.length,
        });

        return commits;
    }

    // ========================================================================
    // Storage Info (for UI compatibility)
    // ========================================================================

    /**
     * Get storage quota info (returns null as we don't use IndexedDB for cloning)
     */
    static getStorageQuota(): {
        usage: number;
        quota: number;
        usagePercent: number;
    } | null {
        return null;
    }
}

/*
    Frontend Git Service using isomorphic-git with IndexedDB persistence.
    Replaces the backend git2-based implementation for commit history
    and file retrieval at specific commits.

    Uses lightning-fs for persistent IndexedDB storage so cloned repos
    survive page reloads.
*/

// Buffer polyfill for browser environment (required by isomorphic-git)
import { Buffer } from "buffer";
if (typeof globalThis.Buffer === "undefined") {
    globalThis.Buffer = Buffer;
}

import git, { type ReadCommitResult } from "isomorphic-git";
import http from "isomorphic-git/http/web";
import LightningFS from "@isomorphic-git/lightning-fs";

// ============================================================================
// Configuration
// ============================================================================

/** Progress callback for clone operations */
export interface CloneProgress {
    phase: 'Counting' | 'Compressing' | 'Receiving';
    loaded: number;
    total: number;
}

export type CloneProgressCallback = (progress: CloneProgress) => void;

/** Configuration options for the GitService */
export interface GitServiceConfig {
    /** CORS proxy URL for GitHub access */
    corsProxy: string;
    /** Maximum depth of commits to fetch (limits memory usage) */
    maxCommitDepth: number;
    /** Clone timeout in milliseconds */
    cloneTimeoutMs: number;
    /** Enable debug logging */
    debug: boolean;
    /** IndexedDB database name */
    dbName: string;
}

const DEFAULT_CONFIG: GitServiceConfig = {
    corsProxy: "https://cors.isomorphic-git.org",
    maxCommitDepth: 500,
    cloneTimeoutMs: 60000, // 60 seconds
    debug: false,
    dbName: "grokicad-git",
};

// ============================================================================
// Types
// ============================================================================

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

/** Cached repository metadata */
export interface CachedRepoInfo {
    slug: string;
    clonedAt: string;
    lastAccessed: string;
}

/** Error thrown when a git operation fails */
export class GitServiceError extends Error {
    public readonly code:
        | "CLONE_FAILED"
        | "TIMEOUT"
        | "NOT_FOUND"
        | "NETWORK_ERROR"
        | "INVALID_REPO"
        | "DB_ERROR";

    constructor(
        message: string,
        code:
            | "CLONE_FAILED"
            | "TIMEOUT"
            | "NOT_FOUND"
            | "NETWORK_ERROR"
            | "INVALID_REPO"
            | "DB_ERROR",
        public override readonly cause?: unknown,
    ) {
        super(message);
        this.name = "GitServiceError";
        this.code = code;
    }
}

// ============================================================================
// Metadata Storage (separate from git data)
// ============================================================================

const METADATA_STORE = "repo-metadata";

interface RepoMetadata {
    slug: string;
    clonedAt: string;
    lastAccessed: string;
}

async function openMetadataDB(dbName: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(`${dbName}-metadata`, 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(METADATA_STORE)) {
                db.createObjectStore(METADATA_STORE, { keyPath: "slug" });
            }
        };
    });
}

async function saveRepoMetadata(
    dbName: string,
    metadata: RepoMetadata,
): Promise<void> {
    try {
        const db = await openMetadataDB(dbName);
        return new Promise((resolve, reject) => {
            const tx = db.transaction(METADATA_STORE, "readwrite");
            const store = tx.objectStore(METADATA_STORE);
            const request = store.put(metadata);
            request.onerror = () => {
                const error = request.error;
                db.close();
                // Check for quota errors
                if (
                    error &&
                    (error.name === "QuotaExceededError" ||
                        error.message?.includes("quota"))
                ) {
                    reject(
                        new Error(
                            "Storage quota exceeded. Please clear some cached repositories.",
                        ),
                    );
                } else {
                    reject(error);
                }
            };
            request.onsuccess = () => resolve();
            tx.oncomplete = () => db.close();
        });
    } catch (e) {
        const message =
            e instanceof Error ? e.message : String(e);
        if (
            message.includes("QuotaExceededError") ||
            message.includes("quota")
        ) {
            throw new Error(
                "Storage quota exceeded. Please clear some cached repositories.",
            );
        }
        throw e;
    }
}

async function getRepoMetadata(
    dbName: string,
    slug: string,
): Promise<RepoMetadata | null> {
    const db = await openMetadataDB(dbName);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(METADATA_STORE, "readonly");
        const store = tx.objectStore(METADATA_STORE);
        const request = store.get(slug);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result ?? null);
        tx.oncomplete = () => db.close();
    });
}

async function getAllRepoMetadata(dbName: string): Promise<RepoMetadata[]> {
    const db = await openMetadataDB(dbName);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(METADATA_STORE, "readonly");
        const store = tx.objectStore(METADATA_STORE);
        const request = store.getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result ?? []);
        tx.oncomplete = () => db.close();
    });
}

async function deleteRepoMetadata(
    dbName: string,
    slug: string,
): Promise<void> {
    const db = await openMetadataDB(dbName);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(METADATA_STORE, "readwrite");
        const store = tx.objectStore(METADATA_STORE);
        const request = store.delete(slug);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
        tx.oncomplete = () => db.close();
    });
}

async function clearAllRepoMetadata(dbName: string): Promise<void> {
    const db = await openMetadataDB(dbName);
    return new Promise((resolve, reject) => {
        const tx = db.transaction(METADATA_STORE, "readwrite");
        const store = tx.objectStore(METADATA_STORE);
        const request = store.clear();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
        tx.oncomplete = () => db.close();
    });
}

// ============================================================================
// Git Service
// ============================================================================

/**
 * Frontend git service using isomorphic-git with IndexedDB persistence.
 *
 * Features:
 * - Persistent IndexedDB storage via lightning-fs
 * - Cloned repos survive page reloads
 * - Concurrent clone prevention (deduplication)
 * - Configurable timeouts and depth limits
 * - Proper error handling with typed errors
 */
export class GitService {
    private static fs: LightningFS | null = null;
    private static cloneInProgress: Map<string, Promise<void>> = new Map();
    private static config: GitServiceConfig = { ...DEFAULT_CONFIG };
    private static progressCallbacks: Map<string, CloneProgressCallback> = new Map();

    /**
     * Initialize the filesystem (lazy initialization)
     */
    private static async ensureInitialized(): Promise<LightningFS> {
        if (!this.fs) {
            this.fs = new LightningFS(this.config.dbName);
            this.log("Initialized IndexedDB filesystem");
        }
        return this.fs;
    }

    /**
     * Configure the GitService
     */
    static configure(config: Partial<GitServiceConfig>): void {
        // If dbName changes after initialization, we need to reinitialize
        if (config.dbName && config.dbName !== this.config.dbName && this.fs) {
            this.fs = null;
        }
        this.config = { ...this.config, ...config };
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

    private static warn(message: string, ...args: unknown[]): void {
        console.warn(`[GitService] ${message}`, ...args);
    }

    /**
     * Validate and sanitize repository slug format
     * @returns The sanitized repository slug
     * @throws GitServiceError if the slug is invalid
     */
    private static validateAndSanitizeRepoSlug(repoSlug: string): string {
        if (!repoSlug || typeof repoSlug !== "string") {
            throw new GitServiceError(
                "Repository slug is required",
                "INVALID_REPO",
            );
        }

        // Sanitize: remove leading/trailing whitespace
        const sanitized = repoSlug.trim();

        // Validate format: owner/repo
        const parts = sanitized.split("/");
        if (parts.length !== 2 || !parts[0] || !parts[1]) {
            throw new GitServiceError(
                `Invalid repository format: "${repoSlug}". Expected "owner/repo"`,
                "INVALID_REPO",
            );
        }

        // Validate owner and repo names don't contain invalid characters
        const owner = parts[0]!;
        const repo = parts[1]!;

        // GitHub allows: alphanumeric, hyphens, underscores, dots
        // But we'll be more restrictive for security
        const validPattern = /^[a-zA-Z0-9._-]+$/;
        if (!validPattern.test(owner) || !validPattern.test(repo)) {
            throw new GitServiceError(
                `Invalid repository format: "${repoSlug}". Owner and repo names can only contain alphanumeric characters, dots, hyphens, and underscores.`,
                "INVALID_REPO",
            );
        }

        // Check reasonable length limits (GitHub allows up to 100 chars for owner, 100 for repo)
        if (owner.length > 100 || repo.length > 100) {
            throw new GitServiceError(
                `Repository slug too long: "${repoSlug}"`,
                "INVALID_REPO",
            );
        }

        return sanitized;
    }

    /**
     * Get the directory path for a repository
     */
    private static getRepoDir(repoSlug: string): string {
        return `/${repoSlug.replace("/", "-")}`;
    }

    /**
     * Check if a repository is already cloned in IndexedDB
     */
    static async isRepoCached(repoSlug: string): Promise<boolean> {
        try {
            const sanitizedSlug = this.validateAndSanitizeRepoSlug(repoSlug);
            const fs = await this.ensureInitialized();
            const dir = this.getRepoDir(sanitizedSlug);
            await git.resolveRef({ fs, dir, ref: "HEAD" });
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Get list of all cached repositories, sorted by last accessed (most recent first)
     */
    static async getCachedRepos(): Promise<CachedRepoInfo[]> {
        try {
            const metadata = await getAllRepoMetadata(this.config.dbName);
            return metadata
                .map((m) => ({
                    slug: m.slug,
                    clonedAt: m.clonedAt,
                    lastAccessed: m.lastAccessed,
                }))
                .sort((a, b) => {
                    // Sort by lastAccessed descending (most recent first)
                    return (
                        new Date(b.lastAccessed).getTime() -
                        new Date(a.lastAccessed).getTime()
                    );
                });
        } catch (e) {
            this.warn("Failed to get cached repos:", e);
            return [];
        }
    }

    /**
     * Clone a repository if not already cached.
     * Handles concurrent requests by deduplicating clone operations.
     */
    static async ensureRepo(
        repoSlug: string,
        onProgress?: CloneProgressCallback,
    ): Promise<{ fs: LightningFS; dir: string }> {
        const sanitizedSlug = this.validateAndSanitizeRepoSlug(repoSlug);

        const fs = await this.ensureInitialized();
        const dir = this.getRepoDir(sanitizedSlug);

        // Check if already cloned
        try {
            await git.resolveRef({ fs, dir, ref: "HEAD" });
            // Update last accessed time
            const existing = await getRepoMetadata(this.config.dbName, sanitizedSlug);
            if (existing) {
                await saveRepoMetadata(this.config.dbName, {
                    ...existing,
                    lastAccessed: new Date().toISOString(),
                });
            }
            this.log(`Using cached repo: ${sanitizedSlug}`);
            return { fs, dir };
        } catch {
            // Not cloned yet, need to clone
        }

        // Register progress callback
        if (onProgress) {
            this.progressCallbacks.set(sanitizedSlug, onProgress);
        }

        // Check if clone is already in progress (prevents duplicate clones)
        const inProgress = this.cloneInProgress.get(sanitizedSlug);
        if (inProgress) {
            await inProgress;
            return { fs, dir };
        }

        // Start clone with timeout
        const clonePromise = this.cloneRepoWithTimeout(fs, dir, sanitizedSlug);
        this.cloneInProgress.set(sanitizedSlug, clonePromise);

        try {
            await clonePromise;
        } finally {
            this.cloneInProgress.delete(sanitizedSlug);
            this.progressCallbacks.delete(sanitizedSlug);
        }

        return { fs, dir };
    }

    /**
     * Clone a repository with timeout protection
     */
    private static async cloneRepoWithTimeout(
        fs: LightningFS,
        dir: string,
        repoSlug: string,
    ): Promise<void> {
        const url = `https://github.com/${repoSlug}`;

        this.log(`Cloning ${repoSlug}...`);
        const startTime = performance.now();

        // Use Promise.race to implement timeout
        // Note: isomorphic-git doesn't support AbortSignal, so we use Promise.race
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(
                    new GitServiceError(
                        `Clone timed out after ${this.config.cloneTimeoutMs}ms`,
                        "TIMEOUT",
                    ),
                );
            }, this.config.cloneTimeoutMs);
        });

        try {
            const progressCallback = this.progressCallbacks.get(repoSlug);
            
            await Promise.race([
                git.clone({
                    fs,
                    http,
                    dir,
                    url,
                    corsProxy: this.config.corsProxy,
                    singleBranch: true,
                    depth: Math.min(this.config.maxCommitDepth, 100), // Clone depth
                    noTags: true,
                    onProgress: progressCallback ? (progress) => {
                        progressCallback({
                            phase: progress.phase as 'Counting' | 'Compressing' | 'Receiving',
                            loaded: progress.loaded,
                            total: progress.total,
                        });
                    } : undefined,
                }),
                timeoutPromise,
            ]);

            // Clone succeeded - clear the timeout and save metadata
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }

            const elapsed = performance.now() - startTime;
            this.log(`Cloned ${repoSlug} in ${elapsed.toFixed(0)}ms`);

            // Save metadata
            const now = new Date().toISOString();
            try {
                await saveRepoMetadata(this.config.dbName, {
                    slug: repoSlug,
                    clonedAt: now,
                    lastAccessed: now,
                });
            } catch (e) {
                // If metadata save fails (e.g., quota exceeded), log but don't fail
                this.warn(`Failed to save metadata for ${repoSlug}:`, e);
            }
        } catch (error) {
            // Always clear timeout on error
            if (timeoutId !== null) {
                clearTimeout(timeoutId);
            }
            // Clean up failed clone
            try {
                await this.deleteRepoFromFS(fs, dir);
            } catch {
                // Ignore cleanup errors
            }

            // If it's already a GitServiceError (e.g., timeout), rethrow
            if (error instanceof GitServiceError) {
                throw error;
            }

            const message =
                error instanceof Error ? error.message : String(error);

            // Check for IndexedDB quota errors
            if (
                message.includes("QuotaExceededError") ||
                message.includes("quota") ||
                message.includes("storage")
            ) {
                throw new GitServiceError(
                    `Storage quota exceeded. Please clear some cached repositories.`,
                    "DB_ERROR",
                    error,
                );
            }

            if (message.includes("404") || message.includes("not found")) {
                throw new GitServiceError(
                    `Repository not found: ${repoSlug}`,
                    "NOT_FOUND",
                    error,
                );
            }

            if (
                message.includes("fetch") ||
                message.includes("network") ||
                message.includes("CORS")
            ) {
                throw new GitServiceError(
                    `Network error cloning ${repoSlug}: ${message}`,
                    "NETWORK_ERROR",
                    error,
                );
            }

            throw new GitServiceError(
                `Failed to clone ${repoSlug}: ${message}`,
                "CLONE_FAILED",
                error,
            );
        }
    }

    /**
     * Delete a repository directory from the filesystem
     */
    private static async deleteRepoFromFS(
        fs: LightningFS,
        dir: string,
    ): Promise<void> {
        const pfs = fs.promises;
        try {
            const entries = await pfs.readdir(dir);
            for (const entry of entries) {
                const fullPath = `${dir}/${entry}`;
                const stat = await pfs.stat(fullPath);
                if (stat.isDirectory()) {
                    await this.deleteRepoFromFS(fs, fullPath);
                } else {
                    await pfs.unlink(fullPath);
                }
            }
            await pfs.rmdir(dir);
        } catch {
            // Directory might not exist, ignore
        }
    }

    /**
     * Invalidate (delete) a single repository from cache
     */
    static async invalidateCache(repoSlug: string): Promise<void> {
        try {
            const fs = await this.ensureInitialized();
            const dir = this.getRepoDir(repoSlug);
            await this.deleteRepoFromFS(fs, dir);
            await deleteRepoMetadata(this.config.dbName, repoSlug);
            this.log(`Invalidated cache for ${repoSlug}`);
        } catch (e) {
            this.warn(`Failed to invalidate cache for ${repoSlug}:`, e);
        }
    }

    /**
     * Clear ALL cached repositories from IndexedDB
     */
    static async clearAllCaches(): Promise<void> {
        try {
            // Delete the entire IndexedDB database
            if (this.fs) {
                // Get all repos and delete them
                const repos = await this.getCachedRepos();
                const fs = this.fs;
                for (const repo of repos) {
                    const dir = this.getRepoDir(repo.slug);
                    await this.deleteRepoFromFS(fs, dir);
                }
            }

            // Clear metadata
            await clearAllRepoMetadata(this.config.dbName);

            // Delete the lightning-fs database
            const dbName = this.config.dbName;
            await new Promise<void>((resolve, reject) => {
                const request = indexedDB.deleteDatabase(dbName);
                request.onsuccess = () => resolve();
                request.onerror = () => reject(request.error);
            });

            // Reset state
            this.fs = null;

            console.log("[GitService] Cleared all caches");
        } catch (e) {
            console.error("[GitService] Failed to clear caches:", e);
            throw new GitServiceError(
                "Failed to clear caches",
                "DB_ERROR",
                e,
            );
        }
    }

    /**
     * Get cache statistics
     */
    static async getCacheStats(): Promise<{
        repoCount: number;
        repos: CachedRepoInfo[];
    }> {
        const repos = await this.getCachedRepos();
        return {
            repoCount: repos.length,
            repos,
        };
    }

    /**
     * Get storage quota information (if available)
     */
    static async getStorageQuota(): Promise<{
        usage: number;
        quota: number;
        usagePercent: number;
    } | null> {
        if ('storage' in navigator && 'estimate' in navigator.storage) {
            try {
                const estimate = await navigator.storage.estimate();
                const usage = estimate.usage || 0;
                const quota = estimate.quota || 0;
                const usagePercent = quota > 0 ? (usage / quota) * 100 : 0;
                
                return {
                    usage,
                    quota,
                    usagePercent,
                };
            } catch (e) {
                console.warn('[GitService] Failed to get storage estimate:', e);
                return null;
            }
        }
        return null;
    }

    /**
     * Get all commits, with a flag indicating if they modify .kicad_sch files
     */
    static async getAllCommits(repoSlug: string, onProgress?: CloneProgressCallback): Promise<CommitInfo[]> {
        const { fs, dir } = await this.ensureRepo(repoSlug, onProgress);

        this.log(`Getting commits for ${repoSlug}...`);
        const startTime = performance.now();

        const commits = await git.log({
            fs,
            dir,
            depth: this.config.maxCommitDepth,
        });

        const result: CommitInfo[] = [];

        for (let i = 0; i < commits.length; i++) {
            const commit = commits[i]!;
            const hasChanges = await this.hasSchematicChanges(
                fs,
                dir,
                commit,
                commits[i + 1], // parent commit (if exists)
            );

            result.push({
                commit_hash: commit.oid,
                commit_date: new Date(
                    commit.commit.author.timestamp * 1000,
                ).toISOString(),
                message: commit.commit.message.split("\n")[0] ?? null,
                has_schematic_changes: hasChanges,
            });
        }

        const elapsed = performance.now() - startTime;
        this.log(
            `Got ${result.length} commits for ${repoSlug} in ${elapsed.toFixed(0)}ms`,
        );

        return result;
    }

    /**
     * Check if a commit contains changes to .kicad_sch files
     */
    private static async hasSchematicChanges(
        fs: LightningFS,
        dir: string,
        commit: ReadCommitResult,
        parentCommit?: ReadCommitResult,
    ): Promise<boolean> {
        try {
            if (!parentCommit) {
                // Root commit - check if tree has any .kicad_sch files
                return await this.treeHasSchematicFiles(fs, dir, commit.commit.tree);
            }

            // Compare trees
            const changes = await this.getChangedFiles(
                fs,
                dir,
                parentCommit.commit.tree,
                commit.commit.tree,
            );

            return changes.some((path) => path.endsWith(".kicad_sch"));
        } catch (e) {
            this.warn(
                `Error checking schematic changes for ${commit.oid}:`,
                e,
            );
            return false;
        }
    }

    /**
     * Check if a tree contains any .kicad_sch files
     */
    private static async treeHasSchematicFiles(
        fs: LightningFS,
        dir: string,
        treeOid: string,
    ): Promise<boolean> {
        const tree = await git.readTree({ fs, dir, oid: treeOid });

        for (const entry of tree.tree) {
            if (entry.type === "blob" && entry.path.endsWith(".kicad_sch")) {
                return true;
            }
            if (entry.type === "tree") {
                const hasFiles = await this.treeHasSchematicFiles(
                    fs,
                    dir,
                    entry.oid,
                );
                if (hasFiles) return true;
            }
        }

        return false;
    }

    /**
     * Get changed file paths between two tree OIDs
     */
    private static async getChangedFiles(
        fs: LightningFS,
        dir: string,
        oldTreeOid: string,
        newTreeOid: string,
        prefix = "",
    ): Promise<string[]> {
        const changes: string[] = [];

        const oldTree = await git.readTree({ fs, dir, oid: oldTreeOid });
        const newTree = await git.readTree({ fs, dir, oid: newTreeOid });

        const oldEntries = new Map(oldTree.tree.map((e) => [e.path, e]));
        const newEntries = new Map(newTree.tree.map((e) => [e.path, e]));

        // Check for modified or deleted files
        for (const [path, oldEntry] of oldEntries) {
            const newEntry = newEntries.get(path);
            const fullPath = prefix ? `${prefix}/${path}` : path;

            if (!newEntry) {
                // Deleted
                if (oldEntry.type === "blob") {
                    changes.push(fullPath);
                } else if (oldEntry.type === "tree") {
                    const subChanges = await this.getAllFilesInTree(
                        fs,
                        dir,
                        oldEntry.oid,
                        fullPath,
                    );
                    changes.push(...subChanges);
                }
            } else if (oldEntry.oid !== newEntry.oid) {
                // Modified
                if (oldEntry.type === "blob" && newEntry.type === "blob") {
                    changes.push(fullPath);
                } else if (oldEntry.type === "tree" && newEntry.type === "tree") {
                    const subChanges = await this.getChangedFiles(
                        fs,
                        dir,
                        oldEntry.oid,
                        newEntry.oid,
                        fullPath,
                    );
                    changes.push(...subChanges);
                } else {
                    // Type changed (rare)
                    changes.push(fullPath);
                }
            }
        }

        // Check for added files
        for (const [path, newEntry] of newEntries) {
            if (!oldEntries.has(path)) {
                const fullPath = prefix ? `${prefix}/${path}` : path;
                if (newEntry.type === "blob") {
                    changes.push(fullPath);
                } else if (newEntry.type === "tree") {
                    const subChanges = await this.getAllFilesInTree(
                        fs,
                        dir,
                        newEntry.oid,
                        fullPath,
                    );
                    changes.push(...subChanges);
                }
            }
        }

        return changes;
    }

    /**
     * Get all file paths in a tree (recursive)
     */
    private static async getAllFilesInTree(
        fs: LightningFS,
        dir: string,
        treeOid: string,
        prefix: string,
    ): Promise<string[]> {
        const files: string[] = [];
        const tree = await git.readTree({ fs, dir, oid: treeOid });

        for (const entry of tree.tree) {
            const fullPath = `${prefix}/${entry.path}`;
            if (entry.type === "blob") {
                files.push(fullPath);
            } else if (entry.type === "tree") {
                const subFiles = await this.getAllFilesInTree(
                    fs,
                    dir,
                    entry.oid,
                    fullPath,
                );
                files.push(...subFiles);
            }
        }

        return files;
    }

    /**
     * Get all .kicad_sch and .kicad_pro files at a specific commit
     */
    static async getSchematicFiles(
        repoSlug: string,
        commitHash: string,
    ): Promise<SchematicFile[]> {
        const { fs, dir } = await this.ensureRepo(repoSlug);

        this.log(
            `Getting schematic files for ${repoSlug}@${commitHash.slice(0, 7)}...`,
        );

        // Resolve the commit
        const commit = await git.readCommit({ fs, dir, oid: commitHash });
        const files: SchematicFile[] = [];

        await this.collectKiCadFiles(fs, dir, commit.commit.tree, "", files);

        this.log(`Found ${files.length} KiCad files`);
        return files;
    }

    /**
     * Recursively collect KiCad files from a tree
     */
    private static async collectKiCadFiles(
        fs: LightningFS,
        dir: string,
        treeOid: string,
        prefix: string,
        files: SchematicFile[],
    ): Promise<void> {
        const tree = await git.readTree({ fs, dir, oid: treeOid });

        for (const entry of tree.tree) {
            const fullPath = prefix ? `${prefix}/${entry.path}` : entry.path;

            if (entry.type === "blob") {
                if (
                    entry.path.endsWith(".kicad_sch") ||
                    entry.path.endsWith(".kicad_pro")
                ) {
                    const blob = await git.readBlob({ fs, dir, oid: entry.oid });
                    const content = new TextDecoder().decode(blob.blob);
                    files.push({ path: fullPath, content });
                }
            } else if (entry.type === "tree") {
                await this.collectKiCadFiles(fs, dir, entry.oid, fullPath, files);
            }
        }
    }

    /**
     * Get changed .kicad_sch file paths for a specific commit
     */
    static async getChangedSchematicFiles(
        repoSlug: string,
        commitHash: string,
    ): Promise<string[]> {
        const { fs, dir } = await this.ensureRepo(repoSlug);

        const commits = await git.log({
            fs,
            dir,
            depth: this.config.maxCommitDepth,
        });
        const commitIndex = commits.findIndex((c) => c.oid === commitHash);

        if (commitIndex === -1) {
            throw new Error(`Commit ${commitHash} not found`);
        }

        const commit = commits[commitIndex]!;
        const parentCommit = commits[commitIndex + 1];

        if (!parentCommit) {
            // Root commit - all schematic files are "new"
            const files = await this.getSchematicFiles(repoSlug, commitHash);
            return files
                .filter((f) => f.path.endsWith(".kicad_sch"))
                .map((f) => f.path);
        }

        const changes = await this.getChangedFiles(
            fs,
            dir,
            parentCommit.commit.tree,
            commit.commit.tree,
        );

        return changes.filter((path) => path.endsWith(".kicad_sch"));
    }

    /**
     * Get commit info (date, message) for a specific commit
     */
    static async getCommitInfo(
        repoSlug: string,
        commitHash: string,
    ): Promise<CommitInfo> {
        const { fs, dir } = await this.ensureRepo(repoSlug);

        const commit = await git.readCommit({ fs, dir, oid: commitHash });

        // Find parent to check for schematic changes
        const commits = await git.log({
            fs,
            dir,
            depth: this.config.maxCommitDepth,
        });
        const commitIndex = commits.findIndex((c) => c.oid === commitHash);
        const parentCommit =
            commitIndex !== -1 ? commits[commitIndex + 1] : undefined;

        const hasChanges = await this.hasSchematicChanges(
            fs,
            dir,
            { oid: commitHash, commit: commit.commit, payload: "" },
            parentCommit,
        );

        return {
            commit_hash: commitHash,
            commit_date: new Date(
                commit.commit.author.timestamp * 1000,
            ).toISOString(),
            message: commit.commit.message.split("\n")[0] ?? null,
            has_schematic_changes: hasChanges,
        };
    }

    /**
     * Get the latest commit hash on the default branch
     */
    static async getLatestCommit(repoSlug: string): Promise<string> {
        const { fs, dir } = await this.ensureRepo(repoSlug);
        const ref = await git.resolveRef({ fs, dir, ref: "HEAD" });
        return ref;
    }

    /**
     * Set a custom CORS proxy URL
     */
    static setCorsProxy(url: string): void {
        this.config.corsProxy = url;
    }
}

/*
    Frontend Git Service using isomorphic-git.
    Replaces the backend git2-based implementation for commit history
    and file retrieval at specific commits.
*/

// Buffer polyfill for browser environment (required by isomorphic-git)
import { Buffer } from "buffer";
if (typeof globalThis.Buffer === "undefined") {
    globalThis.Buffer = Buffer;
}

import git, { type ReadCommitResult } from "isomorphic-git";
import http from "isomorphic-git/http/web";

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

// ============================================================================
// In-Memory File System for isomorphic-git
// ============================================================================

/**
 * Minimal in-memory filesystem that implements the FS interface for isomorphic-git.
 * This avoids the need for IndexedDB or other persistent storage.
 */
class InMemoryFS {
    private files: Map<string, Uint8Array> = new Map();
    private dirs: Set<string> = new Set();

    constructor() {
        this.dirs.add("/");
    }

    private normalizePath(path: string): string {
        if (!path.startsWith("/")) {
            path = "/" + path;
        }
        // Remove trailing slash except for root
        if (path.length > 1 && path.endsWith("/")) {
            path = path.slice(0, -1);
        }
        return path;
    }

    private getParentDir(path: string): string {
        const normalized = this.normalizePath(path);
        const lastSlash = normalized.lastIndexOf("/");
        return lastSlash <= 0 ? "/" : normalized.slice(0, lastSlash);
    }

    async readFile(
        path: string,
        options?: { encoding?: string },
    ): Promise<Uint8Array | string> {
        const normalized = this.normalizePath(path);
        const content = this.files.get(normalized);
        if (content === undefined) {
            const error = new Error(`ENOENT: no such file: ${path}`);
            (error as NodeJS.ErrnoException).code = "ENOENT";
            throw error;
        }
        if (options?.encoding === "utf8") {
            return new TextDecoder().decode(content);
        }
        return content;
    }

    async writeFile(
        path: string,
        data: Uint8Array | string,
        _options?: { encoding?: string; mode?: number },
    ): Promise<void> {
        const normalized = this.normalizePath(path);
        const content =
            typeof data === "string" ? new TextEncoder().encode(data) : data;
        this.files.set(normalized, content);
        // Ensure parent directories exist
        let parent = this.getParentDir(normalized);
        while (parent !== "/" && !this.dirs.has(parent)) {
            this.dirs.add(parent);
            parent = this.getParentDir(parent);
        }
    }

    async unlink(path: string): Promise<void> {
        const normalized = this.normalizePath(path);
        this.files.delete(normalized);
    }

    async readdir(path: string): Promise<string[]> {
        const normalized = this.normalizePath(path);
        const entries = new Set<string>();

        // Add files in this directory
        for (const filePath of this.files.keys()) {
            if (filePath.startsWith(normalized + "/") || normalized === "/") {
                const relativePath =
                    normalized === "/"
                        ? filePath.slice(1)
                        : filePath.slice(normalized.length + 1);
                const firstSegment = relativePath.split("/")[0];
                if (firstSegment) {
                    entries.add(firstSegment);
                }
            }
        }

        // Add subdirectories
        for (const dirPath of this.dirs) {
            if (dirPath.startsWith(normalized + "/") || normalized === "/") {
                const relativePath =
                    normalized === "/"
                        ? dirPath.slice(1)
                        : dirPath.slice(normalized.length + 1);
                const firstSegment = relativePath.split("/")[0];
                if (firstSegment) {
                    entries.add(firstSegment);
                }
            }
        }

        return Array.from(entries);
    }

    async mkdir(path: string, _options?: { recursive?: boolean }): Promise<void> {
        const normalized = this.normalizePath(path);
        this.dirs.add(normalized);
        // Create parent directories
        let parent = this.getParentDir(normalized);
        while (parent !== "/" && !this.dirs.has(parent)) {
            this.dirs.add(parent);
            parent = this.getParentDir(parent);
        }
    }

    async rmdir(path: string): Promise<void> {
        const normalized = this.normalizePath(path);
        this.dirs.delete(normalized);
    }

    async stat(
        path: string,
    ): Promise<{ type: string; mode: number; size: number; isFile: () => boolean; isDirectory: () => boolean; isSymbolicLink: () => boolean }> {
        const normalized = this.normalizePath(path);
        if (this.files.has(normalized)) {
            const content = this.files.get(normalized)!;
            return {
                type: "file",
                mode: 0o100644,
                size: content.length,
                isFile: () => true,
                isDirectory: () => false,
                isSymbolicLink: () => false,
            };
        }
        if (this.dirs.has(normalized)) {
            return {
                type: "dir",
                mode: 0o40755,
                size: 0,
                isFile: () => false,
                isDirectory: () => true,
                isSymbolicLink: () => false,
            };
        }
        const error = new Error(`ENOENT: no such file or directory: ${path}`);
        (error as NodeJS.ErrnoException).code = "ENOENT";
        throw error;
    }

    async lstat(
        path: string,
    ): Promise<{ type: string; mode: number; size: number; isFile: () => boolean; isDirectory: () => boolean; isSymbolicLink: () => boolean }> {
        return this.stat(path);
    }

    async readlink(_path: string): Promise<string> {
        throw new Error("Symlinks not supported");
    }

    async symlink(_target: string, _path: string): Promise<void> {
        throw new Error("Symlinks not supported");
    }

    async chmod(_path: string, _mode: number): Promise<void> {
        // No-op for in-memory fs
    }

    // Clear all data
    clear(): void {
        this.files.clear();
        this.dirs.clear();
        this.dirs.add("/");
    }
}

// ============================================================================
// Git Service
// ============================================================================

/**
 * Frontend git service using isomorphic-git.
 * Caches cloned repositories in memory for the session.
 */
export class GitService {
    private static repoCache: Map<string, InMemoryFS> = new Map();
    private static cloneInProgress: Map<string, Promise<void>> = new Map();

    // CORS proxy for GitHub - isomorphic-git provides one, or use your own
    private static corsProxy = "https://cors.isomorphic-git.org";

    /**
     * Get the directory path for a repository
     */
    private static getRepoDir(repoSlug: string): string {
        return `/${repoSlug.replace("/", "-")}`;
    }

    /**
     * Get or create an in-memory filesystem for a repository
     */
    private static getFS(repoSlug: string): InMemoryFS {
        let fs = this.repoCache.get(repoSlug);
        if (!fs) {
            fs = new InMemoryFS();
            this.repoCache.set(repoSlug, fs);
        }
        return fs;
    }

    /**
     * Clone a repository if not already cached
     */
    static async ensureRepo(repoSlug: string): Promise<{ fs: InMemoryFS; dir: string }> {
        const fs = this.getFS(repoSlug);
        const dir = this.getRepoDir(repoSlug);

        // Check if already cloned
        try {
            await git.resolveRef({ fs, dir, ref: "HEAD" });
            return { fs, dir };
        } catch {
            // Not cloned yet, need to clone
        }

        // Check if clone is already in progress
        const inProgress = this.cloneInProgress.get(repoSlug);
        if (inProgress) {
            await inProgress;
            return { fs, dir };
        }

        // Start clone
        const clonePromise = this.cloneRepo(fs, dir, repoSlug);
        this.cloneInProgress.set(repoSlug, clonePromise);

        try {
            await clonePromise;
        } finally {
            this.cloneInProgress.delete(repoSlug);
        }

        return { fs, dir };
    }

    /**
     * Clone a repository
     */
    private static async cloneRepo(
        fs: InMemoryFS,
        dir: string,
        repoSlug: string,
    ): Promise<void> {
        const url = `https://github.com/${repoSlug}`;

        console.log(`[GitService] Cloning ${repoSlug}...`);
        const startTime = performance.now();

        await git.clone({
            fs,
            http,
            dir,
            url,
            corsProxy: this.corsProxy,
            singleBranch: true,
            depth: 100, // Limit depth for performance - adjust as needed
            noTags: true,
        });

        const elapsed = performance.now() - startTime;
        console.log(`[GitService] Cloned ${repoSlug} in ${elapsed.toFixed(0)}ms`);
    }

    /**
     * Invalidate (clear) the cache for a repository
     */
    static invalidateCache(repoSlug: string): void {
        const fs = this.repoCache.get(repoSlug);
        if (fs) {
            fs.clear();
            this.repoCache.delete(repoSlug);
        }
        console.log(`[GitService] Invalidated cache for ${repoSlug}`);
    }

    /**
     * Get all commits, with a flag indicating if they modify .kicad_sch files
     */
    static async getAllCommits(repoSlug: string): Promise<CommitInfo[]> {
        const { fs, dir } = await this.ensureRepo(repoSlug);

        console.log(`[GitService] Getting commits for ${repoSlug}...`);
        const startTime = performance.now();

        const commits = await git.log({
            fs,
            dir,
            depth: 500, // Limit for performance
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
        console.log(
            `[GitService] Got ${result.length} commits for ${repoSlug} in ${elapsed.toFixed(0)}ms`,
        );

        return result;
    }

    /**
     * Check if a commit contains changes to .kicad_sch files
     */
    private static async hasSchematicChanges(
        fs: InMemoryFS,
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
            console.warn(
                `[GitService] Error checking schematic changes for ${commit.oid}:`,
                e,
            );
            return false;
        }
    }

    /**
     * Check if a tree contains any .kicad_sch files
     */
    private static async treeHasSchematicFiles(
        fs: InMemoryFS,
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
        fs: InMemoryFS,
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
        fs: InMemoryFS,
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

        console.log(
            `[GitService] Getting schematic files for ${repoSlug}@${commitHash.slice(0, 7)}...`,
        );

        // Resolve the commit
        const commit = await git.readCommit({ fs, dir, oid: commitHash });
        const files: SchematicFile[] = [];

        await this.collectKiCadFiles(fs, dir, commit.commit.tree, "", files);

        console.log(`[GitService] Found ${files.length} KiCad files`);
        return files;
    }

    /**
     * Recursively collect KiCad files from a tree
     */
    private static async collectKiCadFiles(
        fs: InMemoryFS,
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

        const commits = await git.log({ fs, dir, depth: 500 });
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
        const commits = await git.log({ fs, dir, depth: 500 });
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
        this.corsProxy = url;
    }

    /**
     * Clear all cached repositories
     */
    static clearAllCaches(): void {
        for (const fs of this.repoCache.values()) {
            fs.clear();
        }
        this.repoCache.clear();
        console.log("[GitService] Cleared all caches");
    }
}


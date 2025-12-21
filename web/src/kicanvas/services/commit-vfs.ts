/*
    Virtual file system that loads schematic files from a specific git commit
    using isomorphic-git in the browser (no backend required).
*/

import { initiate_download } from "../../base/dom/download";
import { basename } from "../../base/paths";
import { GitService, type SchematicFile } from "./git-service";
import { VirtualFileSystem } from "./vfs";

/**
 * Virtual file system for loading schematics from a specific git commit.
 * Uses isomorphic-git directly in the browser - no backend required.
 */
export class CommitFileSystem extends VirtualFileSystem {
    private files: Map<string, SchematicFile> = new Map();
    private loaded: boolean = false;

    constructor(
        private repo: string,
        private commit: string,
    ) {
        super();
    }

    /**
     * Create a CommitFileSystem and load all files from git
     */
    static async fromCommit(
        repo: string,
        commit: string,
    ): Promise<CommitFileSystem> {
        const vfs = new CommitFileSystem(repo, commit);
        await vfs.loadFiles();
        return vfs;
    }

    /**
     * Load all schematic files from the git repository for this commit
     */
    private async loadFiles(): Promise<void> {
        if (this.loaded) {
            return;
        }

        const files = await GitService.getSchematicFiles(
            this.repo,
            this.commit,
        );

        for (const file of files) {
            const name = basename(file.path) ?? file.path;
            this.files.set(name, file);
        }

        this.loaded = true;
    }

    public override *list(): Generator<string> {
        for (const key of this.files.keys()) {
            yield key;
        }
    }

    public override async has(name: string): Promise<boolean> {
        return this.files.has(name);
    }

    public override async get(name: string): Promise<File> {
        const schematicFile = this.files.get(name);

        if (!schematicFile) {
            throw new Error(`File ${name} not found in commit ${this.commit}`);
        }

        // Convert the string content to a File object
        const blob = new Blob([schematicFile.content], {
            type: "application/octet-stream",
        });
        return new File([blob], name);
    }

    public override async download(name: string): Promise<void> {
        initiate_download(await this.get(name));
    }

    /**
     * Get the repository identifier
     */
    public getRepo(): string {
        return this.repo;
    }

    /**
     * Get the commit hash
     */
    public getCommit(): string {
        return this.commit;
    }
}

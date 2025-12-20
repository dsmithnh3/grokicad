/*
    Browser-based Schematic Distillation Service
    
    Handles distillation of KiCAD schematics directly in the browser,
    eliminating the need for backend Python processing.
*/

import { KicadSch } from "../../kicad/schematic";
import {
    distillSchematic,
    distillHierarchicalSchematics,
    type DistilledSchematic,
    type DistillationConfig,
} from "../../kicad/distill";
import { GitService } from "./git-service";

export interface DistillResult {
    repo: string;
    commit: string;
    distilled: DistilledSchematic;
    schematic_files: string[];
    component_count: number;
    net_count: number;
}

/**
 * Service for distilling KiCAD schematics in the browser.
 * Fetches schematic files from GitHub and processes them locally.
 */
export class SchematicDistillService {
    private cache = new Map<string, DistillResult>();

    /**
     * Generate a cache key for a repo/commit combination
     */
    private cacheKey(repo: string, commit: string): string {
        return `${repo}@${commit}`;
    }

    /**
     * Distill all schematic files from a repository at a specific commit.
     * Results are cached locally.
     *
     * @param repo - Repository in "owner/repo" format
     * @param commit - Commit hash
     * @param config - Optional distillation configuration
     * @returns Distillation result with all schematic data
     */
    async distillRepository(
        repo: string,
        commit: string,
        config?: Partial<DistillationConfig>,
    ): Promise<DistillResult> {
        const key = this.cacheKey(repo, commit);

        // Return cached result if available
        if (this.cache.has(key)) {
            console.log(`[DistillService] Cache hit for ${key}`);
            return this.cache.get(key)!;
        }

        console.log(`[DistillService] Distilling ${repo}@${commit.slice(0, 8)}`);

        // Fetch schematic files using git service
        const allFiles = await GitService.getSchematicFiles(repo, commit);
        
        // Filter to only .kicad_sch files (exclude .kicad_pro which are JSON)
        const schematicFiles = allFiles.filter(f => f.path.endsWith('.kicad_sch'));

        if (schematicFiles.length === 0) {
            throw new Error(
                `No .kicad_sch files found in ${repo} at commit ${commit.slice(0, 8)}`,
            );
        }

        console.log(
            `[DistillService] Found ${schematicFiles.length} schematic file(s)`,
        );

        // Parse all schematics
        const schematics: Array<[KicadSch, string]> = [];

        for (const file of schematicFiles) {
            try {
                // Pass raw content string - KicadSch/parse_expr handles listification
                const schematic = new KicadSch(file.path, file.content);
                const sheetPath = "/" + file.path.replace(/\.kicad_sch$/, "");
                schematics.push([schematic, sheetPath]);
            } catch (err) {
                console.warn(
                    `[DistillService] Failed to parse ${file.path}:`,
                    err,
                );
            }
        }

        if (schematics.length === 0) {
            throw new Error(`Failed to parse any schematic files from ${repo}`);
        }

        // Distill based on number of schematics
        let distilled: DistilledSchematic;

        if (schematics.length === 1) {
            // Single schematic - use simpler distillation
            distilled = distillSchematic(schematics[0]![0], config);
        } else {
            // Multiple schematics - use hierarchical distillation
            distilled = distillHierarchicalSchematics(schematics, config);
        }

        const result: DistillResult = {
            repo,
            commit,
            distilled,
            schematic_files: schematicFiles.map((f) => f.path),
            component_count: distilled.components.length,
            net_count: Object.keys(distilled.nets).length,
        };

        // Cache the result
        this.cache.set(key, result);

        console.log(
            `[DistillService] Complete: ${result.component_count} components, ${result.net_count} nets`,
        );

        return result;
    }

    /**
     * Distill a single schematic from its content.
     * Useful for schematics that are already loaded.
     *
     * @param content - Raw schematic file content
     * @param filename - Filename for the schematic
     * @param config - Optional distillation configuration
     * @returns Distilled schematic
     */
    distillFromContent(
        content: string,
        filename: string,
        config?: Partial<DistillationConfig>,
    ): DistilledSchematic {
        // Pass raw content string - KicadSch/parse_expr handles listification
        const schematic = new KicadSch(filename, content);
        return distillSchematic(schematic, config);
    }

    /**
     * Distill from an already-parsed KicadSch object.
     *
     * @param schematic - Parsed KiCAD schematic
     * @param config - Optional distillation configuration
     * @returns Distilled schematic
     */
    distillFromSchematic(
        schematic: KicadSch,
        config?: Partial<DistillationConfig>,
    ): DistilledSchematic {
        return distillSchematic(schematic, config);
    }

    /**
     * Check if a repository/commit is cached
     */
    isCached(repo: string, commit: string): boolean {
        return this.cache.has(this.cacheKey(repo, commit));
    }

    /**
     * Get cached result if available
     */
    getCached(repo: string, commit: string): DistillResult | null {
        return this.cache.get(this.cacheKey(repo, commit)) ?? null;
    }

    /**
     * Clear cache for a specific repo/commit
     */
    clearCache(repo: string, commit?: string): void {
        if (commit) {
            this.cache.delete(this.cacheKey(repo, commit));
        } else {
            // Clear all entries for this repo
            for (const key of this.cache.keys()) {
                if (key.startsWith(`${repo}@`)) {
                    this.cache.delete(key);
                }
            }
        }
    }

    /**
     * Clear the entire cache
     */
    clearAllCache(): void {
        this.cache.clear();
    }
}

/** Singleton instance for convenience */
export const distillService = new SchematicDistillService();


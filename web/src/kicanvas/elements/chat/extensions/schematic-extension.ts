/*
    Schematic Extension - AI chat extension for schematic analysis.
    
    This extension provides context and presets for analyzing KiCad schematics.
    It integrates with the distill service to provide rich schematic context.
*/

import type { Message } from "../../../services/xai-client";
import {
    distillService,
    type DistillResult,
} from "../../../services/distill-service";
import { createFocusedDistillation } from "../../../../kicad/distill";
import type { DistilledSchematic } from "../../../services/api";
import { SYSTEM_PROMPT } from "../../../services/system-prompt";
import type {
    ChatExtension,
    ChatContext,
    ChatMessage,
    BuiltContext,
    PresetGroup,
    ContextItem,
} from "../types";

// =============================================================================
// Types
// =============================================================================

export interface SchematicContext extends ChatContext {
    repo: string | null;
    commit: string | null;
    selectedItems?: SchematicContextItem[];
}

export interface SchematicContextItem extends ContextItem {
    uuid: string;
    reference: string;
    value: string;
    componentType: string;
}

// =============================================================================
// Presets
// =============================================================================

const PROJECT_PRESETS: PresetGroup = {
    id: "project",
    label: "Project",
    presets: [
        {
            id: "project-overview",
            title: "Overview",
            icon: "search",
            description:
                "Get a high-level overview of the entire schematic project",
            query: "Give an overview of the whole schematic project. Describe the main functional blocks, key ICs and their purposes, power architecture, and how the subsystems work together.",
            requiresContext: false,
        },
        {
            id: "power-analysis",
            title: "Power",
            icon: "bolt",
            description: "Analyze the power distribution and regulation",
            query: "Analyze the power architecture of this schematic. Identify all voltage rails, regulators, and power sources. Describe the power distribution topology and any power sequencing considerations.",
            requiresContext: false,
        },
    ],
};

const COMPONENT_PRESETS: PresetGroup = {
    id: "component",
    label: "Components",
    presets: [
        {
            id: "explain",
            title: "Explain",
            icon: "lightbulb",
            description: "Explain what the selected components do",
            query: "What are these components doing? Explain their function in simple terms, how they work together, and their role in the circuit.",
            requiresContext: true,
        },
        {
            id: "connections",
            title: "Connections",
            icon: "link",
            description: "Analyze pin connections and nets",
            query: "Analyze the pin connections of the selected components. What nets are they connected to? What other components do they interface with?",
            requiresContext: true,
        },
        {
            id: "testing",
            title: "Testing",
            icon: "science",
            description: "How to test and debug",
            query: "How would I test these components to verify they are working correctly? Include typical voltage/current measurements, test points, and common failure modes to check for.",
            requiresContext: true,
        },
        {
            id: "alternatives",
            title: "Alternatives",
            icon: "refresh",
            description: "Find alternative parts",
            query: "What are suitable alternatives for these components? Consider pin-compatible replacements, functional equivalents from other manufacturers, and any trade-offs.",
            requiresContext: true,
        },
    ],
};

// =============================================================================
// Extension Implementation
// =============================================================================

/**
 * Schematic Analysis Extension for the chat system.
 * Provides context and presets for analyzing KiCad schematics.
 */
export class SchematicExtension implements ChatExtension {
    readonly id = "schematic-analysis";
    readonly name = "Schematic Analysis";
    readonly supportsThinking = true;

    private _distillResult: DistillResult | null = null;
    private _currentRepo: string | null = null;
    private _currentCommit: string | null = null;

    /**
     * Get presets based on current context.
     * Always returns both project and component presets.
     * Component presets will be disabled if no components are selected.
     */
    getPresets(context: ChatContext): PresetGroup[] {
        // Always show both groups - component presets will appear disabled
        // when no components are selected (via requiresContext: true)
        return [PROJECT_PRESETS, COMPONENT_PRESETS];
    }

    /**
     * Build context for the AI query.
     */
    async buildContext(
        context: ChatContext,
        userQuery: string,
        conversationHistory?: ChatMessage[],
    ): Promise<BuiltContext> {
        const { repo, commit, selectedItems } = context as SchematicContext;

        if (!repo || !commit) {
            return {
                systemPrompt: SYSTEM_PROMPT,
                userPrompt: userQuery,
            };
        }

        // Get or fetch distilled schematic
        const distilled = await this._getDistilledSchematic(repo, commit);

        if (!distilled) {
            return {
                systemPrompt: SYSTEM_PROMPT,
                userPrompt: userQuery,
            };
        }

        // Get component references from selected items
        const componentIds =
            selectedItems
                ?.map((item) => (item as SchematicContextItem).reference)
                .filter(Boolean) ?? [];

        // Create focused distillation if components are selected
        const focusedDistilled =
            componentIds.length > 0
                ? createFocusedDistillation(distilled, componentIds)
                : distilled;

        // Build semantic context
        const { selectedContext, schematicSummary } =
            this._buildComponentContext(focusedDistilled, componentIds);

        // Construct prompts
        const systemPrompt = `${SYSTEM_PROMPT}\n\n---\n\n## Schematic Context\n${schematicSummary}`;
        const userPrompt = `${selectedContext}\n\n---\n\n## User's Question\n${userQuery}`;

        // Add conversation history as additional messages
        const additionalMessages: Message[] = [];
        if (conversationHistory && conversationHistory.length > 0) {
            for (const msg of conversationHistory) {
                if (msg.role === "user") {
                    additionalMessages.push({
                        role: "user",
                        content: msg.content,
                    });
                } else if (msg.role === "assistant" && !msg.error) {
                    additionalMessages.push({
                        role: "assistant",
                        content: msg.content,
                    });
                }
            }
        }

        return {
            systemPrompt,
            userPrompt,
            additionalMessages:
                additionalMessages.length > 0 ? additionalMessages : undefined,
        };
    }

    /**
     * Get placeholder text based on context.
     */
    getPlaceholder(context: ChatContext): string {
        if (context.selectedItems && context.selectedItems.length > 0) {
            const count = context.selectedItems.length;
            return `Ask about ${count} selected component${
                count > 1 ? "s" : ""
            }...`;
        }
        return "Ask about the schematic...";
    }

    /**
     * Initialize the extension with context.
     */
    async initialize(context: ChatContext): Promise<void> {
        const { repo, commit } = context as SchematicContext;
        if (repo && commit) {
            await this._getDistilledSchematic(repo, commit);
        }
    }

    /**
     * Cleanup cached data.
     */
    dispose(): void {
        this._distillResult = null;
        this._currentRepo = null;
        this._currentCommit = null;
    }

    /**
     * Clear cache for a specific repo.
     */
    clearCache(repo?: string): void {
        if (repo) {
            distillService.clearCache(repo);
        }
        this._distillResult = null;
        this._currentRepo = null;
        this._currentCommit = null;
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private async _getDistilledSchematic(
        repo: string,
        commit: string,
    ): Promise<DistilledSchematic | null> {
        // Return cached if same repo/commit
        if (
            this._distillResult &&
            this._currentRepo === repo &&
            this._currentCommit === commit
        ) {
            return this._distillResult.distilled;
        }

        try {
            const result = await distillService.distillRepository(repo, commit);
            this._distillResult = result;
            this._currentRepo = repo;
            this._currentCommit = commit;
            return result.distilled;
        } catch (err) {
            console.error(
                "[SchematicExtension] Failed to get distilled schematic:",
                err,
            );
            return null;
        }
    }

    private _buildComponentContext(
        distilled: DistilledSchematic,
        componentIds: string[],
    ): { selectedContext: string; schematicSummary: string } {
        // Filter to selected components
        const components = distilled.components.filter((c) =>
            componentIds.includes(c.reference),
        );

        // Build detailed component descriptions
        const componentDetails: string[] = [];
        for (const comp of components) {
            const category = comp.category || "other";
            let detail = `**${comp.reference}** (${category})\n  - Type: ${comp.lib_id}\n  - Value: ${comp.value}`;

            if (comp.footprint) {
                detail += `\n  - Footprint: ${comp.footprint}`;
            }

            if (comp.sheet_path && comp.sheet_path !== "/") {
                detail += `\n  - Sheet: ${comp.sheet_path}`;
            }

            // Add pin connections
            if (comp.pins && comp.pins.length > 0) {
                const pinStrs = comp.pins.map((pin) => {
                    const name = pin.name || "";
                    const net = pin.net || "NC";
                    if (!name) {
                        return `Pin ${pin.number} → ${net}`;
                    }
                    return `Pin ${pin.number} (${name}) → ${net}`;
                });
                if (pinStrs.length > 0) {
                    detail += `\n  - Pins:\n    ${pinStrs.join("\n    ")}`;
                }
            }

            // Add properties if any
            if (comp.properties) {
                const propStrs = Object.entries(comp.properties)
                    .filter(([k]) => !k.startsWith("ki_"))
                    .map(([k, v]) => `${k}: ${v}`);
                if (propStrs.length > 0) {
                    detail += `\n  - Properties: ${propStrs.join(", ")}`;
                }
            }

            componentDetails.push(detail);
        }

        // Find nearby components from proximities
        const nearbyRefs = new Set<string>();
        if (distilled.proximities) {
            for (const prox of distilled.proximities) {
                if ((prox.score || 0) > 0.3) {
                    if (
                        componentIds.includes(prox.ref_a) &&
                        !componentIds.includes(prox.ref_b)
                    ) {
                        nearbyRefs.add(prox.ref_b);
                    }
                    if (
                        componentIds.includes(prox.ref_b) &&
                        !componentIds.includes(prox.ref_a)
                    ) {
                        nearbyRefs.add(prox.ref_a);
                    }
                }
            }
        }

        // Get details for nearby components (limit to 10)
        const nearbyDetails: string[] = [];
        const nearbyRefsArray = Array.from(nearbyRefs).slice(0, 10);
        for (const ref of nearbyRefsArray) {
            const comp = distilled.components.find((c) => c.reference === ref);
            if (comp) {
                nearbyDetails.push(
                    `${comp.reference} (${comp.value}, ${
                        comp.category || "other"
                    })`,
                );
            }
        }

        // Build schematic overview
        const schematicSummary = `The schematic contains ${
            distilled.components.length
        } total components and ${Object.keys(distilled.nets).length} nets.`;

        // Build selected context
        let selectedContext: string;
        if (componentDetails.length === 0) {
            selectedContext = "No specific components selected.";
        } else {
            selectedContext = `## Selected Components (${
                componentDetails.length
            })\n\n${componentDetails.join("\n\n")}`;

            if (nearbyDetails.length > 0) {
                selectedContext += `\n\n## Nearby/Related Components\n${nearbyDetails.join(
                    ", ",
                )}`;
            }
        }

        return { selectedContext, schematicSummary };
    }
}

/**
 * Create a schematic context item from component data.
 */
export function createSchematicContextItem(
    uuid: string,
    reference: string,
    value: string,
    componentType: string,
): SchematicContextItem {
    return {
        id: uuid,
        uuid,
        reference,
        value,
        type: componentType,
        componentType,
        label: reference,
    };
}

// Export singleton instance
export const schematicExtension = new SchematicExtension();

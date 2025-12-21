/*
    Part Replacement Extension - AI chat extension for finding part replacements.
    
    This extension provides context and presets for finding replacements for
    obsolete or unavailable electronic components. Integrates with DigiKey
    data when available.
*/

import type { Message } from "../../../services/xai-client";
import type { DigiKeyPartInfo } from "../../../services/digikey-client";
import type {
    ChatExtension,
    ChatContext,
    ChatMessage,
    BuiltContext,
    PresetGroup,
    ContextItem,
    TransformedResponse,
    ResponseAction,
} from "../types";

// =============================================================================
// Types
// =============================================================================

export interface PartReplacementContext extends ChatContext {
    /** The part that needs replacement */
    part?: PartInfo;
    /** Additional DigiKey data if available */
    digiKeyData?: DigiKeyPartInfo;
    /** Category/type of component */
    category?: string;
    /** Reason for needing replacement (obsolete, out of stock, etc.) */
    reason?:
        | "obsolete"
        | "out_of_stock"
        | "nrnd"
        | "cost"
        | "availability"
        | "upgrade";
}

export interface PartInfo {
    /** Manufacturer part number */
    mpn: string;
    /** Manufacturer name */
    manufacturer?: string;
    /** Part description */
    description?: string;
    /** Key parameters (package, value, specs, etc.) */
    parameters?: Record<string, string>;
    /** DigiKey part number if known */
    digiKeyPartNumber?: string;
    /** Datasheet URL if known */
    datasheetUrl?: string;
    /** Component reference in schematic (e.g., U1, R3) */
    schematicReference?: string;
}

// =============================================================================
// System Prompt for Part Replacement
// =============================================================================

const REPLACEMENT_SYSTEM_PROMPT = `You are an expert electronics component engineer helping users find replacement parts.

## Your Role

Help users find suitable replacements for electronic components that are obsolete, out of stock, or otherwise unavailable. Consider:

1. **Pin Compatibility**: Prioritize drop-in replacements with identical pinouts
2. **Electrical Specs**: Match or exceed critical specifications (voltage, current, timing, etc.)
3. **Package Compatibility**: Same footprint is ideal; note any package differences
4. **Availability**: Focus on parts that are actively produced and well-stocked
5. **Cost**: Consider price-performance trade-offs

## Response Format

Structure your response as follows:

### Drop-in Replacements
Parts that are pin-compatible and require no schematic changes.

### Near Equivalents  
Parts that are functionally similar but may need minor changes.

### Upgrade Options
Better/newer parts that provide improved performance.

## Guidelines

- Always provide manufacturer part numbers (MPNs)
- Mention key specs that users should verify
- Note any differences that might affect the design
- If no good replacements exist, explain why and suggest alternatives
- For ICs, consider second-source manufacturers
- For passives, focus on value, tolerance, package, and voltage rating

## Style

- Be concise but thorough
- Use bullet points for easy scanning
- Highlight critical differences in **bold**
- Use \`inline code\` for part numbers and values`;

// =============================================================================
// Presets
// =============================================================================

const REPLACEMENT_PRESETS: PresetGroup = {
    id: "replacement",
    label: "",
    presets: [
        {
            id: "find-replacement",
            title: "Find Replacement",
            icon: "find_replace",
            description:
                "Find drop-in or compatible replacements for this part",
            query: "Find suitable replacements for this part. Prioritize drop-in replacements that are pin-compatible, but also suggest near-equivalents if no exact matches exist.",
            requiresContext: true,
        },
        {
            id: "upgrade-options",
            title: "Find Upgrade",
            icon: "trending_up",
            description: "Find better/newer parts with improved specs",
            query: "What are the best upgrade options for this part? I'm looking for improved performance, better availability, or newer technology that would be a good replacement.",
            requiresContext: true,
        },
        {
            id: "second-source",
            title: "Second Sources",
            icon: "compare",
            description: "Find the same part from other manufacturers",
            query: "What are the second-source options for this part? Find the same or equivalent part made by other manufacturers.",
            requiresContext: true,
        },
    ],
};

const ANALYSIS_PRESETS: PresetGroup = {
    id: "analysis",
    label: "",
    presets: [
        {
            id: "check-availability",
            title: "Check Availability",
            icon: "inventory",
            description:
                "Get insights on current availability and lifecycle status",
            query: "What is the current availability and lifecycle status of this part? Is it at risk of becoming obsolete?",
            requiresContext: true,
        },
        {
            id: "compare-specs",
            title: "Compare Specs",
            icon: "compare_arrows",
            description: "Compare this part with potential replacements",
            query: "Compare the key specifications of this part with common alternatives. What are the critical parameters to match?",
            requiresContext: true,
        },
    ],
};

// =============================================================================
// Extension Implementation
// =============================================================================

/**
 * Part Replacement Extension for finding component alternatives.
 */
export class PartReplacementExtension implements ChatExtension {
    readonly id = "part-replacement";
    readonly name = "Part Replacement";
    readonly supportsThinking = true;

    /**
     * Get presets for part replacement.
     */
    getPresets(context: ChatContext): PresetGroup[] {
        const partContext = context as PartReplacementContext;

        // Only show presets if we have part info
        if (!partContext.part) {
            return [];
        }

        return [REPLACEMENT_PRESETS, ANALYSIS_PRESETS];
    }

    /**
     * Build context for part replacement query.
     */
    async buildContext(
        context: ChatContext,
        userQuery: string,
        conversationHistory?: ChatMessage[],
    ): Promise<BuiltContext> {
        const partContext = context as PartReplacementContext;
        const { part, digiKeyData, reason } = partContext;

        // Build part information section
        let partInfo = "No part information provided.";

        if (part) {
            partInfo = this._buildPartInfo(part, digiKeyData, reason);
        }

        const systemPrompt = REPLACEMENT_SYSTEM_PROMPT;
        const userPrompt = `## Part Information\n\n${partInfo}\n\n---\n\n## User's Request\n${userQuery}`;

        // Add conversation history
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
     * Transform response to extract actionable items.
     */
    transformResponse(content: string): TransformedResponse {
        const actions: ResponseAction[] = [];

        // Extract part numbers from the response (simple regex for MPNs)
        const mpnPattern = /`([A-Z0-9][A-Z0-9\-/]+[A-Z0-9])`/g;
        const matches = content.matchAll(mpnPattern);

        for (const match of matches) {
            const mpn = match[1];
            // Skip if it looks like a net name or common term
            if (
                mpn &&
                mpn.length >= 4 &&
                !mpn.match(/^(VCC|GND|VDD|VSS|PIN|NET)/i)
            ) {
                if (!actions.find((a) => a.data?.["mpn"] === mpn)) {
                    actions.push({
                        id: `search-${mpn}`,
                        type: "search-digikey",
                        label: `Search ${mpn}`,
                        icon: "search",
                        data: { mpn },
                    });
                }
            }
        }

        return {
            content,
            actions: actions.slice(0, 5), // Limit to 5 actions
        };
    }

    /**
     * Get placeholder text.
     */
    getPlaceholder(context: ChatContext): string {
        const partContext = context as PartReplacementContext;
        if (partContext.part) {
            return `Ask about ${partContext.part.mpn}...`;
        }
        return "Select a part to find replacements...";
    }

    /**
     * Initialize extension.
     */
    async initialize(_context: ChatContext): Promise<void> {
        // No initialization needed
    }

    /**
     * Cleanup.
     */
    dispose(): void {
        // No cleanup needed
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private _buildPartInfo(
        part: PartInfo,
        digiKeyData?: DigiKeyPartInfo,
        reason?: string,
    ): string {
        const lines: string[] = [];

        // Basic info
        lines.push(`**Part Number:** ${part.mpn}`);

        if (part.manufacturer) {
            lines.push(`**Manufacturer:** ${part.manufacturer}`);
        }

        if (part.schematicReference) {
            lines.push(`**Schematic Reference:** ${part.schematicReference}`);
        }

        // Reason for replacement
        if (reason) {
            const reasonText = this._getReasonText(reason);
            lines.push(`**Reason for Replacement:** ${reasonText}`);
        }

        // Description
        if (part.description || digiKeyData?.description) {
            lines.push(
                `**Description:** ${
                    part.description || digiKeyData?.description
                }`,
            );
        }

        // Parameters
        const params: string[] = [];

        // From part info
        if (part.parameters) {
            for (const [key, value] of Object.entries(part.parameters)) {
                params.push(`- ${key}: ${value}`);
            }
        }

        // From DigiKey data
        if (digiKeyData?.parameters) {
            for (const param of digiKeyData.parameters) {
                // Skip if already have this param
                if (!params.find((p) => p.includes(param.name))) {
                    params.push(`- ${param.name}: ${param.value}`);
                }
            }
        }

        if (params.length > 0) {
            lines.push("\n**Key Parameters:**");
            lines.push(...params.slice(0, 10)); // Limit to 10 params
        }

        // DigiKey specific data
        if (digiKeyData) {
            lines.push("\n**Current Status (from DigiKey):**");

            if (digiKeyData.product_status) {
                lines.push(`- Status: ${digiKeyData.product_status}`);
            }
            if (digiKeyData.is_obsolete) {
                lines.push(`- ⚠️ **OBSOLETE**`);
            }
            if (digiKeyData.lifecycle_status) {
                lines.push(`- Lifecycle: ${digiKeyData.lifecycle_status}`);
            }
            if (digiKeyData.quantity_available !== null) {
                lines.push(
                    `- Stock: ${digiKeyData.quantity_available.toLocaleString()}`,
                );
            }
            if (digiKeyData.category) {
                lines.push(`- Category: ${digiKeyData.category}`);
            }
        }

        // Datasheet
        if (part.datasheetUrl || digiKeyData?.datasheet_url) {
            lines.push(
                `\n**Datasheet:** ${
                    part.datasheetUrl || digiKeyData?.datasheet_url
                }`,
            );
        }

        return lines.join("\n");
    }

    private _getReasonText(reason: string): string {
        switch (reason) {
            case "obsolete":
                return "Part is obsolete/discontinued";
            case "out_of_stock":
                return "Part is out of stock or has long lead times";
            case "nrnd":
                return "Part is Not Recommended for New Designs (NRND)";
            case "cost":
                return "Looking for a more cost-effective alternative";
            case "availability":
                return "Improving supply chain reliability";
            case "upgrade":
                return "Seeking improved performance or features";
            default:
                return reason;
        }
    }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a PartReplacementContext from DigiKey data.
 */
export function createPartContextFromDigiKey(
    digiKeyData: DigiKeyPartInfo,
    schematicReference?: string,
): PartReplacementContext {
    const reason = digiKeyData.is_obsolete
        ? "obsolete"
        : digiKeyData.lifecycle_status
              ?.toLowerCase()
              .includes("not recommended")
        ? "nrnd"
        : digiKeyData.quantity_available === 0
        ? "out_of_stock"
        : undefined;

    return {
        part: {
            mpn: digiKeyData.manufacturer_part_number || "",
            manufacturer: digiKeyData.manufacturer || undefined,
            description: digiKeyData.description || undefined,
            digiKeyPartNumber: digiKeyData.digikey_part_number || undefined,
            datasheetUrl: digiKeyData.datasheet_url || undefined,
            schematicReference,
        },
        digiKeyData,
        category: digiKeyData.category || undefined,
        reason,
    };
}

/**
 * Create a PartReplacementContext from basic part info.
 */
export function createPartContext(
    mpn: string,
    options?: {
        manufacturer?: string;
        description?: string;
        parameters?: Record<string, string>;
        schematicReference?: string;
        reason?: PartReplacementContext["reason"];
    },
): PartReplacementContext {
    return {
        part: {
            mpn,
            manufacturer: options?.manufacturer,
            description: options?.description,
            parameters: options?.parameters,
            schematicReference: options?.schematicReference,
        },
        reason: options?.reason,
    };
}

/**
 * Context item for a part needing replacement.
 */
export function createPartContextItem(
    mpn: string,
    manufacturer?: string,
    isObsolete?: boolean,
): ContextItem {
    return {
        id: mpn,
        type: isObsolete ? "obsolete-part" : "part",
        label: manufacturer ? `${mpn} (${manufacturer})` : mpn,
        properties: {
            mpn,
            manufacturer: manufacturer || "",
            obsolete: isObsolete || false,
        },
    };
}

// Export singleton instance
export const partReplacementExtension = new PartReplacementExtension();

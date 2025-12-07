/*
    Query presets for Grok chat panel.
    These are the "Quick Questions" shown to users.
    
    Presets are organized into:
    - Project-level queries (work without component selection)
    - Component-level queries (require selected components)
*/

import type { QueryPreset } from "./types";

/** Presets that work for the whole project (no selection needed) */
export const PROJECT_PRESETS: QueryPreset[] = [
    {
        id: "project-overview",
        title: "Project Overview",
        icon: "🔍",
        description: "Get a high-level overview of the entire schematic project",
        query: "Give an overview of the whole schematic project. Describe the main functional blocks, key ICs and their purposes, power architecture, and how the subsystems work together.",
    },
    {
        id: "power-analysis",
        title: "Power Analysis",
        icon: "⚡",
        description: "Analyze the power distribution and regulation",
        query: "Analyze the power architecture of this schematic. Identify all voltage rails, regulators, and power sources. Describe the power distribution topology and any power sequencing considerations.",
    },
];

/** Presets that require component selection */
export const COMPONENT_PRESETS: QueryPreset[] = [
    {
        id: "explain",
        title: "Explain",
        icon: "💡",
        description: "Explain what the selected components do",
        query: "What are these components doing? Explain their function in simple terms, how they work together, and their role in the circuit.",
    },
    {
        id: "connections",
        title: "Connections",
        icon: "🔗",
        description: "Analyze pin connections and nets",
        query: "Analyze the pin connections of the selected components. What nets are they connected to? What other components do they interface with?",
    },
    {
        id: "testing",
        title: "Testing",
        icon: "🧪",
        description: "How to test and debug",
        query: "How would I test these components to verify they are working correctly? Include typical voltage/current measurements, test points, and common failure modes to check for.",
    },
    {
        id: "alternatives",
        title: "Alternatives",
        icon: "🔄",
        description: "Find alternative parts",
        query: "What are suitable alternatives for these components? Consider pin-compatible replacements, functional equivalents from other manufacturers, and any trade-offs.",
    },
];

/** All presets combined (for backward compatibility) */
export const QUERY_PRESETS: QueryPreset[] = [
    ...PROJECT_PRESETS,
    ...COMPONENT_PRESETS,
];

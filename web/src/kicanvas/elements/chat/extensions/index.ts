/*
    Chat Extensions Index - Exports all available chat extensions.
*/

// Schematic Analysis Extension
export {
    SchematicExtension,
    schematicExtension,
    createSchematicContextItem,
    type SchematicContext,
    type SchematicContextItem,
} from "./schematic-extension";

// Part Replacement Extension
export {
    PartReplacementExtension,
    partReplacementExtension,
    createPartContextFromDigiKey,
    createPartContext,
    createPartContextItem,
    type PartReplacementContext,
    type PartInfo,
} from "./part-replacement-extension";

// Extension registry for dynamic lookup
import { schematicExtension } from "./schematic-extension";
import { partReplacementExtension } from "./part-replacement-extension";
import type { ChatExtension } from "../types";

/**
 * Registry of available chat extensions.
 */
export const extensionRegistry: Map<string, ChatExtension> = new Map<string, ChatExtension>([
    [schematicExtension.id, schematicExtension as ChatExtension],
    [partReplacementExtension.id, partReplacementExtension as ChatExtension],
]);

/**
 * Get an extension by ID.
 */
export function getExtension(id: string): ChatExtension | undefined {
    return extensionRegistry.get(id);
}

/**
 * Register a custom extension.
 */
export function registerExtension(extension: ChatExtension): void {
    extensionRegistry.set(extension.id, extension);
}


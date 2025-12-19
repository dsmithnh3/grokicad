/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

export { KicadPCB } from "./board";
export { KicadSch } from "./schematic";
export { DrawingSheet, type DrawingSheetDocument } from "./drawing-sheet";
export { ProjectSettings } from "./project-settings";
export type {
    Theme,
    BaseTheme,
    BoardTheme,
    SchematicTheme,
    BoardOrSchematicTheme,
} from "./theme";

// Schematic distillation for AI context
export {
    distillSchematic,
    distillHierarchicalSchematics,
    createDefaultConfig,
    type DistilledSchematic,
    type DistilledComponent,
    type DistilledPin,
    type DistilledNet,
    type ProximityEdge,
    type DistillationConfig,
    type ComponentCategory,
} from "./distill";

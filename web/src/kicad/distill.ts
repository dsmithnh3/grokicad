/*
    Schematic Distillation for AI Context
    
    Converts KiCAD schematics into an LLM-friendly JSON representation with:
    - Components (with properties, pins, and net connections)
    - Nets (electrical connectivity)
    - Proximities (spatial relationships for decoupling analysis)
    
    Port of the Python kicad-sch-api distiller to TypeScript for browser execution.
*/

import { Vec2 } from "../base/math";
import {
    KicadSch,
    SchematicSymbol,
    PinInstance,
    Wire,
    Junction,
    NetLabel,
    GlobalLabel,
    HierarchicalLabel,
} from "./schematic";

// ============================================================================
// Types - Match Python distiller output format exactly
// ============================================================================

export interface DistilledPin {
    number: string;
    name: string | null;
    net: string | null;
}

export interface DistilledComponent {
    reference: string;
    lib_id: string;
    value: string;
    position: { x: number; y: number };
    footprint: string | null;
    properties: Record<string, string>;
    category: ComponentCategory;
    pins: DistilledPin[];
    sheet_path?: string;
}

export interface DistilledNet {
    [reference: string]: Array<{ Pin: string }>;
}

export interface ProximityEdge {
    ref_a: string;
    ref_b: string;
    distance_mm: number;
    score: number;
    category_a: string;
    category_b: string;
    weight: number;
}

export interface DistilledSchematic {
    components: DistilledComponent[];
    nets: Record<string, DistilledNet>;
    proximities: ProximityEdge[];
}

export type ComponentCategory =
    | "ic"
    | "capacitor"
    | "resistor"
    | "inductor"
    | "transistor"
    | "other";

// ============================================================================
// Configuration
// ============================================================================

export interface DistillationConfig {
    /** Radius in mm for proximity calculations (default: 20) */
    proximityRadiusMm: number;
    /** Weight multipliers for category pairs (boosts common relationships) */
    weightMultipliers: Map<string, number>;
    /** Whether to include sheet_path for hierarchical schematics */
    hierarchical: boolean;
}

const DEFAULT_WEIGHT_MULTIPLIERS = new Map<string, number>([
    ["capacitor|ic", 2.0],
    ["ic|capacitor", 2.0],
    ["capacitor|other", 1.2],
    ["other|capacitor", 1.2],
]);

export function createDefaultConfig(): DistillationConfig {
    return {
        proximityRadiusMm: 20.0,
        weightMultipliers: new Map(DEFAULT_WEIGHT_MULTIPLIERS),
        hierarchical: true,
    };
}

// ============================================================================
// Connectivity Analyzer - Union-Find based net tracing
// ============================================================================

interface PinConnection {
    reference: string;
    pinNumber: string;
    position: Vec2;
}

interface Net {
    name: string | null;
    pins: Set<string>; // "ref|pin" format for deduplication
    pinConnections: PinConnection[];
}

class ConnectivityAnalyzer {
    private parent = new Map<string, string>();
    private nets: Net[] = [];
    private pinToNet = new Map<string, Net>();
    private labelRootsByText = new Map<string, string[]>();

    constructor() {}

    /**
     * Analyze connectivity in a schematic and return all nets
     */
    analyze(schematic: KicadSch, sheetPath: string = "/"): Net[] {
        this.reset();

        // Build pin positions for all symbols
        const pinPositions = this.buildPinPositions(schematic);

        // Process wires - create union-find graph
        this.processWires(schematic.wires);

        // Process junctions - merge wire endpoints at junctions
        this.processJunctions(schematic.junctions);

        // Connect pins to wire endpoints
        this.connectPinsToWires(pinPositions);

        // Process labels (local, global, hierarchical)
        this.processLabels([
            ...schematic.net_labels,
            ...schematic.global_labels,
            ...schematic.hierarchical_labels,
        ]);

        // Process power symbols (implicit global connections)
        this.processPowerSymbols(schematic);

        // Build nets from connected components
        this.buildNets(pinPositions);

        return this.nets;
    }

    private reset(): void {
        this.parent.clear();
        this.nets = [];
        this.pinToNet.clear();
        this.labelRootsByText.clear();
    }

    private keyFor(x: number, y: number): string {
        return `${x.toFixed(3)},${y.toFixed(3)}`;
    }

    private find(k: string): string {
        const p = this.parent.get(k);
        if (p === undefined) {
            this.parent.set(k, k);
            return k;
        }
        if (p !== k) {
            const root = this.find(p);
            this.parent.set(k, root);
            return root;
        }
        return p;
    }

    private union(a: string, b: string): void {
        const ra = this.find(a);
        const rb = this.find(b);
        if (ra !== rb) {
            this.parent.set(ra, rb);
        }
    }

    private buildPinPositions(
        schematic: KicadSch,
    ): Map<string, PinConnection[]> {
        const pinPositions = new Map<string, PinConnection[]>();

        for (const symbol of schematic.symbols.values()) {
            // Skip power symbols for pin position mapping
            if (this.isPowerSymbol(symbol)) continue;

            for (const pin of symbol.unit_pins) {
                const pos = this.getPinPosition(symbol, pin);
                const k = this.keyFor(pos.x, pos.y);
                this.find(k); // Ensure node exists

                if (!pinPositions.has(k)) {
                    pinPositions.set(k, []);
                }
                pinPositions.get(k)!.push({
                    reference: symbol.reference,
                    pinNumber: pin.number,
                    position: pos,
                });
            }
        }

        return pinPositions;
    }

    private getPinPosition(symbol: SchematicSymbol, pin: PinInstance): Vec2 {
        const pinDef = pin.definition;
        const pinPos = pinDef.at.position.copy();

        // Apply symbol transformation
        const rotation = (symbol.at.rotation ?? 0) * (Math.PI / 180);
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);

        // Rotate pin position
        const rx = pinPos.x * cos - pinPos.y * sin;
        const ry = pinPos.x * sin + pinPos.y * cos;

        // Apply mirroring
        let mx = rx;
        let my = ry;
        if (symbol.mirror === "x") {
            mx = -rx;
        } else if (symbol.mirror === "y") {
            my = -ry;
        }

        // Translate to symbol position
        return new Vec2(symbol.at.position.x + mx, symbol.at.position.y + my);
    }

    private processWires(wires: Wire[]): void {
        for (const wire of wires) {
            for (let i = 0; i < wire.pts.length; i++) {
                const pt = wire.pts[i]!;
                const k = this.keyFor(pt.x, pt.y);
                this.find(k);

                if (i > 0) {
                    const prev = wire.pts[i - 1]!;
                    this.union(k, this.keyFor(prev.x, prev.y));
                }
            }
        }
    }

    private processJunctions(junctions: Junction[]): void {
        for (const junction of junctions) {
            const pos = junction.at.position;
            const k = this.keyFor(pos.x, pos.y);
            this.find(k); // Junctions implicitly connect at their position
        }
    }

    private connectPinsToWires(
        pinPositions: Map<string, PinConnection[]>,
    ): void {
        // Pins are already keyed by position, which matches wire endpoints
        // The union-find automatically connects them
        for (const k of pinPositions.keys()) {
            this.find(k);
        }
    }

    private processLabels(
        labels: (NetLabel | GlobalLabel | HierarchicalLabel)[],
    ): void {
        for (const label of labels) {
            const k = this.keyFor(label.at.position.x, label.at.position.y);
            this.find(k);

            if (label.text) {
                if (!this.labelRootsByText.has(label.text)) {
                    this.labelRootsByText.set(label.text, []);
                }
                this.labelRootsByText.get(label.text)!.push(this.find(k));
            }
        }

        // Connect all roots with the same label text
        for (const roots of this.labelRootsByText.values()) {
            if (roots.length >= 2) {
                const first = roots[0]!;
                for (let i = 1; i < roots.length; i++) {
                    this.union(first, roots[i]!);
                }
            }
        }
    }

    private processPowerSymbols(schematic: KicadSch): void {
        // Group power symbols by their value (VCC, GND, etc.)
        const powerByValue = new Map<string, string[]>();

        for (const symbol of schematic.symbols.values()) {
            if (this.isPowerSymbol(symbol)) {
                const powerValue = symbol.value;

                // Find pin position for this power symbol
                if (symbol.unit_pins.length > 0) {
                    const pin = symbol.unit_pins[0]!;
                    const pos = this.getPinPosition(symbol, pin);
                    const k = this.keyFor(pos.x, pos.y);
                    this.find(k);

                    if (!powerByValue.has(powerValue)) {
                        powerByValue.set(powerValue, []);
                    }
                    powerByValue.get(powerValue)!.push(k);

                    // Also add to label roots for net naming
                    if (!this.labelRootsByText.has(powerValue)) {
                        this.labelRootsByText.set(powerValue, []);
                    }
                    this.labelRootsByText.get(powerValue)!.push(this.find(k));
                }
            }
        }

        // Connect all power symbols with the same value
        for (const keys of powerByValue.values()) {
            if (keys.length >= 2) {
                const first = keys[0]!;
                for (let i = 1; i < keys.length; i++) {
                    this.union(first, keys[i]!);
                }
            }
        }
    }

    private isPowerSymbol(symbol: SchematicSymbol): boolean {
        return (
            symbol.lib_id.toLowerCase().startsWith("power:") ||
            symbol.reference.startsWith("#PWR")
        );
    }

    private buildNets(pinPositions: Map<string, PinConnection[]>): void {
        // Group pins by connectivity root
        const pinsByRoot = new Map<string, PinConnection[]>();

        for (const [k, pins] of pinPositions) {
            const root = this.find(k);
            if (!pinsByRoot.has(root)) {
                pinsByRoot.set(root, []);
            }
            pinsByRoot.get(root)!.push(...pins);
        }

        // Determine net name per root
        const netNameByRoot = new Map<string, string>();
        for (const [text, roots] of this.labelRootsByText) {
            for (const r of roots) {
                const root = this.find(r);
                if (!netNameByRoot.has(root)) {
                    netNameByRoot.set(root, text);
                }
            }
        }

        // Create nets
        for (const [root, pins] of pinsByRoot) {
            if (pins.length === 0) continue;

            let netName = netNameByRoot.get(root);

            // Auto-generate name if not labeled
            if (!netName) {
                const firstPin = pins[0]!;
                netName = `Net-(${firstPin.reference}-Pad${firstPin.pinNumber})`;
            }

            const net: Net = {
                name: netName,
                pins: new Set(pins.map((p) => `${p.reference}|${p.pinNumber}`)),
                pinConnections: pins,
            };

            this.nets.push(net);

            // Map each pin to its net
            for (const pin of pins) {
                const pinKey = `${pin.reference}|${pin.pinNumber}`;
                this.pinToNet.set(pinKey, net);
            }
        }
    }

    getNetForPin(reference: string, pinNumber: string): Net | null {
        return this.pinToNet.get(`${reference}|${pinNumber}`) ?? null;
    }
}

// ============================================================================
// Component Categorization
// ============================================================================

function classifyComponent(symbol: SchematicSymbol): ComponentCategory {
    const ref = symbol.reference.toUpperCase();
    const lib = symbol.lib_id.toLowerCase();

    if (ref.startsWith("C") || lib.includes("cap")) {
        return "capacitor";
    }
    if (ref.startsWith("R") || lib.includes("res")) {
        return "resistor";
    }
    if (ref.startsWith("L") || lib.includes("ind")) {
        return "inductor";
    }
    if (ref.startsWith("Q") || lib.includes("transistor")) {
        return "transistor";
    }
    if (ref.startsWith("U") || lib.includes("mcu") || lib.includes("ic")) {
        return "ic";
    }
    return "other";
}

// ============================================================================
// Symbol Filtering
// ============================================================================

function isRealSymbol(symbol: SchematicSymbol): boolean {
    const ref = symbol.reference.toUpperCase();
    const lib = symbol.lib_id.toLowerCase();

    // Filter out power symbols
    if (ref.startsWith("#")) return false;
    if (ref.startsWith("NET-")) return false;
    if (lib.startsWith("power:")) return false;
    if (lib.startsWith("net:")) return false;

    return true;
}

// ============================================================================
// Proximity Calculation
// ============================================================================

function distance(
    p1: { x: number; y: number },
    p2: { x: number; y: number },
): number {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

function isIcCapPair(
    catA: ComponentCategory,
    catB: ComponentCategory,
): boolean {
    return (
        (catA === "ic" && catB === "capacitor") ||
        (catA === "capacitor" && catB === "ic")
    );
}

function isURef(reference: string): boolean {
    return reference.toUpperCase().startsWith("U");
}

function computeProximities(
    components: DistilledComponent[],
    config: DistillationConfig,
): ProximityEdge[] {
    const proximities: ProximityEdge[] = [];
    const radiusMm = config.proximityRadiusMm;

    for (let i = 0; i < components.length; i++) {
        const compA = components[i]!;

        for (let j = i + 1; j < components.length; j++) {
            const compB = components[j]!;

            // Calculate distance
            const dist = distance(compA.position, compB.position);

            // IC-cap pairs get extended radius (1.5x)
            const effectiveRadius = isIcCapPair(compA.category, compB.category)
                ? radiusMm * 1.5
                : radiusMm;

            if (dist > effectiveRadius) continue;

            // Calculate weight
            const pairKey = `${compA.category}|${compB.category}`;
            const reversePairKey = `${compB.category}|${compA.category}`;
            let weight =
                config.weightMultipliers.get(pairKey) ??
                config.weightMultipliers.get(reversePairKey) ??
                1.0;

            // Extra boost for U? + capacitor pairs (decoupling caps)
            if (
                isIcCapPair(compA.category, compB.category) &&
                (isURef(compA.reference) || isURef(compB.reference))
            ) {
                weight *= 3.0;
            }

            // Calculate score: higher when closer
            const baseScore = Math.max(0, (radiusMm - dist) / radiusMm);
            const score = baseScore * weight;

            proximities.push({
                ref_a: compA.reference,
                ref_b: compB.reference,
                distance_mm: dist,
                score,
                category_a: compA.category,
                category_b: compB.category,
                weight,
            });
        }
    }

    return proximities;
}

// ============================================================================
// Component Distillation
// ============================================================================

function distillComponent(
    symbol: SchematicSymbol,
    analyzer: ConnectivityAnalyzer,
    sheetPath?: string,
): DistilledComponent {
    // Extract and flatten properties
    const properties: Record<string, string> = {};
    for (const [name, prop] of symbol.properties) {
        if (name.startsWith("__sexp_")) continue;
        if (prop.text !== undefined && prop.text !== null && prop.text !== "") {
            properties[name] = prop.text;
        }
    }

    // Build pins with net connections
    const pins: DistilledPin[] = [];
    for (const pin of symbol.unit_pins) {
        const pinDef = pin.definition;
        const net = analyzer.getNetForPin(symbol.reference, pin.number);

        pins.push({
            number: pin.number,
            name: pinDef.name?.text ?? null,
            net: net?.name ?? null,
        });
    }

    const result: DistilledComponent = {
        reference: symbol.reference,
        lib_id: symbol.lib_id,
        value: symbol.value,
        position: {
            x: symbol.at.position.x,
            y: symbol.at.position.y,
        },
        footprint: symbol.footprint || null,
        properties,
        category: classifyComponent(symbol),
        pins,
    };

    if (sheetPath !== undefined) {
        result.sheet_path = sheetPath;
    }

    return result;
}

// ============================================================================
// Net Distillation
// ============================================================================

function distillNets(
    nets: Net[],
    components: Set<string>,
): Record<string, DistilledNet> {
    const result: Record<string, DistilledNet> = {};

    for (const net of nets) {
        if (!net.name) continue;

        const distilledNet: DistilledNet = {};

        for (const pin of net.pinConnections) {
            // Only include pins from real components
            if (!components.has(pin.reference)) continue;

            if (!distilledNet[pin.reference]) {
                distilledNet[pin.reference] = [];
            }
            distilledNet[pin.reference]!.push({ Pin: pin.pinNumber });
        }

        // Only include net if it has at least one real component
        if (Object.keys(distilledNet).length > 0) {
            result[net.name] = distilledNet;
        }
    }

    return result;
}

// ============================================================================
// Main Distillation Function
// ============================================================================

/**
 * Distill a KiCAD schematic into an LLM-friendly JSON representation.
 *
 * @param schematic - The parsed KiCAD schematic
 * @param config - Optional configuration for distillation
 * @returns Distilled schematic with components, nets, and proximities
 */
export function distillSchematic(
    schematic: KicadSch,
    config: Partial<DistillationConfig> = {},
): DistilledSchematic {
    const cfg: DistillationConfig = {
        ...createDefaultConfig(),
        ...config,
    };

    // Analyze connectivity
    const analyzer = new ConnectivityAnalyzer();
    const nets = analyzer.analyze(schematic, "/");

    // Filter and distill components
    const realSymbols = Array.from(schematic.symbols.values()).filter(
        isRealSymbol,
    );

    const sheetPath = cfg.hierarchical ? "/" : undefined;
    const distilledComponents = realSymbols.map((symbol) =>
        distillComponent(symbol, analyzer, sheetPath),
    );

    // Build set of real component references for net filtering
    const componentRefs = new Set(distilledComponents.map((c) => c.reference));

    // Distill nets
    const distilledNets = distillNets(nets, componentRefs);

    // Compute proximities
    const proximities = computeProximities(distilledComponents, cfg);

    return {
        components: distilledComponents,
        nets: distilledNets,
        proximities,
    };
}

/**
 * Distill multiple schematics (for hierarchical designs).
 *
 * @param schematics - Array of [schematic, sheetPath] tuples
 * @param config - Optional configuration for distillation
 * @returns Combined distilled schematic
 */
export function distillHierarchicalSchematics(
    schematics: Array<[KicadSch, string]>,
    config: Partial<DistillationConfig> = {},
): DistilledSchematic {
    const cfg: DistillationConfig = {
        ...createDefaultConfig(),
        ...config,
        hierarchical: true,
    };

    const allComponents: DistilledComponent[] = [];
    const allNets: Net[] = [];
    const componentRefs = new Set<string>();

    for (const [schematic, sheetPath] of schematics) {
        // Analyze connectivity for this schematic
        const analyzer = new ConnectivityAnalyzer();
        const nets = analyzer.analyze(schematic, sheetPath);
        allNets.push(...nets);

        // Filter and distill components
        const realSymbols = Array.from(schematic.symbols.values()).filter(
            isRealSymbol,
        );

        for (const symbol of realSymbols) {
            const distilled = distillComponent(symbol, analyzer, sheetPath);
            allComponents.push(distilled);
            componentRefs.add(distilled.reference);
        }
    }

    // Distill combined nets
    const distilledNets = distillNets(allNets, componentRefs);

    // Compute proximities per sheet (to avoid cross-sheet noise)
    const componentsBySheet = new Map<string, DistilledComponent[]>();
    for (const comp of allComponents) {
        const sheet = comp.sheet_path ?? "/";
        if (!componentsBySheet.has(sheet)) {
            componentsBySheet.set(sheet, []);
        }
        componentsBySheet.get(sheet)!.push(comp);
    }

    const allProximities: ProximityEdge[] = [];
    for (const sheetComponents of componentsBySheet.values()) {
        allProximities.push(...computeProximities(sheetComponents, cfg));
    }

    return {
        components: allComponents,
        nets: distilledNets,
        proximities: allProximities,
    };
}

// ============================================================================
// Context Slicing for Selected Components
// ============================================================================

export interface SlicedContext {
    /** Components explicitly selected by the user */
    selected: DistilledComponent[];
    /** Components connected via nets to selected components */
    connected: DistilledComponent[];
    /** Components nearby (from proximity data) */
    nearby: DistilledComponent[];
    /** Nets involving selected or connected components */
    relevantNets: Record<string, DistilledNet>;
    /** Proximities involving selected components */
    relevantProximities: ProximityEdge[];
    /** Summary stats */
    stats: {
        selectedCount: number;
        connectedCount: number;
        nearbyCount: number;
        relevantNetCount: number;
    };
}

/**
 * Slice a distilled schematic to focus on selected components and their context.
 * This provides a focused view for AI analysis of a subsystem.
 *
 * @param distilled - The full distilled schematic
 * @param selectedRefs - Array of component references selected by the user
 * @param options - Slicing options
 * @returns Focused context with selected, connected, and nearby components
 */
export function sliceDistillationForComponents(
    distilled: DistilledSchematic,
    selectedRefs: string[],
    options: {
        /** Include components sharing nets with selected (default: true) */
        includeConnected?: boolean;
        /** Include nearby components from proximity data (default: true) */
        includeNearby?: boolean;
        /** Maximum number of connected components to include (default: 20) */
        maxConnected?: number;
        /** Maximum number of nearby components to include (default: 10) */
        maxNearby?: number;
        /** Minimum proximity score to consider (default: 0.2) */
        minProximityScore?: number;
    } = {},
): SlicedContext {
    const {
        includeConnected = true,
        includeNearby = true,
        maxConnected = 20,
        maxNearby = 10,
        minProximityScore = 0.2,
    } = options;

    const selectedSet = new Set(selectedRefs);
    const connectedSet = new Set<string>();
    const nearbySet = new Set<string>();

    // Build component lookup by reference
    const componentByRef = new Map<string, DistilledComponent>();
    for (const comp of distilled.components) {
        componentByRef.set(comp.reference, comp);
    }

    // Get selected components
    const selected = selectedRefs
        .map((ref) => componentByRef.get(ref))
        .filter((c): c is DistilledComponent => c !== undefined);

    // Find connected components via nets
    if (includeConnected) {
        // Get all nets that involve selected components
        const selectedNets = new Set<string>();
        for (const comp of selected) {
            for (const pin of comp.pins) {
                if (pin.net) {
                    selectedNets.add(pin.net);
                }
            }
        }

        // Find components that share these nets
        for (const comp of distilled.components) {
            if (selectedSet.has(comp.reference)) continue;

            for (const pin of comp.pins) {
                if (pin.net && selectedNets.has(pin.net)) {
                    connectedSet.add(comp.reference);
                    break;
                }
            }

            if (connectedSet.size >= maxConnected) break;
        }
    }

    // Find nearby components from proximity data
    if (includeNearby) {
        // Sort proximities by score for selected components
        const relevantProximities = distilled.proximities
            .filter((p) => {
                const hasSelected =
                    selectedSet.has(p.ref_a) || selectedSet.has(p.ref_b);
                return hasSelected && p.score >= minProximityScore;
            })
            .sort((a, b) => b.score - a.score);

        for (const prox of relevantProximities) {
            const other = selectedSet.has(prox.ref_a) ? prox.ref_b : prox.ref_a;

            if (
                !selectedSet.has(other) &&
                !connectedSet.has(other) &&
                nearbySet.size < maxNearby
            ) {
                nearbySet.add(other);
            }
        }
    }

    // Get component details for connected and nearby
    const connected = Array.from(connectedSet)
        .map((ref) => componentByRef.get(ref))
        .filter((c): c is DistilledComponent => c !== undefined);

    const nearby = Array.from(nearbySet)
        .map((ref) => componentByRef.get(ref))
        .filter((c): c is DistilledComponent => c !== undefined);

    // Get all relevant component refs (for net filtering)
    const allRelevantRefs = new Set([
        ...selectedSet,
        ...connectedSet,
        ...nearbySet,
    ]);

    // Filter nets to only those involving relevant components
    const relevantNets: Record<string, DistilledNet> = {};
    for (const [netName, net] of Object.entries(distilled.nets)) {
        const relevantPins: DistilledNet = {};
        let hasRelevantComponent = false;

        for (const [ref, pins] of Object.entries(net)) {
            if (allRelevantRefs.has(ref)) {
                relevantPins[ref] = pins;
                hasRelevantComponent = true;
            }
        }

        if (hasRelevantComponent) {
            relevantNets[netName] = relevantPins;
        }
    }

    // Filter proximities to those involving selected components
    const relevantProximities = distilled.proximities.filter(
        (p) =>
            (selectedSet.has(p.ref_a) || selectedSet.has(p.ref_b)) &&
            allRelevantRefs.has(p.ref_a) &&
            allRelevantRefs.has(p.ref_b),
    );

    return {
        selected,
        connected,
        nearby,
        relevantNets,
        relevantProximities,
        stats: {
            selectedCount: selected.length,
            connectedCount: connected.length,
            nearbyCount: nearby.length,
            relevantNetCount: Object.keys(relevantNets).length,
        },
    };
}

/**
 * Create a focused distilled schematic for selected components.
 * This is a convenience function that returns a DistilledSchematic
 * containing only the relevant components, nets, and proximities.
 *
 * @param distilled - The full distilled schematic
 * @param selectedRefs - Array of component references selected by the user
 * @returns A new DistilledSchematic focused on the selection
 */
export function createFocusedDistillation(
    distilled: DistilledSchematic,
    selectedRefs: string[],
): DistilledSchematic {
    const slice = sliceDistillationForComponents(distilled, selectedRefs);

    // Combine all relevant components
    const allComponents = [
        ...slice.selected,
        ...slice.connected,
        ...slice.nearby,
    ];

    // Remove duplicates by reference
    const seen = new Set<string>();
    const uniqueComponents = allComponents.filter((c) => {
        if (seen.has(c.reference)) return false;
        seen.add(c.reference);
        return true;
    });

    return {
        components: uniqueComponents,
        nets: slice.relevantNets,
        proximities: slice.relevantProximities,
    };
}

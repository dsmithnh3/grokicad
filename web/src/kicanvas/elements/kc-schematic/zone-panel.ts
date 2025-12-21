/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { css, html } from "../../../base/web-components";
import { KCUIElement } from "../../../kc-ui";
import { SchematicSymbol, Wire } from "../../../kicad/schematic";
import {
    KiCanvasLoadEvent,
    KiCanvasZoneSelectEvent,
    type ZoneConnection,
} from "../../../viewers/base/events";
import { SchematicViewer } from "../../../viewers/schematic/viewer";

const MAX_VISIBLE_PINS = 8;

interface ZoneSymbolData {
    symbol: SchematicSymbol;
    reference: string;
    value: string;
    footprint: string;
    pins: { number: string; name: string }[];
}

interface ZoneSelectionData {
    symbols: ZoneSymbolData[];
    connections: ZoneConnection[];
    bounds: { x: number; y: number; w: number; h: number };
    wireCount: number;
    labelCount: number;
}

export class KCSchematicZonePanelElement extends KCUIElement {
    static override styles = [
        ...KCUIElement.styles,
        css`
            :host {
                display: flex;
                flex-direction: column;
                height: 100%;
            }

            kc-ui-panel {
                display: flex;
                flex-direction: column;
                flex: 1;
                min-height: 0;
            }

            kc-ui-panel-body {
                display: flex;
                flex-direction: column;
                flex: 1;
                min-height: 0;
            }

            .zone-info {
                padding: 0.5em;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 4px;
                margin-bottom: 0.5em;
                font-size: 0.85em;
            }

            .zone-info-label {
                color: rgba(255, 255, 255, 0.5);
                font-size: 0.75em;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }

            .zone-stats {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 0.5em;
                margin-top: 0.5em;
            }

            .zone-stat {
                text-align: center;
                padding: 0.5em;
                background: rgba(78, 205, 196, 0.1);
                border-radius: 4px;
            }

            .zone-stat-value {
                font-size: 1.5em;
                font-weight: bold;
                color: rgb(78, 205, 196);
            }

            .zone-stat-label {
                font-size: 0.7em;
                color: rgba(255, 255, 255, 0.5);
                text-transform: uppercase;
            }

            .symbol-list {
                display: flex;
                flex-direction: column;
                gap: 0.5em;
            }

            .symbol-item {
                padding: 0.75em;
                background: rgba(255, 255, 255, 0.05);
                border-radius: 4px;
                cursor: pointer;
                transition: background 0.2s ease;
            }

            .symbol-item:hover {
                background: rgba(255, 206, 84, 0.1);
            }

            .symbol-header {
                display: flex;
                align-items: center;
                gap: 0.5em;
                margin-bottom: 0.25em;
            }

            .symbol-reference {
                font-family: "JetBrains Mono", "SF Mono", monospace;
                font-weight: bold;
                color: rgb(255, 206, 84);
            }

            .symbol-value {
                color: rgba(255, 255, 255, 0.9);
            }

            .symbol-footprint {
                font-size: 0.8em;
                color: rgba(255, 255, 255, 0.5);
            }

            .symbol-pins {
                margin-top: 0.5em;
                padding-top: 0.5em;
                border-top: 1px solid rgba(255, 255, 255, 0.1);
            }

            .symbol-pins-label {
                font-size: 0.75em;
                color: rgba(255, 255, 255, 0.5);
                margin-bottom: 0.25em;
            }

            .pin-list {
                display: flex;
                flex-wrap: wrap;
                gap: 0.25em;
            }

            .pin-item {
                font-size: 0.75em;
                padding: 0.15em 0.4em;
                background: rgba(255, 255, 255, 0.1);
                border-radius: 3px;
            }

            .pin-toggle {
                font-size: 0.75em;
                padding: 0.15em 0.4em;
                background: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.15);
                border-radius: 3px;
                color: rgba(255, 255, 255, 0.85);
                cursor: pointer;
                pointer-events: auto;
                display: inline-flex;
                align-items: center;
                gap: 0.2em;
            }

            .pin-toggle:hover {
                background: rgba(255, 206, 84, 0.15);
                border-color: rgba(255, 206, 84, 0.3);
            }

            .pin-number {
                color: rgb(78, 205, 196);
            }

            .pin-name {
                color: rgba(255, 255, 255, 0.7);
            }

            .connections-section {
                margin-top: 1em;
            }

            .connections-title {
                font-size: 0.9em;
                font-weight: bold;
                color: rgba(255, 255, 255, 0.8);
                margin-bottom: 0.5em;
                padding-bottom: 0.25em;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }

            .connection-list {
                display: flex;
                flex-direction: column;
                gap: 0.25em;
            }

            .connection-item {
                display: flex;
                align-items: center;
                gap: 0.5em;
                padding: 0.5em;
                background: rgba(255, 255, 255, 0.03);
                border-radius: 4px;
                font-size: 0.85em;
            }

            .connection-endpoint {
                display: flex;
                align-items: center;
                gap: 0.25em;
            }

            .connection-ref {
                font-family: "JetBrains Mono", "SF Mono", monospace;
                color: rgb(255, 206, 84);
            }

            .connection-pin {
                color: rgb(78, 205, 196);
            }

            .connection-arrow {
                color: rgba(255, 255, 255, 0.3);
            }

            .connection-net {
                margin-left: auto;
                font-size: 0.8em;
                color: rgba(255, 255, 255, 0.5);
                background: rgba(255, 255, 255, 0.1);
                padding: 0.1em 0.4em;
                border-radius: 3px;
            }

            .empty-state {
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                padding: 2em;
                color: rgba(255, 255, 255, 0.5);
                text-align: center;
            }

            .empty-state-icon {
                font-size: 2.5em;
                margin-bottom: 0.5em;
                opacity: 0.5;
            }

            .empty-state-hint {
                font-size: 0.85em;
                margin-top: 0.5em;
                color: rgba(255, 255, 255, 0.4);
            }

            .hint-key {
                display: inline-block;
                padding: 0.1em 0.4em;
                background: rgba(255, 255, 255, 0.15);
                border-radius: 3px;
                font-family: "JetBrains Mono", "SF Mono", monospace;
                font-size: 0.9em;
            }

            .scrollable {
                flex: 1;
                min-height: 0;
                overflow-y: auto;
            }
        `,
    ];

    viewer: SchematicViewer;
    zoneData: ZoneSelectionData | null = null;
    /** Tracks which symbols have their full pin list expanded */
    expandedPinSymbols: Set<string> = new Set();

    override connectedCallback() {
        (async () => {
            this.viewer = await this.requestLazyContext("viewer");
            await this.viewer.loaded;
            super.connectedCallback();
            this.setup_events();
        })();
    }

    private setup_events() {
        // Listen for zone selection events
        this.addDisposable(
            this.viewer.addEventListener(KiCanvasZoneSelectEvent.type, (e) => {
                this.on_zone_select(e);
            }),
        );

        // Clear zone data when schematic changes
        this.addDisposable(
            this.viewer.addEventListener(KiCanvasLoadEvent.type, () => {
                this.zoneData = null;
                this.update();
            }),
        );

        // Handle clicks via event delegation
        this.addEventListener("click", (e) => {
            const path = e.composedPath() as HTMLElement[];

            // Handle pin list expand/collapse
            const pinToggle = path.find(
                (n): n is HTMLElement =>
                    n instanceof HTMLElement &&
                    n.dataset !== undefined &&
                    n.dataset["pinToggle"] !== undefined,
            );
            if (pinToggle) {
                const uuid = pinToggle.dataset["pinToggle"];
                if (uuid) {
                    this.toggle_symbol_pins(uuid);
                    e.stopPropagation();
                    e.preventDefault();
                    return;
                }
            }

            // Handle symbol clicks
            const symbolItem = path.find(
                (n): n is HTMLElement =>
                    n instanceof HTMLElement &&
                    n.dataset !== undefined &&
                    n.dataset["symbolUuid"] !== undefined,
            );
            if (symbolItem) {
                const uuid = symbolItem.dataset["symbolUuid"];
                if (uuid) {
                    this.viewer.select(uuid);
                }
            }
        });
    }

    private on_zone_select(e: KiCanvasZoneSelectEvent) {
        const { items, bounds, connections } = e.detail;

        // If no items selected, clear the zone data (deselection)
        if (items.length === 0) {
            this.zoneData = null;
            this.update();
            return;
        }

        // Reset expanded pin state on new selection
        this.expandedPinSymbols.clear();

        // Filter and process symbols
        const symbols: ZoneSymbolData[] = items
            .filter(
                (item): item is SchematicSymbol =>
                    item instanceof SchematicSymbol,
            )
            .map((symbol) => {
                const data = this.viewer.get_symbol_data(symbol);
                return {
                    symbol,
                    reference: data.reference,
                    value: data.value,
                    footprint: data.footprint,
                    pins: data.pins,
                };
            });

        // Count wires and labels
        const wireCount = items.filter(
            (item): item is Wire => item instanceof Wire,
        ).length;

        const labelCount = items.filter(
            (item) =>
                item !== null &&
                typeof item === "object" &&
                "text" in item &&
                "at" in item,
        ).length;

        this.zoneData = {
            symbols,
            connections,
            bounds,
            wireCount,
            labelCount,
        };

        this.update();

        // Dispatch custom event for external consumers
        this.dispatchEvent(
            new CustomEvent("zone-data-updated", {
                detail: this.zoneData,
                bubbles: true,
                composed: true,
            }),
        );
    }

    private toggle_symbol_pins(uuid: string) {
        if (this.expandedPinSymbols.has(uuid)) {
            this.expandedPinSymbols.delete(uuid);
        } else {
            this.expandedPinSymbols.add(uuid);
        }
        this.update();
    }

    override render() {
        if (!this.zoneData) {
            return html`
                <kc-ui-panel>
                    <kc-ui-panel-title
                        title="Zone Selection"></kc-ui-panel-title>
                    <kc-ui-panel-body>
                        <div class="empty-state">
                            <div class="empty-state-icon">◻️</div>
                            <div>No zone selected</div>
                            <div class="empty-state-hint">
                                Hold <span class="hint-key">Shift</span> and
                                drag to select a zone
                            </div>
                        </div>
                    </kc-ui-panel-body>
                </kc-ui-panel>
            `;
        }

        const { symbols, connections, wireCount, labelCount } = this.zoneData;

        const symbolItems = symbols.map((s) => {
            const isExpanded = this.expandedPinSymbols.has(s.symbol.uuid);
            const hasOverflow = s.pins.length > MAX_VISIBLE_PINS;
            const visiblePins = isExpanded
                ? s.pins
                : s.pins.slice(0, MAX_VISIBLE_PINS);
            const remaining = Math.max(0, s.pins.length - MAX_VISIBLE_PINS);

            return html`
                <div class="symbol-item" data-symbol-uuid="${s.symbol.uuid}">
                    <div class="symbol-header">
                        <span class="symbol-reference">${s.reference}</span>
                        <span class="symbol-value">${s.value}</span>
                    </div>
                    <div class="symbol-footprint">${s.footprint || "—"}</div>
                    ${s.pins.length > 0
                        ? html`
                              <div class="symbol-pins">
                                  <div class="symbol-pins-label">Pins:</div>
                                  <div class="pin-list">
                                      ${visiblePins.map(
                                          (pin) => html`
                                              <span class="pin-item">
                                                  <span class="pin-number"
                                                      >${pin.number}</span
                                                  >
                                                  ${pin.name
                                                      ? html`<span
                                                            class="pin-name"
                                                            >:${pin.name}</span
                                                        >`
                                                      : null}
                                              </span>
                                          `,
                                      )}
                                      ${hasOverflow
                                          ? html`
                                                <button
                                                    type="button"
                                                    class="pin-toggle"
                                                    data-pin-toggle="${s.symbol
                                                        .uuid}">
                                                    ${isExpanded
                                                        ? "Show less"
                                                        : `+${remaining} more`}
                                                </button>
                                            `
                                          : null}
                                  </div>
                              </div>
                          `
                        : null}
                </div>
            `;
        });

        const connectionItems = connections.map(
            (c) => html`
                <div class="connection-item">
                    <span class="connection-endpoint">
                        <span class="connection-ref">${c.from}</span>
                        <span class="connection-pin">.${c.fromPin}</span>
                    </span>
                    <span class="connection-arrow">→</span>
                    <span class="connection-endpoint">
                        <span class="connection-ref">${c.to}</span>
                        <span class="connection-pin">.${c.toPin}</span>
                    </span>
                    ${c.netName
                        ? html`<span class="connection-net">${c.netName}</span>`
                        : null}
                </div>
            `,
        );

        return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="Zone Selection"></kc-ui-panel-title>
                <kc-ui-panel-body>
                    <div class="zone-info">
                        <div class="zone-info-label">Selection Summary</div>
                        <div class="zone-stats">
                            <div class="zone-stat">
                                <div class="zone-stat-value">
                                    ${symbols.length}
                                </div>
                                <div class="zone-stat-label">Components</div>
                            </div>
                            <div class="zone-stat">
                                <div class="zone-stat-value">
                                    ${connections.length}
                                </div>
                                <div class="zone-stat-label">Connections</div>
                            </div>
                            <div class="zone-stat">
                                <div class="zone-stat-value">${wireCount}</div>
                                <div class="zone-stat-label">Wires</div>
                            </div>
                            <div class="zone-stat">
                                <div class="zone-stat-value">${labelCount}</div>
                                <div class="zone-stat-label">Labels</div>
                            </div>
                        </div>
                    </div>

                    <div class="scrollable">
                        ${symbols.length > 0
                            ? html`
                                  <div class="symbol-list">${symbolItems}</div>
                              `
                            : null}
                        ${connections.length > 0
                            ? html`
                                  <div class="connections-section">
                                      <div class="connections-title">
                                          Connections
                                      </div>
                                      <div class="connection-list">
                                          ${connectionItems}
                                      </div>
                                  </div>
                              `
                            : null}
                    </div>
                </kc-ui-panel-body>
            </kc-ui-panel>
        `;
    }
}

window.customElements.define(
    "kc-schematic-zone-panel",
    KCSchematicZonePanelElement,
);

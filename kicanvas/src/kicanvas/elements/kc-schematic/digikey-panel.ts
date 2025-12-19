/*
    DigiKey Part Information Panel
    Shows DigiKey part data when a component is selected, including
    availability, pricing, and most importantly - obsolescence status.
    
    Now integrates with the chat system for AI-powered part replacement
    suggestions when a part is obsolete or unavailable.
*/

import { css, html } from "../../../base/web-components";
import { KCUIElement } from "../../../kc-ui";
import { SchematicSymbol } from "../../../kicad/schematic";
import {
    KiCanvasLoadEvent,
    KiCanvasSelectEvent,
} from "../../../viewers/base/events";
import { SchematicViewer } from "../../../viewers/schematic/viewer";
import type {
    DigiKeyPartInfo,
    DigiKeySearchResponse,
} from "../../services/digikey-client";
import { DigiKeyClient } from "../../services/digikey-client";
// Import chat panel for side-effect registration of the custom element
import "../chat/chat-panel";
import type { KCChatPanelElement } from "../chat/chat-panel";
import {
    partReplacementExtension,
    createPartContextFromDigiKey,
} from "../chat/extensions";
import { xaiSettings } from "../../services/xai-settings";

type SearchState = "idle" | "loading" | "success" | "error" | "not_connected";
type ConnectionState = "checking" | "connected" | "disconnected";

export class KCSchematicDigiKeyPanelElement extends KCUIElement {
    static override styles = [
        ...KCUIElement.styles,
        css`
            :host {
                display: block;
                height: 100%;
            }

            .loading {
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 2em;
                color: var(--panel-subtitle-fg);
            }

            .loading-spinner {
                width: 24px;
                height: 24px;
                border: 3px solid var(--panel-subtitle-bg);
                border-top-color: var(--accent);
                border-radius: 50%;
                animation: spin 1s linear infinite;
                margin-right: 0.5em;
            }

            @keyframes spin {
                to {
                    transform: rotate(360deg);
                }
            }

            .error-message {
                padding: 1em;
                color: #f87171;
                background: rgba(248, 113, 113, 0.1);
                border-radius: 4px;
                margin: 0.5em;
                font-size: 0.9em;
            }

            .not-configured {
                padding: 1em;
                color: #fbbf24;
                background: rgba(251, 191, 36, 0.1);
                border-radius: 4px;
                margin: 0.5em;
                font-size: 0.9em;
            }

            .part-card {
                border: 1px solid var(--panel-subtitle-bg);
                border-radius: 6px;
                margin: 0.5em;
                overflow: hidden;
            }

            .part-header {
                padding: 0.75em;
                background: var(--panel-subtitle-bg);
                display: flex;
                justify-content: space-between;
                align-items: flex-start;
                gap: 0.5em;
            }

            .part-mpn {
                font-weight: 600;
                font-size: 1.1em;
                color: var(--panel-fg);
                word-break: break-word;
            }

            .part-manufacturer {
                font-size: 0.85em;
                color: var(--panel-subtitle-fg);
                margin-top: 0.25em;
            }

            .status-badge {
                flex-shrink: 0;
                padding: 0.25em 0.5em;
                border-radius: 4px;
                font-size: 0.75em;
                font-weight: 600;
                text-transform: uppercase;
            }

            .status-active {
                background: rgba(34, 197, 94, 0.2);
                color: #22c55e;
            }

            .status-obsolete {
                background: rgba(239, 68, 68, 0.2);
                color: #ef4444;
            }

            .status-nrnd {
                background: rgba(251, 191, 36, 0.2);
                color: #fbbf24;
            }

            .status-unknown {
                background: rgba(156, 163, 175, 0.2);
                color: #9ca3af;
            }

            .status-section {
                display: flex;
                flex-direction: column;
                align-items: flex-end;
                gap: 0.25em;
                flex-shrink: 0;
            }

            .part-body {
                padding: 0.75em;
            }

            .part-description {
                font-size: 0.9em;
                color: var(--panel-fg);
                margin-bottom: 0.75em;
                line-height: 1.4;
            }

            .part-stats {
                display: grid;
                grid-template-columns: repeat(2, 1fr);
                gap: 0.5em;
                margin-bottom: 0.75em;
            }

            .stat-item {
                display: flex;
                flex-direction: column;
            }

            .stat-label {
                font-size: 0.75em;
                color: var(--panel-subtitle-fg);
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }

            .stat-value {
                font-size: 0.95em;
                font-weight: 500;
                color: var(--panel-fg);
            }

            .stat-value.in-stock {
                color: #22c55e;
            }

            .stat-value.low-stock {
                color: #fbbf24;
            }

            .stat-value.out-of-stock {
                color: #ef4444;
            }

            .part-links {
                display: flex;
                gap: 0.5em;
                flex-wrap: wrap;
            }

            .part-link {
                display: inline-flex;
                align-items: center;
                gap: 0.25em;
                padding: 0.4em 0.75em;
                background: var(--button-bg, #374151);
                color: var(--button-fg, #e5e7eb);
                text-decoration: none;
                border-radius: 4px;
                font-size: 0.85em;
                transition: background 0.15s;
            }

            .part-link:hover {
                background: var(--button-hover-bg, #4b5563);
            }

            .part-link kc-ui-icon {
                font-size: 1.1em;
            }

            .parameters-section {
                margin-top: 0.75em;
                border-top: 1px solid var(--panel-subtitle-bg);
                padding-top: 0.75em;
            }

            .parameters-title {
                font-size: 0.8em;
                color: var(--panel-subtitle-fg);
                text-transform: uppercase;
                letter-spacing: 0.05em;
                margin-bottom: 0.5em;
            }

            .parameters-grid {
                display: grid;
                gap: 0.25em;
            }

            .parameter-row {
                display: flex;
                justify-content: space-between;
                font-size: 0.85em;
                padding: 0.2em 0;
            }

            .parameter-name {
                color: var(--panel-subtitle-fg);
            }

            .parameter-value {
                color: var(--panel-fg);
                font-weight: 500;
                text-align: right;
            }

            .no-results {
                padding: 1em;
                text-align: center;
                color: var(--panel-subtitle-fg);
            }

            .part-photo {
                width: 60px;
                height: 60px;
                object-fit: contain;
                background: #fff;
                border-radius: 4px;
                margin-right: 0.75em;
            }

            .part-header-content {
                flex: 1;
                min-width: 0;
            }

            .part-header-left {
                display: flex;
                align-items: flex-start;
                flex: 1;
                min-width: 0;
            }

            .refresh-button {
                display: inline-flex;
                align-items: center;
                gap: 0.25em;
                padding: 0.4em 0.75em;
                background: var(--button-bg, #374151);
                color: var(--button-fg, #e5e7eb);
                border: none;
                border-radius: 4px;
                font-size: 0.85em;
                cursor: pointer;
                transition: background 0.15s;
            }

            .refresh-button:hover {
                background: var(--button-hover-bg, #4b5563);
            }

            .selected-part-info {
                padding: 0.5em;
                margin: 0.5em;
                background: var(--panel-subtitle-bg);
                border-radius: 4px;
                font-size: 0.9em;
            }

            .selected-part-info strong {
                color: var(--panel-fg);
            }

            /* Grok Replacement Button & Panel Styles */
            .grok-button {
                display: inline-flex;
                align-items: center;
                gap: 0.3em;
                padding: 0.2em 0.5em;
                margin-top: 0.35em;
                background: rgba(233, 69, 96, 0.15);
                border: 1px solid rgba(233, 69, 96, 0.4);
                border-radius: 4px;
                color: #e94560;
                font-size: 0.7em;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.15s ease;
            }

            .grok-button:hover {
                background: rgba(233, 69, 96, 0.25);
                border-color: #e94560;
            }

            .grok-button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .grok-button kc-ui-icon {
                font-size: 1em;
            }

            .grok-loading {
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 1.5em;
                gap: 0.75em;
            }

            .grok-loading-spinner {
                width: 32px;
                height: 32px;
                border: 3px solid #16213e;
                border-top-color: #e94560;
                border-radius: 50%;
                animation: spin 1s linear infinite;
            }

            .grok-loading-text {
                color: #e94560;
                font-size: 0.9em;
                text-align: center;
            }

            .replacement-panel {
                margin-top: 0.75em;
                border: 1px solid #0f3460;
                border-radius: 6px;
                overflow: hidden;
                background: linear-gradient(180deg, #1a1a2e 0%, #16213e 100%);
            }

            .replacement-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0.6em 0.75em;
                background: rgba(233, 69, 96, 0.1);
                border-bottom: 1px solid #0f3460;
            }

            .replacement-title {
                display: flex;
                align-items: center;
                gap: 0.5em;
                color: #e94560;
                font-weight: 600;
                font-size: 0.9em;
            }

            .replacement-close {
                background: none;
                border: none;
                color: #9ca3af;
                cursor: pointer;
                padding: 0.25em;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                transition: all 0.15s;
            }

            .replacement-close:hover {
                background: rgba(239, 68, 68, 0.2);
                color: #ef4444;
            }

            .replacement-actions {
                display: flex;
                align-items: center;
                gap: 0.25em;
            }

            .replacement-export {
                background: none;
                border: none;
                color: #9ca3af;
                cursor: pointer;
                padding: 0.25em;
                display: flex;
                align-items: center;
                justify-content: center;
                border-radius: 4px;
                transition: all 0.15s;
            }

            .replacement-export:hover {
                background: rgba(78, 205, 196, 0.2);
                color: #4ecdc4;
            }

            .replacement-body {
                padding: 0.75em;
                max-height: 400px;
                overflow-y: auto;
            }

            .replacement-content {
                font-size: 0.85em;
                line-height: 1.6;
                color: var(--panel-fg);
            }

            .replacement-content .grok-h1 {
                color: #e94560;
                margin: 0.75em 0 0.5em 0;
                font-size: 1.2em;
                font-weight: 700;
                border-bottom: 1px solid rgba(233, 69, 96, 0.3);
                padding-bottom: 0.25em;
            }

            .replacement-content .grok-h2 {
                color: #e94560;
                margin: 0.75em 0 0.4em 0;
                font-size: 1.1em;
                font-weight: 600;
            }

            .replacement-content .grok-h3 {
                color: #fbbf24;
                margin: 0.6em 0 0.3em 0;
                font-size: 1em;
                font-weight: 600;
            }

            .replacement-content .grok-h4 {
                color: #9ca3af;
                margin: 0.5em 0 0.25em 0;
                font-size: 0.95em;
                font-weight: 600;
            }

            .replacement-content .grok-h1:first-child,
            .replacement-content .grok-h2:first-child {
                margin-top: 0;
            }

            .replacement-content .grok-link {
                color: #60a5fa;
                text-decoration: none;
                border-bottom: 1px dotted rgba(96, 165, 250, 0.5);
                transition: all 0.15s;
            }

            .replacement-content .grok-link:hover {
                color: #93c5fd;
                border-bottom-color: #93c5fd;
            }

            .replacement-content .citation-link {
                color: #22c55e;
                text-decoration: none;
                font-size: 0.8em;
                font-weight: 600;
                padding: 0 0.1em;
            }

            .replacement-content .citation-link:hover {
                color: #4ade80;
                text-decoration: underline;
            }

            .replacement-content sup {
                line-height: 0;
            }

            .replacement-content ul,
            .replacement-content ol {
                margin: 0.4em 0;
                padding-left: 1.25em;
            }

            .replacement-content li {
                margin: 0.2em 0;
            }

            .replacement-content strong {
                color: #fbbf24;
            }

            .replacement-error {
                padding: 1em;
                color: #f87171;
                background: rgba(248, 113, 113, 0.1);
                border-radius: 4px;
                font-size: 0.9em;
            }

            /* Connection status styles */
            .connection-status {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 0.75em;
                margin: 0.5em;
                background: var(--panel-subtitle-bg);
                border-radius: 6px;
            }

            .connection-info {
                display: flex;
                align-items: center;
                gap: 0.5em;
            }

            .connection-dot {
                width: 8px;
                height: 8px;
                border-radius: 50%;
            }

            .connection-dot.connected {
                background: #22c55e;
                box-shadow: 0 0 6px rgba(34, 197, 94, 0.5);
            }

            .connection-dot.disconnected {
                background: #9ca3af;
            }

            .connection-dot.checking {
                background: #fbbf24;
                animation: pulse 1.5s ease-in-out infinite;
            }

            @keyframes pulse {
                0%, 100% { opacity: 1; }
                50% { opacity: 0.5; }
            }

            .connection-text {
                font-size: 0.85em;
                color: var(--panel-fg);
            }

            .connect-button {
                display: inline-flex;
                align-items: center;
                gap: 0.3em;
                padding: 0.5em 0.75em;
                background: linear-gradient(135deg, #cc0000 0%, #990000 100%);
                border: none;
                border-radius: 4px;
                color: #fff;
                font-size: 0.85em;
                font-weight: 600;
                cursor: pointer;
                transition: all 0.15s;
            }

            .connect-button:hover {
                background: linear-gradient(135deg, #dd2222 0%, #aa1111 100%);
                transform: translateY(-1px);
            }

            .disconnect-button {
                display: inline-flex;
                align-items: center;
                gap: 0.25em;
                padding: 0.4em 0.6em;
                background: transparent;
                border: 1px solid var(--panel-subtitle-fg);
                border-radius: 4px;
                color: var(--panel-subtitle-fg);
                font-size: 0.8em;
                cursor: pointer;
                transition: all 0.15s;
            }

            .disconnect-button:hover {
                border-color: #ef4444;
                color: #ef4444;
            }

            .digikey-logo {
                height: 16px;
                margin-right: 0.25em;
            }
        `,
    ];

    viewer: SchematicViewer;
    selected_item?: SchematicSymbol;
    search_state: SearchState = "idle";
    search_result?: DigiKeySearchResponse;
    connection_state: ConnectionState = "checking";
    
    // Grok replacement chat panel
    private _chatPanel: KCChatPanelElement | null = null;
    private _chatPanelInitialized = false;

    override connectedCallback() {
        (async () => {
            this.viewer = await this.requestLazyContext("viewer");
            await this.viewer.loaded;
            super.connectedCallback();
            this.setup_events();
            this.check_oauth_callback();
            await this.check_connection();
        })();
    }

    override disconnectedCallback() {
        super.disconnectedCallback();
        // Cleanup chat panel if it exists
        if (this._chatPanel) {
            this._chatPanel.remove();
            this._chatPanel = null;
        }
    }

    private check_oauth_callback() {
        // Check if we just returned from OAuth flow
        const result = DigiKeyClient.checkOAuthCallback();
        if (result) {
            if (result.connected) {
                console.log("[DigiKey] Successfully connected");
            } else if (result.error) {
                console.error("[DigiKey] OAuth error:", result.error, result.description);
            }
        }
    }

    private async check_connection() {
        this.connection_state = "checking";
        this.update();

        const status = await DigiKeyClient.getStatus();
        this.connection_state = status.connected ? "connected" : "disconnected";
        
        if (!status.connected) {
            this.search_state = "not_connected";
        }
        this.update();
    }

    private handle_connect() {
        DigiKeyClient.login();
    }

    private async handle_disconnect() {
        await DigiKeyClient.logout();
        this.connection_state = "disconnected";
        this.search_state = "not_connected";
        this.search_result = undefined;
        this.update();
    }

    override renderedCallback() {
        // Bind retry button click after each render
        const retryBtn = this.renderRoot.querySelector("#retry-btn");
        if (retryBtn) {
            retryBtn.addEventListener("click", () => this.search_for_part());
        }

        // Bind connect button
        const connectBtn = this.renderRoot.querySelector(".connect-button");
        if (connectBtn) {
            connectBtn.addEventListener("click", () => this.handle_connect());
        }

        // Bind disconnect button
        const disconnectBtn = this.renderRoot.querySelector(".disconnect-button");
        if (disconnectBtn) {
            disconnectBtn.addEventListener("click", () => this.handle_disconnect());
        }

        // Bind grok replacement button
        const grokBtn = this.renderRoot.querySelector(".grok-button");
        if (grokBtn) {
            grokBtn.addEventListener("click", () => this.show_replacement_chat());
        }
    }

    /**
     * Show the AI chat panel for finding part replacements.
     */
    private async show_replacement_chat() {
        if (!this.search_result?.parts?.[0]) return;
        
        const part = this.search_result.parts[0];
        const reference = this.selected_item?.reference;
        
        // Ensure the custom element is defined before creating it
        await customElements.whenDefined("kc-chat-panel");
        
        // Create or get the chat panel
        if (!this._chatPanel || !this._chatPanel.isConnected) {
            // Remove any stale panels
            document.querySelectorAll("kc-chat-panel").forEach(el => el.remove());
            
            this._chatPanel = document.createElement("kc-chat-panel") as KCChatPanelElement;
            document.body.appendChild(this._chatPanel);
            
            // Wait for element to be upgraded and ready
            await new Promise(resolve => requestAnimationFrame(resolve));
            
            this._chatPanel.configure({
                title: "Find Replacement",
                logoSrc: "./images/Grok_Logomark_Light.png",
                draggable: true,
                dockable: true,
                showThinkingToggle: true,
                showPresets: true,
                showContextItems: false,
                placeholder: "Ask about replacement options...",
            });
            
            this._chatPanelInitialized = false;
        }

        // Set up the extension with part context
        const context = createPartContextFromDigiKey(part, reference);
        
        if (!this._chatPanelInitialized) {
            await this._chatPanel.setExtension(partReplacementExtension, context);
            this._chatPanelInitialized = true;
        } else {
            // Update context for the current part
            this._chatPanel.updateContext(context);
            this._chatPanel.clearConversation();
        }

        // Update presets based on the extension
        const presets = partReplacementExtension.getPresets(context);
        this._chatPanel.setPresets(presets);

        // Show the panel
        this._chatPanel.show();
    }

    /**
     * Check if the xAI API is configured.
     */
    private is_xai_configured(): boolean {
        return xaiSettings.isConfigured;
    }

    /**
     * Render the Grok replacement button for parts that need replacement.
     */
    private render_grok_button(part: DigiKeyPartInfo) {
        // Show button for obsolete, NRND, or out-of-stock parts
        const shouldShow = 
            part.is_obsolete ||
            part.lifecycle_status?.toLowerCase().includes("not recommended") ||
            part.quantity_available === 0;

        if (!shouldShow) {
            return "";
        }

        // If xAI is not configured, show disabled state
        if (!this.is_xai_configured()) {
            return html`
                <button class="grok-button" disabled title="Configure xAI API key to find replacements">
                    <kc-ui-icon>find_replace</kc-ui-icon>
                    Find Replacement
                </button>
            `;
        }

        return html`
            <button class="grok-button" title="Find AI-powered replacement suggestions">
                <kc-ui-icon>find_replace</kc-ui-icon>
                Find Replacement
            </button>
        `;
    }

    private setup_events() {
        this.addDisposable(
            this.viewer.addEventListener(KiCanvasSelectEvent.type, (e) => {
                const item = e.detail.item;
                if (item instanceof SchematicSymbol) {
                    this.selected_item = item;
                    if (this.connection_state === "connected") {
                        this.search_for_part();
                    }
                } else {
                    this.selected_item = undefined;
                    this.search_result = undefined;
                    this.search_state = this.connection_state === "connected"
                        ? "idle"
                        : "not_connected";
                }
                this.update();
            }),
        );

        this.addDisposable(
            this.viewer.addEventListener(KiCanvasLoadEvent.type, () => {
                this.selected_item = undefined;
                this.search_result = undefined;
                this.search_state = this.connection_state === "connected"
                    ? "idle"
                    : "not_connected";
                this.update();
            }),
        );
    }

    private async search_for_part() {
        if (!this.selected_item || this.connection_state !== "connected") return;

        // Try to extract a useful search query from the component
        const mpn = this.extract_mpn(this.selected_item);
        if (!mpn) {
            this.search_state = "idle";
            this.search_result = undefined;
            this.update();
            return;
        }

        this.search_state = "loading";
        this.update();

        try {
            // Search by MPN first for better results
            this.search_result = await DigiKeyClient.search(mpn, mpn);

            if (this.search_result.success) {
                this.search_state = "success";
            } else {
                // Check if it's an auth error
                if (this.search_result.error?.includes("Not authenticated") ||
                    this.search_result.error?.includes("Session expired")) {
                    this.connection_state = "disconnected";
                    this.search_state = "not_connected";
                } else {
                    this.search_state = "error";
                }
            }
        } catch {
            this.search_state = "error";
            this.search_result = {
                query: mpn,
                success: false,
                error: "Failed to search DigiKey",
                parts: [],
                total_count: 0,
            };
        }

        this.update();
    }

    private extract_mpn(symbol: SchematicSymbol): string | null {
        // Try common property names for manufacturer part number
        const mpn_properties = [
            "MPN",
            "Manufacturer Part Number",
            "PartNumber",
            "Part Number",
            "Part_Number",
            "Part",
            "Value",
            "Mfr. #",
            "Mfr Part #",
        ];

        for (const prop_name of mpn_properties) {
            const prop = symbol.properties.get(prop_name);
            if (prop?.text && prop.text.trim() && prop.text !== "~") {
                return prop.text.trim();
            }
        }

        // Fall back to lib_id or lib_name if no MPN found
        if (symbol.lib_name && symbol.lib_name !== "~") {
            return symbol.lib_name;
        }

        return null;
    }

    private get_status_class(part: DigiKeyPartInfo): string {
        if (part.is_obsolete) return "status-obsolete";
        const status = (part.product_status || "").toLowerCase();
        if (
            status.includes("active") ||
            status.includes("in production")
        ) {
            return "status-active";
        }
        if (
            status.includes("not recommended") ||
            status.includes("nrnd") ||
            status.includes("last time buy")
        ) {
            return "status-nrnd";
        }
        return "status-unknown";
    }

    private get_status_text(part: DigiKeyPartInfo): string {
        if (part.is_obsolete) return "Obsolete";
        const status = part.lifecycle_status || part.product_status;
        if (!status) return "Unknown";
        // Shorten common statuses
        if (status.toLowerCase().includes("active")) return "Active";
        if (status.toLowerCase().includes("not recommended"))
            return "NRND";
        return status;
    }

    private get_stock_class(qty: number | null): string {
        if (qty === null) return "";
        if (qty === 0) return "out-of-stock";
        if (qty < 100) return "low-stock";
        return "in-stock";
    }

    private format_price(price: number | null): string {
        if (price === null) return "—";
        return `$${price.toFixed(4)}`;
    }

    private format_stock(qty: number | null): string {
        if (qty === null) return "—";
        if (qty === 0) return "Out of Stock";
        return qty.toLocaleString();
    }

    private render_connection_status() {
        const dotClass = this.connection_state;
        const statusText = this.connection_state === "checking" ? "Checking..." :
                          this.connection_state === "connected" ? "Connected" : "Not connected";

        return html`
            <div class="connection-status">
                <div class="connection-info">
                    <span class="connection-dot ${dotClass}"></span>
                    <span class="connection-text">${statusText}</span>
                </div>
                ${this.connection_state === "connected"
                    ? html`
                        <button class="disconnect-button">
                            <kc-ui-icon>logout</kc-ui-icon>
                            Disconnect
                        </button>
                    `
                    : this.connection_state === "disconnected"
                    ? html`
                        <button class="connect-button">
                            Connect DigiKey
                        </button>
                    `
                    : ""
                }
            </div>
        `;
    }

    private render_part_card(part: DigiKeyPartInfo) {
        const important_params = part.parameters.slice(0, 6);

        return html`
            <div class="part-card">
                <div class="part-header">
                    <div class="part-header-left">
                        ${part.photo_url
                            ? html`<img
                                  class="part-photo"
                                  src="${part.photo_url}"
                                  alt="${part.manufacturer_part_number || ""}"
                                  loading="lazy" />`
                            : ""}
                        <div class="part-header-content">
                            <div class="part-mpn">
                                ${part.manufacturer_part_number ||
                                part.digikey_part_number ||
                                "Unknown Part"}
                            </div>
                            <div class="part-manufacturer">
                                ${part.manufacturer || "Unknown Manufacturer"}
                            </div>
                        </div>
                    </div>
                    <div class="status-section">
                        <span
                            class="status-badge ${this.get_status_class(part)}">
                            ${this.get_status_text(part)}
                        </span>
                        ${this.render_grok_button(part)}
                    </div>
                </div>
                <div class="part-body">
                    ${part.description
                        ? html`<div class="part-description">
                              ${part.description}
                          </div>`
                        : ""}

                    <div class="part-stats">
                        <div class="stat-item">
                            <span class="stat-label">Unit Price</span>
                            <span class="stat-value">
                                ${this.format_price(part.unit_price)}
                            </span>
                        </div>
                        <div class="stat-item">
                            <span class="stat-label">In Stock</span>
                            <span
                                class="stat-value ${this.get_stock_class(
                                    part.quantity_available,
                                )}">
                                ${this.format_stock(part.quantity_available)}
                            </span>
                        </div>
                        ${part.category
                            ? html`
                                  <div class="stat-item">
                                      <span class="stat-label">Category</span>
                                      <span class="stat-value"
                                          >${part.category}</span
                                      >
                                  </div>
                              `
                            : ""}
                        ${part.digikey_part_number
                            ? html`
                                  <div class="stat-item">
                                      <span class="stat-label">DigiKey #</span>
                                      <span class="stat-value"
                                          >${part.digikey_part_number}</span
                                      >
                                  </div>
                              `
                            : ""}
                    </div>

                    <div class="part-links">
                        ${part.product_url
                            ? html`<a
                                  class="part-link"
                                  href="${part.product_url}"
                                  target="_blank"
                                  rel="noopener noreferrer">
                                  <kc-ui-icon>open_in_new</kc-ui-icon>
                                  DigiKey Page
                              </a>`
                            : ""}
                        ${part.datasheet_url
                            ? html`<a
                                  class="part-link"
                                  href="${part.datasheet_url}"
                                  target="_blank"
                                  rel="noopener noreferrer">
                                  <kc-ui-icon>description</kc-ui-icon>
                                  Datasheet
                              </a>`
                            : ""}
                    </div>

                    ${important_params.length > 0
                        ? html`
                              <div class="parameters-section">
                                  <div class="parameters-title">
                                      Key Specifications
                                  </div>
                                  <div class="parameters-grid">
                                      ${important_params.map(
                                          (p) => html`
                                              <div class="parameter-row">
                                                  <span class="parameter-name"
                                                      >${p.name}</span
                                                  >
                                                  <span class="parameter-value"
                                                      >${p.value}</span
                                                  >
                                              </div>
                                          `,
                                      )}
                                  </div>
                              </div>
                          `
                        : ""}
                </div>
            </div>
        `;
    }

    override render() {
        let content;

        switch (this.search_state) {
            case "not_connected":
                content = html`
                    ${this.render_connection_status()}
                    <div class="not-configured">
                        <strong>Connect Your DigiKey Account</strong>
                        <p>
                            Connect your DigiKey account to look up part
                            information, check availability, and view pricing.
                        </p>
                        <p style="font-size: 0.85em; margin-top: 0.75em; opacity: 0.8;">
                            Your DigiKey credentials are stored securely and
                            used only to access the DigiKey API on your behalf.
                        </p>
                    </div>
                `;
                break;

            case "loading":
                content = html`
                    ${this.render_connection_status()}
                    <div class="loading">
                        <div class="loading-spinner"></div>
                        Searching DigiKey...
                    </div>
                `;
                break;

            case "error":
                content = html`
                    ${this.render_connection_status()}
                    <div class="error-message">
                        <strong>Search Error</strong>
                        <p>${this.search_result?.error || "Unknown error"}</p>
                        <button class="refresh-button" id="retry-btn">
                            <kc-ui-icon>refresh</kc-ui-icon>
                            Retry
                        </button>
                    </div>
                `;
                break;

            case "success":
                if (
                    !this.search_result ||
                    this.search_result.parts.length === 0
                ) {
                    content = html`
                        ${this.render_connection_status()}
                        <div class="no-results">
                            <p>No parts found for "${this.search_result?.query}"</p>
                            <p style="font-size: 0.85em; margin-top: 0.5em;">
                                Try checking if the part number is correct
                            </p>
                        </div>
                    `;
                } else {
                    content = html`
                        ${this.render_connection_status()}
                        ${this.search_result.parts.map((p) =>
                            this.render_part_card(p),
                        )}
                    `;
                }
                break;

            default:
                if (this.selected_item) {
                    const mpn = this.extract_mpn(this.selected_item);
                    if (!mpn) {
                        content = html`
                            ${this.render_connection_status()}
                            <div class="no-results">
                                <p>No part number found for this component</p>
                                <p style="font-size: 0.85em; margin-top: 0.5em;">
                                    Add an MPN or Value property to enable
                                    DigiKey lookup
                                </p>
                            </div>
                        `;
                    } else {
                        // Component with MPN selected but search not yet started
                        content = html`
                            ${this.render_connection_status()}
                            <div class="loading">
                                <div class="loading-spinner"></div>
                                Preparing search...
                            </div>
                        `;
                    }
                } else {
                    content = html`
                        ${this.render_connection_status()}
                        <kc-ui-property-list>
                            <kc-ui-property-list-item
                                class="label"
                                name="Select a component to look up on DigiKey">
                            </kc-ui-property-list-item>
                        </kc-ui-property-list>
                    `;
                }
        }

        return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="DigiKey"></kc-ui-panel-title>
                <kc-ui-panel-body>${content}</kc-ui-panel-body>
            </kc-ui-panel>
        `;
    }
}

window.customElements.define(
    "kc-schematic-digikey-panel",
    KCSchematicDigiKeyPanelElement,
);

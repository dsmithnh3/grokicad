/*
    Chat Panel - Generic, extensible AI chat panel component.
    
    This component provides a production-ready chat interface that can be
    extended for different use cases (schematic analysis, part replacement, etc.)
*/

import { attribute, html, type ElementOrFragment } from "../../../base/web-components";
import { KCUIElement } from "../../../kc-ui";
import { delegate } from "../../../base/events";
import { chatPanelStyles } from "./styles";
import { ChatService } from "./chat-service";
import { formatMarkdown } from "../../services/markdown-formatter";
import type {
    ChatExtension,
    ChatContext,
    ChatMessage,
    ChatPanelConfig,
    PresetGroup,
    ContextItem,
} from "./types";

/**
 * Generic AI Chat Panel Component.
 * 
 * Usage:
 * ```html
 * <kc-chat-panel visible></kc-chat-panel>
 * ```
 * 
 * Configure via JavaScript:
 * ```js
 * const panel = document.querySelector('kc-chat-panel');
 * panel.setExtension(myExtension, myContext);
 * panel.configure({ title: 'My Assistant' });
 * ```
 */
export class KCChatPanelElement extends KCUIElement {
    static override styles = [...KCUIElement.styles, ...chatPanelStyles];

    // =========================================================================
    // Attributes
    // =========================================================================

    @attribute({ type: Boolean })
    visible: boolean = false;

    @attribute({ type: Boolean })
    streaming: boolean = false;

    @attribute({ type: String })
    logoSrc: string = "";

    // =========================================================================
    // State
    // =========================================================================

    private _service: ChatService;
    private _config: ChatPanelConfig = {};
    private _presets: PresetGroup[] = [];
    private _contextItems: ContextItem[] = [];
    private _inputValue: string = "";
    private _thinkingMode: boolean = false;
    private _presetsCollapsed: boolean = false;
    private _streamingContent: string = "";
    private _thinkingContent: string = "";
    private _isLoading: boolean = false;
    private _error: string | null = null;
    private _isInitialized: boolean = false;
    private _updatePending: boolean = false;

    // Dragging state
    private _isDocked: boolean = false;
    private _isDragging: boolean = false;
    private _dragStartX: number = 0;
    private _dragStartY: number = 0;
    private _panelStartX: number = 0;
    private _panelStartY: number = 0;

    constructor() {
        super();
        this._service = new ChatService();
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    override connectedCallback() {
        super.connectedCallback();
    }

    override initialContentCallback() {
        this._setupEventListeners();
        requestAnimationFrame(() => {
            this._isInitialized = true;
        });
    }

    override renderedCallback() {
        // Sync input value
        const input = this.renderRoot.querySelector(".query-input") as HTMLTextAreaElement;
        if (input && input.value !== this._inputValue) {
            input.value = this._inputValue;
        }

        // Keep streaming content updated
        if (this._streamingContent && this.streaming) {
            const streamingEl = this.renderRoot.querySelector(".streaming-response");
            if (streamingEl) {
                streamingEl.innerHTML = this._formatContent(this._streamingContent) + 
                    '<span class="cursor"></span>';
                this._scrollToBottom();
            }
        }
    }

    override disconnectedCallback() {
        super.disconnectedCallback();
        this._service.dispose();
    }

    // =========================================================================
    // Public API
    // =========================================================================

    /**
     * Set the extension that provides context and presets.
     */
    async setExtension(extension: ChatExtension, context?: ChatContext): Promise<void> {
        await this._service.setExtension(extension, context);
        
        if (context?.selectedItems) {
            this._contextItems = context.selectedItems;
        }
        
        this._refreshPresets();
        this._scheduleUpdate();
    }

    /**
     * Update the chat context.
     */
    updateContext(context: Partial<ChatContext>): void {
        this._service.updateContext(context);
        
        if (context.selectedItems) {
            this._contextItems = context.selectedItems;
        }
        
        this._refreshPresets();
        this._scheduleUpdate();
    }

    /**
     * Configure the panel appearance and behavior.
     */
    configure(config: ChatPanelConfig): void {
        this._config = { ...this._config, ...config };
        
        if (config.logoSrc) {
            this.logoSrc = config.logoSrc;
        }
        
        this._scheduleUpdate();
    }

    /**
     * Show the panel.
     */
    show(): void {
        if (this.visible) return;
        this.visible = true;
        this._refreshPresets();
        this.dispatchEvent(new CustomEvent("chat-show", { bubbles: true, composed: true }));
    }

    /**
     * Hide the panel.
     */
    hide(): void {
        if (!this.visible) return;
        this.visible = false;
        this.dispatchEvent(new CustomEvent("chat-hide", { bubbles: true, composed: true }));
    }

    /**
     * Toggle panel visibility.
     */
    toggle(): void {
        if (this.visible) {
            this.hide();
        } else {
            this.show();
        }
    }

    /**
     * Add context items.
     */
    addContextItem(item: ContextItem): void {
        if (!this._contextItems.find(i => i.id === item.id)) {
            this._contextItems = [...this._contextItems, item];
            this._service.updateContext({ selectedItems: this._contextItems });
            this._refreshPresets();
            this._scheduleUpdate();
        }
    }

    /**
     * Remove a context item.
     */
    removeContextItem(id: string): void {
        this._contextItems = this._contextItems.filter(i => i.id !== id);
        this._service.updateContext({ selectedItems: this._contextItems });
        this._refreshPresets();
        this._scheduleUpdate();
    }

    /**
     * Set context items.
     */
    setContextItems(items: ContextItem[]): void {
        this._contextItems = items;
        this._service.updateContext({ selectedItems: this._contextItems });
        this._refreshPresets();
        this._scheduleUpdate();
    }

    /**
     * Clear the conversation.
     */
    clearConversation(): void {
        this._service.clearMessages();
        this._streamingContent = "";
        this._thinkingContent = "";
        this._error = null;
        this._scheduleUpdate();
        this.dispatchEvent(new CustomEvent("chat-clear", { bubbles: true, composed: true }));
    }

    /**
     * Send a query programmatically.
     */
    async sendQuery(query: string): Promise<void> {
        await this._submitQuery(query);
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private _scheduleUpdate(): void {
        if (this._updatePending) return;
        this._updatePending = true;
        
        requestAnimationFrame(() => {
            if (this._updatePending && this._isInitialized) {
                this._updatePending = false;
                super.update();
            } else {
                this._updatePending = false;
            }
        });
    }

    private _refreshPresets(): void {
        // Extension will provide presets based on current context
        // For now, presets are set by the extension when context changes
    }

    private async _submitQuery(overrideQuery?: string): Promise<void> {
        const query = (overrideQuery ?? this._inputValue).trim();
        if (!query || this.streaming || this._isLoading) return;

        this._inputValue = "";
        this._isLoading = true;
        this._error = null;
        this.streaming = true;
        this._streamingContent = "";
        this._thinkingContent = "";
        
        this._scheduleUpdate();

        this.dispatchEvent(new CustomEvent("chat-send", {
            bubbles: true,
            composed: true,
            detail: { query, context: this._service.context },
        }));

        await this._service.streamQuery(
            query,
            {
                onStart: () => {
                    this._isLoading = false;
                    this._scheduleUpdate();
                    
                    this.dispatchEvent(new CustomEvent("chat-stream-start", {
                        bubbles: true,
                        composed: true,
                        detail: { messageId: "" },
                    }));
                },
                onChunk: (content, isThinking) => {
                    if (isThinking) {
                        this._thinkingContent += content;
                    } else {
                        this._streamingContent = content;
                    }
                    
                    // Update DOM directly for performance
                    const streamingEl = this.renderRoot.querySelector(".streaming-response");
                    if (streamingEl) {
                        streamingEl.innerHTML = this._formatContent(this._streamingContent) + 
                            '<span class="cursor"></span>';
                        this._scrollToBottom();
                    } else {
                        this._scheduleUpdate();
                    }
                },
                onComplete: (fullContent, thinkingContent) => {
                    this.streaming = false;
                    this._streamingContent = "";
                    this._thinkingContent = "";
                    this._scheduleUpdate();
                    
                    this.dispatchEvent(new CustomEvent("chat-stream-complete", {
                        bubbles: true,
                        composed: true,
                        detail: { messageId: "", content: fullContent },
                    }));
                },
                onError: (error) => {
                    this._isLoading = false;
                    this.streaming = false;
                    this._error = error;
                    this._scheduleUpdate();
                    
                    this.dispatchEvent(new CustomEvent("chat-error", {
                        bubbles: true,
                        composed: true,
                        detail: { error },
                    }));
                },
            },
            this._thinkingMode,
        );
    }

    private _formatContent(content: string): string {
        return formatMarkdown(content);
    }

    private _scrollToBottom(): void {
        const scrollArea = this.renderRoot.querySelector(".conversation-scroll");
        if (scrollArea) {
            scrollArea.scrollTop = scrollArea.scrollHeight;
        }
    }

    private _setupEventListeners(): void {
        const root = this.renderRoot;

        // Close button
        this.addDisposable(
            delegate(root, ".close-button", "click", () => {
                this.hide();
            }),
        );

        // Clear button
        this.addDisposable(
            delegate(root, ".clear-button", "click", () => {
                this.clearConversation();
            }),
        );

        // Send button
        this.addDisposable(
            delegate(root, ".send-button", "click", () => {
                this._submitQuery();
            }),
        );

        // Dock button
        this.addDisposable(
            delegate(root, ".dock-button", "click", () => {
                this._dock();
            }),
        );

        // Docked tab
        this.addDisposable(
            delegate(root, ".docked-tab", "click", () => {
                this._undock();
            }),
        );

        // Draggable header
        this.addDisposable(
            delegate(root, ".chat-header.draggable", "mousedown", (e) => {
                this._startDrag(e as MouseEvent);
            }),
        );

        // Presets toggle
        this.addDisposable(
            delegate(root, ".presets-toggle", "click", () => {
                this._presetsCollapsed = !this._presetsCollapsed;
                this._scheduleUpdate();
            }),
        );

        // Thinking toggle
        this.addDisposable(
            delegate(root, ".thinking-toggle", "click", () => {
                this._thinkingMode = !this._thinkingMode;
                this._scheduleUpdate();
            }),
        );

        // Preset cards
        this.addDisposable(
            delegate(root, ".preset-card", "click", (e, source) => {
                if (source.classList.contains("disabled") || this.streaming || this._isLoading) {
                    return;
                }
                const presetId = source.getAttribute("data-preset-id");
                if (presetId) {
                    this._handlePresetClick(presetId);
                }
            }),
        );

        // Context item remove
        this.addDisposable(
            delegate(root, ".context-item-remove", "click", (e, source) => {
                e.stopPropagation();
                const item = source.closest(".context-item");
                const id = item?.getAttribute("data-id");
                if (id) {
                    this.removeContextItem(id);
                }
            }),
        );

        // Input handling
        this.addDisposable(
            delegate(root, ".query-input", "input", (e) => {
                const input = e.target as HTMLTextAreaElement;
                this._inputValue = input.value;
                this._autoResizeInput(input);
            }),
        );

        // Enter to send (shift+enter for newline)
        this.addDisposable(
            delegate(root, ".query-input", "keydown", (e) => {
                const event = e as KeyboardEvent;
                if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    this._submitQuery();
                }
            }),
        );
    }

    private _handlePresetClick(presetId: string): void {
        // Find the preset in all groups
        for (const group of this._presets) {
            const preset = group.presets.find(p => p.id === presetId);
            if (preset) {
                this._submitQuery(preset.query);
                break;
            }
        }
    }

    private _autoResizeInput(input: HTMLTextAreaElement): void {
        input.style.height = "auto";
        input.style.height = Math.min(input.scrollHeight, 120) + "px";
    }

    // =========================================================================
    // Dragging & Docking
    // =========================================================================

    private _dock(): void {
        this._isDocked = true;
        this._scheduleUpdate();
    }

    private _undock(): void {
        this._isDocked = false;
        this._scheduleUpdate();
    }

    private _startDrag(e: MouseEvent): void {
        if ((e.target as HTMLElement).closest(".header-button")) return;
        
        this._isDragging = true;
        this._dragStartX = e.clientX;
        this._dragStartY = e.clientY;
        
        const rect = this.getBoundingClientRect();
        this._panelStartX = rect.left;
        this._panelStartY = rect.top;

        const onMove = (e: MouseEvent) => this._onDrag(e);
        const onUp = () => this._endDrag(onMove, onUp);

        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
        
        this._scheduleUpdate();
    }

    private _onDrag(e: MouseEvent): void {
        if (!this._isDragging) return;

        const dx = e.clientX - this._dragStartX;
        const dy = e.clientY - this._dragStartY;

        const newX = this._panelStartX + dx;
        const newY = this._panelStartY + dy;

        this.style.left = `${newX}px`;
        this.style.top = `${newY}px`;
        this.style.right = "auto";
        this.style.bottom = "auto";

        // Check for dock hint
        if (window.innerWidth - e.clientX < 50) {
            this.classList.add("dock-hint");
        } else {
            this.classList.remove("dock-hint");
        }
    }

    private _endDrag(onMove: (e: MouseEvent) => void, onUp: () => void): void {
        if (this.classList.contains("dock-hint")) {
            this._dock();
            this.classList.remove("dock-hint");
            // Reset position
            this.style.left = "";
            this.style.top = "";
            this.style.right = "";
            this.style.bottom = "";
        }

        this._isDragging = false;
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        this._scheduleUpdate();
    }

    // =========================================================================
    // Rendering
    // =========================================================================

    private _renderHeader(): ElementOrFragment {
        const title = this._config.title ?? "AI Assistant";
        const draggable = this._config.draggable !== false;

        return html`
            <div class="chat-header ${draggable ? "draggable" : ""}">
                <div class="header-left">
                    ${this.logoSrc
                        ? html`<img class="header-logo" src="${this.logoSrc}" alt="" />`
                        : ""}
                    <span class="header-title">${title}</span>
                </div>
                <div class="header-right">
                    <button class="header-button clear-button" title="Clear conversation">
                        <kc-ui-icon>delete_sweep</kc-ui-icon>
                    </button>
                    ${this._config.dockable !== false
                        ? html`
                            <button class="header-button dock-button" title="Dock panel">
                                <kc-ui-icon>dock_to_right</kc-ui-icon>
                            </button>
                        `
                        : ""}
                    <button class="header-button close-button" title="Close">
                        <kc-ui-icon>close</kc-ui-icon>
                    </button>
                </div>
            </div>
        `;
    }

    private _renderContextItems(): ElementOrFragment | string {
        if (this._config.showContextItems === false || this._contextItems.length === 0) {
            return html``;
        }

        return html`
            <div class="context-section">
                <div class="context-header">
                    <span class="context-label">Context</span>
                    <span class="context-count">${this._contextItems.length}</span>
                </div>
                <div class="context-items">
                    ${this._contextItems.map(item => html`
                        <div class="context-item" data-id="${item.id}" title="${item.type}">
                            <span>${item.label}</span>
                            <button class="context-item-remove" title="Remove">
                                <kc-ui-icon>close</kc-ui-icon>
                            </button>
                        </div>
                    `)}
                </div>
            </div>
        `;
    }

    private _renderPresets(): ElementOrFragment | string {
        if (this._config.showPresets === false || this._presets.length === 0) {
            return html``;
        }

        const hasContext = this._contextItems.length > 0;

        return html`
            <div class="presets-section">
                <div class="presets-header">
                    <span class="presets-label">Quick Actions</span>
                    <button class="presets-toggle">
                        <kc-ui-icon>${this._presetsCollapsed ? "expand_more" : "expand_less"}</kc-ui-icon>
                    </button>
                </div>
                ${!this._presetsCollapsed
                    ? html`
                        ${this._presets.map(group => html`
                            <div class="preset-group">
                                ${group.label
                                    ? html`<div class="preset-group-label">${group.label}</div>`
                                    : ""}
                                <div class="preset-cards">
                                    ${group.presets.map(preset => {
                                        const disabled = preset.requiresContext && !hasContext;
                                        const enabled = !preset.isEnabled || 
                                            preset.isEnabled(this._service.context);
                                        
                                        return html`
                                            <button
                                                class="preset-card ${disabled || !enabled ? "disabled" : ""}"
                                                data-preset-id="${preset.id}"
                                                title="${preset.description}"
                                                ?disabled=${disabled || !enabled}>
                                                <kc-ui-icon class="preset-icon">${preset.icon}</kc-ui-icon>
                                                <span class="preset-title">${preset.title}</span>
                                            </button>
                                        `;
                                    })}
                                </div>
                            </div>
                        `)}
                    `
                    : ""}
            </div>
        `;
    }

    private _renderMessages(): ElementOrFragment {
        const messages = this._service.messages;

        if (messages.length === 0 && !this.streaming && !this._isLoading) {
            return html`
                <div class="empty-state">
                    <kc-ui-icon>chat_bubble_outline</kc-ui-icon>
                    <p class="empty-state-text">
                        ${this._config.placeholder ?? "Ask a question or select a quick action above."}
                    </p>
                </div>
            `;
        }

        return html`
            <div class="conversation-scroll">
                ${messages.map(msg => this._renderMessage(msg))}
                ${this.streaming && this._streamingContent
                    ? html`
                        ${this._thinkingMode && this._thinkingContent
                            ? html`
                                <div class="thinking-indicator">
                                    <kc-ui-icon>psychology</kc-ui-icon>
                                    <span>Thinking...</span>
                                </div>
                            `
                            : ""}
                        <div class="message message-assistant">
                            <div class="message-content streaming-response"></div>
                        </div>
                    `
                    : ""}
                ${this._isLoading
                    ? html`
                        <div class="loading-indicator">
                            <div class="loading-spinner"></div>
                            <span class="loading-text">Preparing response...</span>
                        </div>
                    `
                    : ""}
                ${this._error
                    ? html`
                        <div class="message message-error">
                            <div class="message-content">${this._error}</div>
                        </div>
                    `
                    : ""}
            </div>
        `;
    }

    private _renderMessage(msg: ChatMessage): ElementOrFragment {
        if (msg.error) {
            return html`
                <div class="message message-error">
                    <div class="message-content">${msg.error}</div>
                </div>
            `;
        }

        const contentHtml = this._formatContent(msg.content);

        return html`
            <div class="message message-${msg.role}">
                <div class="message-content" .innerHTML="${contentHtml}"></div>
            </div>
        `;
    }

    private _renderInput(): ElementOrFragment {
        const disabled = this.streaming || this._isLoading;
        const showThinking = this._config.showThinkingToggle !== false;
        const placeholder = this._config.placeholder ?? "Type a message...";

        return html`
            <div class="chat-input-area ${disabled ? "disabled" : ""}">
                ${showThinking
                    ? html`
                        <div class="input-row">
                            <button
                                class="thinking-toggle ${this._thinkingMode ? "active" : ""}"
                                ?disabled=${disabled}
                                title="Enable thinking mode for more detailed analysis">
                                <kc-ui-icon>psychology</kc-ui-icon>
                                <span>Think</span>
                            </button>
                        </div>
                    `
                    : ""}
                <div class="chat-input-container ${disabled ? "disabled" : ""}">
                    <textarea
                        class="query-input"
                        placeholder="${placeholder}"
                        rows="1"
                        ?disabled=${disabled}></textarea>
                    <button
                        class="send-button"
                        ?disabled=${disabled || !this._inputValue.trim()}
                        title="Send message">
                        <kc-ui-icon>send</kc-ui-icon>
                    </button>
                </div>
            </div>
        `;
    }

    override render(): ElementOrFragment {
        if (this._isDocked) {
            return html`
                <div class="docked-tab" title="Click to expand">
                    ${this.logoSrc
                        ? html`<img class="docked-logo" src="${this.logoSrc}" alt="" />`
                        : html`<kc-ui-icon>chat</kc-ui-icon>`}
                </div>
            `;
        }

        return html`
            <div class="chat-container ${this._isDragging ? "dragging" : ""}">
                ${this._renderHeader()}
                <div class="chat-body">
                    ${this._renderContextItems()}
                    ${this._renderPresets()}
                    <div class="conversation-section">
                        ${this._renderMessages()}
                    </div>
                    ${this._renderInput()}
                </div>
            </div>
        `;
    }

    /**
     * Set presets programmatically.
     */
    setPresets(presets: PresetGroup[]): void {
        this._presets = presets;
        this._scheduleUpdate();
    }
}

// Register the component
window.customElements.define("kc-chat-panel", KCChatPanelElement);


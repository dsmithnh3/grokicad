/*
    Chat Panel - Generic, extensible AI chat panel component.
    
    Features:
    - Extensible with plugins for different use cases
    - Chat history persistence with localStorage
    - Markdown export for conversations
    - Docked tab mode (default) and expanded panel mode
    - Overlay/fullscreen mode for focused interaction
*/

import {
    attribute,
    html,
    type ElementOrFragment,
} from "../../../base/web-components";
import { KCUIElement } from "../../../kc-ui";
import { delegate } from "../../../base/events";
import { chatPanelStyles, overlayStyles, historyPanelStyles } from "./styles";
import { ChatService } from "./chat-service";
import { formatMarkdown } from "../../services/markdown-formatter";
import {
    schematicExtension,
    createSchematicContextItem,
} from "./extensions/schematic-extension";
import {
    KiCanvasSelectEvent,
    KiCanvasZoneSelectEvent,
} from "../../../viewers/base/events";
import type { Viewer } from "../../../viewers/base/viewer";
import type { SchematicSymbol } from "../../../kicad/schematic";
import type {
    ChatExtension,
    ChatContext,
    ChatMessage,
    ChatPanelConfig,
    PresetGroup,
    ContextItem,
} from "./types";

// =============================================================================
// Chat History Storage
// =============================================================================

interface StoredConversation {
    id: string;
    title: string;
    extensionId: string;
    messages: ChatMessage[];
    createdAt: string;
    updatedAt: string;
}

const STORAGE_KEY = "kc-chat-history";
const MAX_HISTORY_ITEMS = 50;

function generateConversationId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function loadHistory(): StoredConversation[] {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        return data ? JSON.parse(data) : [];
    } catch {
        return [];
    }
}

function saveHistory(conversations: StoredConversation[]): void {
    try {
        // Keep only the most recent conversations
        const trimmed = conversations.slice(0, MAX_HISTORY_ITEMS);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
        console.warn("[ChatPanel] Failed to save history:", e);
    }
}

function deleteConversation(id: string): void {
    const history = loadHistory();
    const filtered = history.filter((c) => c.id !== id);
    saveHistory(filtered);
}

function clearAllHistory(): void {
    try {
        localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
        console.warn("[ChatPanel] Failed to clear history:", e);
    }
}

function exportToMarkdown(conversation: StoredConversation): string {
    const lines: string[] = [
        `# ${conversation.title}`,
        ``,
        `*Created: ${new Date(conversation.createdAt).toLocaleString()}*`,
        ``,
        `---`,
        ``,
    ];

    for (const msg of conversation.messages) {
        if (msg.role === "user") {
            lines.push(`## User`);
            lines.push(``);
            lines.push(msg.content);
            lines.push(``);
        } else if (msg.role === "assistant") {
            lines.push(`## Assistant`);
            lines.push(``);
            lines.push(msg.content);
            lines.push(``);
        }
    }

    return lines.join("\n");
}

function downloadMarkdown(conversation: StoredConversation): void {
    const markdown = exportToMarkdown(conversation);
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${conversation.title
        .replace(/[^a-z0-9]/gi, "-")
        .toLowerCase()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// =============================================================================
// Chat Panel Component
// =============================================================================

export class KCChatPanelElement extends KCUIElement {
    static override styles = [
        ...KCUIElement.styles,
        ...chatPanelStyles,
        overlayStyles,
        historyPanelStyles,
    ];

    // =========================================================================
    // Attributes
    // =========================================================================

    @attribute({ type: Boolean })
    visible: boolean = true; // Always visible - docked tab shows when minimized

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
    private _contextExpanded: boolean = false; // Show all context items or just first 8
    private _streamingContent: string = "";
    private _thinkingContent: string = "";
    private _isLoading: boolean = false;
    private _error: string | null = null;
    private _isInitialized: boolean = false;
    private _updatePending: boolean = false;

    // Panel modes
    private _isDocked: boolean = true; // Start docked by default
    private _isOverlay: boolean = false; // Fullscreen overlay mode
    private _showHistory: boolean = false; // Show history panel

    // Current conversation tracking
    private _currentConversationId: string | null = null;
    private _extensionId: string = "default";

    // Viewer and context for auto-initialization
    private _viewer: Viewer | null = null;
    private _repoInfo: { repo: string | null; commit: string | null } = {
        repo: null,
        commit: null,
    };
    private _viewerEventsSetup: boolean = false;

    // Dragging state
    private _isDragging: boolean = false;
    private _dragStartX: number = 0;
    private _dragStartY: number = 0;
    private _panelStartX: number = 0;
    private _panelStartY: number = 0;
    // Persistent panel position (null = use default CSS position)
    private _panelPosition: { left: number; top: number } | null = null;
    // Preserve scroll position across updates
    private _scrollPosition: number = 0;

    constructor() {
        super();
        this._service = new ChatService();
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    override connectedCallback() {
        super.connectedCallback();
        // Ensure visible attribute is set for CSS visibility
        if (!this.hasAttribute("visible")) {
            this.setAttribute("visible", "");
        }
    }

    override initialContentCallback() {
        console.log("[ChatPanel] initialContentCallback running");
        this._setupEventListeners();
        this._initializeSchematicContext();
        requestAnimationFrame(() => {
            this._isInitialized = true;
            console.log("[ChatPanel] Initialized");
        });
    }

    /**
     * Auto-initialize with schematic context if available.
     * Sets up viewer events and configures the schematic extension.
     */
    private async _initializeSchematicContext(): Promise<void> {
        console.log("[ChatPanel] _initializeSchematicContext starting");
        try {
            // Get viewer context
            this._viewer = (await this.requestLazyContext("viewer")) as Viewer;
            console.log("[ChatPanel] Got viewer, waiting for loaded");
            await this._viewer.loaded;

            // Get repo info
            try {
                this._repoInfo = (await this.requestLazyContext(
                    "repoInfo",
                )) as {
                    repo: string | null;
                    commit: string | null;
                };
            } catch (err) {
                console.warn("[ChatPanel] Could not get repo info:", err);
            }

            // Set up with schematic extension
            await this.setExtension(schematicExtension, {
                repo: this._repoInfo.repo,
                commit: this._repoInfo.commit,
                selectedItems: [],
            });

            // Configure panel
            this.configure({
                title: "Schematic Assistant",
                placeholder: "Ask about the schematic...",
                logoSrc: "./images/Grok_Logomark_Light.png",
            });

            // Set up viewer selection events
            this._setupViewerEvents();
        } catch (err) {
            console.warn(
                "[ChatPanel] Could not initialize schematic context:",
                err,
            );
            // Panel will still work, just without schematic features
        }
    }

    /**
     * Set up listener for viewer selection events.
     */
    private _setupViewerEvents(): void {
        if (!this._viewer || this._viewerEventsSetup) return;
        this._viewerEventsSetup = true;

        // Listen for single selection
        this.addDisposable(
            this._viewer.addEventListener(KiCanvasSelectEvent.type, (e) => {
                const item = e.detail.item;
                if (this._isSchematicSymbol(item)) {
                    const contextItem = createSchematicContextItem(
                        item.uuid,
                        item.reference,
                        item.value,
                        item.lib_id,
                    );
                    this._contextItems = [contextItem];
                    this.updateContext({
                        repo: this._repoInfo.repo,
                        commit: this._repoInfo.commit,
                        selectedItems: this._contextItems,
                    });
                } else if (!item) {
                    this._contextItems = [];
                    this.updateContext({
                        repo: this._repoInfo.repo,
                        commit: this._repoInfo.commit,
                        selectedItems: [],
                    });
                }
            }),
        );

        // Listen for zone/multi-selection
        this.addDisposable(
            this._viewer.addEventListener(KiCanvasZoneSelectEvent.type, (e) => {
                const items = e.detail.items || [];
                const symbols = items.filter((item: unknown) =>
                    this._isSchematicSymbol(item),
                ) as SchematicSymbol[];
                this._contextItems = symbols.map((item) =>
                    createSchematicContextItem(
                        item.uuid,
                        item.reference,
                        item.value,
                        item.lib_id,
                    ),
                );
                this.updateContext({
                    repo: this._repoInfo.repo,
                    commit: this._repoInfo.commit,
                    selectedItems: this._contextItems,
                });
            }),
        );
    }

    private _isSchematicSymbol(item: unknown): item is SchematicSymbol {
        return (
            item !== null &&
            typeof item === "object" &&
            "reference" in item &&
            "uuid" in item
        );
    }

    override renderedCallback() {
        // Sync input value
        const input = this.renderRoot.querySelector(
            ".query-input",
        ) as HTMLTextAreaElement;
        if (input && input.value !== this._inputValue) {
            input.value = this._inputValue;
        }

        // Keep streaming content updated
        if (this._streamingContent && this.streaming) {
            const streamingEl = this.renderRoot.querySelector(
                ".streaming-response",
            );
            if (streamingEl) {
                streamingEl.innerHTML =
                    this._formatContent(this._streamingContent) +
                    '<span class="cursor"></span>';
                // Don't auto-scroll here either
            }
        }

        // Apply stored panel position if dragged (but not in overlay mode)
        if (this._panelPosition && !this._isDocked && !this._isOverlay) {
            const container = this.renderRoot.querySelector(
                ".chat-container",
            ) as HTMLElement;
            if (container) {
                container.style.position = "fixed";
                container.style.left = `${this._panelPosition.left}px`;
                container.style.top = `${this._panelPosition.top}px`;
                container.style.right = "auto";
                container.style.bottom = "auto";
            }
        } else if (this._isOverlay) {
            // Clear any stored position when in overlay mode - use CSS positioning
            const container = this.renderRoot.querySelector(
                ".chat-container",
            ) as HTMLElement;
            if (container) {
                container.style.position = "";
                container.style.left = "";
                container.style.top = "";
                container.style.right = "";
                container.style.bottom = "";
            }
        }

        // Restore scroll position after update
        const scrollArea = this.renderRoot.querySelector(
            ".conversation-scroll",
        ) as HTMLElement;
        if (scrollArea && this._scrollPosition > 0) {
            scrollArea.scrollTop = this._scrollPosition;
        }
    }

    override disconnectedCallback() {
        super.disconnectedCallback();
        this._saveCurrentConversation();
        this._service.dispose();
    }

    // =========================================================================
    // Public API
    // =========================================================================

    async setExtension(
        extension: ChatExtension,
        context?: ChatContext,
    ): Promise<void> {
        console.log(
            "[ChatPanel] setExtension called with:",
            extension.id,
            context,
        );
        this._extensionId = extension.id;
        await this._service.setExtension(extension, context);

        if (context?.selectedItems) {
            this._contextItems = context.selectedItems;
        }

        this._refreshPresets();
        this._scheduleUpdate();
    }

    updateContext(context: Partial<ChatContext>): void {
        this._service.updateContext(context);

        if (context.selectedItems) {
            this._contextItems = context.selectedItems;
        }

        this._refreshPresets();
        this._scheduleUpdate();
    }

    configure(config: ChatPanelConfig): void {
        this._config = { ...this._config, ...config };

        if (config.logoSrc) {
            this.logoSrc = config.logoSrc;
        }

        this._scheduleUpdate();
    }

    show(): void {
        if (!this._isDocked) return; // Already expanded
        this._isDocked = false;
        // Reset panel position to default when opening
        this._panelPosition = null;
        // Clear any inline styles to use default CSS positioning
        requestAnimationFrame(() => {
            const container = this.renderRoot?.querySelector(
                ".chat-container",
            ) as HTMLElement;
            if (container && !this._isOverlay) {
                container.style.position = "";
                container.style.left = "";
                container.style.top = "";
                container.style.right = "";
                container.style.bottom = "";
            }
        });
        this._refreshPresets();
        this._scheduleUpdate();
        this.dispatchEvent(
            new CustomEvent("chat-show", { bubbles: true, composed: true }),
        );
    }

    hide(): void {
        // When hiding, dock instead of fully hiding
        this._isDocked = true;
        this._isOverlay = false;
        this._showHistory = false;
        this._scheduleUpdate();
        this.dispatchEvent(
            new CustomEvent("chat-hide", { bubbles: true, composed: true }),
        );
    }

    toggle(): void {
        if (this._isDocked) {
            this.show();
        } else {
            this.hide();
        }
    }

    /**
     * Completely hide the panel (not just dock).
     */
    destroy(): void {
        this.visible = false;
        this._saveCurrentConversation();
        this._service.dispose();
        super.remove();
    }

    addContextItem(item: ContextItem): void {
        if (!this._contextItems.find((i) => i.id === item.id)) {
            this._contextItems = [...this._contextItems, item];
            this._service.updateContext({ selectedItems: this._contextItems });
            this._refreshPresets();
            this._scheduleUpdate();
        }
    }

    removeContextItem(id: string): void {
        this._contextItems = this._contextItems.filter((i) => i.id !== id);
        this._service.updateContext({ selectedItems: this._contextItems });
        this._refreshPresets();
        this._scheduleUpdate();
    }

    setContextItems(items: ContextItem[]): void {
        this._contextItems = items;
        this._service.updateContext({ selectedItems: this._contextItems });
        this._refreshPresets();
        this._scheduleUpdate();
    }

    /**
     * Start a new conversation (clear current but save to history first).
     */
    startNewConversation(): void {
        this._saveCurrentConversation();
        this._service.clearMessages();
        this._currentConversationId = null;
        this._streamingContent = "";
        this._thinkingContent = "";
        this._error = null;
        this._showHistory = false; // Close history panel when starting new chat
        this._scheduleUpdate();
        this.dispatchEvent(
            new CustomEvent("chat-clear", { bubbles: true, composed: true }),
        );
    }

    /**
     * Clear current conversation without saving.
     */
    clearConversation(): void {
        this._service.clearMessages();
        this._currentConversationId = null;
        this._streamingContent = "";
        this._thinkingContent = "";
        this._error = null;
        this._scheduleUpdate();
        this.dispatchEvent(
            new CustomEvent("chat-clear", { bubbles: true, composed: true }),
        );
    }

    /**
     * Clear all chat history from storage.
     */
    clearAllHistory(): void {
        clearAllHistory();
        this._scheduleUpdate();
    }

    async sendQuery(query: string): Promise<void> {
        await this._submitQuery(query);
    }

    setPresets(presets: PresetGroup[]): void {
        this._presets = presets;
        this._scheduleUpdate();
    }

    // =========================================================================
    // History Management
    // =========================================================================

    private _saveCurrentConversation(): void {
        const messages = this._service.messages;
        if (messages.length === 0) return;

        // Only save if there's actual content (not just empty messages)
        const hasContent = messages.some((m) => m.content && m.content.trim());
        if (!hasContent) return;

        const history = loadHistory();

        // Generate title from first user message
        const firstUserMsg = messages.find(
            (m) => m.role === "user" && m.content,
        );
        const title = firstUserMsg
            ? firstUserMsg.content.slice(0, 50) +
              (firstUserMsg.content.length > 50 ? "..." : "")
            : "Untitled Conversation";

        const now = new Date().toISOString();

        if (this._currentConversationId) {
            // Try to update existing conversation
            const existingIndex = history.findIndex(
                (c) => c.id === this._currentConversationId,
            );
            if (existingIndex !== -1) {
                // Update existing
                history[existingIndex]!.messages = messages;
                history[existingIndex]!.updatedAt = now;
                history[existingIndex]!.title = title;
            } else {
                // Conversation ID exists but not in history - add it
                history.unshift({
                    id: this._currentConversationId,
                    title,
                    extensionId: this._extensionId,
                    messages,
                    createdAt: now,
                    updatedAt: now,
                });
            }
        } else {
            // Create new conversation
            this._currentConversationId = generateConversationId();
            history.unshift({
                id: this._currentConversationId,
                title,
                extensionId: this._extensionId,
                messages,
                createdAt: now,
                updatedAt: now,
            });
        }

        saveHistory(history);
    }

    private _loadConversation(conversation: StoredConversation): void {
        this._service.clearMessages();
        for (const msg of conversation.messages) {
            this._service.addMessage({
                role: msg.role,
                content: msg.content,
            });
        }
        this._currentConversationId = conversation.id;
        this._showHistory = false;
        this._scheduleUpdate();
    }

    private _deleteConversation(id: string): void {
        deleteConversation(id);
        if (this._currentConversationId === id) {
            this._currentConversationId = null;
            this._service.clearMessages();
        }
        this._scheduleUpdate();
    }

    private _exportConversation(conversation: StoredConversation): void {
        downloadMarkdown(conversation);
    }

    // =========================================================================
    // Private Methods
    // =========================================================================

    private _scheduleUpdate(): void {
        if (this._updatePending) return;
        this._updatePending = true;

        // Save scroll position before update
        const scrollArea = this.renderRoot?.querySelector(
            ".conversation-scroll",
        ) as HTMLElement;
        if (scrollArea) {
            this._scrollPosition = scrollArea.scrollTop;
        }

        requestAnimationFrame(() => {
            if (this._updatePending && this._isInitialized) {
                this._updatePending = false;
                console.log("[ChatPanel] Calling super.update()");
                super.update();
            } else {
                console.log("[ChatPanel] Skipping update:", {
                    pending: this._updatePending,
                    initialized: this._isInitialized,
                });
                this._updatePending = false;
            }
        });
    }

    private _refreshPresets(): void {
        // Get presets from extension based on current context
        const extension = this._service["_extension"];
        if (extension?.getPresets) {
            this._presets = extension.getPresets(this._service.context);
        }
    }

    private async _submitQuery(overrideQuery?: string): Promise<void> {
        console.log(
            "[ChatPanel] _submitQuery called with:",
            overrideQuery ?? this._inputValue,
        );
        const query = (overrideQuery ?? this._inputValue).trim();
        if (!query || this.streaming || this._isLoading) {
            console.log("[ChatPanel] Query blocked:", {
                query,
                streaming: this.streaming,
                isLoading: this._isLoading,
            });
            return;
        }

        // Create conversation ID if this is a new conversation
        if (!this._currentConversationId) {
            this._currentConversationId = generateConversationId();
        }

        this._inputValue = "";
        this._isLoading = true;
        this._error = null;
        this.streaming = true;
        this._streamingContent = "";
        this._thinkingContent = "";
        this._presetsCollapsed = true; // Collapse quick actions when sending a message

        this._scheduleUpdate();

        console.log("[ChatPanel] About to dispatch chat-send event");
        this.dispatchEvent(
            new CustomEvent("chat-send", {
                bubbles: true,
                composed: true,
                detail: { query, context: this._service.context },
            }),
        );

        console.log(
            "[ChatPanel] Calling streamQuery with context:",
            this._service.context,
        );
        try {
            await this._service.streamQuery(
                query,
                {
                    onStart: () => {
                        this._isLoading = false;
                        this._scheduleUpdate();

                        this.dispatchEvent(
                            new CustomEvent("chat-stream-start", {
                                bubbles: true,
                                composed: true,
                                detail: { messageId: "" },
                            }),
                        );
                    },
                    onChunk: (content, isThinking) => {
                        if (isThinking) {
                            this._thinkingContent += content;
                        } else {
                            this._streamingContent += content; // Accumulate, not replace
                        }

                        const streamingEl = this.renderRoot.querySelector(
                            ".streaming-response",
                        );
                        if (streamingEl) {
                            streamingEl.innerHTML =
                                this._formatContent(this._streamingContent) +
                                '<span class="cursor"></span>';
                            // Don't auto-scroll on every chunk - let user read freely
                        } else {
                            this._scheduleUpdate();
                        }
                    },
                    onComplete: (fullContent) => {
                        this.streaming = false;
                        this._streamingContent = "";
                        this._thinkingContent = "";
                        this._saveCurrentConversation(); // Auto-save after each response
                        this._scheduleUpdate();

                        this.dispatchEvent(
                            new CustomEvent("chat-stream-complete", {
                                bubbles: true,
                                composed: true,
                                detail: { messageId: "", content: fullContent },
                            }),
                        );
                    },
                    onError: (error) => {
                        console.error(
                            "[ChatPanel] streamQuery onError:",
                            error,
                        );
                        this._isLoading = false;
                        this.streaming = false;
                        this._error = error;
                        this._scheduleUpdate();

                        this.dispatchEvent(
                            new CustomEvent("chat-error", {
                                bubbles: true,
                                composed: true,
                                detail: { error },
                            }),
                        );
                    },
                },
                this._thinkingMode,
            );
        } catch (err) {
            console.error("[ChatPanel] streamQuery threw exception:", err);
            this._isLoading = false;
            this.streaming = false;
            this._error = err instanceof Error ? err.message : String(err);
            this._scheduleUpdate();
        }
    }

    private _formatContent(content: string): string {
        return formatMarkdown(content);
    }

    // =========================================================================
    // Dragging and Docking
    // =========================================================================

    private _startDrag(e: MouseEvent): void {
        // Don't start drag if clicking on a button
        if ((e.target as HTMLElement).closest("button")) return;

        this._isDragging = true;
        this._dragStartX = e.clientX;
        this._dragStartY = e.clientY;

        // Get the chat container position
        const container = this.renderRoot.querySelector(
            ".chat-container",
        ) as HTMLElement;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        this._panelStartX = rect.left;
        this._panelStartY = rect.top;

        // Add temporary styles for dragging
        container.style.position = "fixed";
        container.style.left = `${rect.left}px`;
        container.style.top = `${rect.top}px`;
        container.style.right = "auto";
        container.style.bottom = "auto";
        container.classList.add("dragging");

        document.addEventListener("mousemove", this._onDrag);
        document.addEventListener("mouseup", this._endDrag);
    }

    private _onDrag = (e: MouseEvent): void => {
        if (!this._isDragging) return;

        const deltaX = e.clientX - this._dragStartX;
        const deltaY = e.clientY - this._dragStartY;

        const newX = this._panelStartX + deltaX;
        const newY = this._panelStartY + deltaY;

        const container = this.renderRoot.querySelector(
            ".chat-container",
        ) as HTMLElement;
        if (!container) return;

        container.style.left = `${newX}px`;
        container.style.top = `${newY}px`;

        // Store position for persistence across re-renders
        this._panelPosition = { left: newX, top: newY };

        // Check if near right edge for docking hint
        const viewportWidth = window.innerWidth;
        if (newX + container.offsetWidth > viewportWidth - 50) {
            this.classList.add("dock-hint");
        } else {
            this.classList.remove("dock-hint");
        }
    };

    private _endDrag = (e: MouseEvent): void => {
        if (!this._isDragging) return;
        this._isDragging = false;

        document.removeEventListener("mousemove", this._onDrag);
        document.removeEventListener("mouseup", this._endDrag);

        this.classList.remove("dock-hint");

        const container = this.renderRoot.querySelector(
            ".chat-container",
        ) as HTMLElement;
        if (!container) return;

        container.classList.remove("dragging");

        // Check if should dock to right edge
        const viewportWidth = window.innerWidth;
        const rect = container.getBoundingClientRect();

        if (rect.right > viewportWidth - 50) {
            this._animateToDock(container);
        }
    };

    private _animateToDock(container: HTMLElement): void {
        // Clear stored position - use default CSS positioning
        this._panelPosition = null;

        // Animate panel sliding to dock position
        container.style.transition = "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)";
        container.style.right = "20px";
        container.style.left = "auto";
        container.style.top = "60px";
        container.style.bottom = "80px";

        // Reset after animation
        setTimeout(() => {
            container.style.transition = "";
            container.style.position = "";
            container.style.top = "";
            container.style.bottom = "";
            container.style.right = "";
            container.style.left = "";
        }, 250);
    }

    private _setupEventListeners(): void {
        console.log("[ChatPanel] Setting up event listeners");
        const root = this.renderRoot;

        // Docked tab - click to expand
        this.addDisposable(
            delegate(root, ".docked-tab", "click", () => {
                this.show();
            }),
        );

        // Close/dock button
        this.addDisposable(
            delegate(root, ".close-button", "click", () => {
                this.hide();
            }),
        );

        // Header drag to move
        this.addDisposable(
            delegate(root, ".chat-header", "mousedown", (e) => {
                this._startDrag(e as MouseEvent);
            }),
        );

        // New chat button
        this.addDisposable(
            delegate(root, ".new-chat-button", "click", () => {
                this.startNewConversation();
            }),
        );

        // Toggle history panel
        this.addDisposable(
            delegate(root, ".history-button", "click", () => {
                // Save current conversation before showing history
                if (!this._showHistory) {
                    this._saveCurrentConversation();
                }
                this._showHistory = !this._showHistory;
                this._scheduleUpdate();
            }),
        );

        // Close history panel
        this.addDisposable(
            delegate(root, ".history-close", "click", () => {
                this._showHistory = false;
                this._scheduleUpdate();
            }),
        );

        // Toggle overlay mode
        this.addDisposable(
            delegate(root, ".overlay-button", "click", () => {
                this._isOverlay = !this._isOverlay;
                // Clear stored position when entering overlay mode
                if (this._isOverlay) {
                    this._panelPosition = null;
                }
                this._scheduleUpdate();
            }),
        );

        // History item actions
        this.addDisposable(
            delegate(root, ".history-item", "click", (e, source) => {
                const id = source.getAttribute("data-id");
                if (!id) return;

                // Don't load if clicking on action buttons
                if ((e.target as HTMLElement).closest(".history-item-actions"))
                    return;

                const history = loadHistory();
                const conversation = history.find((c) => c.id === id);
                if (conversation) {
                    this._loadConversation(conversation);
                }
            }),
        );

        this.addDisposable(
            delegate(root, ".history-item-download", "click", (e, source) => {
                e.stopPropagation();
                const item = source.closest(".history-item");
                const id = item?.getAttribute("data-id");
                if (!id) return;

                const history = loadHistory();
                const conversation = history.find((c) => c.id === id);
                if (conversation) {
                    this._exportConversation(conversation);
                }
            }),
        );

        this.addDisposable(
            delegate(root, ".history-item-delete", "click", (e, source) => {
                e.stopPropagation();
                const item = source.closest(".history-item");
                const id = item?.getAttribute("data-id");
                if (id) {
                    this._deleteConversation(id);
                }
            }),
        );

        // Clear all history
        this.addDisposable(
            delegate(root, ".clear-all-history", "click", () => {
                if (confirm("Clear all chat history? This cannot be undone.")) {
                    this.clearAllHistory();
                }
            }),
        );

        // Send button
        this.addDisposable(
            delegate(root, ".send-button", "click", () => {
                console.log("[ChatPanel] Send button clicked");
                this._submitQuery();
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
                if (
                    source.classList.contains("disabled") ||
                    this.streaming ||
                    this._isLoading
                ) {
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

        // Context expand/collapse
        this.addDisposable(
            delegate(root, ".context-expand-btn", "click", () => {
                this._contextExpanded = true;
                this._scheduleUpdate();
            }),
        );

        this.addDisposable(
            delegate(root, ".context-collapse-btn", "click", () => {
                this._contextExpanded = false;
                this._scheduleUpdate();
            }),
        );

        // Input handling
        this.addDisposable(
            delegate(root, ".query-input", "input", (e) => {
                const input = e.target as HTMLTextAreaElement;
                this._inputValue = input.value;
                console.log("[ChatPanel] Input changed:", this._inputValue);
                this._autoResizeInput(input);
            }),
        );

        // Enter to send (shift+enter for newline)
        this.addDisposable(
            delegate(root, ".query-input", "keydown", (e) => {
                const event = e as KeyboardEvent;
                console.log("[ChatPanel] Keydown:", event.key);
                if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    this._submitQuery();
                }
            }),
        );

        // Escape to close overlay or history
        this.addDisposable(
            delegate(root, "*", "keydown", (e) => {
                const event = e as KeyboardEvent;
                if (event.key === "Escape") {
                    if (this._isOverlay) {
                        this._isOverlay = false;
                        this._scheduleUpdate();
                    } else if (this._showHistory) {
                        this._showHistory = false;
                        this._scheduleUpdate();
                    }
                }
            }),
        );
    }

    private _handlePresetClick(presetId: string): void {
        console.log("[ChatPanel] Preset clicked:", presetId);
        for (const group of this._presets) {
            const preset = group.presets.find((p) => p.id === presetId);
            if (preset) {
                console.log("[ChatPanel] Found preset, query:", preset.query);
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
    // Rendering
    // =========================================================================

    private _renderHeader(): ElementOrFragment {
        const title = this._config.title ?? "AI Assistant";

        return html`
            <div class="chat-header draggable">
                <div class="header-left">
                    ${this.logoSrc
                        ? html`<img
                              class="header-logo"
                              src="${this.logoSrc}"
                              alt="" />`
                        : ""}
                    <span class="header-title">${title}</span>
                </div>
                <div class="header-right">
                    <button
                        class="header-button new-chat-button"
                        title="New conversation">
                        <kc-ui-icon>add_comment</kc-ui-icon>
                    </button>
                    <button
                        class="header-button history-button"
                        title="Chat history">
                        <kc-ui-icon>history</kc-ui-icon>
                    </button>
                    <button
                        class="header-button overlay-button"
                        title="${this._isOverlay
                            ? "Exit fullscreen"
                            : "Fullscreen"}">
                        <kc-ui-icon
                            >${this._isOverlay
                                ? "fullscreen_exit"
                                : "fullscreen"}</kc-ui-icon
                        >
                    </button>
                    <button class="header-button close-button" title="Minimize">
                        <kc-ui-icon>remove</kc-ui-icon>
                    </button>
                </div>
            </div>
        `;
    }

    private _renderHistoryPanel(): ElementOrFragment {
        if (!this._showHistory) return html``;

        const history = loadHistory();

        return html`
            <div class="history-panel">
                <div class="history-header">
                    <span class="history-title">Chat History</span>
                    <div class="history-actions">
                        ${history.length > 0
                            ? html`<button
                                  class="clear-all-history"
                                  title="Clear all history">
                                  <kc-ui-icon>delete_forever</kc-ui-icon>
                              </button>`
                            : ""}
                        <button class="history-close" title="Close">
                            <kc-ui-icon>close</kc-ui-icon>
                        </button>
                    </div>
                </div>
                <div class="history-list">
                    ${history.length === 0
                        ? html`<div class="history-empty">
                              No conversations yet
                          </div>`
                        : history.map(
                              (conv) => html`
                                  <div
                                      class="history-item ${conv.id ===
                                      this._currentConversationId
                                          ? "active"
                                          : ""}"
                                      data-id="${conv.id}">
                                      <div class="history-item-content">
                                          <div class="history-item-title">
                                              ${conv.title}
                                          </div>
                                          <div class="history-item-meta">
                                              ${new Date(
                                                  conv.updatedAt,
                                              ).toLocaleDateString()}
                                              · ${conv.messages.length} messages
                                          </div>
                                      </div>
                                      <div class="history-item-actions">
                                          <button
                                              class="history-item-download"
                                              title="Download as Markdown">
                                              <kc-ui-icon>download</kc-ui-icon>
                                          </button>
                                          <button
                                              class="history-item-delete"
                                              title="Delete">
                                              <kc-ui-icon>delete</kc-ui-icon>
                                          </button>
                                      </div>
                                  </div>
                              `,
                          )}
                </div>
            </div>
        `;
    }

    private _renderContextItems(): ElementOrFragment | string {
        if (
            this._config.showContextItems === false ||
            this._contextItems.length === 0
        ) {
            return html``;
        }

        const MAX_VISIBLE = 6;
        const hasMore = this._contextItems.length > MAX_VISIBLE;
        const visibleItems = this._contextExpanded
            ? this._contextItems
            : this._contextItems.slice(0, MAX_VISIBLE);
        const hiddenCount = this._contextItems.length - MAX_VISIBLE;

        return html`
            <div class="context-section">
                <div class="context-header">
                    <span class="context-label">Context</span>
                    <span class="context-count"
                        >${this._contextItems.length}</span
                    >
                </div>
                <div class="context-items">
                    ${visibleItems.map(
                        (item) => html`
                            <div
                                class="context-item"
                                data-id="${item.id}"
                                title="${item.label} (${item.type})">
                                <span class="context-item-label"
                                    >${item.label}</span
                                >
                                <button
                                    class="context-item-remove"
                                    title="Remove">
                                    <kc-ui-icon>close</kc-ui-icon>
                                </button>
                            </div>
                        `,
                    )}
                    ${hasMore && !this._contextExpanded
                        ? html`<button
                              class="context-expand-btn"
                              title="Show ${hiddenCount} more">
                              +${hiddenCount} more
                          </button>`
                        : ""}
                    ${hasMore && this._contextExpanded
                        ? html`<button
                              class="context-collapse-btn"
                              title="Show less">
                              Show less
                          </button>`
                        : ""}
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
            <div
                class="presets-section ${this._presetsCollapsed
                    ? "collapsed"
                    : ""}">
                <div class="presets-header">
                    <span class="presets-label">Quick Actions</span>
                    <button class="presets-toggle">
                        <kc-ui-icon
                            >${this._presetsCollapsed
                                ? "expand_more"
                                : "expand_less"}</kc-ui-icon
                        >
                    </button>
                </div>
                ${!this._presetsCollapsed
                    ? html`
                          ${this._presets.map(
                              (group) => html`
                                  <div class="preset-group">
                                      ${group.label
                                          ? html`<div
                                                class="preset-group-label">
                                                ${group.label}
                                            </div>`
                                          : ""}
                                      <div class="preset-cards">
                                          ${group.presets.map((preset) => {
                                              const disabled =
                                                  preset.requiresContext &&
                                                  !hasContext;
                                              const enabled =
                                                  !preset.isEnabled ||
                                                  preset.isEnabled(
                                                      this._service.context,
                                                  );

                                              return html`
                                                  <button
                                                      class="preset-card ${disabled ||
                                                      !enabled
                                                          ? "disabled"
                                                          : ""}"
                                                      data-preset-id="${preset.id}"
                                                      title="${preset.description}"
                                                      ?disabled=${disabled ||
                                                      !enabled}>
                                                      <kc-ui-icon
                                                          class="preset-icon"
                                                          >${preset.icon}</kc-ui-icon
                                                      >
                                                      <span class="preset-title"
                                                          >${preset.title}</span
                                                      >
                                                  </button>
                                              `;
                                          })}
                                      </div>
                                  </div>
                              `,
                          )}
                      `
                    : ""}
            </div>
        `;
    }

    private _renderMessages(): ElementOrFragment {
        const allMessages = this._service.messages;
        console.log("[ChatPanel] _renderMessages:", {
            allMessages: allMessages.length,
            streaming: this.streaming,
            isLoading: this._isLoading,
            error: this._error,
        });

        // Filter out messages with no content (including streaming placeholders)
        const messages = allMessages.filter(
            (msg) => msg.content && msg.content.trim(),
        );

        // Show empty state only if no messages, not loading, not streaming, AND no error
        if (
            messages.length === 0 &&
            !this.streaming &&
            !this._isLoading &&
            !this._error
        ) {
            return html`
                <div class="empty-state">
                    <kc-ui-icon>chat_bubble_outline</kc-ui-icon>
                    <p class="empty-state-text">
                        ${this._config.placeholder ??
                        "Ask a question or select a quick action above."}
                    </p>
                </div>
            `;
        }

        return html`
            <div class="conversation-scroll">
                ${messages.map((msg) => this._renderMessage(msg))}
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
                              <div
                                  class="message-content streaming-response"></div>
                          </div>
                      `
                    : ""}
                ${this._isLoading
                    ? html`
                          <div class="loading-indicator">
                              <div class="loading-spinner"></div>
                              <span class="loading-text"
                                  >Preparing response...</span
                              >
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

        // Skip rendering messages with no content
        if (!msg.content) {
            return html``;
        }

        // Create element with formatted content using direct DOM manipulation
        // since property binding (.innerHTML) doesn't work in this template system
        const div = document.createElement("div");
        div.className = `message message-${msg.role}`;
        const contentDiv = document.createElement("div");
        contentDiv.className = "message-content";
        contentDiv.innerHTML = this._formatContent(msg.content);
        div.appendChild(contentDiv);
        return div;
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
                                  class="thinking-toggle ${this._thinkingMode
                                      ? "active"
                                      : ""}"
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

    private _renderDockedTab(): ElementOrFragment {
        return html`
            <div class="docked-tab" title="Open AI Chat">
                ${this.logoSrc
                    ? html`<img
                          class="docked-logo"
                          src="${this.logoSrc}"
                          alt="" />`
                    : html`<kc-ui-icon>chat</kc-ui-icon>`}
            </div>
        `;
    }

    private _renderPanel(): ElementOrFragment {
        return html`
            <div
                class="chat-container ${this._isOverlay
                    ? "overlay-mode"
                    : ""} ${this._isDragging ? "dragging" : ""}">
                ${this._renderHeader()} ${this._renderHistoryPanel()}
                <div class="chat-body">
                    ${this._renderContextItems()} ${this._renderPresets()}
                    <div class="conversation-section">
                        ${this._renderMessages()}
                    </div>
                    ${this._renderInput()}
                </div>
            </div>
        `;
    }

    override render(): ElementOrFragment {
        // Always render the docked tab when visible
        if (this._isDocked) {
            return this._renderDockedTab();
        }

        // Overlay mode - no backdrop, just the panel integrated into UI
        if (this._isOverlay) {
            return this._renderPanel();
        }

        // Normal panel mode
        return this._renderPanel();
    }
}

// Register the component
window.customElements.define("kc-chat-panel", KCChatPanelElement);

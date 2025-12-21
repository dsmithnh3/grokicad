/*
    Chat Types - Core interfaces for the extensible chat system.
    
    This provides a robust, generic API for AI chat that can be extended
    for different use cases (schematic analysis, part replacement, etc.)
*/

import type { Message } from "../../services/xai-client";

// =============================================================================
// Core Chat Types
// =============================================================================

/** Represents a message in the chat conversation */
export interface ChatMessage {
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: Date;
    /** Optional metadata attached to the message */
    metadata?: Record<string, unknown>;
    /** If this is a thinking/reasoning message */
    isThinking?: boolean;
    /** If message is currently streaming */
    isStreaming?: boolean;
    /** Error message if the request failed */
    error?: string;
}

/** Suggested action/preset shown to the user */
export interface ChatPreset {
    id: string;
    title: string;
    icon: string;
    description: string;
    /** The query to send when selected */
    query: string;
    /** Whether this preset requires specific context (e.g., selected components) */
    requiresContext?: boolean;
    /** Condition function - if provided, preset is disabled when this returns false */
    isEnabled?: (context: ChatContext) => boolean;
}

/** Grouping of presets by category */
export interface PresetGroup {
    id: string;
    label: string;
    presets: ChatPreset[];
}

// =============================================================================
// Context Types
// =============================================================================

/** Generic context data passed to extensions */
export interface ChatContext {
    /** Current repository context */
    repo?: string | null;
    commit?: string | null;

    /** Selected items (components, parts, etc.) */
    selectedItems?: ContextItem[];

    /** Any additional data specific to the extension */
    extra?: Record<string, unknown>;
}

/** An item in the context (component, part, etc.) */
export interface ContextItem {
    id: string;
    type: string;
    label: string;
    /** Additional properties */
    properties?: Record<string, string | number | boolean>;
}

/** Result of building context for the AI */
export interface BuiltContext {
    /** The system prompt to use */
    systemPrompt: string;
    /** The user message with context prepended */
    userPrompt: string;
    /** Additional messages to include in the conversation */
    additionalMessages?: Message[];
}

// =============================================================================
// Extension Interface
// =============================================================================

/**
 * Extension interface for adding new chat capabilities.
 * Extensions can provide presets, context, and custom rendering.
 */
export interface ChatExtension {
    /** Unique identifier for this extension */
    readonly id: string;

    /** Human-readable name */
    readonly name: string;

    /**
     * Get presets to show for this extension.
     * Called whenever context changes.
     */
    getPresets(context: ChatContext): PresetGroup[];

    /**
     * Build the context (system prompt + user prompt) for a query.
     * Extensions can add domain-specific context to the prompt.
     */
    buildContext(
        context: ChatContext,
        userQuery: string,
        conversationHistory?: ChatMessage[],
    ): Promise<BuiltContext>;

    /**
     * Optional: Transform the response before displaying.
     * Can be used to parse special formats, extract actions, etc.
     */
    transformResponse?(content: string): TransformedResponse;

    /**
     * Optional: Whether thinking mode is supported.
     * Defaults to true.
     */
    supportsThinking?: boolean;

    /**
     * Optional: Custom placeholder text for the input.
     */
    getPlaceholder?(context: ChatContext): string;

    /**
     * Optional: Initialize the extension with context.
     * Called once when the extension is activated.
     */
    initialize?(context: ChatContext): Promise<void>;

    /**
     * Optional: Cleanup when extension is deactivated.
     */
    dispose?(): void;
}

/** Result of transforming a response */
export interface TransformedResponse {
    /** The content to display (may be modified) */
    content: string;
    /** Any actions extracted from the response */
    actions?: ResponseAction[];
    /** Additional data extracted */
    metadata?: Record<string, unknown>;
}

/** An action that can be taken based on the response */
export interface ResponseAction {
    id: string;
    type: string;
    label: string;
    icon?: string;
    data?: Record<string, unknown>;
}

// =============================================================================
// Panel Configuration
// =============================================================================

/** Configuration options for the chat panel */
export interface ChatPanelConfig {
    /** Title shown in the header */
    title?: string;

    /** Logo to show in header */
    logoSrc?: string;

    /** Whether the panel is draggable */
    draggable?: boolean;

    /** Whether the panel can be docked */
    dockable?: boolean;

    /** Whether to show the thinking mode toggle */
    showThinkingToggle?: boolean;

    /** Whether to show preset quick actions */
    showPresets?: boolean;

    /** Whether to allow context items to be selected/shown */
    showContextItems?: boolean;

    /** Custom CSS class for theming */
    themeClass?: string;

    /** Placeholder text for the input */
    placeholder?: string;
}

// =============================================================================
// Events
// =============================================================================

/** Events emitted by the chat panel */
export interface ChatPanelEvents {
    /** Fired when a message is sent */
    "chat-send": { query: string; context: ChatContext };

    /** Fired when streaming starts */
    "chat-stream-start": { messageId: string };

    /** Fired when streaming completes */
    "chat-stream-complete": { messageId: string; content: string };

    /** Fired when an error occurs */
    "chat-error": { error: string };

    /** Fired when panel is shown */
    "chat-show": void;

    /** Fired when panel is hidden */
    "chat-hide": void;

    /** Fired when an action button is clicked */
    "chat-action": { action: ResponseAction };

    /** Fired when conversation is cleared */
    "chat-clear": void;
}

/** Helper type for typed events */
export type ChatEvent<K extends keyof ChatPanelEvents> = CustomEvent<
    ChatPanelEvents[K]
>;

/** Create a typed chat event */
export function createChatEvent<K extends keyof ChatPanelEvents>(
    type: K,
    detail: ChatPanelEvents[K],
): ChatEvent<K> {
    return new CustomEvent(type, {
        bubbles: true,
        composed: true,
        detail,
    });
}

// =============================================================================
// Utility Types
// =============================================================================

/** State of the chat panel */
export interface ChatPanelState {
    messages: ChatMessage[];
    isLoading: boolean;
    isStreaming: boolean;
    error: string | null;
    context: ChatContext;
    currentInput: string;
    thinkingMode: boolean;
    isVisible: boolean;
    isDocked: boolean;
}

/** Callback types for streaming events */
export interface StreamingCallbacks {
    onStart?: () => void;
    onChunk?: (content: string, isThinking: boolean) => void;
    onComplete?: (fullContent: string, thinkingContent: string) => void;
    onError?: (error: string) => void;
}

/** Generate a unique message ID */
export function generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

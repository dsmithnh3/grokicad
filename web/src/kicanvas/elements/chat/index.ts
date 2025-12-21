/*
    Chat Module Index - Exports the complete chat system.
    
    This module provides a production-ready, extensible AI chat system that
    can be used throughout the application for different use cases.
*/

// Core types
export type {
    ChatMessage,
    ChatPreset,
    PresetGroup,
    ChatContext,
    ContextItem,
    BuiltContext,
    ChatExtension,
    TransformedResponse,
    ResponseAction,
    ChatPanelConfig,
    ChatPanelEvents,
    ChatEvent,
    ChatPanelState,
    StreamingCallbacks,
} from "./types";

export { createChatEvent, generateMessageId } from "./types";

// Chat service
export { ChatService, createChatService } from "./chat-service";

// Chat panel component
export { KCChatPanelElement } from "./chat-panel";

// Styles (for extending)
export {
    chatPanelStyles,
    chatCssProperties,
    hostStyles,
    containerStyles,
    headerStyles,
    messageStyles,
    inputStyles,
    presetStyles,
    contextStyles,
    contentStyles,
    statusStyles,
} from "./styles";

// Extensions
export * from "./extensions";

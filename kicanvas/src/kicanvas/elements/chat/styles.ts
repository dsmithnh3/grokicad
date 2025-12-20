/*
    Chat Styles - Shared styles for the chat panel components.
    
    These styles are designed to be themeable and can be customized
    per-extension or per-instance using CSS custom properties.
*/

import { css } from "../../../base/web-components";

// =============================================================================
// CSS Custom Properties (Theme Variables)
// =============================================================================

export const chatCssProperties = css`
    :host {
        /* Panel structure */
        --chat-panel-width: 400px;
        --chat-panel-bg: #000000;
        --chat-panel-border: #333333;
        --chat-panel-radius: 10px;
        
        /* Header */
        --chat-header-bg: transparent;
        --chat-header-border: #333333;
        --chat-header-height: 48px;
        
        /* Accent colors */
        --chat-accent: #ffce54;
        --chat-accent-dim: rgba(255, 206, 84, 0.15);
        --chat-accent-hover: rgba(255, 206, 84, 0.35);
        
        /* Text colors */
        --chat-text-primary: #ffffff;
        --chat-text-secondary: rgba(255, 255, 255, 0.7);
        --chat-text-muted: rgba(255, 255, 255, 0.5);
        
        /* Messages */
        --chat-user-bg: rgba(96, 165, 250, 0.08);
        --chat-user-border: rgba(96, 165, 250, 0.4);
        --chat-assistant-bg: rgba(255, 255, 255, 0.04);
        --chat-assistant-border: var(--chat-accent);
        --chat-error-bg: rgba(255, 100, 100, 0.1);
        --chat-error-border: rgba(255, 100, 100, 0.6);
        
        /* Thinking mode */
        --chat-thinking-accent: rgb(147, 51, 234);
        --chat-thinking-bg: rgba(147, 51, 234, 0.15);
        
        /* Transitions */
        --chat-transition-fast: 0.15s ease;
        --chat-transition-normal: 0.25s ease;
    }
`;

// =============================================================================
// Host & Container Styles
// =============================================================================

export const hostStyles = css`
    :host {
        display: block;
        z-index: 1000;
        pointer-events: auto;
    }

    :host(:not([visible])) {
        display: none;
    }
    
    /* Docked tab positioning - always visible at right edge */
    .docked-tab {
        position: fixed;
        right: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 44px;
        height: 72px;
        background: linear-gradient(135deg, #1a1a1a 0%, #0a0a0a 100%);
        border: 1px solid var(--chat-panel-border);
        border-right: none;
        border-radius: 8px 0 0 8px;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        z-index: 1000;
        transition: all var(--chat-transition-fast);
        box-shadow: -2px 0 12px rgba(0, 0, 0, 0.4);
    }
    
    .docked-tab:hover {
        width: 52px;
        background: linear-gradient(135deg, #252525 0%, #1a1a1a 100%);
        border-color: rgba(255, 206, 84, 0.5);
        box-shadow: -4px 0 24px rgba(0, 0, 0, 0.5), 0 0 20px rgba(255, 206, 84, 0.15);
    }
    
    .docked-logo {
        width: 28px;
        height: 28px;
        object-fit: contain;
        transition: transform var(--chat-transition-fast);
    }
    
    .docked-tab:hover .docked-logo {
        transform: scale(1.1);
    }
    
    .docked-tab kc-ui-icon {
        font-size: 24px;
        color: var(--chat-accent);
    }
    
    :host(.dock-hint) .chat-container {
        border-color: rgba(255, 206, 84, 0.6);
        box-shadow: 0 0 30px rgba(255, 206, 84, 0.15), 0 8px 32px rgba(0, 0, 0, 0.5);
    }
`;

export const containerStyles = css`
    .chat-container {
        position: fixed;
        top: 60px;
        bottom: 80px;
        right: 20px;
        width: var(--chat-panel-width);
        background: var(--chat-panel-bg);
        border: 1px solid var(--chat-panel-border);
        border-radius: var(--chat-panel-radius);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
        transition: box-shadow var(--chat-transition-fast), 
                    border-color var(--chat-transition-fast);
        z-index: 1000;
    }
    
    .chat-container.dragging {
        cursor: grabbing;
        user-select: none;
        opacity: 0.9;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
    }

    :host([data-search-open]) .chat-container {
        overflow: visible;
    }
`;

// =============================================================================
// Header Styles
// =============================================================================

export const headerStyles = css`
    .chat-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0 14px;
        height: var(--chat-header-height);
        background: var(--chat-header-bg);
        border-bottom: 1px solid var(--chat-header-border);
        flex-shrink: 0;
    }
    
    .chat-header.draggable {
        cursor: grab;
    }
    
    .chat-header.draggable:active {
        cursor: grabbing;
    }

    .header-left {
        display: flex;
        align-items: center;
        gap: 10px;
    }

    .header-logo {
        width: 22px;
        height: 22px;
        object-fit: contain;
    }

    .header-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--chat-text-primary);
        letter-spacing: 0.02em;
    }

    .header-right {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .header-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        background: transparent;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        color: var(--chat-text-secondary);
        transition: all var(--chat-transition-fast);
    }

    .header-button:hover {
        background: rgba(255, 255, 255, 0.08);
        color: var(--chat-text-primary);
    }

    .header-button kc-ui-icon {
        font-size: 18px;
    }

    .close-button:hover {
        background: rgba(255, 100, 100, 0.15);
        color: #ff6b6b;
    }
`;

// =============================================================================
// Message Styles
// =============================================================================

export const messageStyles = css`
    .chat-body {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
    }

    .conversation-section {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
    }

    .conversation-scroll {
        flex: 1;
        overflow-y: auto;
        overflow-x: hidden;
        padding: 12px 14px;
        scroll-behavior: smooth;
    }

    .message {
        margin-bottom: 12px;
        padding: 10px 14px;
        border-radius: 8px;
        animation: messageSlideIn 0.2s ease-out;
    }

    @keyframes messageSlideIn {
        from {
            opacity: 0;
            transform: translateY(8px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .message-user {
        background: var(--chat-user-bg);
        border-left: 3px solid var(--chat-user-border);
        font-size: 13px;
        line-height: 1.5;
        color: var(--chat-text-primary);
    }

    .message-assistant {
        background: var(--chat-assistant-bg);
        border-left: 3px solid var(--chat-assistant-border);
        padding: 12px 14px;
    }

    .message-error {
        background: var(--chat-error-bg);
        border-left: 3px solid var(--chat-error-border);
        color: rgb(255, 150, 150);
    }

    .message-content {
        font-size: 13px;
        line-height: 1.6;
        color: var(--chat-text-primary);
        word-wrap: break-word;
        overflow-wrap: break-word;
        max-width: 100%;
    }

    /* Streaming cursor animation */
    .cursor {
        display: inline-block;
        width: 2px;
        height: 1em;
        background: var(--chat-accent);
        margin-left: 2px;
        vertical-align: text-bottom;
        animation: blink 0.7s infinite;
    }

    @keyframes blink {
        0%, 50% { opacity: 1; }
        51%, 100% { opacity: 0; }
    }

    /* Empty state */
    .empty-state {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        padding: 32px 24px;
        text-align: center;
        color: var(--chat-text-muted);
    }

    .empty-state kc-ui-icon {
        font-size: 48px;
        margin-bottom: 16px;
        opacity: 0.5;
    }

    .empty-state-text {
        font-size: 14px;
        line-height: 1.5;
        max-width: 280px;
    }
`;

// =============================================================================
// Input Area Styles
// =============================================================================

export const inputStyles = css`
    .chat-input-area {
        flex-shrink: 0;
        padding: 12px 14px;
        background: #0a0a0a;
        border-top: 1px solid var(--chat-panel-border);
    }

    .chat-input-area.disabled {
        opacity: 0.6;
    }

    .input-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 8px;
    }

    .thinking-toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 16px;
        color: var(--chat-text-muted);
        font-size: 11px;
        cursor: pointer;
        transition: all var(--chat-transition-fast);
    }

    .thinking-toggle kc-ui-icon {
        font-size: 14px;
    }

    .thinking-toggle:hover {
        background: rgba(255, 255, 255, 0.08);
        color: var(--chat-text-secondary);
    }

    .thinking-toggle.active {
        background: var(--chat-thinking-bg);
        border-color: rgba(147, 51, 234, 0.4);
        color: rgb(192, 132, 252);
    }

    .thinking-toggle.active:hover {
        background: rgba(147, 51, 234, 0.25);
    }

    .thinking-toggle:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .chat-input-container {
        display: flex;
        gap: 8px;
        align-items: flex-end;
        background: #0a0a0a;
        border: 1px solid var(--chat-panel-border);
        border-radius: 8px;
        padding: 8px 8px 8px 12px;
        transition: all var(--chat-transition-fast);
    }

    .chat-input-container:focus-within {
        border-color: rgba(255, 206, 84, 0.5);
        box-shadow: 0 0 0 1px rgba(255, 206, 84, 0.1);
    }

    .chat-input-container.disabled {
        background: #0a0a0a;
        border-color: #1a1a1a;
    }

    .chat-input-container.disabled .query-input {
        cursor: not-allowed;
    }

    .query-input {
        flex: 1;
        padding: 4px 0;
        background: transparent;
        border: none;
        color: var(--chat-text-primary);
        font-size: 13px;
        font-family: inherit;
        outline: none;
        resize: none;
        min-height: 36px;
        max-height: 120px;
        line-height: 1.6;
        overflow-y: auto;
    }

    .query-input::placeholder {
        color: #666666;
        line-height: 1.6;
    }

    .send-button {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        background: var(--chat-accent-dim);
        border: none;
        border-radius: 6px;
        cursor: pointer;
        transition: all var(--chat-transition-fast);
        color: var(--chat-accent);
        flex-shrink: 0;
    }

    .send-button kc-ui-icon {
        font-size: 18px;
    }

    .send-button:hover:not(:disabled) {
        background: var(--chat-accent-hover);
    }

    .send-button:disabled {
        background: rgba(255, 255, 255, 0.05);
        color: rgba(255, 255, 255, 0.2);
        cursor: not-allowed;
    }
`;

// =============================================================================
// Preset Card Styles
// =============================================================================

export const presetStyles = css`
    .presets-section {
        padding: 10px 14px;
        border-bottom: 1px solid var(--chat-panel-border);
    }
    
    .presets-section.collapsed {
        padding: 6px 14px;
    }

    .presets-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 10px;
    }
    
    .presets-section.collapsed .presets-header {
        margin-bottom: 0;
    }

    .presets-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--chat-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }

    .presets-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 3px 8px;
        background: transparent;
        border: none;
        border-radius: 4px;
        color: var(--chat-text-muted);
        font-size: 10px;
        cursor: pointer;
        transition: all var(--chat-transition-fast);
    }

    .presets-toggle:hover {
        background: rgba(255, 255, 255, 0.05);
        color: var(--chat-text-secondary);
    }

    .presets-toggle kc-ui-icon {
        font-size: 14px;
    }

    .preset-group {
        margin-bottom: 8px;
    }

    .preset-group:last-child {
        margin-bottom: 0;
    }

    .preset-group-label {
        font-size: 10px;
        color: var(--chat-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 6px;
    }

    .preset-cards {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
    }

    .preset-card {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 6px 10px;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 6px;
        font-size: 11px;
        color: var(--chat-text-secondary);
        cursor: pointer;
        transition: all 0.12s ease;
    }

    .preset-card:hover:not(.disabled) {
        background: var(--chat-accent-dim);
        border-color: rgba(255, 206, 84, 0.35);
        color: var(--chat-text-primary);
    }

    .preset-card.selected {
        background: rgba(255, 206, 84, 0.18);
        border-color: rgba(255, 206, 84, 0.5);
        color: var(--chat-accent);
    }

    .preset-card.disabled {
        opacity: 0.35;
        cursor: not-allowed;
    }

    .preset-card.disabled:hover {
        background: rgba(255, 255, 255, 0.06);
        border-color: rgba(255, 255, 255, 0.12);
    }

    .preset-icon {
        font-size: 13px;
    }

    .preset-title {
        font-weight: 500;
        font-family: inherit;
    }
`;

// =============================================================================
// Context Items Styles
// =============================================================================

export const contextStyles = css`
    .context-section {
        padding: 10px 14px;
        border-bottom: 1px solid var(--chat-panel-border);
    }

    .context-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
    }

    .context-label {
        font-size: 11px;
        font-weight: 600;
        color: var(--chat-text-muted);
        text-transform: uppercase;
        letter-spacing: 0.08em;
    }

    .context-count {
        font-size: 10px;
        color: var(--chat-text-muted);
        padding: 2px 6px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 10px;
    }

    .context-items {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        max-height: 80px;
        overflow-y: auto;
        overflow-x: hidden;
    }

    .context-item {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 8px;
        background: rgba(255, 206, 84, 0.1);
        border: 1px solid rgba(255, 206, 84, 0.25);
        border-radius: 5px;
        font-size: 11px;
        color: var(--chat-accent);
        cursor: pointer;
        transition: all var(--chat-transition-fast);
        max-width: 140px;
    }
    
    .context-item-label {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .context-item:hover {
        background: rgba(255, 206, 84, 0.2);
        border-color: rgba(255, 206, 84, 0.4);
    }

    .context-item-remove {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 14px;
        height: 14px;
        margin-left: 2px;
        background: transparent;
        border: none;
        border-radius: 50%;
        color: currentColor;
        opacity: 0.6;
        cursor: pointer;
        transition: all var(--chat-transition-fast);
    }

    .context-item-remove:hover {
        background: rgba(255, 100, 100, 0.2);
        color: #ff6b6b;
        opacity: 1;
    }

    .context-item-remove kc-ui-icon {
        font-size: 12px;
    }
    
    .context-expand-btn,
    .context-collapse-btn {
        display: inline-flex;
        align-items: center;
        padding: 4px 10px;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 5px;
        font-size: 11px;
        color: var(--chat-text-secondary);
        cursor: pointer;
        transition: all var(--chat-transition-fast);
    }
    
    .context-expand-btn:hover,
    .context-collapse-btn:hover {
        background: rgba(255, 255, 255, 0.1);
        color: var(--chat-text-primary);
    }
`;

// =============================================================================
// Markdown Content Styles
// =============================================================================

export const contentStyles = css`
    .message-content h1,
    .message-content h2,
    .message-content h3,
    .message-content h4 {
        margin: 0.8em 0 0.4em 0;
        line-height: 1.3;
    }

    .message-content h1:first-child,
    .message-content h2:first-child,
    .message-content h3:first-child {
        margin-top: 0;
    }

    .message-content h1 {
        font-size: 1.2em;
        font-weight: 700;
        color: var(--chat-accent);
        border-bottom: 1px solid rgba(255, 206, 84, 0.3);
        padding-bottom: 0.25em;
    }

    .message-content h2 {
        font-size: 1.1em;
        font-weight: 600;
        color: var(--chat-accent);
    }

    .message-content h3 {
        font-size: 1em;
        font-weight: 600;
        color: #fbbf24;
    }

    .message-content h4 {
        font-size: 0.95em;
        font-weight: 600;
        color: var(--chat-text-secondary);
    }

    .message-content p {
        margin: 0.5em 0;
    }

    .message-content ul,
    .message-content ol {
        margin: 0.5em 0;
        padding-left: 1.5em;
    }

    .message-content li {
        margin: 0.25em 0;
    }

    .message-content strong {
        color: #fbbf24;
        font-weight: 600;
    }

    .message-content em {
        color: var(--chat-text-secondary);
    }

    .message-content code {
        font-family: "JetBrains Mono", "Fira Code", monospace;
        font-size: 0.9em;
        padding: 0.15em 0.4em;
        background: rgba(255, 255, 255, 0.08);
        border-radius: 3px;
        color: #60a5fa;
    }

    .message-content pre {
        margin: 0.75em 0;
        padding: 0.75em 1em;
        background: rgba(0, 0, 0, 0.4);
        border-radius: 6px;
        overflow-x: auto;
    }

    .message-content pre code {
        padding: 0;
        background: transparent;
        font-size: 0.85em;
        line-height: 1.5;
    }

    .message-content a {
        color: #60a5fa;
        text-decoration: none;
        border-bottom: 1px dotted rgba(96, 165, 250, 0.5);
        transition: all var(--chat-transition-fast);
    }

    .message-content a:hover {
        color: #93c5fd;
        border-bottom-color: #93c5fd;
    }

    .message-content blockquote {
        margin: 0.75em 0;
        padding: 0.5em 1em;
        border-left: 3px solid rgba(255, 206, 84, 0.4);
        background: rgba(255, 206, 84, 0.05);
        color: var(--chat-text-secondary);
    }

    .message-content hr {
        margin: 1em 0;
        border: none;
        border-top: 1px solid rgba(255, 255, 255, 0.1);
    }
`;

// =============================================================================
// Loading & Status Styles
// =============================================================================

export const statusStyles = css`
    .loading-indicator {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 12px 16px;
        background: rgba(255, 206, 84, 0.05);
        border: 1px solid rgba(255, 206, 84, 0.15);
        border-radius: 8px;
        margin: 8px 0;
    }

    .loading-spinner {
        width: 20px;
        height: 20px;
        border: 2px solid rgba(255, 206, 84, 0.2);
        border-top-color: var(--chat-accent);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }

    .loading-text {
        font-size: 12px;
        color: var(--chat-text-secondary);
    }

    .thinking-indicator {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 12px;
        background: var(--chat-thinking-bg);
        border: 1px solid rgba(147, 51, 234, 0.3);
        border-radius: 16px;
        color: rgb(192, 132, 252);
        font-size: 11px;
        margin-bottom: 8px;
        animation: thinkingPulse 2s ease-in-out infinite;
    }

    .thinking-indicator kc-ui-icon {
        font-size: 14px;
        animation: thinkingSpin 3s linear infinite;
    }

    @keyframes thinkingPulse {
        0%, 100% { opacity: 0.7; }
        50% { opacity: 1; }
    }

    @keyframes thinkingSpin {
        to { transform: rotate(360deg); }
    }
`;

// =============================================================================
// Overlay Mode Styles
// =============================================================================

export const overlayStyles = css`
    /* Overlay backdrop */
    .overlay-backdrop {
        /* No backdrop - transparent so schematic shows through */
        display: none;
    }

    /* Overlay mode container - integrated into UI */
    .chat-container.overlay-mode {
        position: fixed;
        top: 20px;
        left: 280px; /* Avoid left sidebar */
        right: 20px;
        bottom: 20px;
        width: auto;
        height: auto;
        max-width: none;
        z-index: 1000;
        /* Remove scale animation - just fade in */
        animation: fadeInOverlay 0.2s ease;
        /* Make it look integrated, not floating */
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3);
    }

    @keyframes fadeInOverlay {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    /* Adjust overlay for smaller screens */
    @media (max-width: 768px) {
        .chat-container.overlay-mode {
            left: 10px;
            right: 10px;
            top: 10px;
            bottom: 10px;
        }
    }
`;

// =============================================================================
// History Panel Styles
// =============================================================================

export const historyPanelStyles = css`
    .history-panel {
        position: absolute;
        top: var(--chat-header-height);
        left: 0;
        right: 0;
        bottom: 0;
        background: var(--chat-panel-bg);
        z-index: 10;
        display: flex;
        flex-direction: column;
        animation: slideIn 0.2s ease;
    }

    @keyframes slideIn {
        from {
            opacity: 0;
            transform: translateY(-10px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .history-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        border-bottom: 1px solid var(--chat-panel-border);
        flex-shrink: 0;
    }

    .history-title {
        font-size: 14px;
        font-weight: 600;
        color: var(--chat-text-primary);
    }

    .history-actions {
        display: flex;
        align-items: center;
        gap: 4px;
    }

    .history-actions button,
    .history-close {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        background: transparent;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        color: var(--chat-text-secondary);
        transition: all var(--chat-transition-fast);
    }

    .history-actions button:hover,
    .history-close:hover {
        background: rgba(255, 255, 255, 0.08);
        color: var(--chat-text-primary);
    }

    .clear-all-history:hover {
        background: rgba(255, 100, 100, 0.15);
        color: #ff6b6b;
    }

    .history-list {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
    }

    .history-empty {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100px;
        color: var(--chat-text-muted);
        font-size: 13px;
    }

    .history-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 10px 12px;
        margin-bottom: 4px;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid rgba(255, 255, 255, 0.06);
        border-radius: 6px;
        cursor: pointer;
        transition: all var(--chat-transition-fast);
    }

    .history-item:hover {
        background: rgba(255, 255, 255, 0.06);
        border-color: rgba(255, 255, 255, 0.12);
    }

    .history-item.active {
        background: rgba(255, 206, 84, 0.1);
        border-color: rgba(255, 206, 84, 0.25);
    }

    .history-item-content {
        flex: 1;
        min-width: 0;
    }

    .history-item-title {
        font-size: 13px;
        font-weight: 500;
        color: var(--chat-text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-bottom: 2px;
    }

    .history-item-meta {
        font-size: 11px;
        color: var(--chat-text-muted);
    }

    .history-item-actions {
        display: flex;
        align-items: center;
        gap: 2px;
        opacity: 0;
        transition: opacity var(--chat-transition-fast);
    }

    .history-item:hover .history-item-actions {
        opacity: 1;
    }

    .history-item-download,
    .history-item-delete {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 26px;
        height: 26px;
        background: transparent;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        color: var(--chat-text-muted);
        transition: all var(--chat-transition-fast);
    }

    .history-item-download:hover {
        background: rgba(96, 165, 250, 0.15);
        color: #60a5fa;
    }

    .history-item-delete:hover {
        background: rgba(255, 100, 100, 0.15);
        color: #ff6b6b;
    }

    .history-item-download kc-ui-icon,
    .history-item-delete kc-ui-icon {
        font-size: 16px;
    }
`;

// =============================================================================
// Combined Styles Export
// =============================================================================

export const chatPanelStyles = [
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
];

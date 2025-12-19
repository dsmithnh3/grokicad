/*
    Chat Service - Core service for AI chat communication.
    
    Provides a generic interface for streaming AI chat that can be used
    with any extension. Handles message management, streaming, and error handling.
*/

import { xaiClient, Message } from "../../services/xai-client";
import { xaiSettings } from "../../services/xai-settings";
import type {
    ChatMessage,
    ChatContext,
    ChatExtension,
    StreamingCallbacks,
} from "./types";

/**
 * Chat Service - manages AI chat sessions with extension support.
 */
export class ChatService {
    private _abortController: AbortController | null = null;
    private _messages: ChatMessage[] = [];
    private _extension: ChatExtension | null = null;
    private _context: ChatContext = {};
    
    /** Get the current messages */
    get messages(): ChatMessage[] {
        return [...this._messages];
    }
    
    /** Get the current context */
    get context(): ChatContext {
        return { ...this._context };
    }
    
    /** Check if the service is configured (has API key) */
    get isConfigured(): boolean {
        return xaiSettings.isConfigured;
    }
    
    /** Check if a query is currently streaming */
    get isStreaming(): boolean {
        return this._abortController !== null;
    }
    
    /**
     * Set the active extension for this chat session.
     */
    async setExtension(extension: ChatExtension, context?: ChatContext): Promise<void> {
        // Dispose previous extension if any
        if (this._extension?.dispose) {
            this._extension.dispose();
        }
        
        this._extension = extension;
        
        if (context) {
            this._context = context;
        }
        
        // Initialize the new extension
        if (extension.initialize) {
            await extension.initialize(this._context);
        }
    }
    
    /**
     * Update the context for the current session.
     */
    updateContext(context: Partial<ChatContext>): void {
        this._context = { ...this._context, ...context };
    }
    
    /**
     * Add a message to the conversation history.
     */
    addMessage(message: Omit<ChatMessage, "id" | "timestamp">): ChatMessage {
        const fullMessage: ChatMessage = {
            ...message,
            id: this._generateId(),
            timestamp: new Date(),
        };
        this._messages.push(fullMessage);
        return fullMessage;
    }
    
    /**
     * Clear the conversation history.
     */
    clearMessages(): void {
        this._messages = [];
    }
    
    /**
     * Abort any in-progress streaming request.
     */
    abort(): void {
        if (this._abortController) {
            this._abortController.abort();
            this._abortController = null;
        }
        xaiClient.abort();
    }
    
    /**
     * Send a query and stream the response.
     */
    async streamQuery(
        query: string,
        callbacks: StreamingCallbacks,
        thinkingMode: boolean = false,
    ): Promise<void> {
        if (!this._extension) {
            callbacks.onError?.("No extension configured");
            return;
        }
        
        if (!xaiSettings.isConfigured) {
            callbacks.onError?.(
                "xAI API key not configured. Please add your API key in settings.",
            );
            return;
        }
        
        // Abort any existing request
        this.abort();
        this._abortController = new AbortController();
        
        try {
            // Add user message to history
            this.addMessage({
                role: "user",
                content: query,
            });
            
            // Build context using the extension
            const built = await this._extension.buildContext(
                this._context,
                query,
                this._messages.slice(0, -1), // Exclude the message we just added
            );
            
            // Build message array for the API
            const messages: Message[] = [
                Message.system(built.systemPrompt),
                ...(built.additionalMessages || []),
                Message.user(built.userPrompt),
            ];
            
            // Add assistant message as placeholder
            const assistantMessage = this.addMessage({
                role: "assistant",
                content: "",
                isStreaming: true,
            });
            
            // Track accumulated content
            let fullContent = "";
            let thinkingContent = "";
            
            // Stream the response
            await xaiClient.streamChatCompletion(
                messages,
                {
                    onStart: () => {
                        callbacks.onStart?.();
                    },
                    onChunk: (content, isThinking) => {
                        if (isThinking) {
                            thinkingContent += content;
                            callbacks.onChunk?.(content, true);
                        } else {
                            fullContent += content;
                            callbacks.onChunk?.(content, false);
                        }
                    },
                    onComplete: () => {
                        // Update the assistant message with final content
                        const msgIndex = this._messages.findIndex(
                            m => m.id === assistantMessage.id
                        );
                        if (msgIndex !== -1) {
                            const existing = this._messages[msgIndex]!;
                            this._messages[msgIndex] = {
                                id: existing.id,
                                role: existing.role,
                                timestamp: existing.timestamp,
                                content: fullContent,
                                isStreaming: false,
                                metadata: thinkingContent
                                    ? { thinkingContent }
                                    : undefined,
                            };
                        }
                        
                        callbacks.onComplete?.(fullContent, thinkingContent);
                    },
                    onError: (error) => {
                        // Update the assistant message with error
                        const msgIndex = this._messages.findIndex(
                            m => m.id === assistantMessage.id
                        );
                        if (msgIndex !== -1) {
                            const existing = this._messages[msgIndex]!;
                            this._messages[msgIndex] = {
                                id: existing.id,
                                role: existing.role,
                                timestamp: existing.timestamp,
                                content: "",
                                isStreaming: false,
                                error,
                            };
                        }
                        
                        callbacks.onError?.(error);
                    },
                },
                thinkingMode && (this._extension.supportsThinking !== false),
            );
        } catch (err) {
            console.error("[ChatService] Stream error:", err);
            callbacks.onError?.(
                err instanceof Error ? err.message : "Failed to connect to AI",
            );
        } finally {
            this._abortController = null;
        }
    }
    
    /**
     * Dispose of the service and cleanup.
     */
    dispose(): void {
        this.abort();
        if (this._extension?.dispose) {
            this._extension.dispose();
        }
        this._extension = null;
        this._messages = [];
        this._context = {};
    }
    
    private _generateId(): string {
        return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    }
}

/** Create a new chat service instance */
export function createChatService(): ChatService {
    return new ChatService();
}


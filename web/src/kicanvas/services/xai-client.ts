/*
    XAI Client - TypeScript client for the xAI/Grok API.
    
    This is a browser-based implementation that directly calls the xAI API
    with support for streaming responses via Server-Sent Events.
*/

import { xaiSettings } from "./xai-settings";

/** Message role types for xAI API */
export type MessageRole = "system" | "user" | "assistant";

/** A message in the chat completion request */
export interface Message {
    role: MessageRole;
    content: string;
}

/** Reasoning effort level for thinking mode */
export type ReasoningEffort = "low" | "high";

/** Reasoning configuration for thinking mode */
export interface ReasoningConfig {
    effort: ReasoningEffort;
}

/** Chat completion request for xAI API */
export interface ChatCompletionRequest {
    messages: Message[];
    model: string;
    stream?: boolean;
    reasoning?: ReasoningConfig;
}

/** Delta content from streaming response */
export interface StreamDelta {
    role?: string;
    content?: string;
    reasoning_content?: string;
}

/** A streaming choice */
export interface StreamChoice {
    index?: number;
    delta?: StreamDelta;
    finish_reason?: string | null;
}

/** Streaming chunk from xAI API */
export interface StreamChunk {
    id?: string;
    object?: string;
    created?: number;
    model?: string;
    choices: StreamChoice[];
}

/** Callbacks for streaming events */
export interface StreamCallbacks {
    /** Called when streaming starts */
    onStart?: () => void;
    /** Called for each content chunk received */
    onChunk?: (content: string, isThinking: boolean) => void;
    /** Called when streaming completes successfully */
    onComplete?: (fullContent: string, thinkingContent: string) => void;
    /** Called when an error occurs */
    onError?: (error: string) => void;
}

/** Helper to create messages */
export const Message = {
    system: (content: string): Message => ({ role: "system", content }),
    user: (content: string): Message => ({ role: "user", content }),
    assistant: (content: string): Message => ({ role: "assistant", content }),
};

/**
 * XAI API Client.
 * Handles chat completions with streaming support.
 */
export class XAIClient {
    private abortController: AbortController | null = null;

    /**
     * Check if the client is configured (has API key).
     */
    get isConfigured(): boolean {
        return xaiSettings.isConfigured;
    }

    /**
     * Abort any in-progress request.
     */
    abort(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    /**
     * Make a streaming chat completion request.
     * 
     * @param messages - Array of messages in the conversation
     * @param callbacks - Callbacks for streaming events
     * @param thinkingMode - Whether to enable reasoning/thinking mode
     */
    async streamChatCompletion(
        messages: Message[],
        callbacks: StreamCallbacks,
        thinkingMode: boolean = false,
    ): Promise<void> {
        if (!xaiSettings.isConfigured) {
            callbacks.onError?.("xAI API key not configured. Please add your API key in settings.");
            return;
        }

        // Abort any existing request
        this.abort();
        this.abortController = new AbortController();

        const request: ChatCompletionRequest = {
            messages,
            model: thinkingMode ? xaiSettings.thinkingModel : xaiSettings.model,
            stream: true,
        };

        if (thinkingMode) {
            request.reasoning = { effort: "low" };
        }

        try {
            const response = await fetch(xaiSettings.baseUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${xaiSettings.apiKey}`,
                },
                body: JSON.stringify(request),
                signal: this.abortController.signal,
            });

            if (!response.ok) {
                const errorText = await response.text().catch(() => "");
                
                if (response.status === 401) {
                    callbacks.onError?.("Invalid API key. Please check your xAI API key in settings.");
                    return;
                }
                if (response.status === 429) {
                    callbacks.onError?.("Rate limited. Please wait a moment and try again.");
                    return;
                }
                
                callbacks.onError?.(
                    `API error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`
                );
                return;
            }

            callbacks.onStart?.();

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let fullContent = "";
            let thinkingContent = "";

            if (!reader) {
                callbacks.onError?.("No response body");
                return;
            }

            let done = false;
            while (!done) {
                const result = await reader.read();
                done = result.done;

                if (result.value) {
                    buffer += decoder.decode(result.value, { stream: true });

                    // Process complete SSE lines
                    let lineEnd: number;
                    while ((lineEnd = buffer.indexOf("\n")) !== -1) {
                        const line = buffer.slice(0, lineEnd).trim();
                        buffer = buffer.slice(lineEnd + 1);

                        if (!line || !line.startsWith("data: ")) {
                            continue;
                        }

                        const data = line.slice(6);

                        if (data === "[DONE]") {
                            done = true;
                            break;
                        }

                        try {
                            const chunk: StreamChunk = JSON.parse(data);
                            
                            if (chunk.choices?.[0]?.delta) {
                                const delta = chunk.choices[0].delta;
                                
                                // Handle reasoning/thinking content
                                if (delta.reasoning_content) {
                                    thinkingContent += delta.reasoning_content;
                                    callbacks.onChunk?.(delta.reasoning_content, true);
                                }
                                
                                // Handle regular content
                                if (delta.content) {
                                    fullContent += delta.content;
                                    callbacks.onChunk?.(delta.content, false);
                                }
                            }
                        } catch (e) {
                            // Skip invalid JSON chunks (keep-alive messages, etc.)
                            console.debug("[XAIClient] Skipping non-JSON chunk:", data);
                        }
                    }
                }
            }

            callbacks.onComplete?.(fullContent, thinkingContent);
        } catch (e) {
            // Don't report abort errors
            if (e instanceof Error && e.name === "AbortError") {
                return;
            }

            console.error("[XAIClient] Stream error:", e);
            callbacks.onError?.(
                e instanceof Error ? e.message : "Failed to connect to xAI API"
            );
        } finally {
            this.abortController = null;
        }
    }

    /**
     * Make a non-streaming chat completion request.
     * 
     * @param messages - Array of messages in the conversation
     * @returns The assistant's response content
     */
    async chatCompletion(messages: Message[]): Promise<string> {
        if (!xaiSettings.isConfigured) {
            throw new Error("xAI API key not configured");
        }

        const request: ChatCompletionRequest = {
            messages,
            model: xaiSettings.model,
            stream: false,
        };

        const response = await fetch(xaiSettings.baseUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${xaiSettings.apiKey}`,
            },
            body: JSON.stringify(request),
        });

        if (!response.ok) {
            const errorText = await response.text().catch(() => "");
            throw new Error(`API error: ${response.status} ${response.statusText}${errorText ? ` - ${errorText}` : ""}`);
        }

        const data = await response.json();
        return data.choices?.[0]?.message?.content || "";
    }
}

/** Singleton instance for convenience */
export const xaiClient = new XAIClient();


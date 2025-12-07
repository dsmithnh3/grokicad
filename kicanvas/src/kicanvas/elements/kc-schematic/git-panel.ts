/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import { delegate } from "../../../base/events";
import { css, html } from "../../../base/web-components";
import { KCUIElement } from "../../../kc-ui";
import { KiCanvasLoadEvent } from "../../../viewers/base/events";
import { SchematicViewer } from "../../../viewers/schematic/viewer";
import { GrokiAPI, type CommitInfo } from "../../services/api";

function formatDate(isoString: string | null): string {
    if (!isoString) {
        return "Unknown date";
    }

    const date = new Date(isoString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
        return "Today";
    } else if (days === 1) {
        return "Yesterday";
    } else if (days < 7) {
        return `${days} days ago`;
    } else {
        return date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
        });
    }
}

function truncateMessage(message: string | null, maxLength: number = 60): string {
    if (!message) {
        return "No commit message";
    }
    // Get first line only
    const firstLine = message.split("\n")[0] ?? message;
    if (firstLine.length <= maxLength) {
        return firstLine;
    }
    return firstLine.substring(0, maxLength - 3) + "...";
}

export class KCSchematicGitPanelElement extends KCUIElement {
    static override styles = [
        ...KCUIElement.styles,
        css`
            .commit-list {
                display: flex;
                flex-direction: column;
                gap: 0;
            }

            .commit-item {
                display: flex;
                flex-direction: column;
                padding: 0.75em 0.5em;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
                cursor: pointer;
                transition: background 0.2s ease;
                position: relative;
            }

            .commit-item:hover {
                background: rgba(255, 206, 84, 0.1);
            }

            .commit-item.current {
                background: rgba(78, 205, 196, 0.1);
                border-left: 3px solid rgb(78, 205, 196);
            }

            .commit-item.current:hover {
                background: rgba(78, 205, 196, 0.15);
            }

            .commit-header {
                display: flex;
                align-items: center;
                gap: 0.5em;
                margin-bottom: 0.25em;
            }

            .commit-hash {
                font-family: "JetBrains Mono", "SF Mono", monospace;
                font-size: 0.85em;
                color: rgb(255, 206, 84);
                background: rgba(255, 206, 84, 0.15);
                padding: 0.1em 0.4em;
                border-radius: 3px;
            }

            .commit-date {
                font-size: 0.8em;
                color: rgba(255, 255, 255, 0.5);
                margin-left: auto;
            }

            .commit-message {
                font-size: 0.95em;
                color: rgba(255, 255, 255, 0.9);
                margin-bottom: 0.25em;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .current-badge {
                font-size: 0.7em;
                color: rgb(78, 205, 196);
                background: rgba(78, 205, 196, 0.2);
                padding: 0.1em 0.4em;
                border-radius: 3px;
                text-transform: uppercase;
                letter-spacing: 0.05em;
            }

            .timeline {
                position: absolute;
                left: 0.5em;
                top: 0;
                bottom: 0;
                width: 2px;
                background: rgba(255, 255, 255, 0.1);
            }

            .timeline-dot {
                position: absolute;
                left: 0.35em;
                top: 1em;
                width: 8px;
                height: 8px;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.3);
                border: 2px solid rgba(255, 255, 255, 0.1);
            }

            .commit-item.current .timeline-dot {
                background: rgb(78, 205, 196);
                border-color: rgba(78, 205, 196, 0.3);
            }

            .commit-content {
                padding-left: 1.5em;
            }

            .loading {
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 2em;
                color: rgba(255, 255, 255, 0.5);
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
                font-size: 2em;
                margin-bottom: 0.5em;
                opacity: 0.5;
            }
        `,
    ];

    viewer: SchematicViewer;
    commits: CommitInfo[] = [];
    loading = true;
    error: string | null = null;
    currentRepo: string | null = null;
    currentCommit: string | null = null;

    override connectedCallback() {
        (async () => {
            this.viewer = await this.requestLazyContext("viewer");
            await this.viewer.loaded;
            
            // Get repo info from context
            try {
                const repoInfo = await this.requestLazyContext("repoInfo") as { repo: string | null; commit: string | null };
                this.currentRepo = repoInfo.repo;
                this.currentCommit = repoInfo.commit;
            } catch {
                // No repo info available (e.g., drag & drop)
            }
            
            super.connectedCallback();
            this.loadGitHistory();
            this.setupEvents();
        })();
    }

    private setupEvents() {
        // Reload git history when a different schematic is loaded
        this.addDisposable(
            this.viewer.addEventListener(KiCanvasLoadEvent.type, async () => {
                // Re-fetch repo info
                try {
                    const repoInfo = await this.requestLazyContext("repoInfo") as { repo: string | null; commit: string | null };
                    this.currentRepo = repoInfo.repo;
                    this.currentCommit = repoInfo.commit;
                } catch {
                    // No repo info available
                }
                this.loadGitHistory();
            }),
        );

        // Handle commit clicks via event delegation
        delegate(this.renderRoot, ".commit-item", "click", (e, source) => {
            const hash = source.getAttribute("data-hash");
            const commit = this.commits.find((c) => c.commit_hash === hash);
            if (commit) {
                this.onCommitClick(commit);
            }
        });
    }

    private async loadGitHistory() {
        if (!this.currentRepo) {
            this.loading = false;
            this.commits = [];
            this.update();
            return;
        }

        this.loading = true;
        this.error = null;
        this.update();

        try {
            this.commits = await GrokiAPI.getCommits(this.currentRepo);
        } catch (e) {
            this.error = "Failed to load git history";
            console.error("Git history error:", e);
        } finally {
            this.loading = false;
            this.update();
        }
    }

    private onCommitClick(commit: CommitInfo) {
        if (!this.currentRepo || this.currentCommit === commit.commit_hash) {
            return;
        }

        // Dispatch event for shell to handle loading the new commit
        this.dispatchEvent(
            new CustomEvent("commit-select", {
                detail: {
                    repo: this.currentRepo,
                    commit: commit.commit_hash,
                    commitInfo: commit,
                },
                bubbles: true,
                composed: true,
            }),
        );

        // Update current commit locally for UI feedback
        this.currentCommit = commit.commit_hash;
        this.update();
    }

    override render() {
        if (this.loading) {
            return html`
                <kc-ui-panel>
                    <kc-ui-panel-title title="Commit History"></kc-ui-panel-title>
                    <kc-ui-panel-body>
                        <div class="loading">Loading commits...</div>
                    </kc-ui-panel-body>
                </kc-ui-panel>
            `;
        }

        if (this.error) {
            return html`
                <kc-ui-panel>
                    <kc-ui-panel-title title="Commit History"></kc-ui-panel-title>
                    <kc-ui-panel-body>
                        <div class="empty-state">
                            <div class="empty-state-icon">⚠️</div>
                            <div>${this.error}</div>
                        </div>
                    </kc-ui-panel-body>
                </kc-ui-panel>
            `;
        }

        if (!this.currentRepo) {
            return html`
                <kc-ui-panel>
                    <kc-ui-panel-title title="Commit History"></kc-ui-panel-title>
                    <kc-ui-panel-body>
                        <div class="empty-state">
                            <div class="empty-state-icon">📁</div>
                            <div>No repository loaded</div>
                            <div style="font-size: 0.85em; margin-top: 0.5em; opacity: 0.7;">
                                Load a schematic from GitHub to see commit history
                            </div>
                        </div>
                    </kc-ui-panel-body>
                </kc-ui-panel>
            `;
        }

        if (this.commits.length === 0) {
            return html`
                <kc-ui-panel>
                    <kc-ui-panel-title title="Commit History"></kc-ui-panel-title>
                    <kc-ui-panel-body>
                        <div class="empty-state">
                            <div class="empty-state-icon">📁</div>
                            <div>No commits found</div>
                        </div>
                    </kc-ui-panel-body>
                </kc-ui-panel>
            `;
        }

        const commitItems = this.commits.map((commit) => {
            const isCurrent = this.currentCommit === commit.commit_hash;
            const shortHash = commit.commit_hash.substring(0, 7);

            return html`
                <div
                    class="commit-item ${isCurrent ? "current" : ""}"
                    data-hash="${commit.commit_hash}">
                    <div class="timeline"></div>
                    <div class="timeline-dot"></div>
                    <div class="commit-content">
                        <div class="commit-header">
                            <span class="commit-hash">${shortHash}</span>
                            ${isCurrent
                                ? html`<span class="current-badge">Viewing</span>`
                                : null}
                            <span class="commit-date">
                                ${formatDate(commit.commit_date)}
                            </span>
                        </div>
                        <div class="commit-message">
                            ${truncateMessage(commit.message)}
                        </div>
                    </div>
                </div>
            `;
        });

        return html`
            <kc-ui-panel>
                <kc-ui-panel-title title="Commit History"></kc-ui-panel-title>
                <kc-ui-panel-body>
                    <div class="commit-list">${commitItems}</div>
                </kc-ui-panel-body>
            </kc-ui-panel>
        `;
    }
}

window.customElements.define(
    "kc-schematic-git-panel",
    KCSchematicGitPanelElement,
);

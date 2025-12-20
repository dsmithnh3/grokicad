/*
    Copyright (c) 2022 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

import type { IDisposable } from "../disposable";

type ResizeObserverCallback = (target: HTMLElement) => void;

/**
 * Wrapper over ResizeObserver that implmenets IDisposable.
 * Uses requestAnimationFrame to debounce callbacks for better performance,
 * especially on Firefox which fires resize events more frequently.
 */
export class SizeObserver implements IDisposable {
    #observer: ResizeObserver;
    #pending = false;

    constructor(
        public target: HTMLElement,
        private callback: ResizeObserverCallback,
    ) {
        this.#observer = new ResizeObserver(() => {
            // Debounce using rAF to prevent excessive callbacks (Firefox fix)
            if (this.#pending) {
                return;
            }
            this.#pending = true;
            requestAnimationFrame(() => {
                this.#pending = false;
                this.callback(this.target);
            });
        });
        this.#observer.observe(target);
    }

    dispose() {
        this.#observer?.disconnect();
        this.#observer = undefined!;
    }
}

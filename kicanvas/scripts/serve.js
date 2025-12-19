/*
    Copyright (c) 2023 Alethea Katherine Flowers.
    Published under the standard MIT License.
    Full text available at: https://opensource.org/licenses/MIT
*/

/* eslint-env node */

import { bundle } from "./bundle.js";

let context;
let watchStop;

// Cleanup function to properly dispose of esbuild resources
async function cleanup() {
    console.log("\n[serve] Shutting down...");
    try {
        // Stop watch mode if it's running
        if (watchStop) {
            await watchStop();
        }
        // Dispose of the context (this stops the server and cleans up)
        if (context) {
            await context.dispose();
        }
        console.log("[serve] Cleanup complete");
        process.exit(0);
    } catch (err) {
        console.error("[serve] Error during cleanup:", err);
        process.exit(1);
    }
}

// Handle Ctrl+C (SIGINT) and termination signals
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Handle uncaught errors
process.on("uncaughtException", (err) => {
    console.error("[serve] Uncaught exception:", err);
    cleanup();
});

process.on("unhandledRejection", (reason, promise) => {
    console.error("[serve] Unhandled rejection at:", promise, "reason:", reason);
    cleanup();
});

try {
    let bundleResult = await bundle({
        outfile: "debug/kicanvas/kicanvas.js",
        sourcemap: true,
        define: {
            DEBUG: "true",
        },
    });
    context = bundleResult.context;

    // Start watch mode (returns a stop function)
    watchStop = await context.watch();

    // Start the server
    const { host, port } = await context.serve({
        servedir: "./debug",
        port: 8001,
    });

    console.log(`[serve] listening at http://${host}:${port}`);
    console.log(`[serve] Press Ctrl+C to stop`);
} catch (err) {
    console.error("[serve] error:", err);
    if (err.stack) {
        console.error(err.stack);
    }
    await cleanup();
}

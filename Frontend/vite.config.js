import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
    plugins: [react()],

    server: {
        port: 5173,
        proxy: {
            // WebSocket routes MUST come first so Vite's WS upgrade handler
            // picks the right target before the /api rule.
            "/ws": {
                target: "ws://localhost:8001",
                ws: true,
                changeOrigin: true,
            },
            "/api": {
                target: "http://localhost:8001",
                changeOrigin: true,
                // No ws:true here — API routes are HTTP only
            },
        },
    },

    build: {
        // Increase the chunk-size warning limit (WS lib is legitimately large)
        chunkSizeWarningLimit: 600,
        rollupOptions: {
            output: {
                // Split vendors into separate cacheable chunks
                manualChunks(id) {
                    if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
                        return "vendor-react";          // ~140KB – cached aggressively
                    }
                    if (id.includes("node_modules/react-router-dom") || id.includes("node_modules/@remix-run")) {
                        return "vendor-router";
                    }
                    if (id.includes("node_modules/lucide-react")) {
                        return "vendor-icons";          // tree-shaken ~20KB
                    }
                    if (id.includes("node_modules/date-fns")) {
                        return "vendor-dates";
                    }
                    if (id.includes("node_modules/swr")) {
                        return "vendor-swr";            // ~15KB
                    }
                    if (id.includes("node_modules/axios")) {
                        return "vendor-axios";
                    }
                    if (id.includes("node_modules")) {
                        return "vendor-misc";
                    }
                },
            },
        },
    },
}));

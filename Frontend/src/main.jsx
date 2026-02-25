import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { SWRConfig } from "swr";
import App from "./App";
import "./index.css";

const SWR_CONFIG = {
    revalidateOnFocus: false,
    dedupingInterval: 10_000,
    errorRetryCount: 2,
};

ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
        <BrowserRouter>
            <SWRConfig value={SWR_CONFIG}>
                <App />
                <Toaster
                    position="top-right"
                    toastOptions={{
                        style: {
                            background: "#18181f",
                            color: "#f1f5f9",
                            border: "1px solid rgba(255,255,255,0.08)",
                            fontFamily: "Inter, sans-serif",
                            fontSize: "14px",
                        },
                        success: { iconTheme: { primary: "#10b981", secondary: "#fff" } },
                        error: { iconTheme: { primary: "#ef4444", secondary: "#fff" } },
                    }}
                />
            </SWRConfig>
        </BrowserRouter>
    </React.StrictMode>
);

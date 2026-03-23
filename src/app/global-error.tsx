"use client";

import { useState, useEffect, useRef } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [showStack, setShowStack] = useState(false);
  const [copied, setCopied] = useState(false);

  const errorRef = useRef(error);
  useEffect(() => {
    const errorPayload = {
      timestamp: new Date().toISOString(),
      level: "error",
      context: "global-error-boundary",
      message: errorRef.current.message,
      ...(errorRef.current.digest ? { digest: errorRef.current.digest } : {}),
      ...(errorRef.current.stack ? { stack: errorRef.current.stack } : {}),
    };
    console.error(JSON.stringify(errorPayload));
  }, []);

  const isDev = process.env.NODE_ENV === "development";

  const errorDetails = [
    `Error: ${error.message}`,
    error.digest ? `Digest: ${error.digest}` : null,
    error.stack ? `\nStack:\n${error.stack}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(errorDetails);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
    }
  };

  return (
    <html lang="en" className="dark">
      <body style={{ margin: 0, backgroundColor: "#0a0a0a", color: "#e5e5e5" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            fontFamily: "system-ui, -apple-system, sans-serif",
            padding: "24px",
          }}
        >
          <div
            style={{
              maxWidth: 560,
              width: "100%",
              textAlign: "center",
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: "50%",
                backgroundColor: "rgba(239, 68, 68, 0.15)",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
              }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#ef4444"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
            </div>

            <h2 style={{ fontSize: 20, fontWeight: 600, margin: "0 0 8px 0" }}>
              Something went wrong
            </h2>

            <p
              style={{
                fontSize: 14,
                color: "#a3a3a3",
                margin: "0 0 8px 0",
                wordBreak: "break-word",
              }}
            >
              {error.message || "An unexpected error occurred."}
            </p>

            {error.digest && (
              <p
                style={{
                  fontSize: 12,
                  color: "#737373",
                  margin: "0 0 20px 0",
                  fontFamily: "monospace",
                }}
              >
                Digest: {error.digest}
              </p>
            )}

            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "center",
                flexWrap: "wrap",
                marginBottom: 20,
              }}
            >
              <button
                onClick={reset}
                style={{
                  padding: "8px 20px",
                  cursor: "pointer",
                  backgroundColor: "#e5e5e5",
                  color: "#0a0a0a",
                  border: "none",
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                Try again
              </button>
              <button
                onClick={handleCopy}
                style={{
                  padding: "8px 20px",
                  cursor: "pointer",
                  backgroundColor: "transparent",
                  color: "#a3a3a3",
                  border: "1px solid #333",
                  borderRadius: 6,
                  fontSize: 14,
                  fontWeight: 500,
                }}
              >
                {copied ? "Copied!" : "Copy error details"}
              </button>
            </div>

            {isDev && error.stack && (
              <div style={{ textAlign: "left" }}>
                <button
                  onClick={() => setShowStack(!showStack)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#737373",
                    fontSize: 12,
                    cursor: "pointer",
                    padding: "4px 0",
                    marginBottom: 8,
                  }}
                >
                  {showStack ? "▼ Hide stack trace" : "▶ Show stack trace"}
                </button>
                {showStack && (
                  <pre
                    style={{
                      fontSize: 11,
                      color: "#a3a3a3",
                      backgroundColor: "#171717",
                      border: "1px solid #262626",
                      borderRadius: 6,
                      padding: 12,
                      overflow: "auto",
                      maxHeight: 300,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      margin: 0,
                    }}
                  >
                    {error.stack}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}

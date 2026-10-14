# StreamLens

StreamLens is a Manifest V3 Chrome extension prototype for watching streaming API responses in a dedicated DevTools panel.

## What it captures

- `fetch` responses identified as streams by streaming content type; ordinary responses are shown once after the body completes
- Server-Sent Events through `EventSource`
- WebSocket text frames and binary-frame markers

The extension keeps data for the inspected tab in the current browser session, including when Chrome suspends and restarts the extension service worker. Stored response text is bounded to keep within browser session-storage limits. Sensitive request and response header values are redacted before they leave the page context.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked** and select this directory.
4. Open a page that uses a streaming endpoint.
5. Open DevTools and choose the **StreamLens** panel.
6. Reload the page so the capture hook is installed before application code runs.

The toolbar popup can turn capture on or off for the current tab. The panel supports request filtering, live updates, raw text, headers, copying the response, clearing the session, and exporting captured data as JSON.

## Known prototype limits

- Chrome internal pages and pages with restricted injection cannot be captured.
- Session data is cleared when the tab closes or the extension is reloaded.
- Streamed `application/json` responses without a streaming content type cannot be distinguished reliably from ordinary JSON; they are shown as one completed response.
- `fetch` request headers are intentionally filtered and not all browser-generated headers are visible. Request bodies are shown when provided as a string or URL-encoded form body.
- SSE rendering is optimized for common `data:` events and the panel keeps a bounded in-memory history.

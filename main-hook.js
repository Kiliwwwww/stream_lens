(() => {
  if (window.__streamLensInstalled) return;
  window.__streamLensInstalled = true;

  let enabled = true;
  let sequence = 0;
  const MAX_CAPTURED_CHUNKS = 600;
  const MAX_CAPTURED_BYTES = 8 * 1024 * 1024;
  const NativeFetch = window.fetch;
  const NativeEventSource = window.EventSource;
  const NativeWebSocket = window.WebSocket;

  function emit(kind, payload) {
    if (!enabled) return;
    window.postMessage({
      source: "streamlens-hook",
      kind,
      payload
    }, "*");
  }

  function id(prefix) {
    sequence += 1;
    return `${prefix}-${Date.now().toString(36)}-${sequence}`;
  }

  function headerObject(headers) {
    const output = {};
    if (!headers) return output;
    try {
      new Headers(headers).forEach((value, key) => {
        output[key] = /authorization|cookie|set-cookie|token|secret|api[-_]?key|password/i.test(key)
          ? "[redacted]"
          : value;
      });
    } catch {
      // Some request init objects contain non-standard header values.
    }
    return output;
  }

  function responseHeaders(response) {
    const output = {};
    response.headers.forEach((value, key) => {
      output[key] = /set-cookie|authorization|cookie|token|secret|api[-_]?key|password/i.test(key)
        ? "[redacted]"
        : value;
    });
    return output;
  }

  function requestBody(init) {
    const body = init?.body;
    if (typeof body === "string") return body.slice(0, 128 * 1024);
    if (body instanceof URLSearchParams) return body.toString().slice(0, 128 * 1024);
    return "";
  }

  async function captureRequestBody(request, init, requestId) {
    const immediate = requestBody(init);
    if (immediate) {
      emit("request-body", { id: requestId, requestBody: immediate });
      return;
    }
    if (!request?.body) return;
    try {
      const text = await request.clone().text();
      if (text) emit("request-body", { id: requestId, requestBody: text.slice(0, 128 * 1024) });
    } catch {
      // A binary or already-consumed body is intentionally omitted.
    }
  }

  async function readStream(response, requestId) {
    if (!response.body) {
      emit("request-end", { id: requestId, state: "done", endedAt: Date.now() });
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let seq = 0;
    let capturedBytes = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        if (seq >= MAX_CAPTURED_CHUNKS || capturedBytes >= MAX_CAPTURED_BYTES) {
          emit("request-end", {
            id: requestId,
            state: "truncated",
            error: "Capture limit reached; the page response continues normally.",
            endedAt: Date.now()
          });
          await reader.cancel();
          return;
        }
        const text = decoder.decode(result.value, { stream: true });
        emit("chunk", {
          id: requestId,
          seq,
          text,
          bytes: result.value.byteLength,
          time: Date.now()
        });
        capturedBytes += result.value.byteLength;
        seq += 1;
      }
      const tail = decoder.decode();
      if (tail) emit("chunk", { id: requestId, seq, text: tail, bytes: tail.length, time: Date.now() });
      emit("request-end", { id: requestId, state: "done", endedAt: Date.now() });
    } catch (error) {
      emit("request-end", {
        id: requestId,
        state: "error",
        error: error?.message || String(error),
        endedAt: Date.now()
      });
    }
  }

  window.fetch = async function streamLensFetch(input, init) {
    const requestId = id("fetch");
    const request = input instanceof Request ? input : null;
    const url = typeof input === "string" ? input : input?.url || String(input);
    emit("request-start", {
      id: requestId,
      kind: "fetch",
      url,
      method: init?.method || request?.method || "GET",
      requestHeaders: headerObject(init?.headers || request?.headers),
      requestBody: requestBody(init),
      startedAt: Date.now()
    });
    void captureRequestBody(request, init, requestId);
    try {
      const response = await NativeFetch.apply(this, arguments);
      emit("response-start", {
        id: requestId,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get("content-type") || "",
        responseHeaders: responseHeaders(response)
      });
      readStream(response.clone(), requestId);
      return response;
    } catch (error) {
      emit("request-end", { id: requestId, state: "error", error: error?.message || String(error), endedAt: Date.now() });
      throw error;
    }
  };

  if (NativeEventSource) {
    window.EventSource = function StreamLensEventSource(url, config) {
      const requestId = id("sse");
      emit("request-start", {
        id: requestId,
        kind: "sse",
        url: String(url),
        method: "GET",
        startedAt: Date.now()
      });
      const source = new NativeEventSource(url, config);
      source.addEventListener("open", () => emit("response-start", {
        id: requestId,
        status: 200,
        statusText: "OPEN",
        contentType: "text/event-stream"
      }));
      source.addEventListener("message", (event) => emit("chunk", {
        id: requestId,
        seq: sequence,
        text: event.data,
        event: event.type,
        bytes: event.data?.length || 0,
        time: Date.now()
      }));
      source.addEventListener("error", () => {
        if (source.readyState === NativeEventSource.CLOSED) {
          emit("request-end", { id: requestId, state: "done", endedAt: Date.now() });
        }
      });
      return source;
    };
    window.EventSource.prototype = NativeEventSource.prototype;
    window.EventSource.CONNECTING = NativeEventSource.CONNECTING;
    window.EventSource.OPEN = NativeEventSource.OPEN;
    window.EventSource.CLOSED = NativeEventSource.CLOSED;
  }

  if (NativeWebSocket) {
    window.WebSocket = function StreamLensWebSocket(url, protocols) {
      const requestId = id("ws");
      emit("request-start", {
        id: requestId,
        kind: "websocket",
        url: String(url),
        method: "WS",
        startedAt: Date.now()
      });
      const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
      socket.addEventListener("open", () => emit("response-start", {
        id: requestId,
        status: 101,
        statusText: "SWITCHING_PROTOCOLS",
        contentType: "websocket"
      }));
      socket.addEventListener("message", async (event) => {
        const text = typeof event.data === "string"
          ? event.data
          : event.data instanceof Blob
            ? `[binary Blob: ${event.data.size} bytes]`
            : `[binary frame: ${event.data?.byteLength || 0} bytes]`;
        emit("chunk", { id: requestId, seq: sequence, text, event: "message", bytes: text.length, time: Date.now() });
      });
      socket.addEventListener("close", () => emit("request-end", { id: requestId, state: "done", endedAt: Date.now() }));
      socket.addEventListener("error", () => emit("request-end", { id: requestId, state: "error", error: "WebSocket error", endedAt: Date.now() }));
      return socket;
    };
    window.WebSocket.prototype = NativeWebSocket.prototype;
    window.WebSocket.CONNECTING = NativeWebSocket.CONNECTING;
    window.WebSocket.OPEN = NativeWebSocket.OPEN;
    window.WebSocket.CLOSING = NativeWebSocket.CLOSING;
    window.WebSocket.CLOSED = NativeWebSocket.CLOSED;
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "streamlens-bridge") return;
    enabled = Boolean(event.data.enabled);
  });
})();

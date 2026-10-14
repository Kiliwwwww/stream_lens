const sessions = new Map();
const panelPorts = new Map();
const persistTimers = new Map();
const persistWaiters = new Map();
const persistQueues = new Map();
const MAX_REQUESTS = 120;
const MAX_CHUNKS_PER_REQUEST = 600;
const MAX_CHUNK_LENGTH = 64 * 1024;
const MAX_PERSISTED_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_PERSISTED_CHUNKS = 1200;

const sessionsReady = chrome.storage.session.get(null).then((stored) => {
  for (const [key, value] of Object.entries(stored)) {
    if (!key.startsWith("streamlens-session:")) continue;
    const tabId = Number(key.slice("streamlens-session:".length));
    if (!Number.isInteger(tabId)) continue;
    sessions.set(tabId, {
      enabled: value.enabled !== false,
      requests: Array.isArray(value.requests) ? value.requests : [],
      pendingRequests: Array.isArray(value.pendingRequests) ? value.pendingRequests : [],
      createdAt: value.createdAt || Date.now()
    });
  }
}).catch(() => {});

function sessionStorageKey(tabId) {
  return `streamlens-session:${tabId}`;
}

function getSession(tabId) {
  if (!sessions.has(tabId)) {
    sessions.set(tabId, {
      enabled: true,
      requests: [],
      pendingRequests: [],
      createdAt: Date.now()
    });
  }
  return sessions.get(tabId);
}

function snapshotForStorage(session) {
  let remainingTextBytes = MAX_PERSISTED_TEXT_BYTES;
  let remainingChunks = MAX_PERSISTED_CHUNKS;
  const requests = [];
  for (const request of session.requests.slice(-MAX_REQUESTS).reverse()) {
    const persisted = { ...request, chunks: [] };
    for (const chunk of request.chunks.slice().reverse()) {
      const textBytes = (chunk.text || "").length * 2;
      if (textBytes > remainingTextBytes || remainingChunks <= 0) break;
      persisted.chunks.push(chunk);
      remainingTextBytes -= textBytes;
      remainingChunks -= 1;
    }
    persisted.chunks.reverse();
    requests.push(persisted);
    if (remainingTextBytes <= 0) break;
  }
  requests.reverse();
  return {
    enabled: session.enabled,
    requests,
    pendingRequests: session.pendingRequests.slice(-MAX_REQUESTS),
    createdAt: session.createdAt
  };
}

function persistSession(tabId) {
  clearTimeout(persistTimers.get(tabId));
  const promise = new Promise((resolve) => {
    const waiters = persistWaiters.get(tabId) || [];
    waiters.push(resolve);
    persistWaiters.set(tabId, waiters);
  });
  persistTimers.set(tabId, setTimeout(async () => {
    persistTimers.delete(tabId);
    const previousWrite = persistQueues.get(tabId) || Promise.resolve();
    const currentWrite = previousWrite.catch(() => {}).then(() => chrome.storage.session.set({
      [sessionStorageKey(tabId)]: snapshotForStorage(getSession(tabId))
    }));
    persistQueues.set(tabId, currentWrite);
    await currentWrite.catch(() => {
      // The live session remains available for this worker lifetime.
    });
    const waiters = persistWaiters.get(tabId) || [];
    persistWaiters.delete(tabId);
    waiters.forEach((resolve) => resolve());
  }, 250));
  return promise;
}

function broadcast(tabId, message) {
  const ports = panelPorts.get(tabId) || [];
  for (const port of ports) {
    try {
      port.postMessage(message);
    } catch {
      // A panel can disappear while a page is still streaming.
    }
  }
}

function trimSession(session) {
  if (session.requests.length > MAX_REQUESTS) {
    session.requests.splice(0, session.requests.length - MAX_REQUESTS);
  }
}

function isKnownStream(request) {
  return request.kind === "sse" || request.kind === "websocket" ||
    /(?:text\/event-stream|(?:x-)?ndjson|json-seq|stream\+json)/i.test(request.contentType);
}

function promotePendingRequest(tabId, session, request) {
  session.pendingRequests = session.pendingRequests.filter((item) => item.id !== request.id);
  session.requests.push(request);
  trimSession(session);
  broadcast(tabId, { type: "request-start", request });
}

function normalizeEvent(event) {
  if (!event || !event.payload || !event.kind) return null;
  const payload = { ...event.payload };
  if (typeof payload.text === "string") {
    payload.text = payload.text.slice(0, MAX_CHUNK_LENGTH);
  }
  return { kind: event.kind, payload, receivedAt: Date.now() };
}

function handleHookEvent(tabId, rawEvent) {
  const session = getSession(tabId);
  if (!session.enabled) return false;

  const event = normalizeEvent(rawEvent);
  if (!event) return false;
  const { kind, payload } = event;
  let request = session.requests.find((item) => item.id === payload.id);

  if (kind === "request-start") {
    request = {
      id: payload.id,
      kind: payload.kind || "fetch",
      url: payload.url || "",
      method: payload.method || "GET",
      status: null,
      statusText: "",
      contentType: "",
      state: "live",
      startedAt: payload.startedAt || Date.now(),
      endedAt: null,
      bytes: 0,
      chunks: [],
      requestHeaders: payload.requestHeaders || {},
      requestBody: payload.requestBody || "",
      responseHeaders: {}
    };
    if (request.kind === "sse" || request.kind === "websocket") {
      session.requests.push(request);
      trimSession(session);
      broadcast(tabId, { type: "request-start", request });
    } else {
      session.pendingRequests = session.pendingRequests.filter((item) => item.id !== request.id);
      session.pendingRequests.push(request);
      if (session.pendingRequests.length > MAX_REQUESTS) session.pendingRequests.shift();
    }
    return true;
  }

  request ||= session.pendingRequests.find((item) => item.id === payload.id);
  if (!request) return false;

  if (kind === "response-start") {
    request.status = payload.status ?? request.status;
    request.statusText = payload.statusText || "";
    request.contentType = payload.contentType || "";
    request.responseHeaders = payload.responseHeaders || {};
    if (session.requests.includes(request)) {
      broadcast(tabId, { type: "request-update", request });
    } else if (isKnownStream(request)) {
      promotePendingRequest(tabId, session, request);
    }
    return true;
  }

  if (kind === "request-body") {
    request.requestBody = typeof payload.requestBody === "string"
      ? payload.requestBody.slice(0, MAX_CHUNK_LENGTH * 2)
      : "";
    if (session.requests.includes(request)) broadcast(tabId, { type: "request-update", request });
    return true;
  }

  if (kind === "chunk") {
    if (request.chunks.length < MAX_CHUNKS_PER_REQUEST) {
      const chunk = {
        seq: payload.seq ?? request.chunks.length,
        text: payload.text || "",
        time: payload.time || Date.now(),
        event: payload.event || "message",
        bytes: payload.bytes || new Blob([payload.text || ""]).size
      };
      request.chunks.push(chunk);
      request.bytes += chunk.bytes;
      if (!session.requests.includes(request) && isKnownStream(request)) {
        promotePendingRequest(tabId, session, request);
        broadcast(tabId, { type: "request-chunk", requestId: request.id, chunk });
      } else if (session.requests.includes(request)) {
        broadcast(tabId, { type: "request-chunk", requestId: request.id, chunk });
      }
      return true;
    }
    return false;
  }

  if (kind === "request-end") {
    if (!session.requests.includes(request)) {
      session.pendingRequests = session.pendingRequests.filter((item) => item.id !== request.id);
      if (request.kind === "fetch") {
        const body = request.chunks.map((chunk) => chunk.text).join("");
        request.chunks = body ? [{ seq: 0, text: body, time: request.startedAt, event: "response", bytes: request.bytes }] : [];
        promotePendingRequest(tabId, session, request);
        request.state = payload.state || "done";
        request.endedAt = payload.endedAt || Date.now();
        request.error = payload.error || "";
        broadcast(tabId, { type: "request-update", request });
      }
      return true;
    }
    request.state = payload.state || "done";
    request.endedAt = payload.endedAt || Date.now();
    request.error = payload.error || "";
    broadcast(tabId, { type: "request-update", request });
    return true;
  }
  return false;
}

function removePort(tabId, port) {
  const ports = panelPorts.get(tabId) || [];
  const next = ports.filter((item) => item !== port);
  if (next.length) panelPorts.set(tabId, next);
  else panelPorts.delete(tabId);
}

chrome.runtime.onConnect.addListener((port) => {
  if (!port.name.startsWith("panel:")) return;
  const tabId = Number(port.name.slice("panel:".length));
  if (!Number.isInteger(tabId)) return;
  const ports = panelPorts.get(tabId) || [];
  ports.push(port);
  panelPorts.set(tabId, ports);

  port.onMessage.addListener((message) => {
    void sessionsReady.then(async () => {
      const session = getSession(tabId);
      if (message.type === "panel-init") {
        port.postMessage({ type: "snapshot", session });
      }
      if (message.type === "set-enabled") {
        session.enabled = Boolean(message.enabled);
        await persistSession(tabId);
        broadcast(tabId, { type: "capture-state", enabled: session.enabled });
        chrome.tabs.sendMessage(tabId, {
          type: "set-enabled",
          enabled: session.enabled
        }).catch(() => {});
      }
      if (message.type === "clear") {
        session.requests = [];
        session.pendingRequests = [];
        await persistSession(tabId);
        broadcast(tabId, { type: "cleared" });
      }
    });
  });
  port.onDisconnect.addListener(() => removePort(tabId, port));
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab?.id ?? message.tabId;
  if (!Number.isInteger(tabId)) return;

  if (message.type === "hook-event") {
    void sessionsReady.then(async () => {
      if (handleHookEvent(tabId, message.event)) await persistSession(tabId);
      sendResponse({ ok: true });
    });
    return true;
  }

  if (message.type === "get-state") {
    void sessionsReady.then(() => sendResponse({ enabled: getSession(tabId).enabled }));
    return true;
  }

  if (message.type === "set-enabled") {
    void sessionsReady.then(async () => {
      const session = getSession(tabId);
      session.enabled = Boolean(message.enabled);
      await persistSession(tabId);
      broadcast(tabId, { type: "capture-state", enabled: session.enabled });
      chrome.tabs.sendMessage(tabId, message).catch(() => {});
      sendResponse({ enabled: session.enabled });
    });
    return true;
  }

  if (message.type === "clear") {
    void sessionsReady.then(async () => {
      getSession(tabId).requests = [];
      getSession(tabId).pendingRequests = [];
      await persistSession(tabId);
      broadcast(tabId, { type: "cleared" });
      sendResponse({ ok: true });
    });
    return true;
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  sessions.delete(tabId);
  panelPorts.delete(tabId);
  clearTimeout(persistTimers.get(tabId));
  persistTimers.delete(tabId);
  const pendingWrite = persistQueues.get(tabId) || Promise.resolve();
  persistQueues.delete(tabId);
  persistWaiters.get(tabId)?.forEach((resolve) => resolve());
  persistWaiters.delete(tabId);
  void pendingWrite.catch(() => {}).then(() => chrome.storage.session.remove(sessionStorageKey(tabId)));
});

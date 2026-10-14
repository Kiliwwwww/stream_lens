const tabId = chrome.devtools.inspectedWindow.tabId;
let port = null;
let reconnectTimer = null;

const locale = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
const messages = {
  en: {
    liveResponseInspector: "Live response inspector",
    inspectingTab: "Inspecting tab",
    captureOn: "Capture on",
    captureOff: "Capture off",
    clear: "Clear",
    export: "Export",
    requests: "Requests",
    liveNow: "Live now",
    captured: "Captured",
    captureNote: "Only the current tab is captured. Data stays for this browser session.",
    requestFilter: "Request filter",
    all: "All",
    live: "Live",
    filterRequests: "Filter requests",
    waitingForStream: "Waiting for requests",
    triggerStream: "Reload the page or trigger a fetch, SSE, or WebSocket request.",
    noMatchingRequests: "No matching requests",
    selectRequest: "Select a request",
    streamAppears: "Responses will appear here when they are captured.",
    copyResponse: "Copy response",
    requestDetail: "Request detail",
    eventStream: "Event stream",
    rawText: "Raw text",
    headers: "Request & response",
    autoScroll: "Auto-scroll",
    noEventsYet: "No events yet",
    waitingForData: "The connection is open and waiting for data.",
    waitingForResponse: "waiting for response",
    local: "local",
    events: "events",
    event: "event",
    chunk: "chunk",
    message: "message",
    ordinary: "Ordinary",
    streaming: "Streaming",
    response: "Response",
    requestBody: "Request body",
    requestHeaders: "Request headers",
    responseHeaders: "Response headers",
    noHeaders: "No headers captured",
    sessionExported: "Session exported",
    responseCopied: "Response copied",
    done: "done",
    truncated: "truncated",
    error: "error"
  },
  zh: {
    liveResponseInspector: "流式响应查看器",
    inspectingTab: "当前标签页",
    captureOn: "正在捕获",
    captureOff: "已暂停捕获",
    clear: "清空",
    export: "导出",
    requests: "请求",
    liveNow: "实时请求",
    captured: "已捕获",
    captureNote: "仅捕获当前标签页，数据保留在当前浏览器会话中。",
    requestFilter: "请求筛选",
    all: "全部",
    live: "实时",
    filterRequests: "筛选请求",
    waitingForStream: "等待请求",
    triggerStream: "刷新页面，或触发 fetch、SSE、WebSocket 请求。",
    noMatchingRequests: "没有匹配的请求",
    selectRequest: "选择一个请求",
    streamAppears: "捕获到的响应会显示在这里。",
    copyResponse: "复制响应",
    requestDetail: "请求详情",
    eventStream: "事件流",
    rawText: "原始文本",
    headers: "请求与响应",
    autoScroll: "自动滚动",
    noEventsYet: "暂时没有事件",
    waitingForData: "连接已打开，正在等待数据。",
    waitingForResponse: "等待响应",
    local: "本地",
    events: "个事件",
    event: "个事件",
    chunk: "数据块",
    message: "消息",
    ordinary: "普通",
    streaming: "流式",
    response: "响应内容",
    requestBody: "请求体",
    requestHeaders: "请求头",
    responseHeaders: "响应头",
    noHeaders: "没有捕获到请求头",
    sessionExported: "会话已导出",
    responseCopied: "响应已复制",
    done: "已完成",
    truncated: "已截断",
    error: "错误"
  }
};

const t = (key) => messages[locale][key] || messages.en[key] || key;

const state = {
  requests: [],
  selectedId: null,
  filter: "all",
  query: "",
  view: "stream",
  enabled: true
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function applyTranslations() {
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  $$(`[data-i18n]`).forEach((element) => { element.textContent = t(element.dataset.i18n); });
  $$(`[data-i18n-placeholder]`).forEach((element) => { element.placeholder = t(element.dataset.i18nPlaceholder); });
  $$(`[data-i18n-aria-label]`).forEach((element) => { element.setAttribute("aria-label", t(element.dataset.i18nAriaLabel)); });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[character]));
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes > 100 * 1024 ? 0 : 1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(timestamp) {
  return new Date(timestamp).toLocaleTimeString(locale === "zh" ? "zh-CN" : undefined, {
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}

function formatEventCount(count) {
  if (locale === "zh") return `${count} ${t("events")}`;
  return `${count} ${count === 1 ? t("event") : t("events")}`;
}

function statusLabel(status) {
  return status && messages[locale][status] ? t(status) : status;
}

function selectedRequest() {
  return state.requests.find((request) => request.id === state.selectedId) || null;
}

function filteredRequests() {
  const query = state.query.toLowerCase();
  return state.requests.filter((request) => {
    const filterMatch = state.filter === "all" || request.state === "live";
    const queryMatch = !query || `${request.url} ${request.kind} ${request.status}`.toLowerCase().includes(query);
    return filterMatch && queryMatch;
  }).sort((a, b) => b.startedAt - a.startedAt);
}

function renderSummary() {
  const live = state.requests.filter((request) => request.state === "live").length;
  const bytes = state.requests.reduce((sum, request) => sum + (request.bytes || 0), 0);
  $("#request-count").textContent = state.requests.length;
  $("#all-count").textContent = state.requests.length;
  $("#live-count").textContent = live;
  $("#live-filter-count").textContent = live;
  $("#captured-bytes").textContent = formatBytes(bytes);
  $("#capture-toggle").innerHTML = `<span class="status-dot"></span>${t(state.enabled ? "captureOn" : "captureOff")}`;
  $("#capture-toggle").classList.toggle("button-primary", state.enabled);
  $("#capture-toggle").classList.toggle("button-quiet", !state.enabled);
}

function renderRequestList() {
  const requests = filteredRequests();
  const emptyState = $("#empty-state");
  const noRequests = state.requests.length === 0;
  if (requests.length === 0) {
    emptyState.innerHTML = noRequests
      ? `<div class="empty-icon">/</div><strong>${t("waitingForStream")}</strong><p>${t("triggerStream")}</p>`
      : `<div class="empty-icon">?</div><strong>${t("noMatchingRequests")}</strong>`;
    emptyState.classList.remove("is-hidden");
  } else {
    emptyState.classList.add("is-hidden");
  }

  $("#request-list").innerHTML = requests.map((request) => {
    const parsedUrl = (() => { try { return new URL(request.url); } catch { return null; } })();
    const label = parsedUrl ? `${parsedUrl.pathname}${parsedUrl.search}` : request.url;
    const status = request.status || (request.state === "live" ? t("live") : "-");
    return `<button class="request-row ${request.id === state.selectedId ? "is-selected" : ""}" data-request-id="${escapeHtml(request.id)}" type="button" aria-pressed="${request.id === state.selectedId}">
      <span class="request-state-dot ${request.state}"></span>
      <span class="request-copy"><span class="request-url" title="${escapeHtml(request.url)}">${escapeHtml(label || "/")}</span><span class="request-subline"><span class="request-kind">${escapeHtml(request.kind.toUpperCase())}</span><span class="request-kind">${isStreamRequest(request) ? t("streaming") : t("ordinary")}</span><span class="request-time">${formatTime(request.startedAt)}</span></span></span>
      <span class="request-right"><span class="request-status">${escapeHtml(statusLabel(status))}</span><span class="request-bytes">${formatBytes(request.bytes)}</span></span>
    </button>`;
  }).join("");
  $$(`[data-request-id]`).forEach((button) => button.addEventListener("click", () => {
    state.selectedId = button.dataset.requestId;
    render();
  }));
}

function parseSse(raw) {
  const blocks = raw.split(/\r?\n\r?\n/).filter(Boolean);
  return blocks.map((block, index) => {
    const data = block.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    const event = block.match(/^event:\s*(.*)$/m)?.[1] || t("message");
    return { seq: index, text: data || block, event, time: Date.now() };
  });
}

function isSseRequest(request) {
  if (!request) return false;
  return request.kind === "sse" || /text\/event-stream/i.test(request.contentType);
}

function isStreamRequest(request) {
  return request.kind === "sse" || request.kind === "websocket" ||
    /(?:text\/event-stream|(?:x-)?ndjson|json-seq|stream\+json)/i.test(request.contentType);
}

function displayEvents(request) {
  if (!request) return [];
  if (!isStreamRequest(request)) {
    const text = request.chunks.map((chunk) => chunk.text).join("");
    return text ? [{ seq: 0, text, event: t("response"), time: request.endedAt || request.startedAt }] : [];
  }
  const raw = request.chunks.map((chunk) => chunk.text).join("");
  if (isSseRequest(request) && request.kind !== "sse") return parseSse(raw);
  return request.chunks.map((chunk) => ({ ...chunk, event: chunk.event || (request.kind === "websocket" ? t("message") : t("chunk")) }));
}

function prettyContent(text) {
  const trimmed = String(text ?? "").trim();
  if (!trimmed) return { text: "", isJson: false };
  try { return { text: JSON.stringify(JSON.parse(trimmed), null, 2), isJson: true }; } catch { return { text: String(text), isJson: false }; }
}

function createJsonValue(value, key = null, depth = 0, budget = { nodes: 0 }) {
  const row = document.createElement("div");
  row.className = "json-row";
  const isContainer = value !== null && typeof value === "object";
  if (key !== null && !isContainer) {
    const keyElement = document.createElement("span");
    keyElement.className = "json-key";
    keyElement.textContent = `${typeof key === "number" ? key : JSON.stringify(key)}: `;
    row.appendChild(keyElement);
  }

  if (!isContainer) {
    const primitive = document.createElement("span");
    primitive.className = `json-value json-${value === null ? "null" : typeof value}`;
    primitive.textContent = JSON.stringify(value);
    row.appendChild(primitive);
    return row;
  }

  const entries = Array.isArray(value) ? value.map((item, index) => [index, item]) : Object.entries(value);
  const summary = document.createElement("summary");
  summary.className = "json-summary";
  if (key !== null) {
    const keyElement = document.createElement("span");
    keyElement.className = "json-key";
    keyElement.textContent = `${typeof key === "number" ? key : JSON.stringify(key)}: `;
    summary.appendChild(keyElement);
  }
  const preview = document.createElement("span");
  preview.className = "json-bracket";
  preview.textContent = Array.isArray(value) ? "[" : "{";
  const count = document.createElement("span");
  count.className = "json-count";
  const countLabel = Array.isArray(value)
    ? (locale === "zh" ? "项" : entries.length === 1 ? "item" : "items")
    : (locale === "zh" ? "个键" : entries.length === 1 ? "key" : "keys");
  count.textContent = `${entries.length} ${countLabel}`;
  const close = document.createElement("span");
  close.className = "json-bracket";
  close.textContent = Array.isArray(value) ? "]" : "}";
  summary.append(preview, count, close);

  const details = document.createElement("details");
  details.className = "json-node";
  if (depth === 0) details.open = true;
  details.appendChild(summary);
  const children = document.createElement("div");
  children.className = "json-children";
  if (entries.length) {
    for (const [childKey, childValue] of entries) {
      budget.nodes += 1;
      if (budget.nodes > 5000 || depth >= 80) {
        const limit = document.createElement("div");
        limit.className = "json-limit";
        limit.textContent = "...";
        children.appendChild(limit);
        break;
      }
      children.appendChild(createJsonValue(childValue, childKey, depth + 1, budget));
    }
  }
  details.appendChild(children);
  row.appendChild(details);
  return row;
}

function createJsonTree(text) {
  try {
    const value = JSON.parse(text);
    const tree = document.createElement("div");
    tree.className = "json-tree";
    tree.appendChild(createJsonValue(value));
    return tree;
  } catch {
    return null;
  }
}

function createStreamEventElement(event, animate = false) {
  const content = prettyContent(event.text);
  const isDone = content.text === "[DONE]" || content.text === "[done]";
  const element = document.createElement("div");
  element.className = `stream-event${animate ? " stream-event-enter" : ""}`;

  const time = document.createElement("span");
  time.className = "event-time";
  time.textContent = formatTime(event.time);
  const label = document.createElement("span");
  label.className = "event-label";
  label.textContent = event.event || t("chunk");
  const body = document.createElement("span");
  body.className = `event-content${content.isJson ? " json" : ""}${isDone ? " done" : ""}`;
  body.textContent = content.text;

  element.append(time, label, body);
  return element;
}

function scrollStreamToEnd(behavior = "smooth") {
  const stream = $("#stream-view");
  if (!$("#autoscroll").checked) return;
  window.requestAnimationFrame(() => stream.scrollTo({ top: stream.scrollHeight, behavior }));
}

function renderStream(request, shouldScroll = false) {
  const stream = $("#stream-view");
  const responseText = request.chunks.map((chunk) => chunk.text).join("");
  if (!isStreamRequest(request)) {
    const tree = createJsonTree(responseText);
    if (tree) {
      stream.replaceChildren(tree);
      if (shouldScroll) scrollStreamToEnd();
      return;
    }
  }
  const events = displayEvents(request);
  if (!events.length) {
    stream.innerHTML = `<div class="detail-empty"><div class="detail-empty-mark">...</div><h2>${t("noEventsYet")}</h2><p>${t("waitingForData")}</p></div>`;
    return;
  }
  const fragment = document.createDocumentFragment();
  events.forEach((event) => fragment.appendChild(createStreamEventElement(event)));
  stream.replaceChildren(fragment);
  if (shouldScroll) scrollStreamToEnd();
}

function appendStreamEvent(request, chunk) {
  if (state.view !== "stream" || state.selectedId !== request.id) return;
  if (!isStreamRequest(request)) {
    renderStream(request, true);
    return;
  }
  if (isSseRequest(request) && request.kind !== "sse") {
    renderStream(request, true);
    return;
  }
  $("#stream-view").querySelector(".detail-empty")?.remove();
  const element = createStreamEventElement({
    ...chunk,
    event: chunk.event || (request.kind === "websocket" ? t("message") : t("chunk"))
  }, true);
  $("#stream-view").appendChild(element);
  window.requestAnimationFrame(() => element.classList.remove("stream-event-enter"));
  scrollStreamToEnd();
}

function renderHeaders(request) {
  const section = (title, headers) => {
    const rows = Object.entries(headers || {}).map(([key, value]) => `<div class="header-row"><span class="header-key">${escapeHtml(key)}</span><span class="header-value">${escapeHtml(value)}</span></div>`).join("");
    return `<div class="header-section"><h3 class="headers-title">${title}</h3>${rows || `<div class="header-row"><span class="header-key">${t("noHeaders")}</span></div>`}</div>`;
  };
  const body = request.requestBody
    ? `<div class="header-section"><h3 class="headers-title">${t("requestBody")}</h3><pre class="request-body">${escapeHtml(prettyContent(request.requestBody).text)}</pre></div>`
    : "";
  $("#headers-view").innerHTML = body + section(t("requestHeaders"), request.requestHeaders) + section(t("responseHeaders"), request.responseHeaders);
}

function updateDetailHeader(request) {
  const parsedUrl = (() => { try { return new URL(request.url); } catch { return null; } })();
  $("#detail-kind").textContent = request.kind.toUpperCase();
  $("#detail-state").textContent = statusLabel(request.state);
  $("#detail-state").className = `state-badge ${request.state}`;
  $("#detail-status").textContent = request.status ? `${request.status} ${request.statusText || ""}` : t("waitingForResponse");
  $("#detail-url").textContent = request.url;
  $("#detail-url").title = request.url;
  const duration = (request.endedAt || Date.now()) - request.startedAt;
  $("#detail-meta").innerHTML = `<span>${escapeHtml(request.method)}</span><span>${escapeHtml(parsedUrl?.hostname || t("local"))}</span><span>${formatBytes(request.bytes)}</span><span>${duration} ms</span>`;
  $("#chunk-count").textContent = formatEventCount(displayEvents(request).length);
  const responseTab = $("[data-view='stream']");
  responseTab.textContent = isStreamRequest(request) ? t("eventStream") : t("response");
  $("#stream-duration").textContent = `${duration} ms`;
}

function renderDetail() {
  const request = selectedRequest();
  $("#detail-empty").classList.toggle("is-hidden", Boolean(request));
  $("#detail-content").classList.toggle("is-hidden", !request);
  if (!request) return;
  updateDetailHeader(request);
  $("#stream-view").classList.toggle("is-hidden", state.view !== "stream");
  $("#raw-view").classList.toggle("is-hidden", state.view !== "raw");
  $("#headers-view").classList.toggle("is-hidden", state.view !== "headers");
  if (state.view === "stream") renderStream(request);
  if (state.view === "raw") $("#raw-view").textContent = prettyContent(request.chunks.map((chunk) => chunk.text).join("")).text;
  if (state.view === "headers") renderHeaders(request);
}

function render() {
  renderSummary();
  renderRequestList();
  renderDetail();
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("is-visible"), 1800);
}

function exportRequests() {
  const payload = JSON.stringify({ exportedAt: new Date().toISOString(), tabId, requests: state.requests }, null, 2);
  const url = URL.createObjectURL(new Blob([payload], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `streamlens-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  showToast(t("sessionExported"));
}

function handlePanelMessage(message) {
  if (message.type === "snapshot") {
    state.requests = message.session.requests || [];
    state.enabled = message.session.enabled !== false;
    if (!state.requests.some((request) => request.id === state.selectedId)) {
      state.selectedId = state.requests[0]?.id || null;
    }
    render();
  }
  if (message.type === "request-start") {
    state.requests = [message.request, ...state.requests.filter((request) => request.id !== message.request.id)];
    state.selectedId = state.selectedId || message.request.id;
    render();
  }
  if (message.type === "request-update") {
    state.requests = state.requests.map((request) => request.id === message.request.id ? message.request : request);
    render();
  }
  if (message.type === "request-chunk") {
    const request = state.requests.find((item) => item.id === message.requestId);
    if (!request) return;
    request.chunks.push(message.chunk);
    request.bytes += message.chunk.bytes || 0;
    renderSummary();
    renderRequestList();
    if (state.selectedId !== request.id) return;
    updateDetailHeader(request);
    if (state.view === "stream") appendStreamEvent(request, message.chunk);
    if (state.view === "raw") $("#raw-view").textContent = prettyContent(request.chunks.map((chunk) => chunk.text).join("")).text;
  }
  if (message.type === "capture-state") { state.enabled = message.enabled; renderSummary(); }
  if (message.type === "cleared") { state.requests = []; state.selectedId = null; render(); }
}

function connectPanel() {
  if (reconnectTimer) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  const nextPort = chrome.runtime.connect({ name: `panel:${tabId}` });
  port = nextPort;
  nextPort.onMessage.addListener(handlePanelMessage);
  nextPort.onDisconnect.addListener(() => {
    if (port !== nextPort) return;
    port = null;
    reconnectTimer = window.setTimeout(connectPanel, 500);
  });
  nextPort.postMessage({ type: "panel-init" });
}

function sendPanelMessage(message) {
  if (!port) return;
  try {
    port.postMessage(message);
  } catch {
    // The disconnect handler reconnects and requests a fresh snapshot.
  }
}

$("#capture-toggle").addEventListener("click", () => {
  state.enabled = !state.enabled;
  sendPanelMessage({ type: "set-enabled", enabled: state.enabled });
  renderSummary();
});
$("#clear-button").addEventListener("click", () => sendPanelMessage({ type: "clear" }));
$("#export-button").addEventListener("click", exportRequests);
$("#copy-button").addEventListener("click", async () => {
  const request = selectedRequest();
  if (!request) return;
  await navigator.clipboard.writeText(request.chunks.map((chunk) => chunk.text).join(""));
  showToast(t("responseCopied"));
});
$("#request-search").addEventListener("input", (event) => { state.query = event.target.value; renderRequestList(); });
$("#autoscroll").addEventListener("change", () => {
  if (state.view === "stream" && $("#autoscroll").checked) scrollStreamToEnd();
});
$$(`[data-filter]`).forEach((button) => button.addEventListener("click", () => {
  state.filter = button.dataset.filter;
  $$(`[data-filter]`).forEach((item) => item.classList.toggle("is-active", item === button));
  renderRequestList();
}));
$$(`[data-view]`).forEach((button) => button.addEventListener("click", () => {
  state.view = button.dataset.view;
  $$(`[data-view]`).forEach((item) => item.classList.toggle("is-active", item === button));
  renderDetail();
}));

applyTranslations();
$("#tab-origin").textContent = `${t("inspectingTab")} ${tabId}`;
connectPanel();

# StreamLens

**StreamLens 是一个 Chrome DevTools 扩展，用于检查当前标签页的 API 响应。**它会实时展示 SSE、WebSocket 和特定内容类型的 `fetch` 流；普通 `fetch` 响应则在完成后作为一条完整响应展示。请求和响应详情可在专用面板中查看。

**StreamLens is a Chrome DevTools extension for inspecting API responses in the current tab.** It displays SSE, WebSocket, and selected `fetch` streaming responses as they arrive. Ordinary `fetch` responses appear as one complete response after the body finishes. Inspect request and response details in a dedicated DevTools panel.

> 文档语言 / Languages: 简体中文在前，English follows.

## 功能

- **流式响应：**支持 `EventSource`（SSE）、WebSocket，以及响应类型标识为流式格式的 `fetch`。
- **普通响应：**普通 `fetch` 响应只显示一条完整结果，不会把网络读取块误当成多条业务事件。JSON 响应以可展开/折叠的树形结构展示。
- **请求详情：**查看可捕获的请求体、请求头和响应头；敏感头字段会脱敏。可查看原始文本、复制响应或导出会话数据。
- **工作流：**按请求状态筛选、搜索请求、自动滚动、暂停/恢复捕获、清空和导出当前标签页会话。
- **本地化：**界面根据浏览器语言在简体中文和英文之间切换。

## 流式识别规则

StreamLens 不会把每个 `fetch` 都显示成流式事件。以下传输或响应类型会作为流式请求展示：

- 通过 `EventSource` 创建的 SSE 连接。
- WebSocket 连接。
- `fetch` 响应的 `Content-Type` 包含 `text/event-stream`、`ndjson` / `x-ndjson`、`json-seq` 或 `stream+json`。

其他 `fetch` 响应（包括通常的 `application/json`）会等响应体读取完成后再显示为一条普通响应。服务端即使逐步发送数据，如果仍使用普通 JSON 类型，扩展也无法可靠地区分它与普通 JSON 响应。

## 安装

当前版本以未打包扩展的方式加载：

1. 克隆或下载本仓库到本地。
2. 在 Chrome 地址栏打开 `chrome://extensions`。
3. 开启**开发者模式**。
4. 点击**加载已解压的扩展程序**，选择包含 `manifest.json` 的项目目录。
5. 打开要调试的网页，在 Chrome DevTools 中选择 **StreamLens** 面板。
6. 刷新网页后再触发请求，确保捕获脚本在页面代码运行前注入。

## 使用

1. 在浏览器工具栏打开 StreamLens 弹出窗，按需暂停或恢复当前标签页的捕获。
2. 在目标网页触发 API 请求。
3. 在 DevTools 的 StreamLens 面板左侧选择请求。
4. 在**事件流**或**响应内容**视图检查数据；**原始文本**视图显示拼接后的响应文本。
5. 在**请求与响应**视图查看请求体、请求头和响应头。
6. 使用**复制响应**复制所选响应，或使用**导出**下载当前标签页会话的 JSON 文件。

## 权限与数据

扩展声明的权限包括：

- `host_permissions: <all_urls>`：在 Chrome 允许注入扩展脚本的网页中捕获数据。
- `storage`：将会话状态保存到 `chrome.storage.session`，以便 Service Worker 休眠后恢复。数据随浏览器会话保存，不会写入 StreamLens 的外部服务器。
- `tabs`：读取当前标签页并将捕获数据关联到对应标签页。

捕获的数据可能包含 URL、响应内容和请求体。名称匹配 Cookie、Authorization、Token、Secret、API Key、Password 等规则的请求头和响应头会被脱敏；**URL 查询参数和请求/响应正文不会自动脱敏**。请勿在不可信页面上捕获敏感数据，并谨慎分享导出的文件。

## 捕获范围与限制

- 当前捕获 `fetch`、`EventSource` 和 WebSocket；**不捕获 `XMLHttpRequest`**。
- Chrome 内部页面、Chrome Web Store 等不允许扩展注入脚本的页面无法捕获。
- `fetch` 的流式/普通分类依赖传输类型和响应 `Content-Type`，不会仅凭数据到达时间推断流式协议。
- 请求体仅尝试读取文本和 URL 编码表单数据；二进制或无法读取的请求体可能不会显示。
- 为控制资源占用，每个标签页最多保留 120 个请求；每个请求最多 600 个数据块；单块文本最多 64 KiB；单个流式响应最多捕获 8 MiB；会话持久化最多保存 4 MiB 响应文本；请求体最多捕获 128 KiB。达到捕获上限时，响应可能被标记为已截断。
- 捕获响应会产生额外读取与存储开销，尤其是大响应。扩展仅应在需要调试的标签页中启用。

## 常见问题

### 出现 `Uncaught Error: Extension context invalidated`

如果扩展在页面仍打开时被重新加载、更新或禁用，旧页面中的内容脚本可能还在运行，但原扩展上下文已经失效。重新加载或启用扩展，然后刷新目标网页；必要时重新打开 DevTools 面板。

### 没有捕获到请求

- 确认当前标签页的捕获已启用。
- 打开 StreamLens 面板后刷新目标网页，再触发请求。
- 确认页面不是 Chrome 内部页面或其他禁止扩展注入的页面。
- 确认请求使用 `fetch`、`EventSource` 或 WebSocket；XHR 当前不在支持范围内。
- 普通 `fetch` 响应会在响应体结束后才出现。要作为流式请求识别，响应类型需要标记为受支持的流式格式。

### 流式响应被显示为普通响应

检查请求类型和响应的 `Content-Type`。如果服务器以 `application/json` 返回逐步生成的数据，StreamLens 会将其作为普通 JSON 完整响应展示，因为该格式没有提供足够信息来可靠确认其为流式协议。

## 开发

本项目是无需构建步骤的 Manifest V3 扩展，可直接加载项目目录。可运行以下基本检查：

```bash
node --check panel.js
node --check popup.js
node --check background.js
node --check main-hook.js
node -e 'for (const p of ["manifest.json", "_locales/en/messages.json", "_locales/zh_CN/messages.json"]) JSON.parse(require("fs").readFileSync(p, "utf8")); console.log("JSON files valid")'
```

### 项目结构

| 文件 | 说明 |
| --- | --- |
| `manifest.json` | Manifest V3 配置、权限和扩展入口 |
| `main-hook.js` | 页面主世界中的 `fetch`、SSE、WebSocket 捕获钩子 |
| `bridge.js` | 页面与扩展内容脚本之间的消息桥接 |
| `background.js` | 会话管理、数据持久化和面板消息分发 |
| `devtools.html`、`devtools.js` | 注册 Chrome DevTools 面板 |
| `panel.html`、`panel.js`、`panel.css` | 请求查看器界面与交互 |
| `popup.html`、`popup.js`、`popup.css` | 工具栏弹出窗与捕获开关 |
| `_locales/` | Chrome 扩展元数据的英文和简体中文翻译 |
| `icons/` | 扩展图标 |

---

# English

## Features

- **Streaming responses:** Supports SSE through `EventSource`, WebSocket, and `fetch` responses whose content types identify a supported streaming format.
- **Ordinary responses:** A regular `fetch` response is shown as one complete result after its body has finished, rather than as multiple transport chunks. JSON is rendered as an expandable/collapsible tree.
- **Request details:** Inspect available request bodies, request headers, and response headers. Sensitive header values are redacted. View raw text, copy a response, or export session data.
- **Workflow:** Filter by request state, search requests, auto-scroll, pause/resume capture, clear the session, and export data for the current tab.
- **Localization:** The UI switches between English and Simplified Chinese based on the browser language.

## Stream detection

StreamLens does not display every `fetch` as a stream. The following transports or response types are presented as streaming requests:

- SSE connections created with `EventSource`.
- WebSocket connections.
- `fetch` responses with a `Content-Type` containing `text/event-stream`, `ndjson` / `x-ndjson`, `json-seq`, or `stream+json`.

Other `fetch` responses, including typical `application/json` responses, are shown as one ordinary response after the body has been read. If a server sends data incrementally while still declaring a regular JSON content type, the extension cannot reliably distinguish it from an ordinary JSON response.

## Installation

The current version is loaded as an unpacked extension:

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the project directory containing `manifest.json`.
5. Open the page you want to debug, then select the **StreamLens** panel in Chrome DevTools.
6. Reload the page before triggering requests so the capture hooks are installed before the page scripts run.

## Usage

1. Open the StreamLens toolbar popup to pause or resume capture for the current tab.
2. Trigger an API request on the target page.
3. Select the request from the left pane of the StreamLens DevTools panel.
4. Inspect data in **Event stream** or **Response**; **Raw text** shows the combined response text.
5. Open **Request & response** to inspect the request body and available headers.
6. Use **Copy response** to copy the selected response or **Export** to download the current tab session as JSON.

## Permissions and data

The extension declares these permissions:

- `host_permissions: <all_urls>`: captures data on pages where Chrome permits extension script injection.
- `storage`: stores session state in `chrome.storage.session` so it can be restored after the extension service worker is suspended. Data is kept for the browser session and is not sent to an external StreamLens server.
- `tabs`: reads the active tab and associates captured data with the corresponding tab.

Captured data may include URLs, response contents, and request bodies. Request and response header values whose names match rules for Cookie, Authorization, Token, Secret, API Key, Password, and similar fields are redacted. **URL query parameters and request/response bodies are not automatically redacted.** Avoid capturing sensitive data on untrusted pages and take care when sharing exported files.

## Scope and limitations

- The current implementation captures `fetch`, `EventSource`, and WebSocket. **`XMLHttpRequest` is not captured.**
- Chrome internal pages, the Chrome Web Store, and other pages that disallow extension script injection cannot be captured.
- `fetch` stream classification relies on transport type and response `Content-Type`; it does not infer a streaming protocol only from the timing of incoming data.
- Request body capture attempts to read text and URL-encoded form data. Binary or unreadable request bodies may not be shown.
- Capture is bounded to control resource usage: up to 120 requests per tab, 600 chunks per request, 64 KiB of text per chunk, 8 MiB per streaming response, 4 MiB of persisted response text per session, and 128 KiB per request body. A response may be marked truncated when a capture limit is reached.
- Capturing responses adds read and storage overhead, especially for large responses. Enable the extension only on tabs that need inspection.

## Troubleshooting

### `Uncaught Error: Extension context invalidated`

If the extension is reloaded, updated, or disabled while the page remains open, the old content script may keep running after its extension context has become invalid. Reload or enable the extension, then refresh the target page. Reopen the DevTools panel if needed.

### No request is captured

- Confirm capture is enabled for the current tab.
- Open the StreamLens panel, reload the target page, and trigger the request again.
- Make sure the page is not a Chrome internal page or another page that blocks extension script injection.
- Confirm the request uses `fetch`, `EventSource`, or WebSocket; XHR is not currently supported.
- Ordinary `fetch` responses appear only after their bodies finish. For streaming classification, the response type must identify a supported streaming format.

### A streaming response is shown as ordinary

Check the request type and response `Content-Type`. If the server returns incrementally generated data as `application/json`, StreamLens displays it as one ordinary JSON response because that format does not provide enough information to reliably identify a streaming protocol.

## Development

This Manifest V3 extension has no build step and can be loaded directly from the project directory. Run these basic checks:

```bash
node --check panel.js
node --check popup.js
node --check background.js
node --check main-hook.js
node -e 'for (const p of ["manifest.json", "_locales/en/messages.json", "_locales/zh_CN/messages.json"]) JSON.parse(require("fs").readFileSync(p, "utf8")); console.log("JSON files valid")'
```

### Project structure

| File | Description |
| --- | --- |
| `manifest.json` | Manifest V3 configuration, permissions, and entry points |
| `main-hook.js` | Page-world hooks for `fetch`, SSE, and WebSocket |
| `bridge.js` | Message bridge between the page and extension content script |
| `background.js` | Session management, persistence, and panel message routing |
| `devtools.html`, `devtools.js` | Chrome DevTools panel registration |
| `panel.html`, `panel.js`, `panel.css` | Request inspector UI and interactions |
| `popup.html`, `popup.js`, `popup.css` | Toolbar popup and capture toggle |
| `_locales/` | English and Simplified Chinese extension metadata |
| `icons/` | Extension icons |

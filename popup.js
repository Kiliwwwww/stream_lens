const locale = navigator.language.toLowerCase().startsWith("zh") ? "zh" : "en";
const messages = {
  en: {
    popupCopy: "Watch streaming API responses in a focused DevTools panel.",
    captureOn: "Capture is on for this tab",
    captureOff: "Capture is off for this tab",
    turnOn: "Turn capture on",
    turnOff: "Turn capture off",
    openDevtools: "Open DevTools instructions",
    pageUnavailable: "This page cannot be captured.",
    devtoolsHint: "Open DevTools, then choose the StreamLens tab."
  },
  zh: {
    popupCopy: "在专用的 DevTools 面板中查看流式 API 响应。",
    captureOn: "当前标签页正在捕获",
    captureOff: "当前标签页已暂停捕获",
    turnOn: "开启捕获",
    turnOff: "暂停捕获",
    openDevtools: "查看 DevTools 使用说明",
    pageUnavailable: "此页面无法捕获。",
    devtoolsHint: "打开 DevTools，然后选择 StreamLens 标签页。"
  }
};
const t = (key) => messages[locale][key] || messages.en[key] || key;

let currentTabId = null;
let enabled = true;

const statusText = document.querySelector("#status-text");
const statusDot = document.querySelector("#status-dot");
const toggleButton = document.querySelector("#toggle");
const message = document.querySelector("#message");

function render() {
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  document.querySelectorAll("[data-i18n]").forEach((element) => { element.textContent = t(element.dataset.i18n); });
  statusText.textContent = enabled ? t("captureOn") : t("captureOff");
  statusDot.style.color = enabled ? "#16845b" : "#9ba5af";
  toggleButton.textContent = enabled ? t("turnOff") : t("turnOn");
  toggleButton.classList.toggle("off", !enabled);
}

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  currentTabId = tabs[0]?.id;
  if (!currentTabId) return;
  chrome.runtime.sendMessage({ type: "get-state", tabId: currentTabId }, (response) => {
    if (chrome.runtime.lastError) return;
    enabled = response?.enabled !== false;
    render();
  });
});

toggleButton.addEventListener("click", () => {
  enabled = !enabled;
  chrome.runtime.sendMessage({ type: "set-enabled", tabId: currentTabId, enabled }, () => {
    if (chrome.runtime.lastError) {
      message.textContent = t("pageUnavailable");
      return;
    }
    render();
  });
});

document.querySelector("#open-devtools").addEventListener("click", () => {
  message.textContent = t("devtoolsHint");
});

render();

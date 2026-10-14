(() => {
  function setPageState(enabled) {
    window.postMessage({ source: "streamlens-bridge", enabled }, "*");
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.data?.source !== "streamlens-hook") return;
    chrome.runtime.sendMessage({
      type: "hook-event",
      event: {
        kind: event.data.kind,
        payload: event.data.payload
      }
    });
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "set-enabled") setPageState(Boolean(message.enabled));
  });

  chrome.runtime.sendMessage({ type: "get-state" }, (response) => {
    if (chrome.runtime.lastError) return;
    setPageState(response?.enabled !== false);
  });
})();

// 在扩展图标上显示「开 / 关」徽标，让用户一眼看到当前状态
function updateBadge(enabled) {
  try {
    chrome.action.setBadgeText({ text: enabled ? "开" : "关" });
    chrome.action.setBadgeBackgroundColor({ color: enabled ? "#2e7d32" : "#c62828" });
  } catch (e) {
    // 某些环境不支持 badge，忽略即可
  }
}

chrome.storage.local.get({ enabled: true }, (r) => updateBadge(!!r.enabled));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.enabled) {
    updateBadge(!!changes.enabled.newValue);
  }
});

// 后台兜底心跳：每 30 秒向所有 Cesim 标签页发一次 tick，触发一次滚动。
// alarm 由扩展后台运行，不受标签页节流影响。
chrome.alarms.create("keepalive-tick", { periodInMinutes: 0.5 });

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "keepalive-tick") return;
  chrome.tabs.query({ url: "*://*.cesim.cn/*" }, (tabs) => {
    for (const t of tabs) {
      if (t.id != null) {
        chrome.tabs.sendMessage(t.id, { type: "tick" }, () => {
          void chrome.runtime.lastError; // 页面未注入时静默忽略
        });
      }
    }
  });
});

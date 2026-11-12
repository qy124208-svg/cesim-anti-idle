const FREQ = {
  slow: { minInterval: 30, maxInterval: 60 },
  normal: { minInterval: 15, maxInterval: 45 },
  fast: { minInterval: 8, maxInterval: 20 },
};

const SCROLL = {
  small: { scrollMin: 80, scrollMax: 350 },
  medium: { scrollMin: 150, scrollMax: 700 },
  large: { scrollMin: 300, scrollMax: 1200 },
};

const CLICK_FREQ = {
  slow: { clickMin: 300, clickMax: 600 },
  normal: { clickMin: 180, clickMax: 360 },
  fast: { clickMin: 60, clickMax: 180 },
};

const HEARTBEAT_FREQ = {
  slow: { heartbeatMin: 900, heartbeatMax: 1500 },
  normal: { heartbeatMin: 480, heartbeatMax: 900 },
  fast: { heartbeatMin: 240, heartbeatMax: 480 },
};

const els = {
  enabled: document.getElementById("enabled"),
  freq: document.getElementById("freq"),
  scroll: document.getElementById("scroll"),
  keepAlive: document.getElementById("keepAlive"),
  mouseMove: document.getElementById("mouseMove"),
  clickEnabled: document.getElementById("clickEnabled"),
  clickFreq: document.getElementById("clickFreq"),
  heartbeatEnabled: document.getElementById("heartbeatEnabled"),
  heartbeatFreq: document.getElementById("heartbeatFreq"),
  status: document.getElementById("status"),
};

function renderStatus(cfg) {
  const last = cfg.lastAction ? new Date(cfg.lastAction) : null;
  const lastHb = cfg.lastHeartbeat ? new Date(cfg.lastHeartbeat) : null;
  const lastText = last ? last.toLocaleTimeString() : "暂无";
  const hbText = lastHb ? lastHb.toLocaleTimeString() : "暂无";
  els.status.textContent = cfg.enabled
    ? `✅ 运行中 · 滚动 ${lastText} · 心跳 ${hbText}`
    : "⏸ 已暂停";
}

async function init() {
  const cfg = await chrome.storage.local.get({
    enabled: true,
    mouseMove: true,
    keepAlive: true,
    clickEnabled: false,
    heartbeatEnabled: true,
    lastAction: 0,
  });
  els.enabled.checked = !!cfg.enabled;
  els.mouseMove.checked = !!cfg.mouseMove;
  els.keepAlive.checked = !!cfg.keepAlive;
  els.clickEnabled.checked = !!cfg.clickEnabled;
  els.heartbeatEnabled.checked = !!cfg.heartbeatEnabled;

  const stored = await chrome.storage.local.get([
    "minInterval",
    "maxInterval",
    "scrollMin",
    "scrollMax",
    "clickMin",
    "clickMax",
    "heartbeatMin",
    "heartbeatMax",
  ]);

  let f = "normal";
  for (const [k, v] of Object.entries(FREQ)) {
    if (v.minInterval === stored.minInterval && v.maxInterval === stored.maxInterval) {
      f = k;
      break;
    }
  }
  els.freq.value = f;

  let s = "large";
  for (const [k, v] of Object.entries(SCROLL)) {
    if (v.scrollMin === stored.scrollMin && v.scrollMax === stored.scrollMax) {
      s = k;
      break;
    }
  }
  els.scroll.value = s;

  let cf = "normal";
  for (const [k, v] of Object.entries(CLICK_FREQ)) {
    if (v.clickMin === stored.clickMin && v.clickMax === stored.clickMax) {
      cf = k;
      break;
    }
  }
  els.clickFreq.value = cf;

  let hf = "normal";
  for (const [k, v] of Object.entries(HEARTBEAT_FREQ)) {
    if (v.heartbeatMin === stored.heartbeatMin && v.heartbeatMax === stored.heartbeatMax) {
      hf = k;
      break;
    }
  }
  els.heartbeatFreq.value = hf;

  renderStatus(cfg);
}

els.enabled.addEventListener("change", () => {
  chrome.storage.local.set({ enabled: els.enabled.checked });
});
els.mouseMove.addEventListener("change", () => {
  chrome.storage.local.set({ mouseMove: els.mouseMove.checked });
});
els.keepAlive.addEventListener("change", () => {
  chrome.storage.local.set({ keepAlive: els.keepAlive.checked });
});
els.freq.addEventListener("change", () => {
  const f = FREQ[els.freq.value];
  chrome.storage.local.set({ minInterval: f.minInterval, maxInterval: f.maxInterval });
});
els.scroll.addEventListener("change", () => {
  const s = SCROLL[els.scroll.value];
  chrome.storage.local.set({ scrollMin: s.scrollMin, scrollMax: s.scrollMax });
});
els.clickEnabled.addEventListener("change", () => {
  chrome.storage.local.set({ clickEnabled: els.clickEnabled.checked });
});
els.clickFreq.addEventListener("change", () => {
  const c = CLICK_FREQ[els.clickFreq.value];
  chrome.storage.local.set({ clickMin: c.clickMin, clickMax: c.clickMax });
});
els.heartbeatEnabled.addEventListener("change", () => {
  chrome.storage.local.set({ heartbeatEnabled: els.heartbeatEnabled.checked });
});
els.heartbeatFreq.addEventListener("change", () => {
  const h = HEARTBEAT_FREQ[els.heartbeatFreq.value];
  chrome.storage.local.set({ heartbeatMin: h.heartbeatMin, heartbeatMax: h.heartbeatMax });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    chrome.storage.local.get(
      { enabled: true, lastAction: 0, lastHeartbeat: 0 },
      renderStatus
    );
  }
});

init();

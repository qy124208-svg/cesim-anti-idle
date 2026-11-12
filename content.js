(() => {
  // 守卫：扩展被重载/卸载后 chrome API 失效，直接退出
  try {
    if (!chrome.runtime || !chrome.runtime.id) return;
  } catch (e) {
    return;
  }

  const DEFAULTS = {
    enabled: true,
    minInterval: 15,   // 秒，滚动最小间隔
    maxInterval: 45,   // 秒，滚动最大间隔（实际每次在 [min,max] 随机）
    mouseMove: true,   // 是否模拟鼠标移动（仅前台，合成事件，不移动真实光标）
    scrollMin: 300,    // 每次滚动最小像素
    scrollMax: 1200,   // 每次滚动最大像素
    keepAlive: true,   // 后台保活（音频防节流）
    clickEnabled: false,     // 是否自动点击（默认关：心跳请求已足够续 session，点击会乱跳页面+可能触发刷新循环）
    clickMin: 180,           // 秒，点击最小间隔（默认 3 分钟）
    clickMax: 360,           // 秒，点击最大间隔（默认 6 分钟）
    heartbeatEnabled: true,  // 是否发心跳请求（真实网络请求，维持服务器 session）
    heartbeatMin: 480,       // 秒，心跳最小间隔（默认 8 分钟）
    heartbeatMax: 900,       // 秒，心跳最大间隔（默认 15 分钟）
  };

  let config = { ...DEFAULTS };
  let timer = null;         // 滚动计时器
  let clickTimer = null;    // 点击计时器
  let heartbeatTimer = null;// 心跳计时器
  let lastActTime = 0;      // 最近滚动时间
  let lastClickTime = 0;    // 最近点击时间
  let lastHeartbeatTime = 0;// 最近心跳时间
  let actCount = 0;
  let clickCount = 0;
  let heartbeatCount = 0;
  let scrollTargetsCache = null;
  let cacheTime = 0;
  let audioCtx = null;
  let keepAliveBound = false;
  let indicator = null;

  function chromeAlive() {
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  function randInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function elClass(el) {
    try {
      const c = el.className;
      if (typeof c === "string") return c;
      if (c && c.baseVal) return c.baseVal;
    } catch (e) {}
    return "";
  }

  // 找出所有可滚动的目标：主页面 + 内部滚动容器
  function getScrollTargets() {
    const now = Date.now();
    if (scrollTargetsCache && now - cacheTime < 30000) return scrollTargetsCache;

    const targets = [];
    const se = document.scrollingElement || document.documentElement;
    if (se && se.scrollHeight > se.clientHeight + 20) targets.push(se);

    const candidates = document.querySelectorAll(
      "div, section, main, ul, table, form, iframe"
    );
    for (const el of candidates) {
      const s = getComputedStyle(el);
      const oy = s.overflowY;
      if (
        (oy === "auto" || oy === "scroll") &&
        el.scrollHeight > el.clientHeight + 20
      ) {
        targets.push(el);
      }
    }

    scrollTargetsCache = targets;
    cacheTime = now;
    return targets;
  }

  // 上下滚动（到顶/到底时自动反向）。后台用 auto（无动画）确保立即生效
  function scrollPage() {
    const targets = getScrollTargets();
    if (!targets.length) {
      console.log("[Cesim保活] 未找到可滚动目标（页面可能无滚动区域）");
      return;
    }
    const candidates = targets.filter((t) => t.scrollHeight > t.clientHeight + 5);
    if (!candidates.length) {
      console.log("[Cesim保活] 找到目标但无滚动空间");
      return;
    }

    const el = candidates[Math.floor(Math.random() * candidates.length)];
    const maxScroll = el.scrollHeight - el.clientHeight;
    const current = el.scrollTop;
    const dist = randInt(config.scrollMin, config.scrollMax);

    let dir;
    if (current <= 5) dir = 1;
    else if (current >= maxScroll - 5) dir = -1;
    else dir = Math.random() < 0.5 ? 1 : -1;

    const target = Math.max(0, Math.min(maxScroll, current + dir * dist));
    const behavior = document.visibilityState === "visible" ? "smooth" : "auto";
    const name =
      el === (document.scrollingElement || document.documentElement)
        ? "window"
        : el.tagName || el.nodeName;
    console.log(
      `[Cesim保活] 滚动 ${name}: ${Math.round(current)} -> ${Math.round(target)} (可滚 ${Math.round(maxScroll)}px)`
    );
    try {
      el.scrollTo({ top: target, behavior });
    } catch (e) {
      el.scrollTop = target;
    }
  }

  // 模拟鼠标移动（合成事件，绝不移动真实光标，不影响用户在其他窗口的鼠标）
  function simulateMouseMove() {
    try {
      const x = randInt(0, window.innerWidth || 1280);
      const y = randInt(0, window.innerHeight || 800);
      const opts = {
        clientX: x,
        clientY: y,
        bubbles: true,
        cancelable: true,
        view: window,
      };
      document.dispatchEvent(new MouseEvent("mousemove", opts));
      window.dispatchEvent(new MouseEvent("mousemove", opts));
    } catch (e) {
      // 忽略派发失败
    }
  }

  // ============ 新增：自动点击（程序化，不移动真实光标） ============

  // 危险动作词：命中则绝不点击，避免误提交/删除/退出
  const DANGER_RE =
    /submit|confirm|save|delete|reset|clear|sign\s*out|log\s*out|提交|确认|保存|删除|重置|清空|发送|下单|支付|结算|登出|注销|退出|确定/i;

  function isVisible(el) {
    try {
      if (!el.getClientRects || el.getClientRects().length === 0) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) return false;
      const s = getComputedStyle(el);
      if (s.visibility === "hidden" || s.display === "none" || s.opacity === "0") return false;
      return true;
    } catch (e) {
      return false;
    }
  }

  // 找出页面上「安全可点击」的元素：只点导航类页签（tab / menuitem）。
  // 不点 a[href]（会整页跳转→刷新→重注入的循环）、不点普通 button（可能是提交/删除等有副作用的操作）。
  function findClickTargets() {
    const els = document.querySelectorAll('[role="tab"], [role="menuitem"]');
    const safe = [];
    for (const el of els) {
      // 危险词过滤（文本 + aria-label + title + value）
      const text = (el.textContent || "").trim();
      const label =
        el.getAttribute("aria-label") ||
        el.getAttribute("title") ||
        el.value ||
        "";
      if (DANGER_RE.test(text) || DANGER_RE.test(label)) continue;
      if (!isVisible(el)) continue;
      safe.push(el);
    }
    return safe;
  }

  // 从安全目标里随机挑一个（都是导航页签，点击只切换视图产生请求，不整页跳转）
  function pickClickTarget(safe) {
    if (!safe.length) return null;
    return safe[Math.floor(Math.random() * safe.length)];
  }

  function describeEl(el) {
    const tag = el.tagName || el.nodeName;
    const txt = (el.textContent || "").trim().slice(0, 20);
    const cls = elClass(el);
    const role = el.getAttribute("role") || "";
    return `${tag}${role ? "[role=" + role + "]" : ""}${txt ? "(" + txt + ")" : ""}${
      cls ? "." + String(cls).split(/\s+/)[0] : ""
    }`;
  }

  // 执行一次程序化点击。element.click() 会触发真实 click 事件与默认动作（如 tab 切换视图），
  // 但完全不移动真实鼠标光标，也不调用任何系统级鼠标 API。
  function simulateClick() {
    const safe = findClickTargets();
    const target = pickClickTarget(safe);
    if (target) {
      try {
        target.click();
        clickCount += 1;
        lastClickTime = Date.now();
        console.log(`[Cesim保活] 点击 ${describeEl(target)}`);
        updateIndicator();
        if (chromeAlive()) {
          try {
            chrome.storage.local.set({ lastClick: Date.now() });
          } catch (e) {}
        }
        return true;
      } catch (e) {
        // click() 失败则退回合成事件
      }
    }
    // 无安全目标：向当前焦点元素派发一次合成点击（不触发默认动作，仅作为活动信号）
    try {
      const ev = new MouseEvent("click", { bubbles: true, cancelable: true, view: window });
      (document.activeElement || document.body).dispatchEvent(ev);
      clickCount += 1;
      lastClickTime = Date.now();
      console.log("[Cesim保活] 空点击（页面无安全可点击目标）");
      updateIndicator();
    } catch (e) {}
    return false;
  }

  function clickTick() {
    if (!config.enabled || !config.clickEnabled || !chromeAlive()) {
      scheduleClick();
      return;
    }
    // 前后台都点击：挂机时页面常在后台（hidden），后台点击导航 tab 一样会触发请求维持 session
    simulateClick();
    scheduleClick();
  }

  function scheduleClick() {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    if (!config.enabled || !config.clickEnabled) return;
    if (!chromeAlive()) return;
    const delay = randInt(config.clickMin, config.clickMax) * 1000;
    clickTimer = setTimeout(clickTick, delay);
  }

  // ============ 新增：心跳请求（真实网络请求，维持服务器 session） ============

  // 重新请求当前页面（带 session cookie、绕过缓存）。这是「真正防退出」的关键：
  // 滚动/合成事件都只是前端活动，服务器端 session 空闲超时只有真实请求才能续。
  function heartbeat() {
    lastHeartbeatTime = Date.now();
    heartbeatCount += 1;
    updateIndicator();
    if (chromeAlive()) {
      try {
        chrome.storage.local.set({ lastHeartbeat: Date.now() });
      } catch (e) {}
    }
    try {
      fetch(window.location.href, {
        method: "GET",
        cache: "no-store",
        credentials: "include",
        redirect: "follow",
      })
        .then((resp) => {
          console.log(
            `[Cesim保活] 心跳请求 ${resp.status} · ${new Date().toLocaleTimeString()}`
          );
        })
        .catch((e) => {
          console.log("[Cesim保活] 心跳失败", e && e.message ? e.message : e);
        });
    } catch (e) {}
    scheduleHeartbeat();
  }

  function scheduleHeartbeat() {
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (!config.enabled || !config.heartbeatEnabled) return;
    if (!chromeAlive()) return;
    const delay = randInt(config.heartbeatMin, config.heartbeatMax) * 1000;
    heartbeatTimer = setTimeout(heartbeat, delay);
  }

  // ============ 指示器 ============

  // 页面右下角的半透明小指示器，直观确认扩展是否在工作
  function ensureIndicator() {
    if (!document.body) return;
    if (indicator) return;
    indicator = document.createElement("div");
    indicator.id = "cesim-anti-idle-indicator";
    indicator.style.cssText =
      "position:fixed;right:12px;bottom:12px;z-index:2147483647;" +
      "background:rgba(0,0,0,0.7);color:#fff;font:12px/1.6 system-ui,sans-serif;" +
      "padding:6px 10px;border-radius:8px;pointer-events:none;";
    document.body.appendChild(indicator);
  }

  function updateIndicator() {
    ensureIndicator();
    if (indicator) {
      const t = new Date().toLocaleTimeString();
      indicator.textContent =
        `Cesim保活 · 滚动 ${actCount} · 点击 ${clickCount} · 心跳 ${heartbeatCount} · ${t}`;
    }
  }

  // ============ 后台保活（音频防节流） ============

  function startKeepAlive() {
    if (!config.keepAlive || keepAliveBound) return;
    keepAliveBound = true;
    const activate = () => {
      try {
        if (!audioCtx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          audioCtx = new AC();
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          gain.gain.value = 0.01; // 极低音量，几乎听不到
          osc.frequency.value = 25; // 25Hz，人耳不敏感
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start();
        } else if (audioCtx.state === "suspended") {
          audioCtx.resume().catch(() => {});
        }
      } catch (e) {
        // 音频保活失败不影响主功能
      }
    };
    document.addEventListener("pointerdown", activate, { passive: true, capture: true });
    document.addEventListener("keydown", activate, { passive: true, capture: true });
    document.addEventListener("touchstart", activate, { passive: true, capture: true });
  }

  function stopKeepAlive() {
    if (audioCtx) {
      try { audioCtx.close(); } catch (e) {}
      audioCtx = null;
    }
  }

  // ============ 调度 ============

  function act() {
    lastActTime = Date.now();
    actCount += 1;
    scrollPage();
    if (document.visibilityState !== "hidden" && config.mouseMove) {
      simulateMouseMove();
    }
    updateIndicator();
    if (chromeAlive()) {
      try {
        chrome.storage.local.set({ lastAction: Date.now() });
      } catch (e) {}
    }
    schedule();
  }

  function schedule() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!config.enabled) return;
    if (!chromeAlive()) return; // context 已失效，停止调度（等待页面刷新）
    const delay = randInt(config.minInterval, config.maxInterval) * 1000;
    timer = setTimeout(act, delay);
  }

  function applyConfig(next) {
    config = { ...config, ...next };
    if (config.keepAlive) startKeepAlive();
    else stopKeepAlive();
    schedule();
    scheduleClick();
    scheduleHeartbeat();
  }

  function loadConfig() {
    if (!chromeAlive()) return;
    try {
      chrome.storage.local.get(DEFAULTS, (items) => {
        if (chrome.runtime.lastError) return;
        config = { ...DEFAULTS, ...items };
        if (config.keepAlive) startKeepAlive();
        if (config.enabled) act();
        else schedule();
        if (config.clickEnabled) {
          // 不再「加载后立即点一次」——那是点击→刷新→重注入→再点的循环放大器
          scheduleClick();
        }
        if (config.heartbeatEnabled) heartbeat(); // 加载后立即发一次心跳 + 调度下一次
      });
    } catch (e) {}
  }

  // 仅在「真正有配置字段变化」时才重载配置
  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      let changed = false;
      const next = { ...config };
      for (const [k, v] of Object.entries(changes)) {
        if (k in DEFAULTS) {
          next[k] = v.newValue;
          changed = true;
        }
      }
      if (changed) applyConfig(next);
    });
  } catch (e) {}

  // 后台兜底：background 的 alarm 每 30 秒发一次 tick，检查滚动/点击/心跳是否逾期
  try {
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg && msg.type === "tick" && config.enabled) {
        const now = Date.now();
        if (now - lastActTime > 25000) act();
        if (config.clickEnabled && now - lastClickTime > config.clickMax * 1000) clickTick();
        if (config.heartbeatEnabled && now - lastHeartbeatTime > config.heartbeatMax * 1000) heartbeat();
      }
    });
  } catch (e) {}

  // 从后台切回前台时，立即补一次活动
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && config.enabled) act();
  });

  loadConfig();
})();

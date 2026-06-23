// 在 Google Slides「編輯器」工具列注入一顆「Live」藥丸鈕（放在「投影播放」左側）。
// 點開展開就地小面板：填 embed / 房間 / PIN（＋可展開的 CF 網址設定），直接開始 / 結束直播。
// presenter 身分由 CF Access 把關（不再有「控制密碼」）；第一次開直播會跳出登入。
// 直播中鈕變紅並顯示「● Live · PIN」。翻頁回報仍由 content.js 負責；本檔只在編輯頁工作。
// 注意：Slides 啟用 Trusted Types，全程用 DOM API 建構、不碰 innerHTML。

(() => {
  // 放映頁（/present）不注入——那裡沒有編輯器工具列。
  const inPresent = () => location.pathname.endsWith("/present") || /\/present(\/|$|\?)/.test(location.href);
  if (inPresent()) return;
  if (document.getElementById("lgs-pill") || document.getElementById("lgs-style")) return; // 防重複注入

  const genPin = () => String(Math.floor(1000 + Math.random() * 9000));
  async function loadPin() {
    let { pin } = await chrome.storage.local.get("pin");
    if (!pin) { pin = genPin(); await chrome.storage.local.set({ pin }); }
    return pin;
  }

  // 從目前 Slides 編輯頁網址自動推出 embed 網址（免手動「發布到網路」）。
  const embedFromUrl = u => {
    const m = (u || "").match(/\/presentation\/d\/([^/]+)/);
    return m ? `https://docs.google.com/presentation/d/${m[1]}/embed?start=false&loop=false&rm=minimal` : "";
  };

  // 小型 DOM 建構器（避開 innerHTML / Trusted Types）
  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    for (const k in (props || {})) {
      const v = props[k];
      if (k === "class") e.className = v;
      else if (k === "style") e.style.cssText = v;
      else if (k in e) e[k] = v;
      else e.setAttribute(k, v);
    }
    for (const c of kids) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(c)); }
    return e;
  }
  function setText(node, ...kids) { node.replaceChildren(...kids.map(k => (k && k.nodeType) ? k : document.createTextNode(k))); }

  // lucide 圖示（Slides 啟用 Trusted Types：用 createElementNS 建 SVG，不碰 innerHTML）
  const SVGNS = "http://www.w3.org/2000/svg";
  const svgEl = (tag, attrs) => { const e = document.createElementNS(SVGNS, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); return e; };
  const icon = (kids, size = 16) => {
    const s = svgEl("svg", { viewBox: "0 0 24 24", width: size, height: size, fill: "none",
      stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" });
    kids.forEach(k => s.appendChild(k)); return s;
  };
  const iconRotate = s => icon([
    svgEl("path", { d: "M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" }),
    svgEl("path", { d: "M21 3v5h-5" }),
    svgEl("path", { d: "M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" }),
    svgEl("path", { d: "M3 21v-5h5" })], s);
  const iconCopy = s => icon([
    svgEl("rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }),
    svgEl("path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" })], s);
  const iconCheck = s => icon([svgEl("path", { d: "M20 6 9 17l-5-5" })], s);
  const iconSettings = s => icon([
    svgEl("circle", { cx: "12", cy: "12", r: "3" }),
    svgEl("path", { d: "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" })], s);
  // Google Docs 可能用 Permissions-Policy 擋 navigator.clipboard → 退回 textarea + execCommand。
  function copyText(t) {
    const fallback = () => { const ta = h("textarea", { value: t, style: "position:fixed;opacity:0" });
      document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch {} ta.remove(); };
    try { navigator.clipboard.writeText(t).catch(fallback); } catch { fallback(); }
  }

  // ── 樣式（textContent 非 Trusted Types sink，安全）─────────────────────
  const style = h("style", { id: "lgs-style", textContent: `
    .lgs-pill{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:6px;
      height:40px;min-width:54px;box-sizing:border-box;padding:10px 16px;margin-right:-1px;z-index:1;
      border:1px solid var(--gm3-sys-color-outline,#747775)!important;border-right:1px solid transparent!important;
      border-radius:100px 0 0 100px;background:var(--gm3-sys-color-surface-container-low,#f8fafd);
      color:var(--gm3-sys-color-on-surface-variant,#444746);cursor:pointer;box-shadow:none;outline:none;
      font-family:'Google Sans',Roboto,RobotoDraft,Helvetica,Arial,sans-serif;font-weight:500;font-size:14px;
      letter-spacing:.25px;line-height:16px;text-align:center;white-space:nowrap;user-select:none;vertical-align:middle}
    .lgs-pill:hover{background:var(--gm3-sys-color-surface-container,#f0f4f9)}
    .lgs-pill.live{border-color:#ea4335!important;color:#d93025;background:#fce8e6}
    .lgs-present-group#punch-start-presentation-left,
    .lgs-present-group #punch-start-presentation-left{border-radius:0!important}
    .lgs-dot{width:8px;height:8px;border-radius:50%;background:#9aa0a6;flex:none}
    .lgs-pill.live .lgs-dot{background:#ea4335}
    .lgs-caret{font-size:10px;opacity:.6}
    .lgs-panel{position:fixed;z-index:2147483647;width:308px;background:#fff;color:#202124;
      border:1px solid #dadce0;border-radius:12px;box-shadow:0 8px 28px #0003;
      padding:14px;font:13px/1.45 system-ui,sans-serif;box-sizing:border-box}
    .lgs-panel[hidden]{display:none}
    .lgs-panel label{display:block;margin:11px 0 4px;font-size:12px;color:#5f6368}
    .lgs-panel input,.lgs-panel textarea{width:100%;box-sizing:border-box;height:40px;padding:8px;font-size:13px;
      border:1px solid #dadce0;border-radius:8px;font-family:inherit}
    .lgs-panel textarea{height:48px;resize:vertical}
    .lgs-row{display:flex;gap:8px;align-items:center}.lgs-row input{flex:1}
    .lgs-panel button{height:40px;box-sizing:border-box;padding:0 14px;border:0;border-radius:8px;font-size:13px;cursor:pointer;
      display:inline-flex;align-items:center;justify-content:center}
    .lgs-start{background:#1a73e8;color:#fff;flex:1}.lgs-stop{background:#d93025;color:#fff;flex:1}
    .lgs-gen{background:#f1f3f4;color:#3c4043}
    .lgs-foot{display:flex;align-items:center;gap:8px;margin-top:14px;padding-top:12px;border-top:1px solid #ebebeb;font-size:12px;color:#5f6368}
    .lgs-foot .lgs-fdot{width:8px;height:8px;border-radius:50%;background:#9aa0a6;flex:none}
    .lgs-foot.in .lgs-fdot{background:#1e8e3e}
    .lgs-foot .lgs-signin{height:28px;padding:0 12px;background:#1a73e8;color:#fff;border-radius:7px;font-size:12px}
    .lgs-foot.in .lgs-signin{display:none}
    .lgs-foot .lgs-gear-btn{margin-left:auto;height:30px;padding:0 8px;background:#e8eaed;color:#5f6368;border-radius:8px;flex:none}
    .lgs-foot .lgs-gear-btn:hover{background:#dadce0;color:#202124}
    .lgs-warn{color:#d93025;font-size:12px;margin:8px 0 0}.lgs-warn:empty{display:none}
    .lgs-status{margin-top:10px;font-size:12px;background:#f1f3f4;border-radius:8px;padding:8px;color:#3c4043}
    .lgs-pin{font-size:18px;font-weight:600;letter-spacing:3px}
    .lgs-adv[hidden]{display:none}
    .lgs-hint{color:#80868b;font-size:11px;margin-top:6px}
    .lgs-gen{min-width:46px}
    .lgs-live{color:#1e8e3e;font-weight:600}
    .lgs-off{color:#d93025;font-weight:600}
    .lgs-urlrow{display:flex;align-items:center;gap:6px;margin-top:6px}
    .lgs-url{color:#1a73e8;word-break:break-all;font-size:12px;flex:1}
    .lgs-panel .lgs-copy{height:28px;padding:0 7px;background:#e8eaed;color:#5f6368;flex:none}
    .lgs-panel .lgs-copy:hover{background:#dadce0;color:#202124}
  ` });

  // ── 藥丸鈕 ──────────────────────────────────────────────────────────
  const dot = h("span", { class: "lgs-dot" });
  const labelEl = h("span", { class: "lgs-label", textContent: "Live" });
  const pill = h("div", { class: "lgs-pill", id: "lgs-pill" },
    dot, labelEl, h("span", { class: "lgs-caret", textContent: "▾" }));

  // ── 面板欄位 ────────────────────────────────────────────────────────
  const authIco = h("span", { class: "lgs-fdot" });
  const authWho = h("span", { textContent: "未登入 CF Access" });
  const signinB = h("button", { class: "lgs-signin", textContent: "登入" });
  const gearBtn = h("button", { class: "lgs-gear-btn", title: "設定 CF 網址" }, iconSettings(16));
  const footRow = h("div", { class: "lgs-foot" }, authIco, authWho, signinB, gearBtn);

  const warn = h("div", { class: "lgs-warn" });
  const pinI = h("input", { id: "lgs-pin", maxlength: "8" });
  const genB = h("button", { class: "lgs-gen", title: "重新產生 PIN" }, iconRotate(16));
  const startB = h("button", { class: "lgs-start", textContent: "開始直播" });
  const stopB = h("button", { class: "lgs-stop", style: "display:none", textContent: "結束" });
  const statusBox = h("div", { class: "lgs-status" });
  const cfI = h("input", { id: "lgs-cf", placeholder: "https://live.example.com" });
  const adv = h("div", { class: "lgs-adv", hidden: true },
    h("label", { textContent: "Cloudflare 網址（你的 Worker，含 https://）" }), cfI,
    h("div", { class: "lgs-hint", textContent: "只填一次，之後每份簡報共用。presenter 身分由 CF Access 把關。" }));
  const panel = h("div", { class: "lgs-panel", hidden: true },
    warn,
    h("label", { textContent: "PIN（報給聽眾）" }),
    h("div", { class: "lgs-row" }, pinI, genB),
    h("div", { class: "lgs-row", style: "margin-top:14px" }, startB, stopB),
    statusBox, footRow, adv);

  // ── 狀態載入 / 寫回 ──────────────────────────────────────────────────
  async function load() {
    const sync = await chrome.storage.sync.get(["cfUrl"]);
    const local = await chrome.storage.local.get(["deckCfg", "active"]);
    const c = local.deckCfg || {};
    pinI.value = c.pin || await loadPin();
    cfI.value = sync.cfUrl || "";
    if (!sync.cfUrl) adv.hidden = false;
    setActiveUI(!!local.active, c.pin);
    refreshAuth();
    refreshStatus();
  }

  async function refreshAuth() {
    let signedIn = false;
    try { signedIn = (await chrome.runtime.sendMessage({ type: "authState" }))?.signedIn; } catch {}
    footRow.classList.toggle("in", !!signedIn);
    authWho.textContent = signedIn ? "已登入 CF Access" : "未登入 CF Access";
  }

  function setActiveUI(active, pin) {
    startB.style.display = active ? "none" : "block";
    stopB.style.display = active ? "block" : "none";
    [pinI, genB, cfI, signinB].forEach(n => (n.disabled = active));
    pill.classList.toggle("live", active);
    labelEl.textContent = active ? "Live · " + (pin || "") : "Live";
  }

  async function refreshStatus() {
    const local = await chrome.storage.local.get(["deckCfg", "active"]);
    const sync = await chrome.storage.sync.get(["cfUrl"]);
    let connected = false;
    try { connected = (await chrome.runtime.sendMessage({ type: "status?" }))?.connected; } catch {}
    if (local.active) {
      const view = (sync.cfUrl || "").replace(/\/$/, "");
      const copyBtn = h("button", { class: "lgs-copy", title: "複製觀眾網址" }, iconCopy(15));
      copyBtn.addEventListener("click", () => {
        copyText(view);
        setText(copyBtn, iconCheck(15));
        setTimeout(() => setText(copyBtn, iconCopy(15)), 1200);
      });
      setText(statusBox,
        connected ? h("span", { class: "lgs-live", textContent: "● 直播中" })
                  : h("span", { class: "lgs-off", textContent: "○ 連線中斷，重試中…" }),
        h("div", { class: "lgs-urlrow" }, h("span", { class: "lgs-url", textContent: view }), copyBtn));
    } else {
      setText(statusBox, h("small", { textContent: "按「開始直播」（第一次跳 CF Access 登入）；編輯/放映翻頁都會同步。" }));
    }
  }

  // ── 定位 / 開關面板 ──────────────────────────────────────────────────
  function positionPanel() {
    const r = pill.getBoundingClientRect();
    panel.style.top = r.bottom + 6 + "px";
    panel.style.left = Math.max(8, Math.min(r.right - 308, window.innerWidth - 316)) + "px";
  }
  function togglePanel(show) {
    const willShow = show ?? panel.hidden;
    if (willShow) { positionPanel(); panel.hidden = false; load(); }
    else panel.hidden = true;
  }
  pill.addEventListener("click", e => { e.stopPropagation(); togglePanel(); });
  document.addEventListener("click", e => {
    if (!panel.hidden && !panel.contains(e.target) && !pill.contains(e.target)) panel.hidden = true;
  });
  window.addEventListener("resize", () => { if (!panel.hidden) positionPanel(); });

  genB.addEventListener("click", async () => { const pin = genPin(); pinI.value = pin; await chrome.storage.local.set({ pin }); });
  gearBtn.addEventListener("click", () => (adv.hidden = !adv.hidden));

  signinB.addEventListener("click", async () => {
    const cfUrl = cfI.value.trim();
    if (!cfUrl) { adv.hidden = false; warn.textContent = "請先填 CF 網址。"; return; }
    await chrome.storage.sync.set({ cfUrl });
    authWho.textContent = "登入中…";
    try { await chrome.runtime.sendMessage({ type: "signin", cfUrl }); } catch {}
    refreshAuth();
  });

  startB.addEventListener("click", async () => {
    const cfUrl = cfI.value.trim();
    const embedBase = embedFromUrl(location.href);   // 直接用目前這份 deck（編輯頁網址）
    const pin = pinI.value.trim();
    if (!cfUrl) { adv.hidden = false; warn.textContent = "請先填 CF 網址。"; return; }
    if (!embedBase) { warn.textContent = "請在 Google Slides 的簡報分頁開始。"; return; }
    warn.textContent = "";
    await chrome.storage.sync.set({ cfUrl });
    await chrome.storage.local.set({ pin });
    const deckCfg = { cfUrl, embedBase, pin };
    await chrome.storage.local.set({ deckCfg, active: true });
    await chrome.runtime.sendMessage({ type: "start", cfg: deckCfg });
    setActiveUI(true, pin);
    setTimeout(() => { refreshAuth(); refreshStatus(); }, 600);
  });

  stopB.addEventListener("click", async () => {
    await chrome.storage.local.set({ active: false });
    await chrome.runtime.sendMessage({ type: "stop" });
    setActiveUI(false);
    refreshStatus();
  });

  chrome.runtime.onMessage.addListener(m => { if (m.type === "status") { refreshStatus(); refreshAuth(); } });

  // ── 插進工具列（投影播放鈕左側），Slides 重繪時補回 ────────────────────
  const ANCHORS = ["#punch-start-presentation-container", "#punch-start-presentation-left", "#punch-start-presentation-menu-button"];
  function findAnchor() { for (const sel of ANCHORS) { const e = document.querySelector(sel); if (e) return e; } return null; }
  function findTarget() {
    const anchor = findAnchor();
    if (!anchor) return null;
    const target = anchor.closest("#punch-start-presentation-container") || anchor;
    target.classList.add("lgs-present-group");
    return target;
  }
  function mount() {
    if (inPresent()) return;
    if (!style.isConnected) (document.head || document.documentElement).appendChild(style);
    if (!panel.isConnected) document.body.appendChild(panel);
    const target = findTarget();
    if (!target || pill.isConnected) return;
    target.parentElement.insertBefore(pill, target);
  }

  let tries = 0;
  const timer = setInterval(() => { mount(); if (pill.isConnected || ++tries > 40) clearInterval(timer); }, 500);
  new MutationObserver(() => { if (!pill.isConnected) mount(); }).observe(document.documentElement, { childList: true, subtree: true });
  mount();
})();

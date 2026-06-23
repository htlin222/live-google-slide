// Background service worker：唯一持有對 Cloudflare 的 WebSocket。
// 不在 content script 開 WS，以避開 Google 頁面的 CSP 限制。
//
// presenter 身分改用 CF Access：靠 chrome.identity.launchWebAuthFlow 開
// <cfUrl>/present 登入（Google/email，一次），Worker 把 Access JWT 以 #token=
// 轉回外掛；WS 帶 ?cf_token=<JWT> 連線，Worker 端驗 JWT 才給 presenter。

let ws = null;
let cfg = null;          // { cfUrl, pin }
let lastSlideId = null;
let retry = 0;
let reauthing = false;
let connecting = false;
let deckEmbed = null;    // 目前這份 deck 的 embed（由 content.js 從現場頁面推出，永遠是最新、正確的 deck）

// 單一 presenter，房間固定 default（與觀眾打開的 live.hsiehting.com 一致）。
function wsUrl(cfUrl, token) {
  const base = cfUrl.replace(/^http/, "ws").replace(/\/$/, "");
  return base + "/ws?role=presenter&room=default&cf_token=" + encodeURIComponent(token);
}
function sendInit() {
  // 只接受乾淨的 URL；舊版可能存了 <iframe src=...> 片段，過濾掉。
  const fallback = cfg && /^https?:\/\//.test(cfg.embedBase || "") ? cfg.embedBase : "";
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "init", pin: cfg && cfg.pin, embedBase: deckEmbed || fallback, slideIds: [] }));
}

function broadcastStatus() {
  const connected = !!ws && ws.readyState === 1;
  chrome.runtime.sendMessage({ type: "status", connected }).catch(() => {});
}

// ── CF Access 登入 ────────────────────────────────────────
function jwtExp(t) {
  try { return (JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).exp || 0) * 1000; }
  catch { return t === "dev" ? Date.now() + 3.6e6 : 0; }   // dev token 視為短期有效
}
function tokenAlive(t) { return !!t && jwtExp(t) > Date.now() + 30000; }

async function login(cfUrl, interactive) {
  if (!chrome.identity || !chrome.identity.launchWebAuthFlow) {
    await chrome.storage.local.set({ authErr: "identity 權限未生效，請重新載入外掛" });
    return null;
  }
  const redirect = chrome.identity.getRedirectURL();
  const authUrl = cfUrl.replace(/\/$/, "") + "/present?ext_redirect=" + encodeURIComponent(redirect);
  let out;
  try { out = await chrome.identity.launchWebAuthFlow({ url: authUrl, interactive }); }
  catch (e) {                                              // 使用者取消 / 沒有現成 session / IdP 擋住
    if (interactive) await chrome.storage.local.set({ authErr: "登入失敗：" + String(e && e.message || e) });
    return null;
  }
  const m = out && out.match(/[#?]token=([^&]+)/);
  const token = m ? decodeURIComponent(m[1]) : null;
  await chrome.storage.local.set(token ? { cfToken: token, authErr: "" } : { authErr: "登入未完成，請再試一次" });
  return token;
}

// 先用快取的 token；過期或沒有就走登入（interactive 決定要不要彈視窗）
async function getToken(cfUrl, interactive) {
  const { cfToken } = await chrome.storage.local.get("cfToken");
  if (tokenAlive(cfToken)) return cfToken;
  return login(cfUrl, interactive);
}

// ── WebSocket ────────────────────────────────────────────
async function connect(interactive = false) {
  if (!cfg) return;
  if (connecting) return;                                          // 正在連，避免重複觸發造成 churn
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;  // 已連線/連線中
  connecting = true;
  let token;
  try { token = await getToken(cfg.cfUrl, interactive); } finally { connecting = false; }
  if (!token) { broadcastStatus(); return; }                      // 沒登入就先不連，等下次 start / resume
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;  // 取 token 期間已有人連上
  ws = new WebSocket(wsUrl(cfg.cfUrl, token));

  ws.onopen = () => {
    retry = 0;
    sendInit();
    if (lastSlideId) ws.send(JSON.stringify({ type: "slide", slideId: lastSlideId }));
    broadcastStatus();
  };
  ws.onmessage = async (e) => {
    let m; try { m = JSON.parse(e.data); } catch { return; }
    // Worker 驗 token 失敗會把我們當 viewer → 清掉 token、彈視窗重新登入後重連
    if (m.type === "role" && m.role !== "presenter" && !reauthing) {
      reauthing = true;
      try { ws.close(); } catch {}
      await chrome.storage.local.remove("cfToken");
      const t = await login(cfg.cfUrl, true);
      reauthing = false;
      if (t) connect(false);
    }
  };
  ws.onclose = () => { ws = null; broadcastStatus(); if (cfg && !reauthing) setTimeout(() => connect(false), Math.min(1500 * (++retry), 8000)); };
  ws.onerror = () => { try { ws.close(); } catch {} };
}

function sendSlide(id) {
  lastSlideId = id;
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: "slide", slideId: id }));
}

// 一次性清掉舊版殘留的髒資料（舊 room、<iframe> 片段 embed、舊的 PRESENT_KEY 控制密碼）。
// 升版後第一次載入會清乾淨，避免 resume() 用到壞掉的舊設定。
const CFG_VERSION = 2;
async function migrate() {
  const { cfgVersion } = await chrome.storage.local.get("cfgVersion");
  if (cfgVersion === CFG_VERSION) return;
  await chrome.storage.local.remove(["deckCfg", "active"]);   // 強制重新開始（保留 cfToken 登入狀態）
  await chrome.storage.sync.remove(["key"]);                  // 舊的控制密碼
  await chrome.storage.local.set({ cfgVersion: CFG_VERSION });
}

async function resume() {
  await migrate();
  const { deckCfg, active } = await chrome.storage.local.get(["deckCfg", "active"]);
  if (active && deckCfg) { cfg = deckCfg; if (!ws) connect(false); }   // 自動重連只用快取 token，不彈視窗
}

function stop() {
  cfg = null; lastSlideId = null;
  try { if (ws) ws.close(); } catch {}
  ws = null;
  broadcastStatus();
}

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  switch (msg.type) {
    case "start": cfg = msg.cfg; lastSlideId = null; if (msg.cfg && msg.cfg.embedBase) deckEmbed = msg.cfg.embedBase; connect(true); break;
    case "stop": stop(); break;
    case "slide": sendSlide(msg.slideId); break;
    case "deck":  // content.js 從現場 deck 頁推來的 embed（最新、正確）→ 更新並重發 init
      if (msg.embedBase && msg.embedBase !== deckEmbed) { deckEmbed = msg.embedBase; sendInit(); }
      break;
    case "resume": resume(); break;
    case "signin": login(msg.cfUrl, true).then(t => reply({ ok: !!t })); return true;
    case "authState": chrome.storage.local.get("cfToken").then(g => reply({ signedIn: tokenAlive(g.cfToken) })); return true;
    case "hb": /* keepalive，喚醒 SW 即可 */ break;
    case "status?": reply({ connected: !!ws && ws.readyState === 1 }); return true;
  }
});

// SW 被喚醒時，若先前是 active 狀態就自動接回去
chrome.runtime.onStartup.addListener(resume);
resume();

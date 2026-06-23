const $ = id => document.getElementById(id);
const VIEW_HINT = u => u.replace(/\/$/, "") + "/view?room=";
const genPin = () => String(Math.floor(1000 + Math.random() * 9000));

// 從 Google Slides 網址自動推出 embed 網址（免「發布到網路」手動複製）。
// 用檔案 ID 的 /d/<id>/embed 形式：deck 設成「知道連結的人皆可檢視」即可。
const SLIDE_RE = /\/presentation\/d\/([^/]+)/;
const embedFromUrl = u => {
  const m = (u || "").match(SLIDE_RE);
  return m ? `https://docs.google.com/presentation/d/${m[1]}/embed?start=false&loop=false&rm=minimal` : "";
};
async function activeSlideEmbed() {
  try { const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); return embedFromUrl(tab && tab.url); }
  catch { return ""; }
}

async function init() {
  const sync = await chrome.storage.sync.get(["cfUrl"]);
  const local = await chrome.storage.local.get(["deckCfg", "active"]);

  if (!sync.cfUrl) { $("warn").style.display = "block"; $("warn").textContent = "請先點右上 ⚙ 填你的 Cloudflare 網址。"; }

  const c = local.deckCfg || {};
  $("embed").value = c.embedBase || await activeSlideEmbed();
  $("room").value = c.room || "default";
  $("pin").value = c.pin || genPin();

  setActive(local.active);
  refreshAuth();
  refreshStatus();
}

async function refreshAuth() {
  let signedIn = false;
  try { signedIn = (await chrome.runtime.sendMessage({ type: "authState" }))?.signedIn; } catch {}
  $("auth").classList.toggle("in", !!signedIn);
  $("who").textContent = signedIn ? "已登入 CF Access" : "未登入 CF Access";
}

function setActive(active) {
  $("start").style.display = active ? "none" : "block";
  $("stop").style.display = active ? "block" : "none";
  ["embed", "room", "pin", "gen", "signin"].forEach(id => $(id).disabled = !!active);
}

async function refreshStatus() {
  const sync = await chrome.storage.sync.get(["cfUrl"]);
  const local = await chrome.storage.local.get(["deckCfg", "active"]);
  let connected = false;
  try { connected = (await chrome.runtime.sendMessage({ type: "status?" }))?.connected; } catch {}
  const cfg = local.deckCfg || {};
  if (local.active) {
    $("status").innerHTML =
      (connected ? "<span class='live'>● 直播中</span>" : "<span class='off'>○ 連線中斷，重試中…</span>") +
      "<br>PIN：<span class='pin'>" + (cfg.pin || "—") + "</span>" +
      "<br>觀眾開：<span class='view'>" + VIEW_HINT(sync.cfUrl || "") + (cfg.room || "") + "</span>" +
      "<br>記得讓 Google 進入『放映』模式。";
  } else {
    $("status").textContent = "填好上面、進入放映後按「開始直播」。第一次會跳出 CF Access 登入。";
  }
}

$("gen").onclick = () => ($("pin").value = genPin());
$("gear").onclick = () => chrome.runtime.openOptionsPage();

$("signin").onclick = async () => {
  const { cfUrl } = await chrome.storage.sync.get(["cfUrl"]);
  if (!cfUrl) { chrome.runtime.openOptionsPage(); return; }
  $("who").textContent = "登入中…";
  try { await chrome.runtime.sendMessage({ type: "signin", cfUrl }); } catch {}
  refreshAuth();
};

$("start").onclick = async () => {
  const sync = await chrome.storage.sync.get(["cfUrl"]);
  if (!sync.cfUrl) { chrome.runtime.openOptionsPage(); return; }
  const embedBase = $("embed").value.trim();
  const room = $("room").value.trim() || "default";
  const pin = $("pin").value.trim();
  if (!embedBase) { $("warn").style.display = "block"; $("warn").textContent = "請貼 embed 網址。"; return; }

  const deckCfg = { cfUrl: sync.cfUrl, embedBase, room, pin };
  await chrome.storage.local.set({ deckCfg, active: true });
  await chrome.runtime.sendMessage({ type: "start", cfg: deckCfg });
  setActive(true);
  setTimeout(() => { refreshAuth(); refreshStatus(); }, 600);
};

$("stop").onclick = async () => {
  await chrome.storage.local.set({ active: false });
  await chrome.runtime.sendMessage({ type: "stop" });
  setActive(false);
  refreshStatus();
};

chrome.runtime.onMessage.addListener(m => { if (m.type === "status") { refreshStatus(); refreshAuth(); } });
init();

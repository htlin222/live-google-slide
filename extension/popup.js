const $ = id => document.getElementById(id);
const VIEW_HINT = u => u.replace(/\/$/, "") + "/view?room=";

function genPin() { return String(Math.floor(1000 + Math.random() * 9000)); }

async function init() {
  const sync = await chrome.storage.sync.get(["cfUrl", "key"]);
  const local = await chrome.storage.local.get(["deckCfg", "active"]);

  if (!sync.cfUrl || !sync.key) {
    $("warn").style.display = "block";
    $("warn").textContent = "請先到「設定」填 CF 網址與控制密碼。";
  }

  const c = local.deckCfg || {};
  $("embed").value = c.embedBase || "";
  $("room").value = c.room || "talk";
  $("pin").value = c.pin || genPin();

  setActive(local.active, sync.cfUrl);
  refreshStatus();
}

function setActive(active, cfUrl) {
  $("start").style.display = active ? "none" : "block";
  $("stop").style.display = active ? "block" : "none";
  ["embed", "room", "pin", "gen"].forEach(id => $(id).disabled = !!active);
}

async function refreshStatus() {
  const sync = await chrome.storage.sync.get(["cfUrl"]);
  const local = await chrome.storage.local.get(["deckCfg", "active"]);
  let connected = false;
  try { connected = (await chrome.runtime.sendMessage({ type: "status?" }))?.connected; } catch {}
  const cfg = local.deckCfg || {};
  if (local.active) {
    $("status").innerHTML =
      (connected ? "● 連線中" : "○ 連線中斷，重試中…") +
      "<br>PIN：<span class='pin'>" + (cfg.pin || "") + "</span>" +
      "<br><small>觀眾開：" + VIEW_HINT(sync.cfUrl || "") + (cfg.room || "") + "</small>" +
      "<br><small>記得讓 Google 進入『放映』模式</small>";
  } else {
    $("status").innerHTML = "<small>填好上面、進入放映後按「開始直播」。</small>";
  }
}

$("gen").onclick = () => ($("pin").value = genPin());
$("opt").onclick = () => chrome.runtime.openOptionsPage();

$("start").onclick = async () => {
  const sync = await chrome.storage.sync.get(["cfUrl", "key"]);
  if (!sync.cfUrl || !sync.key) { chrome.runtime.openOptionsPage(); return; }
  const embedBase = $("embed").value.trim();
  const room = ($("room").value.trim() || "talk");
  const pin = $("pin").value.trim();
  if (!embedBase) { $("warn").style.display = "block"; $("warn").textContent = "請貼 embed 網址。"; return; }

  const deckCfg = { cfUrl: sync.cfUrl, key: sync.key, embedBase, room, pin };
  await chrome.storage.local.set({ deckCfg, active: true });
  await chrome.runtime.sendMessage({ type: "start", cfg: deckCfg });
  setActive(true);
  setTimeout(refreshStatus, 400);
};

$("stop").onclick = async () => {
  await chrome.storage.local.set({ active: false });
  await chrome.runtime.sendMessage({ type: "stop" });
  setActive(false);
  refreshStatus();
};

chrome.runtime.onMessage.addListener(m => { if (m.type === "status") refreshStatus(); });
init();

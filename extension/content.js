// 在 Google Slides 頁面執行。只有在「放映」時才工作。
// 從 URL hash 讀當前 slide objectId（#slide=id.gXXXX），翻頁就回報給 background。

function inPresent() {
  return location.pathname.endsWith("/present") || /\/present(\/|$|\?)/.test(location.href);
}

function currentSlideId() {
  const m = (location.hash || "").match(/slide=id\.([^&\/]+)/);
  return m ? m[1] : null;
}

let last = null;

function tick() {
  if (!inPresent()) return;
  const id = currentSlideId();
  if (id && id !== last) {
    last = id;
    chrome.runtime.sendMessage({ type: "slide", slideId: id }).catch(() => {});
  }
}

// 放映時 hash 不一定每次都觸發 hashchange，所以輪詢補強
window.addEventListener("hashchange", tick);
setInterval(tick, 600);

// 心跳：放映分頁開著就每 20 秒戳一下 background，避免 MV3 service worker 被回收而斷線
setInterval(() => {
  if (inPresent()) chrome.runtime.sendMessage({ type: "hb" }).catch(() => {});
}, 20000);

// 放映分頁載入後，若使用者先前已按「開始直播」，請 background 用儲存的設定自動重連
chrome.runtime.sendMessage({ type: "resume" }).catch(() => {});
tick();

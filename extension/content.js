// 在 Google Slides 頁面執行——編輯或放映模式皆可，不需特地進「簡報模式」。
// 從 URL 讀當前 slide objectId，翻頁就回報給 background。
// 編輯模式翻頁改的是 query（?slide=id.X，走 history API）；放映模式改的是 hash（#slide=id.X）。

function currentSlideId() {
  const m = (location.hash + location.search).match(/slide=id\.([^&/?#]+)/);
  return m ? m[1] : null;
}

let last = null;
function tick() {
  const id = currentSlideId();
  if (id && id !== last) {
    last = id;
    chrome.runtime.sendMessage({ type: "slide", slideId: id }).catch(() => {});
  }
}

// hash 與 history 兩種翻頁都監聽，再用輪詢補強（query 變動不一定有事件）。
window.addEventListener("hashchange", tick);
window.addEventListener("popstate", tick);
setInterval(tick, 500);

// 心跳：分頁開著就每 20 秒戳一下 background，避免 MV3 service worker 被回收而斷線
//（伺服器端也會每 10 秒 ping 保活，雙保險）。
setInterval(() => chrome.runtime.sendMessage({ type: "hb" }).catch(() => {}), 20000);

// 載入後若先前已按「開始直播」，請 background 用儲存的設定自動重連
chrome.runtime.sendMessage({ type: "resume" }).catch(() => {});
tick();

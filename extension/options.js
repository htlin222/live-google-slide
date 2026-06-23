const $ = id => document.getElementById(id);

chrome.storage.sync.get(["cfUrl"]).then(g => { $("cfUrl").value = g.cfUrl || ""; });

$("save").onclick = async () => {
  const cfUrl = $("cfUrl").value.trim().replace(/\/$/, "");
  await chrome.storage.sync.set({ cfUrl });
  $("ok").textContent = "已儲存 ✓";
  setTimeout(() => ($("ok").textContent = ""), 1500);
};

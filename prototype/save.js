/** Results are saved by the computer's local backend; no mobile login or album claims. */
function saveTarget() {
  return ["localhost", "127.0.0.1"].includes(location.hostname)
    ? "desktop-local"
    : "desktop-browser";
}
function fileName(r) {
  return r.savedName || "outfit-" + r.id + "." + r.ext;
}
function saveAction(r) {
  return `<a href="${r.url}" download="${esc(fileName(r))}" class="text">${r.savedTo ? "另存一份 ↓" : "下载图片 ↓"}</a>`;
}
function saveCaption(r) {
  return r.savedTo
    ? "已保存到电脑"
    : r.saveError
      ? "自动保存失败"
      : "请下载保存";
}
function saveInfo(r) {
  if (!r) return;
  const el = $("saveHelp");
  el.innerHTML = `<h2>成片保存</h2><p>${r.savedTo ? "已保存到：" + esc(r.savedTo) : r.saveError ? esc(r.saveError) : "请点击下载图片，将成片保存到这台电脑。"}</p><button id="saveHelpClose" class="primary">知道了</button>`;
  $("saveHelpClose").onclick = () => el.close();
  openDialog("saveHelp");
}
function bindSaveActions(root = document) {
  root
    .querySelectorAll("[data-save-info]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          saveInfo(state.results.find((r) => r.id === b.dataset.saveInfo))),
    );
}

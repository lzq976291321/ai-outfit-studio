$("app").innerHTML =
  `<header><button id="brand" type="button">衣见<span>本地穿搭工作台</span></button><nav aria-label="主要导航"><button id="homeNav" class="active"><span>穿搭</span></button><button id="resultsNav"><span>本次成片</span></button></nav><div><button id="info" aria-label="说明">ⓘ</button><button id="settings" aria-label="ChatGPT 连接">ChatGPT 未连接</button></div></header><main id="main"></main><dialog id="taskPanel" aria-label="本次任务"></dialog><dialog id="detail" aria-label="穿搭预览"></dialog><dialog id="picker" aria-label="选择姿势"></dialog><dialog id="config" aria-label="本机 ChatGPT 设置"></dialog><dialog id="saveHelp" aria-label="成片保存说明"></dialog><dialog id="help" aria-label="本次使用说明"><h2>本次使用说明</h2><p class="muted">本机 ChatGPT：直接图片编辑接口 · 2026-10-30</p><p>穿搭必选，人物可选；默认自然站立。人物参考帮助保持身份，不选则生成虚构成年人。</p><p>待试清单、上传、人物参考和任务仅在本次页面中使用。电脑本地运行时，生成成片自动保存到“下载／衣见成片”。这是电脑本地工具；手机登录 ChatGPT 不能直接连接此工作台。刷新清空页面记录，不会删除已保存的图片。生成时图片会发送给 ChatGPT 并使用账号额度；刷新不会取消已经提交的上游任务。</p><p>穿搭与姿势来自在线图库，按需读取，不保存本地素材副本。<a href="https://ai-costume-gallery.pages.dev/" target="_blank" rel="noreferrer">穿搭来源</a> · <a href="https://ai-pose-gallery.pages.dev/" target="_blank" rel="noreferrer">姿势来源及使用条款</a>。素材允许作品参考，禁止图片再分发；姿势库不允许用于表现真实人物或未成年。请按来源条款使用。</p><button class="primary" id="helpClose">知道了</button></dialog><input type="file" id="upload" accept="image/png,image/jpeg,image/webp" hidden><input type="file" id="personUpload" accept="image/png,image/jpeg,image/webp" hidden><button id="taskDock" class="taskdock" hidden></button><div id="toast" role="status"></div>`;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
function enter(el) {
  if (!el || reducedMotion.matches || !window.anime) return;
  anime.animate(el, {
    opacity: [0, 1],
    translateY: [10, 0],
    duration: 360,
    ease: "out(3)",
  });
}
function openDialog(id) {
  const el = $(id);
  if (el.open) return;
  const opener = document.activeElement;
  el.addEventListener(
    "close",
    () => {
      if (opener?.isConnected) opener.focus({preventScroll: true});
      else if ($("detail").open) $("poseChoice")?.focus({preventScroll: true});
    },
    { once: true },
  );
  el.showModal();
  if (!reducedMotion.matches && window.anime)
    anime.animate(el, {
      opacity: [0, 1],
      translateY: [24, 0],
      scale: [0.98, 1],
      duration: 320,
      ease: "out(3)",
    });
}
let toastTimer;
function toast(text) {
  clearTimeout(toastTimer);
  const modal = [...document.querySelectorAll("dialog[open]")].at(-1);
  if (modal) {
    let feedback = modal.querySelector(".dialog-feedback");
    if (!feedback) {
      feedback = document.createElement("p");
      feedback.className = "dialog-feedback";
      feedback.setAttribute("role", "status");
      modal.append(feedback);
    }
    feedback.textContent = text;
  }
  $("toast").textContent = text;
  $("toast").classList.add("show");
  toastTimer = setTimeout(() => $("toast").classList.remove("show"), 4000);
}
const categories = {
  全部: "全部",
  春: "春日",
  夏: "夏日",
  秋: "秋日",
  冬: "冬日",
  ランジェリー: "内搭",
  パーティ: "派对",
  水着: "泳装",
  セクシー: "其他",
};
function all() {
  return [...state.added, ...state.items];
}
function costumeThumb(o) {
  return o.local
    ? o.url
    : "https://ai-costume-gallery.pages.dev/" + o["サムネ"];
}
function poseThumb(p) {
  return "https://ai-pose-gallery.pages.dev/" + p["缩略图"];
}
async function assetDataUrl(url) {
  const response = await fetch("/api/reference", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw Error(data.error || "参考图读取失败");
  return data.image;
}
function title(o) {
  return (
    o.name || (categories[o["カテゴリ"]] || o["カテゴリ"]) + "穿搭 · " + o.id
  );
}
function rememberWorkbenchView() {
  if (state.page !== "home") return;
  const root = $("workbench");
  const scroll = root?.querySelector(".bench-scroll");
  if (!scroll) return;
  state.workbenchView.scroll = scroll.scrollTop;
  state.workbenchView.shortlistScroll = root.querySelector(".selected-outfits")?.scrollTop || 0;
  state.workbenchView.extraOpen = root.querySelector("#extraOptions")?.open || false;
}
function nav(page) {
  rememberWorkbenchView();
  if (state.page === "results") state.resultsScroll = window.scrollY || 0;
  if (state.page === "home" && document.querySelector(".gallery-pane")) state.galleryScroll = document.querySelector(".gallery-pane").scrollTop;
  state.page = page;
  $("main").className = page === "home" ? "home-page" : "";
  document
    .querySelectorAll("nav button")
    .forEach((x) => x.removeAttribute("aria-current"));
  $(page.startsWith("result") ? "resultsNav" : "homeNav").setAttribute(
    "aria-current",
    "page",
  );
  document
    .querySelectorAll("nav button")
    .forEach((x) => x.classList.remove("active"));
  $(page.startsWith("result") ? "resultsNav" : "homeNav").classList.add(
    "active",
  );
}
let galleryObserver;
function observeGalleryEnd(hasMore) {
  galleryObserver?.disconnect();
  const sentinel = $("galleryEnd");
  sentinel.hidden = !hasMore;
  if (!hasMore || typeof IntersectionObserver === "undefined") return;
  galleryObserver = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting) || state.page !== "home" || !sentinel.isConnected) return;
    galleryObserver.disconnect();
    state.limit += 24;
    cards();
  }, {root: document.querySelector(".gallery-pane"), rootMargin: "0px 0px 500px 0px"});
  galleryObserver.observe(sentinel);
}
function home() {
  nav("home");
  $("main").innerHTML =
    `<div class="studio-layout"><section class="gallery-pane" aria-label="穿搭图库"><div class="gallery-heading"><div><h1>挑一套，见新自己。</h1><p class="muted">加入待试清单，一套或多套，都在右侧开始。</p></div><button id="addTop" class="secondary">＋ 导入穿搭</button></div><div class="gallery-tools"><label class="sr-only" for="search">搜索穿搭</label><input id="search" class="search" placeholder="搜索穿搭" value="${esc(state.query)}"><span class="muted" id="galleryCount"></span></div><div id="sourceStatus" role="status"></div><div class="chips">${["全部", "春", "夏", "秋", "冬"].map((c) => `<button data-category="${c}" aria-pressed="${state.category === c}" class="${state.category === c ? "active" : ""}">${categories[c]}</button>`).join("")}</div><div id="cards" class="cards"></div><div id="galleryEnd" class="gallery-end" role="status">继续向下浏览，自动加载更多穿搭</div></section><aside id="workbench" class="workbench" aria-label="本次试穿"></aside></div>`;
  $("addTop").onclick = () => $("upload").click();
  $("search").oninput = (e) => {
    state.query = e.target.value;
    state.limit = 24;
    cards();
  };
  document.querySelectorAll("[data-category]").forEach(
    (b) =>
      (b.onclick = () => {
        state.category = b.dataset.category;
        state.limit = 24;
        home();
      }),
  );
  cards();
  renderSourceStatus();
  renderWorkbench();
  document.querySelector(".gallery-pane").scrollTop = state.galleryScroll;
}
function cards() {
  const list = all().filter(
    (o) =>
      (state.category === "全部" || o["カテゴリ"] === state.category) &&
      (title(o) + " " + (o["キーワード"] || ""))
        .toLowerCase()
        .includes(state.query.toLowerCase()),
  );
  if ($("galleryCount")) $("galleryCount").textContent = list.length + " 套穿搭";
  $("cards").innerHTML =
    list
      .slice(0, state.limit)
      .map(
        (o) =>
          `<article class="${state.tryOn.has(o.id) ? "is-selected" : ""}"><button class="card" data-outfit="${esc(o.id)}"><img loading="lazy" src="${esc(costumeThumb(o))}" alt="${esc(title(o))}"><span>${esc(title(o))}</span></button><button class="heart ${state.tryOn.has(o.id) ? "on" : ""}" data-shortlist="${esc(o.id)}" aria-label="${state.tryOn.has(o.id) ? "移出待试清单" : "加入待试清单"}" aria-pressed="${state.tryOn.has(o.id)}">${state.tryOn.has(o.id) ? "✓" : "＋"}</button></article>`,
      )
      .join("") || emptyGallery();
  observeGalleryEnd(list.length > state.limit);
  document
    .querySelectorAll("[data-outfit]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          detail(all().find((o) => o.id === b.dataset.outfit))),
    );
  document.querySelectorAll("[data-shortlist]").forEach(
    (b) =>
      (b.onclick = () => {
        toggleTryOn(b.dataset.shortlist);
        cards();
      }),
  );
  bindReload($("cards"));
  $("cards")
    .querySelectorAll("[data-reset-filter]")
    .forEach(
      (b) =>
        (b.onclick = () => {
          state.query = "";
          state.category = "全部";
          home();
        }),
    );
  $("cards")
    .querySelectorAll("[data-import]")
    .forEach((b) => (b.onclick = () => $("upload").click()));
  bindImageErrors($("cards"));
  updateShortlistControls();
}
function toggleTryOn(id) {
  state.tryOn.has(id) ? state.tryOn.delete(id) : state.tryOn.add(id);
  updateShortlistControls();
}
function detail(o) {
  state.selected = o;
  renderDetail();
  if (!$("detail").open) openDialog("detail");
}
function renderDetail() {
  const o = state.selected;
  if (!o) return;
  $("detail").innerHTML = `<div class="modalhead"><button id="detailClose" aria-label="关闭穿搭预览">←</button><span>穿搭预览</span></div><div class="preview-content"><img class="outfitHero" src="${esc(costumeThumb(o))}" alt="${esc(title(o))}"><h2>${esc(title(o))}</h2><p class="muted">加入右侧待试清单，与其他穿搭共用本次设置。</p><button id="detailPick" class="primary">${state.tryOn.has(o.id) ? "已加入 · 移出清单" : "＋ 加入待试清单"}</button></div>`;
  $("detailClose").onclick = () => $("detail").close();
  $("detailPick").onclick = () => {
    toggleTryOn(o.id);
    cards();
    renderDetail();
  };
  bindImageErrors($("detail"));
}
const styleNotes = {
  "自然手机感": "生活环境、自然光，保留真实皮肤与衣料质感。",
  "街头随拍": "真实街头环境、现场光线，背景可辨，姿态放松。",
  "直闪摄影": "相机直闪、鲜明光影，保留衣物细节与材质反光。",
  "干净影棚": "素色背景、柔和主光，清楚展示服装轮廓和原色。",
  "时尚杂志": "有方向的布光、克制的编辑感，保留完整全身构图。",
};
let workbenchResizeObserver;
function updateWorkbenchOverflow() {
  const scroll = $("workbench")?.querySelector(".bench-scroll");
  const hint = $("benchScrollHint");
  if (scroll && hint) hint.hidden = scroll.scrollHeight - scroll.scrollTop <= scroll.clientHeight + 4;
}
function renderWorkbench() {
  const target = $("workbench");
  if (!target || state.page !== "home") return;
  rememberWorkbenchView();
  const focus = document.activeElement;
  const focusId = target.contains?.(focus) ? focus.id : null;
  const selection = focusId === "extra" ? [focus.selectionStart, focus.selectionEnd] : null;
  target.innerHTML = `<div class="bench-heading"><div><p class="eyebrow">YOUR FITTING ROOM</p><h2>本次试穿</h2></div><span class="bench-tag">9:16 竖图</span></div><div class="bench-scroll" tabindex="0" role="region" aria-label="试穿设置"><section id="shortlistControls" aria-label="待试清单"></section><div class="bench-settings"><button class="row" id="personChoice"><span>人物参考 <small>可选</small></span><span>${state.person ? '<img class="avatar" src="' + esc(state.personUrl) + '"> 更换' : "＋ 添加"}</span></button>${state.person ? '<button class="text" id="personRemove">移除人物参考</button>' : '<p class="field-note">不添加时生成虚构成年人，不保证跨任务身份一致。</p>'}<button class="row" id="poseChoice"><span>姿势与视角</span><span>${esc(poseLabel(state.pose,state.angle))} ›</span></button><label class="style-field" for="photoStyle">摄影风格</label><select id="photoStyle" ${state.sources.styles !== "ready" ? "disabled" : ""}>${state.styles.map(v => `<option ${v === state.style ? "selected" : ""}>${esc(v)}</option>`).join("")}</select><p id="styleNote" class="field-note">${esc(styleNotes[state.style] || "所选风格将用于本次所有穿搭。")}</p><details id="extraOptions" ${state.workbenchView.extraOpen ? "open" : ""}><summary>补充要求</summary><label class="sr-only" for="extra">补充要求</label><textarea id="extra" rows="3" maxlength="1500" placeholder="例如：午后的咖啡馆，画面保留全身">${esc(state.extra)}</textarea></details></div></div><div id="benchScrollHint" class="bench-scroll-hint" aria-hidden="true" hidden>向下滚动，查看更多设置 ↓</div><div class="bench-submit"><p class="submission-summary" id="draftSummary"></p><button id="generate" class="primary"></button><p id="generationStatus" class="field-note" role="status"></p><p class="session-note">刷新清空本次设置 · 成片保存到下载／衣见成片</p></div>`;
  $("personChoice").onclick = () => $("personUpload").click();
  if ($("personRemove")) $("personRemove").onclick = () => {
    state.person = null; state.personUrl = null; collectObjects(); renderWorkbench();
  };
  $("poseChoice").onclick = posePicker;
  $("photoStyle").onchange = e => {
    state.style = e.target.value;
    $("styleNote").textContent = styleNotes[state.style] || "所选风格将用于本次所有穿搭。";
    updateShortlistControls();
  };
  $("extra").oninput = e => state.extra = e.target.value;
  $("extraOptions").ontoggle = e => {
    if (e.target.isConnected) state.workbenchView.extraOpen = e.target.open;
  };
  $("generate").onclick = generate;
  updateShortlistControls();
  const scroll = target.querySelector(".bench-scroll");
  if (scroll) {
    scroll.scrollTop = state.workbenchView.scroll;
    scroll.onscroll = updateWorkbenchOverflow;
  }
  workbenchResizeObserver?.disconnect();
  if (scroll && typeof ResizeObserver !== "undefined") {
    workbenchResizeObserver = new ResizeObserver(updateWorkbenchOverflow);
    workbenchResizeObserver.observe(scroll);
    for (const child of scroll.children) workbenchResizeObserver.observe(child);
  }
  updateWorkbenchOverflow();
  const shortlist = target.querySelector(".selected-outfits");
  if (shortlist) shortlist.scrollTop = state.workbenchView.shortlistScroll;
  if (focusId) {
    $(focusId)?.focus({preventScroll: true});
    if (selection) $(focusId)?.setSelectionRange?.(...selection);
  }
}
function syncConnection() {
  $("settings").textContent = state.connected ? "● ChatGPT 已连接" : "ChatGPT 未连接";
}
function posePicker() {
  let { category, query } = state.poseView;
  let chosen = state.pose;
  let angle = state.angle;
  const angles = [["front", "正面"],["high", "俯视"],["low", "仰视"],["side", "侧面"],["diag", "斜侧"]];
  function draw() {
    $("picker").innerHTML = `<div class="modalhead"><button id="poseClose" aria-label="关闭姿势选择">←</button><h2>姿势与视角</h2><button id="natural" class="text">自然站立</button></div><div class="pose-layout"><div class="pose-browser"><div id="poseSourceStatus" role="status"></div><label class="sr-only" for="poseSearch">搜索姿势</label><input id="poseSearch" placeholder="搜索姿势" value="${esc(query)}"><div class="chips">${["全部", ...new Set(state.poses.map(p => p["分类"]))].map(c => `<button data-posecat="${esc(c)}" aria-pressed="${c === category}" class="${c === category ? "active" : ""}">${esc(c)}</button>`).join("")}</div><div id="poseCards" class="posecards"></div></div><section id="posePreview" class="pose-preview" aria-label="姿势预览"></section></div>`;
    $("poseClose").onclick = () => $("picker").close();
    $("natural").onclick = () => {chosen = null; angle = "正面"; drawCards(); drawPreview();};
    $("poseSearch").oninput = e => {query = e.target.value; state.poseView.query = query; drawCards();};
    $("picker").querySelectorAll('[data-posecat]').forEach(b => b.onclick = () => {category = b.dataset.posecat; state.poseView.category = category; draw();});
    drawCards(); drawPreview();
  }
  function drawCards() {
    $("poseCards").innerHTML = state.poses.filter(p => (category === "全部" || p["分类"] === category) && String(p["检索"] || p["姿势名称"]).includes(query)).map(p => `<button data-pose="${esc(p.id)}" aria-pressed="${chosen?.id.replace(/_(front|high|low|side|diag)$/, "") === p.id.replace(/_front$/, "")}" class="posecard"><img loading="lazy" src="${esc(poseThumb(p))}" alt="${esc(p["姿势名称"])}"><span>${esc(p["姿势名称"])}</span></button>`).join("") || '<p class="empty">没有匹配的姿势，可调整搜索或使用自然站立。</p>';
    $("picker").querySelectorAll('[data-pose]').forEach(b => b.onclick = () => {chosen = state.poses.find(p => p.id === b.dataset.pose); drawCards(); drawPreview();});
    renderPoseStatus(); bindImageErrors($("poseCards"));
  }
  function drawPreview() {
    const prefix = chosen?.id.replace(/_(front|high|low|side|diag)$/, "");
    const suffix = (angles.find(a => a[1] === angle) || angles[0])[0];
    $("posePreview").innerHTML = `${chosen ? `<img class="poseHero" src="https://ai-pose-gallery.pages.dev/img/${esc(prefix)}_${suffix}.png" alt="${esc(chosen["姿势名称"])} · ${esc(angle)}">` : '<div class="natural-preview">自然站立<p>默认正面，不添加姿势参考图</p></div>'}<h2>${chosen ? esc(chosen["姿势名称"]) : "自然站立"}</h2>${chosen ? `<div class="chips">${angles.map(a => `<button data-angle="${a[0]}" aria-pressed="${a[1] === angle}" class="${a[1] === angle ? "active" : ""}">${a[1]}</button>`).join("")}</div>` : ''}<button id="confirmPose" class="primary">使用这个姿势</button>`;
    $("posePreview").querySelectorAll('[data-angle]').forEach(b => b.onclick = () => {angle = angles.find(a => a[0] === b.dataset.angle)[1]; drawPreview();});
    $("confirmPose").onclick = () => {
      state.pose = chosen ? {...chosen, id: prefix + "_" + suffix, 原图: "img/" + prefix + "_" + suffix + ".png"} : null;
      state.angle = chosen ? angle : "正面";
      $("picker").close(); renderWorkbench(); $("poseChoice")?.focus({preventScroll: true});
    };
    bindImageErrors($("posePreview"));
  }
  draw(); openDialog("picker");
}
function settings() {
  $("config").innerHTML =
    `<div class="modalhead"><button id="configClose" aria-label="关闭设置">←</button><h2>本机 ChatGPT</h2><span></span></div><form id="settingsForm"><div class="connectioncard"><b>ChatGPT</b><p>使用这台电脑已有的 ChatGPT / Codex 登录</p><p>仅供电脑本地使用。手机中的 ChatGPT 登录不会连接到本工作台。</p><span id="connectionState">${state.connected ? "本机登录可用" : "尚未连接"}</span></div><p class="muted">凭据只在本机读取，不另存。生成使用账号额度，图片由 ChatGPT 处理。</p><p id="connectionError" class="muted" role="status"></p><button id="connectSubmit" class="primary">连接本机 ChatGPT</button><button type="button" id="disconnect" class="text">断开本次连接</button></form>`;
  $("configClose").onclick = () => $("config").close();
  $("settingsForm").onsubmit = async (e) => {
    e.preventDefault();
    $("connectSubmit").disabled = true;
    $("connectionError").textContent = "正在检查本机登录…";
    try {
      const response = await fetch("/api/local-chatgpt/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        cache: "no-store",
      });
      const d = await response.json();
      if (!response.ok || !d.connected) throw Error(d.error || "连接失败");
      state.connected = true;
      $("config").close();
      syncConnection();
      renderWorkbench();
      toast("本机 ChatGPT 已连接");
    } catch (error) {
      $("connectionError").textContent = error.message;
    } finally {
      $("connectSubmit").disabled = false;
    }
  };
  $("disconnect").onclick = () => {
    state.connected = false;
    $("connectionState").textContent = "尚未连接";
    syncConnection();
    renderWorkbench();
    toast("本次连接已断开");
  };
  openDialog("config");
}
function validFile(file) {
  if (!file) return false;
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 8000000
  ) {
    toast("请选择 8 MB 以内的 PNG、JPEG 或 WebP");
    return false;
  }
  return true;
}
$("upload").onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!validFile(file)) return;
  const o = {
    id: "local-" + crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, ""),
    local: true,
    url: objectURL(file),
    file,
  };
  state.added.unshift(o);
  state.category = "全部";
  state.query = "";
  state.limit = 24;
  home();
  state.tryOn.add(o.id);
  cards();
};
$("personUpload").onchange = (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!validFile(file)) return;
  state.person = file;
  state.personUrl = objectURL(file);
  collectObjects();
  renderWorkbench();
};
function read(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(Error("图片读取失败"));
    r.readAsDataURL(file);
  });
}
$("taskDock").onclick = () => {
  $("taskPanel").innerHTML = `<div class="modalhead"><button id="taskPanelClose" aria-label="关闭任务面板">←</button><h2>本次任务</h2><button id="viewResults" class="text">本次成片 ↗</button></div><div class="tasksummary"></div><div class="tasklist"></div>`;
  $("taskPanelClose").onclick = () => $("taskPanel").close();
  $("viewResults").onclick = () => {$("taskPanel").close(); results();};
  openDialog("taskPanel");
  renderTasks($("taskPanel"));
};
$("brand").onclick = home;
$("homeNav").onclick = home;
$("resultsNav").onclick = () => results();
$("settings").onclick = settings;
$("info").onclick = () => openDialog("help");
$("helpClose").onclick = () => $("help").close();
window.addEventListener("pagehide", (event) => {
  if (event.persisted) return;
  state.connected = false;
  objects.forEach(URL.revokeObjectURL);
  objects.clear();
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    syncTasks();
    if (state.page === "home") home();
  }
});
async function init() {
  home();
  await Promise.allSettled([
    loadSource("catalog"),
    loadSource("poses"),
    loadSource("styles"),
  ]);
}

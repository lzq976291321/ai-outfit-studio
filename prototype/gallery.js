/** Online metadata adapters. Only allow the image paths accepted by the local proxy. */
function imagePath(value, thumbnail = false) {
  if (
    typeof value !== "string" ||
    !(
      thumbnail
        ? /^(img|thumbs)\/[A-Za-z0-9_-]+\.(png|webp|jpg|jpeg|svg)$/
        : /^img\/[A-Za-z0-9_-]+\.(png|webp)$/
    ).test(value)
  ) {
    throw Error("在线图库图片路径无效");
  }
  return value;
}
function normalizeSource(kind, data) {
  if (!Array.isArray(data) || !data.length)
    throw Error("在线目录为空或格式已变化");
  if (kind === "styles") {
    if (
      !data.every(
        (v) => typeof v === "string" && v.length > 0 && v.length < 100,
      )
    )
      throw Error("摄影风格配置无效");
    return data;
  }
  return data.map((item) => {
    if (
      !item ||
      typeof item.id !== "string" ||
      !/^[A-Za-z0-9_-]+$/.test(item.id)
    )
      throw Error("在线目录标识无效");
    const copy = { ...item };
    for (const key of kind === "catalog"
      ? ["サムネ", "画像"]
      : ["缩略图", "原图"])
      copy[key] = imagePath(copy[key], key === "サムネ" || key === "缩略图");
    for (const key of kind === "catalog"
      ? ["カテゴリ", "キーワード"]
      : ["姿势名称", "分类", "角度", "检索"]) {
      if (copy[key] != null && typeof copy[key] !== "string")
        throw Error("在线目录字段无效");
    }
    return copy;
  });
}
async function loadSource(kind) {
  if (state.sources[kind] === "fetching") return;
  state.sources[kind] = "fetching";
  renderSourceStatus();
  renderPoseStatus();
  try {
    const name = kind === "catalog" ? "catalog" : kind;
    const response = await fetch("/prototype/data/" + name + ".json", {
      cache: "no-store",
      signal: AbortSignal.timeout(55000),
    });
    if (!response.ok) throw Error("目录暂不可用");
    const data = normalizeSource(kind, await response.json());
    if (kind === "catalog") state.items = data;
    else if (kind === "poses")
      state.poses = data.filter((p) => p["角度"] === "正面");
    else {
      state.styles = data;
      if (!data.includes(state.style)) state.style = data[0];
    }
    state.sources[kind] = "ready";
  } catch {
    state.sources[kind] = "error";
  }
  if (state.page === "home" && $("cards")) cards();
  renderSourceStatus();
  renderPoseStatus();
  if (kind === "styles") renderWorkbench();
  if (kind === "poses" && $("picker").open && $("poseCards")) {
    // Refresh a visible list while retaining its search, category and scroll position.
    state.poseView.scroll = $("picker").scrollTop;
    $("picker").close();
    posePicker();
  }
}
function sourceHTML(kind, label) {
  const status = state.sources[kind];
  if (status === "ready") return "";
  return `<p class="source-message">${esc(label)}${status === "error" ? "加载失败" : "加载中…"}${status === "error" ? `<button class="text" data-reload="${kind}">重试${esc(label)}</button>` : ""}</p>`;
}
function bindReload(root) {
  root
    ?.querySelectorAll("[data-reload]")
    .forEach((b) => (b.onclick = () => loadSource(b.dataset.reload)));
}
function renderSourceStatus() {
  const target = $("sourceStatus");
  if (!target) return;
  target.innerHTML =
    sourceHTML("catalog", "穿搭库") +
    sourceHTML("poses", "姿势库") +
    sourceHTML("styles", "摄影风格");
  bindReload(target);
}
function renderPoseStatus() {
  const target = $("poseSourceStatus");
  if (!target) return;
  target.innerHTML = sourceHTML("poses", "姿势库");
  bindReload(target);
}
function emptyGallery() {
  if (state.query || state.category !== "全部")
    return '<div class="empty"><p>没有匹配的穿搭</p><button class="text" data-reset-filter>清空搜索与筛选</button></div>';
  if (state.sources.catalog === "error")
    return '<div class="empty"><p>穿搭库加载失败，可以重试或临时导入自己的图片。</p><button class="text" data-reload="catalog">重试穿搭库</button><button class="text" data-import>导入图片</button></div>';
  return '<p class="empty">正在加载穿搭；也可以点击“导入穿搭”使用自己的图片。</p>';
}
function bindImageErrors(root) {
  root.querySelectorAll("img").forEach(
    (image) =>
      (image.onerror = () => {
        image.onerror = null;
        image.classList.add("image-unavailable");
        image.alt = "图片暂不可用，请稍后重试";
      }),
  );
}
function poseLabel(pose, angle) {
  return (pose ? pose["姿势名称"] : "自然站立") + " · " + (angle || "正面");
}
/** Revoke only objects no longer referenced by a draft, import, task or result. */
function collectObjects() {
  const retained = new Set([state.personUrl, ...state.added.map((o) => o.url)]);
  for (const task of state.tasks) {
    retained.add(task.snapshot.personUrl);
    if (task.snapshot.o.local) retained.add(task.snapshot.o.url);
    if (task.result) retained.add(task.result.url);
  }
  for (const url of objects)
    if (!retained.has(url)) {
      URL.revokeObjectURL(url);
      objects.delete(url);
    }
}
function clearFinished() {
  const keep = (task) =>
    pending(task) ||
    task.status === "unknown" ||
    (task.status === "succeeded" && !task.result.savedTo);
  state.tasks = state.tasks.filter(keep);
  state.results = state.results.filter((r) =>
    state.tasks.some((t) => t.id === r.id),
  );
  state.unread = new Set(
    [...state.unread].filter((id) => state.results.some((r) => r.id === id)),
  );
  collectObjects();
  renderTasks();
  syncTasks();
  toast("已清除可清理的记录；未自动保存成片与待核对任务已保留，不删除电脑文件");
}

function updateShortlistControls() {
  const target = $("shortlistControls");
  if (!target || state.page !== "home") return;
  const items = all().filter(o => state.tryOn.has(o.id));
  const slots = MAX_PENDING - state.tasks.filter(pending).length;
  const count = items.length;
  const selectionKey = JSON.stringify(items.map(o => [o.id, title(o), costumeThumb(o)]));
  if (target.dataset.selectionKey !== selectionKey) {
    const scroll = target.querySelector(".selected-outfits")?.scrollTop ?? state.workbenchView.shortlistScroll;
    target.innerHTML = `<div class="selection-heading"><span>待试清单 <b>${count}</b></span>${count ? '<button id="clearShortlist" class="text">清空</button>' : ''}</div><div class="selected-outfits">${items.map(o => `<div class="selected-outfit"><img src="${esc(costumeThumb(o))}" alt="${esc(title(o))}"><span>${esc(title(o))}</span><button data-remove="${esc(o.id)}" aria-label="移除 ${esc(title(o))}">×</button></div>`).join('') || '<div class="selection-empty"><span>＋</span><p>从左侧挑选喜欢的穿搭</p><small>每套生成一张，共用下方设置</small></div>'}</div>`;
    target.dataset.selectionKey = selectionKey;
    const selected = target.querySelector(".selected-outfits");
    if (selected) selected.scrollTop = scroll;
    target.querySelectorAll('[data-remove]').forEach((b, index) => b.onclick = () => {
      state.tryOn.delete(b.dataset.remove);
      cards();
      const remaining = target.querySelectorAll('[data-remove]');
      (remaining[Math.min(index, remaining.length - 1)] || $("personChoice"))?.focus({preventScroll: true});
    });
    if ($("clearShortlist")) $("clearShortlist").onclick = () => {
      state.tryOn.clear(); cards(); $("personChoice")?.focus({preventScroll: true});
    };
    bindImageErrors(target);
    updateWorkbenchOverflow();
  }
  if ($("generate")) {
    $("generate").disabled = !count || count > slots || state.sources.styles !== "ready";
    $("generate").textContent = count ? `生成 ${count} 张穿搭照` : "选择穿搭后开始";
    const immediate = Math.min(count, Math.max(0, MAX_ACTIVE - activeCount()));
    $("generationStatus").textContent = count > slots ? `队列还可加入 ${slots} 套，请移除部分穿搭或等待任务完成。` : count ? `${immediate} 个立即开始${count > immediate ? `，${count-immediate} 个排队` : ''} · 每套一张` : "支持一次试穿多套";
    $("draftSummary").textContent = `${state.person ? "已选人物" : "无人物参考"} · ${poseLabel(state.pose,state.angle)} · ${state.style}`;
  }
}

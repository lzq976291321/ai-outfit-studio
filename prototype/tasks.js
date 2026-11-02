const MAX_ACTIVE = 4,
  MAX_PENDING = 8;
const taskLabels = {
  queued: "排队中",
  reading: "准备图片",
  running: "生成中",
  succeeded: "已完成",
  failed: "生成失败",
  unknown: "结果待核对",
  cancelled: "已取消",
};
const pending = (t) => ["queued", "reading", "running"].includes(t.status);
function activeCount() {
  return state.tasks.filter((t) => ["reading", "running"].includes(t.status))
    .length;
}
let lastSubmission = 0;
function generate() {
  if (Date.now() - lastSubmission < 600) return;
  if (!state.connected) {
    settings();
    return;
  }
  if (state.sources.styles !== "ready") {
    toast("摄影风格尚未就绪，请重试加载");
    return;
  }
  const items = all().filter(o => state.tryOn.has(o.id));
  const slots = MAX_PENDING - state.tasks.filter(pending).length;
  if (!items.length) {
    toast("请先选择穿搭");
    return;
  }
  if (items.length > slots) {
    toast("队列还可加入 " + slots + " 套，请移除部分穿搭或等待任务完成");
    return;
  }
  const shared = {
    pose: state.pose ? { ...state.pose } : null,
    angle: state.angle,
    style: state.style,
    person: state.person,
    personUrl: state.personUrl,
    saveTarget: saveTarget(),
    extra: state.extra,
  };
  for (const outfit of items) {
    const snapshot = {
      ...shared,
      o: { ...outfit },
      pose: shared.pose ? { ...shared.pose } : null,
    };
    state.tasks.unshift({
      id: crypto.randomUUID(),
      status: "queued",
      created: Date.now(),
      snapshot,
      name: title(outfit),
      thumb: costumeThumb(outfit),
      pose: snapshot.pose ? snapshot.pose["姿势名称"] : "自然站立",
    });
  }
  for (const outfit of items) state.tryOn.delete(outfit.id);
  lastSubmission = Date.now();
  $("detail").close();
  if (state.page === "home" && $("cards")) cards();
  syncTasks();
  toast("已加入 " + items.length + " 个生成任务，可继续挑选穿搭");
  pump();
}

function pump() {
  for (const task of [...state.tasks].reverse()) {
    if (activeCount() >= MAX_ACTIVE) break;
    if (task.status === "queued") void runTask(task);
  }
}
async function runTask(task) {
  const s = task.snapshot;
  task.status = "reading";
  task.started = Date.now();
  syncTasks();
  try {
    const references = [
      s.o.local
        ? await read(s.o.file)
        : await assetDataUrl(
            "https://ai-costume-gallery.pages.dev/" + s.o["画像"],
          ),
    ];
    if (s.person) references.push(await read(s.person));
    if (s.pose)
      references.push(
        await assetDataUrl(
          "https://ai-pose-gallery.pages.dev/" + s.pose["原图"],
        ),
      );
    task.status = "running";
    task.submitted = true;
    syncTasks();
    const body = JSON.stringify({
      references,
      saveTarget: s.saveTarget,
      outfitName: task.name,
      hasPerson: !!s.person,
      hasPose: !!s.pose,
      pose: task.pose + "，" + s.angle,
      style: s.style,
      extra: s.extra,
    });
    const response = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body,
    });
    const d = await response.json();
    if (!response.ok) {
      const error = Error(d.error || "生成失败");
      error.code = d.errorCode;
      error.diagnostics = d.diagnostics;
      error.outcome =
        d.outcome ||
        (response.status >= 400 && response.status < 500 ? "failed" : null);
      throw error;
    }
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(d.image || ""))
      throw Error("未返回完整图片");
    const blob = await (await fetch(d.image)).blob();
    const result = {
      id: task.id,
      url: objectURL(blob),
      ext: blob.type.split("/")[1],
      name: task.name,
      pose: task.pose,
      snapshot: s,
      blob,
      savedTo: d.savedTo || "",
      savedName: d.savedName || "",
      saveError: d.saveError || "",
    };
    task.result = result;
    task.status = "succeeded";
    state.results.unshift(result);
    if (state.page !== "results") state.unread.add(task.id);
    toast(
      result.savedTo
        ? "成片已自动保存到电脑"
        : result.saveError
          ? "图片已生成，请手动下载保存"
          : task.name + " 已完成",
    );
  } catch (error) {
    task.errorCode = error.code || "";
    task.diagnostics = error.diagnostics || null;
    task.error = error.message || "请求中断，请先核对上游执行状态";
    task.status =
      error.outcome ||
      (!task.submitted
        ? "failed"
        : ["CONTENT_REJECTED", "AUTH_EXPIRED", "IMAGE_RATE_LIMIT"].includes(
              error.code,
            )
          ? "failed"
          : "unknown");
    if (task.status === "unknown")
      task.error =
        "执行结果待核对；请先查看电脑成片目录，不要直接重复提交。" + task.error;
    toast(task.status === "unknown" ? "有任务结果待核对" : "有任务未生成成功");
  } finally {
    task.finished = Date.now();
    syncTasks();
    pump();
  }
}
function syncTasks() {
  updateShortlistControls();
  const remaining = state.tasks.filter(pending).length;
  const dock = $("taskDock");
  dock.hidden = !state.tasks.length;
  const completed = state.tasks.filter(t => t.status === "succeeded").length;
  const issues = state.tasks.filter(t => ["failed", "unknown"].includes(t.status)).length;
  dock.innerHTML = `<span class="orb"></span><span>处理中 ${activeCount()} · 排队 ${remaining-activeCount()} · 已完成 ${completed}${issues ? " · 需查看 " + issues : ""}</span><span>查看任务 ↗</span>`;
  $("resultsNav").innerHTML = `<span>本次成片${state.unread.size ? ' <b class="navbadge">' + state.unread.size + " 新</b>" : remaining ? ' <b class="navbadge">' + remaining + "</b>" : ""}</span>`;
  if (state.page === "results" && $("taskList")) renderTasks($("main"));
  if ($("taskPanel").open) renderTasks($("taskPanel"));
}
function results() {
  state.unread.clear();
  nav("results");
  syncTasks();
  $("main").innerHTML =
    `<div class="heading"><h1>本次成片</h1><button class="text" id="clearResults">清除已结束记录</button></div><p class="muted">页面记录刷新清空；成功成片会自动保存到下载／衣见成片，请以每张图的保存状态为准。清理记录不删除电脑文件，未保存成片与待核对任务会保留。</p><div class="tasksummary" id="taskSummary"></div><div id="taskList" class="tasklist"></div><p class="muted">电脑生成的成片自动保存在下载／衣见成片</p>`;
  renderTasks();
  window.scrollTo({ top: state.resultsScroll, behavior: "instant" });
  $("clearResults").onclick = clearFinished;
}
function elapsed(t) {
  return (
    Math.max(
      0,
      Math.floor(
        ((t.finished || Date.now()) - (t.started || t.created)) / 1000,
      ),
    ) + "s"
  );
}
function taskDiagnostic(t) {
  if (!t.diagnostics) return "";
  const d = t.diagnostics;
  const detail = `接口：${esc(d.route || "images/edits")}<br>HTTP ${esc(d.httpStatus ?? "")}<br>${esc(d.upstreamCode || "")}<br>${esc(d.upstreamMessage || "")}`;
  return `<details class="taskdiagnostic"><summary>诊断 ⓘ</summary><p>${esc(t.errorCode)}<br>${detail}</p></details>`;
}
function taskHTML(t) {
  const success = t.status === "succeeded",
    waiting = pending(t);
  return `<article class="taskcard ${t.status}" data-task="${t.id}"><div class="taskvisual">${success ? `<button data-result="${t.id}" class="taskimage"><img src="${t.result.url}" alt="${esc(t.name)}的生成结果"></button>` : `<img src="${esc(t.thumb)}" alt="${esc(t.name)}">${waiting ? '<div class="taskveil"><span class="loader"></span></div>' : ""}`}</div><div class="taskmeta"><span class="statuspill ${t.status}">${waiting ? "<i></i>" : ""}${t.errorCode === "CONTENT_REJECTED" ? "未通过检查" : taskLabels[t.status]}</span><span class="tasktime" data-time="${t.id}">${elapsed(t)}</span><h2>${esc(t.name)}</h2><p>${esc(poseLabel(t.snapshot.pose, t.snapshot.angle))} · ${esc(t.snapshot.style)}</p>${success ? `<button class="save-state ${t.result.saveError ? "warning" : ""}" data-save-info="${t.id}">${saveCaption(t.result)} ⓘ</button>` : ""}${t.error ? `<p class="taskerror">${esc(t.error)}</p>${taskDiagnostic(t)}` : ""}<div class="taskactions">${success ? `<button data-result="${t.id}" class="text">查看成片 ↗</button>${saveAction(t.result)}` : t.status === "queued" ? `<button data-cancel="${t.id}" class="text">取消排队</button>` : !waiting ? `<button data-prepare="${t.id}" class="text">${t.errorCode === "CONTENT_REJECTED" ? "修改参考素材" : "带回设置修改"}</button>` : '<span class="muted">可以继续选其他穿搭</span>'}</div></div></article>`;
}
function renderTasks(root = $("main")) {
  const list = root.querySelector(".tasklist");
  if (!list) return;
  const counts = state.tasks.reduce(
    (a, t) => ((a[t.status] = (a[t.status] || 0) + 1), a),
    {},
  );
  root.querySelector(".tasksummary").textContent = state.tasks.length
    ? `${state.tasks.filter(pending).length} 个待完成 · ${counts.succeeded || 0} 张成片`
    : "";
  if (!state.tasks.length) {
    list.innerHTML =
      '<div class="empty empty-state"><span>✧</span><h2>下一张，是什么样的你</h2><p>选一套穿搭，开始试试</p><button class="text" id="exploreOutfits">发现穿搭 ↗</button></div>';
    $("exploreOutfits").onclick = home;
    return;
  }
  list.querySelector(".empty")?.remove();
  list.querySelectorAll("[data-task]").forEach((el) => {
    if (!state.tasks.some((t) => t.id === el.dataset.task)) el.remove();
  });
  for (const t of [...state.tasks].reverse()) {
    let el = list.querySelector(`[data-task="${t.id}"]`);
    if (!el) {
      list.insertAdjacentHTML("afterbegin", taskHTML(t));
      el = list.firstElementChild;
      el.dataset.status = t.status;
      enter(el);
    } else if (el.dataset.status !== t.status) {
      const box = document.createElement("div");
      box.innerHTML = taskHTML(t);
      const next = box.firstElementChild;
      next.dataset.status = t.status;
      el.replaceWith(next);
      if (t.status === "succeeded") enter(next);
    }
  }
  bindSaveActions(list);
  list
    .querySelectorAll("[data-result]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          showResult(state.results.find((r) => r.id === b.dataset.result))),
    );
  list.querySelectorAll("[data-cancel]").forEach(
    (b) =>
      (b.onclick = () => {
        const t = state.tasks.find((t) => t.id === b.dataset.cancel);
        if (t?.status === "queued") {
          t.status = "cancelled";
          t.finished = Date.now();
          syncTasks();
          pump();
        }
      }),
  );
  list
    .querySelectorAll("[data-prepare]")
    .forEach(
      (b) =>
        (b.onclick = () =>
          prepare(
            state.tasks.find((t) => t.id === b.dataset.prepare).snapshot,
          )),
    );
}
function prepare(s, withOutfit = true) {
  if ($("taskPanel").open) $("taskPanel").close();
  state.person = s.person;
  state.personUrl = s.personUrl;
  state.pose = s.pose ? {...s.pose} : null;
  state.angle = s.angle;
  state.style = s.style;
  state.extra = s.extra;
  if (withOutfit) state.tryOn.add(s.o.id);
  else state.tryOn.delete(s.o.id);
  collectObjects();
  home();
  state.workbenchView.extraOpen = !!s.extra;
  $("extraOptions").open = !!s.extra;
  $("workbench")?.scrollIntoView({block: "nearest", behavior: "smooth"});
  const next = $("generate");
  (next && !next.disabled ? next : $("personChoice"))?.focus({preventScroll: true});
}
function showResult(r) {
  if (!r) return;
  if ($("taskPanel").open) $("taskPanel").close();
  nav("result");
  state.unread.delete(r.id);
  syncTasks();
  $("main").innerHTML =
    `<div class="heading"><button id="backResults" class="text">← 本次成片</button><div class="save-buttons">${saveAction(r)}</div></div><button class="save-state ${r.saveError ? "warning" : ""}" data-save-info="${r.id}">${saveCaption(r)} ⓘ</button><div class="result-layout"><img class="resultHero" src="${r.url}" alt="实际生成照片"><div class="result-info"><p class="eyebrow">本次成片</p><div class="heading"><h2>${esc(r.name)}</h2><span>${esc(poseLabel(r.snapshot.pose, r.snapshot.angle))}</span></div><p class="muted">${esc(r.snapshot.style)} · ${esc(poseLabel(r.snapshot.pose, r.snapshot.angle))}</p><p>${r.snapshot.person ? "已使用人物参考" : "无人物参考"}</p>${r.snapshot.extra ? `<details class="result-requirements" ${r.snapshot.extra.length <= 160 ? "open" : ""}><summary>补充要求</summary><p class="result-extra">${esc(r.snapshot.extra)}</p></details>` : ""}<button class="primary" id="again">沿用设置</button><button class="secondary" id="changeOutfit">换一套穿搭</button><p class="muted">恢复到工作台，由你再次提交生成。</p></div></div>`;
  bindSaveActions($("main"));
  $("backResults").onclick = results;
  $("again").onclick = () => {
    prepare(r.snapshot);
  };
  $("changeOutfit").onclick = () => prepare(r.snapshot, false);
  window.scrollTo({ top: 0, behavior: "smooth" });
}
setInterval(() => {
  document.querySelectorAll("[data-time]").forEach((el) => {
    const t = state.tasks.find((t) => t.id === el.dataset.time);
    if (t && pending(t)) el.textContent = elapsed(t);
  });
}, 1000);

init();

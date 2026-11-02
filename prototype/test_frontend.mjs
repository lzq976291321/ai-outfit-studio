/** State regressions: offline, no credentials or real image requests. */
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
function harness() {
  const elements = new Map(),
    events = {},
    revoked = [],
    cleared = [],
    scrolls = [];
  let timer = 0;
  function el(id) {
    if (!elements.has(id))
      elements.set(id, {
        value: "",
        open: false,
        scrollTop: 0,
        dataset: {},
        classList: { add() {}, remove() {} },
        addEventListener() {},
        focus() {},
        scrollIntoView() {},
        setAttribute() {},
        removeAttribute() {},
        querySelectorAll() {
          return [];
        },
        querySelector(selector) {
          return selector === ".detail-scroll" ? { scrollTop: 0 } : null;
        },
        append() {},
        showModal() {
          this.open = true;
        },
        close() {
          this.open = false;
        },
        set innerHTML(v) {
          this.html = v;
          this.htmlWrites = (this.htmlWrites || 0) + 1;
        },
        get innerHTML() {
          return this.html || "";
        },
      });
    return elements.get(id);
  }
  const ctx = vm.createContext({
    document: {
      getElementById: el,
      querySelectorAll: () => [],
      querySelector: () => el("galleryPane"),
      createElement: () => el("created"),
    },
    window: {
      matchMedia: () => ({ matches: true }),
      addEventListener: (k, f) => (events[k] = f),
      scrollTo(options) { scrolls.push(options); },
    },
    navigator: { userAgent: "test" },
    location: { hostname: "127.0.0.1" },
    URL: {
      createObjectURL: () => "blob:" + Math.random(),
      revokeObjectURL: (url) => revoked.push(url),
    },
    crypto: { randomUUID: () => "test" },
    setTimeout: () => ++timer,
    clearTimeout: (id) => cleared.push(id),
    setInterval() {},
    fetch: () => new Promise(() => {}),
    AbortSignal,
    console,
    Date,
  });
  for (const name of ["state", "save", "gallery", "app", "tasks"])
    vm.runInContext(
      fs.readFileSync(new URL("./" + name + ".js", import.meta.url), "utf8"),
      ctx,
    );
  return {
    el,
    events,
    revoked,
    cleared,
    scrolls,
    run: (code) => vm.runInContext(code, ctx),
  };
}
test("draft and view angle survive workbench redraw and preparation", () => {
  const h = harness();
  h.run(
    `state.selected={id:'a',name:'a',local:true,url:'blob:a'};state.extra='咖啡馆';renderWorkbench();state.person={};renderWorkbench();`,
  );
  assert.match(h.el("workbench").innerHTML, /咖啡馆/);
  h.run(
    `prepare({o:state.selected,extra:'新要求',angle:'侧面',style:'自然手机感',person:null,pose:null})`,
  );
  assert.match(h.el("workbench").innerHTML, /新要求/);
  assert.match(h.el("workbench").innerHTML, /侧面/);
});
test("import resets active filters", () => {
  const h = harness();
  h.run(
    `state.category='春';state.query='旧搜索';$('upload').onchange({target:{files:[{name:'new.png',type:'image/png',size:10}],value:'x'}})`,
  );
  assert.equal(h.run("state.category"), "全部");
  assert.equal(h.run("state.query"), "");
  assert.equal(h.run("state.added.length"), 1);
});
test("transport interruption after submission is unknown with no retry", async () => {
  const h = harness();
  h.run(
    `read=async()=> 'data:image/png;base64,test';globalThis.calls=0;fetch=async()=>{calls++;throw TypeError('Failed to fetch')};globalThis.task={id:'a',snapshot:{o:{local:true,file:{}},angle:'正面'},status:'queued'}`,
  );
  await h.run("runTask(task)");
  assert.equal(h.run("task.status"), "unknown");
  assert.equal(h.run("calls"), 1);
});
test("preparation failure never submits", async () => {
  const h = harness();
  h.run(
    `read=async()=>{throw Error('bad file')};globalThis.calls=0;fetch=async()=>{calls++};globalThis.task={id:'a',snapshot:{o:{local:true,file:{}}},status:'queued'}`,
  );
  await h.run("runTask(task)");
  assert.equal(h.run("task.status"), "failed");
  assert.equal(h.run("calls"), 0);
});
test("partial source failure preserves catalog and uses configured style list", async () => {
  const h = harness();
  h.run(
    `state.sources={catalog:'loading',poses:'loading',styles:'loading'};fetch=async url=>({ok:!url.includes('poses'),json:async()=>url.includes('styles')?['新风格']:[{id:'SPR-1','サムネ':'thumbs/SPR-1.webp','画像':'img/SPR-1.webp','カテゴリ':'春'}]})`,
  );
  await h.run(
    `Promise.allSettled([loadSource('catalog'),loadSource('poses'),loadSource('styles')])`,
  );
  assert.equal(h.run("state.items.length"), 1);
  assert.equal(h.run("state.sources.poses"), "error");
  assert.equal(h.run("state.style"), "新风格");
});
test("metadata rejects injected IDs and paths; accepts upstream thumbnails", () => {
  const h = harness();
  assert.equal(
    h.run(`imagePath('thumbs/full_single_P001_front.jpg',true)`),
    "thumbs/full_single_P001_front.jpg",
  );
  assert.throws(() => h.run(`normalizeSource('poses',[{id:'bad" id'}])`));
  assert.throws(() => h.run(`imagePath('../private.png')`));
  assert.throws(() => h.run(`imagePath('img/x.svg')`));
});
test("clear retains unsaved results, uncertain and active tasks", () => {
  const h = harness();
  h.run(
    `renderTasks=()=>{};syncTasks=()=>{};state.tasks=[{id:'saved',status:'succeeded',snapshot:{o:{}},result:{url:'blob:saved',savedTo:'saved'}},{id:'unsaved',status:'succeeded',snapshot:{o:{}},result:{url:'blob:unsaved',savedTo:''}},{id:'unknown',status:'unknown',snapshot:{o:{}}},{id:'queued',status:'queued',snapshot:{o:{}}}];state.results=state.tasks.filter(t=>t.result).map(t=>({id:t.id,...t.result}));objects.add('blob:saved');objects.add('blob:unsaved');clearFinished()`,
  );
  assert.equal(
    h.run(`state.tasks.map(t=>t.id).join(',')`),
    "unsaved,unknown,queued",
  );
  assert.deepEqual(h.revoked, ["blob:saved"]);
});
test("old person image releases after task references disappear", () => {
  const h = harness();
  h.run(
    `objects.add('blob:old');state.personUrl='blob:new';state.tasks=[{snapshot:{o:{},personUrl:'blob:old'}}];collectObjects()`,
  );
  assert.deepEqual(h.revoked, []);
  h.run("state.tasks=[];collectObjects()");
  assert.deepEqual(h.revoked, ["blob:old"]);
});
test("BFCache pagehide preserves live session and image URLs", () => {
  const h = harness();
  h.run(`state.connected=true;state.tasks=[{id:'a'}];objects.add('blob:a')`);
  h.events.pagehide({ persisted: true });
  assert.equal(h.run("state.tasks.length"), 1);
  assert.equal(h.run("state.connected"), true);
  assert.deepEqual(h.revoked, []);
});
test("new-result notice persists and successive toast replaces timer", () => {
  const h = harness();
  h.run(`state.tasks=[{id:'new',status:'succeeded'}];state.unread.add('new');syncTasks();toast('one');toast('two')`);
  assert.equal(h.el("taskDock").hidden, false);
  assert.match(h.el("resultsNav").innerHTML, /1 新/);
  assert.ok(h.cleared.some((id) => id > 0));
});
test("queue enforces four active and eight pending with frozen draft inputs", () => {
  const h = harness();
  h.run(
    `state.connected=true;state.sources.styles='ready';state.selected={id:'a',name:'a',local:true,url:'blob:a',file:{}};state.added=[state.selected];state.extra='first';read=()=>new Promise(()=>{});for(let i=0;i<9;i++){state.tryOn.add('a');lastSubmission=0;generate()}state.extra='changed';`,
  );
  assert.equal(h.run("state.tasks.length"), 8);
  assert.equal(h.run("activeCount()"), 4);
  assert.equal(h.run(`state.tasks.filter(t=>t.status==='queued').length`), 4);
  assert.equal(h.run("state.tasks[0].snapshot.extra"), "first");
});
test("batch creates one frozen task per outfit and consumes only submitted candidates", () => {
  const h = harness();
  h.run(
    `state.connected=true;state.sources.styles='ready';state.tryOn=new Set(['a','b','other']);state.added=[{id:'a',name:'a',local:true,url:'blob:a',file:{}},{id:'b',name:'b',local:true,url:'blob:b',file:{}}];state.extra='shared';state.angle='侧面';read=()=>new Promise(()=>{});generate();state.extra='changed';state.angle='正面';`,
  );
  assert.equal(h.run("state.tasks.length"), 2);
  assert.equal(
    h.run(
      `state.tasks.every(t=>t.snapshot.extra==='shared'&&t.snapshot.angle==='侧面')`,
    ),
    true,
  );
  assert.equal(h.run(`[...state.tryOn].join(',')`), "other");
  assert.equal(h.run(`new Set(state.tasks.map(t=>t.snapshot.o.id)).size`), 2);
});
test("batch capacity rejection enqueues nothing and preserves candidates", () => {
  const h = harness();
  h.run(
    `state.connected=true;state.sources.styles='ready';state.tasks=Array.from({length:7},()=>({status:'running'}));state.tryOn=new Set(['a','b']);state.added=[{id:'a'},{id:'b'}];generate();`,
  );
  assert.equal(h.run("state.tasks.length"), 7);
  assert.equal(h.run("state.tryOn.size"), 2);
  assert.equal(h.run("state.added.length"), 2);
});

test("preview never changes shared inputs or submits an unselected outfit", () => {
  const h = harness();
  h.run(`state.extra='保留要求';state.connected=true;state.sources.styles='ready';detail({id:'preview',name:'preview',local:true,url:'blob:a'});generate()`);
  assert.equal(h.run("state.extra"), "保留要求");
  assert.equal(h.run("state.tasks.length"), 0);
});
test("reuse restores settings without generation and can omit the original outfit", () => {
  const h = harness();
  h.run(`state.added=[{id:'a',name:'a'}];state.tryOn.add('a');prepare({o:state.added[0],extra:'咖啡馆',angle:'侧面',style:'自然手机感',person:null,pose:null},false)`);
  assert.equal(h.run("state.tryOn.size"), 0);
  assert.equal(h.run("state.tasks.length"), 0);
  assert.equal(h.run("state.extra"), "咖啡馆");
  h.run(`prepare({o:state.added[0],extra:'同一组设置',angle:'侧面',style:'自然手机感',person:null,pose:null})`);
  assert.equal(h.run("state.tryOn.has('a')"), true);
  assert.equal(h.run("state.tasks.length"), 0);
});

test("opening a result consumes only its unread notice", () => {
  const h = harness();
  h.run(`state.unread=new Set(['a','b']);showResult({id:'a',url:'blob:a',name:'a',snapshot:{angle:'正面',style:'自然手机感',extra:''}})`);
  assert.equal(h.run("state.unread.has('a')"), false);
  assert.equal(h.run("state.unread.has('b')"), true);
  assert.match(h.el("resultsNav").innerHTML, /1 新/);
});
test("task updates preserve unchanged shortlist nodes", () => {
  const h = harness();
  h.run(`state.added=[{id:'a',name:'a',local:true,url:'blob:a'}];state.tryOn.add('a');updateShortlistControls()`);
  const writes = h.el("shortlistControls").htmlWrites;
  h.run(`state.tasks=[{id:'running',status:'running'}];syncTasks();syncTasks()`);
  assert.equal(h.el("shortlistControls").htmlWrites, writes);
  assert.match(h.el("generationStatus").textContent, /1 个立即开始/);
});
test("returning from a result restores list scroll position", () => {
  const h = harness();
  h.run(`state.page='results';window.scrollY=460;showResult({id:'a',url:'blob:a',name:'a',snapshot:{angle:'正面',style:'自然手机感',extra:''}});results()`);
  assert.equal(h.scrolls.at(-1).top, 460);
});

const $ = (id) => document.getElementById(id),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const state = {
  items: [],
  poses: [],
  tryOn: new Set(),
  added: [],
  results: [],
  tasks: [],
  page: "home",
  category: "全部",
  query: "",
  limit: 24,
  selected: null,
  pose: null,
  angle: "正面",
  style: "自然手机感",
  person: null,
  personUrl: null,
  connected: false,
  extra: "",
  unread: new Set(),
  sources: { catalog: "loading", poses: "loading", styles: "loading" },
  styles: [],
  galleryScroll: 0,
  resultsScroll: 0,
  workbenchView: { scroll: 0, shortlistScroll: 0, extraOpen: false },
  poseView: { category: "全部", query: "", scroll: 0 },
};
let objects = new Set();
const objectURL = (file) => {
  const url = URL.createObjectURL(file);
  objects.add(url);
  return url;
};

/**
 * 书链搜 — 纯前端小说链接聚合搜索
 * 仅索引公开元数据，点击跳转原站
 */

const DATA_URL = "./data/novels.json";
const DEBOUNCE_MS = 280;
const DEFAULT_LIMIT = 48;

/** @typedef {{ id: string, title: string, url: string, bookId?: string, author?: string, source?: string, cover?: string, description?: string, tags?: string[] }} NovelEntry */

/** @type {NovelEntry[]} */
let allNovels = [];
/** @type {Set<string>} */
let activeSources = new Set();
let searchQuery = "";
let debounceTimer = null;

const $ = (id) => document.getElementById(id);

const els = {
  searchInput: $("searchInput"),
  searchClear: $("searchClear"),
  searchForm: $("searchForm"),
  filterBar: $("filterBar"),
  filterChips: $("filterChips"),
  resultsGrid: $("resultsGrid"),
  resultsMeta: $("resultsMeta"),
  stateWelcome: $("stateWelcome"),
  stateLoading: $("stateLoading"),
  stateEmpty: $("stateEmpty"),
  stateError: $("stateError"),
  errorMessage: $("errorMessage"),
  retryBtn: $("retryBtn"),
  themeToggle: $("themeToggle"),
};

// ——— Theme ———
function initTheme() {
  const stored = localStorage.getItem("booklink-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = stored || (prefersDark ? "dark" : "light");
  document.documentElement.setAttribute("data-theme", theme);
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("booklink-theme", next);
}

// ——— Data loading ———
async function loadNovels() {
  showState("loading");
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.novels)) throw new Error("数据格式错误：缺少 novels 数组");
    allNovels = data.novels.filter(validateEntry);
    buildSourceFilters();
    renderResults();
  } catch (err) {
    els.errorMessage.textContent = err.message || "未知错误";
    showState("error");
  }
}

/** @param {unknown} entry */
function validateEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  const n = /** @type {Record<string, unknown>} */ (entry);
  return (
    typeof n.id === "string" &&
    typeof n.title === "string" &&
    typeof n.url === "string" &&
    n.url.startsWith("http")
  );
}

// ——— Search & filter ———
function normalize(str) {
  return String(str)
    .toLowerCase()
    .replace(/\s+/g, "")
    .trim();
}

/** @param {NovelEntry} novel @param {string} q */
function matchesQuery(novel, q) {
  if (!q) return true;
  const nq = normalize(q);
  const haystack = [
    novel.title,
    novel.author || "",
    novel.description || "",
    ...(novel.tags || []),
  ]
    .map(normalize)
    .join("|");
  return haystack.includes(nq) || fuzzyMatch(haystack, nq);
}

/** 简单子序列模糊匹配（支持漏字） */
function fuzzyMatch(text, query) {
  if (query.length < 2) return false;
  let ti = 0;
  for (let qi = 0; qi < query.length; qi++) {
    const found = text.indexOf(query[qi], ti);
    if (found === -1) return false;
    ti = found + 1;
  }
  return true;
}

/** @returns {NovelEntry[]} */
function getFilteredNovels() {
  return allNovels.filter((novel) => {
    if (activeSources.size > 0 && !activeSources.has(novel.source)) return false;
    return matchesQuery(novel, searchQuery);
  });
}

function buildSourceFilters() {
  const sources = [...new Set(allNovels.map((n) => n.source).filter(Boolean))].sort();
  els.filterChips.innerHTML = "";
  if (sources.length <= 1) {
    els.filterBar.hidden = true;
    return;
  }
  els.filterBar.hidden = false;

  const allChip = document.createElement("button");
  allChip.type = "button";
  allChip.className = "filter-chip is-active";
  allChip.textContent = "全部";
  allChip.dataset.source = "";
  allChip.addEventListener("click", () => {
    activeSources.clear();
    updateChipUI();
    renderResults();
  });
  els.filterChips.appendChild(allChip);

  for (const source of sources) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "filter-chip";
    chip.textContent = source;
    chip.dataset.source = source;
    chip.addEventListener("click", () => {
      if (activeSources.has(source)) {
        activeSources.delete(source);
      } else {
        activeSources.add(source);
      }
      updateChipUI();
      renderResults();
    });
    els.filterChips.appendChild(chip);
  }
}

function updateChipUI() {
  const chips = els.filterChips.querySelectorAll(".filter-chip");
  chips.forEach((chip) => {
    const src = chip.dataset.source;
    if (!src) {
      chip.classList.toggle("is-active", activeSources.size === 0);
    } else {
      chip.classList.toggle("is-active", activeSources.has(src));
    }
  });
}

// ——— Render ———
function showState(name) {
  const map = {
    welcome: els.stateWelcome,
    loading: els.stateLoading,
    empty: els.stateEmpty,
    error: els.stateError,
  };
  for (const [key, el] of Object.entries(map)) {
    el.hidden = key !== name;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @returns {{ platform: string, id: string } | null} */
function parseBookRef(novel) {
  if (novel.bookId) {
    const src = novel.source || "";
    if (src.includes("起点")) return { platform: "qidian", id: novel.bookId };
    if (src.includes("纵横")) return { platform: "zongheng", id: novel.bookId };
    if (src.includes("晋江")) return { platform: "jjwxc", id: novel.bookId };
    if (src.includes("QQ")) return { platform: "qq", id: novel.bookId };
    if (src.includes("豆瓣")) return { platform: "douban", id: novel.bookId };
  }
  const url = novel.url || "";
  const rules = [
    { platform: "qidian", re: /qidian\.com\/book\/(\d+)/ },
    { platform: "zongheng", re: /zongheng\.com\/detail\/(\d+)/ },
    { platform: "jjwxc", re: /novelid=(\d+)/ },
    { platform: "qq", re: /book_id\/(\d+)|novel\.qq\.com\/detail\/(\d+)/ },
  ];
  for (const { platform, re } of rules) {
    const m = url.match(re);
    if (m) return { platform, id: m[1] || m[2] };
  }
  return null;
}

/**
 * 原站公开封面 CDN（与起点书籍页 img 同源）
 * 起点：bookcover.yuewen.com/qdbimg/...
 * 纵横/晋江/QQ：bookcover.yuewen.com/{id}/180
 */
/** @param {string} platform @param {string} id @param {number} [size] */
function platformCoverUrl(platform, id, size = 180) {
  switch (platform) {
    case "qidian":
      return `https://bookcover.yuewen.com/qdbimg/349573/${id}/${size}`;
    case "zongheng":
    case "jjwxc":
    case "qq":
    case "douban":
      return `https://bookcover.yuewen.com/${id}/${size}`;
    default:
      return "";
  }
}

/** @param {string} platform @param {string} id @param {number} [size] */
function platformCoverMirror(platform, id, size = 180) {
  if (platform === "qidian") {
    return `https://qidian.qpic.cn/qdbimg/349573/${id}/${size}`;
  }
  if (platform === "jjwxc") {
    return `https://img.jjwxc.net/novelcover/${id}.jpg`;
  }
  return "";
}

/** @param {string} title @param {string} [author] */
function generateCoverDataUri(title, author = "") {
  const t = title.slice(0, 8);
  const a = author ? author.slice(0, 10) : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="400" viewBox="0 0 300 400">
    <rect width="300" height="400" fill="#ebe3d6"/>
    <rect x="20" y="20" width="260" height="360" rx="10" fill="#fffdf9" stroke="#8b3a3a" stroke-width="2" opacity="0.4"/>
    <text x="150" y="170" text-anchor="middle" font-family="serif" font-size="22" fill="#8b3a3a">${t.replace(/[<>&"]/g, "")}</text>
    ${a ? `<text x="150" y="210" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#6b5f4f">${a.replace(/[<>&"]/g, "")}</text>` : ""}
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** @param {NovelEntry} novel */
function getCoverCandidates(novel) {
  const ref = parseBookRef(novel);
  const list = [];

  // 1. 优先使用 JSON 中的原站封面直链
  if (novel.cover && !/img\.qidian\.com\/upload/i.test(novel.cover)) {
    list.push(novel.cover);
  }

  // 2. 按平台规则拼接原站 CDN 地址
  if (ref) {
    const official = platformCoverUrl(ref.platform, ref.id, 180);
    if (official && !list.includes(official)) list.push(official);
    const mirror = platformCoverMirror(ref.platform, ref.id, 180);
    if (mirror && !list.includes(mirror)) list.push(mirror);
    if (ref.platform === "qidian") {
      const qpic = `https://qidian.qpic.cn/qdbimg/349573/${ref.id}/180`;
      if (!list.includes(qpic)) list.push(qpic);
    }
  }

  const generated = generateCoverDataUri(novel.title, novel.author);
  if (!list.includes(generated)) list.push(generated);
  return list;
}

/** @param {NovelEntry} novel */
function resolveCover(novel) {
  return getCoverCandidates(novel)[0] || "./assets/cover-fallback.svg";
}

/** @param {HTMLImageElement} img */
function handleCoverError(img) {
  const step = Number(img.dataset.coverStep || "0");
  const alternates = (img.dataset.coverAlternates || "").split("|").filter(Boolean);
  if (step < alternates.length) {
    img.dataset.coverStep = String(step + 1);
    img.src = alternates[step];
    return;
  }
  img.onerror = null;
  img.src = img.dataset.coverFallback || "./assets/cover-fallback.svg";
}

/** @param {NovelEntry} novel */
function renderCard(novel) {
  const candidates = getCoverCandidates(novel);
  const cover = candidates[0];
  const alternates = candidates.slice(1).join("|");
  const fallback = generateCoverDataUri(novel.title, novel.author);
  const author = novel.author ? `<p class="novel-card__author">${escapeHtml(novel.author)}</p>` : "";
  const desc = novel.description
    ? `<p class="novel-card__desc">${escapeHtml(novel.description)}</p>`
    : "";
  const source = novel.source
    ? `<span class="novel-card__source">${escapeHtml(novel.source)}</span>`
    : "";

  return `
    <article class="novel-card">
      <a class="novel-card__link" href="${escapeHtml(novel.url)}" target="_blank" rel="noopener noreferrer" title="前往原站阅读：${escapeHtml(novel.title)}">
        <div class="novel-card__cover-wrap">
          <img
            class="novel-card__cover"
            src="${escapeHtml(cover)}"
            alt="${escapeHtml(novel.title)} 封面"
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
            data-cover-step="0"
            data-cover-alternates="${escapeHtml(alternates)}"
            data-cover-fallback="${escapeHtml(fallback)}"
            title="封面图片来自原站 CDN"
          />
          ${source}
        </div>
        <div class="novel-card__body">
          <h3 class="novel-card__title">${escapeHtml(novel.title)}</h3>
          ${author}
          ${desc}
          <span class="novel-card__cta">
            前往原站阅读
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M7 17L17 7M17 7H7M17 7v10"/></svg>
          </span>
        </div>
      </a>
    </article>
  `;
}

function renderResults() {
  const filtered = getFilteredNovels();
  const display = filtered.slice(0, DEFAULT_LIMIT);
  const hasQuery = searchQuery.trim().length > 0;

  if (allNovels.length === 0) return;

  els.resultsGrid.innerHTML = display.map(renderCard).join("");
  els.resultsGrid.querySelectorAll(".novel-card__cover").forEach((img) => {
    img.addEventListener("error", () => handleCoverError(/** @type {HTMLImageElement} */ (img)));
  });

  if (display.length === 0) {
    els.resultsMeta.textContent = "";
    showState("empty");
    els.resultsGrid.innerHTML = "";
    return;
  }

  showState(hasQuery ? null : "welcome");

  if (!hasQuery && activeSources.size === 0) {
    els.resultsMeta.textContent = `共收录 ${allNovels.length} 部，以下为热门推荐`;
    els.stateWelcome.hidden = false;
  } else {
    els.stateWelcome.hidden = true;
    const suffix = filtered.length > DEFAULT_LIMIT ? `（仅显示前 ${DEFAULT_LIMIT} 条）` : "";
    els.resultsMeta.textContent = `找到 ${filtered.length} 个结果${suffix}`;
  }
}

// ——— Events ———
function onSearchInput() {
  const value = els.searchInput.value;
  els.searchClear.hidden = !value;
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    searchQuery = value.trim();
    renderResults();
  }, DEBOUNCE_MS);
}

function initEvents() {
  els.searchInput.addEventListener("input", onSearchInput);
  els.searchClear.addEventListener("click", () => {
    els.searchInput.value = "";
    els.searchClear.hidden = true;
    searchQuery = "";
    els.searchInput.focus();
    renderResults();
  });
  els.searchForm.addEventListener("submit", (e) => {
    e.preventDefault();
    searchQuery = els.searchInput.value.trim();
    renderResults();
  });
  els.retryBtn.addEventListener("click", loadNovels);
  els.themeToggle.addEventListener("click", toggleTheme);
}

// ——— Boot ———
initTheme();
initEvents();
loadNovels();

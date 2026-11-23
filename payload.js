/* ============================================================
   payload.js —— 在 Codex 渲染进程内执行
   inject.js 会把它包成：(() => { const CSS = "..."; <本文件内容> })()
   ============================================================ */

const CF_VER = "1.8.0";
const KEY = "cf-glass-v1";
const DEFAULTS = { t: 55, blur: 26, on: true, collapsed: false, x: null, y: null };

let s = DEFAULTS;
try {
  s = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || "{}"));
} catch (e) {}

const save = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch (e) {}
};

/* ---------- 1. 注入样式 ---------- */
let styleEl = document.getElementById("cf-style");
if (!styleEl) {
  styleEl = document.createElement("style");
  styleEl.id = "cf-style";
  document.head.appendChild(styleEl);
}
styleEl.textContent = CSS;

/* ---------- 2. 氛围层 ---------- */
const ensureLayer = (id) => {
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement("div");
    el.id = id;
    el.setAttribute("aria-hidden", "true");
    document.body.insertBefore(el, document.body.firstChild);
  }
  return el;
};
ensureLayer("cf-backdrop");
ensureLayer("cf-grain");

/* ---------- 2.5 玻璃后面的"景"：多尺度光斑场 ----------
   为什么需要：backdrop-filter 的 blur 只会吃掉画面的"细节"（高频信息）。
   如果背后只有一层平滑渐变，blur 0 → 60 出来的是同一张图，用户会觉得滑块坏了。
   所以这里放一张由小到大 4 个尺度的光斑图：
     0-6px 的尘埃  → 模糊一开就糊掉（低端立刻有反馈）
     20-70px 光斑  → 中段逐渐软化
     70-150px 光晕 → 高端才融合
   这样 0 → 60 全程都有可感知的变化。种子固定，每次启动画面一致。 */
const mulberry32 = (a) => () => {
  a |= 0;
  a = (a + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const buildScene = () => {
  const rnd = mulberry32(20261123);
  const W = 1600;
  const H = 1000;
  const PAL = [
    [232, 238, 255],
    [186, 158, 255],
    [140, 170, 255],
    [150, 232, 226],
    [255, 196, 214],
    [255, 226, 190],
  ];
  const dots = [];
  const add = (n, rMin, rMax, aMin, aMax) => {
    for (let i = 0; i < n; i++) {
      const c = PAL[Math.floor(rnd() * PAL.length)];
      const r = (rMin + rnd() * (rMax - rMin)).toFixed(1);
      const a = (aMin + rnd() * (aMax - aMin)).toFixed(3);
      dots.push(
        `<circle cx='${(rnd() * W).toFixed(1)}' cy='${(rnd() * H).toFixed(1)}' r='${r}' fill='rgb(${c})' fill-opacity='${a}'/>`
      );
    }
  };
  add(160, 1.2, 3.8, 0.1, 0.26); // 尘埃 / 光点
  add(80, 5, 16, 0.05, 0.13); // 小光斑
  add(46, 22, 70, 0.045, 0.1); // 中光斑
  add(16, 90, 210, 0.025, 0.055); // 大光晕

  return (
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${W} ${H}' preserveAspectRatio='xMidYMid slice'>` +
    dots.join("") +
    `</svg>`
  );
};

const backdropEl = document.getElementById("cf-backdrop");
if (backdropEl && backdropEl.dataset.cfScene !== CF_VER) {
  backdropEl.style.setProperty(
    "--cf-scene",
    `url("data:image/svg+xml,${encodeURIComponent(buildScene())}")`
  );
  backdropEl.dataset.cfScene = CF_VER;
}

/* ---------- 3. 几何打标：找出输入框 / 侧边栏 ---------- */
const tag = () => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // 输入框：从 textarea / contenteditable 往上找有圆角的容器
  document.querySelectorAll("[data-cf-composer]").forEach((el) => el.removeAttribute("data-cf-composer"));
  const input = document.querySelector("textarea, [contenteditable='true'], [role='textbox']");
  if (input) {
    let node = input,
      hop = 0;
    while (node && node !== document.body && hop < 7) {
      const r = node.getBoundingClientRect();
      const cs = getComputedStyle(node);
      const radius = parseFloat(cs.borderTopLeftRadius) || 0;
      if (r.width >= 220 && r.height >= 36 && radius >= 8) {
        node.setAttribute("data-cf-composer", "");
        break;
      }
      node = node.parentElement;
      hop++;
    }
  }

  // 侧边栏：左侧、接近整高、宽度像侧栏
  document.querySelectorAll("[data-cf-sidebar]").forEach((el) => el.removeAttribute("data-cf-sidebar"));
  const all = document.querySelectorAll("#root div, #root aside, #root nav");
  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (
      r.height >= vh * 0.82 &&
      r.width >= 180 &&
      r.width <= Math.min(520, vw * 0.42) &&
      r.left <= 4
    ) {
      el.setAttribute("data-cf-sidebar", "");
      break;
    }
  }
};

/* ---------- 4. 控制面板 ---------- */
let panel = document.getElementById("cf-panel");
if (!panel) {
  panel = document.createElement("div");
  panel.id = "cf-panel";
  panel.innerHTML = `
    <div class="cf-head">
      <span class="cf-dot"></span>
      <span class="cf-title">磨砂玻璃</span>
      <button class="cf-power" title="开关 (Ctrl+Shift+G)">◐</button>
      <button class="cf-min" title="收起">–</button>
    </div>
    <div class="cf-body">
      <label class="cf-row">
        <span>透明</span>
        <input class="cf-t" type="range" min="0" max="100" step="1">
        <b class="cf-tv"></b>
      </label>
      <label class="cf-row">
        <span>模糊</span>
        <input class="cf-b" type="range" min="0" max="60" step="1">
        <b class="cf-bv"></b>
      </label>
      <div class="cf-hint">拖动标题移动 · Ctrl+Shift+G 隐藏面板</div>
    </div>`;
  document.body.appendChild(panel);
}

const $ = (sel) => panel.querySelector(sel);
const tInput = $(".cf-t");
const bInput = $(".cf-b");
const tVal = $(".cf-tv");
const bVal = $(".cf-bv");

/* ---------- 5. 应用设置 ---------- */
const apply = () => {
  const html = document.documentElement;
  const alpha = 1 - (s.t / 100) * 0.94; // t=0 → 1.0（不透）, t=100 → 0.06（几乎全透）
  const frost = 0.004 + s.blur * 0.0007; // 模糊越大 → 表面颗粒越明显（模拟玻璃越粗糙）
  html.style.setProperty("--cf-alpha", alpha.toFixed(3));
  html.style.setProperty("--cf-blur", s.blur + "px");
  html.style.setProperty("--cf-frost", frost.toFixed(4));
  html.classList.toggle("cf-off", !s.on);
  panel.classList.toggle("cf-off", !s.on);
  panel.classList.toggle("cf-collapsed", !!s.collapsed);
  tInput.value = s.t;
  bInput.value = s.blur;
  tVal.textContent = s.t + "%";
  bVal.textContent = s.blur + "px";
  if (s.x !== null && s.y !== null) {
    const maxX = window.innerWidth - 60;
    const maxY = window.innerHeight - 40;
    panel.style.left = Math.max(0, Math.min(s.x, maxX)) + "px";
    panel.style.top = Math.max(0, Math.min(s.y, maxY)) + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }
};

let saveTimer = null;
const scheduleSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 250);
};

tInput.addEventListener("input", () => {
  s.t = +tInput.value;
  apply();
  scheduleSave();
});
bInput.addEventListener("input", () => {
  s.blur = +bInput.value;
  apply();
  scheduleSave();
});
$(".cf-power").addEventListener("click", () => {
  s.on = !s.on;
  apply();
  save();
});
$(".cf-min").addEventListener("click", () => {
  s.collapsed = !s.collapsed;
  apply();
  save();
});

/* 拖动 */
(() => {
  const head = $(".cf-head");
  let dragging = false,
    ox = 0,
    oy = 0;
  head.addEventListener("mousedown", (e) => {
    if (e.target.tagName === "BUTTON") return;
    const r = panel.getBoundingClientRect();
    dragging = true;
    ox = e.clientX - r.left;
    oy = e.clientY - r.top;
    e.preventDefault();
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    s.x = Math.max(0, Math.min(e.clientX - ox, window.innerWidth - 60));
    s.y = Math.max(0, Math.min(e.clientY - oy, window.innerHeight - 40));
    panel.style.left = s.x + "px";
    panel.style.top = s.y + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  });
  window.addEventListener("mouseup", () => {
    if (!dragging) return;
    dragging = false;
    scheduleSave();
  });
})();

/* 快捷键：隐藏/显示面板 */
if (!window.__cfKeyBound) {
  window.__cfKeyBound = true;
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "G" || e.key === "g")) {
        e.preventDefault();
        panel.classList.toggle("cf-hidden");
      }
    },
    true
  );
}

/* ---------- 6. 跟随 SPA 重渲染 ---------- */
let tagTimer = null;
const scheduleTag = () => {
  clearTimeout(tagTimer);
  tagTimer = setTimeout(tag, 220);
};

if (!window.__cfObserver) {
  window.__cfObserver = new MutationObserver((records) => {
    for (const r of records) {
      if (r.target && r.target.id === "cf-panel") continue;
      scheduleTag();
      return;
    }
  });
  window.__cfObserver.observe(document.body, { childList: true, subtree: true });
}
window.addEventListener("resize", scheduleTag);

/* ---------- 7. 启动 ---------- */
tag();
apply();

document.documentElement.dataset.cfSkin = CF_VER;
return {
  version: CF_VER,
  alpha: getComputedStyle(document.documentElement).getPropertyValue("--cf-alpha").trim(),
  blur: getComputedStyle(document.documentElement).getPropertyValue("--cf-blur").trim(),
  composer: !!document.querySelector("[data-cf-composer]"),
  sidebar: !!document.querySelector("[data-cf-sidebar]"),
  surfaceToken: getComputedStyle(document.documentElement)
    .getPropertyValue("--color-token-main-surface-primary")
    .trim(),
};

/* ============================================================
   payload.js —— 在 Codex 渲染进程内执行
   inject.js 会把它包成：(() => { const CSS = "..."; <本文件内容> })()
   纯透明度版：只调透明，不做模糊、不放背景细节。
   ============================================================ */

const CF_VER = "1.9.0";
const KEY = "cf-glass-v1";
const DEFAULTS = { t: 55, on: true, collapsed: false, x: null, y: null };

/* 头像浮层这类小窗口不套皮肤：它会把浮层变成一块渐变底 + 角落多出控制面板 */
if (/avatar-overlay/i.test(location.search + location.hash)) {
  return { version: CF_VER, skipped: "avatar-overlay" };
}

let s = DEFAULTS;
try {
  s = Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(KEY) || "{}"));
} catch (e) {}
// 兼容旧版本存下的 blur 字段：直接丢弃
delete s.blur;

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

/* ---------- 2. 底色层（玻璃后面只有一层平滑渐变） ---------- */
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

/* 清掉旧版本（含模糊）留下的颗粒层与散景背景 */
document.getElementById("cf-grain")?.remove();
const backdropEl = document.getElementById("cf-backdrop");
if (backdropEl) {
  backdropEl.style.removeProperty("--cf-scene");
  delete backdropEl.dataset.cfScene;
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
      <div class="cf-hint">拖动标题移动 · Ctrl+Shift+G 隐藏面板</div>
    </div>`;
  document.body.appendChild(panel);
} else {
  // 清掉旧版本残留的"模糊"滑块
  panel.querySelectorAll(".cf-b").forEach((n) => n.closest(".cf-row").remove());
}

const $ = (sel) => panel.querySelector(sel);
const tInput = $(".cf-t");
const tVal = $(".cf-tv");

/* ---------- 5. 应用设置 ---------- */
const apply = () => {
  const html = document.documentElement;
  const alpha = 1 - (s.t / 100) * 0.94; // t=0 → 1.0（不透）, t=100 → 0.06（几乎全透）
  html.style.setProperty("--cf-alpha", alpha.toFixed(3));
  html.classList.toggle("cf-off", !s.on);
  panel.classList.toggle("cf-off", !s.on);
  panel.classList.toggle("cf-collapsed", !!s.collapsed);
  tInput.value = s.t;
  tVal.textContent = s.t + "%";
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
  composer: !!document.querySelector("[data-cf-composer]"),
  sidebar: !!document.querySelector("[data-cf-sidebar]"),
  surfaceToken: getComputedStyle(document.documentElement)
    .getPropertyValue("--color-token-main-surface-primary")
    .trim(),
};

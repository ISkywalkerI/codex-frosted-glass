/* ============================================================
   payload.js —— 在 Codex 渲染进程内执行
   inject.js 会把它包成：(() => { const CSS = "..."; <本文件内容> })()
   透明度 + 渐变配色（HSV 色轮）：只调透明与背景渐变的 3 个颜色，
   其余光晕与玻璃底色由主光/副光/底色派生。
   ============================================================ */

const CF_VER = "1.12.0";
const KEY = "cf-glass-v1";

/* 3 个可调颜色的默认值 = v1.9.1 的硬编码观感 */
const COLORS = { main: "#883ff1", alt: "#3566f0", base: "#0b1728" };

/* hidden: 默认隐藏调节面板，按 Ctrl+Shift+G 调出（首次运行即隐藏） */
const DEFAULTS = {
  t: 55,
  on: true,
  collapsed: false,
  hidden: true,
  x: null,
  y: null,
  c: { main: COLORS.main, alt: COLORS.alt, base: COLORS.base },
};

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

/* 同一个页面被重复注入时共用一份状态：
   否则旧实例会用它的过期快照把 localStorage 覆盖回去（表现为透明度自己跳回旧值）。 */
if (window.__cfState) s = window.__cfState;
else window.__cfState = s;

/* 颜色字段归一化 —— 必须在拿到共享态之后做，否则旧实例的 __cfState 可能没有 c。
   3 位 hex 补全，任何脏数据（"red" / null / 缺字段）静默回落默认，不抛错、不阻断注入。 */
const HEX6 = /^#[0-9a-f]{6}$/i;
const normHex = (v, d) => {
  if (typeof v !== "string") return d;
  let t = v.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(t)) t = "#" + t[1] + t[1] + t[2] + t[2] + t[3] + t[3];
  return HEX6.test(t) ? t : d;
};
s.c = {
  main: normHex(s.c && s.c.main, COLORS.main),
  alt: normHex(s.c && s.c.alt, COLORS.alt),
  base: normHex(s.c && s.c.base, COLORS.base),
};

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

/* ---------- 1.5 颜色：转换 / 派生 / 应用 ---------- */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r255 = (v) => Math.round(clamp(v, 0, 255));
const join = (a) => a.map(r255).join(", ");

const hexToRgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (r, g, b) =>
  "#" + [r, g, b].map((v) => r255(v).toString(16).padStart(2, "0")).join("");

const rgbToHsv = ([r, g, b]) => {
  const R = r / 255,
    G = g / 255,
    B = b / 255;
  const max = Math.max(R, G, B),
    min = Math.min(R, G, B),
    d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
};
const hsvToRgb = (h, s, v) => {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const t =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return t.map((u) => (u + m) * 255);
};
const hsvToHex = (h, s, v) => rgbToHex(...hsvToRgb(h, s, v));
const hexToHsv = (hex) => rgbToHsv(hexToRgb(hex));

const rgbToHsl = ([r, g, b]) => {
  const R = r / 255,
    G = g / 255,
    B = b / 255;
  const max = Math.max(R, G, B),
    min = Math.min(R, G, B),
    d = max - min;
  const l = (max + min) / 2;
  let h = 0,
    sat = 0;
  if (d) {
    sat = d / (1 - Math.abs(2 * l - 1));
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: sat, l };
};
const hslToRgb = (h, s, l) => {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const t =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return t.map((u) => (u + m) * 255);
};
const hexToHsl = (hex) => rgbToHsl(hexToRgb(hex));
const hslToHex = (h, s, l) => rgbToHex(...hslToRgb(h, s, l));

/* 派生规则（三盏不直接给用户调的光晕）：
   1) 主副光都是默认色时 → 精确等于 v1.9.1 那几个硬编码值（改底色时三盏光晕原地不动）
   2) 用户改过主/副光 → 取两者的混色，再压到固定的饱和度/明度，
      保证导出的光晕永远和用户选的两盏"同调"，不会出现"落日橙里冒出一盏绿光" */
const STOCK_G3 = [85, 118, 143];
const STOCK_G4 = [186, 67, 122];
const STOCK_G5 = [0, 214, 196];
const BASE_MAX_L = 0.3; // 底色亮度上限，防止选浅色把正文糊掉
const TINT_REF = [136, 63, 241];

/* 两色混合后重设饱和度/明度（保留混色得到的色相） */
const mixTone = (a, b, t, s, l) => {
  const m = a.map((v, i) => v + (b[i] - v) * t);
  return hslToRgb(rgbToHsl(m).h, s, l);
};

const derive = (mainHex, altHex, baseHex) => {
  const B = hexToHsl(baseHex);

  // 底色过亮 → 统一压到 L 0.30（保持 h/s，色相不漂）
  const safeBaseHex = B.l > BASE_MAX_L ? hslToHex(B.h, B.s, BASE_MAX_L) : baseHex;
  const baseRgb = hexToRgb(safeBaseHex);

  let g3, g4, g5;
  if (mainHex === COLORS.main && altHex === COLORS.alt) {
    g3 = STOCK_G3;
    g4 = STOCK_G4;
    g5 = STOCK_G5;
  } else {
    const M = hexToRgb(mainHex);
    const A = hexToRgb(altHex);
    g3 = mixTone(M, A, 0.5, 0.3, 0.45); // 右下：两光中间调，压得最灰
    g4 = mixTone(M, A, 0.28, 0.42, 0.5); // 左下：偏主光一点，稍亮
    g5 = mixTone(M, A, 0.72, 0.85, 0.42); // 中心：偏副光，最饱和但 alpha 只有 0.06
  }

  // 底色 3 个停靠点用加法，默认处精确命中 (11,23,40)/(7,15,28)/(8,19,31)
  const shift = (d) => baseRgb.map((v, i) => v + d[i]);

  return {
    safeBaseHex,
    g3,
    g4,
    g5,
    top: baseRgb,
    mid: shift([-4, -8, -12]),
    end: shift([-3, -4, -9]),
  };
};

/* 玻璃片底色 = 底色 × 0.85，再按主光相对默认的偏移轻微染色（8%），上限 60。
   必须是裸三元组：skin.css 用 rgb(var(--cf-tint)) 消费它。 */
const deriveTint = (baseHex, mainHex) => {
  const b = hexToRgb(baseHex);
  const m = hexToRgb(mainHex);
  return b.map((v, i) => r255(clamp(v * 0.85 + (m[i] - TINT_REF[i]) * 0.08, 0, 60))).join(", ");
};

const COLOR_PROPS = [
  "--cf-tint",
  "--cf-c-main",
  "--cf-c-alt",
  "--cf-c-base",
  "--cf-c-glow3",
  "--cf-c-glow4",
  "--cf-c-glow5",
  "--cf-base-top",
  "--cf-base-mid",
  "--cf-base-end",
];
const isStock = () => s.c.main === COLORS.main && s.c.alt === COLORS.alt && s.c.base === COLORS.base;

const applyColors = () => {
  const html = document.documentElement;
  // 没动过颜色 ⇒ 把变量交还给样式表里的字面数字，做到与 v1.9.1 字节级一致
  if (isStock()) {
    COLOR_PROPS.forEach((p) => html.style.removeProperty(p));
    return;
  }
  const d = derive(s.c.main, s.c.alt, s.c.base);
  const set = (p, v) => html.style.setProperty(p, v);
  set("--cf-c-main", join(hexToRgb(s.c.main)));
  set("--cf-c-alt", join(hexToRgb(s.c.alt)));
  set("--cf-c-base", join(hexToRgb(d.safeBaseHex)));
  set("--cf-c-glow3", join(d.g3));
  set("--cf-c-glow4", join(d.g4));
  set("--cf-c-glow5", join(d.g5));
  set("--cf-base-top", join(d.top));
  set("--cf-base-mid", join(d.mid));
  set("--cf-base-end", join(d.end));
  set("--cf-tint", deriveTint(d.safeBaseHex, s.c.main));
};

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
/* 头栏与主体分开建：头栏只建一次；主体在缺少新控件（旧版本已注入过）时重建。
   这样重复注入既不会堆出两套控件，也不会丢监听（绑定见下方 __cfPanelBound 守卫）。 */
const HEAD_HTML = `
    <div class="cf-head">
      <span class="cf-dot"></span>
      <span class="cf-title">磨砂玻璃</span>
      <button class="cf-power" title="开关 (Ctrl+Shift+G)">◐</button>
      <button class="cf-min" title="收起">–</button>
    </div>`;

const BODY_HTML = `
    <div class="cf-body">
      <label class="cf-row">
        <span>透明</span>
        <input class="cf-t" type="range" min="0" max="100" step="1">
        <b class="cf-tv"></b>
      </label>

      <div class="cf-presets" role="group" aria-label="配色预设">
        <span class="cf-preset" data-preset="aurora" role="button" tabindex="0" title="极光紫"></span>
        <span class="cf-preset" data-preset="ocean" role="button" tabindex="0" title="深海蓝"></span>
        <span class="cf-preset" data-preset="sunset" role="button" tabindex="0" title="落日橙"></span>
        <span class="cf-preset" data-preset="forest" role="button" tabindex="0" title="森林绿"></span>
        <span class="cf-preset" data-preset="slate" role="button" tabindex="0" title="灰玻璃"></span>
      </div>

      <div class="cf-targets" role="group" aria-label="编辑目标">
        <span class="cf-chip is-on" data-target="main" role="button" tabindex="0"><i class="cf-sw"></i><span>主光</span></span>
        <span class="cf-chip" data-target="alt" role="button" tabindex="0"><i class="cf-sw"></i><span>副光</span></span>
        <span class="cf-chip" data-target="base" role="button" tabindex="0"><i class="cf-sw"></i><span>底色</span></span>
      </div>

      <div class="cf-wheel">
        <div class="cf-ring"></div>
        <div class="cf-sv"></div>
        <i class="cf-knob cf-knob-h"></i>
        <i class="cf-knob cf-knob-sv"></i>
      </div>

      <div class="cf-readout">
        <input class="cf-hex" type="text" spellcheck="false" maxlength="7" aria-label="十六进制颜色">
        <span class="cf-rgb">
          <input class="cf-r" type="number" min="0" max="255" step="1" aria-label="R">
          <input class="cf-g" type="number" min="0" max="255" step="1" aria-label="G">
          <input class="cf-b" type="number" min="0" max="255" step="1" aria-label="B">
        </span>
      </div>

      <div class="cf-actions">
        <button class="cf-reset" type="button" title="重置配色：回到默认极光紫（不影响透明度）">重置配色</button>
      </div>

      <div class="cf-hint">拖动标题移动 · Ctrl+Shift+G 隐藏/显示</div>
    </div>`;

let panel = document.getElementById("cf-panel");
if (!panel) {
  panel = document.createElement("div");
  panel.id = "cf-panel";
  document.body.appendChild(panel);
}
if (!panel.querySelector(".cf-head")) panel.insertAdjacentHTML("afterbegin", HEAD_HTML);
if (!panel.querySelector(".cf-wheel")) {
  const oldBody = panel.querySelector(".cf-body");
  if (oldBody) oldBody.remove();
  panel.insertAdjacentHTML("beforeend", BODY_HTML);
}
// 旧版遗留控件（v1.7 的模糊滑块）
panel.querySelectorAll(".cf-b").forEach((n) => n.closest(".cf-row")?.remove());

const $ = (sel) => panel.querySelector(sel);
const tInput = $(".cf-t");
const tVal = $(".cf-tv");

/* 老面板（v1.11 及以前在本页注入过）没有「重置配色」按钮：就地补一个。
   不重建整块 .cf-body —— 重建会把已有控件连同监听一起换掉，
   而 window.__cfPanelBound 守卫又不会给新节点重新绑一次。 */
if (!panel.querySelector(".cf-actions")) {
  const ACTIONS_HTML = `
      <div class="cf-actions">
        <button class="cf-reset" type="button" title="重置配色：回到默认极光紫（不影响透明度）">重置配色</button>
      </div>`;
  const hint = panel.querySelector(".cf-hint");
  if (hint) hint.insertAdjacentHTML("beforebegin", ACTIONS_HTML);
  else panel.querySelector(".cf-body")?.insertAdjacentHTML("beforeend", ACTIONS_HTML);
}

/* ---------- 5. 应用设置 ---------- */
const apply = () => {
  const html = document.documentElement;
  const alpha = 1 - (s.t / 100) * 0.94; // t=0 → 1.0（不透）, t=100 → 0.06（几乎全透）
  html.style.setProperty("--cf-alpha", alpha.toFixed(3));
  html.classList.toggle("cf-off", !s.on);
  panel.classList.toggle("cf-off", !s.on);
  panel.classList.toggle("cf-collapsed", !!s.collapsed);
  panel.classList.toggle("cf-hidden", !!s.hidden);
  tInput.value = s.t;
  tVal.textContent = s.t + "%";
  if (s.x !== null && s.y !== null) {
    // 用面板实际尺寸钳制，保证整块面板都在窗口内（面板加高后旧坐标可能溢出）
    const maxX = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
    const maxY = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
    s.x = clamp(s.x, 8, maxX);
    s.y = clamp(s.y, 8, maxY);
    panel.style.left = s.x + "px";
    panel.style.top = s.y + "px";
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }
  applyColors();
  renderColorUI();
};

let saveTimer = null;
const scheduleSave = () => {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 250);
};

/* ---------- 5.5 配色 UI：预设 / 色靶 / 色轮 ---------- */
const PRESETS = {
  aurora: { name: "极光紫", main: "#883ff1", alt: "#3566f0", base: "#0b1728" },
  ocean: { name: "深海蓝", main: "#38bdf8", alt: "#2563eb", base: "#071826" },
  sunset: { name: "落日橙", main: "#ff8a3d", alt: "#e0447c", base: "#1a1018" },
  forest: { name: "森林绿", main: "#34d399", alt: "#0ea5a4", base: "#081713" },
  slate: { name: "灰玻璃", main: "#8fa0b8", alt: "#5b6b82", base: "#12161c" },
};

let target = "main"; // 当前编辑目标：main / alt / base（纯 UI 态，不写 localStorage）

const wheelEl = $(".cf-wheel");
const svEl = $(".cf-sv");
const knobH = $(".cf-knob-h");
const knobSV = $(".cf-knob-sv");
const hexInput = $(".cf-hex");
const rgbInputs = { r: $(".cf-r"), g: $(".cf-g"), b: $(".cf-b") };

/* 几何用布局尺寸（offsetWidth / 计算出的居中偏移），不用 getBoundingClientRect：
   面板隐藏态带 transform: scale(.98) translateY(8px)，rect 会把变换算进去 → knob 错位。 */
let geo = null;
const measureWheel = () => {
  const w = wheelEl.offsetWidth || 132;
  const h = wheelEl.offsetHeight || 132;
  geo = {
    w,
    h,
    svW: svEl.offsetWidth || 74,
    svH: svEl.offsetHeight || 74,
    svLeft: (w - (svEl.offsetWidth || 74)) / 2,
    svTop: (h - (svEl.offsetHeight || 74)) / 2,
  };
};

const drawWheel = (hsvOverride) => {
  if (!geo) measureWheel();
  const hsv = hsvOverride || hexToHsv(s.c[target]);
  wheelEl.style.setProperty("--cf-h", hsv.h.toFixed(1));
  const cx = geo.w / 2;
  const cy = geo.h / 2;
  const knobR = (geo.w / 2) * (59.25 / 66); // 59.25 = (66 + 52.5) / 2，环中线
  const rad = (hsv.h * Math.PI) / 180;
  knobH.style.left = cx + Math.sin(rad) * knobR + "px"; // 12 点 = 0° 红，顺时针
  knobH.style.top = cy - Math.cos(rad) * knobR + "px";
  knobSV.style.left = geo.svLeft + hsv.s * geo.svW + "px";
  knobSV.style.top = geo.svTop + (1 - hsv.v) * geo.svH + "px";
};

const renderColorUI = (hsvOverride, skipHex) => {
  // 预设缩略：主光 → 副光 → 底色
  panel.querySelectorAll(".cf-preset").forEach((el) => {
    const p = PRESETS[el.dataset.preset];
    if (!p) return;
    el.style.background = `linear-gradient(135deg, ${p.main} 0%, ${p.alt} 55%, ${p.base} 100%)`;
    // 高亮由三色比对推导，不存 preset 字段 —— 不会出现"高亮和实际颜色不一致"的脏状态
    const on = p.main === s.c.main && p.alt === s.c.alt && p.base === s.c.base;
    el.setAttribute("aria-pressed", on ? "true" : "false");
  });

  // 已经是默认配色时没什么可重置的
  const resetBtn = panel.querySelector(".cf-reset");
  if (resetBtn) resetBtn.disabled = isStock();

  // 色靶：色点 + 当前编辑目标
  panel.querySelectorAll(".cf-chip").forEach((el) => {
    const k = el.dataset.target;
    el.classList.toggle("is-on", k === target);
    const sw = el.querySelector(".cf-sw");
    if (sw) sw.style.background = s.c[k];
  });

  drawWheel(hsvOverride);

  // 读数：正在编辑的输入框不回写，否则打字被打断
  const hex = s.c[target];
  if (!skipHex && document.activeElement !== hexInput) hexInput.value = hex;
  const [r, g, b] = hexToRgb(hex);
  const cur = { r, g, b };
  Object.keys(rgbInputs).forEach((k) => {
    if (document.activeElement !== rgbInputs[k]) rgbInputs[k].value = cur[k];
  });
};

/* 提交一个颜色（唯一写入口：s.c[target] = hex） */
const commitHex = (hex) => {
  if (hex === s.c[target]) return;
  s.c[target] = hex;
  applyColors();
  renderColorUI();
  scheduleSave();
};

/* 色轮拖动 */
let mode = null; // "ring" | "sv"，手势开始时锁定
let rect = null;
let rafId = 0;
let pendingEv = null;

const onMove = (e) => {
  pendingEv = e;
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    const ev = pendingEv;
    pendingEv = null;
    if (!ev || !mode || !rect) return;
    const cur = hexToHsv(s.c[target]);
    let h = cur.h;
    let sat = cur.s;
    let v = cur.v;

    if (mode === "ring") {
      const dx = ev.clientX - (rect.left + geo.w / 2);
      const dy = ev.clientY - (rect.top + geo.h / 2);
      h = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
      // 纯黑/纯灰拖不出颜色，给个最小饱和与明度
      if (sat < 0.04) sat = 0.55;
      if (v < 0.04) v = 0.55;
    } else {
      sat = clamp((ev.clientX - rect.left - geo.svLeft) / geo.svW, 0, 1);
      v = 1 - clamp((ev.clientY - rect.top - geo.svTop) / geo.svH, 0, 1);
    }

    const hex = hsvToHex(h, sat, v);
    if (hex === s.c[target]) {
      drawWheel({ h, s: sat, v }); // 舍入没变也保持 knob 跟手
      return;
    }
    s.c[target] = hex;
    applyColors();
    renderColorUI({ h, s: sat, v }); // 用临时 HSV 画 knob，避免 hex 往返抖动
    scheduleSave();
  });
};

const endDrag = (e) => {
  if (!mode) return;
  mode = null;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
  try {
    wheelEl.releasePointerCapture(e.pointerId);
  } catch (err) {}
  save(); // 立即落盘，不等 250ms 防抖
};

/* 绑定：重复注入时面板 DOM 会复用，不加重绑守卫的话一次拖动会跳两格 */
if (!window.__cfPanelBound) {
  window.__cfPanelBound = true;

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

  /* 预设 & 色靶：点击 + 键盘（Enter / Space）委托到容器上 */
  const onActivate = (container, fn) => {
    container.addEventListener("click", (e) => {
      const el = e.target.closest("[data-preset], [data-target]");
      if (el) fn(el);
    });
    container.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const el = e.target.closest("[data-preset], [data-target]");
      if (!el) return;
      e.preventDefault();
      fn(el);
    });
  };

  onActivate($(".cf-presets"), (el) => {
    const p = PRESETS[el.dataset.preset];
    if (!p) return;
    s.c = { main: p.main, alt: p.alt, base: p.base };
    apply();
    save();
  });

  onActivate($(".cf-targets"), (el) => {
    target = el.dataset.target;
    renderColorUI();
  });

  /* 色轮 */
  wheelEl.addEventListener("pointerdown", (e) => {
    measureWheel();
    rect = wheelEl.getBoundingClientRect();
    // 命中判定用矩形包含，比半径判断更贴合视觉（环的 mask 不影响 hit-test）
    const sx = rect.left + geo.svLeft;
    const sy = rect.top + geo.svTop;
    const inSv =
      e.clientX >= sx && e.clientX <= sx + geo.svW && e.clientY >= sy && e.clientY <= sy + geo.svH;
    mode = inSv ? "sv" : "ring";
    try {
      wheelEl.setPointerCapture(e.pointerId);
    } catch (err) {}
    e.preventDefault();
    onMove(e);
  });
  wheelEl.addEventListener("pointermove", (e) => {
    if (mode) onMove(e);
  });
  wheelEl.addEventListener("pointerup", endDrag);
  wheelEl.addEventListener("pointercancel", endDrag);
  wheelEl.addEventListener("lostpointercapture", (e) => {
    if (mode) endDrag(e);
  });

  /* 精确输入 */
  hexInput.addEventListener("input", () => {
    let v = hexInput.value.trim();
    if (v && v[0] !== "#") v = "#" + v;
    if (!/^#[0-9a-f]{6}$/i.test(v)) return; // 输入到一半不打扰
    s.c[target] = v.toLowerCase();
    applyColors();
    renderColorUI(null, true); // 不回写正在输入的 hex 框
    scheduleSave();
  });
  hexInput.addEventListener("blur", () => {
    hexInput.value = s.c[target];
  });

  Object.keys(rgbInputs).forEach((k) => {
    rgbInputs[k].addEventListener("input", () => {
      if (rgbInputs.r.value === "" || rgbInputs.g.value === "" || rgbInputs.b.value === "") return;
      const r = clamp(+rgbInputs.r.value, 0, 255);
      const g = clamp(+rgbInputs.g.value, 0, 255);
      const b = clamp(+rgbInputs.b.value, 0, 255);
      commitHex(rgbToHex(r, g, b));
    });
  });

  /* 拖动面板 */
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
      const maxX = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
      const maxY = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
      s.x = clamp(e.clientX - ox, 8, maxX);
      s.y = clamp(e.clientY - oy, 8, maxY);
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
  window.addEventListener(
    "keydown",
    (e) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "G" || e.key === "g")) {
        e.preventDefault();
        s.hidden = !s.hidden;
        apply();
        save();
      }
    },
    true
  );
}

/* 重置配色：单独守卫，因为按钮可能是本次才补进老面板的，
   不能依赖上面 __cfPanelBound 的主绑定块再跑一遍。 */
(() => {
  const btn = panel.querySelector(".cf-reset");
  if (!btn || btn.dataset.cfBound) return;
  btn.dataset.cfBound = "1";
  btn.addEventListener("click", () => {
    s.c = { main: COLORS.main, alt: COLORS.alt, base: COLORS.base };
    applyColors(); // 三色回到默认 ⇒ removeProperty，与未改过完全一致
    renderColorUI();
    save(); // 立即落盘，不等防抖
  });
})();

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
window.addEventListener("resize", () => {
  scheduleTag();
  apply(); // 窗口变小后面板可能越界，重新钳一次位置
});

/* ---------- 7. 启动 ---------- */
tag();
apply();

/* 面板默认是隐藏的，注入后短暂提示一次怎么调出来 */
if (s.hidden && !document.getElementById("cf-toast")) {
  const tip = document.createElement("div");
  tip.id = "cf-toast";
  tip.textContent = "调节面板已隐藏 · Ctrl+Shift+G 调出";
  document.body.appendChild(tip);
  setTimeout(() => tip.remove(), 6500);
}

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

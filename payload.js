/* ============================================================
   payload.js —— 在 Codex 渲染进程内执行
   inject.js 会把它包成：(() => { const CSS = "..."; <本文件内容> })()
   透明度 + 渐变配色（HSV 色轮）：只调透明与背景渐变的 3 个颜色，
   其余光晕与玻璃底色由主光/副光/底色派生。
   ============================================================ */

const CF_VER = "1.14.1";
const KEY = "cf-glass-v1";

/* 3 个可调颜色的默认值 = v1.9.1 的硬编码观感
   baseL：同一个配色的浅色版底色。深浅两套底色分开存，是因为它们的明度方向相反
   （深色要压到 L 0.30 以下、浅色要抬到 L 0.86 以上），拿一个 hex 靠公式反推
   会让 #0b1728 变成灰粉，丢掉"极光紫"的身份。 */
const COLORS = { main: "#883ff1", alt: "#3566f0", base: "#0b1728", baseL: "#f5f3fc" };

/* hidden: 默认隐藏调节面板，按 Ctrl+Shift+G 调出（首次运行即隐藏）
   ct: 输入框透明度%，0 = 实心，30 = 最透。默认 3（= 97% 的底，实测临界值）
   mode: auto = 跟随系统外观（首次运行即跟随），light / dark = 手动锁定。
         默认 auto 在老存档上等价于"系统深色 → 深色"，观感与 v1.13 完全一致。 */
const DEFAULTS = {
  t: 55,
  ct: 3,
  on: true,
  collapsed: false,
  hidden: true,
  x: null,
  y: null,
  mode: "auto",
  c: { main: COLORS.main, alt: COLORS.alt, base: COLORS.base, baseL: COLORS.baseL },
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
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

s.c = {
  main: normHex(s.c && s.c.main, COLORS.main),
  alt: normHex(s.c && s.c.alt, COLORS.alt),
  base: normHex(s.c && s.c.base, COLORS.base),
  // 老存档没有 baseL（v1.13 及以前只有一套深色底色）：回落默认淡紫白，
  // 用户第一次在浅色模式下拖一次色轮就会写回自己的值。
  baseL: normHex(s.c && s.c.baseL, COLORS.baseL),
};

/* 主题模式：auto / light / dark。脏值一律回落 auto。
   auto 的语义是「跟随系统外观」而不是「跟随应用设置」—— 应用的 appearanceTheme
   存在 config.toml 里（我们这台机器上写死 dark），若跟随它就永远不会自动变浅。 */
const MODES = ["auto", "light", "dark"];
if (!MODES.includes(s.mode)) s.mode = "auto";
const MODE_NEXT = { auto: "light", light: "dark", dark: "auto" };

/* 系统外观。Chromium 在 Electron 里读的是操作系统设置，
   用户切系统主题时这里会触发 change，auto 模式下要立刻跟着翻。 */
const MEDIA_LIGHT = matchMedia("(prefers-color-scheme: light)");
const wantTheme = () => (s.mode === "auto" ? (MEDIA_LIGHT.matches ? "light" : "dark") : s.mode);
const isLight = () => wantTheme() === "light";

/* 输入框透明度：老存档里没有这个字段（或存了脏值），必须回落到默认 3，不能当 0 处理 ——
   `+undefined` 是 NaN，一旦被写成 0 就等于「实心」，用户会以为新控件坏了。 */
const ctRaw = Number(s.ct);
s.ct = Number.isFinite(ctRaw) ? clamp(Math.round(ctRaw), 0, 30) : DEFAULTS.ct;

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
/* 浅色模式的护栏方向相反：底色必须足够白，否则"淡彩"会变成一块灰玻璃，
   叠在浅色正文下面就是一片脏。两者互斥，由 derive() 的 light 参数二选一。 */
const BASE_MIN_L = 0.86;
const TINT_REF = [136, 63, 241];

/* 两色混合后重设饱和度/明度（保留混色得到的色相） */
const mixTone = (a, b, t, s, l) => {
  const m = a.map((v, i) => v + (b[i] - v) * t);
  return hslToRgb(rgbToHsl(m).h, s, l);
};

const derive = (mainHex, altHex, baseHex, light) => {
  const B = hexToHsl(baseHex);

  // 亮度护栏：深色压上限（太亮正文糊在底上），浅色抬下限（太暗淡彩变脏灰）
  const over = light ? B.l < BASE_MIN_L : B.l > BASE_MAX_L;
  const safeBaseHex = over ? hslToHex(B.h, B.s, light ? BASE_MIN_L : BASE_MAX_L) : baseHex;
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
  // 浅色用等量下沉（-6 / -11）而不是深色那组按通道递增的偏移，并托一个 226 的地板，
  // 否则浅底往下压会把渐变压成"上方白、下方灰"的分层感。
  const shift = (d) => baseRgb.map((v, i) => v + d[i]);
  const floor = light ? (v) => Math.max(v, 226) : (v) => v;

  return {
    safeBaseHex,
    g3,
    g4,
    g5,
    top: baseRgb,
    mid: shift(light ? [-6, -6, -6] : [-4, -8, -12]).map(floor),
    end: shift(light ? [-11, -11, -11] : [-3, -4, -9]).map(floor),
  };
};

/* 玻璃片底色 = 底色 × 0.85，再按主光相对默认的偏移轻微染色（8%），上限 60。
   必须是裸三元组：skin.css 用 rgb(var(--cf-tint)) 消费它。
   浅色分支方向相反：向白靠 42%，再叠一点主光染色，限制在 238–253 ——
   低于 238 就成了灰玻璃（白底上发脏），高于 253 则和纯白没差别、玻璃厚度消失。 */
const deriveTint = (baseHex, mainHex, light) => {
  const b = hexToRgb(baseHex);
  const m = hexToRgb(mainHex);
  return b
    .map((v, i) => {
      const d = (m[i] - TINT_REF[i]) * (light ? 0.06 : 0.08);
      return light
        ? r255(clamp(255 - (255 - v) * 0.42 + d, 238, 253))
        : r255(clamp(v * 0.85 + d, 0, 60));
    })
    .join(", ");
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
const isStock = () =>
  s.c.main === COLORS.main &&
  s.c.alt === COLORS.alt &&
  s.c.base === COLORS.base &&
  s.c.baseL === COLORS.baseL;

const applyColors = () => {
  const html = document.documentElement;
  // 没动过颜色 ⇒ 把变量交还给样式表里的字面数字，做到与 v1.9.1 字节级一致。
  // 浅色模式的默认值写在 skin.css §8.1 的 :root.cf-light 里，所以 removeProperty
  // 在浅色下同样落到正确的数字上，两个模式共用这条短路。
  if (isStock()) {
    COLOR_PROPS.forEach((p) => html.style.removeProperty(p));
    return;
  }
  const light = isLight();
  const d = derive(s.c.main, s.c.alt, light ? s.c.baseL : s.c.base, light);
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
  set("--cf-tint", deriveTint(d.safeBaseHex, s.c.main, light));
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

  // 输入框：从 textarea / contenteditable 往上找有圆角的容器。
  // 不能只取第一个可编辑区：欢迎页（新聊天）里还留着一个 0×0 的隐藏 ProseMirror，
  // document.querySelector 会先命中它，几何条件全不满足，整条打标链直接空转
  // （[data-cf-composer] 空着 → 高光/投影不出现，只能靠底色令牌兜着）。
  // 所以先筛掉没尺寸的，再按面积取最大的那个（主输入框）往上走。
  document.querySelectorAll("[data-cf-composer]").forEach((el) => el.removeAttribute("data-cf-composer"));
  const input = [...document.querySelectorAll("textarea, [contenteditable='true'], [role='textbox']")]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter((it) => it.r.width >= 120 && it.r.height >= 20)
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0]?.el;
  if (input) {
    let node = input,
      hop = 0;
    // 圆角容器距 contenteditable 6–7 跳：老会话是 ComposerLayoutRoot（圆角 22px、自带底），
    // 新聊天是它的子节点 ComposerLayoutBody（同样 22px，外层反而 0 圆角）。
    // 从里往外遇到的第一个圆角容器就是它，两边都能命中。
    // （原来的 hop < 7 从没检查到它，导致 [data-cf-composer] 规则一直空转。）
    while (node && node !== document.body && hop < 9) {
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
      <button class="cf-power" title="开关皮肤" aria-label="开关皮肤">◐</button>
      <button class="cf-theme" title="主题" aria-label="主题">◒</button>
      <button class="cf-min" title="收起">–</button>
    </div>`;

/* 「输入框」那一行 + 问号说明卡：面板里只此一份，老面板补控件时也复用 */
const COMPOSER_ROW = `
      <div class="cf-row cf-row-c">
        <span>输入框</span>
        <input class="cf-c" type="range" min="0" max="30" step="1" aria-label="输入框透明度">
        <b class="cf-cv"></b>
        <button class="cf-help" type="button" aria-label="输入框透明度取值说明">?</button>
        <div class="cf-tip" role="tooltip">
          <b>输入框透明度</b>
          <div class="cf-tip-sub">0 = 实心，越大越透</div>
          <div class="cf-tip-row"><i>0–3%</i><span>实心玻璃，背后看不见</span></div>
          <div class="cf-tip-row"><i>4–8%</i><span>隐约见轮廓，读不出字</span></div>
          <div class="cf-tip-row"><i>9–14%</i><span>看得出内容，开始干扰</span></div>
          <div class="cf-tip-row"><i>15%+</i><span>正文透上来，不建议</span></div>
        </div>
      </div>`;

const BODY_HTML = `
    <div class="cf-body">
      <label class="cf-row">
        <span>透明</span>
        <input class="cf-t" type="range" min="0" max="100" step="1">
        <b class="cf-tv"></b>
      </label>

      ${COMPOSER_ROW}

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

      <div class="cf-hint">拖动标题移动 · Ctrl+Shift+G 隐藏 · Ctrl+Shift+L 主题</div>
    </div>`;

let panel = document.getElementById("cf-panel");
if (!panel) {
  panel = document.createElement("div");
  panel.id = "cf-panel";
  document.body.appendChild(panel);
}
if (!panel.querySelector(".cf-head")) panel.insertAdjacentHTML("afterbegin", HEAD_HTML);
/* 主体重建条件：没有色轮（v1.11 及以前），或底注还是旧的快捷键文案（v1.13 及以前）。
   后者是升级路径的关键 —— 光有 .cf-wheel 不代表这份 DOM 是本版本的，
   老面板的底注写着「Ctrl+Shift+G 隐藏/显示」，用户会以为主题没有快捷键。 */
const staleHint = !/Ctrl\+Shift\+L/.test(
  panel.querySelector(".cf-hint")?.textContent || ""
);
if (!panel.querySelector(".cf-wheel") || staleHint) {
  const oldBody = panel.querySelector(".cf-body");
  if (oldBody) oldBody.remove();
  panel.insertAdjacentHTML("beforeend", BODY_HTML);
}
// 旧版遗留控件（v1.7 的模糊滑块）
panel.querySelectorAll(".cf-b").forEach((n) => n.closest(".cf-row")?.remove());

const $ = (sel) => panel.querySelector(sel);
const tInput = $(".cf-t");
const tVal = $(".cf-tv");
const cInputInit = $(".cf-c");

/* 老面板（v1.12.4 及以前在本页注入过）没有「输入框」这一行：就地补。
   同样是就地插入 —— 重建 .cf-body 会把已有控件连同监听一起换掉。 */
if (!cInputInit) {
  const presets = panel.querySelector(".cf-presets");
  if (presets) presets.insertAdjacentHTML("beforebegin", COMPOSER_ROW);
  else panel.querySelector(".cf-body")?.insertAdjacentHTML("afterbegin", COMPOSER_ROW);
}

/* 皮肤关闭时的提示条：色轮/色块照常可点但完全没效果，没有这条用户会以为调色坏了 */
if (!panel.querySelector(".cf-offnote")) {
  const OFF_HTML = `<div class="cf-offnote">皮肤已关闭 · 点 <b>◐</b> 重新打开</div>`;
  const head = panel.querySelector(".cf-head");
  if (head) head.insertAdjacentHTML("afterend", OFF_HTML);
}

/* 老面板（v1.13 及以前注入过）的头栏没有主题按钮：就地补一个。
   和大按钮块同样的道理 —— 不重建 .cf-head，重建会把已知节点换掉而监听不会重绑。 */
if (!panel.querySelector(".cf-theme")) {
  const THEME_HTML = `<button class="cf-theme" title="主题" aria-label="主题">◒</button>`;
  const minBtn = panel.querySelector(".cf-min");
  if (minBtn) minBtn.insertAdjacentHTML("beforebegin", THEME_HTML);
  else panel.querySelector(".cf-head")?.insertAdjacentHTML("beforeend", THEME_HTML);
}

/* 补完之后再取一次：老面板的这两个节点是刚插进去的 */
const cInput = $(".cf-c");
const cVal = $(".cf-cv");
const helpBtn = $(".cf-help");
const powerBtn = $(".cf-power");
const themeBtn = $(".cf-theme");

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

/* ---------- 4.5 主题：把 <html data-theme> 掰到与皮肤一致 ----------

   应用的深/浅外观不是靠 prefers-color-scheme，而是靠 <html data-theme="..."> 上的
   两个选择器：`[data-theme="light"]{color-scheme:light}` 与它那一整套 light-dark()
   令牌。一条属性就能把正文、图标、边框、语法高亮全部翻成黑字 —— 皮肤从不覆盖文字色
   （那是应用自己的令牌，几百条，覆盖不全就露馅），所以这条属性是浅色模式唯一的开关，
   也是唯一的风险点。

   风险：应用的 appearanceTheme 存在 ~/.codex/config.toml（本机写死 dark），
   设置页、配置回写、hydrate 都可能把属性改回去。这里盯着它：被改回去就重写；
   一秒内抢 6 次仍失败就当应用在强制外观，立刻跟到应用实际的主题上 ——
   绝不允许停在「浅玻璃 + 浅字」那种全白不可读的状态。 */
let weWroteTheme = null;
let weWroteAt = 0;
let assertCount = 0;
let assertWindow = 0;

const setAppTheme = (want) => {
  const html = document.documentElement;
  if (html.dataset.theme === want) return;
  const now = performance.now();
  if (now - assertWindow > 1000) {
    assertWindow = now;
    assertCount = 0;
  }
  if (++assertCount > 6) {
    adoptAppTheme();
    return;
  }
  weWroteTheme = want;
  weWroteAt = now;
  html.dataset.theme = want;
};

/* 抢不过时：跟着应用实际的主题走，皮肤与文字至少是一致的 */
const adoptAppTheme = () => {
  const actual = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  if (s.mode === actual) return;
  s.mode = actual;
  save();
  apply();
  toastMsg(
    "已切回与 Codex 一致的外观（应用锁定了主题）· Ctrl+Shift+L 可重试"
  );
};

const syncTheme = () => {
  const want = wantTheme();
  document.documentElement.classList.toggle("cf-light", want === "light");
  document.documentElement.style.colorScheme = want;
  setAppTheme(want);
};

/* 应用自己改属性（设置页切换外观）时的两种反应：
   auto → 不跟，我们按系统外观重新裁决；手动 → 改回去。 */
if (!window.__cfThemeObs) {
  window.__cfThemeObs = new MutationObserver(() => {
    const t = document.documentElement.dataset.theme;
    const mine = t === weWroteTheme && performance.now() - weWroteAt < 250;
    if (mine) return;
    if (s.mode === "auto") return;
    if (t !== s.mode) requestAnimationFrame(() => s.mode !== "auto" && syncTheme());
  });
  window.__cfThemeObs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

/* 系统在亮/暗之间切换：auto 模式下必须立刻跟着翻（这是 auto 的全部意义）。
   Chromium 在 Electron 里读的是操作系统设置，切系统主题时这里会触发。 */
MEDIA_LIGHT.addEventListener("change", () => {
  if (s.mode !== "auto") return;
  syncTheme();
  apply();
});

let toastTimer = null;
const toastMsg = (text) => {
  document.getElementById("cf-toast")?.remove();
  const tip = document.createElement("div");
  tip.id = "cf-toast";
  tip.textContent = text;
  document.body.appendChild(tip);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => tip.remove(), 5000);
};

/* ---------- 5. 应用设置 ---------- */
const apply = () => {
  const html = document.documentElement;
  syncTheme(); // 必须最先：底色/对比度全部依赖它算出来的 cf-light
  const alpha = 1 - (s.t / 100) * 0.94; // t=0 → 1.0（不透）, t=100 → 0.06（几乎全透）
  html.style.setProperty("--cf-alpha", alpha.toFixed(3));
  html.classList.toggle("cf-off", !s.on);
  panel.classList.toggle("cf-off", !s.on);
  panel.classList.toggle("cf-collapsed", !!s.collapsed);
  panel.classList.toggle("cf-hidden", !!s.hidden);
  tInput.value = s.t;
  tVal.textContent = s.t + "%";

  // 输入框：0–30% 透明 → 100%–70% 的实底。用 CSS 变量传百分比，样式表里只写一处
  const ctNum = Number(s.ct);
  const ct = Number.isFinite(ctNum) ? clamp(Math.round(ctNum), 0, 30) : DEFAULTS.ct;
  s.ct = ct;
  html.style.setProperty("--cf-composer-mix", 100 - ct + "%");
  if (cInput) cInput.value = ct;
  if (cVal) cVal.textContent = ct + "%";

  // ◐ 的文案必须说清它关的是什么：以前写「开关 (Ctrl+Shift+G)」，
  // 用户会以为这是在调「显示」，其实把整层皮肤关掉了。
  if (powerBtn) {
    powerBtn.title = s.on ? "关闭皮肤 · 切回原版外观" : "打开皮肤 · 应用磨砂玻璃";
    powerBtn.setAttribute("aria-pressed", s.on ? "true" : "false");
  }

  // 主题按钮：三态循环 auto → light → dark，图标直接表示当前档位。
  // 用 ☼ 而不是 ☀：后者在部分字体里会走彩色 emoji，和面板其余单色图标不搭。
  if (themeBtn) {
    const next = MODE_NEXT[s.mode] || "auto";
    const label = { auto: "跟随系统", light: "浅色", dark: "深色" }[s.mode];
    const nextLabel = { auto: "跟随系统", light: "浅色", dark: "深色" }[next];
    themeBtn.textContent = { auto: "◒", light: "☼", dark: "☾" }[s.mode];
    themeBtn.title = `主题：${label} · 点按切到${nextLabel}`;
    themeBtn.setAttribute("aria-pressed", s.mode === "auto" ? "false" : "true");
  }
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
/* 5 个配色，每个都带深/浅两套底色。
   baseL 是手挑的而不是从 base 推出来的：#0b1728 按「保色相、抬明度」推会得到 #ede8ed
   （灰粉），极光紫的身份就丢了。手挑的这组保证"同一个配色，白天和晚上是同一支香水"。 */
const PRESETS = {
  aurora: { name: "极光紫", main: "#883ff1", alt: "#3566f0", base: "#0b1728", baseL: "#f5f3fc" },
  ocean: { name: "深海蓝", main: "#38bdf8", alt: "#2563eb", base: "#071826", baseL: "#eef5fd" },
  sunset: { name: "落日橙", main: "#ff8a3d", alt: "#e0447c", base: "#1a1018", baseL: "#fdf1f0" },
  forest: { name: "森林绿", main: "#34d399", alt: "#0ea5a4", base: "#081713", baseL: "#eef8f2" },
  slate: { name: "灰玻璃", main: "#8fa0b8", alt: "#5b6b82", base: "#12161c", baseL: "#f3f4f8" },
};

let target = "main"; // 当前编辑目标：main / alt / base（纯 UI 态，不写 localStorage）

/* 底色有两个键（base / baseL），所有读写都必须过这一层：
   浅色模式下改的是 baseL，深色模式改 base。漏一处就会表现为"浅色下拖色轮不动/回弹"。 */
const tKey = (k = target) => (k === "base" && isLight() ? "baseL" : k);

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
  const hsv = hsvOverride || hexToHsv(s.c[tKey()]);
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
  // 预设缩略：主光 → 副光 → 底色（底色按当前模式取深/浅那一套）
  const bk = isLight() ? "baseL" : "base";
  panel.querySelectorAll(".cf-preset").forEach((el) => {
    const p = PRESETS[el.dataset.preset];
    if (!p) return;
    el.style.background = `linear-gradient(135deg, ${p.main} 0%, ${p.alt} 55%, ${p[bk]} 100%)`;
    // 高亮由三色比对推导，不存 preset 字段 —— 不会出现"高亮和实际颜色不一致"的脏状态。
    // 只比当前模式那套底色，否则切模式后高亮会整体掉光。
    const on = p.main === s.c.main && p.alt === s.c.alt && p[bk] === s.c[bk];
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
    if (sw) sw.style.background = s.c[tKey(k)];
  });

  drawWheel(hsvOverride);

  // 读数：正在编辑的输入框不回写，否则打字被打断
  const hex = s.c[tKey()];
  if (!skipHex && document.activeElement !== hexInput) hexInput.value = hex;
  const [r, g, b] = hexToRgb(hex);
  const cur = { r, g, b };
  Object.keys(rgbInputs).forEach((k) => {
    if (document.activeElement !== rgbInputs[k]) rgbInputs[k].value = cur[k];
  });
};

/* 提交一个颜色（唯一写入口：s.c[tKey()] = hex） */
const commitHex = (hex) => {
  if (hex === s.c[tKey()]) return;
  s.c[tKey()] = hex;
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
    const cur = hexToHsv(s.c[tKey()]);
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
    if (hex === s.c[tKey()]) {
      drawWheel({ h, s: sat, v }); // 舍入没变也保持 knob 跟手
      return;
    }
    s.c[tKey()] = hex;
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
    // 两套底色一起写：只写当前模式那套，切回去就会掉出预设态
    s.c = { main: p.main, alt: p.alt, base: p.base, baseL: p.baseL };
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
    s.c[tKey()] = v.toLowerCase();
    applyColors();
    renderColorUI(null, true); // 不回写正在输入的 hex 框
    scheduleSave();
  });
  hexInput.addEventListener("blur", () => {
    hexInput.value = s.c[tKey()];
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

}

/* 快捷键：G = 隐藏/显示面板（不切皮肤），L = 主题三态循环。
   单独守卫而不并进上面的大绑定块：窗口级监听在页内重复注入时只能有一份
   （两份的话按一次 G 会连翻两次，等于没反应），而 __cfPanelBound 早已被上一版
   实例置位，大绑定块不会再跑 —— 快捷键就会一直停在旧版本的行为上。 */
if (!window.__cfKeysBound) {
  window.__cfKeysBound = true;
  window.addEventListener(
    "keydown",
    (e) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      const k = e.key.toLowerCase();
      if (k === "g") {
        e.preventDefault();
        s.hidden = !s.hidden;
        apply();
        save();
      } else if (k === "l") {
        e.preventDefault();
        s.mode = MODE_NEXT[s.mode] || "auto";
        apply();
        save();
      }
    },
    true
  );
}

/* 输入框滑块 + 问号提示：单独守卫（可能本次才补进老面板），
   不能依赖上面 __cfPanelBound 的主绑定块再跑一遍。 */
const bindOnce = (el, fn) => {
  if (!el || el.dataset.cfBound) return;
  el.dataset.cfBound = "1";
  fn();
};

bindOnce(cInput, () => {
  cInput.addEventListener("input", () => {
    s.ct = clamp(Math.round(+cInput.value), 0, 30);
    apply();
    scheduleSave();
  });
});

/* 问号提示：hover / 键盘聚焦 / 点一下都能看。
   绝对定位盖在下方内容之上（往左或往上都会被面板的 overflow 裁掉）。 */
(() => {
  const tip = panel.querySelector(".cf-tip");
  if (!helpBtn || !tip) return;
  const show = () => {
    tip.classList.add("is-on");
    helpBtn.setAttribute("aria-expanded", "true");
  };
  const hide = () => {
    tip.classList.remove("is-on");
    helpBtn.setAttribute("aria-expanded", "false");
  };
  bindOnce(helpBtn, () => {
    helpBtn.setAttribute("aria-expanded", "false");
    helpBtn.addEventListener("pointerenter", show);
    helpBtn.addEventListener("pointerleave", hide);
    helpBtn.addEventListener("focus", show);
    helpBtn.addEventListener("blur", hide);
    // 不做 click 切换：点击会顺带触发 focus（已显示），再切换一次会让提示在指针还悬停时消失。
    // 触屏靠 focus / 失焦即可显示与收起。
    helpBtn.addEventListener("click", (e) => e.preventDefault());
  });
})();

/* 重置配色：单独守卫，因为按钮可能是本次才补进老面板的，
   不能依赖上面 __cfPanelBound 的主绑定块再跑一遍。 */
(() => {
  const btn = panel.querySelector(".cf-reset");
  if (!btn || btn.dataset.cfBound) return;
  btn.dataset.cfBound = "1";
  btn.addEventListener("click", () => {
    s.c = { main: COLORS.main, alt: COLORS.alt, base: COLORS.base, baseL: COLORS.baseL };
    applyColors(); // 三色回到默认 ⇒ removeProperty，与未改过完全一致
    renderColorUI();
    save(); // 立即落盘，不等防抖
  });
})();

/* 主题按钮：同样单独守卫 —— 老面板的按钮是本次才补进去的，
   __cfPanelBound 早已置位，主绑定块不会再跑一遍。 */
bindOnce(themeBtn, () => {
  themeBtn.addEventListener("click", () => {
    s.mode = MODE_NEXT[s.mode] || "auto";
    apply();
    save(); // 立即落盘：主题是最容易被"下次启动又变回去"投诉的开关
    const label = { auto: "跟随系统", light: "浅色", dark: "深色" }[s.mode];
    toastMsg(`主题：${label} · Ctrl+Shift+L 切换`);
  });
});

/* ---------- 6. 跟随 SPA 重渲染 ---------- */
let tagTimer = null;
let lastTagAt = 0;
const scheduleTag = () => {
  // 流式输出时 DOM 一直在变，防抖计时器会被无限重置，tag 永远等不到执行；
  // 而 SPA 重渲染会换掉输入框节点，打标跟着丢。超过 3s 没打标就立刻补一次。
  if (performance.now() - lastTagAt > 3000) {
    clearTimeout(tagTimer);
    lastTagAt = performance.now();
    tag();
    return;
  }
  clearTimeout(tagTimer);
  tagTimer = setTimeout(() => {
    lastTagAt = performance.now();
    tag();
  }, 220);
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

/* 每次注入（= 每次双击入口、每次以皮肤模式打开）都强制提示 5 秒。
   旧版只在「面板隐藏」时提示，用户一旦把面板调出来过（hidden=false），
   以后每次启动就静悄悄地什么都不显示 —— 快捷键反而更容易忘。 */
toastMsg(
  s.hidden
    ? "调节面板已隐藏 · Ctrl + Shift + G 调出 · Ctrl + Shift + L 主题"
    : "Ctrl + Shift + G 隐藏调节面板 · Ctrl + Shift + L 主题"
);

document.documentElement.dataset.cfSkin = CF_VER;
return {
  version: CF_VER,
  mode: s.mode,
  light: isLight(),
  alpha: getComputedStyle(document.documentElement).getPropertyValue("--cf-alpha").trim(),
  composer: !!document.querySelector("[data-cf-composer]"),
  sidebar: !!document.querySelector("[data-cf-sidebar]"),
  surfaceToken: getComputedStyle(document.documentElement)
    .getPropertyValue("--color-token-main-surface-primary")
    .trim(),
};

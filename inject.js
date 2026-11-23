/* ============================================================
   inject.js —— 把磨砂玻璃皮肤注入 Codex 桌面端
   用法:
     node inject.js              启动(如未运行) + 注入 + 持续守护(自动重注入)
     node inject.js --once       只注入一次后退出
     node inject.js --watch      不启动应用，只守护已运行的实例
     node inject.js --restart    强制重启 Codex
     node inject.js --autostart  开机自启用：仅当 Codex 刚启动(120s内)且缺调试端口时
                                 才自动接管重启，避免打断正在用的会话
   ============================================================ */
const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFileSync, spawn } = require("child_process");

const PORT = Number(process.env.CDP_PORT || 9335);
const APP = path.join(
  process.env.LOCALAPPDATA || "C:\\Users\\Default\\AppData\\Local",
  "Microsoft\\WindowsApps\\chatgpt-desktop.exe"
);
const CSS = fs.readFileSync(path.join(__dirname, "skin.css"), "utf8");
const PAYLOAD = fs.readFileSync(path.join(__dirname, "payload.js"), "utf8");
const VER = (PAYLOAD.match(/CF_VER\s*=\s*"([^"]+)"/) || [])[1] || "0";

const argv = process.argv.slice(2);
const ONCE = argv.includes("--once");
const NO_START = argv.includes("--watch");
const RESTART = argv.includes("--restart");
const AUTOSTART = argv.includes("--autostart");
const OPEN = argv.includes("--open"); // 双击入口：确保 Codex 以皮肤模式打开 + 注入一次，然后退出
const YES = argv.includes("--yes"); // 免交互确认（自动化用）
const PROBE = argv.includes("--probe"); // 只探测状态、不做任何改动（给 exe 启动器判断要不要弹窗）
const GRACE_SEC = Number(process.env.CF_GRACE_SEC || 120);

/* --probe 的退出码约定（launcher 依赖这三个值）：
     0 = 调试端口可用（已有带皮肤的实例）
     3 = Codex 在运行，但没带调试端口（需要用户同意才能重启）
     4 = Codex 没在运行（可以直接启动） */
const PROBE_PORT_OK = 0;
const PROBE_RUNNING_NO_PORT = 3;
const PROBE_NOT_RUNNING = 4;

const log = (...a) => console.log(`[${new Date().toLocaleTimeString("zh-CN")}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- 单实例锁：避免开机自启和手动启动各跑一个守护 ---------- */
const LOCK = path.join(__dirname, ".daemon.pid");
function acquireLock() {
  try {
    const pid = Number(String(fs.readFileSync(LOCK, "utf8")).trim());
    if (pid && pid !== process.pid) {
      try {
        process.kill(pid, 0);
        return false; // 已有守护在跑
      } catch {}
    }
  } catch {}
  try {
    fs.writeFileSync(LOCK, String(process.pid));
  } catch {}
  return true;
}
function releaseLock() {
  try {
    if (Number(String(fs.readFileSync(LOCK, "utf8")).trim()) === process.pid) fs.unlinkSync(LOCK);
  } catch {}
}

/* ---------- CDP HTTP ---------- */
function listTargets() {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: "/json/list", timeout: 2500 }, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(d));
        } catch {
          resolve(null);
        }
      });
    });
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.on("error", () => resolve(null));
  });
}

const isAppPage = (t) =>
  t.type === "page" && t.webSocketDebuggerUrl && /index\.html|codex/i.test(t.url || "");

/* ---------- 应用启动 ---------- */
function appProcesses() {
  try {
    const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq ChatGPT.exe", "/NH"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return (out.match(/ChatGPT\.exe/gi) || []).length;
  } catch {
    return 0;
  }
}

async function startApp() {
  // 注意：WindowsApps 下的执行别名是特殊符号链接，existsSync 会误判为不存在
  let ok = false;
  try {
    fs.lstatSync(APP);
    ok = true;
  } catch {
    ok = false;
  }
  if (!ok) {
    log("✗ 找不到 Codex 启动器：", APP);
    return false;
  }
  log("→ 正在启动 Codex（带调试端口 " + PORT + "）…");
  const child = spawn(APP, [`--remote-debugging-port=${PORT}`], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return true;
}

async function restartApp() {
  log("→ 正在关闭 Codex…");
  try {
    execFileSync("taskkill", ["/IM", "ChatGPT.exe", "/F"], { windowsHide: true, stdio: "ignore" });
  } catch {}
  // 等进程真正退干净，否则 MSIX 单实例可能让新实例只做「聚焦旧窗口」
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    if (appProcesses() === 0) break;
  }
  await sleep(800);
  log("→ 已关闭，重新以皮肤模式启动…");
  return startApp();
}

/* 等待「应用页面」出现（比只等端口更准，避免注入到空白页） */
async function waitForAppPage(sec) {
  for (let i = 0; i < sec; i++) {
    await sleep(700);
    const list = await listTargets();
    if (list && list.some(isAppPage)) return list;
  }
  return null;
}

/* 控制台提问（双击场景下 stdin 是真实控制台） */
function ask(q) {
  if (YES) return Promise.resolve("y");
  return new Promise((res) => {
    process.stdout.write(q);
    if (!process.stdin.isTTY) {
      // 非交互环境不阻塞，默认继续
      process.stdout.write("\n");
      return res("y");
    }
    const onData = (d) => {
      process.stdin.pause();
      process.stdin.removeListener("data", onData);
      res(String(d).trim());
    };
    process.stdin.resume();
    process.stdin.once("data", onData);
  });
}

/* Codex 已运行多久（秒）；拿不到返回 null */
function appUptimeSec() {
  try {
    const out = execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(Get-Process -Name ChatGPT -ErrorAction SilentlyContinue | Sort-Object StartTime | Select-Object -First 1).StartTime.ToString('o')",
      ],
      { encoding: "utf8", windowsHide: true, timeout: 10000 }
    ).trim();
    if (!out) return null;
    const t = new Date(out).getTime();
    return Number.isNaN(t) ? null : (Date.now() - t) / 1000;
  } catch {
    return null;
  }
}

async function waitForTargets(sec) {
  for (let i = 0; i < sec; i++) {
    await sleep(1000);
    const t = await listTargets();
    if (t) return t;
  }
  return null;
}

/* ---------- 注入 ---------- */
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: res, reject: rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      } else if (msg.method) {
        listeners.forEach((fn) => fn(msg));
      }
    });
    ws.addEventListener("open", () =>
      resolve({
        ws,
        on: (fn) => listeners.push(fn),
        send: (method, params = {}) =>
          new Promise((res, rej) => {
            const mid = ++id;
            pending.set(mid, { resolve: res, reject: rej });
            ws.send(JSON.stringify({ id: mid, method, params }));
            setTimeout(() => {
              if (pending.has(mid)) { pending.delete(mid); rej(new Error(method + " 超时")); }
            }, 20000);
          }),
      })
    );
    ws.addEventListener("error", () => reject(new Error("WebSocket 连接失败")));
  });
}

async function injectTarget(t) {
  const c = await connect(t.webSocketDebuggerUrl);
  const expr = `(() => {\nconst CSS = ${JSON.stringify(CSS)};\n${PAYLOAD}\n})()`;
  const r = await c.send("Runtime.evaluate", {
    expression: expr,
    returnByValue: true,
    awaitPromise: true,
    userGesture: true,
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  }
  return { value: r.result.value, conn: c };
}

/* ---------- 主流程 ---------- */
(async () => {
  if (PROBE) {
    const t = await listTargets();
    if (t) process.exit(PROBE_PORT_OK);
    process.exit(appProcesses() > 0 ? PROBE_RUNNING_NO_PORT : PROBE_NOT_RUNNING);
  }

  if (!ONCE && !OPEN && !acquireLock()) {
    log("已有守护进程在运行，本实例直接退出（不会重复注入）。");
    process.exit(0);
  }
  process.on("exit", releaseLock);
  process.on("SIGINT", () => { releaseLock(); process.exit(0); });

  log(`磨砂玻璃皮肤 v${VER} · 目标端口 ${PORT}`);

  let targets = await listTargets();

  if (RESTART) {
    await restartApp();
    targets = await waitForTargets(90);
  }

  /* 双击入口：保证「一个带皮肤的 Codex 窗口」出现，然后退出 */
  if (!targets && OPEN) {
    if (appProcesses() > 0) {
      const up = appUptimeSec();
      const mins = up === null ? "若干" : Math.round(up / 60) + " 分钟";
      const ans = await ask(`\n  Codex 正在运行（无皮肤模式，已运行 ${mins}）。\n  要重启它并加载皮肤吗？[Y/n] `);
      if (/^n/i.test(ans)) {
        log("已取消，没有做任何改动。");
        process.exit(0);
      }
      await restartApp();
    } else {
      log("→ Codex 没在运行，以皮肤模式启动…");
      await startApp();
    }
    log("→ 等待界面加载（首次启动约 15-30 秒）…");
    targets = await waitForAppPage(90);
    if (!targets) {
      log("✗ Codex 没能以皮肤模式启动（调试端口无响应）。");
      log("  可能的残留进程：任务管理器结束所有 ChatGPT.exe 后重试。");
      process.exit(1);
    }
  }

  if (!targets && !NO_START) {
    const procs = appProcesses();
    if (procs > 0) {
      const up = appUptimeSec();
      const fresh = up !== null && up <= GRACE_SEC;
      if (AUTOSTART && fresh) {
        log(`⚠ Codex 已启动但没带调试端口（运行了 ${Math.round(up)} 秒，仍在宽限期内），自动接管…`);
        await restartApp();
        targets = await waitForTargets(90);
      } else if (AUTOSTART) {
        log("⚠ Codex 已在运行但没带调试端口，且已运行较久；这次不动你的会话，等它下次退出后自动接管。");
        targets = null;
      } else {
        log("⚠ Codex 正在运行，但没有开启调试端口。");
        log("  请完全退出 Codex（右键托盘图标 → 退出）后重新运行本脚本；");
        log("  或执行：node inject.js --restart（会自动关闭并重启）");
        process.exit(2);
      }
    } else if (AUTOSTART && process.env.CF_LAUNCH_ON_LOGON !== "1") {
      // 不替用户启动 Codex：开机多出 20 多个进程太重，尊重"想用才开"
      log("→ Codex 还没打开。我不替你启动，你打开时我会自动接管。");
      targets = null;
    } else {
      await startApp();
      targets = await waitForTargets(90);
    }
  }

  if (!targets && !AUTOSTART) {
    log("✗ 无法连接到 Codex 调试端口，皮肤未注入。");
    process.exit(1);
  }
  if (!targets) log("→ 等待 Codex 启动（从开始菜单打开也可以，我会自动接管）…");

  const sessions = new Map(); // targetId -> conn
  let injectedCount = 0;
  let restarts = 0;
  let warned = false;

  /* 进程探测要 spawn 外部命令（tasklist 约 36ms CPU / 次），所以只在必要时做 */
  const probe = () => {
    if (appProcesses() === 0) return { state: "no-app" };
    const up = appUptimeSec();
    return { state: "no-port", up, fresh: up !== null && up <= GRACE_SEC };
  };

  /* 发现「Codex 在跑但没带调试端口」→ 自动接管重启（带次数上限，避免死循环） */
  const recover = async (info) => {
    if (!AUTOSTART || info.state === "no-app") return;
    if (!info.fresh) {
      if (!warned) {
        log("⚠ Codex 没带调试端口且已运行较久，不打断你；等它退出后自动接管。");
        warned = true;
      }
      return;
    }
    if (restarts >= 3) {
      if (!warned) {
        log("⚠ 自动接管已尝试 3 次仍未成功，先停下。请手动双击「启动 Codex 磨砂玻璃」排查。");
        warned = true;
      }
      return;
    }
    restarts++;
    warned = false;
    log(`⚠ 检测到 Codex 未带调试端口启动（运行 ${Math.round(info.up ?? 0)} 秒），自动接管重启…（第 ${restarts} 次）`);
    await restartApp();
  };

  const tick = async () => {
    const list = await listTargets();
    if (!list) {
      const info = probe();
      await recover(info);
      return info.state;
    }
    for (const t of list.filter(isAppPage)) {
      if (sessions.has(t.id)) continue;
      try {
        const { value, conn } = await injectTarget(t);
        sessions.set(t.id, conn);
        injectedCount++;
        restarts = 0;
        warned = false;
        conn.ws.addEventListener("close", () => sessions.delete(t.id));
        conn.on(async (msg) => {
          // 页面刷新后自动重注入
          if (msg.method === "Page.loadEventFired") {
            try {
              await injectTarget(t);
            } catch {}
          }
        });
        try { await conn.send("Page.enable"); } catch {}

        const v = value || {};
        if (v.skipped) {
          log(`- 跳过 ${t.title || "窗口"}（${v.skipped}，不需要皮肤）`);
          continue;
        }
        log(
          `✓ 已注入 ${t.title || "Codex"}` +
            ` · 透明 ${v.alpha || "-"}` +
            ` · 输入框${v.composer ? "✓" : "×"} 侧栏${v.sidebar ? "✓" : "×"}`
        );
        if (!v.surfaceToken || v.surfaceToken === "#011627" || v.surfaceToken === "rgb(1, 22, 39)") {
          log("⚠ 表面令牌似乎未生效，玻璃可能不透明（可在面板里调低透明度再看）");
        }
      } catch (e) {
        log("× 注入失败：", e.message);
      }
    }
    return "attached";
  };

  await tick();

  if (ONCE || OPEN) {
    if (OPEN) {
      log("✓ 完成，皮肤已生效。这个窗口可以直接关掉（不需要任何后台进程常驻）。");
      log("  提醒：在 Codex 里刷新页面或重开应用后皮肤会消失，再双击一次入口即可。");
    } else {
      log("已注入完成（--once 模式，不守护）。");
    }
    process.exit(0);
  }

  /* ---------- 分级轮询：按状态决定间隔，空闲时几乎不干活 ---------- */
  const DELAY = { attached: 5000, "no-port": 2000, "no-app": 15000 };
  let timer = null;
  let busy = false;
  let wakeFlag = false;
  let stopping = false;
  let lastRun = 0;

  const schedule = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(loop, ms);
  };

  const loop = async () => {
    if (busy) {
      wakeFlag = true;
      return;
    }
    busy = true;
    lastRun = Date.now();
    let state = "no-app";
    try {
      state = (await tick()) || "no-app";
    } catch {}
    busy = false;
    if (stopping) return;
    if (wakeFlag) {
      wakeFlag = false;
      schedule(200);
      return;
    }
    schedule(DELAY[state] ?? 5000);
  };

  /* 文件监视当"门铃"：Codex 启动会写日志，事件驱动比轮询便宜得多 */
  const poke = () => {
    if (busy) {
      wakeFlag = true;
      return;
    }
    if (Date.now() - lastRun < 1500) return; // 防止日志高频写入引发抖动
    schedule(200);
  };

  const watchers = [];
  const logDir = path.join(process.env.LOCALAPPDATA || "", "Codex", "Logs");
  try {
    if (fs.existsSync(logDir)) {
      const w = fs.watch(logDir, { recursive: true }, () => poke());
      w.on("error", () => {});
      watchers.push(w);
    }
  } catch {}

  const shutdown = () => {
    stopping = true;
    clearTimeout(timer);
    watchers.forEach((w) => { try { w.close(); } catch {} });
    releaseLock();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  log("守护中：Codex 重启或页面刷新会自动重新注入。按 Ctrl+C 退出。");
  log(`轮询策略：已连接 5s · 待接管 2s · Codex 未运行 15s（由日志事件唤醒）`);
  schedule(3000);
})();

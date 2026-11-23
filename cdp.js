// 极简 CDP 客户端：连接 Codex 渲染进程并求值 / 注入样式
// 用法: node cdp.js eval "<js表达式>"      -> 打印 JSON 结果
//       node cdp.js file <path.js>         -> 执行本地脚本文件内容并返回结果
const fs = require("fs");
const http = require("http");

const PORT = process.env.CDP_PORT || 9335;

function getTargets() {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port: PORT, path: "/json/list", timeout: 5000 }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on("timeout", () => req.destroy(new Error("CDP timeout")));
    req.on("error", reject);
  });
}

async function connect() {
  const targets = await getTargets();
  const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  // 优先主窗口（app://-/index.html），避免连到头像浮层等附属窗口
  const page = pages.find((t) => /index\.html$/.test(t.url || "")) || pages[0];
  if (!page) throw new Error("找不到页面目标");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params }));
      setTimeout(() => {
        if (pending.has(mid)) { pending.delete(mid); reject(new Error(method + " 超时")); }
      }, 20000);
    });
  return { ws, send, page };
}

async function evaluate(expression, awaitPromise = true) {
  const { ws, send } = await connect();
  try {
    const r = await send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    });
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    }
    return r.result.value;
  } finally {
    ws.close();
  }
}

if (require.main === module) {
  (async () => {
    const [mode, arg] = process.argv.slice(2);
    try {
      let expr = arg;
      if (mode === "file") expr = fs.readFileSync(arg, "utf8");
      const out = await evaluate(expr);
      console.log(typeof out === "string" ? out : JSON.stringify(out, null, 2));
    } catch (e) {
      console.error("ERR:", e.message);
      process.exit(1);
    }
  })();
}

module.exports = { connect, evaluate };

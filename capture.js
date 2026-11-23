// 通过 CDP 直接抓渲染进程画面（不受窗口遮挡影响）
const fs = require("fs");
const { connect } = require("./cdp.js");

(async () => {
  const out = process.argv[2] || "capture.png";
  const { ws, send } = await connect();
  try {
    await send("Page.enable");
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(out, Buffer.from(r.data, "base64"));
    console.log("saved " + out);
  } finally {
    ws.close();
  }
})();

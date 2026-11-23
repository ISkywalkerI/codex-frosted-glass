# -*- coding: utf-8 -*-
"""Codex-skinned.exe —— 双击入口（由 PyInstaller 打包，源码见本文件）。

它做的事和 Codex-skinned.cmd 完全一样：找到同目录的 inject.js 和 node，
用 `--open` 跑一次注入，然后退出。差别有三点：

  1. 没有控制台窗口；
  2. Codex 正在运行但没开调试端口时，用对话框问一句再决定要不要重启
     （inject.js 在非交互环境里会默认继续，双击场景下太危险）；
  3. 输出写进 %LOCALAPPDATA%\\CodexSkinned\\launcher.log，失败时把日志尾部
     直接显示在对话框里。

参数原样透传给 inject.js，例如：
    Codex-skinned.exe --restart
    Codex-skinned.exe --once
"""

import ctypes
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

TITLE = "Codex 磨砂玻璃"
MB_OK = 0x0
MB_ICONERROR = 0x10
MB_ICONWARNING = 0x30
MB_YESNO = 0x4
IDYES = 6
CREATE_NO_WINDOW = 0x08000000

# 与 inject.js 的 --probe 约定一致
PROBE_PORT_OK = 0
PROBE_RUNNING_NO_PORT = 3
PROBE_NOT_RUNNING = 4


def say(text, flags=MB_ICONERROR | MB_OK):
    ctypes.windll.user32.MessageBoxW(None, str(text), TITLE, flags)


def home():
    """exe 所在目录（PyInstaller onefile 下 sys.executable 才是真身，_MEIPASS 是临时解包目录）。"""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def find_script():
    here = home()
    candidates = [here]
    env = os.environ.get("CF_HOME", "").strip()
    if env:
        candidates.append(Path(env))
    for folder in candidates:
        p = folder / "inject.js"
        if p.is_file():
            return p
    return None


def find_node():
    env = os.environ.get("CF_NODE", "").strip()
    if env and Path(env).is_file():
        return env

    found = shutil.which("node")
    if found:
        return found

    local = os.environ.get("LOCALAPPDATA", "")
    appdata = os.environ.get("APPDATA", "")
    program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
    for cand in (
        Path(program_files) / "nodejs" / "node.exe",
        Path(local) / "Programs" / "nodejs" / "node.exe",
        Path(appdata) / "npm" / "node.exe",
    ):
        if cand.is_file():
            return str(cand)
    return None


def log_path():
    base = os.environ.get("LOCALAPPDATA") or os.environ.get("TEMP") or "."
    folder = Path(base) / "CodexSkinned"
    try:
        folder.mkdir(parents=True, exist_ok=True)
    except OSError:
        folder = Path(os.environ.get("TEMP", "."))
    return folder / "launcher.log"


def read_tail(path, limit=1500):
    try:
        text = Path(path).read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return ""
    return text[-limit:] if len(text) > limit else text


def note(message):
    """早期失败也要留痕：万一对话框没弹出来（非交互会话、远程桌面等），日志里有据可查。"""
    try:
        with open(log_path(), "a", encoding="utf-8", errors="replace") as f:
            f.write("[%s] [launcher] %s\n" % (time.strftime("%Y-%m-%d %H:%M:%S"), message))
    except OSError:
        pass


def run_node(node, script, args, log):
    """跑一次 inject.js，stdout/stderr 全部进日志文件；不弹任何控制台窗口。"""
    header = "[%s] node %s\n\n" % (
        time.strftime("%Y-%m-%d %H:%M:%S"),
        " ".join([str(script.name)] + list(args)),
    )
    try:
        handle = open(log, "w", encoding="utf-8", errors="replace")
    except OSError:
        handle = None
    try:
        if handle:
            handle.write(header)
            handle.flush()
        proc = subprocess.run(
            [node, str(script)] + list(args),
            cwd=str(script.parent),
            stdin=subprocess.DEVNULL,
            stdout=handle if handle else subprocess.DEVNULL,
            stderr=subprocess.STDOUT if handle else subprocess.DEVNULL,
            creationflags=CREATE_NO_WINDOW,
        )
        return proc.returncode
    except OSError as exc:
        if handle:
            handle.write("\n[launcher] 启动 node 失败：%s\n" % exc)
        return -1
    finally:
        if handle:
            handle.close()


def probe(node, script):
    try:
        proc = subprocess.run(
            [node, str(script), "--probe"],
            cwd=str(script.parent),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=CREATE_NO_WINDOW,
        )
        return proc.returncode
    except OSError:
        return -1


def main():
    script = find_script()
    if not script:
        note("找不到 inject.js（当前目录 %s）" % home())
        say(
            "找不到 inject.js。\n\n"
            "本程序要和 inject.js、payload.js、skin.css 放在同一个文件夹里。\n"
            "当前目录：\n%s" % home()
        )
        return 1

    node = find_node()
    if not node:
        note("找不到 node.exe（PATH / CF_NODE / 常见安装位置都没有）")
        say(
            "找不到 Node.js。\n\n"
            "皮肤是 node 运行的脚本，请先安装 Node 18 或更高版本：\n"
            "https://nodejs.org\n\n"
            "装好后重新双击本程序即可。（也可以把环境变量 CF_NODE 指向 node.exe）"
        )
        return 1

    log = log_path()
    args = sys.argv[1:]
    if not args:
        args = ["--open"]

    # 只在「双击入口」语义下预判：Codex 在跑但没开调试端口时 inject.js 会重启它，
    # 这里先问一句，避免把用户正在输入的内容弄丢。
    wants_open = args[0] == "--open" and "--yes" not in args
    if wants_open and probe(node, script) == PROBE_RUNNING_NO_PORT:
        answer = ctypes.windll.user32.MessageBoxW(
            None,
            "Codex 正在运行，但没有开启调试端口，皮肤加载不进去。\n\n"
            "要关闭并重启 Codex 来加载皮肤吗？\n"
            "（对话框里还没发送的内容会丢失）",
            TITLE,
            MB_ICONWARNING | MB_YESNO,
        )
        if answer != IDYES:
            note("Codex 在运行但没开调试端口；用户选择不重启，已取消。")
            return 0
        args = args + ["--yes"]

    rc = run_node(node, script, args, log)
    if rc == 0:
        return 0

    detail = read_tail(log) or "（日志为空）"
    say(
        "皮肤没有加载成功（退出码 %d）。\n\n%s\n\n完整日志：\n%s"
        % (rc, detail, log)
    )
    return rc if rc > 0 else 1


if __name__ == "__main__":
    sys.exit(main())

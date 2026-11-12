# -*- coding: utf-8 -*-
"""生成「零配置版」直推客户端：把本机令牌预置进一份 HTML

产出：D:/加油站综合考核系统/直推客户端_已配置.html
该文件含明文令牌，已被 .gitignore 排除，只能点对点发给可信同事，
禁止发公开群、禁止放进公开仓库或公开共享盘。
"""
import io
import os
import shutil

ROOT = r"D:/加油站综合考核系统"
SRC = os.path.join(ROOT, "docs", "direct.html")
TOKEN_FILE = os.path.join(ROOT, ".gh_token.txt")
OUT = os.path.join(ROOT, "直推客户端_已配置.html")


def main():
    if not os.path.isfile(SRC):
        raise SystemExit("找不到源页面：" + SRC)
    if not os.path.isfile(TOKEN_FILE):
        raise SystemExit("找不到令牌文件：" + TOKEN_FILE)

    tok = open(TOKEN_FILE, encoding="utf-8").read().strip()
    if not tok:
        raise SystemExit("令牌文件为空")

    s = io.open(SRC, encoding="utf-8").read()
    marker = "var PRESET_TOKEN='';"
    if marker not in s:
        raise SystemExit("源页面缺少 PRESET_TOKEN 占位")
    s = s.replace(marker, "var PRESET_TOKEN='" + tok + "';", 1)

    io.open(OUT, "w", encoding="utf-8", newline="\r\n").write(s)

    # 同目录再放一个便于双击的启动器（同名，不含令牌）
    bat = os.path.join(ROOT, "打开零配置客户端.bat")
    io.open(bat, "w", encoding="gbk", newline="\r\n").write(
        '@echo off\ncd /d "%~dp0"\nstart "" "直推客户端_已配置.html"\n')

    print("已生成：" + OUT)
    print("启动器：" + bat)
    print("")
    print("  [!] 该文件内含明文访问令牌，只可点对点发给可信人员。")
    print("  [!] 已被 .gitignore 排除，不会进入公开仓库。")
    print("  [!] 令牌更换或吊销后，重新运行本脚本生成新文件并回收旧文件。")


if __name__ == "__main__":
    main()

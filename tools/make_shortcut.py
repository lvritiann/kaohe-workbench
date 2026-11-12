# -*- coding: utf-8 -*-
"""在桌面创建「考核状态直推」快捷方式（纯文本 .url，无需管理员权限 / COM）"""
import os
import sys
from urllib.parse import quote

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML = os.path.join(ROOT, "直推客户端_已配置.html")

if not os.path.isfile(HTML):
    print("[FAIL] 找不到已配置客户端，请先运行「生成零配置客户端.bat」")
    sys.exit(1)

desktop = os.path.join(os.path.expanduser("~"), "Desktop")
if not os.path.isdir(desktop):
    desktop = r"C:/Users/DELL/Desktop"

url = "file:///" + quote(HTML.replace("\\", "/"), safe="/:")
target = os.path.join(desktop, "考核状态直推.url")
with open(target, "w", encoding="ascii", newline="\r\n") as f:
    f.write("[InternetShortcut]\nURL=" + url + "\nIconIndex=0\n")
print("[OK] 桌面快捷方式已创建：考核状态直推")
print("     以后双击桌面图标即可，不用找文件。")
print("     指向：" + HTML)

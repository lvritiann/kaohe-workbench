# -*- coding: utf-8 -*-
"""本地管理台服务：让静态页面在本机/局域网点一下就能直推

两种启动方式：
  本地管理台.bat    → 绑定 127.0.0.1，仅本机能用
  局域网管理台.bat  → 绑定 0.0.0.0，局域网内其他电脑也能打开

推送始终在跑服务的这台机器上执行（git 与令牌只在本机），
其他电脑只是浏览器客户端，无需安装任何东西。
"""
import json
import os
import socket
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = r"D:/加油站综合考核系统"
sys.path.insert(0, os.path.join(ROOT, "tools"))
import status_push as sp

PORT = int(os.environ.get("CONSOLE_PORT", "8902"))
ADMIN_PASS = os.environ.get("CONSOLE_PASS", "KH-ADMIN-2027")
LAN = "--lan" in sys.argv or os.environ.get("CONSOLE_LAN", "") == "1"
BIND = "0.0.0.0" if LAN else "127.0.0.1"

CONSOLE = os.path.join(ROOT, "console", "index.html")
CSS = os.path.join(ROOT, "docs", "assets", "app.css")
ALLOW_IP = os.path.join(ROOT, "console", "allow_ip.txt")
LEDGER = sp.LEDGER


def lan_ips():
    """列出本机可能用于局域网访问的 IPv4（不发包）"""
    out = []
    try:
        out.append(socket.gethostbyname(socket.gethostname()))
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if ip not in out:
                out.append(ip)
    except Exception:
        pass
    return [ip for ip in out if is_private(ip)]


def is_private(ip):
    """只允许回环与 RFC1918 私有网段，挡住公网来源"""
    if ip in ("127.0.0.1", "::1"):
        return True
    p = ip.split(".")
    if len(p) != 4:
        return False
    try:
        a, b = int(p[0]), int(p[1])
    except Exception:
        return False
    if a == 10:
        return True
    if a == 192 and b == 168:
        return True
    if a == 172 and 16 <= b <= 31:
        return True
    if a == 169 and b == 254:
        return True
    return False


def allow_list():
    """allow_ip.txt 中每行一个 IP；文件不存在或只有注释＝不限制（仍限内网）"""
    if not os.path.isfile(ALLOW_IP):
        return set()
    out = set()
    with open(ALLOW_IP, encoding="utf-8-sig") as f:
        for line in f:
            s = line.strip()
            if s and not s.startswith("#"):
                out.add(s)
    return out


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print("  " + (fmt % args))

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False)
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _file(self, path, ctype):
        if not os.path.isfile(path):
            return self._send(404, {"ok": False, "message": "文件不存在"})
        with open(path, "rb") as f:
            self._send(200, f.read(), ctype)

    def do_GET(self):
        p = self.path.split("?")[0]
        if p == "/":
            self.send_response(302)
            self.send_header("Location", "/console/")
            self.end_headers()
            return
        if p in ("/console", "/console/", "/console/index.html"):
            return self._file(CONSOLE, "text/html; charset=utf-8")
        if p == "/docs/assets/app.css":
            return self._file(CSS, "text/css; charset=utf-8")
        if p == "/api/ledger":
            try:
                return self._send(200, sp.read_json(LEDGER))
            except Exception as e:
                return self._send(500, {"ok": False, "message": str(e)})
        if p == "/api/health":
            return self._send(200, {
                "ok": True, "port": PORT, "bind": BIND, "lan": LAN,
                "lanIps": lan_ips(), "allowCount": len(allow_list())
            })
        return self._send(404, {"ok": False, "message": "not found"})

    def do_POST(self):
        p = self.path.split("?")[0]
        if p != "/api/issue":
            return self._send(404, {"ok": False, "message": "not found"})

        src = self.client_address[0]
        if not is_private(src):
            return self._send(403, {"ok": False, "message": "拒绝非内网来源：" + src})
        allowed = allow_list()
        if allowed and src not in allowed:
            return self._send(403, {"ok": False, "message": "该 IP 不在白名单：" + src})

        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception as e:
            return self._send(400, {"ok": False, "message": "请求格式错：" + str(e)})

        if str(body.get("pass", "")).strip() != ADMIN_PASS:
            return self._send(403, {"ok": False, "message": "管理口令不正确"})

        rec = body.get("record") or {}
        dry = bool(body.get("dryRun"))
        if dry:
            errs = sp.validate_record(rec)
            return self._send(200, {
                "ok": not errs,
                "message": "校验通过（演练）" if not errs else "；".join(errs),
                "steps": [], "pushed": False
            })

        res = sp.apply_record(rec)
        return self._send(200 if res["ok"] else 400, res)


def main():
    os.chdir(ROOT)
    if not os.path.isfile(CONSOLE):
        print("[ERROR] 找不到本地管理台页面：" + CONSOLE)
        input("按回车退出…")
        return
    srv = ThreadingHTTPServer((BIND, PORT), Handler)
    ips = lan_ips()
    print("=" * 60)
    print("  加油站综合考核 · " + ("局域网管理台" if LAN else "本地管理台"))
    print("=" * 60)
    if LAN:
        print("  模式：局域网（0.0.0.0:%d）" % PORT)
        if ips:
            for ip in ips:
                print("  同事电脑打开 →  http://%s:%d/" % (ip, PORT))
        else:
            print("  未取到内网 IP，请在本机运行 ipconfig 查看 IPv4 地址")
        print("  首次启动若弹出防火墙提示，请勾选「专用网络」并允许")
    else:
        print("  模式：仅本机（127.0.0.1:%d）" % PORT)
        print("  需要同事一起用 → 改双击「局域网管理台.bat」")
    print("  管理口令：%s" % ADMIN_PASS)
    print("  IP 白名单：%s" % ("启用 %d 个" % len(allow_list()) if allow_list() else "未启用（限内网）"))
    print("  推送由本机执行，其他电脑无需装 Python / 放令牌")
    print("  关闭本窗口即停止服务")
    print("=" * 60)
    open_url = "http://127.0.0.1:%d/" % PORT
    threading.Timer(0.8, lambda: webbrowser.open(open_url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()

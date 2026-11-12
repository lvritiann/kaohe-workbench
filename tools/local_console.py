# -*- coding: utf-8 -*-
"""本地管理台服务：让静态页面在本机点一下就能直推

双击「本地管理台.bat」启动，浏览器自动打开 http://127.0.0.1:8902/
只监听 127.0.0.1，不对外网开放；关掉窗口即停止服务。
"""
import json
import os
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = r"D:/加油站综合考核系统"
sys.path.insert(0, os.path.join(ROOT, "tools"))
import status_push as sp

PORT = 8902
ADMIN_PASS = "KH-ADMIN-2027"

CONSOLE = os.path.join(ROOT, "console", "index.html")
CSS = os.path.join(ROOT, "docs", "assets", "app.css")
LEDGER = sp.LEDGER


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
            return self._send(200, {"ok": True, "port": PORT, "root": ROOT})
        return self._send(404, {"ok": False, "message": "not found"})

    def do_POST(self):
        p = self.path.split("?")[0]
        if p != "/api/issue":
            return self._send(404, {"ok": False, "message": "not found"})
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
    srv = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print("=" * 56)
    print("  加油站综合考核 · 本地管理台")
    print("=" * 56)
    print("  地址：http://127.0.0.1:%d/" % PORT)
    print("  仅本机可访问；关闭本窗口即停止服务")
    print("  管理口令：%s" % ADMIN_PASS)
    print("=" * 56)
    threading.Timer(0.8, lambda: webbrowser.open("http://127.0.0.1:%d/" % PORT)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")
    finally:
        srv.server_close()


if __name__ == "__main__":
    main()

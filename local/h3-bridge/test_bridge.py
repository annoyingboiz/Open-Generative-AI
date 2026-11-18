#!/usr/bin/env python3
"""Tests for h3_bridge.py with a fake previz module and a fake ComfyUI (no GPU, no stand).

    python3 local/h3-bridge/test_bridge.py
"""
import http.client
import http.server
import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent

FAKE_PREVIZ = r'''
import json, os, shutil, urllib.request
from pathlib import Path
COMFY = os.environ["FAKE_COMFY"]
QUEUE = Path(os.environ["FAKE_QUEUE"])
OUT = Path(os.environ["FAKE_OUT"])
RES = {"h3": {"480p": (864, 480), "576p": (1024, 576), "720p": (1248, 704), "768p": (1344, 768)},
       "wan": {"480p": (832, 480), "576p": (1024, 576), "720p": (1280, 720)}}
def http(method, path, data=None, timeout=60):
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(COMFY + path, data=body, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"{}")
def comfy_alive():
    try: http("GET", "/system_stats", timeout=2); return True
    except Exception: return False
def preflight(engine, force=False):
    f = Path(os.environ["FAKE_BUSY"])
    if f.exists(): raise SystemExit("PREFLIGHT STOP — " + f.read_text())
    return {}, []
def h3_frames(seconds): return 121
def graph_h3(prompt, w, h, length, seed, steps, refs, image, mode, turbo, prefix, *a, **k):
    return {"kind": "h3", "prompt": prompt, "w": w, "h": h, "steps": steps, "refs": refs, "image": image, "mode": mode, "prefix": prefix}
def graph_wan(prompt, w, h, length, seed, steps, image, turbo, prefix):
    return {"kind": "wan", "prompt": prompt, "steps": steps, "image": image, "prefix": prefix}
def comfy_free(): pass
def comfy_output_file(hist):
    return OUT / hist["outputs"]["18"]["videos"][0]["filename"]
def strip_audio(src, dst): shutil.copy2(src, dst)
def probe(p): return {"w": 1, "h": 1}
'''


class FakeComfy(http.server.BaseHTTPRequestHandler):
    prompts = {}
    graphs = []
    hold = threading.Event()   # set → prompts stay running
    interrupted = []

    def log_message(self, *a):
        pass

    def send(self, data):
        b = json.dumps(data).encode()
        self.send_response(200)
        self.send_header("content-length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        if self.path == "/system_stats":
            return self.send({"ok": True})
        if self.path == "/queue":
            running = [[0, pid, {}] for pid, p in self.prompts.items() if not p["done"]]
            return self.send({"queue_running": running, "queue_pending": []})
        if self.path.startswith("/history/"):
            pid = self.path.split("/")[-1]
            p = self.prompts.get(pid)
            if not p or (not p["done"] and (self.hold.is_set() or time.time() - p["t"] < 0.5)):
                return self.send({})
            p["done"] = True
            if p.get("error"):
                return self.send({pid: {"status": {"status_str": "error", "messages": [["execution_interrupted", {}]]}}})
            name = f"{pid}.mp4"
            (FakeComfy.out / name).write_bytes(b"\x00\x00\x00\x18ftypmp42fake")
            return self.send({pid: {"status": {"completed": True}, "outputs": {"18": {"videos": [{"filename": name}]}}}})
        self.send({})

    def do_POST(self):
        n = int(self.headers.get("content-length") or 0)
        body = json.loads(self.rfile.read(n) or b"{}")
        if self.path == "/prompt":
            pid = f"p{len(self.prompts) + 1}"
            self.prompts[pid] = {"t": time.time(), "done": False}
            self.graphs.append(body["prompt"])
            return self.send({"prompt_id": pid})
        if self.path == "/interrupt":
            self.interrupted.append(body.get("prompt_id"))
            p = self.prompts.get(body.get("prompt_id"))
            if p:
                p["error"] = True
                self.hold.clear()
            return self.send({})
        self.send({})


class UnixConn(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__("localhost", timeout=10)
        self.path_ = path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX)
        self.sock.settimeout(10)
        self.sock.connect(self.path_)


class BridgeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = Path(tempfile.mkdtemp(prefix="h3b-"))
        cls.out = cls.tmp / "comfy-out"; cls.out.mkdir()
        FakeComfy.out = cls.out
        cls.queue = cls.tmp / "queue"; (cls.queue / "running").mkdir(parents=True)
        cls.busy = cls.tmp / "busy"
        (cls.tmp / "previz.py").write_text(FAKE_PREVIZ)
        cls.comfy = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FakeComfy)
        threading.Thread(target=cls.comfy.serve_forever, daemon=True).start()
        cls.bridge_dir = cls.tmp / "bridge"
        env = {**os.environ, "PREVIZ_FILE": str(cls.tmp / "previz.py"), "BRIDGE_DIR": str(cls.bridge_dir),
               "QC_GPU_LOCK_FILE": str(cls.tmp / "qc_gpu.lock"), "FAKE_COMFY": f"http://127.0.0.1:{cls.comfy.server_port}",
               "FAKE_QUEUE": str(cls.queue), "FAKE_OUT": str(cls.out), "FAKE_BUSY": str(cls.busy),
               "BRIDGE_WAIT_POLL_S": "0.3", "BRIDGE_IDLE_POLL_S": "0.2", "NO_PROXY": "127.0.0.1,localhost", "no_proxy": "127.0.0.1,localhost"}
        cls.proc = subprocess.Popen([sys.executable, str(HERE / "h3_bridge.py")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        sock = cls.bridge_dir / "bridge.sock"
        for _ in range(100):
            if sock.exists():
                break
            time.sleep(0.05)
        cls.sock = str(sock)

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(5)
        cls.comfy.shutdown()

    def call(self, method, path, body=None):
        c = UnixConn(self.sock)
        c.request(method, path, body=json.dumps(body) if body is not None else None, headers={"content-type": "application/json"})
        r = c.getresponse()
        data = json.loads(r.read() or b"{}")
        c.close()
        return r.status, data

    def wait_state(self, jid, states, timeout=10):
        t0 = time.time()
        while time.time() - t0 < timeout:
            _, j = self.call("GET", f"/jobs/{jid}")
            if j.get("state") in states:
                return j
            time.sleep(0.1)
        self.fail(f"{jid} never reached {states}: {j}")

    def picture(self, name):
        (self.bridge_dir / "in").mkdir(parents=True, exist_ok=True)
        (self.bridge_dir / "in" / name).write_bytes(b"\x89PNG")
        return name

    def test_1_status_and_validation(self):
        code, s = self.call("GET", "/status")
        self.assertEqual(code, 200)
        self.assertTrue(s["comfy"])
        self.assertEqual(oct(os.stat(self.sock).st_mode & 0o777), "0o660")
        code, e = self.call("POST", "/jobs", {"id": "job_bad1", "engine": "h3", "prompt": "x", "image": "missing_file.png"})
        self.assertEqual(code, 400)
        self.assertIn("did not arrive", e["error"])
        code, e = self.call("POST", "/jobs", {"id": "../../x", "engine": "h3", "prompt": "x"})
        self.assertEqual(code, 400)
        code, e = self.call("POST", "/jobs", {"id": "job_bad2", "engine": "wan", "prompt": "x", "res": "768p"})
        self.assertIn("Resolution", e["error"])

    def test_2_waits_while_busy_then_runs(self):
        self.busy.write_text("Ollama держит модель в памяти: qwen3.6:27b | GPU0: свободно 100 МБ, нужно 21000")
        img = self.picture("frame_aaaaaa.png")
        code, j = self.call("POST", "/jobs", {"id": "job_i2v_1", "engine": "h3", "prompt": "She turns.", "image": img, "res": "720p", "seconds": 5, "turbo": True})
        self.assertEqual(code, 200)
        j = self.wait_state("job_i2v_1", ["waiting"])
        self.assertIn("Ollama is holding a text model", j["reason"])
        self.assertIn("video cards are busy", j["reason"])
        self.assertEqual(j["position"], 1)
        self.busy.unlink()
        j = self.wait_state("job_i2v_1", ["done", "failed"])
        self.assertEqual(j["state"], "done", j)
        self.assertEqual(j["outputs"], ["clip.mp4"])
        self.assertTrue((self.bridge_dir / "jobs/job_i2v_1/clip.mp4").exists())
        g = FakeComfy.graphs[-1]
        self.assertEqual((g["mode"], g["steps"], g["w"]), ("i2v", 8, 1248))
        self.assertTrue(g["image"].endswith("frame_aaaaaa.png"))
        self.assertEqual(g["prefix"], "aivp/job_i2v_1/clip")
        # Sent twice: the same job, not a second one.
        code, again = self.call("POST", "/jobs", {"id": "job_i2v_1", "engine": "h3", "prompt": "She turns.", "image": img})
        self.assertEqual(again["state"], "done")

    def test_3_references_get_picture_tags(self):
        refs = [self.picture("ref_bbbbbb.png"), self.picture("ref_cccccc.png")]
        self.call("POST", "/jobs", {"id": "job_r2v_1", "engine": "h3", "prompt": "Two friends talk.", "refs": refs, "turbo": True})
        self.wait_state("job_r2v_1", ["done"])
        g = FakeComfy.graphs[-1]
        self.assertEqual(g["mode"], "r2v")
        self.assertEqual(g["steps"], 4)
        self.assertTrue(g["prompt"].startswith("<Picture 1> <Picture 2> are reference images."))

    def test_4_cancel_waiting_and_running(self):
        self.busy.write_text("RAM: доступно 3 ГБ, нужно 30")
        self.call("POST", "/jobs", {"id": "job_cancel_wait", "engine": "wan", "prompt": "Rain."})
        self.wait_state("job_cancel_wait", ["waiting"])
        code, j = self.call("POST", "/jobs/job_cancel_wait/cancel")
        self.assertEqual(j["state"], "cancelled")
        self.busy.unlink()
        FakeComfy.hold.set()
        self.call("POST", "/jobs", {"id": "job_cancel_run", "engine": "wan", "prompt": "Rain."})
        self.wait_state("job_cancel_run", ["running"])
        time.sleep(0.5)
        self.call("POST", "/jobs/job_cancel_run/cancel")
        j = self.wait_state("job_cancel_run", ["cancelled", "failed", "done"], timeout=15)
        self.assertEqual(j["state"], "cancelled", j)
        self.assertTrue(FakeComfy.interrupted)

    def test_5_qc_lock_makes_it_wait(self):
        import fcntl
        fd = os.open(self.tmp / "qc_gpu.lock", os.O_RDWR | os.O_CREAT)
        fcntl.flock(fd, fcntl.LOCK_EX)
        try:
            self.call("POST", "/jobs", {"id": "job_qc_wait", "engine": "wan", "prompt": "Rain."})
            j = self.wait_state("job_qc_wait", ["waiting"])
            self.assertIn("QC check", j["reason"])
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)
        self.wait_state("job_qc_wait", ["done"])


if __name__ == "__main__":
    unittest.main(verbosity=2)

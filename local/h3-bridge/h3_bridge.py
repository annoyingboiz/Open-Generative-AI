#!/usr/bin/env python3
"""h3-bridge — lets the AI Video Platform run MiniMax H3 and Wan 2.2 on this
server's own ComfyUI, one job at a time, through the stand's previz helpers.

  The app (gateway container) talks to it over a unix socket:
      BRIDGE_DIR/bridge.sock   — HTTP: GET /status, POST /jobs, GET /jobs/<id>, POST /jobs/<id>/cancel
  Input pictures arrive in BRIDGE_DIR/in/ (the app copies them there),
  results are written to BRIDGE_DIR/jobs/<id>/.

It never changes previz, ComfyUI, meetbot or Ollama. Before every run it asks
the same question previz asks (preflight: Ollama holding a model, RAM, meetbot
processing a meeting, GPU memory) plus: is ComfyUI busy with someone else's
prompt, is the previz queue running, does a QC check hold the GPU lock. If the
machine is busy the job waits (state "waiting" with the reason) and starts by
itself when it is free. While it runs it holds the stand's GPU lock
(locks/qc_gpu.lock), so QC checks wait for it as they wait for each other.

Standard library only. Run with the stand's ComfyUI venv (see run.sh).
"""
import contextlib
import fcntl
import http.server
import importlib.util
import io
import json
import os
import re
import shutil
import signal
import socket
import socketserver
import sys
import threading
import time
import traceback
import urllib.error
import uuid
from pathlib import Path

STAND = Path(os.environ.get("STAND", "/mnt/ml-data/stand"))
PREVIZ_FILE = Path(os.environ.get("PREVIZ_FILE", STAND / "previz/previz.py"))
BRIDGE_DIR = Path(os.environ.get("BRIDGE_DIR", "/mnt/ml-data/ai-video-platform/h3-bridge"))
GPU_LOCK = Path(os.environ.get("QC_GPU_LOCK_FILE", STAND / "locks/qc_gpu.lock"))
SOCKET = BRIDGE_DIR / "bridge.sock"
JOBS = BRIDGE_DIR / "jobs"
INBOX = BRIDGE_DIR / "in"
WAIT_POLL_S = float(os.environ.get("BRIDGE_WAIT_POLL_S", "60"))
IDLE_POLL_S = float(os.environ.get("BRIDGE_IDLE_POLL_S", "3"))
MAX_WAIT_S = float(os.environ.get("BRIDGE_MAX_WAIT_S", str(24 * 3600)))
KEEP_JOBS_S = 3 * 86400
KEEP_INBOX_S = 2 * 86400
RUN_TIMEOUT_S = 3 * 3600
JOB_ID = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
IN_NAME = re.compile(r"^[A-Za-z0-9_-]{6,80}\.(png|jpe?g|webp)$")
ENGINES = {"h3", "wan"}
RES = {"h3": ["480p", "576p", "720p", "768p"], "wan": ["480p", "576p", "720p"]}


def log(msg):
    print(time.strftime("%Y-%m-%d %H:%M:%S"), msg, flush=True)


def load_previz():
    spec = importlib.util.spec_from_file_location("previz", PREVIZ_FILE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


PV = None  # the previz module, loaded at start


# ---------------------------------------------------------------- jobs on disk
LOCK = threading.RLock()
WAKE = threading.Event()


def job_dir(jid):
    return JOBS / jid


def read_job(jid):
    try:
        return json.loads((job_dir(jid) / "job.json").read_text())
    except Exception:
        return None


def write_job(job):
    d = job_dir(job["id"])
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / "job.json.tmp"
    tmp.write_text(json.dumps(job, indent=1, ensure_ascii=False))
    tmp.replace(d / "job.json")


def update_job(jid, **changes):
    with LOCK:
        job = read_job(jid)
        if not job:
            return None
        job.update(changes)
        job["updated"] = time.time()
        write_job(job)
        return job


TERMINAL = {"done", "failed", "cancelled"}


def transition(jid, allowed, **changes):
    """Change a job only from one of `allowed` states and never once it is cancelled
    (a cancel can land at any moment from the HTTP thread). -> the job, or None."""
    with LOCK:
        job = read_job(jid)
        if not job or job.get("state") not in allowed:
            return None
        if job.get("cancel") and changes.get("state") not in ("cancelled",):
            job.update(state="cancelled", finished=time.time(), reason=None)
            job["updated"] = time.time()
            write_job(job)
            return None
        job.update(changes)
        job["updated"] = time.time()
        write_job(job)
        return job


def all_jobs():
    out = []
    if JOBS.exists():
        for d in JOBS.iterdir():
            j = read_job(d.name) if d.is_dir() else None
            if j:
                out.append(j)
    return sorted(out, key=lambda j: j.get("created", 0))


def public(job):
    keys = ("id", "state", "reason", "error", "engine", "mode", "created", "started", "finished", "outputs", "progress", "position")
    return {k: job.get(k) for k in keys if job.get(k) is not None}


def clean_request(body):
    """A job from the app, checked: engine, mode, files, numbers. Raises ValueError with a readable message."""
    if not isinstance(body, dict):
        raise ValueError("Bad request.")
    jid = str(body.get("id") or "")
    if not JOB_ID.match(jid):
        raise ValueError("Bad job id.")
    engine = body.get("engine")
    if engine not in ENGINES:
        raise ValueError("Unknown engine.")
    prompt = str(body.get("prompt") or "").strip()
    if not prompt:
        raise ValueError("Write a prompt first.")
    if len(prompt) > 12000:
        raise ValueError("The prompt is too long.")
    files = lambda xs: [str(x) for x in (xs or [])]
    image = str(body.get("image") or "") or None
    refs = files(body.get("refs"))
    for name in ([image] if image else []) + refs:
        if not IN_NAME.match(name) or not (INBOX / name).is_file():
            raise ValueError("A picture did not arrive.")
    if engine == "wan" and refs:
        raise ValueError("Wan takes a start frame, not references.")
    if image and refs:
        raise ValueError("Use a start frame or references, not both.")
    if len(refs) > 9:
        raise ValueError("Up to 9 references.")
    res = str(body.get("res") or "720p")
    if res not in RES[engine]:
        raise ValueError(f"Resolution must be one of {', '.join(RES[engine])}.")
    try:
        seconds = float(body.get("seconds") or 5)
    except (TypeError, ValueError):
        raise ValueError("Bad duration.")
    if not 1 <= seconds <= (10 if engine == "h3" else 5):
        raise ValueError("Duration out of range.")
    seed = body.get("seed")
    seed = int(seed) if isinstance(seed, (int, float)) and 0 <= seed < 2**31 else int.from_bytes(os.urandom(4), "big") % 2**31
    mode = "i2v" if image else ("r2v" if engine == "h3" else "t2v")
    return {
        "id": jid, "engine": engine, "mode": mode, "prompt": prompt, "image": image, "refs": refs, "res": res,
        "seconds": seconds, "seed": seed, "turbo": bool(body.get("turbo")), "sound": engine == "h3" and body.get("sound") is not False,
    }


# ---------------------------------------------------------------- is the machine free?
REASONS = [
    (re.compile(r"Ollama"), "Ollama is holding a text model in GPU memory (it lets go a few minutes after the last use)"),
    (re.compile(r"RAM"), "not enough free RAM right now"),
    (re.compile(r"meetbot"), "Meetbot is processing a meeting"),
    (re.compile(r"GPU\d"), "the video cards are busy with another program"),
]


def readable(problem):
    parts = [why for rx, why in REASONS if rx.search(problem)]
    return "; ".join(dict.fromkeys(parts)) or "the machine is busy"


def gpu_lock_held():
    """True when someone (a QC check) holds the stand's GPU lock right now."""
    try:
        fd = os.open(GPU_LOCK, os.O_RDWR | os.O_CREAT, 0o664)
    except OSError:
        return False
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(fd, fcntl.LOCK_UN)
        return False
    except BlockingIOError:
        return True
    finally:
        os.close(fd)


def take_gpu_lock():
    fd = os.open(GPU_LOCK, os.O_RDWR | os.O_CREAT, 0o664)
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fd
    except BlockingIOError:
        os.close(fd)
        return None


def comfy_queue():
    try:
        return PV.http("GET", "/queue", timeout=10)
    except Exception:
        return None


def busy_reason(engine):
    """None when the machine can take a job now, else a short reason in English."""
    if not PV.comfy_alive():
        return "ComfyUI is not running on this server (start it with scripts/comfy_start.sh)"
    q = comfy_queue()
    if q and (q.get("queue_running") or q.get("queue_pending")):
        return "ComfyUI is working on another job"
    if list((PV.QUEUE / "running").glob("*.json")):
        return "the stand's own previz queue is running"
    if gpu_lock_held():
        return "a QC check is using the GPU"
    try:
        with contextlib.redirect_stdout(io.StringIO()):
            PV.preflight(engine)
    except SystemExit as e:
        return readable(str(e))
    return None


# ---------------------------------------------------------------- running one job
CURRENT = {"id": None, "prompt_id": None, "cancel": False}


class Busy(Exception):
    """Someone else's prompt got into ComfyUI first: back to waiting."""


def comfy_submit(graph, jid):
    cid = uuid.uuid4().hex
    try:
        r = PV.http("POST", "/prompt", {"prompt": graph, "client_id": cid})
    except urllib.error.HTTPError as e:
        raise RuntimeError("ComfyUI rejected the graph: " + e.read().decode()[:1500])
    pid = r["prompt_id"]
    with LOCK:
        CURRENT["prompt_id"] = pid
    update_job(jid, prompt_id=pid)
    # ComfyUI has no reservation: if another prompt slipped in between our check and
    # this submit, take ours back out (it is still pending, so this touches only ours).
    q = comfy_queue() or {}
    if any(len(x) > 1 and x[1] != pid for x in q.get("queue_running") or []):
        try:
            PV.http("POST", "/queue", {"delete": [pid]}, timeout=10)
        except Exception as e:
            log(f"{jid}: could not take back prompt {pid}: {e}")
        if not prompt_in_queue(pid):   # taken back: wait and check everything again
            update_job(jid, prompt_id=None)
            raise Busy("ComfyUI is working on another job")
        # Still there: it had already started (the other one ended meanwhile) — go on.
    return pid


def comfy_run(graph, jid, pid=None):
    pid = pid or comfy_submit(graph, jid)
    with LOCK:
        CURRENT["prompt_id"] = pid
    t0 = time.time()
    while time.time() - t0 < RUN_TIMEOUT_S:
        time.sleep(3)
        if CURRENT["cancel"]:
            cancel_prompt(pid)
        h = PV.http("GET", f"/history/{pid}")
        if pid in h:
            st = h[pid].get("status", {})
            if st.get("status_str") == "error":
                if CURRENT["cancel"]:
                    raise RuntimeError("Cancelled.")
                msgs = [m for m in st.get("messages", []) if m[0] in ("execution_error", "execution_interrupted")]
                raise RuntimeError("ComfyUI execution error: " + json.dumps(msgs)[:1500])
            if st.get("completed"):
                return h[pid]
        elif CURRENT["cancel"] and not prompt_in_queue(pid):
            raise RuntimeError("Cancelled.")
        update_job(jid, progress={"elapsed_s": round(time.time() - t0)})
    cancel_prompt(pid)
    raise TimeoutError("ComfyUI took longer than 3 hours.")


def prompt_in_queue(pid):
    q = comfy_queue() or {}
    return any(len(x) > 1 and x[1] == pid for x in (q.get("queue_running") or []) + (q.get("queue_pending") or []))


def cancel_prompt(pid):
    """Stop only our own prompt: drop it from the queue, or interrupt it if it is running.
    ComfyUI (0.40, server.py post_interrupt) checks the prompt_id itself and interrupts
    only when that prompt is the one executing, so another job is never stopped."""
    try:
        PV.http("POST", "/queue", {"delete": [pid]}, timeout=10)
        PV.http("POST", "/interrupt", {"prompt_id": pid}, timeout=10)
    except Exception as e:
        log(f"cancel {pid}: {e}")


def build_graph(job, prefix):
    engine, mode = job["engine"], job["mode"]
    w, h = PV.RES[engine][job["res"]]
    image = str(INBOX / job["image"]) if job.get("image") else None
    refs = [str(INBOX / r) for r in job.get("refs") or []]
    prompt = job["prompt"]
    if engine == "h3":
        frames = PV.h3_frames(job["seconds"])
        steps = 4 if (job["turbo"] and mode == "r2v") else 8 if job["turbo"] else 20
        if refs and "<Picture" not in prompt:
            prompt = " ".join(f"<Picture {i + 1}>" for i in range(len(refs))) + " are reference images.\n" + prompt
        return PV.graph_h3(prompt, w, h, frames, job["seed"], steps, refs, image, "i2v" if mode == "i2v" else "r2v", job["turbo"], prefix), prompt
    frames = int(job["seconds"] * 16) // 4 * 4 + 1
    steps = 4 if job["turbo"] else 20
    return PV.graph_wan(prompt, w, h, frames, job["seed"], steps, image, job["turbo"], prefix), prompt


def unstage(job):
    """previz.stage_image copies inputs into the stand's ComfyUI input folder as
    pv_<hash>_<name>; our names are unique random tokens, so their copies go after the job."""
    for name in ([job.get("image")] if job.get("image") else []) + list(job.get("refs") or []):
        for f in PV.COMFY_IN.glob(f"pv_*_{name}"):
            with contextlib.suppress(OSError):
                f.unlink()


def run_job(job, resume_pid=None):
    jid = job["id"]
    out = job_dir(jid)
    prefix = f"aivp/{jid}/clip"
    t0 = time.time()
    try:
        if resume_pid:
            hist = comfy_run(None, jid, pid=resume_pid)
        else:
            graph, prompt = build_graph(job, prefix)
            (out / "prompt_used.txt").write_text(prompt)
            hist = comfy_run(graph, jid)
    finally:
        try:
            PV.comfy_free()   # release the cards for meetbot / others, as previz does
        except Exception:
            pass
        if not resume_pid:
            unstage(job)
    src = PV.comfy_output_file(hist)
    dst = out / "clip.mp4"
    if job["engine"] == "h3" and job.get("sound"):
        shutil.copyfile(src, dst)
    else:
        PV.strip_audio(src, dst)
    os.chmod(dst, 0o660)
    try:
        info = PV.probe(dst)
    except Exception:
        info = {}
    return {"outputs": ["clip.mp4"], "seconds_wall": round(time.time() - t0, 1), "video": info}


def next_job():
    for j in all_jobs():
        if j.get("state") in ("queued", "waiting") and not j.get("cancel"):
            return j
    return None


RESUME = []   # jobs that were rendering when the bridge stopped: their ComfyUI prompt is picked up again


def finish(jid, fn):
    """Run a job's render (fresh or resumed) and record how it ended."""
    try:
        res = fn()
        if not transition(jid, {"running"}, state="done", finished=time.time(), **res):
            log(f"{jid} finished after a cancel — result kept on disk, job stays cancelled")
        else:
            log(f"{jid} done in {res['seconds_wall']} s")
    except Busy as e:
        transition(jid, {"running"}, state="waiting", reason=str(e), started=None)
        log(f"{jid} back to waiting: {e}")
        return "busy"
    except Exception as e:
        job = read_job(jid) or {}
        if CURRENT["cancel"] or job.get("cancel"):
            transition(jid, {"running", "cancelled"}, state="cancelled", finished=time.time())
            log(f"{jid} cancelled")
        else:
            transition(jid, {"running"}, state="failed", error=str(e)[:1500], finished=time.time())
            log(f"{jid} failed: {str(e)[:300]}")
    return None


def worker():
    while True:
        fd = None
        try:
            if RESUME:
                job = RESUME.pop(0)
                jid = job["id"]
                fd = take_gpu_lock()   # hold it again while the picked-up render runs
                with LOCK:
                    CURRENT.update(id=jid, prompt_id=job["prompt_id"], cancel=bool(job.get("cancel")))
                log(f"{jid} resumes ComfyUI prompt {job['prompt_id']}")
                finish(jid, lambda: run_job(job, resume_pid=job["prompt_id"]))
                continue
            job = next_job()
            if not job:
                WAKE.wait(IDLE_POLL_S)
                WAKE.clear()
                continue
            jid = job["id"]
            if time.time() - job.get("created", time.time()) > MAX_WAIT_S:
                transition(jid, {"queued", "waiting"}, state="failed", error="Waited too long for the GPU.", finished=time.time())
                continue
            reason = busy_reason(job["engine"])
            fd = None if reason else take_gpu_lock()
            if not reason and fd is None:
                reason = "a QC check is using the GPU"
            if reason:
                if job.get("reason") != reason or job.get("state") != "waiting":
                    log(f"{jid} waits: {reason}")
                transition(jid, {"queued", "waiting"}, state="waiting", reason=reason)
                WAKE.wait(WAIT_POLL_S)
                WAKE.clear()
                continue
            with LOCK:
                started = transition(jid, {"queued", "waiting"}, state="running", reason=None, started=time.time())
                if started:
                    CURRENT.update(id=jid, prompt_id=None, cancel=False)
            if not started:
                continue   # cancelled meanwhile
            log(f"{jid} runs: {job['engine']} {job['mode']} {job['res']} {job['seconds']}s turbo={job['turbo']}")
            if finish(jid, lambda: run_job(job)) == "busy":
                os.close(fd)
                fd = None
                WAKE.wait(WAIT_POLL_S)
                WAKE.clear()
        except Exception:
            log("worker error: " + traceback.format_exc()[-1500:])
            time.sleep(10)
        finally:
            with LOCK:
                CURRENT.update(id=None, prompt_id=None, cancel=False)
            if fd is not None:
                os.close(fd)


def janitor():
    while True:
        try:
            now = time.time()
            for j in all_jobs():
                if j.get("state") in ("done", "failed", "cancelled") and now - j.get("finished", now) > KEEP_JOBS_S:
                    shutil.rmtree(job_dir(j["id"]), ignore_errors=True)
            if INBOX.exists():
                for f in INBOX.iterdir():
                    if f.is_file() and now - f.stat().st_mtime > KEEP_INBOX_S:
                        f.unlink(missing_ok=True)
        except Exception as e:
            log(f"janitor: {e}")
        time.sleep(3600)


# ---------------------------------------------------------------- HTTP over the unix socket
class Handler(http.server.BaseHTTPRequestHandler):
    server_version = "h3-bridge/1"

    def log_message(self, fmt, *args):
        pass

    def address_string(self):
        return "unix"

    def send(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def body(self):
        n = int(self.headers.get("content-length") or 0)
        if n > 100_000:
            raise ValueError("Request too large.")
        return json.loads(self.rfile.read(n) or b"{}")

    def do_GET(self):
        if self.path == "/status":
            jobs = all_jobs()
            active = [public(j) for j in jobs if j.get("state") in ("queued", "waiting", "running")]
            return self.send(200, {"ok": True, "comfy": PV.comfy_alive(), "jobs": active})
        m = re.match(r"^/jobs/([A-Za-z0-9_-]+)$", self.path)
        if m:
            job = read_job(m.group(1))
            if not job:
                return self.send(404, {"error": "No such job."})
            out = public(job)
            if job.get("state") in ("queued", "waiting"):
                waiting = [j["id"] for j in all_jobs() if j.get("state") in ("queued", "waiting") and not j.get("cancel")]
                out["position"] = waiting.index(job["id"]) + 1 if job["id"] in waiting else None
            return self.send(200, out)
        return self.send(404, {"error": "Not found."})

    def do_POST(self):
        try:
            if self.path == "/jobs":
                req = clean_request(self.body())
                with LOCK:
                    if read_job(req["id"]):
                        return self.send(200, public(read_job(req["id"])))  # sent twice: the same job
                    job = {**req, "state": "queued", "created": time.time()}
                    write_job(job)
                WAKE.set()
                log(f"{req['id']} queued: {req['engine']} {req['mode']}")
                return self.send(200, public(job))
            m = re.match(r"^/jobs/([A-Za-z0-9_-]+)/cancel$", self.path)
            if m:
                jid = m.group(1)
                with LOCK:
                    job = read_job(jid)
                    if not job:
                        return self.send(404, {"error": "No such job."})
                    if job.get("state") in ("queued", "waiting"):
                        job = update_job(jid, state="cancelled", cancel=True, finished=time.time())
                    elif job.get("state") == "running":
                        update_job(jid, cancel=True)
                        if CURRENT["id"] == jid:
                            CURRENT["cancel"] = True
                            if CURRENT["prompt_id"]:
                                threading.Thread(target=cancel_prompt, args=(CURRENT["prompt_id"],), daemon=True).start()
                        job = read_job(jid)
                return self.send(200, public(job))
            return self.send(404, {"error": "Not found."})
        except ValueError as e:
            return self.send(400, {"error": str(e)})
        except Exception as e:
            log("request error: " + traceback.format_exc()[-1000:])
            return self.send(500, {"error": "Bridge error."})


class UnixHTTPServer(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True

    def get_request(self):
        req, _ = super().get_request()
        return req, ("unix", 0)


def main():
    global PV
    os.umask(0o007)   # job files, pictures, videos: owner and group only
    PV = load_previz()
    for d in (BRIDGE_DIR, JOBS, INBOX):
        d.mkdir(parents=True, exist_ok=True)
    # A job that was running when the bridge stopped: ComfyUI may still have it — it is not
    # resumed (its result could not be collected reliably); it is reported as failed.
    # A job that was rendering when the bridge stopped: its ComfyUI prompt keeps going;
    # it is picked up again (the GPU lock is taken back) — or failed if it never got one.
    for j in all_jobs():
        if j.get("state") == "running":
            if j.get("prompt_id"):
                RESUME.append(j)
            else:
                update_job(j["id"], state="failed", error="The bridge restarted during this job.", finished=time.time())
    if SOCKET.exists():
        with contextlib.suppress(OSError):
            s = socket.socket(socket.AF_UNIX)
            s.settimeout(1)
            try:
                s.connect(str(SOCKET))
                sys.exit("another bridge is already listening on " + str(SOCKET))
            except OSError:
                SOCKET.unlink()
            finally:
                s.close()
    old = os.umask(0o117)   # socket: rw for the owner and its group only
    try:
        server = UnixHTTPServer(str(SOCKET), Handler)
    finally:
        os.umask(old)
    with contextlib.suppress(OSError):
        os.chmod(BRIDGE_DIR, 0o2770)
    # Stopping (ensure.sh stop / restart): a render in ComfyUI is left running and
    # picked up by the next start (its prompt id is saved with the job).
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=server.shutdown, daemon=True).start())
    threading.Thread(target=worker, daemon=True).start()
    threading.Thread(target=janitor, daemon=True).start()
    log(f"h3-bridge listening on {SOCKET} (previz: {PREVIZ_FILE})")
    try:
        server.serve_forever()
    finally:
        with contextlib.suppress(OSError):
            SOCKET.unlink()


if __name__ == "__main__":
    main()

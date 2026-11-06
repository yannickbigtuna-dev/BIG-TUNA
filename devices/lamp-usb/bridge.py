#!/usr/bin/env python3
"""BIG TUNA lamp bridge: local server <-> USB ESP32 lamp relay, plus phone-presence rules.

Runs under PM2 as `bigtuna-lamp` on the Mac mini that also runs the website server.

  server (127.0.0.1:3000)  --/api/lamp/events SSE-->  bridge  --USB serial "lamp 0|1"-->  ESP32 relay
  ESP32 BLE phone ticks    -->  bridge presence rules  --POST /api/lamp-->  server (app/website stay in sync)

Survives restarts: PM2 (resurrected by launchd at boot) restarts this process; it reconnects to the
serial port and server forever, and a 1 s reconcile loop re-sends the server state to the ESP32 until
the relay matches. Presence rules start in an "unknown" state after every start, so a restart never
fires an automation by itself.

Dashboard: http://localhost:8765 (local only).
"""
import collections
import glob
import json
import os
import queue
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".deps"))
import serial  # noqa: E402  (pyserial, installed with: pip install --target .deps pyserial)

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
CFG = json.load(open(os.path.join(HERE, "config.json")))
P = CFG["presence"]
SERVER = CFG["serverUrl"].rstrip("/")
STATE_DIR = os.path.join(REPO, "data", "lamp-usb")
STATE_FILE = os.path.join(STATE_DIR, "state.json")
HISTORY_S = 600


def load_token():
    """Optional device token, same variables the server reads. Never logged."""
    tok = os.environ.get("LAMP_DEVICE_API_TOKEN") or os.environ.get("LIGHTS_DEVICE_API_TOKEN")
    if tok:
        return tok
    try:
        for line in open(os.path.join(REPO, "server.env")):
            k, _, v = line.strip().partition("=")
            if k in ("LAMP_DEVICE_API_TOKEN", "LIGHTS_DEVICE_API_TOKEN") and v:
                return v.strip().strip("'\"")
    except OSError:
        pass
    return ""


TOKEN = load_token()


def load_saved():
    try:
        return json.load(open(STATE_FILE))
    except (OSError, ValueError):
        return {}


def save_saved():
    os.makedirs(STATE_DIR, exist_ok=True)
    tmp = STATE_FILE + ".tmp"
    with open(tmp, "w") as f:
        json.dump({"automation": state["automation"], "presence": P}, f)
    os.replace(tmp, STATE_FILE)


# Dashboard-editable thresholds: (min, max). Saved values override config.json defaults.
LIMITS = {
    "leaveAfterSeconds": (30, 900),
    "awayAtLeastSeconds": (60, 3600),
    "arriveSightings": (1, 10),
    "arriveWindowSeconds": (5, 120),
    "arriveMinRssi": (-100, -40),
    "quietHoursStart": (0, 23),
    "quietHoursEnd": (0, 23),
}
for _k, _v in load_saved().get("presence", {}).items():
    if _k in LIMITS and isinstance(_v, int) and LIMITS[_k][0] <= _v <= LIMITS[_k][1]:
        P[_k] = _v

lock = threading.RLock()
state = {
    # links
    "serial": False, "server": False,
    # lamp: desired = stored server value; relay = PHYSICAL state confirmed by the ESP32
    # (physical = not stored when lampInvertOutput; the ESP32 only ever sees physical on/off)
    "desired": None, "relay": None,
    # phone
    "enrolled": False, "enrolling": False, "irk": None,
    "last_seen": None, "rssi": None, "rssi_smooth": None, "adv_rate": None,
    # presence rules
    "automation": load_saved().get("automation", True),
    "presence": "unknown", "away_since": None, "last_event": None,
}
started_at = time.time()
strong = collections.deque()
history, logs, subscribers = [], [], set()
ser, ser_lock = None, threading.Lock()


def physical(stored):
    if stored is None:
        return None
    return (not stored) if CFG["lampInvertOutput"] else stored


def stored_for(phys):
    return (not phys) if CFG["lampInvertOutput"] else phys


def quiet_now():
    h = time.localtime().tm_hour
    s, e = P["quietHoursStart"], P["quietHoursEnd"]
    return (h >= s or h < e) if s > e else (s <= h < e)


# ---- events to dashboard ---------------------------------------------------

def broadcast(kind, payload):
    msg = f"event: {kind}\ndata: {json.dumps(payload)}\n\n".encode()
    for q in list(subscribers):
        try:
            q.put_nowait(msg)
        except queue.Full:
            pass


def snapshot():
    now = time.time()
    s = dict(state)
    s["present"] = bool(s["last_seen"] and now - s["last_seen"] < P["leaveAfterSeconds"])
    s["seen_ago"] = round(now - s["last_seen"], 1) if s["last_seen"] else None
    s["away_for"] = round(now - s["away_since"]) if s["presence"] == "away" and s["away_since"] else None
    s["lamp_on"] = s["relay"]
    s["lamp_desired_on"] = physical(s["desired"])
    s["quiet"] = quiet_now()
    s["cfg"] = dict(P)
    s["limits"] = LIMITS
    return s


def log(msg):
    entry = [time.time(), msg]
    print(time.strftime("%F %T"), msg, flush=True)
    with lock:
        logs.append(entry)
        del logs[:-300]
    broadcast("log", entry)


# ---- server I/O ------------------------------------------------------------

def http(method, path, body=None, timeout=5):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(SERVER + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if TOKEN and path.startswith("/api/lamp/device"):
        req.add_header("X-Big-Tuna-Device-Token", TOKEN)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read() or b"null")


def set_desired(stored, why):
    with lock:
        changed = state["desired"] != stored
        state["desired"] = stored
    if changed:
        log(f"Lamp -> {'ON' if physical(stored) else 'OFF'} ({why})")
    push_relay()


def events_loop():
    """Live lamp state from the local server (instant), reconnecting forever."""
    while True:
        try:
            req = urllib.request.Request(SERVER + "/api/lamp/events", headers={"Accept": "text/event-stream"})
            with urllib.request.urlopen(req, timeout=40) as r:  # server pings every 15 s
                with lock:
                    state["server"] = True
                log("Server live stream connected")
                for raw in r:
                    line = raw.decode(errors="replace").strip()
                    if line.startswith("data:"):
                        on = json.loads(line[5:]).get("on")
                        if isinstance(on, bool):
                            set_desired(on, "server")
        except Exception as e:
            with lock:
                was = state["server"]
                state["server"] = False
            if was:
                log(f"Server stream lost ({e.__class__.__name__}), retrying")
        time.sleep(1)


def reconcile_loop():
    """Every second: poll the device route (heartbeat + fallback) and make the relay match."""
    while True:
        try:
            on = http("GET", "/api/lamp/device").get("on")
            if isinstance(on, bool):
                set_desired(on, "server poll")
        except Exception:
            pass
        push_relay()
        time.sleep(1)


def report_relay(on):
    try:
        http("POST", "/api/lamp/device/status", {"on": on})
    except Exception as e:
        log(f"Status report failed: {e.__class__.__name__}")


# ---- serial I/O --------------------------------------------------------------

def send(cmd):
    with ser_lock:
        if ser is None:
            return False
        try:
            ser.write((cmd + "\n").encode())
            return True
        except (serial.SerialException, OSError):
            return False


def push_relay():
    with lock:
        want, r = physical(state["desired"]), state["relay"]
    if want is not None and want != r:
        send(f"lamp {1 if want else 0}")


def handle_line(line):
    try:
        m = json.loads(line)
    except json.JSONDecodeError:
        return  # ROM boot noise
    t = m.get("type")
    now = time.time()
    if t == "lamp":
        with lock:
            changed = state["relay"] != m["on"]
            state["relay"] = m["on"]
        if changed:
            log(f"Relay confirmed lamp {'ON' if m['on'] else 'OFF'}")
        threading.Thread(target=report_relay, args=(stored_for(m["on"]),), daemon=True).start()
        push_relay()
    elif t == "status":
        with lock:
            state["enrolled"] = m.get("enrolled", False)
            state["enrolling"] = m.get("enrolling", False)
            state["irk"] = m.get("irk")
    elif t == "tick":
        r = m.get("rssi")
        with lock:
            state["adv_rate"] = m.get("adv")
            if r is not None:
                state["last_seen"] = now
                state["rssi"] = r
                prev = state["rssi_smooth"]
                state["rssi_smooth"] = r if prev is None else round(prev * 0.7 + r * 0.3, 1)
            elif not (state["last_seen"] and now - state["last_seen"] < P["leaveAfterSeconds"]):
                state["rssi_smooth"] = None
            history.append([now, r, state["rssi_smooth"]])
            del history[: max(0, len(history) - HISTORY_S)]
            sample = history[-1]
        broadcast("sample", sample)
        presence_step(now, r)
    elif t == "log":
        log("ESP32: " + m.get("msg", ""))
    elif t == "enrolled":
        log("Phone paired, key saved on ESP32")
    broadcast("state", snapshot())


def find_port():
    if CFG.get("serialPort"):
        return CFG["serialPort"]
    ports = sorted(glob.glob("/dev/cu.usbserial*") + glob.glob("/dev/cu.SLAB*") + glob.glob("/dev/cu.wchusb*"))
    return ports[0] if ports else None


def serial_loop():
    global ser
    announced_missing = False
    while True:
        port = find_port()
        if not port:
            if not announced_missing:
                log("ESP32 not found on USB, waiting")
                announced_missing = True
            time.sleep(2)
            continue
        announced_missing = False
        try:
            s = serial.Serial()
            s.port, s.baudrate, s.timeout = port, 115200, 1
            s.dtr = False  # don't pulse EN/IO0, so opening the port doesn't reset the board
            s.rts = False
            s.open()
            with ser_lock:
                ser = s
            with lock:
                state["serial"] = True
                state["relay"] = None  # unknown until the ESP32 answers
            log(f"ESP32 connected on {port}")
            send("status")
            buf = b""
            while True:
                chunk = s.read(512)
                if chunk:
                    buf += chunk
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        line = line.decode(errors="replace").strip()
                        if line:
                            handle_line(line)
        except (serial.SerialException, OSError) as e:
            with ser_lock:
                ser = None
            with lock:
                state["serial"] = False
            log(f"ESP32 disconnected ({e.__class__.__name__}), retrying")
            broadcast("state", snapshot())
            time.sleep(2)


# ---- presence rules ------------------------------------------------------------

def presence_step(now, rssi):
    with lock:
        _presence_step(now, rssi)


def _presence_step(now, rssi):
    if not state["enrolled"]:
        return
    if rssi is not None and rssi >= P["arriveMinRssi"]:
        strong.append(now)
    while strong and strong[0] < now - P["arriveWindowSeconds"]:
        strong.popleft()
    arrived = len(strong) >= P["arriveSightings"]
    last = state["last_seen"]
    gone = (now - (last or started_at)) > P["leaveAfterSeconds"]
    st = state["presence"]

    if st == "unknown":  # after any restart: learn silently, never act
        if arrived:
            state["presence"] = "present"
            log("Presence: phone is here (startup, no action)")
        elif gone:
            state["presence"], state["away_since"] = "away", last or started_at
            log("Presence: phone is away (startup, no action)")

    elif st == "present" and gone:
        state["presence"], state["away_since"] = "away", last
        lamp_on = physical(state["desired"])
        if not state["automation"]:
            event("Left: automation off, no change")
        elif lamp_on:
            event(f"Left (unseen {P['leaveAfterSeconds']}s): lamp OFF")
            post_lamp(False)
        else:
            event("Left: lamp already off")

    elif st == "away" and arrived:
        away = now - (state["away_since"] or now)
        state["presence"] = "present"
        lamp_on = physical(state["desired"])
        if not state["automation"]:
            event("Arrived: automation off, no change")
        elif away < P["awayAtLeastSeconds"]:
            event(f"Back after {away/60:.1f} min (< {P['awayAtLeastSeconds']//60} min): no change")
        elif quiet_now():
            event(f"Arrived during quiet hours ({P['quietHoursStart']}:00-{P['quietHoursEnd']}:00): no change")
        elif lamp_on:
            event("Arrived: lamp already on")
        else:
            event(f"Arrived after {away/60:.0f} min away: lamp ON")
            post_lamp(True)


def event(msg):
    state["last_event"] = [time.time(), msg]
    log("Presence: " + msg)


def post_lamp(phys_on):
    def go():
        try:
            http("POST", "/api/lamp", {"on": stored_for(phys_on)})
        except Exception as e:
            log(f"Could not set lamp on server: {e}")
    threading.Thread(target=go, daemon=True).start()


# ---- dashboard -------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            body = open(os.path.join(HERE, "dashboard", "index.html"), "rb").read()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        elif self.path == "/events":
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            q = queue.Queue(maxsize=1000)
            with lock:
                init = {"state": snapshot(), "history": history[-HISTORY_S:], "logs": logs[-150:]}
            subscribers.add(q)
            try:
                self.wfile.write(f"event: init\ndata: {json.dumps(init)}\n\n".encode())
                self.wfile.flush()
                while True:
                    try:
                        msg = q.get(timeout=15)
                    except queue.Empty:
                        msg = b": ping\n\n"
                    self.wfile.write(msg)
                    self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                pass
            finally:
                subscribers.discard(q)
        else:
            self.send_error(404)

    def do_POST(self):
        path = self.path.strip("/")
        if path in ("cmd/enroll", "cmd/cancel", "cmd/forget", "cmd/status"):
            ok = send(path[4:])
            log(f"> {path[4:]}")
        elif path in ("lamp/on", "lamp/off"):
            post_lamp(path == "lamp/on")
            ok = True
        elif path == "settings":
            try:
                body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
            except ValueError:
                return self.send_error(400)
            with lock:
                for k, v in body.items():
                    if k in LIMITS and isinstance(v, int) and LIMITS[k][0] <= v <= LIMITS[k][1] and P[k] != v:
                        log(f"Setting {k}: {P[k]} -> {v}")
                        P[k] = v
                save_saved()
            broadcast("state", snapshot())
            ok = True
        elif path in ("automation/on", "automation/off"):
            with lock:
                state["automation"] = path.endswith("on")
                save_saved()
            log(f"Presence automation {'enabled' if state['automation'] else 'disabled'}")
            broadcast("state", snapshot())
            ok = True
        else:
            return self.send_error(404)
        self.send_response(204 if ok else 503)
        self.end_headers()


def ticker():
    while True:
        time.sleep(1)
        with lock:
            snap = snapshot()
        broadcast("state", snap)


def main():
    log(f"Lamp bridge starting (server {SERVER}, device token {'set' if TOKEN else 'not set'})")
    for fn in (serial_loop, events_loop, reconcile_loop, ticker):
        threading.Thread(target=fn, daemon=True).start()
    srv = ThreadingHTTPServer(("127.0.0.1", CFG["dashboardPort"]), Handler)
    srv.daemon_threads = True
    log(f"Dashboard on http://localhost:{CFG['dashboardPort']}")
    srv.serve_forever()


if __name__ == "__main__":
    main()

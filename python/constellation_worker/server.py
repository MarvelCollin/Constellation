from __future__ import annotations

import argparse
import hmac
import json
import secrets
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timedelta, timezone

from .ai import encode_state, parse_load_payload, process as ai_process
from .hardware import snapshot


PEER_STALE_SECONDS = 15
MAX_JSON_BODY_BYTES = 1_048_576


class MainServer(ThreadingHTTPServer):
  daemon_threads = True

  def __init__(self, server_address: tuple[str, int], token: str) -> None:
    super().__init__(server_address, MainRequestHandler)
    self.token = token
    self.lock = threading.Lock()
    self.peers: dict[str, dict[str, object]] = {}
    self.messages: list[dict[str, str]] = []


class MainRequestHandler(BaseHTTPRequestHandler):
  server: MainServer
  protocol_version = "HTTP/1.1"

  def log_message(self, format: str, *args: object) -> None:
    return

  def end_headers(self) -> None:
    self.send_header("Access-Control-Allow-Origin", "*")
    self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
    self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    self.send_header("Access-Control-Max-Age", "600")
    super().end_headers()

  def do_OPTIONS(self) -> None:
    self.send_response(HTTPStatus.NO_CONTENT.value)
    self.send_header("Content-Length", "0")
    self.end_headers()

  def do_GET(self) -> None:
    if self.path == "/health":
      if not self.is_authorized():
        self.send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "Unauthorized"})
        return

      self.send_json(HTTPStatus.OK, {"ok": True, "role": "main"})
      return

    if self.path == "/api/hardware":
      if not self.is_authorized():
        self.send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "Unauthorized"})
        return

      self.send_json(HTTPStatus.OK, {"ok": True, "data": snapshot()})
      return

    if self.path == "/api/peers":
      if not self.is_authorized():
        self.send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "Unauthorized"})
        return

      self.send_json(HTTPStatus.OK, {"ok": True, "data": self.peer_list()})
      return

    if self.path == "/api/chat":
      if not self.is_authorized():
        self.send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "Unauthorized"})
        return

      self.send_json(HTTPStatus.OK, {"ok": True, "data": self.chat_snapshot()})
      return

    if self.path == "/api/ai/state":
      if not self.is_authorized():
        self.send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "Unauthorized"})
        return

      self.send_raw_json(HTTPStatus.OK, encode_state())
      return

    self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})

  def do_POST(self) -> None:
    if not self.is_authorized():
      self.send_json(HTTPStatus.UNAUTHORIZED, {"ok": False, "error": "Unauthorized"})
      return

    if self.path == "/api/peers":
      payload = self.read_json()

      if payload is None or not isinstance(payload.get("name"), str):
        self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid peer name"})
        return

      peer = self.register_peer(payload["name"])
      self.send_json(HTTPStatus.OK, {"ok": True, "data": {"peer": peer, "peers": self.peer_list()}})
      return

    if self.path == "/api/peers/heartbeat":
      payload = self.read_json()

      if payload is None or not isinstance(payload.get("id"), str):
        self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid peer id"})
        return

      peer = self.touch_peer(payload["id"])

      if peer is None:
        self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Peer not registered"})
        return

      self.send_json(HTTPStatus.OK, {"ok": True, "data": {"peer": peer, "peers": self.peer_list()}})
      return

    if self.path == "/api/chat":
      payload = self.read_json()

      if (
        payload is None
        or not isinstance(payload.get("sender"), str)
        or not isinstance(payload.get("body"), str)
      ):
        self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid chat message"})
        return

      message = self.add_message(payload["sender"], payload["body"])

      if message is None:
        self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Message must be 1 to 1000 characters"})
        return

      self.send_json(HTTPStatus.OK, {"ok": True, "data": self.chat_snapshot()})
      return

    if self.path == "/api/ai/load":
      payload = self.read_json()

      if payload is None:
        self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Invalid load request"})
        return

      try:
        runtime_path, model_path, n_gpu_layers, context_size, rpc_peers = parse_load_payload(payload)
        ai_process.start(runtime_path, model_path, n_gpu_layers, context_size, rpc_peers)
      except (ValueError, RuntimeError) as error:
        self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": str(error)})
        return

      self.send_raw_json(HTTPStatus.OK, encode_state())
      return

    if self.path == "/api/ai/unload":
      ai_process.stop()
      self.send_raw_json(HTTPStatus.OK, encode_state())
      return

    if self.path == "/api/ai/chat":
      self.proxy_completion()
      return

    self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})

  def is_authorized(self) -> bool:
    header = self.headers.get("Authorization", "")
    expected = f"Bearer {self.server.token}"
    return hmac.compare_digest(header, expected)

  def read_raw_body(self) -> bytes | None:
    content_length = self.headers.get("Content-Length")

    if content_length is None:
      return None

    try:
      length = int(content_length)
    except ValueError:
      return None

    if length < 1 or length > MAX_JSON_BODY_BYTES:
      return None

    return self.rfile.read(length)

  def read_json(self) -> dict[str, object] | None:
    raw = self.read_raw_body()

    if raw is None:
      return None

    try:
      payload = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
      return None

    if not isinstance(payload, dict):
      return None

    return payload

  def peer_list(self) -> list[dict[str, object]]:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(seconds=PEER_STALE_SECONDS)

    with self.server.lock:
      items: list[dict[str, object]] = []
      for peer in self.server.peers.values():
        last_seen_value = peer.get("lastSeen")
        last_seen = datetime.fromisoformat(last_seen_value) if isinstance(last_seen_value, str) else now
        items.append({
          "id": peer["id"],
          "name": peer["name"],
          "lastSeen": peer["lastSeen"],
          "online": last_seen >= cutoff,
        })

    items.sort(key=lambda peer: str(peer["lastSeen"]), reverse=True)
    return items

  def chat_snapshot(self) -> dict[str, object]:
    return {
      "peers": self.peer_list(),
      "messages": self.recent_messages(),
    }

  def recent_messages(self) -> list[dict[str, str]]:
    with self.server.lock:
      return list(self.server.messages[-100:])

  def register_peer(self, name: str) -> dict[str, object]:
    peer_name = name.strip()[:64]

    if not peer_name:
      peer_name = "Unknown node"

    peer: dict[str, object] = {
      "id": secrets.token_hex(8),
      "name": peer_name,
      "lastSeen": datetime.now(timezone.utc).isoformat(),
    }

    with self.server.lock:
      self.server.peers[str(peer["id"])] = peer

    return {**peer, "online": True}

  def touch_peer(self, peer_id: str) -> dict[str, object] | None:
    with self.server.lock:
      peer = self.server.peers.get(peer_id)

      if peer is None:
        return None

      peer["lastSeen"] = datetime.now(timezone.utc).isoformat()
      return {**peer, "online": True}

  def add_message(self, sender: str, body: str) -> dict[str, str] | None:
    message_body = body.strip()
    message_sender = sender.strip()[:64]

    if not message_sender:
      message_sender = "Unknown node"

    if len(message_body) < 1 or len(message_body) > 1000:
      return None

    message = {
      "id": secrets.token_hex(10),
      "sender": message_sender,
      "body": message_body,
      "createdAt": datetime.now(timezone.utc).isoformat(),
    }

    with self.server.lock:
      self.server.messages.append(message)
      self.server.messages = self.server.messages[-200:]

    return message

  def proxy_completion(self) -> None:
    raw = self.read_raw_body()

    if raw is None:
      self.send_json(HTTPStatus.BAD_REQUEST, {"ok": False, "error": "Body required"})
      return

    if not ai_process.is_ready():
      self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"ok": False, "error": "Model is not loaded"})
      return

    try:
      generator = ai_process.proxy_chat(raw)
    except RuntimeError as error:
      self.send_json(HTTPStatus.SERVICE_UNAVAILABLE, {"ok": False, "error": str(error)})
      return

    self.send_response_only(HTTPStatus.OK.value)
    self.send_header("Content-Type", "text/event-stream")
    self.send_header("Cache-Control", "no-cache")
    self.send_header("X-Accel-Buffering", "no")
    self.send_header("Transfer-Encoding", "chunked")
    self.send_header("Connection", "close")
    self.end_headers()
    self.close_connection = True

    try:
      for chunk in generator:
        if chunk:
          self.write_chunk(chunk)

      self.wfile.write(b"0\r\n\r\n")
      self.wfile.flush()
    except (BrokenPipeError, ConnectionResetError):
      pass
    finally:
      generator.close()

  def write_chunk(self, chunk: bytes) -> None:
    header = f"{len(chunk):x}\r\n".encode("ascii")
    self.wfile.write(header)
    self.wfile.write(chunk)
    self.wfile.write(b"\r\n")
    self.wfile.flush()

  def send_raw_json(self, status: HTTPStatus, body: bytes) -> None:
    self.send_response(status.value)
    self.send_header("Content-Type", "application/json")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)

  def send_json(self, status: HTTPStatus, payload: object) -> None:
    body = json.dumps(payload).encode("utf-8")
    self.send_raw_json(status, body)


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(prog="constellation-worker-server")
  parser.add_argument("--host", default="127.0.0.1")
  parser.add_argument("--port", default=8765, type=int)
  parser.add_argument("--token", required=True)
  return parser.parse_args()


def main() -> None:
  args = parse_args()
  if len(args.token.strip()) < 8:
    raise SystemExit("Token must be at least 8 characters")
  server = MainServer((args.host, args.port), args.token)
  print(json.dumps({"event": "ready", "host": args.host, "port": args.port}), flush=True)
  server.serve_forever()


if __name__ == "__main__":
  main()

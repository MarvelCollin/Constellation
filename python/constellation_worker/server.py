from __future__ import annotations

import argparse
import hmac
import json
import secrets
import threading
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from datetime import datetime, timezone

from .hardware import snapshot


class MainServer(ThreadingHTTPServer):
  def __init__(self, server_address: tuple[str, int], token: str) -> None:
    super().__init__(server_address, MainRequestHandler)
    self.token = token
    self.lock = threading.Lock()
    self.peers: dict[str, dict[str, str]] = {}
    self.messages: list[dict[str, str]] = []


class MainRequestHandler(BaseHTTPRequestHandler):
  server: MainServer

  def log_message(self, format: str, *args: object) -> None:
    return

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

    self.send_json(HTTPStatus.NOT_FOUND, {"ok": False, "error": "Not found"})

  def is_authorized(self) -> bool:
    header = self.headers.get("Authorization", "")
    expected = f"Bearer {self.server.token}"
    return hmac.compare_digest(header, expected)

  def read_json(self) -> dict[str, object] | None:
    content_length = self.headers.get("Content-Length")

    if content_length is None:
      return None

    try:
      length = int(content_length)
    except ValueError:
      return None

    if length < 1 or length > 4096:
      return None

    try:
      payload = json.loads(self.rfile.read(length).decode("utf-8"))
    except json.JSONDecodeError:
      return None

    if not isinstance(payload, dict):
      return None

    return payload

  def peer_list(self) -> list[dict[str, str]]:
    with self.server.lock:
      return sorted(self.server.peers.values(), key=lambda peer: peer["lastSeen"], reverse=True)

  def chat_snapshot(self) -> dict[str, list[dict[str, str]]]:
    with self.server.lock:
      return {
        "peers": sorted(self.server.peers.values(), key=lambda peer: peer["lastSeen"], reverse=True),
        "messages": self.server.messages[-100:],
      }

  def register_peer(self, name: str) -> dict[str, str]:
    peer_name = name.strip()[:64]

    if not peer_name:
      peer_name = "Unknown node"

    peer = {
      "id": secrets.token_hex(8),
      "name": peer_name,
      "lastSeen": datetime.now(timezone.utc).isoformat(),
    }

    with self.server.lock:
      self.server.peers[peer["id"]] = peer

    return peer

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

  def send_json(self, status: HTTPStatus, payload: object) -> None:
    body = json.dumps(payload).encode("utf-8")
    self.send_response(status.value)
    self.send_header("Content-Type", "application/json")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)


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

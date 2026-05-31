from __future__ import annotations

import http.client
import json
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Generator


READY_TIMEOUT_SECONDS = 180.0
SHUTDOWN_TIMEOUT_SECONDS = 5.0
PROXY_CHUNK_BYTES = 4096
UPSTREAM_PORT = 8766
UPSTREAM_HOST = "127.0.0.1"


class LlamaProcess:
  def __init__(self) -> None:
    self._lock = threading.Lock()
    self._process: subprocess.Popen[str] | None = None
    self._runtime_path: str | None = None
    self._model_path: str | None = None
    self._n_gpu_layers: int = 0
    self._context_size: int = 0
    self._rpc_peers: list[str] = []
    self._log: list[str] = []
    self._ready: bool = False

  def is_running(self) -> bool:
    with self._lock:
      return self._process is not None and self._process.poll() is None

  def is_ready(self) -> bool:
    with self._lock:
      return self._ready and self._process is not None and self._process.poll() is None

  def state(self) -> dict[str, Any]:
    with self._lock:
      running = self._process is not None and self._process.poll() is None
      return {
        "running": running,
        "ready": self._ready and running,
        "modelPath": self._model_path if running else None,
        "runtimePath": self._runtime_path if running else None,
        "nGpuLayers": self._n_gpu_layers if running else 0,
        "contextSize": self._context_size if running else 0,
        "rpcPeers": list(self._rpc_peers) if running else [],
        "host": UPSTREAM_HOST,
        "port": UPSTREAM_PORT,
        "log": list(self._log[-30:]),
      }

  def start(
    self,
    runtime_path: str,
    model_path: str,
    n_gpu_layers: int,
    context_size: int,
    rpc_peers: list[str],
  ) -> None:
    runtime = Path(runtime_path)
    model = Path(model_path)

    if not runtime.is_file():
      raise RuntimeError(f"Runtime executable not found: {runtime_path}")

    if not model.is_file():
      raise RuntimeError(f"Model file not found: {model_path}")

    with self._lock:
      if self._process is not None and self._process.poll() is None:
        raise RuntimeError("A model is already running")

      args: list[str] = [
        str(runtime),
        "-m", str(model),
        "--host", UPSTREAM_HOST,
        "--port", str(UPSTREAM_PORT),
        "-c", str(context_size),
        "-ngl", str(n_gpu_layers),
        "--no-webui",
      ]

      if rpc_peers:
        args.extend(["--rpc", ",".join(rpc_peers)])

      creation_flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
      self._process = subprocess.Popen(
        args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
        creationflags=creation_flags,
      )
      self._runtime_path = runtime_path
      self._model_path = model_path
      self._n_gpu_layers = n_gpu_layers
      self._context_size = context_size
      self._rpc_peers = list(rpc_peers)
      self._log = []
      self._ready = False

    threading.Thread(target=self._drain_output, daemon=True).start()
    threading.Thread(target=self._poll_ready, daemon=True).start()

  def stop(self) -> None:
    with self._lock:
      process = self._process
      self._process = None
      self._runtime_path = None
      self._model_path = None
      self._n_gpu_layers = 0
      self._context_size = 0
      self._rpc_peers = []
      self._ready = False

    if process is None:
      return

    if process.poll() is None:
      process.terminate()
      try:
        process.wait(timeout=SHUTDOWN_TIMEOUT_SECONDS)
      except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=SHUTDOWN_TIMEOUT_SECONDS)

  def _drain_output(self) -> None:
    process = self._process

    if process is None or process.stdout is None:
      return

    for line in process.stdout:
      stripped = line.rstrip()

      with self._lock:
        self._log.append(stripped)

        if len(self._log) > 400:
          self._log = self._log[-400:]

    with self._lock:
      self._ready = False

  def _poll_ready(self) -> None:
    process = self._process

    if process is None:
      return

    deadline = time.monotonic() + READY_TIMEOUT_SECONDS

    while time.monotonic() < deadline:
      if process.poll() is not None:
        return

      try:
        connection = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=2)
        connection.request("GET", "/health")
        response = connection.getresponse()
        response.read()
        connection.close()

        if response.status == 200:
          with self._lock:
            self._ready = True
          return
      except (ConnectionRefusedError, OSError):
        pass

      time.sleep(0.5)

  def proxy_chat(self, body: bytes) -> Generator[bytes, None, None]:
    if not self.is_ready():
      raise RuntimeError("Model is not ready")

    connection = http.client.HTTPConnection(UPSTREAM_HOST, UPSTREAM_PORT, timeout=300)
    connection.request(
      "POST",
      "/v1/chat/completions",
      body=body,
      headers={"Content-Type": "application/json"},
    )
    response = connection.getresponse()

    try:
      while True:
        chunk = response.read(PROXY_CHUNK_BYTES)

        if not chunk:
          break

        yield chunk
    finally:
      response.close()
      connection.close()


process = LlamaProcess()


def parse_load_payload(payload: dict[str, Any]) -> tuple[str, str, int, int, list[str]]:
  runtime_path = payload.get("runtimePath")
  model_path = payload.get("modelPath")
  n_gpu_layers = payload.get("nGpuLayers", 0)
  context_size = payload.get("contextSize", 4096)
  rpc_peers = payload.get("rpcPeers", [])

  if not isinstance(runtime_path, str) or not runtime_path:
    raise ValueError("runtimePath is required")

  if not isinstance(model_path, str) or not model_path:
    raise ValueError("modelPath is required")

  if not isinstance(n_gpu_layers, int) or n_gpu_layers < 0 or n_gpu_layers > 999:
    raise ValueError("nGpuLayers must be 0 to 999")

  if not isinstance(context_size, int) or context_size < 256 or context_size > 131072:
    raise ValueError("contextSize must be 256 to 131072")

  if not isinstance(rpc_peers, list) or not all(isinstance(peer, str) for peer in rpc_peers):
    raise ValueError("rpcPeers must be a list of strings")

  return runtime_path, model_path, n_gpu_layers, context_size, rpc_peers


def encode_state() -> bytes:
  return json.dumps({"ok": True, "data": process.state()}).encode("utf-8")

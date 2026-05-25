from __future__ import annotations

import ctypes
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from typing import TypedDict


class GpuInfo(TypedDict):
  name: str
  memory_mb: int
  driver: str


class HardwareSnapshot(TypedDict):
  platform: str
  python_version: str
  cpu_count: int | None
  memory_bytes: int | None
  storage_bytes: int | None
  storage_free_bytes: int | None
  gpus: list[GpuInfo]


class MemoryStatus(ctypes.Structure):
  _fields_ = [
    ("dwLength", ctypes.c_ulong),
    ("dwMemoryLoad", ctypes.c_ulong),
    ("ullTotalPhys", ctypes.c_ulonglong),
    ("ullAvailPhys", ctypes.c_ulonglong),
    ("ullTotalPageFile", ctypes.c_ulonglong),
    ("ullAvailPageFile", ctypes.c_ulonglong),
    ("ullTotalVirtual", ctypes.c_ulonglong),
    ("ullAvailVirtual", ctypes.c_ulonglong),
    ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
  ]


def total_memory_bytes() -> int | None:
  system = platform.system()

  if system == "Windows":
    status = MemoryStatus()
    status.dwLength = ctypes.sizeof(MemoryStatus)
    if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)) == 0:
      raise RuntimeError("GlobalMemoryStatusEx failed")
    return int(status.ullTotalPhys)

  if hasattr(os, "sysconf"):
    page_size = os.sysconf("SC_PAGE_SIZE")
    page_count = os.sysconf("SC_PHYS_PAGES")
    return int(page_size * page_count)

  return None


def storage_usage() -> tuple[int, int] | tuple[None, None]:
  root = Path.home().anchor or Path.cwd().anchor

  if not root:
    return None, None

  usage = shutil.disk_usage(root)
  return int(usage.total), int(usage.free)


def nvidia_gpus() -> list[GpuInfo]:
  binary = shutil.which("nvidia-smi")

  if binary is None:
    return []

  result = subprocess.run(
    [
      binary,
      "--query-gpu=name,memory.total,driver_version",
      "--format=csv,noheader,nounits",
    ],
    capture_output=True,
    text=True,
    check=False,
  )

  if result.returncode != 0:
    raise RuntimeError(result.stderr.strip() or "nvidia-smi failed")

  gpus: list[GpuInfo] = []

  for line in result.stdout.splitlines():
    name, memory_mb, driver = [value.strip() for value in line.split(",", maxsplit=2)]
    gpus.append({"name": name, "memory_mb": int(memory_mb), "driver": driver})

  return gpus


def snapshot() -> HardwareSnapshot:
  storage_bytes, storage_free_bytes = storage_usage()

  return {
    "platform": platform.platform(),
    "python_version": sys.version.split()[0],
    "cpu_count": os.cpu_count(),
    "memory_bytes": total_memory_bytes(),
    "storage_bytes": storage_bytes,
    "storage_free_bytes": storage_free_bytes,
    "gpus": nvidia_gpus(),
  }

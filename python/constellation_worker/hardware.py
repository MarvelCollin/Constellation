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
  memory_free_mb: int
  driver: str
  vendor: str


class HardwareSnapshot(TypedDict):
  platform: str
  python_version: str
  cpu_count: int | None
  memory_bytes: int | None
  memory_free_bytes: int | None
  storage_bytes: int | None
  storage_free_bytes: int | None
  gpu_vendor: str
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


def memory_status() -> tuple[int | None, int | None]:
  system = platform.system()

  if system == "Windows":
    status = MemoryStatus()
    status.dwLength = ctypes.sizeof(MemoryStatus)
    if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)) == 0:
      raise RuntimeError("GlobalMemoryStatusEx failed")
    return int(status.ullTotalPhys), int(status.ullAvailPhys)

  if hasattr(os, "sysconf"):
    page_size = os.sysconf("SC_PAGE_SIZE")
    total_pages = os.sysconf("SC_PHYS_PAGES")
    avail_pages = os.sysconf("SC_AVPHYS_PAGES") if "SC_AVPHYS_PAGES" in os.sysconf_names else total_pages
    return int(page_size * total_pages), int(page_size * avail_pages)

  return None, None


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
      "--query-gpu=name,memory.total,memory.free,driver_version",
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
    parts = [value.strip() for value in line.split(",", maxsplit=3)]
    name, memory_total, memory_free, driver = parts
    gpus.append({
      "name": name,
      "memory_mb": int(memory_total),
      "memory_free_mb": int(memory_free),
      "driver": driver,
      "vendor": "nvidia",
    })

  return gpus


def windows_video_controllers() -> list[str]:
  if platform.system() != "Windows":
    return []

  result = subprocess.run(
    [
      "powershell.exe",
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
    ],
    capture_output=True,
    text=True,
    check=False,
    creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
  )

  if result.returncode != 0:
    return []

  return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def classify_vendor(name: str) -> str:
  lowered = name.lower()

  if "nvidia" in lowered or "geforce" in lowered or "quadro" in lowered or "tesla" in lowered:
    return "nvidia"

  if "amd" in lowered or "radeon" in lowered:
    return "amd"

  if "intel" in lowered or "arc" in lowered:
    return "intel"

  if "apple" in lowered:
    return "apple"

  return "unknown"


def detect_gpus() -> tuple[list[GpuInfo], str]:
  gpus = nvidia_gpus()
  controllers = windows_video_controllers()
  detected_names = {gpu["name"].lower() for gpu in gpus}

  for name in controllers:
    if name.lower() in detected_names:
      continue
    gpus.append({
      "name": name,
      "memory_mb": 0,
      "memory_free_mb": 0,
      "driver": "",
      "vendor": classify_vendor(name),
    })

  vendor_priority = ["nvidia", "amd", "intel", "apple"]

  for vendor in vendor_priority:
    if any(gpu["vendor"] == vendor for gpu in gpus):
      return gpus, vendor

  return gpus, "none"


def snapshot() -> HardwareSnapshot:
  storage_bytes, storage_free_bytes = storage_usage()
  memory_bytes, memory_free_bytes = memory_status()
  gpus, gpu_vendor = detect_gpus()

  return {
    "platform": platform.platform(),
    "python_version": sys.version.split()[0],
    "cpu_count": os.cpu_count(),
    "memory_bytes": memory_bytes,
    "memory_free_bytes": memory_free_bytes,
    "storage_bytes": storage_bytes,
    "storage_free_bytes": storage_free_bytes,
    "gpu_vendor": gpu_vendor,
    "gpus": gpus,
  }

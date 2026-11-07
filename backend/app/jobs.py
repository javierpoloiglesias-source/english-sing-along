"""Cola mínima de trabajos en segundo plano (un hilo por trabajo)."""
from __future__ import annotations

import threading
import time
import traceback
import uuid
from typing import Callable

_jobs: dict[str, dict] = {}
_lock = threading.Lock()
# Whisper consume mucha CPU: se procesa un archivo cada vez.
_worker_sem = threading.Semaphore(1)


def create(kind: str, fn: Callable[[Callable[[float, str], None], threading.Event], object],
           exclusive: bool = True) -> dict:
    job_id = uuid.uuid4().hex[:12]
    cancel = threading.Event()
    job = {"id": job_id, "kind": kind, "status": "pending", "progress": 0.0,
           "message": "En cola…", "result": None, "error": None, "created": time.time()}
    with _lock:
        _jobs[job_id] = job
        job["_cancel"] = cancel

    def progress(p: float, msg: str):
        job["progress"] = round(max(0.0, min(1.0, p)), 3)
        job["message"] = msg

    def run():
        with (_worker_sem if exclusive else _nullctx()):
            if cancel.is_set():
                job["status"] = "cancelled"
                return
            job["status"] = "running"
            try:
                job["result"] = fn(progress, cancel)
                job["status"] = "done"
                job["progress"] = 1.0
                job["message"] = "Terminado"
            except Exception as e:  # noqa: BLE001
                job["status"] = "cancelled" if cancel.is_set() else "error"
                job["error"] = str(e)
                job["message"] = f"Error: {e}"
                traceback.print_exc()

    threading.Thread(target=run, daemon=True).start()
    return public(job)


class _nullctx:
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def public(job: dict) -> dict:
    return {k: v for k, v in job.items() if not k.startswith("_")}


def get(job_id: str) -> dict | None:
    j = _jobs.get(job_id)
    return public(j) if j else None


def cancel(job_id: str) -> bool:
    j = _jobs.get(job_id)
    if not j:
        return False
    j["_cancel"].set()
    return True

from __future__ import annotations

import os
import subprocess
import threading
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent


def _run_worker_once() -> None:
    cmd = ["npx", "ts-node", "src/jobs/worker.ts", "--once"]
    subprocess.run(
        cmd,
        cwd=str(REPO_ROOT),
        env=os.environ.copy(),
        shell=os.name == "nt",
    )


def start_background_worker(interval_sec: int = 15) -> threading.Thread:
    def loop() -> None:
        while True:
            try:
                _run_worker_once()
            except Exception as e:
                print(f"[job_worker] error: {e}")
            time.sleep(interval_sec)

    t = threading.Thread(target=loop, daemon=True, name="job-worker")
    t.start()
    return t

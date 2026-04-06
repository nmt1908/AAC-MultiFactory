import os
import json
import io
import asyncio
import time
import threading
import queue
from concurrent.futures import ThreadPoolExecutor
import shutil
import subprocess
import smtplib
import ssl
import cv2
import numpy as np
import torch
import requests
import random
from email.message import EmailMessage
from contextlib import asynccontextmanager
from typing import Any, Dict, List, Optional, Union
from datetime import datetime, timezone, timedelta
from urllib.parse import quote
import pymysql
from pymysql.cursors import DictCursor
from dotenv import load_dotenv
from fastapi import (
    FastAPI,
    HTTPException,
    UploadFile,
    File,
    Form,
    Body,
)
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
import uvicorn
from requests.auth import HTTPBasicAuth, HTTPDigestAuth
from PIL import Image
import imagehash
from ultralytics import YOLO
from ollama import AsyncClient
from transformers import GroundingDinoForObjectDetection, AutoProcessor

# Set FFMPEG timeout configs before cv2 use behavior
os.environ["OPENCV_FFMPEG_READ_TIMEOUT"] = "5000"
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
    "rtsp_transport;tcp|timeout;5000000|analyzer_max_duration;5000000|probesize;5000000"
)

# ==========================
# MAIL CONFIG (CH Factory)
# ==========================
MAIL_ENABLED = True
SMTP_SERVER = "60.249.33.238"
SMTP_PORT = 587
SMTP_USER = "VG-Reception@spg-sportsgear.com"
SMTP_PASS = "abcd@@1234"
ALERT_RECEIVER = "minhtam.nguyen@spg-sportsgear.com"

# Email Batching (Gộp Mail) - Đã chuyển sang Database (cctv_alert_queue)
_PENDING_ALERTS = []  # Hàng đợi trong bộ nhớ (Memory Queue)
_ALERTS_LOCK = threading.Lock()
_FLUSH_THREAD_STARTED = False  # Chỉ cho phép 1 luồng flush chạy trong 1 process


def send_alert_email(subject: str, body: str):
    if not MAIL_ENABLED:
        print("MAIL_ENABLED is False. Skipping email.")
        return
    try:
        msg = EmailMessage()
        msg.set_content(body)
        msg["Subject"] = subject
        msg["From"] = SMTP_USER
        msg["To"] = ALERT_RECEIVER

        # Dùng SMTP + starttls cho cổng 587
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.send_message(msg)
        print(f"✅ Email alert sent to {ALERT_RECEIVER}: {subject}")
    except Exception as e:
        print(f"❌ Failed to send email: {e}")


def flush_alerts_loop():
    """Luồng gộp mail: Gom thông báo từ bộ nhớ (_PENDING_ALERTS) vào DB và gửi tối đa 1 lần mỗi 30 phút."""
    print("🚀 Email Batching Thread (V4 - Surgical) started!")
    global _PENDING_ALERTS
    while True:
        try:
            # 1. Chuyển từ bộ nhớ sang Database Queue (Để đồng bộ giữa các process)
            alerts_in_mem = []
            with _ALERTS_LOCK:
                if _PENDING_ALERTS:
                    alerts_in_mem = list(_PENDING_ALERTS)
                    _PENDING_ALERTS.clear()

            if alerts_in_mem:
                conn = get_conn()
                try:
                    with conn.cursor() as cur:
                        for a in alerts_in_mem:
                            sql = """
                                INSERT INTO cctv_alert_queue (camera_code, ip, status, msg, is_reminder)
                                VALUES (%s, %s, %s, %s, %s)
                            """
                            cur.execute(
                                sql,
                                (
                                    a["camera_code"],
                                    a["ip"],
                                    a["status"],
                                    a["msg"],
                                    int(a["is_reminder"]),
                                ),
                            )
                    print(
                        f"📝 Moved {len(alerts_in_mem)} alerts from memory to DB queue."
                    )
                except Exception as e:
                    print(f"❌ Error moving alerts to DB: {e}")
                finally:
                    conn.close()

            # 2. Kiểm tra Cooldown 30 phút từ DB
            conn = get_conn()
            last_sent_at = None
            try:
                with conn.cursor() as cur:
                    cur.execute(
                        "SELECT s_value FROM system_settings WHERE s_key='last_alert_sent_at'"
                    )
                    row = cur.fetchone()
                    if row and row["s_value"]:
                        s_val = row["s_value"].replace("T", " ").split(".")[0]
                        last_sent_at = datetime.strptime(s_val, "%Y-%m-%d %H:%M:%S")
            finally:
                conn.close()

            now = datetime.now()
            if last_sent_at and (now - last_sent_at).total_seconds() < 1800:
                # Chưa qua 30 phút -> Nghỉ 1 phút rồi loop lại để gom tiếp
                time.sleep(60)
                continue

            # 3. Đã qua 30 phút -> Duy nhất 1 process thực hiện gửi mail
            conn = get_conn()
            try:
                with conn.cursor() as cur:
                    # Transactional: Khóa DB để chỉ 1 thằng được gửi
                    cur.execute("BEGIN")
                    cur.execute("SELECT * FROM cctv_alert_queue FOR UPDATE")
                    alerts_to_send = cur.fetchall()

                    if alerts_to_send:
                        # 1) Khử trùng lặp camera trong cùng một lô (Deduplicate)
                        unique_alerts = {}
                        for a in alerts_to_send:
                            code = a["camera_code"]
                            if code not in unique_alerts:
                                unique_alerts[code] = a

                        alerts_dedup = list(unique_alerts.values())
                        count = len(alerts_dedup)
                        subject = f"⚠️ [CCTV] Cảnh báo lỗi {count} camera / {count} cameras unstable"

                        # 2) Gộp nhóm theo mã lỗi
                        groups = {}
                        for a in alerts_dedup:
                            key = a["msg"]
                            if key not in groups:
                                groups[key] = []
                            groups[key].append(a)

                        # Định dạng email: Danh sách ở trên, chi tiết ở dưới
                        body = f"Thời gian báo cáo / Report Time: {now.strftime('%Y-%m-%d %H:%M:%S')}\n"
                        body += f"Tổng số camera báo lỗi / Total alerts: {count}\n\n"

                        body += "DANH SÁCH CAMERA LỖI / LIST OF UNSTABLE CAMERAS:\n"
                        body += "-" * 50 + "\n"
                        for a in alerts_dedup:
                            body += f"  - {a['camera_code']}  (IP: {a['ip']})\n"
                        body += "-" * 50 + "\n\n"

                        body += "CHI TIẾT LỖI / TECHNICAL DETAILS:\n"
                        for error_msg, cams_in_group in groups.items():
                            is_rem = any(a.get("is_reminder") for a in cams_in_group)
                            prefix = "[REMINDER] " if is_rem else ""
                            cnames = ", ".join(
                                [a["camera_code"] for a in cams_in_group]
                            )
                            body += (
                                f"Lỗi / Error: {error_msg}\n"
                                f"Nhóm camera / Group: {cnames}\n"
                                f"Tình trạng / Status: {cams_in_group[0]['status'].upper()}\n"
                                + "." * 30
                                + "\n"
                            )

                        send_alert_email(subject, body)

                        # Cập nhật thời điểm gửi cuối và xóa queue DB
                        cur.execute(
                            "UPDATE system_settings SET s_value=%s WHERE s_key='last_alert_sent_at'",
                            (now.strftime("%Y-%m-%d %H:%M:%S"),),
                        )
                        cur.execute("DELETE FROM cctv_alert_queue")

                    cur.execute("COMMIT")
            except Exception as e:
                print(f"❌ Error in flush transaction: {e}")
            finally:
                conn.close()

            time.sleep(60)
        except Exception as e:
            print(f"❌ Global error in flush_alerts_loop: {e}")
            time.sleep(10)


def capture_single_ffmpeg(cam: Dict[str, Any], timeout: float = 4.5):
    code = (cam.get("code") or "unknown").strip().replace("/", "_")
    ip = cam.get("ip")
    user = cam.get("username") or "it"
    pw = cam.get("password") or "Chihung@12"
    url_suffix = cam.get("cctv_url") or "live.sdp"

    u_enc, p_enc = quote(user, safe=""), quote(pw, safe="")
    rtsp_url = f"rtsp://{u_enc}:{p_enc}@{ip}:554/{url_suffix}"

    dummy_path = f"/tmp/check_{code}.jpg"
    cmd = [
        "ffmpeg",
        "-y",
        "-rtsp_transport",
        "tcp",
        "-i",
        rtsp_url,
        "-vframes",
        "1",
        "-q:v",
        "2",
        "-f",
        "image2",
        dummy_path,
    ]

    try:
        res = subprocess.run(
            cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=timeout
        )
        if res.returncode == 0:
            return "online", "OK"
        err_msg = res.stderr.decode("utf-8", errors="ignore").strip()
        last_line = err_msg.split("\n")[-1] if err_msg else "Unknown Error"
        if "401 Unauthorized" in last_line:
            return "offline", "Auth Error (401)"
        return "offline", last_line[:100]
    except subprocess.TimeoutExpired:
        return "warning", f"Timeout ({timeout}s)"
    except Exception as e:
        return "offline", str(e)[:100]


def check_camera_job(cam):
    try:
        status, msg = capture_single_ffmpeg(cam)

        if status == "online":
            new_timeouts = 0
            new_status = "online"
            new_alert_muted = cam.get("alert_muted") or 0
        else:
            new_timeouts = (cam.get("consecutive_timeouts") or 0) + 1
            if new_timeouts >= 12:
                new_status = "offline" if "Auth Error" in msg else "warning"
            else:
                new_status = cam.get("cctv_status") or "online"
            new_alert_muted = cam.get("alert_muted") or 0

        # Cập nhật kết quả vào DB ngay lập tức cho từng cam
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                update_sql = """
                    UPDATE cctv_tbl 
                    SET cctv_status = %s, consecutive_timeouts = %s, alert_muted = %s, updated_at = CURRENT_TIMESTAMP 
                    WHERE code = %s
                """
                cur.execute(
                    update_sql,
                    (new_status, new_timeouts, new_alert_muted, cam["code"]),
                )

                # Gửi mail nếu đạt ngưỡng (Lần đầu ở 1 phút = 12 check, sau đó nhắc lại mỗi 30 phút = 360 check)
                is_first_alert = new_timeouts == 12
                is_reminder = new_timeouts > 12 and (new_timeouts - 12) % 360 == 0

                if (is_first_alert or is_reminder) and new_alert_muted == 0:
                    # Thêm vào hàng đợi gộp mail (Batching)
                    alert_info = {
                        "camera_code": cam["code"],
                        "ip": cam["ip"],
                        "status": new_status,
                        "msg": msg,
                        "is_reminder": is_reminder,
                    }
                    with _ALERTS_LOCK:
                        _PENDING_ALERTS.append(alert_info)
                    print(f"📝 Alert for {cam['code']} added to batch queue.")
        finally:
            conn.close()
    except Exception as e:
        print(f"❌ Error checking camera {cam.get('code')}: {e}")


def background_health_monitor():
    """Luồng chạy ngầm để kiểm tra lỗi liên tục và gửi email."""
    print("🚀 Camera Health Monitor started!")

    # 1) Reset tất cả trạng thái về online khi khởi động luồng
    try:
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                print(
                    "[STARTUP] Resetting all camera statuses to online & timeouts=0..."
                )
                cur.execute(
                    "UPDATE cctv_tbl SET cctv_status='online', consecutive_timeouts=0"
                )
        finally:
            conn.close()
    except Exception as e:
        print(f"[STARTUP] Error resetting camera health statuses: {e}")
    while True:
        try:
            conn = get_conn()
            try:
                with conn.cursor() as cur:
                    cur.execute("SELECT * FROM cctv_tbl WHERE is_monitored = 1")
                    monitored_cams = cur.fetchall()
            finally:
                conn.close()

            if monitored_cams:
                with ThreadPoolExecutor(max_workers=15) as executor:
                    # Parallel camera health check
                    executor.map(check_camera_job, monitored_cams)

            # Use 5s sleep to achieve "12 checks = 1 minute"
            time.sleep(5)
        except Exception as e:
            print(f"❌ Error in background_health_monitor: {e}")
            time.sleep(10)


# ==========================
# LOAD .env
# ==========================
load_dotenv()

# Cấu hình cứng cho nhà máy CH (Bỏ qua .env để tránh load nhầm VG)
DB_HOST = "localhost"
DB_PORT = 3306
DB_NAME = "avg_db"
DB_USER = "root"
DB_PASS = "abcd@1234"

API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8001"))
SNAP_USER = "it"
SNAP_PASS = "Chihung@12"
OLLAMA_URL = "http://localhost:11434"
VISION_MODEL = os.getenv("CCTV_VISION_MODEL", "llava:latest")
DINO_MODEL_NAME = "IDEA-Research/grounding-dino-tiny"
DINO_LOCAL_PATH = "./models/IDEA-Research/grounding-dino-tiny"
# YOLO models
YOLO_PERSON_MODEL_PATH = os.getenv("YOLO_PERSON_MODEL_PATH", "PersonModel.pt")
YOLO_FIRE_MODEL_PATH = os.getenv("YOLO_FIRE_MODEL_PATH", "FireModel.pt")

YOLO_PERSON_MODEL = YOLO(YOLO_PERSON_MODEL_PATH)
YOLO_FIRE_MODEL = YOLO(YOLO_FIRE_MODEL_PATH)
YOLO_LOCK = threading.Lock()
SNAPSHOT_CAPTURE_MAX_CONCURRENT = int(
    os.getenv("SNAPSHOT_CAPTURE_MAX_CONCURRENT", "200")
)
SNAPSHOT_CAPTURE_SEMAPHORE = asyncio.Semaphore(SNAPSHOT_CAPTURE_MAX_CONCURRENT)

SNAPSHOT_FETCH_TIMEOUT_SEC = float(os.getenv("SNAPSHOT_FETCH_TIMEOUT_SEC", "5"))
SNAPSHOT_CYCLE_TIMEOUT_SEC = float(
    os.getenv("SNAPSHOT_CYCLE_TIMEOUT_SEC", "12.0")
)  # timeout toàn vòng


def warmup_yolo_models(imgsz: int = 640, n: int = 10):
    """
    Warm-up YOLO models to avoid first-inference latency.
    """
    if not torch.cuda.is_available():
        print("[YOLO] Warmup skipped (CUDA not available)")
        return

    dummy = np.zeros((imgsz, imgsz, 3), dtype=np.uint8)

    # Ultralytics: dùng .predict() để ổn định hơn
    print(f"[YOLO] Warming up PersonModel: n={n}, imgsz={imgsz}")
    with YOLO_LOCK:
        for _ in range(n):
            _ = YOLO_PERSON_MODEL.predict(source=[dummy], imgsz=imgsz, verbose=False)

        print(f"[YOLO] Warming up FireModel: n={n}, imgsz={imgsz}")
        for _ in range(n):
            _ = YOLO_FIRE_MODEL.predict(source=[dummy], imgsz=imgsz, verbose=False)

    # Optional sync để chắc chắn warmup xong
    torch.cuda.synchronize()
    print("[YOLO] Warmup done ✅")


# Try to use GPU, fallback to CPU if not available
try:
    import torch

    if torch.cuda.is_available():
        YOLO_PERSON_MODEL.to("cuda")
        YOLO_FIRE_MODEL.to("cuda")
        print(f"[YOLO] PersonModel loaded on device: cuda:0 (GPU)")
        print(f"[YOLO] FireModel loaded on device: cuda:0 (GPU)")
    else:
        print(f"[YOLO] CUDA not available, using CPU")
        print(f"[YOLO] PersonModel loaded on device: cpu")
        print(f"[YOLO] FireModel loaded on device: cpu")
except Exception as e:
    print(f"[YOLO] Could not load on GPU: {e}, using CPU")
    print(f"[YOLO] PersonModel loaded on device: cpu")
    print(f"[YOLO] FireModel loaded on device: cpu")


# Laravel warning endpoint (Point to local FastAPI)
WARNING_API_URL = os.getenv(
    "WARNING_API_URL",
    f"http://localhost:{API_PORT}/api/cctv/insertWarningFromAAC",
)

# CORS: mở hết cho dễ test
CORS_ORIGINS = ["*"]

# TIME_LOOP_ONE_CYCLE: Thời gian cho một vòng lấy snapshot tất cả camera (giây)
# Hệ thống sẽ đợi đủ TIME_LOOP_ONE_CYCLE giây giữa các vòng xử lý
TIME_LOOP_ONE_CYCLE = int(os.getenv("TIME_LOOP_ONE_CYCLE", "5"))

# Thời gian nghỉ giữa 2 vòng loop tổng (deprecated - sử dụng TIME_LOOP_ONE_CYCLE)
# BACKGROUND_LOOP_INTERVAL_SEC = int(os.getenv("AI_LOOP_INTERVAL_SEC", "1"))

# ==== RTX 4090 Optimized Settings ====
# YOLO xử lý rất nhanh trên RTX 4090 → tăng parallel cameras
MAX_PARALLEL_CAMERAS = int(os.getenv("MAX_PARALLEL_CAMERAS", "170"))  # Tăng từ 20 → 100
PARALLEL_CAMERA_SEMAPHORE = asyncio.Semaphore(MAX_PARALLEL_CAMERAS)

# Directory for snapshots
SNAPSHOT_DIR = "snapshot"
os.makedirs(SNAPSHOT_DIR, exist_ok=True)

# Max concurrent cameras (old, for compatibility)
# MAX_CONCURRENT_CAMERAS = int(os.getenv("MAX_CONCURRENT_CAMERAS", "270"))
# CAMERA_SEMAPHORE = asyncio.Semaphore(MAX_CONCURRENT_CAMERAS)


# Ollama concurrency control - Single instance
OLLAMA_MAX_CONCURRENT = int(os.getenv("OLLAMA_MAX_CONCURRENT", "10"))  # Tăng từ 3 → 10
OLLAMA_SEMAPHORE = asyncio.Semaphore(OLLAMA_MAX_CONCURRENT)

# Ollama AsyncClient - single instance
OLLAMA_CLIENT: Optional[AsyncClient] = None

# ===== Demo camera: Dùng ảnh tĩnh thay vì snapshot thật =====
DEMO_CAMERA_CODE = os.getenv("DEMO_CAMERA_CODE", "")
DEMO_CAMERA_FOLDER = os.getenv("DEMO_CAMERA_FOLDER", "demo_images2")

# ===== NEW: Queue-based snapshot management =====
# Snapshot queue management
SNAPSHOT_QUEUE_MAX = 500  # Pause snapshot capture at this threshold
# SNAPSHOT_QUEUE_RESUME_THRESHOLD = 200  # Resume snapshot capture when below this
SNAPSHOT_QUEUE_PAUSE_DURATION = 15  # seconds to wait when paused

# Qwen processing queue (200 concurrent slots max)
QWEN_MAX_CONCURRENT = 200  # Max concurrent Qwen/Fire detections
# Camera config cache removed - no longer using interval checking in producer
# Consumer processes files in chronological order which naturally maintains intervals

# ===== pHash Filter Configuration =====
# Perceptual hash for frame similarity detection (pre-YOLO filter)
PHASH_ENABLED = os.getenv("PHASH_ENABLED", "true").lower() == "true"
PHASH_THRESHOLD = int(os.getenv("PHASH_THRESHOLD", "20"))  # Hamming distance (0-64)
# Recommended: 0-12 = very similar (static frames with timestamp tick), 13+ = different

# Global cache: {camera_code: imagehash.ImageHash}
_CAMERA_HASH_CACHE: Dict[str, Any] = {}


DINO_DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
DINO_MODEL = None
DINO_PROCESSOR = None

DINO_MAX_CONCURRENT = int(os.getenv("DINO_MAX_CONCURRENT", "16"))
DINO_SEMAPHORE = asyncio.Semaphore(DINO_MAX_CONCURRENT)


def init_dino_once():
    global DINO_MODEL, DINO_PROCESSOR
    if DINO_MODEL is not None and DINO_PROCESSOR is not None:
        return

    os.makedirs(os.path.dirname(DINO_LOCAL_PATH), exist_ok=True)

    # Thử load local trước, nếu lỗi thì xóa và tải lại
    if os.path.exists(DINO_LOCAL_PATH):
        try:
            print(f"[DINO] Loading from local: {DINO_LOCAL_PATH}")
            DINO_MODEL = GroundingDinoForObjectDetection.from_pretrained(
                DINO_LOCAL_PATH
            )
            DINO_PROCESSOR = AutoProcessor.from_pretrained(DINO_LOCAL_PATH)
        except Exception as e:
            print(
                f"[DINO] Error loading local model: {e}. Wiping and re-downloading..."
            )
            if os.path.isdir(DINO_LOCAL_PATH):
                shutil.rmtree(DINO_LOCAL_PATH)
            DINO_MODEL = None
            DINO_PROCESSOR = None

    if DINO_MODEL is None or DINO_PROCESSOR is None:
        print(f"[DINO] Downloading fresh model: {DINO_MODEL_NAME}")
        DINO_MODEL = GroundingDinoForObjectDetection.from_pretrained(DINO_MODEL_NAME)
        DINO_PROCESSOR = AutoProcessor.from_pretrained(DINO_MODEL_NAME)
        print(f"[DINO] Saving fresh model to {DINO_LOCAL_PATH}")
        DINO_MODEL.save_pretrained(DINO_LOCAL_PATH)
        DINO_PROCESSOR.save_pretrained(DINO_LOCAL_PATH)

    DINO_MODEL.to(DINO_DEVICE)
    DINO_MODEL.eval()
    print(f"[DINO] Ready on {DINO_DEVICE}")


# ==========================
# DB helper
# ==========================
def get_conn():
    """
    Kết nối database avg_db cho nhà máy CH (10.1.0.11)
    """
    return pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASS,
        database=DB_NAME,
        cursorclass=DictCursor,
        autocommit=True,
    )


def get_conn_ch():
    """Alias cho get_conn dùng database mặc định (CH)"""
    return get_conn()


# Camera config cache
CONFIGURED_CAMERAS_CACHE: List[Dict[str, Any]] = []
CAMERA_CACHE_LAST_REFRESH = 0
CAMERA_CACHE_REFRESH_INTERVAL = 60  # Refresh every 60 seconds


def is_jpeg_bytes(b: bytes) -> bool:
    return (
        isinstance(b, (bytes, bytearray))
        and len(b) >= 3
        and b[0] == 0xFF
        and b[1] == 0xD8
        and b[2] == 0xFF
    )


def short_head(b: bytes, n: int = 160) -> bytes:
    if not b:
        return b""
    return b[:n]


def get_working_snap_cameras() -> List[Dict[str, Any]]:
    """
    Lấy danh sách camera có snapshot URL + ai_config.
    Cache results for 60s to avoid querying unconfigured cameras every loop.
    """
    global CONFIGURED_CAMERAS_CACHE, CAMERA_CACHE_LAST_REFRESH

    current_time = time.time()

    # Return cached data if still fresh
    if (current_time - CAMERA_CACHE_LAST_REFRESH) < CAMERA_CACHE_REFRESH_INTERVAL:
        if CONFIGURED_CAMERAS_CACHE:
            return CONFIGURED_CAMERAS_CACHE

    # Refresh cache
    sql = """
        SELECT code, ip, username, password, ai_config, cctv_url, threshold
        FROM cctv_tbl
        WHERE ip IS NOT NULL
          AND ip != ''
          AND ai_config IS NOT NULL
          AND ai_config != ''
          AND ai_config != 'null'
    """

    conn = get_conn()  # 👈 Dùng DB mặc định (CH)
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall()
    finally:
        conn.close()

    cameras = []
    for row in rows:
        code = row.get("code")
        ip = row.get("ip")
        ai_config_str = row.get("ai_config")

        if not ai_config_str:
            continue

        try:
            ai_config = json.loads(ai_config_str)
            threshold_val = row.get("threshold")
            if threshold_val is not None:
                ai_config["threshold"] = threshold_val
        except Exception:
            continue

        # Only include cameras with at least one action enabled
        actions = ai_config.get("actions", {})
        if not any(actions.values()):
            continue

        cameras.append(
            {
                "code": code,
                "ip": ip,
                "username": row.get("username") or SNAP_USER,
                "password": row.get("password") or SNAP_PASS,
                "ai_config": ai_config,
                "cctv_url": row.get("cctv_url") or "live.sdp",
            }
        )

    # Update cache
    CONFIGURED_CAMERAS_CACHE = cameras
    CAMERA_CACHE_LAST_REFRESH = current_time

    if cameras:
        print(f"[CACHE] Refreshed: {len(cameras)} configured cameras")

    return cameras


def get_cameras() -> List[Dict[str, Any]]:
    """
    Lấy danh sách camera từ cctv_tbl để cấu hình AI (UI).
    Chỉ lấy camera capture_method = 'snap'.
    """
    sql = """
        SELECT id, code, ip, cctv_url, ai_config, threshold
        FROM cctv_tbl
        ORDER BY code ASC
    """

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall()
    finally:
        conn.close()

    result = []
    for r in rows:
        cfg = None
        raw = r.get("ai_config")
        if raw:
            try:
                cfg = json.loads(raw)
                threshold_val = r.get("threshold")
                if threshold_val is not None:
                    cfg["threshold"] = threshold_val
            except Exception:
                cfg = None

        result.append(
            {
                "id": r["id"],
                "code": r["code"],
                "ip": r["ip"],
                "cctv_url": r.get("cctv_url"),
                "snapshot_url": None,
                "ai_config": cfg,
            }
        )
    return result


def should_skip_snapshot_phash_img(
    img: Image.Image, camera_code: str
) -> tuple[bool, int]:
    """
    pHash filter chạy trên PIL Image đã decode sẵn (NO re-open file).
    """
    global _CAMERA_HASH_CACHE

    if not PHASH_ENABLED:
        return False, -1

    # Never skip demo camera
    if (
        DEMO_CAMERA_CODE
        and camera_code.strip().upper() == DEMO_CAMERA_CODE.strip().upper()
    ):
        return False, -2

    try:
        current_hash = imagehash.phash(img)
        previous_hash = _CAMERA_HASH_CACHE.get(camera_code)

        if previous_hash is None:
            _CAMERA_HASH_CACHE[camera_code] = current_hash
            return False, 0

        distance = current_hash - previous_hash

        if distance < PHASH_THRESHOLD:
            return True, distance  # skip (do not update cache)
        else:
            _CAMERA_HASH_CACHE[camera_code] = current_hash
            return False, distance

    except Exception as e:
        print(f"[pHash] Error for {camera_code}: {e}")
        return False, -1


def get_ai_config_by_code(camera_code: str) -> Optional[Dict[str, Any]]:
    """
    Lấy riêng ai_config của 1 camera (dùng cho endpoint test detect).
    """
    sql = """
        SELECT ai_config, threshold
        FROM cctv_tbl
        WHERE code = %s
        LIMIT 1
    """
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (camera_code,))
            row = cur.fetchone()
    finally:
        conn.close()

    if not row or not row.get("ai_config"):
        return None

    try:
        cfg = json.loads(row["ai_config"])
        threshold_val = row.get("threshold")
        if threshold_val is not None:
            cfg["threshold"] = threshold_val
        return cfg
    except Exception:
        return None


def save_ai_config(
    camera_code: str,
    actions: Dict[str, bool],
    interval_seconds: int,
    regions: Dict[str, Any],
    max_people_allowed: Optional[int] = None,
):
    """
    Lưu cấu hình AI cho camera:
      - actions: count_people / detect_climb / detect_fire
      - interval_seconds: chu kỳ chạy
      - regions: people / climb / fire polygons
      - max_people_allowed: ngưỡng số người tối đa được phép trong people region
    """
    cfg: Dict[str, Any] = {
        "actions": actions,
        "interval_seconds": interval_seconds,
        "regions": regions or {},
    }

    if max_people_allowed is not None:
        cfg["max_people_allowed"] = int(max_people_allowed)

    payload = json.dumps(cfg, ensure_ascii=False)

    sql = """
        UPDATE cctv_tbl
        SET ai_config = %s
        WHERE code = %s
        LIMIT 1
    """

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (payload, camera_code))
    finally:
        conn.close()


# ==========================
# Helper: polygon -> bbox
# ==========================
def polygon_to_bbox(
    points: List[Dict[str, float]], width: int, height: int, pad: int = 4
):
    """
    points: list [{x:0..1, y:0..1}]
    Trả về (left, top, right, bottom) pixel, có padding.
    """
    if not points:
        return 0, 0, width, height

    xs = [max(0.0, min(1.0, float(p["x"]))) for p in points]
    ys = [max(0.0, min(1.0, float(p["y"]))) for p in points]

    min_x = int(min(xs) * width)
    max_x = int(max(xs) * width)
    min_y = int(min(ys) * height)
    max_y = int(max(ys) * height)

    min_x = max(0, min_x - pad)
    min_y = max(0, min_y - pad)
    max_x = min(width, max_x + pad)
    max_y = min(height, max_y + pad)

    if max_x <= min_x or max_y <= min_y:
        return 0, 0, width, height

    return min_x, min_y, max_x, max_y


# ==========================
# Geometry helpers: line vs rect (for fenceline)
# ==========================
def point_in_rect(px, py, rx1, ry1, rx2, ry2):
    return rx1 <= px <= rx2 and ry1 <= py <= ry2


def orientation(ax, ay, bx, by, cx, cy):
    return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)


def segments_intersect(x1, y1, x2, y2, x3, y3, x4, y4):
    o1 = orientation(x1, y1, x2, y2, x3, y3)
    o2 = orientation(x1, y1, x2, y2, x4, y4)
    o3 = orientation(x3, y3, x4, y4, x1, y1)
    o4 = orientation(x3, y3, x4, y4, x2, y2)

    # General case
    if o1 * o2 < 0 and o3 * o4 < 0:
        return True

    def on_segment(ax, ay, bx, by, cx, cy):
        return min(ax, bx) <= cx <= max(ax, bx) and min(ay, by) <= cy <= max(ay, by)

    # Collinear special cases
    if o1 == 0 and on_segment(x1, y1, x2, y2, x3, y3):
        return True
    if o2 == 0 and on_segment(x1, y1, x2, y2, x4, y4):
        return True
    if o3 == 0 and on_segment(x3, y3, x4, y4, x1, y1):
        return True
    if o4 == 0 and on_segment(x3, y3, x4, y4, x2, y2):
        return True

    return False


def normalize_ai_config(raw_cfg) -> Optional[Dict[str, Any]]:
    """
    Normalize ai_config:
    - None/''/'null' -> None
    - dict -> dict
    - str/bytes -> json.loads
    """
    if raw_cfg is None:
        return None

    if isinstance(raw_cfg, dict):
        return raw_cfg

    if isinstance(raw_cfg, (bytes, bytearray)):
        raw_cfg = raw_cfg.decode("utf-8", errors="ignore")

    if isinstance(raw_cfg, str):
        s = raw_cfg.strip()
        if not s or s.lower() == "null":
            return None
        return json.loads(s)

    # unknown type
    return None


def line_intersects_rect(line_x1, line_y1, line_x2, line_y2, rx1, ry1, rx2, ry2):
    # Normalize rect
    if rx1 > rx2:
        rx1, rx2 = rx2, rx1
    if ry1 > ry2:
        ry1, ry2 = ry2, ry1

    # Line endpoint inside rect
    if point_in_rect(line_x1, line_y1, rx1, ry1, rx2, ry2) or point_in_rect(
        line_x2, line_y2, rx1, ry1, rx2, ry2
    ):
        return True

    # Intersect 4 edges
    edges = [
        (rx1, ry1, rx2, ry1),  # top
        (rx2, ry1, rx2, ry2),  # right
        (rx2, ry2, rx1, ry2),  # bottom
        (rx1, ry2, rx1, ry1),  # left
    ]
    for ex1, ey1, ex2, ey2 in edges:
        if segments_intersect(line_x1, line_y1, line_x2, line_y2, ex1, ey1, ex2, ey2):
            return True

    return False


def get_fenceline_from_ai_config(
    ai_config: Dict[str, Any], frame_width: int, frame_height: int
):
    """
    Lấy fenceline từ regions['climb'][0]['points'] (2 points normalized 0..1).
    Trả về tuple pixel (x1,y1,x2,y2) hoặc None.
    """
    try:
        regions = ai_config.get("regions") or {}
        climb_regions = regions.get("climb") or []
        if not climb_regions:
            return None

        pts = climb_regions[0].get("points") or []
        if len(pts) < 2:
            return None

        p1, p2 = pts[0], pts[1]
        x1 = int(float(p1["x"]) * frame_width)
        y1 = int(float(p1["y"]) * frame_height)
        x2 = int(float(p2["x"]) * frame_width)
        y2 = int(float(p2["y"]) * frame_height)

        return (x1, y1, x2, y2)
    except Exception:
        return None


# ==========================
# YOLO helper – count people
# ==========================
def detect_people_yolo(image: Image.Image) -> Dict[str, Any]:
    """
    Detect người bằng YOLO.
    Trả về dict:
      {
        "people_count": int,
        "avg_confidence": float
      }
    """
    with YOLO_LOCK:
        if torch.cuda.is_available():
            results = YOLO_PERSON_MODEL(
                image, device="cuda:0", imgsz=640, verbose=False
            )
        else:
            results = YOLO_PERSON_MODEL(image, imgsz=640, verbose=False)
    det = results[0]

    count = 0
    confs: List[float] = []

    if det.boxes is not None:
        for cls_id, conf in zip(det.boxes.cls, det.boxes.conf):
            if int(cls_id) == 0:  # 0 = person
                count += 1
                confs.append(float(conf))

    avg_conf = float(sum(confs) / len(confs)) if confs else 0.0
    return {"people_count": count, "avg_confidence": avg_conf}


def detect_fire_yolo(
    image: Image.Image, confidence_threshold: float = 0.1
) -> Dict[str, Any]:
    """
    Detect lửa và khói bằng YOLO FireModel.

    Args:
        image: PIL Image
        confidence_threshold: Ngưỡng confidence (mặc định 0.1)

    Returns:
        {
            "has_fire_smoke": bool,     # True nếu detect fire hoặc smoke >= threshold
            "detections": List[dict],   # List các detection
            "max_confidence": float     # Confidence cao nhất
        }
    """
    with YOLO_LOCK:
        if torch.cuda.is_available():
            results = YOLO_FIRE_MODEL(image, device="cuda:0", imgsz=640, verbose=False)
        else:
            results = YOLO_FIRE_MODEL(image, imgsz=640, verbose=False)
    det = results[0]

    detections = []
    max_conf = 0.0

    if det.boxes is not None:
        for cls_id, conf, box_coord in zip(
            det.boxes.cls, det.boxes.conf, det.boxes.xyxy
        ):
            conf_val = float(conf)

            # Chỉ quan tâm detection có confidence >= threshold
            if conf_val >= confidence_threshold:
                class_name = "unknown"
                class_id = int(cls_id)
                x1, y1, x2, y2 = [float(c) for c in box_coord]

                # Map class ID to name (adjust based on your FireModel)
                if class_id == 0:
                    class_name = "fire"
                elif class_id == 1:
                    class_name = "smoke"

                detections.append(
                    {
                        "class_id": class_id,
                        "class_name": class_name,
                        "confidence": conf_val,
                        "x1": x1,
                        "y1": y1,
                        "x2": x2,
                        "y2": y2,
                    }
                )

                max_conf = max(max_conf, conf_val)

    has_fire_smoke = len(detections) > 0

    return {
        "has_fire_smoke": has_fire_smoke,
        "detections": detections,
        "max_confidence": max_conf,
    }


# def rects_intersect(a, b) -> bool:
#     """Check overlap between 2 rects (x1,y1,x2,y2)."""
#     ax1, ay1, ax2, ay2 = a
#     bx1, by1, bx2, by2 = b
#     return not (ax2 < bx1 or bx2 < ax1 or ay2 < by1 or by2 < ay1)


def detect_people_stats_and_boxes_yolo(
    image: Image.Image,
    confidence_threshold: float = 0.25,
) -> Dict[str, Any]:
    """
    Run PersonModel ONE-SHOT:
      - count persons (for crowd)
      - return filtered boxes (for fenceline intersection)
    Notes:
      - crowd count: count ALL person detections (cls==0) (không filter theo threshold)
      - boxes: filter theo confidence_threshold để giảm noise
    """
    with YOLO_LOCK:
        if torch.cuda.is_available():
            results = YOLO_PERSON_MODEL(
                image, device="cuda:0", imgsz=640, verbose=False
            )
        else:
            results = YOLO_PERSON_MODEL(image, imgsz=640, verbose=False)
    det = results[0]

    people_count_all = 0
    confs_all: List[float] = []

    boxes: List[Dict[str, Any]] = []
    max_conf = 0.0

    if det.boxes is not None:
        for xyxy, cls_id, conf in zip(det.boxes.xyxy, det.boxes.cls, det.boxes.conf):
            if int(cls_id) != 0:
                continue

            conf_val = float(conf)
            people_count_all += 1
            confs_all.append(conf_val)

            if conf_val < confidence_threshold:
                continue

            x1, y1, x2, y2 = [int(v) for v in xyxy.tolist()]
            boxes.append(
                {"x1": x1, "y1": y1, "x2": x2, "y2": y2, "confidence": conf_val}
            )
            max_conf = max(max_conf, conf_val)

    avg_conf = float(sum(confs_all) / len(confs_all)) if confs_all else 0.0

    return {
        "people_count": people_count_all,
        "avg_confidence": avg_conf,
        "boxes": boxes,
        "max_confidence": max_conf,
    }


# ==========================
# Ollama helpers
# ==========================
GLOBAL_PROMPT = (
    "You are an AI assistant analyzing CCTV images for security and safety.\n"
    "You must ALWAYS return a single valid JSON object and nothing else.\n"
)

SUB_PROMPTS = {
    "count_people": (
        "Task: Carefully count how many DISTINCT human beings are visible "
        "in the ENTIRE image (full frame), including:\n"
        "- People who are small or far away in the background.\n"
        "- People who are partially occluded (e.g. behind objects, climbing a fence).\n"
        "- People at the very edges of the image.\n"
        "Do NOT ignore a person just because they are small, far, or partly hidden.\n"
        "First, visually check ALL corners of the frame.\n"
        "Return JSON with this schema exactly:\n"
        "{\n"
        '  "people_count": <int>,\n'
        '  "confidence": <float between 0 and 1>,\n'
        '  "explanation": "short English description of where each person is, '
        "e.g. '1 man climbing fence on the right, 3 people running in the middle, "
        "2 people in the background street, ...'\n"
        "}\n"
    ),
    "detect_climb": (
        "Task: Check if there is anyone climbing OR attempting to climb OR "
        "leaning dangerously over a fence, wall or restricted barrier in this region.\n"
        "\n"
        "For this task you MUST treat all of the following as has_climbing = true:\n"
        "- A person already on top of the fence or barrier.\n"
        "- A person with hands on the top edge and the body clearly leaning over the barrier.\n"
        "- A person whose feet may still touch the ground but posture clearly indicates an attempt to climb.\n"
        "\n"
        "Only return has_climbing = false when there is clearly no person interacting with the fence/barrier.\n"
        "\n"
        "Return JSON with this schema exactly:\n"
        "{\n"
        '  "has_climbing": true | false,\n'
        '  "confidence": <float between 0 and 1>,\n'
        '  "description": "short English description about what you see, '
        'including how the person is interacting with the barrier"\n'
        "}\n"
    ),
    "detect_fire": (
        "Task: Determine if there is FIRE or HEAVY SMOKE visible in this image.\n"
        "\n"
        "IMPORTANT: You MUST return has_fire = true if you see ANY of the following:\n"
        "- Visible flames (orange, red, or yellow fire)\n"
        "- Bright orange/red glow indicating active fire\n"
        "- Heavy dark smoke billowing (indicating a fire source)\n"
        "- Any clear signs of combustion or burning\n"
        "\n"
        "Only return has_fire = false when the image clearly shows NO fire, NO flames, and NO heavy smoke.\n"
        "\n"
        "DO NOT return confidence field. Only return:\n"
        "{\n"
        '  "has_fire": true | false,\n'
        '  "description": "short English description of what you see (fire/smoke/clear)"\n'
        "}\n"
    ),
}


# def _parse_ollama_resp(data: Dict[str, Any]) -> str:
#     """
#     Ollama /generate với stream=false trả về JSON có field 'response'
#     chứa string (cũng là JSON). Hàm này lấy ra phần đó.
#     """
#     if isinstance(data, dict) and isinstance(data.get("response"), str):
#         return data["response"]
#     return ""


async def call_ollama_json(
    img_bytes: bytes,
    sub_prompt: str,
    model: Optional[str] = None,
    camera_code: Optional[str] = None,
):
    """
    Call Ollama API (single instance).
    """
    global OLLAMA_CLIENT

    # Initialize client if not exists
    if OLLAMA_CLIENT is None:
        OLLAMA_CLIENT = AsyncClient(host=OLLAMA_URL)
        print(f"[OLLAMA] Initialized AsyncClient with host: {OLLAMA_URL}")

    combined_prompt = GLOBAL_PROMPT + "\n" + sub_prompt

    # Use semaphore for rate limiting
    async with OLLAMA_SEMAPHORE:
        response = await OLLAMA_CLIENT.generate(
            model=model or VISION_MODEL,
            prompt=combined_prompt,
            images=[img_bytes],  # Pass bytes directly!
            format="json",
            options={"temperature": 0.0},
            stream=False,
        )

    # Extract text from response
    text = response.get("response", "")
    if not text:
        raise RuntimeError("Empty response from model")

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        raise RuntimeError(f"Model returned non-JSON: {text[:400]}")

    return parsed, text


# ==========================
# Climb post-process
# ==========================
def postprocess_climb(parsed: dict) -> dict:
    if not isinstance(parsed, dict):
        return parsed

    desc = (parsed.get("description") or "").lower()
    desc_compact = " ".join(desc.split())

    # Các pattern mô tả rõ ràng là ĐANG leo / gần như leo xong
    STRONG_CLIMB_PATTERNS = [
        "climbing the fence",
        "climbing over the fence",
        "climbing on the fence",
        "scaling the fence",
        "scrambling up the fence",
        "on top of the fence",
        "on top of the barrier",
        "halfway over the fence",
        "straddling the fence",
    ]

    # Các pattern mô tả chỉ ở GẦN / khom / đứng sát nhưng chưa leo
    NEAR_ONLY_PATTERNS = [
        "crouching low near the base",
        "crouching near the base",
        "standing near the base",
        "standing near the fence",
        "standing beside the fence",
        "walking near the fence",
        "walking beside the fence",
        "walking along the fence",
        "walking beside the barrier",
        "near the base of the barrier",
        "next to the fence",
        "next to the barrier",
    ]

    # Các pattern phủ định rõ ràng là KHÔNG có người tương tác hàng rào
    ABSENCE_PATTERNS = [
        "no person is seen",
        "no one is seen",
        "no person visible",
        "no visible person",
        "no person is visible",
    ]

    has_strong_climb = any(p in desc_compact for p in STRONG_CLIMB_PATTERNS)
    has_near_only = any(p in desc_compact for p in NEAR_ONLY_PATTERNS)
    has_absence = any(p in desc_compact for p in ABSENCE_PATTERNS)

    # 1) Nếu model nói TRUE nhưng mô tả chỉ "near the base", không có hành động leo rõ
    if parsed.get("has_climbing") is True and has_near_only and not has_strong_climb:
        parsed["has_climbing"] = False
        parsed["note_override"] = (
            "auto override to has_climbing=false because description only "
            "mentions a person near the base/side of the barrier, not clearly climbing."
        )
        return parsed

    # 2) Nếu model đã nói TRUE và không phải near-only -> giữ nguyên, không đụng
    if parsed.get("has_climbing") is True:
        return parsed

    # 3) Model nói FALSE. Nếu mô tả có pattern "không có người" thì tôn trọng model, KHÔNG override
    if has_absence:
        return parsed

    # 4) Các phủ định khác ở mức câu
    negative_markers = [
        "no one is climbing",
        "nobody is climbing",
        "neither is climbing",
        "neither of them is climbing",
        "neither of them are climbing",
        "not climbing",
        "not leaning over",
        "not leaning on the fence",
    ]
    if any(p in desc_compact for p in negative_markers):
        return parsed  # model đã nói không, giữ nguyên

    # 5) Nếu model trả FALSE nhưng mô tả lại có key words "đang leo" rõ ràng → override thành TRUE
    suspicious_keywords = [
        "on top of the fence",
        "on top of the barrier",
        "halfway over the fence",
        "climbing the fence",
        "climbing over the fence",
        "climbing on the fence",
        "scaling the fence",
        "scrambling up the fence",
        "leaning over the fence",
        "leaning over the barrier",
        "leaning on the fence",
        "holding onto the fence",
        "grabbing the fence",
    ]
    if any(k in desc_compact for k in suspicious_keywords):
        parsed["has_climbing"] = True
        parsed["note_override"] = (
            "auto override to has_climbing=true because description clearly "
            "mentions climbing / leaning over the barrier."
        )

    return parsed


def fetch_snapshot_rtsp(
    ip: str, cctv_url_suffix: str, username: str = None, password: str = None
) -> bytes:
    """
    Lấy snapshot từ luồng RTSP dùng OpenCV.
    Dùng username/password từng camera (lấy từ DB), fallback sang SNAP_USER/SNAP_PASS.
    """
    from urllib.parse import quote

    cam_user = quote(username or SNAP_USER, safe="")
    cam_pass = quote(password or SNAP_PASS, safe="")
    url = f"rtsp://{cam_user}:{cam_pass}@{ip}:554/{cctv_url_suffix}"

    print(
        f"[fetch_snapshot_rtsp] FFMPEG Snapshot rtsp://***:***@{ip}:554/{cctv_url_suffix}"
    )

    import subprocess

    cmd = [
        "ffmpeg",
        "-y",
        "-rtsp_transport",
        "tcp",
        "-i",
        url,
        "-vframes",
        "1",
        "-q:v",
        "2",
        "-s",
        "1280x720",
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
    ]

    try:
        res = subprocess.run(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5.0
        )
        if res.returncode == 0 and res.stdout:
            if len(res.stdout) > 1000:
                return res.stdout
            else:
                raise Exception("FFMPEG returned empty or too small image buffer")
        else:
            err_msg = (
                res.stderr.decode("utf-8").strip().split("\n")[-1]
                if res.stderr
                else "Unknown Error"
            )
            raise Exception(f"FFMPEG Error: {err_msg}")
    except subprocess.TimeoutExpired:
        raise Exception("FFMPEG Snapshot Timeout (5s)")


def fetch_snapshot_bytes(
    ip: str, cctv_url: str = "live.sdp", username: str = None, password: str = None
) -> bytes:
    """Lấy ảnh từ camera: HTTP trước, RTSP fallback nếu HTTP thất bại.
    Dùng credentials của từng camera (từ DB), fallback sang SNAP_USER/SNAP_PASS.
    """
    if not ip:
        raise ValueError("ip required")

    cam_user = username or SNAP_USER
    cam_pass = password or SNAP_PASS

    urls = [
        f"http://{ip}/cgi-bin/viewer/video.jpg?resolution=1280x720",
        f"http://{ip}/ISAPI/Streaming/channels/101/picture",
    ]
    headers = {"User-Agent": "CCTV-AI/1.0"}

    # Try URLs one by one
    for url in urls:
        try:
            print(f"[fetch_snapshot_bytes] GET {url} (basic)")
            resp = requests.get(
                url,
                auth=HTTPBasicAuth(cam_user, cam_pass),
                timeout=3,
                stream=False,
                headers=headers,
            )

            ct = resp.headers.get("Content-Type", "")
            print(
                f"[fetch_snapshot_bytes] basic status={resp.status_code} ct={ct} len={len(resp.content)}"
            )

            if resp.status_code == 200:
                # sanity
                if len(resp.content) < 1000:
                    print(
                        f"[fetch_snapshot_bytes] WARNING: small payload, head={resp.content[:80]}"
                    )
                return resp.content

            if resp.status_code == 401:
                print(f"[fetch_snapshot_bytes] GET {url} (digest)")
                resp2 = requests.get(
                    url,
                    auth=HTTPDigestAuth(cam_user, cam_pass),
                    timeout=3,
                    stream=False,
                    headers=headers,
                )
                ct2 = resp2.headers.get("Content-Type", "")
                print(
                    f"[fetch_snapshot_bytes] digest status={resp2.status_code} ct={ct2} len={len(resp2.content)}"
                )

                if resp2.status_code == 200:
                    return resp2.content

                print(f"[fetch_snapshot_bytes] Digest failed HTTP {resp2.status_code}")
                continue

            # If 404 or other error, try next URL
            print(
                f"[fetch_snapshot_bytes] HTTP failed ({resp.status_code}), trying next URL..."
            )
            continue

        except Exception as e:
            print(f"[fetch_snapshot_bytes] HTTP Error {url}: {e}")
            continue

    # Fallback to RTSP if all HTTP URLs fail
    print(f"[fetch_snapshot_bytes] All HTTP attempts failed, trying RTSP fallback...")
    try:
        return fetch_snapshot_rtsp(ip, cctv_url, cam_user, cam_pass)
    except Exception as e2:
        raise Exception(f"Both HTTP and RTSP failed. RTSP error: {e2}")


def fetch_snapshot_by_url(url: str) -> bytes:
    """
    Proxy theo full URL (đã chứa user/pass luôn).
    Ví dụ:
      http://ps:ps%4012345@10.13.16.32/cgi-bin/viewer/video.jpg?resolution=1920x1080
    """
    if not url:
        raise ValueError("url required")

    print(f"[fetch_snapshot_by_url] GET {url}")

    try:
        resp = requests.get(url, timeout=5)
        if resp.status_code != 200:
            raise Exception(f"Camera returned {resp.status_code}")
        return resp.content
    except Exception as e:
        print("fetch_snapshot_by_url error:", e)
        raise


# ==========================
# PERSISTENT CAPTURE MANAGER (Thread-per-camera)
# ==========================
class CaptureThread(threading.Thread):
    def __init__(self, camera_row: Dict[str, Any], snapshot_dir: str):
        super().__init__(name=f"CapThread-{camera_row['code']}")
        self.cam = camera_row
        self.snapshot_dir = snapshot_dir
        self.running = True
        self.daemon = True
        self._last_save_time = 0
        self._latest_frame = None
        self._lock = threading.Lock()

    def get_latest_frame_bytes(self) -> Optional[bytes]:
        with self._lock:
            if self._latest_frame is None:
                return None
            success, buffer = cv2.imencode(".jpg", self._latest_frame)
            if success:
                return buffer.tobytes()
        return None

    def run(self):
        code = self.cam["code"]
        ip = self.cam["ip"]
        user = self.cam.get("username") or SNAP_USER
        pw = self.cam.get("password") or SNAP_PASS
        url_suffix = self.cam.get("cctv_url") or "live.sdp"

        is_demo = DEMO_CAMERA_CODE and code.upper() == DEMO_CAMERA_CODE.strip().upper()

        if is_demo:
            print(f"[CAP][{code}] Demo thread started. Reading from demo folder.")
        else:
            from urllib.parse import quote

            u_enc = quote(user, safe="")
            p_enc = quote(pw, safe="")
            rtsp_url = f"rtsp://{u_enc}:{p_enc}@{ip}:554/{url_suffix}"
            print(f"[CAP][{code}] Thread started. URL=rtsp://***:***@{ip}")

        cap = None
        while self.running:
            ai_cfg = self.cam.get("ai_config") or {}
            interval = int(ai_cfg.get("interval_seconds") or 5)
            now_ts = time.time()

            # Wait until it's time to capture
            if now_ts - self._last_save_time < interval:
                time.sleep(0.5)
                continue

            # Đảm bảo interval luôn chính xác 5s bất kể thời gian ffmpeg xử lý
            self._last_save_time = now_ts

            # Áp dụng Giới hạn Backpressure: Ngưng chụp nếu queue đầy
            try:
                if os.path.exists(self.snapshot_dir):
                    num_snaps = len(
                        [
                            f
                            for f in os.listdir(self.snapshot_dir)
                            if f.endswith((".jpg", ".jpeg"))
                        ]
                    )
                    if num_snaps >= SNAPSHOT_QUEUE_MAX:
                        continue  # Skip chụp ảnh vòng này, đợi AI xử lý bớt
            except Exception:
                pass

            frame = None
            if is_demo:
                # Capture from demo folder
                try:
                    raw_bytes = get_demo_image_bytes()
                    nparr = np.frombuffer(raw_bytes, np.uint8)
                    frame = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
                    if frame is None:
                        raise Exception("Failed to decode demo image")

                    # Mô phỏng quá trình tạo file như FFMPEG (sử dụng pure Python để tránh lỗi cv2.imwrite không hỗ trợ Unicode tiếng Việt trên Windows)
                    dt_str = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
                    filename = f"{code}_{dt_str}.jpg"
                    filepath = os.path.join(self.snapshot_dir, filename)
                    filepath_tmp = filepath + ".tmp"

                    with open(filepath_tmp, "wb") as f_out:
                        f_out.write(raw_bytes)

                    os.rename(filepath_tmp, filepath)
                except Exception as e:
                    print(f"[CAP][{code}] Demo read error: {e}")
            else:
                import subprocess

                dt_str = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
                filename = f"{code}_{dt_str}.jpg"
                filepath = os.path.join(self.snapshot_dir, filename)
                filepath_tmp = filepath + ".tmp"

                cmd = [
                    "ffmpeg",
                    "-y",
                    "-rtsp_transport",
                    "tcp",
                    "-i",
                    rtsp_url,
                    "-vframes",
                    "1",
                    "-q:v",
                    "2",
                    "-s",
                    "1280x720",
                    "-f",
                    "image2",
                    "-update",
                    "1",
                    filepath_tmp,
                ]
                try:
                    res = subprocess.run(
                        cmd,
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.PIPE,
                        timeout=4.5,
                    )
                    if res.returncode == 0 and os.path.exists(filepath_tmp):
                        os.rename(
                            filepath_tmp, filepath
                        )  # Rename atomic to prevent partial read
                        frame = cv2.imread(filepath)
                        if frame is not None:
                            pass  # print(f"[CAP][{code}] SAVED FFMPEG {filename}") (Bỏ in liên tục cho đỡ rác log)
                        else:
                            print(f"[CAP][{code}] FAILED TO READ {filepath}")
                    else:
                        err_msg = (
                            res.stderr.decode("utf-8").strip().split("\n")[-1]
                            if res.stderr
                            else "Unknown Error"
                        )
                        print(f"[CAP][{code}] FFMPEG FAILED: {err_msg}")
                        if os.path.exists(filepath_tmp):
                            os.remove(filepath_tmp)
                except subprocess.TimeoutExpired:
                    print(f"[CAP][{code}] FFMPEG TIMEOUT")
                    if os.path.exists(filepath_tmp):
                        os.remove(filepath_tmp)
                except Exception as e:
                    print(f"[CAP][{code}] ERROR: {e}")
                    if os.path.exists(filepath_tmp):
                        os.remove(filepath_tmp)

            if frame is not None:
                with self._lock:
                    self._latest_frame = frame.copy()

            # small sleep to avoid 100% CPU when interval skip fails
            time.sleep(0.1)

        pass
        print(f"[CAP][{code}] Thread stopped.")


class PersistentCaptureManager:
    def __init__(self, snapshot_dir: str):
        self.snapshot_dir = snapshot_dir
        self.threads: Dict[str, CaptureThread] = {}
        self._running = False

    def start(self):
        self._running = True
        print("[CAP_MANAGER] Starting...")
        # Initial loading will happen in a loop or periodically

    def stop(self):
        self._running = False
        print("[CAP_MANAGER] Stopping all threads...")
        for t in self.threads.values():
            t.running = False
        for t in self.threads.values():
            t.join(timeout=1.0)
        self.threads.clear()

    def sync_with_db(self, cams: List[Dict[str, Any]]):
        """Add new cameras, stop removed ones."""
        print(f"[CAP_MANAGER] Syncing with DB... Found {len(cams)} cams")
        active_codes = {c["code"] for c in cams}
        self.ip_to_code = {c["ip"]: c["code"] for c in cams}

        # Stop removed
        to_remove = [code for code in self.threads if code not in active_codes]
        for code in to_remove:
            print(f"[CAP_MANAGER] Stopping thread for {code}")
            self.threads[code].running = False
            self.threads[code].join(timeout=0.5)
            del self.threads[code]

        # Start new
        for cam in cams:
            code = cam["code"]
            if code not in self.threads:
                t = CaptureThread(cam, self.snapshot_dir)
                self.threads[code] = t
                t.start()
            else:
                # Update camera row (maybe user/pass changed)
                # Simplified: we just update the ref, thread will use it eventually if needed
                # or we could restart the thread if critical fields changed.
                self.threads[code].cam = cam


GLOBAL_CAP_MANAGER = PersistentCaptureManager(SNAPSHOT_DIR)


# ==========================
# WARNING endpoint helper
# ==========================
def send_warning_event(
    camera_code: str,
    event_code: str,
    full_bytes: bytes,
    boxes: Optional[List[Dict[str, Any]]] = None,
):
    """
    Gửi cảnh báo lên Laravel qua insertWarningFromAVG.
    - camera_code
    - event_code (crowb / intruder / fire)
    - fullshot_url (ảnh full)
    - thumbshot_url (null - không tạo thumbnail)
    - boxes (optional): list of bounding boxes [{x1, y1, x2, y2, confidence}, ...]
    """
    if not WARNING_API_URL:
        print("[WARN_API] WARNING_API_URL not set, skip")
        return

    data = {
        "camera_code": camera_code,
        "event_code": event_code,
    }

    # Add boxes if provided
    if boxes:
        data["boxes"] = json.dumps(boxes, ensure_ascii=False)
        print(f"[WARN_API] Sending {len(boxes)} bounding boxes")

    files = {
        "fullshot_url": (f"{camera_code}_full.jpg", full_bytes, "image/jpeg"),
        # Không gửi thumbnail - để null
    }

    try:
        resp = requests.post(WARNING_API_URL, data=data, files=files, timeout=10)
        print(
            f"[WARN_API] {camera_code} {event_code} "
            f"status={resp.status_code} body={resp.text[:200]}"
        )
    except Exception as e:
        print(f"[WARN_API] error sending warning for {camera_code} {event_code}: {e}")


def get_demo_image_bytes() -> bytes:
    """
    Đọc NGẪU NHIÊN 1 ảnh demo từ thư mục DEMO_CAMERA_FOLDER.
    Trả về bytes giống như fetch_snapshot_bytes.
    """
    if not DEMO_CAMERA_FOLDER:
        raise ValueError("DEMO_CAMERA_FOLDER not configured")

    if not os.path.isdir(DEMO_CAMERA_FOLDER):
        raise FileNotFoundError(f"Demo folder not found: {DEMO_CAMERA_FOLDER}")

    # Lấy danh sách file ảnh hợp lệ
    exts = (".jpg", ".jpeg", ".png", ".webp")
    files = [f for f in os.listdir(DEMO_CAMERA_FOLDER) if f.lower().endswith(exts)]

    if not files:
        raise FileNotFoundError(
            f"No image files found in demo folder: {DEMO_CAMERA_FOLDER}"
        )

    chosen = random.choice(files)
    chosen_path = os.path.join(DEMO_CAMERA_FOLDER, chosen)

    with open(chosen_path, "rb") as f:
        data = f.read()

    # Optional log
    print(f"[DEMO] Picked random image: {chosen_path}")

    return data


# ==========================
# NEW FLOW: PARALLEL YOLO + FIRE DETECTION
# ==========================


def save_snapshot_to_disk(camera_code: str, jpeg_bytes: bytes) -> str:
    """
    Lưu snapshot vào thư mục snapshot/, trả về đường dẫn file.
    Tên file: {camera_code}_{timestamp}.jpg
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    filename = f"{camera_code}_{timestamp}.jpg"
    filepath = os.path.join(SNAPSHOT_DIR, filename)

    with open(filepath, "wb") as f:
        f.write(jpeg_bytes)

    return filepath


async def call_llm_phone_prefilter(collage_bytes: bytes) -> bool:
    """
    SAME prompt + schema as standalone test script:
      - system: Always respond in JSON as {'response':'Y'} or {'response':'N'}
      - prompt: ask whether any shot contains a person using a phone
    Return:
      True if response == 'Y', else False
    """
    global OLLAMA_CLIENT

    if OLLAMA_CLIENT is None:
        OLLAMA_CLIENT = AsyncClient(host=OLLAMA_URL)
        print(f"[OLLAMA] Initialized AsyncClient with host: {OLLAMA_URL}")

    # Reuse your existing concurrency limiter
    async with OLLAMA_SEMAPHORE:
        resp = await OLLAMA_CLIENT.generate(
            system="Always respond in JSON to answer the question as {'response':'Y'} or {'response':'N'}",
            model=VISION_MODEL,
            prompt=(
                "Collage of photos, does any shot of them contain a person using a phone? "
                "Only answer in JSON format as: {'response':'Y' if there is even 1 case or more, otherwise 'N'}"
            ),
            images=[collage_bytes],
            format="json",
            options={"temperature": 0.1},
            stream=False,
        )

    text = (resp or {}).get("response", "")
    if not text:
        raise RuntimeError("Empty response from LLM (phone prefilter)")

    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        raise RuntimeError(f"LLM returned non-JSON (phone prefilter): {text[:200]}")

    # Accept: {"response":"Y"} (case-insensitive)
    val = str(parsed.get("response", "")).strip().upper()
    return val == "Y"


async def check_phone_parallel(
    img: Image.Image,
    camera_code: str,
    ai_config: Dict[str, Any],
    jpeg_bytes: bytes,
    actions: Dict[str, Any],
    person_boxes: List[Dict[str, Any]],
    result: Dict[str, Any],  # để append warnings
) -> Dict[str, Any]:
    phone_result: Dict[str, Any] = {
        "phone_alert": False,
        "skip_reason_phone": None,
        "phone_llm_pass": None,
        "phone_dino_hits": 0,
        "phone_best_conf": 0.0,
        "phone_debug": {},
    }

    # --- LOG start ---
    print(
        f"[PHONE] START camera={camera_code} actions.detect_phone={actions.get('detect_phone')} boxes={len(person_boxes) if person_boxes else 0}"
    )

    if not actions.get("detect_phone"):
        phone_result["skip_reason_phone"] = "detect_phone_disabled"
        print(f"[PHONE] SKIP camera={camera_code} reason=detect_phone_disabled")
        return phone_result

    if not person_boxes:
        phone_result["skip_reason_phone"] = "no_person_boxes"
        print(f"[PHONE] SKIP camera={camera_code} reason=no_person_boxes")
        return phone_result

    # (optional) giới hạn số người để tránh collage quá rộng
    max_people_for_phone = int(ai_config.get("max_people_for_phone") or 8)
    boxes_for_phone = person_boxes[:max_people_for_phone]
    print(
        f"[PHONE] camera={camera_code} build_collage max_people_for_phone={max_people_for_phone} use_boxes={len(boxes_for_phone)}"
    )

    collage, roi_images, boxes_sorted = create_roi_collage_from_boxes(
        img, boxes_for_phone
    )
    if collage is None or not roi_images:
        phone_result["skip_reason_phone"] = "collage_failed"
        print(
            f"[PHONE] SKIP camera={camera_code} reason=collage_failed roi_images={len(roi_images) if roi_images else 0}"
        )
        return phone_result

    print(
        f"[PHONE] camera={camera_code} collage_ok roi_count={len(roi_images)} collage_size={collage.size}"
    )

    # Encode collage once
    buf = io.BytesIO()
    collage.save(buf, format="JPEG", quality=90)
    collage_bytes = buf.getvalue()
    phone_result["phone_debug"]["collage_bytes_len"] = len(collage_bytes)

    # Stage 1: LLM prefilter
    t_llm0 = time.time()
    try:
        llm_yes = await call_llm_phone_prefilter(collage_bytes)
        phone_result["phone_llm_pass"] = bool(llm_yes)
        phone_result["phone_debug"]["llm_time_sec"] = round(time.time() - t_llm0, 3)
        print(
            f"[PHONE] camera={camera_code} LLM_PREFILTER yes={bool(llm_yes)} dt={phone_result['phone_debug']['llm_time_sec']}s"
        )
    except Exception as e:
        phone_result["skip_reason_phone"] = "llm_error"
        phone_result["phone_debug"]["llm_error"] = str(e)
        print(f"[PHONE] ERROR camera={camera_code} stage=llm_prefilter err={e}")
        return phone_result

    if not phone_result["phone_llm_pass"]:
        phone_result["skip_reason_phone"] = "llm_says_no"
        print(f"[PHONE] SKIP camera={camera_code} reason=llm_says_no")
        return phone_result

    # Stage 2: DINO per ROI (concurrent but limited)
    async def dino_one(idx: int, roi: Image.Image) -> Dict[str, Any]:
        async with DINO_SEMAPHORE:
            t0 = time.time()
            try:
                # Use threshold from ai_config (loaded from DB), default to 0.5 if missing (higher than 0.45 for safety)
                thresh = float(ai_config.get("threshold") or 0.6)
                out = await asyncio.to_thread(detect_phone_dino_roi, roi, thresh)
                dt = round(time.time() - t0, 3)
                print(
                    f"[PHONE] camera={camera_code} DINO roi={idx}/{len(roi_images)} "
                    f"has_phone={out.get('has_phone')} conf={out.get('confidence')} dt={dt}s (thresh={thresh})"
                )
                return out
            except Exception as e:
                dt = round(time.time() - t0, 3)
                print(
                    f"[PHONE] camera={camera_code} DINO_ERROR roi={idx}/{len(roi_images)} dt={dt}s err={e}"
                )
                return {"has_phone": False, "confidence": 0.0, "error": str(e)}

    t_dino0 = time.time()
    dino_results = await asyncio.gather(
        *[dino_one(i, r) for i, r in enumerate(roi_images)],
        return_exceptions=True,
    )
    phone_result["phone_debug"]["dino_time_sec"] = round(time.time() - t_dino0, 3)

    hits = 0
    best = 0.0
    errors = 0
    for r in dino_results:
        if isinstance(r, Exception):
            errors += 1
            continue
        if isinstance(r, dict) and r.get("has_phone"):
            hits += 1
            best = max(best, float(r.get("confidence") or 0.0))

    phone_result["phone_dino_hits"] = hits
    phone_result["phone_best_conf"] = best
    phone_result["phone_debug"]["dino_errors"] = errors

    print(
        f"[PHONE] camera={camera_code} DINO_DONE hits={hits} best_conf={best} errors={errors} dt={phone_result['phone_debug']['dino_time_sec']}s"
    )

    if hits > 0:
        try:
            # Collect bounding boxes for detected phones
            print(f"[PHONE] camera={camera_code} COLLECTING_BOXES hits={hits}")

            phone_boxes = []

            # IMPORTANT: dino_results MUST align with boxes_sorted (same order as ROI creation)
            for i, (r, box) in enumerate(zip(dino_results, boxes_sorted)):
                if isinstance(r, dict) and r.get("has_phone"):
                    x1, y1, x2, y2 = box["x1"], box["y1"], box["x2"], box["y2"]
                    conf = float(r.get("confidence", 0.0))

                    phone_boxes.append(
                        {"x1": x1, "y1": y1, "x2": x2, "y2": y2, "confidence": conf}
                    )

                    print(
                        f"[PHONE] camera={camera_code} COLLECTED_BOX roi={i+1}/{len(boxes_sorted)} "
                        f"box=({x1},{y1},{x2},{y2}) conf={conf:.3f}"
                    )

            print(
                f"[PHONE] camera={camera_code} SENDING_COORDINATES "
                f"boxes_count={len(phone_boxes)}"
            )

            # Send original image with bounding box coordinates
            print(
                f"[PHONE] camera={camera_code} FINAL_WARNING_SENT boxes={len(phone_boxes)}"
            )
            await asyncio.to_thread(
                send_warning_event, camera_code, "smartphone", jpeg_bytes, phone_boxes
            )

            # --- SỬA LỖI INDENT TẠI ĐÂY ---
            phone_result["phone_alert"] = True
            result["warnings"].append("smartphone")
            print(
                f"[PHONE] ALERT_SENT camera={camera_code} event=smartphone with_coordinates=True boxes={len(phone_boxes)}"
            )

        except Exception as e:
            print(f"[PHONE] camera={camera_code} ERROR_COLLECTING_BOXES: {e}")
            # Fallback to no boxes if error
            await asyncio.to_thread(
                send_warning_event, camera_code, "smartphone", jpeg_bytes
            )
            # Vẫn tính là có alert dù lỗi box
            phone_result["phone_alert"] = True
            result["warnings"].append("smartphone")
    else:
        print(f"[PHONE] camera={camera_code} NO_HITS_SKIP_WARNING")

    return phone_result


async def yolo_branch(
    img: Image.Image,
    camera_code: str,
    ai_config: Dict[str, Any],
    jpeg_bytes: bytes,
) -> Dict[str, Any]:
    """
    YOLO branch: dùng img đã decode sẵn (NO Image.open(snapshot_path)).
    """
    t0 = datetime.now(timezone.utc)
    result: Dict[str, Any] = {"branch": "yolo", "camera": camera_code, "warnings": []}

    is_demo = camera_code.strip().upper() == DEMO_CAMERA_CODE.strip().upper()

    try:
        # img đã là RGB từ caller
        w, h = img.size

        actions = ai_config.get("actions", {}) or {}
        max_people_allowed = int(ai_config.get("max_people_allowed") or 0)

        # Run PersonModel ONE time
        t_yolo_start = datetime.now(timezone.utc)
        people_out = await asyncio.to_thread(
            detect_people_stats_and_boxes_yolo, img, 0.25
        )
        yolo_time = (datetime.now(timezone.utc) - t_yolo_start).total_seconds()

        people_count = int(people_out.get("people_count", 0))
        avg_conf = float(people_out.get("avg_confidence", 0.0))
        person_boxes = people_out.get("boxes", []) or []

        result.update(
            {
                "people_count": people_count,
                "yolo_confidence": avg_conf,
                "yolo_time_sec": yolo_time,
                "boxes_count": len(person_boxes),
            }
        )

        if people_count <= 0:
            result["status"] = "no_people"
            return result

        async def check_crowd_parallel() -> Dict[str, Any]:
            crowd_result: Dict[str, Any] = {"crowd_alert": False}
            if not actions.get("count_people"):
                crowd_result["skip_reason_crowd"] = "count_people_disabled"
                return crowd_result

            # --- Logic thời gian (Cấu hình) ---
            now_local = datetime.now()
            current_time_str = now_local.strftime("%H:%M")
            start_hour = ai_config.get("working_hours_start", "07:15")
            end_hour = ai_config.get("working_hours_end", "16:45")
            detect_off_hours = actions.get("detect_off_hours", False)
            is_working_hours = start_hour <= current_time_str <= end_hour

            if is_working_hours:
                if max_people_allowed > 0 and people_count > max_people_allowed:
                    await asyncio.to_thread(
                        send_warning_event, camera_code, "crowb", jpeg_bytes, None
                    )
                    crowd_result["crowd_alert"] = True
                    result["warnings"].append("crowb")
            else:
                if detect_off_hours and people_count > 0:
                    await asyncio.to_thread(
                        send_warning_event, camera_code, "crowb2", jpeg_bytes, None
                    )
                    crowd_result["crowd_alert"] = True
                    result["warnings"].append("crowb")

            return crowd_result

        async def check_intruder_fenceline_parallel() -> Dict[str, Any]:
            intruder_result: Dict[str, Any] = {
                "intruder_alert": False,
                "fenceline_hit": False,
                "skip_reason_intruder": None,
            }

            if not actions.get("detect_climb"):
                intruder_result["skip_reason_intruder"] = "detect_climb_disabled"
                return intruder_result

            fenceline = get_fenceline_from_ai_config(ai_config, w, h)
            if not fenceline:
                intruder_result["skip_reason_intruder"] = "no_fenceline"
                return intruder_result

            fx1, fy1, fx2, fy2 = fenceline

            hit_box = None
            for b in person_boxes:
                x1, y1, x2, y2 = b["x1"], b["y1"], b["x2"], b["y2"]
                if line_intersects_rect(fx1, fy1, fx2, fy2, x1, y1, x2, y2):
                    hit_box = b  # Keep the whole dict
                    break

            if not hit_box:
                intruder_result["skip_reason_intruder"] = "no_person_touch_fenceline"
                return intruder_result

            intruder_result["fenceline_hit"] = True

            # hit_box is a dict from person_boxes
            await asyncio.to_thread(
                send_warning_event, camera_code, "intruder", jpeg_bytes, [hit_box]
            )
            intruder_result["intruder_alert"] = True
            result["warnings"].append("intruder")
            return intruder_result

        # crowd_result, intruder_result = await asyncio.gather(
        #     check_crowd_parallel(),
        #     check_intruder_fenceline_parallel(),
        #     return_exceptions=True,
        # )
        crowd_result, intruder_result, phone_result = await asyncio.gather(
            check_crowd_parallel(),
            check_intruder_fenceline_parallel(),
            check_phone_parallel(
                img=img,
                camera_code=camera_code,
                ai_config=ai_config,
                jpeg_bytes=jpeg_bytes,
                actions=actions,
                person_boxes=person_boxes,
                result=result,
            ),
            return_exceptions=True,
        )

        if isinstance(crowd_result, dict):
            result.update(crowd_result)
        else:
            result["crowd_error"] = str(crowd_result)

        if isinstance(intruder_result, dict):
            result.update(intruder_result)
        else:
            result["intruder_error"] = str(intruder_result)

        result["status"] = "ok"

    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)

    return result


async def fire_branch(
    img: Image.Image,
    camera_code: str,
    ai_config: Dict[str, Any],
    jpeg_bytes: bytes,
) -> Dict[str, Any]:
    """
    Fire branch:
    - Stage 1 YOLO on crop (NO disk open)
    - Stage 2 LLM only if YOLO hit
    - Encode crop bytes only ONCE (when calling LLM)
    """
    t0 = datetime.now(timezone.utc)
    result = {"branch": "fire", "camera": camera_code, "warnings": []}

    is_demo = camera_code.strip().upper() == DEMO_CAMERA_CODE.strip().upper()

    try:
        actions = ai_config.get("actions", {}) or {}
        regions = ai_config.get("regions", {}) or {}

        if not actions.get("detect_fire"):
            result["status"] = "disabled"
            return result

        w, h = img.size

        # Crop theo fire region nếu có
        fire_img = img
        if regions.get("fire") and regions["fire"][0].get("points"):
            fire_poly = regions["fire"][0]["points"]
            l, t, r, b = polygon_to_bbox(fire_poly, w, h)
            fire_img = img.crop((l, t, r, b))

        # Stage 1: YOLO pre-filter
        t_yolo_start = datetime.now(timezone.utc)
        yolo_result = await asyncio.to_thread(
            detect_fire_yolo, fire_img, confidence_threshold=0.4
        )
        t_yolo = (datetime.now(timezone.utc) - t_yolo_start).total_seconds()

        result["yolo_detection"] = yolo_result

        if not yolo_result.get("has_fire_smoke"):
            result.update(
                {
                    "fire_detected": False,
                    "llm_skipped": True,
                    "status": "ok",
                    "skip_reason": "yolo_no_detection",
                    "yolo_time_sec": t_yolo,
                }
            )
            return result

        # Stage 2: LLM confirmation (encode crop ONCE)
        buf = io.BytesIO()
        fire_img.save(buf, format="JPEG", quality=90)  # encode 1 lần tại đây
        fire_bytes = buf.getvalue()

        async with qwen_semaphore:
            parsed, _raw_text = await call_ollama_json(
                fire_bytes, SUB_PROMPTS["detect_fire"], camera_code=camera_code
            )

        has_fire_llm = bool(parsed.get("has_fire", False))

        result.update(
            {
                "fire_detected": has_fire_llm,
                "llm_response": parsed,
                "llm_skipped": False,
                "yolo_time_sec": t_yolo,
            }
        )

        if has_fire_llm:
            # yolo_result['detections'] contains fire boxes
            fire_boxes = yolo_result.get("detections", [])
            await asyncio.to_thread(
                send_warning_event, camera_code, "fire", jpeg_bytes, fire_boxes
            )
            result["warnings"].append("fire")

        result["status"] = "ok"

    except Exception as e:
        result["status"] = "error"
        result["error"] = str(e)

    return result


snapshot_queue: asyncio.Queue = None
qwen_semaphore: asyncio.Semaphore = None


async def capture_one_snapshot(row: Dict[str, Any], now: datetime, cycle_id: int):
    code = (row.get("code") or "").strip()
    ip = (row.get("ip") or "").strip()
    raw_cfg = row.get("ai_config")

    try:
        cfg = normalize_ai_config(raw_cfg) or {}
    except Exception as e:
        print(f"[SNAP][{cycle_id}] {code} parse ai_config error: {e}")
        return None

    actions = cfg.get("actions", {}) or {}
    if not any(actions.values()):
        return None

    t0 = time.time()

    async with SNAPSHOT_CAPTURE_SEMAPHORE:
        try:
            # DEMO vs REAL
            if DEMO_CAMERA_CODE and code.upper() == DEMO_CAMERA_CODE.strip().upper():
                print(f"[SNAP][{cycle_id}] {code} DEMO capture start")
                snap_bytes = await asyncio.wait_for(
                    asyncio.to_thread(get_demo_image_bytes),
                    timeout=SNAPSHOT_FETCH_TIMEOUT_SEC,
                )
                ct = "demo/local"
            else:
                print(f"[SNAP][{cycle_id}] {code} ip={ip} capture start")
                cctv_url = row.get("cctv_url") or "live.sdp"
                cam_user = row.get("username") or SNAP_USER
                cam_pass = row.get("password") or SNAP_PASS
                snap_bytes = await asyncio.wait_for(
                    asyncio.to_thread(
                        fetch_snapshot_bytes, ip, cctv_url, cam_user, cam_pass
                    ),
                    timeout=SNAPSHOT_FETCH_TIMEOUT_SEC
                    + 5,  # RTSP cần thêm chút thời gian
                )
                ct = "camera/hybrid"

            dt = time.time() - t0
            size = len(snap_bytes) if snap_bytes else 0
            jpeg_ok = is_jpeg_bytes(snap_bytes)

            if not snap_bytes:
                print(f"[SNAP][{cycle_id}] {code} EMPTY bytes dt={dt:.3f}s")
                return None

            if size < 1000 or not jpeg_ok:
                print(
                    f"[SNAP][{cycle_id}] {code} WARNING non-jpeg/small "
                    f"len={size} jpeg_ok={jpeg_ok} dt={dt:.3f}s head={short_head(snap_bytes)!r}"
                )

            # Save to disk
            snapshot_path = await asyncio.to_thread(
                save_snapshot_to_disk, code, snap_bytes
            )

            print(
                f"[SNAP][{cycle_id}] {code} SAVED path={snapshot_path} "
                f"len={size} jpeg_ok={jpeg_ok} dt={dt:.3f}s src={ct}"
            )

            return {
                "camera_code": code,
                "snapshot_path": snapshot_path,
                "snapshot_bytes": snap_bytes,
                "ai_config": cfg,
                "timestamp": now,
                "capture_time": dt,
                "jpeg_ok": jpeg_ok,
                "size": size,
            }

        except asyncio.TimeoutError:
            dt = time.time() - t0
            print(
                f"[SNAP][{cycle_id}] {code} TIMEOUT after {dt:.3f}s (fetch_timeout={SNAPSHOT_FETCH_TIMEOUT_SEC}) ip={ip}"
            )
            return None
        except Exception as e:
            dt = time.time() - t0
            print(f"[SNAP][{cycle_id}] {code} ERROR ip={ip} dt={dt:.3f}s err={e}")
            return None


# Camera config storage - PRELOADED at startup
_camera_configs: Dict[str, Dict[str, Any]] = {}
_valid_camera_codes: set = set()


def preload_all_camera_configs():
    """
    Load TẤT CẢ camera configs vào memory lúc startup.
    Chỉ chạy 1 lần, sau đó dùng mãi không query DB nữa.
    """
    global _camera_configs, _valid_camera_codes

    print("[STARTUP] Preloading all camera configs into memory...")

    try:
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT code, ai_config, threshold FROM cctv_tbl")
                rows = cur.fetchall()
        finally:
            conn.close()

        # Xoá cache cũ trước khi nạp lại
        _camera_configs.clear()
        _valid_camera_codes.clear()

        loaded_count = 0
        for row in rows:
            code = (row.get("code") or "").strip()
            ai_config_str = row.get("ai_config")

            if not code:
                continue

            # Log hex to detect hidden chars
            code_hex = code.encode("utf-8").hex()
            print(f"[STARTUP] Found DB code: '{code}' (hex: {code_hex})")

            if ai_config_str:
                try:
                    config = json.loads(ai_config_str)

                    # Inject threshold column value into config dict
                    threshold_val = row.get("threshold")
                    if threshold_val is not None:
                        config["threshold"] = threshold_val

                    _camera_configs[code] = config
                    _valid_camera_codes.add(code)
                    loaded_count += 1
                except Exception as e:
                    print(f"[STARTUP] Failed to parse config for {code}: {e}")

        print(
            f"[STARTUP] Loaded {loaded_count} camera configs. Valid codes: {list(_valid_camera_codes)[:10]}..."
        )

        print(f"[STARTUP] Loaded {loaded_count} camera configs into memory")

    except Exception as e:
        print(f"[STARTUP] Error preloading configs: {e}")
        import traceback

        traceback.print_exc()


def get_camera_config(camera_code: str) -> Optional[Dict[str, Any]]:
    """
    Get ai_config from memory (NO DB query).
    Returns None if camera không có config.
    """
    config = _camera_configs.get(camera_code)
    if not config:
        is_demo = (
            DEMO_CAMERA_CODE
            and camera_code.strip().upper() == DEMO_CAMERA_CODE.strip().upper()
        )
        if is_demo:
            # Default config for demo camera to allow testing without DB entry
            return {
                "actions": {
                    "count_people": True,
                    "detect_climb": True,
                    "detect_fire": True,
                    "detect_phone": True,
                },
                "interval_seconds": 30,
                "regions": {
                    "people": [],
                    "climb": [
                        {
                            "id": "demo_fence",
                            "points": [{"x": 0.0, "y": 0.5}, {"x": 1.0, "y": 0.5}],
                        }
                    ],
                    "fire": [],
                },
                "max_people_allowed": 0,  # Alert on any person
            }
    return config


def is_valid_camera(camera_code: str) -> bool:
    """
    Check if camera có config hay không (NO DB query).
    """
    code_clean = camera_code.strip()
    if code_clean in _valid_camera_codes:
        return True

    # Special case: Demo camera
    is_demo = (
        DEMO_CAMERA_CODE and code_clean.upper() == DEMO_CAMERA_CODE.strip().upper()
    )
    if is_demo:
        return True

    # Log mismatch detail
    try:
        code_hex = code_clean.encode("utf-8").hex()
        print(
            f"[AI_VALIDATION] Mismatch: '{code_clean}' (hex: {code_hex}) not in valid list."
        )
        # if _valid_camera_codes:
        #     sample = list(_valid_camera_codes)[0]
        #     print(f"[AI_VALIDATION] Sample valid: '{sample}' (hex: {sample.encode('utf-8').hex()})")
    except Exception:
        pass

    return False


def should_skip_snapshot_phash(image_path: str, camera_code: str) -> tuple[bool, int]:
    """
    Perceptual Hash (pHash) filter - Pre-YOLO stage.

    Check if snapshot should be skipped based on similarity to previous frame.
    This skips static/unchanged frames to reduce YOLO processing load.

    Args:
        image_path: Path to snapshot image file
        camera_code: Camera identifier

    Returns:
        (should_skip: bool, distance: int)
        - True = skip (similar to previous), False = process (different)
        - distance = Hamming distance (0-64)

    Performance: ~2ms per image
    """
    global _CAMERA_HASH_CACHE

    if not PHASH_ENABLED:
        return False, -1  # Filter disabled, process all

    # EXCEPTION: Never skip demo camera (testing with static images)
    if (
        DEMO_CAMERA_CODE
        and camera_code.strip().upper() == DEMO_CAMERA_CODE.strip().upper()
    ):
        return False, -2  # Always process demo camera

    try:
        # Load image and compute perceptual hash
        img = Image.open(image_path)
        current_hash = imagehash.phash(img)

        # Get previous hash for this camera
        previous_hash = _CAMERA_HASH_CACHE.get(camera_code)

        if previous_hash is None:
            # First image for this camera - always process
            _CAMERA_HASH_CACHE[camera_code] = current_hash
            return False, 0

        # Calculate Hamming distance (0-64)
        distance = current_hash - previous_hash

        if distance < PHASH_THRESHOLD:
            # Similar to previous - SKIP
            # Don't update cache - we want to keep comparing to last DIFFERENT frame
            return True, distance
        else:
            # Different from previous - PROCESS
            # Update cache with new hash
            _CAMERA_HASH_CACHE[camera_code] = current_hash
            return False, distance

    except Exception as e:
        print(f"[pHash] Error for {camera_code}: {e}")
        return False, -1  # On error, process anyway (safe default)


# Removed snapshot_producer_loop in favor of PersistentCaptureManager


async def ai_consumer_loop():
    """
    Scan snapshot folder and process files in chronological order (oldest first).

    Xử lý ảnh trong thư mục theo chu kỳ:
    - Ảnh cũ nhất (vòng trước) xử lý trước
    - Ảnh mới nhất (vòng sau) xử lý sau
    - Đảm bảo đúng vòng đời, tránh xử lý ảnh 2 vòng khác nhau cùng lúc
    """
    print(f"[AI_CONSUMER] Started, max_parallel={MAX_PARALLEL_CAMERAS}")
    print(f"[AI_CONSUMER] Processing mode: FOLDER SCAN (oldest file first)")
    print(f"[AI_CONSUMER] pHash filter: {'ENABLED' if PHASH_ENABLED else 'DISABLED'}")
    if PHASH_ENABLED:
        print(f"[AI_CONSUMER] pHash threshold: {PHASH_THRESHOLD} (Hamming distance)")

    async def process_one_snapshot(filepath: str, camera_code: str):
        try:
            # Extract camera_code nếu cần (giữ logic cũ của bạn)
            if not camera_code:
                filename = os.path.basename(filepath)
                name_without_ext = filename.rsplit(".", 1)[0]
                parts = name_without_ext.split("_")
                camera_parts = []
                for i, part in enumerate(parts):
                    if len(part) == 8 and part.isdigit():
                        camera_parts = parts[:i]
                        break
                camera_code = (
                    "_".join(camera_parts) if camera_parts else name_without_ext
                )

            # Read bytes once
            with open(filepath, "rb") as f:
                snap_bytes = f.read()

            # Decode once -> PIL RGB
            img = Image.open(io.BytesIO(snap_bytes)).convert("RGB")

            # ------------------------------------------------------------------
            # RESET CAMERA ONLINE: Nếu hễ lấy được ảnh + decode được thì reset timeout
            # ------------------------------------------------------------------
            try:
                conn = get_conn()
                try:
                    with conn.cursor() as cur:
                        # Chỉ update nếu đang có lỗi hoặc đang không online để tối ưu DB
                        cur.execute(
                            "UPDATE cctv_tbl SET cctv_status='online', consecutive_timeouts=0, alert_muted=0 "
                            "WHERE code=%s AND (cctv_status != 'online' OR consecutive_timeouts > 0 OR alert_muted > 0)",
                            (camera_code,),
                        )
                finally:
                    conn.close()
            except Exception as e:
                print(f"[AI_CONSUMER] Error resetting health for {camera_code}: {e}")
            # ------------------------------------------------------------------

            # pHash pre-filter using decoded img (NO Image.open again)
            should_skip, distance = should_skip_snapshot_phash_img(img, camera_code)
            if should_skip:
                print(
                    f"[pHash] {camera_code} - SKIP (distance={distance} < {PHASH_THRESHOLD})"
                )
                return

            if PHASH_ENABLED and distance >= 0:
                print(
                    f"[pHash] {camera_code} - PROCESS (distance={distance} >= {PHASH_THRESHOLD})"
                )

            # Get config from memory
            cfg = get_camera_config(camera_code)
            if not cfg:
                return

            async with PARALLEL_CAMERA_SEMAPHORE:
                t_start = datetime.now(timezone.utc)

                # Run in parallel using SAME decoded img
                yolo_task = yolo_branch(img, camera_code, cfg, snap_bytes)
                fire_task = fire_branch(img, camera_code, cfg, snap_bytes)

                yolo_result, fire_result = await asyncio.gather(
                    yolo_task, fire_task, return_exceptions=True
                )

                t_end = datetime.now(timezone.utc)
                total_time = (t_end - t_start).total_seconds()

                warnings = []
                if isinstance(yolo_result, dict):
                    warnings.extend(yolo_result.get("warnings", []))
                if isinstance(fire_result, dict):
                    warnings.extend(fire_result.get("warnings", []))

                print(
                    f"[AI_CONSUMER] {camera_code} - Processed in {total_time:.3f}s, warnings={warnings}"
                )

        except Exception as e:
            print(f"[AI_CONSUMER] Error processing {filepath}: {e}")
            import traceback

            traceback.print_exc()

        finally:
            # ALWAYS delete file to avoid reprocessing
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except Exception as e:
                    print(f"[AI_CONSUMER] Failed to delete {filepath}: {e}")

    # Main loop: continuously scan folder and process oldest files first
    processed_count = 0  # Track số lượng ảnh đã xử lý để cleanup GPU
    loop_count = 0

    while True:
        try:
            loop_count += 1
            if loop_count % 100 == 0:  # Every 100 iterations
                print(
                    f"[AI_CONSUMER] Heartbeat: {loop_count} iterations, processed={processed_count}"
                )
            # Scan snapshot folder
            snapshot_files = []
            if os.path.exists(SNAPSHOT_DIR):
                for filename in os.listdir(SNAPSHOT_DIR):
                    if filename.endswith(".jpg") or filename.endswith(".jpeg"):
                        filepath = os.path.join(SNAPSHOT_DIR, filename)
                        # Get file modification time
                        mtime = os.path.getmtime(filepath)

                        # Extract camera code from filename (handle underscores like B1025_G)
                        name_without_ext = filename.rsplit(".", 1)[0]
                        parts = name_without_ext.split("_")

                        # Find where timestamp starts (first 8-digit date part)
                        camera_parts = []
                        for i, part in enumerate(parts):
                            if len(part) == 8 and part.isdigit():
                                camera_parts = parts[:i]
                                break

                        camera_code = (
                            "_".join(camera_parts) if camera_parts else parts[0]
                        )

                        # Extra log for raw parsing
                        print(
                            f"[AI_CONSUMER] Parsed '{filename}' -> camera_code='{camera_code}' (hex: {camera_code.encode('utf-8').hex()})"
                        )

                        # EARLY SKIP: Xóa files của cameras không có config (NO query!)
                        if not is_valid_camera(camera_code):
                            try:
                                # os.remove(filepath) # Keep it for a while for debugging if needed, but the user says empty folder.
                                # Actually, if it's unconfigured, we should delete it.
                                # But let's log it clearly.
                                print(
                                    f"[AI_CONSUMER] Skipping {filename}: camera {camera_code} not in valid list"
                                )
                                os.remove(filepath)
                            except Exception as e:
                                print(f"[AI_CONSUMER] Failed to delete {filepath}: {e}")
                            continue

                        snapshot_files.append((mtime, filepath, camera_code))

            # Sort by modification time (oldest first)
            snapshot_files.sort(key=lambda x: x[0])

            if snapshot_files:
                # Process in batches (up to MAX_PARALLEL_CAMERAS at a time)
                batch_size = min(len(snapshot_files), MAX_PARALLEL_CAMERAS)
                batch = snapshot_files[:batch_size]

                # Process batch in parallel
                tasks = [
                    process_one_snapshot(filepath, camera_code)
                    for _, filepath, camera_code in batch
                ]
                await asyncio.gather(*tasks, return_exceptions=True)

                # Update processed count
                processed_count += batch_size

                # Periodic GPU cache cleanup (every 100 images)
                if processed_count >= 100:
                    import torch

                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                        # print(f"[AI_CONSUMER] GPU cache cleared after {processed_count} images")
                    processed_count = 0

                # NO SLEEP - YOLO chạy liên tục để xử lý nhanh nhất có thể
            else:
                # No files to process, short sleep to avoid spinning CPU
                await asyncio.sleep(0.1)

        except Exception as e:
            print(f"[AI_CONSUMER] Main loop error: {e}")
            import traceback

            traceback.print_exc()
            await asyncio.sleep(5)


# Removed new_background_loop in favor of cleaner lifespan management


# ==========================
# LIFESPAN CONTEXT MANAGER
# ==========================
async def cleanup_old_storage_loop():
    """
    Background task to cleanup storage folders older than 30 days.
    Runs once every 24 hours.
    """
    base_storage_path = os.path.join("storage", "app", "cctv")
    if not os.path.exists(base_storage_path):
        os.makedirs(base_storage_path, exist_ok=True)

    while True:
        try:
            print("[CLEANUP] Starting periodic storage cleanup...")
            now = datetime.now()
            retention_days = 30

            if os.path.exists(base_storage_path):
                # List all YYYYMMDD folders
                for folder_name in os.listdir(base_storage_path):
                    folder_path = os.path.join(base_storage_path, folder_name)
                    if (
                        os.path.isdir(folder_path)
                        and len(folder_name) == 8
                        and folder_name.isdigit()
                    ):
                        try:
                            folder_date = datetime.strptime(folder_name, "%Y%m%d")
                            age = now - folder_date
                            if age.days > retention_days:
                                print(
                                    f"[CLEANUP] Deleting old folder: {folder_path} (age={age.days} days)"
                                )
                                shutil.rmtree(folder_path)
                        except ValueError:
                            # Not a YYYYMMDD folder, skip
                            continue

            print("[CLEANUP] Finished. Next run in 24 hours.")
        except Exception as e:
            print(f"[CLEANUP] Error during cleanup: {e}")

        # Wait 24 hours
        await asyncio.sleep(24 * 3600)


async def lifespan(app: FastAPI):
    """
    FastAPI startup/shutdown lifecycle.
    - Code BEFORE `yield`: startup init
    - Code AFTER  `yield`: shutdown cleanup
    """
    global snapshot_queue, qwen_semaphore, OLLAMA_CLIENT, OLLAMA_SEMAPHORE

    print("[STARTUP] Lifespan startup begin...")

    # 1) Preload ALL camera configs into memory (only once)
    preload_all_camera_configs()

    # 2) Init global queues/semaphores
    snapshot_queue = asyncio.Queue()
    qwen_semaphore = asyncio.Semaphore(QWEN_MAX_CONCURRENT)
    print(f"[STARTUP] Initialized snapshot queue (max={SNAPSHOT_QUEUE_MAX})")
    print(
        f"[STARTUP] Initialized Qwen semaphore (max_concurrent={QWEN_MAX_CONCURRENT})"
    )

    # 3) Init single Ollama client
    if OLLAMA_CLIENT is None:
        OLLAMA_CLIENT = AsyncClient(host=OLLAMA_URL)
        print(f"[STARTUP] Initialized Ollama AsyncClient: {OLLAMA_URL}")

    # 4) Init Ollama semaphore
    OLLAMA_SEMAPHORE = asyncio.Semaphore(OLLAMA_MAX_CONCURRENT)
    print(f"[STARTUP] Ollama max concurrent: {OLLAMA_MAX_CONCURRENT}")

    # 5) Warm-up YOLO (GPU) to avoid first-inference latency
    # NOTE: warmup_yolo_models() must be defined earlier (after YOLO models loaded)
    try:
        print("[STARTUP] YOLO warmup starting...")
        # chạy warmup trong thread để không block event loop quá lâu
        await asyncio.to_thread(warmup_yolo_models, 640, 10)  # imgsz=640, n=10
        print("[STARTUP] YOLO warmup finished ✅")
    except Exception as e:
        print(f"[STARTUP] YOLO warmup error (ignored): {e}")
    try:
        init_dino_once()
    except Exception as e:
        print(f"[STARTUP] DINO init error (ignored): {e}")
    # 6) Start storage cleanup loop (runs every 24h)
    asyncio.create_task(cleanup_old_storage_loop())

    # 7) Consumer will process snapshots from folder
    print(
        f"[STARTUP] AI Consumer will process snapshots from {SNAPSHOT_DIR}/ (oldest first)"
    )

    # 7) Start AI Consumer loop
    loop_task = asyncio.create_task(ai_consumer_loop())
    print("[STARTUP] Started AI Consumer background task")

    # 8) Start Capture Manager
    GLOBAL_CAP_MANAGER.start()

    # 9) Background task to sync Capture Manager with DB
    async def cap_sync_loop():
        while True:
            try:
                # Fetch new AI configs proactively so AI_CONSUMER validity states stay correct
                preload_all_camera_configs()

                cams = get_working_snap_cameras()
                GLOBAL_CAP_MANAGER.sync_with_db(cams)
            except Exception as e:
                print("[CAP_SYNC] Error:", e)
            await asyncio.sleep(60)  # Sync mỗi 1 phút

    cap_sync_task = asyncio.create_task(cap_sync_loop())

    # ===== FastAPI runs here =====
    yield

    # ===== Shutdown =====
    print("[SHUTDOWN] Lifespan shutdown begin...")
    GLOBAL_CAP_MANAGER.stop()
    loop_task.cancel()
    cap_sync_task.cancel()

    try:
        await asyncio.gather(loop_task, cap_sync_task, return_exceptions=True)
    except Exception:
        pass

    print("[SHUTDOWN] Lifespan shutdown done.")


# ==========================
# FASTAPI APP
# ==========================
app = FastAPI(title="CCTV AI Config + Test Server", lifespan=lifespan)

# Static folder (nếu sau này có css/js)
if not os.path.exists("static"):
    os.makedirs("static")

app.mount("/static", StaticFiles(directory="static"), name="static")

# Tự tạo thư mục storage nếu chưa có
if not os.path.exists("storage"):
    os.makedirs("storage", exist_ok=True)
app.mount("/api/storage", StaticFiles(directory="storage"), name="storage")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)


# ==========================
# Serve HTML
# ==========================
@app.get("/", response_class=HTMLResponse)
def serve_html():
    """Trang cấu hình polygon / actions"""
    if not os.path.exists("ai_config.html"):
        return HTMLResponse("<h1>Missing ai_config.html</h1>")
    return FileResponse("ai_config.html")


@app.get("/api/cctv/snapshot/{camera_code}")
async def get_latest_camera_snapshot(camera_code: str):
    """
    Polling API cho client: Trả về ảnh mới nhất trong SNAPSHOT_DIR.
    """
    NO_CACHE_HEADERS = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }

    # 1) Ưu tiên lấy trực tiếp từ Camera qua HTTP (chống chết khung hình do RTSP OpenCV)
    try:
        conn = get_conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT ip, cctv_url, username, password FROM cctv_tbl WHERE code = %s",
                    (camera_code,),
                )
                row = cur.fetchone()
        finally:
            conn.close()

        if row and row.get("ip"):
            ip = row["ip"]
            cctv_url = row.get("cctv_url") or "live.sdp"
            usr = row.get("username")
            pwd = row.get("password")

            # Fast HTTP snapshot fetch (timeout 5s)
            try:
                data = fetch_snapshot_bytes(ip, cctv_url, usr, pwd)
                if data:
                    return Response(
                        content=data,
                        media_type="image/jpeg",
                        headers=NO_CACHE_HEADERS,
                    )
            except Exception as e:
                print(f"[API] HTTP Fetch failed for {camera_code}: {e}")
    except Exception as e:
        print(f"[API] DB Error fetching IP for {camera_code}: {e}")

    # 2) Fallback 1: in-memory thread (OpenCV) nếu HTTP hỏng
    thread = GLOBAL_CAP_MANAGER.threads.get(camera_code)
    if thread:
        data = thread.get_latest_frame_bytes()
        if data:
            return Response(
                content=data,
                media_type="image/jpeg",
                headers=NO_CACHE_HEADERS,
            )

    # 3) Fallback 2: Tìm file mới nhất trong SNAPSHOT_DIR
    if not os.path.exists(SNAPSHOT_DIR):
        raise HTTPException(status_code=404, detail="Snapshot directory not found")

    files = [
        f
        for f in os.listdir(SNAPSHOT_DIR)
        if f.startswith(camera_code + "_") and f.lower().endswith((".jpg", ".jpeg"))
    ]

    if not files:
        raise HTTPException(
            status_code=404, detail=f"No recent snapshot for {camera_code}"
        )

    files.sort(
        key=lambda x: os.path.getmtime(os.path.join(SNAPSHOT_DIR, x)), reverse=True
    )
    latest_file = files[0]
    filepath = os.path.join(SNAPSHOT_DIR, latest_file)

    return FileResponse(filepath, headers=NO_CACHE_HEADERS)


@app.get("/test", response_class=HTMLResponse)
def test_page():
    """
    Trang test AI (select camera, test YOLO / Qwen).
    """
    return FileResponse("static/test.html")


@app.get("/api/cctv/ai/cameras")
def list_cameras():
    try:
        cams = get_cameras()
        return {"ret_code": 0, "data": cams}
    except Exception as e:
        print("ERROR get_cameras:", e)
        raise HTTPException(status_code=500, detail="DB error")


@app.post("/api/cctv/ai/config")
def update_camera_config_json(payload: Dict[str, Any]):
    """Cập nhật ai_config (JSON polygon/actions) cho 1 camera."""
    code = (payload.get("code") or "").strip()
    config_data = payload.get("ai_config")

    if not code:
        raise HTTPException(status_code=400, detail="code is required")

    sql = "UPDATE cctv_tbl SET ai_config = %s, updated_at = CURRENT_TIMESTAMP WHERE code = %s"
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, (json.dumps(config_data), code))
            conn.commit()

        # Refresh cache để các thread capture nhận diện ngay
        preload_all_camera_configs()

        return {"ret_code": 0, "msg": f"Updated config for {code}"}
    except Exception as e:
        print("ERROR update_camera_config_json:", e)
        raise HTTPException(status_code=500, detail="DB error")
    finally:
        conn.close()


@app.post("/api/cctv/acknowledge_alert")
def acknowledge_alert(payload: Dict[str, Any]):
    """Admin đã xem và tắt cảnh báo (Mute)."""
    camera_code = payload.get("camera_code")
    if not camera_code:
        raise HTTPException(status_code=400, detail="camera_code is required")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cctv_tbl SET alert_muted = 1 WHERE code = %s", (camera_code,)
            )
            conn.commit()
            return {"ret_code": 0, "msg": f"Alert muted for {camera_code}"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.get("/api/cctv/check_one")
def check_one_camera(camera_code: str):
    """Kiểm tra trạng thái 1 camera thủ công (không gửi mail)."""
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM cctv_tbl WHERE code = %s", (camera_code,))
            cam = cur.fetchone()
            if not cam:
                raise HTTPException(status_code=404, detail="Camera not found")

            status, msg = capture_single_ffmpeg(cam)

            # Reset consecutive_timeouts if successful, or increment (but this is manual, so maybe just update status)
            update_sql = "UPDATE cctv_tbl SET cctv_status = %s, updated_at = CURRENT_TIMESTAMP WHERE code = %s"
            cur.execute(update_sql, (status, camera_code))
            conn.commit()

            return {"ret_code": 0, "status": status, "msg": msg}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.post("/api/cctv/toggle_monitoring")
def toggle_monitoring(payload: Dict[str, Any]):
    """Bật/tắt giám sát 1 camera."""
    camera_code = payload.get("camera_code")
    is_monitored = 1 if payload.get("is_monitored") else 0

    if not camera_code:
        raise HTTPException(status_code=400, detail="camera_code is required")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE cctv_tbl SET is_monitored = %s WHERE code = %s",
                (is_monitored, camera_code),
            )
            conn.commit()
            return {
                "ret_code": 0,
                "msg": f"Monitoring {'enabled' if is_monitored else 'disabled'} for {camera_code}",
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        conn.close()


@app.get("/api/cctv/list")
def get_full_cctv_list(
    page: int = 1,
    per_page: int = 20,
    search: str = "",
    sort_field: str = "id",
    sort_order: str = "ASC",
):
    """Lấy danh sách tất cả camera với phân trang, tìm kiếm và sắp xếp."""
    search = search.strip()
    where_clause = ""
    params = []
    if search:
        where_clause = " WHERE code LIKE %s OR location LIKE %s OR ip LIKE %s "
        search_param = f"%{search}%"
        params = [search_param, search_param, search_param]

    # Validate sort_field to prevent SQL injection
    allowed_fields = [
        "id",
        "code",
        "username",
        "ip",
        "threshold",
        "cctv_status",
        "is_monitored",
        "alert_muted",
        "created_at",
        "updated_at",
    ]
    if sort_field not in allowed_fields:
        sort_field = "id"

    sort_order = "DESC" if sort_order.upper() == "DESC" else "ASC"
    print(
        f"DEBUG: get_full_cctv_list - sort: {sort_field} {sort_order}, search: {search}"
    )

    count_sql = "SELECT COUNT(*) as total FROM cctv_tbl " + where_clause
    list_sql = f"SELECT * FROM cctv_tbl {where_clause} ORDER BY {sort_field} {sort_order} LIMIT %s OFFSET %s"

    offset = (page - 1) * per_page
    list_params = params + [per_page, offset]

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(count_sql, tuple(params))
            total = cur.fetchone()["total"]

            cur.execute(list_sql, tuple(list_params))
            rows = cur.fetchall()

        for r in rows:
            if r.get("created_at"):
                r["created_at"] = r["created_at"].strftime("%Y-%m-%d %H:%M:%S")
            if r.get("updated_at"):
                r["updated_at"] = r["updated_at"].strftime("%Y-%m-%d %H:%M:%S")
            if r.get("threshold") is not None:
                r["threshold"] = float(r["threshold"])

        with conn.cursor() as cur:

            # 4. Calculate global stats (Total, Online, Warning, Offline)
            cur.execute(
                """
                SELECT 
                    SUM(CASE WHEN cctv_status = 'online' OR cctv_status IS NULL THEN 1 ELSE 0 END) as online_count,
                    SUM(CASE WHEN cctv_status = 'warning' THEN 1 ELSE 0 END) as warning_count,
                    SUM(CASE WHEN cctv_status = 'offline' THEN 1 ELSE 0 END) as offline_count
                FROM cctv_tbl
            """
            )
            stats = cur.fetchone()
            global_stats = {
                "total": int(
                    (stats["online_count"] or 0)
                    + (stats["warning_count"] or 0)
                    + (stats["offline_count"] or 0)
                ),
                "online": int(stats["online_count"] or 0),
                "warning": int(stats["warning_count"] or 0),
                "offline": int(stats["offline_count"] or 0),
            }

        return {
            "ret_code": 0,
            "data": rows,
            "stats": global_stats,
            "pagination": {
                "total": total,
                "per_page": per_page,
                "current_page": page,
                "total_pages": (
                    (total + per_page - 1) // per_page if per_page > 0 else 1
                ),
            },
        }
    except Exception as e:
        print("ERROR get_full_cctv_list:", e)
        raise HTTPException(status_code=500, detail="DB error")
    finally:
        conn.close()


# ==========================
# CH Factory Specific APIs
# ==========================


class LoginRequest(BaseModel):
    username: str
    password: str


class EmpnoRequest(BaseModel):
    empno: str


@app.post("/api/cctv/ch-login-aac")
async def ch_login(req: LoginRequest):
    """
    Xác thực user từ bảng user_tbl của nhà máy CH.
    """
    conn = get_conn_ch()
    try:
        with conn.cursor() as cur:
            sql = "SELECT user, password, role FROM user_tbl WHERE user = %s AND password = %s LIMIT 1"
            cur.execute(sql, (req.username, req.password))
            row = cur.fetchone()

            if not row:
                raise HTTPException(
                    status_code=401, detail="Invalid username or password"
                )

            is_manager = 1 if row["role"].lower() == "admin" else 0

            return {
                "name": row["user"],
                "username": row["user"],
                "empno": row["user"],  # Dùng user làm empno cho CH
                "session_token": f"ch_token_{int(time.time())}",
                "is_manager": is_manager,
            }
    finally:
        conn.close()


@app.post("/api/cctv/checkEmployeeStatus")
async def ch_check_status(req: EmpnoRequest):
    """
    Kiểm tra quyền truy cập dựa trên role trong user_tbl.
    """
    conn = get_conn_ch()
    try:
        with conn.cursor() as cur:
            sql = "SELECT role FROM user_tbl WHERE user = %s LIMIT 1"
            cur.execute(sql, (req.empno,))
            row = cur.fetchone()

            if not row:
                return {"allow": False, "is_manager": 0, "reason": "User not found"}

            is_manager = 1 if row["role"].lower() == "admin" else 0
            return {"allow": True, "is_manager": is_manager}
    finally:
        conn.close()


@app.post("/api/cctv/heartbeat")
async def ch_heartbeat(payload: Dict[str, Any] = Body(None)):
    return {"status": "ok", "time": datetime.now().isoformat()}


@app.post("/api/cctv/logout")
async def ch_logout(payload: Dict[str, Any] = Body(None)):
    return {"status": "logged_out"}


@app.get("/api/cctv/layout/get")
async def ch_get_layout():
    """
    Lấy danh sách camera đã được đặt vị trí trên map.
    Format khớp với VG (ret_code, msg, data, sensors).
    """
    conn = get_conn_ch()
    try:
        with conn.cursor() as cur:
            # Join cctv_layout_tbl với cctv_tbl để lấy ip, location_json
            # COLLATE utf8mb4_general_ci để tránh lỗi mix collation
            sql = """
                SELECT 
                    l.id,
                    l.camera_code,
                    l.x_percent,
                    l.y_percent,
                    l.cam_type,
                    l.view_distance,
                    l.view_angle,
                    l.view_radius,
                    l.created_at,
                    c.ip,
                    c.location as location_json,
                    c.status
                FROM cctv_layout_tbl l
                JOIN cctv_tbl c ON c.code COLLATE utf8mb4_general_ci = l.camera_code COLLATE utf8mb4_general_ci
                ORDER BY l.camera_code ASC
            """
            cur.execute(sql)
            rows = cur.fetchall()

            # Xử lý location_json string sang object
            for row in rows:
                if isinstance(row.get("location_json"), str):
                    try:
                        row["location_json"] = json.loads(row["location_json"])
                    except:
                        pass

            # Lấy danh sách sensor
            cur.execute(
                """
                SELECT 
                    id, 
                    device_id, 
                    location, 
                    x_percent, 
                    y_percent, 
                    sensor_type, 
                    created_at
                FROM sensor_layout_tbl
            """
            )
            sensor_rows = cur.fetchall()

            return {
                "ret_code": 0,
                "msg": "OK",
                "data": rows,
                "sensors": sensor_rows,
            }
    finally:
        conn.close()


@app.get("/api/cctv/layout/unmapped")
async def ch_unmapped_layout():
    """
    Lấy danh sách camera từ cctv_tbl chưa có trong cctv_layout_tbl.
    """
    conn = get_conn_ch()
    try:
        with conn.cursor() as cur:
            sql = """
                SELECT code, location, status
                FROM cctv_tbl
                WHERE code COLLATE utf8mb4_general_ci NOT IN (
                    SELECT camera_code COLLATE utf8mb4_general_ci FROM cctv_layout_tbl
                )
                ORDER BY code ASC
            """
            cur.execute(sql)
            rows = cur.fetchall()

            for row in rows:
                if isinstance(row.get("location"), str):
                    try:
                        row["location"] = json.loads(row["location"])
                    except:
                        pass

            return {
                "ret_code": 0,
                "msg": "OK",
                "total_unmapped": len(rows),
                "data": rows,
            }
    finally:
        conn.close()


class LayoutItem(BaseModel):
    camera_code: str
    x_percent: float
    y_percent: float
    cam_type: str = "lower"
    view_distance: Optional[float] = None
    view_angle: Optional[float] = None
    view_radius: Optional[float] = None


class LayoutBatchRequest(BaseModel):
    items: List[LayoutItem]


@app.post("/api/cctv/layout/save")
async def ch_save_layout(req: LayoutBatchRequest):
    """
    Lưu layout mảng items.
    """
    if not req.items:
        return {"ret_code": -1, "msg": "No layout items to save"}

    conn = get_conn_ch()
    try:
        with conn.cursor() as cur:
            sql = """
                INSERT INTO cctv_layout_tbl (camera_code, x_percent, y_percent, cam_type, view_distance, view_angle, view_radius)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE 
                    x_percent = VALUES(x_percent), 
                    y_percent = VALUES(y_percent), 
                    cam_type = VALUES(cam_type),
                    view_distance = VALUES(view_distance),
                    view_angle = VALUES(view_angle),
                    view_radius = VALUES(view_radius)
            """
            for item in req.items:
                cur.execute(
                    sql,
                    (
                        item.camera_code,
                        item.x_percent,
                        item.y_percent,
                        item.cam_type,
                        item.view_distance,
                        item.view_angle,
                        item.view_radius,
                    ),
                )

            return {"ret_code": 0, "msg": "Layout saved successfully"}
    except Exception as e:
        return {"ret_code": -2, "msg": f"DB error: {str(e)}"}
    finally:
        conn.close()


@app.post("/api/cctv/layout/delete")
async def ch_delete_layout(req: Dict[str, str] = Body(...)):
    camera_code = req.get("camera_code")
    if not camera_code:
        return {"ret_code": -1, "msg": "camera_code is required"}

    conn = get_conn_ch()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM cctv_layout_tbl WHERE camera_code = %s", (camera_code,)
            )
            return {"ret_code": 0, "msg": f"Deleted layout for {camera_code}"}
    finally:
        conn.close()


class SensorItem(BaseModel):
    device_id: str
    location: str
    x_percent: Optional[float] = None
    y_percent: Optional[float] = None
    sensor_type: Optional[str] = None


class SensorBatchRequest(BaseModel):
    items: List[SensorItem]


@app.post("/api/cctv/layout/saveSensor")
async def ch_save_sensor_layout(req: SensorBatchRequest):
    """
    Lưu tọa độ sensor
    """
    if not req.items:
        return {"ret_code": -1, "msg": "No layout items to save"}

    conn = get_conn_ch()
    try:
        with conn.cursor() as cur:
            sql = """
                INSERT INTO sensor_layout_tbl (device_id, location, x_percent, y_percent, sensor_type)
                VALUES (%s, %s, %s, %s, %s)
                ON DUPLICATE KEY UPDATE 
                    location = VALUES(location),
                    x_percent = VALUES(x_percent), 
                    y_percent = VALUES(y_percent), 
                    sensor_type = VALUES(sensor_type)
            """
            for item in req.items:
                cur.execute(
                    sql,
                    (
                        item.device_id,
                        item.location,
                        item.x_percent,
                        item.y_percent,
                        item.sensor_type,
                    ),
                )
            conn.commit()
            return {"ret_code": 0, "msg": "Layout saved successfully"}
    except Exception as e:
        return {"ret_code": -2, "msg": f"DB error: {str(e)}"}
    finally:
        conn.close()


@app.post("/api/cctv/layout/deleteSensor")
async def ch_delete_sensor_layout(req: Dict[str, str] = Body(...)):
    device_id = req.get("device_id")
    if not device_id:
        return {"ret_code": -1, "msg": "device_id is required"}

    conn = get_conn_ch()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM sensor_layout_tbl WHERE device_id = %s", (device_id,)
            )
            conn.commit()
            return {"ret_code": 0, "msg": f"Deleted layout for {device_id}"}
    finally:
        conn.close()


@app.post("/api/cctv/insertWarningFromAAC")
async def local_insert_warning_from_aac(
    camera_code: str = Form(...),
    event_code: str = Form(...),
    boxes: Optional[str] = Form(None),
    fullshot_url: UploadFile = File(...),
):
    """
    Endpoint nhận cảnh báo từ AAC gửi sang (Chạy ngay trên localhost:8001).
    Lưu ảnh vào static/cctv/YYYYMMDD/fullshot/ và insert DB warning_tbl.
    """
    try:
        # 1. Tạo thư mục lưu trữ theo ngày (Đổi sang storage/app/cctv)
        today_str = datetime.now().strftime("%Y%m%d")
        base_dir = os.path.join("storage", "app", "cctv", today_str, "fullshot")
        os.makedirs(base_dir, exist_ok=True)

        # 2. Lưu file ảnh
        timestamp = datetime.now().strftime("%H%M%S")
        filename = f"{camera_code}_{timestamp}_full.jpg"
        filepath = os.path.join(base_dir, filename)

        with open(filepath, "wb") as f:
            f.write(await fullshot_url.read())

        # Đường dẫn lưu vào DB (định dạng app/cctv/...)
        db_full_path = f"app/cctv/{today_str}/fullshot/{filename}"

        # 3. Insert vào database warning_tbl
        conn = get_conn_ch()
        try:
            with conn.cursor() as cur:
                sql = """
                    INSERT INTO warning_tbl (camera_code, event_code, fullshot_url, boxes, created_at)
                    VALUES (%s, %s, %s, %s, %s)
                """
                cur.execute(
                    sql,
                    (
                        camera_code,
                        event_code,
                        db_full_path,
                        boxes,
                        datetime.now(),
                    ),
                )
                conn.commit()
                last_id = cur.lastrowid

            return {
                "ret_code": 0,
                "msg": "From AAC",
                "data": {"id": last_id, "camera_code": camera_code},
            }
        finally:
            conn.close()

    except Exception as e:
        print(f"[LOCAL_WARN_API] Error: {e}")
        return {"ret_code": -1, "msg": str(e)}


@app.get("/api/cctv/warning/recent")
async def ch_recent_warnings(
    minutes: int = 240,
    camera_code: Optional[str] = None,
):
    """
    Lấy cảnh báo gần nhất trong `minutes` phút qua, tùy chọn lọc theo camera_code.
    Khớp format với Laravel getRecentWarnings.
    """
    conn = get_conn_ch()
    try:
        with conn.cursor() as cur:
            where = "created_at >= NOW() - INTERVAL %s MINUTE"
            params: List[Any] = [minutes]

            if camera_code:
                where += " AND camera_code = %s"
                params.append(camera_code)

            sql = f"""
                SELECT
                    id, camera_code, event_code,
                    thumbshot_url, fullshot_url, boxes,
                    created_at,
                    UNIX_TIMESTAMP(created_at) as created_unix
                FROM warning_tbl
                WHERE {where}
                ORDER BY created_at DESC
                LIMIT 200
            """
            cur.execute(sql, params)
            rows = cur.fetchall()

            # Serialize datetime if needed
            for row in rows:
                if hasattr(row.get("created_at"), "isoformat"):
                    row["created_at"] = row["created_at"].isoformat()

            return {"ret_code": 0, "msg": "OK", "data": rows}
    finally:
        conn.close()


@app.post("/api/cctv/getManageWarnings")
async def ch_get_manage_warnings(payload: Dict[str, Any] = Body(...)):
    """
    Endpoint cho trang ManageEvents, giả lập format của VG.
    """
    page = payload.get("page", 1)
    per_page = payload.get("per_page", 20)
    offset = (page - 1) * per_page

    event_code = payload.get("event_code")
    camera_code = payload.get("camera_code")
    from_date = payload.get("from_date")
    to_date = payload.get("to_date")

    conn = get_conn_ch()
    try:
        with conn.cursor() as cur:
            # Xây dựng câu query filters
            where_clauses_base = ["1=1"]
            params_base = []

            if camera_code:
                where_clauses_base.append("camera_code LIKE %s")
                params_base.append(f"%{camera_code}%")

            if from_date:
                where_clauses_base.append("created_at >= %s")
                params_base.append(f"{from_date} 00:00:00")

            if to_date:
                where_clauses_base.append("created_at <= %s")
                params_base.append(f"{to_date} 23:59:59")

            where_str_base = " AND ".join(where_clauses_base)

            where_clauses = list(where_clauses_base)
            params = list(params_base)

            if event_code and event_code != "all":
                where_clauses.append("event_code = %s")
                params.append(event_code)

            where_str = " AND ".join(where_clauses)

            # 1) Đếm tổng số lượng
            cur.execute(
                f"SELECT COUNT(*) as total FROM warning_tbl WHERE {where_str}", params
            )
            total_res = cur.fetchone()
            total = total_res["total"] if total_res else 0

            # 2) Lấy data trang hiện tại
            sql_data = f"""
                SELECT 
                    id, 
                    camera_code, 
                    event_code,
                    created_at,
                    UNIX_TIMESTAMP(created_at) as created_unix,
                    fullshot_url,
                    thumbshot_url,
                    boxes
                FROM warning_tbl 
                WHERE {where_str}
                ORDER BY created_at DESC 
                LIMIT %s OFFSET %s
            """
            cur.execute(sql_data, params + [per_page, offset])
            items = cur.fetchall()

            # Serialize datetime fields
            for item in items:
                if hasattr(item.get("created_at"), "isoformat"):
                    item["created_at"] = item["created_at"].isoformat()

            # 3) Đếm counts từng loại (theo filters thời gian, KHÔNG lọc theo event_code)
            cur.execute(
                f"SELECT event_code, COUNT(*) as count FROM warning_tbl WHERE {where_str_base} GROUP BY event_code",
                params_base,
            )
            counts_rows = cur.fetchall()

            cur.execute(
                f"SELECT COUNT(*) as total_all FROM warning_tbl WHERE {where_str_base}",
                params_base,
            )
            total_all_res = cur.fetchone()
            total_all = total_all_res["total_all"] if total_all_res else 0

            counts = {
                "all": total_all,
                "smartphone": 0,
                "intruder": 0,
                "fire": 0,
                "crowb": 0,
                "crowb2": 0,
            }
            for cr in counts_rows:
                etype = cr["event_code"]
                if etype in counts:
                    counts[etype] = cr["count"]

            return {
                "ret_code": 0,
                "msg": "ok",
                "data": {
                    "items": items,
                    "pagination": {
                        "total": total,
                        "per_page": per_page,
                        "current_page": page,
                        "total_pages": (total + per_page - 1) // per_page,
                        "has_next": page * per_page < total,
                        "has_prev": page > 1,
                    },
                    "counts": counts,
                },
            }
    finally:
        conn.close()


@app.post("/api/cctv/ai/add_camera")
def add_new_camera(payload: Dict[str, Any]):
    """Thêm camera mới vào cctv_tbl."""
    code = (payload.get("code") or "").strip()
    ip = (payload.get("ip") or "").strip()
    if not code or not ip:
        raise HTTPException(status_code=400, detail="code and ip are required")

    username = payload.get("username") or "admin"
    password = payload.get("password") or ""
    threshold = (
        payload.get("threshold") if payload.get("threshold") is not None else 0.6
    )

    # Mặc định location JSON nếu không có
    location = payload.get("location")
    if not location:
        location = json.dumps({"vi": "", "en": "", "cn": ""})

    cctv_url = payload.get("cctv_url") or "live.sdp"

    sql = """
        INSERT INTO cctv_tbl (code, username, password, ip, threshold, location, cctv_url)
        VALUES (%s, %s, %s, %s, %s, %s, %s)
    """
    params = (code, username, password, ip, threshold, location, cctv_url)

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            # Kiểm tra trùng mã
            cur.execute("SELECT id FROM cctv_tbl WHERE code = %s", (code,))
            if cur.fetchone():
                raise HTTPException(
                    status_code=400, detail=f"Camera code {code} already exists"
                )

            cur.execute(sql, params)
            conn.commit()

        # Refresh cache
        preload_all_camera_configs()

        return {"ret_code": 0, "msg": f"Added camera {code}"}
    except HTTPException:
        raise
    except Exception as e:
        print("ERROR add_new_camera:", e)
        raise HTTPException(status_code=500, detail="DB Error")
    finally:
        conn.close()


@app.post("/api/cctv/ai/update_camera")
def update_camera_metadata(payload: Dict[str, Any]):
    cam_id = payload.get("id")
    if not cam_id:
        raise HTTPException(status_code=400, detail="Missing camera ID")

    new_code = (payload.get("code") or "").strip()
    username = payload.get("username")
    password = payload.get("password")
    ip = payload.get("ip")
    threshold = payload.get("threshold")
    location = payload.get("location")
    cctv_url = payload.get("cctv_url")

    conn = get_conn()
    try:
        with conn.cursor() as cur:
            # 1. Lấy thông tin cũ để so sánh code
            cur.execute("SELECT code FROM cctv_tbl WHERE id = %s", (cam_id,))
            old_row = cur.fetchone()
            if not old_row:
                raise HTTPException(status_code=404, detail="Camera not found")

            old_code = old_row["code"]

            # 2. Xây dựng SQL update cho cctv_tbl
            sets = []
            params = []
            if new_code and new_code != old_code:
                sets.append("code = %s")
                params.append(new_code)
            if username is not None:
                sets.append("username = %s")
                params.append(username)
            if password is not None:
                sets.append("password = %s")
                params.append(password)
            if ip is not None:
                sets.append("ip = %s")
                params.append(ip)
            if threshold is not None:
                sets.append("threshold = %s")
                params.append(threshold)
            if location is not None:
                sets.append("location = %s")
                params.append(location)
            if cctv_url is not None:
                sets.append("cctv_url = %s")
                params.append(cctv_url)
            if payload.get("is_monitored") is not None:
                sets.append("is_monitored = %s")
                params.append(payload.get("is_monitored"))
            if payload.get("alert_muted") is not None:
                sets.append("alert_muted = %s")
                params.append(payload.get("alert_muted"))

            if sets:
                sets.append("updated_at = CURRENT_TIMESTAMP")
                sql = "UPDATE cctv_tbl SET " + ", ".join(sets) + " WHERE id = %s"
                params.append(cam_id)
                cur.execute(sql, tuple(params))

                # 3. Nếu đổi code, cập nhật các bảng liên quan
                if new_code and new_code != old_code:
                    cur.execute(
                        "UPDATE warning_tbl SET camera_code = %s WHERE camera_code = %s",
                        (new_code, old_code),
                    )
                    cur.execute(
                        "UPDATE cctv_layout_tbl SET camera_code = %s WHERE camera_code = %s",
                        (new_code, old_code),
                    )

            conn.commit()

        # Refresh cache
        preload_all_camera_configs()

        return {"ret_code": 0, "msg": f"Updated camera ID {cam_id}"}
    except Exception as e:
        print("ERROR update_camera_metadata:", e)
        raise HTTPException(status_code=500, detail="DB Error")
    finally:
        conn.close()


# ==========================
# API: proxy snapshot (cho trang config UI)
# ==========================
@app.get("/api/cctv/proxy/snapshot")
def proxy_snapshot(ip: str):
    """
    Proxy ảnh snapshot từ camera.
    Ưu tiên lấy từ in-memory thread nếu IP khớp.
    """
    if not ip:
        raise HTTPException(status_code=400, detail="ip required")

    # 1) Kiểm tra xem có thread nào đang capture IP này không
    code = getattr(GLOBAL_CAP_MANAGER, "ip_to_code", {}).get(ip)
    if code:
        thread = GLOBAL_CAP_MANAGER.threads.get(code)
        if thread:
            data = thread.get_latest_frame_bytes()
            if data:
                return Response(content=data, media_type="image/jpeg")

    # 2) Fallback: Fetch trực tiếp (chậm)
    try:
        data = fetch_snapshot_bytes(ip)
        return Response(content=data, media_type="image/jpeg")
    except Exception as e:
        print("proxy error:", e)
        raise HTTPException(status_code=502, detail=str(e))


@app.get("/api/cctv/proxy/snapshot_by_url")
def proxy_snapshot_by_url(url: str):
    """
    Proxy ảnh snapshot từ camera bằng full URL (đã embed user/pass):
    browser -> fastapi -> camera(URL) -> fastapi -> browser

    Ví dụ client gọi:
    /api/cctv/proxy/snapshot_by_url?url=http%3A%2F%2Fps%3Aps%254012345%4010.13.16.32%2Fcgi-bin%2Fviewer%2Fvideo.jpg%3Fresolution%3D1920x1080
    """
    if not url:
        raise HTTPException(status_code=400, detail="url required")

    # (Optional) security: chỉ cho phép http://10.* hoặc http://192.168.* nếu bạn muốn
    # if not url.startswith("http://10."):
    #     raise HTTPException(status_code=400, detail="invalid target")

    try:
        data = fetch_snapshot_by_url(url)
        return Response(content=data, media_type="image/jpeg")
    except Exception as e:
        print("proxy_snapshot_by_url error:", e)
        raise HTTPException(status_code=502, detail=str(e))


def create_roi_collage_from_boxes(img: Image.Image, person_boxes: List[Dict[str, Any]]):
    """
    Returns: (collage_img, roi_images, boxes_sorted)
    """
    if not person_boxes:
        return None, [], []

    boxes_sorted = sorted(person_boxes, key=lambda x: x["x1"])
    roi_images = []
    for b in boxes_sorted:
        roi = img.crop((b["x1"], b["y1"], b["x2"], b["y2"]))
        roi_images.append(roi)

    padding = 10
    max_h = max(r.height for r in roi_images)
    total_w = sum(r.width for r in roi_images) + padding * (len(roi_images) - 1)

    collage = Image.new("RGB", (total_w, max_h), (255, 255, 255))
    x = 0
    for r in roi_images:
        y = (max_h - r.height) // 2
        collage.paste(r, (x, y))
        x += r.width + padding

    return collage, roi_images, boxes_sorted


def detect_phone_dino_roi(
    roi_image: Image.Image, threshold: float = 0.3
) -> Dict[str, Any]:
    """
    Return: {has_phone, confidence}
    """
    if DINO_MODEL is None or DINO_PROCESSOR is None:
        return {"has_phone": False, "confidence": 0.0, "error": "DINO not initialized"}

    labels = "phone."
    inputs = DINO_PROCESSOR(images=roi_image, text=labels, return_tensors="pt").to(
        DINO_DEVICE
    )

    with torch.no_grad():
        outputs = DINO_MODEL(**inputs)

    # post-process (api mới)
    try:
        result = DINO_PROCESSOR.post_process_grounded_object_detection(
            outputs,
            inputs.input_ids,
            box_threshold=threshold,
            text_threshold=threshold,
            target_sizes=[roi_image.size[::-1]],
        )[0]
        scores = [float(s) for s in result.get("scores", [])]
        lbls = [str(l) for l in result.get("labels", [])]
    except TypeError:
        # fallback api cũ
        result = DINO_PROCESSOR.post_process_grounded_object_detection(
            outputs, inputs.input_ids, target_sizes=[roi_image.size[::-1]]
        )[0]
        scores = [float(s) for s in result.get("scores", [])]
        lbls = [str(l) for l in result.get("labels", [])]
        # lọc threshold tay
        filtered = [(l, s) for l, s in zip(lbls, scores) if s >= threshold]
        lbls = [l for l, _ in filtered]
        scores = [s for _, s in filtered]

    has_phone = any("phone" in l.lower() for l in lbls)
    max_score = max(scores) if scores else 0.0

    return {"has_phone": has_phone, "confidence": max_score, "labels": lbls}


# ==========================
# CORE: chạy AI trên 1 ảnh + cfg (full – dùng cho TEST)
# ==========================
async def run_ai_for_image(
    cam: str, img: Image.Image, cfg: Dict[str, Any]
) -> Dict[str, Any]:
    """
    Chạy full pipeline (people / climb / fire) trên 1 ảnh + ai_config.
    Trả về kết quả chi tiết (không kèm prompts_used).

    ⚠️ Hàm này giữ nguyên để dùng cho endpoint /api/cctv/test/detect.
    Vòng loop auto sẽ dùng các hàm Yolo-only / Ollama-only riêng.
    """
    w, h = img.size

    actions_cfg = cfg.get("actions", {})
    regions_cfg = cfg.get("regions", {})

    flag_count = bool(actions_cfg.get("count_people"))
    flag_climb = bool(actions_cfg.get("detect_climb"))
    flag_fire = bool(actions_cfg.get("detect_fire"))

    climb_poly = None
    fire_poly = None
    people_poly = None

    # ===== Count people – ưu tiên polygon PEOPLE, fallback full frame =====
    result_count: Optional[Dict[str, Any]] = None
    if flag_count:
        try:
            max_allowed_raw = cfg.get("max_people_allowed")
            max_allowed = (
                int(max_allowed_raw) if max_allowed_raw not in (None, "") else 0
            )

            people_regions = regions_cfg.get("people") or []
            crop_box = None
            target_img = img

            if people_regions and people_regions[0].get("points"):
                people_poly = people_regions[0]["points"]
                l, t, r, b = polygon_to_bbox(people_poly, w, h)
                crop_box = {"left": l, "top": t, "right": r, "bottom": b}
                target_img = img.crop((l, t, r, b))

            yolo_out = detect_people_yolo(target_img)
            people_count = yolo_out["people_count"]
            avg_conf = yolo_out["avg_confidence"]

            is_over_limit = bool(max_allowed and people_count > max_allowed)

            result_count = {
                "ok": True,
                "parsed": {
                    "people_count": people_count,
                    "confidence": avg_conf,
                    "max_allowed": max_allowed,
                    "is_over_limit": is_over_limit,
                    "source": "yolo11x",
                },
                "polygon": people_poly,
                "crop_box": crop_box,
            }
        except Exception as e:
            print("count_people (YOLO) error:", e)
            result_count = {
                "ok": False,
                "error": str(e),
            }

    # ===== Detect climb – crop theo polygon climb =====
    result_climb = None
    if flag_climb:
        climb_regions = regions_cfg.get("climb") or []
        if climb_regions and climb_regions[0].get("points"):
            climb_poly = climb_regions[0]["points"]
            l, t, r, b = polygon_to_bbox(climb_poly, w, h)
            crop_img = img.crop((l, t, r, b))
            buf = io.BytesIO()
            crop_img.save(buf, format="JPEG")
            crop_bytes = buf.getvalue()

            try:
                parsed, raw = await call_ollama_json(
                    crop_bytes, SUB_PROMPTS["detect_climb"]  # Pass bytes!
                )

                parsed = postprocess_climb(parsed)

                result_climb = {
                    "ok": True,
                    "parsed": parsed,
                    "raw": raw,
                    "crop_box": {"left": l, "top": t, "right": r, "bottom": b},
                }
            except Exception as e:
                print("detect_climb error:", e)
                result_climb = {
                    "ok": False,
                    "error": str(e),
                }
        else:
            result_climb = {
                "ok": False,
                "error": "no polygon config for climb",
            }

    # ===== Detect fire – crop theo polygon fire =====
    result_fire = None
    if flag_fire:
        fire_regions = regions_cfg.get("fire") or []
        if fire_regions and fire_regions[0].get("points"):
            fire_poly = fire_regions[0]["points"]
            l, t, r, b = polygon_to_bbox(fire_poly, w, h)
            crop_img = img.crop((l, t, r, b))
            buf = io.BytesIO()
            crop_img.save(buf, format="JPEG")
            crop_bytes = buf.getvalue()

            try:
                parsed, raw = await call_ollama_json(
                    crop_bytes, SUB_PROMPTS["detect_fire"]  # Pass bytes directly!
                )
                result_fire = {
                    "ok": True,
                    "parsed": parsed,
                    "raw": raw,
                    "crop_box": {"left": l, "top": t, "right": r, "bottom": b},
                }
            except Exception as e:
                print("detect_fire error:", e)
                result_fire = {
                    "ok": False,
                    "error": str(e),
                }
        else:
            result_fire = {
                "ok": False,
                "error": "no polygon config for fire",
            }

    return {
        "camera_code": cam,
        "image_size": {"width": w, "height": h},
        "has_ai_config": bool(cfg),
        "actions_enabled": {
            "count_people": flag_count,
            "detect_climb": flag_climb,
            "detect_fire": flag_fire,
        },
        "polygons": {
            "people": people_poly,
            "climb": climb_poly,
            "fire": fire_poly,
        },
        "results": {
            "count_people": result_count,
            "detect_climb": result_climb,
            "detect_fire": result_fire,
        },
    }


@app.post("/api/cctv/test/detect")
async def test_detect(
    camera_code: str = Form(...),
    file: UploadFile = File(...),
):
    """
    Test tay: upload 1 ảnh + camera_code, trả full result để UI vẽ polygon / box.
    """
    cam = camera_code.strip()
    if not cam:
        raise HTTPException(status_code=400, detail="camera_code is required")

    raw_bytes = await file.read()
    try:
        img = Image.open(io.BytesIO(raw_bytes)).convert("RGB")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid image")

    cfg = get_ai_config_by_code(cam)
    if not cfg:
        cfg = {"actions": {}, "regions": {}}

    # Vẫn dùng full pipeline (YOLO + Ollama) cho test
    full_result = await run_ai_for_image(cam, img, cfg)
    full_result["prompts_used"] = {
        "global": GLOBAL_PROMPT,
        "sub": SUB_PROMPTS,
    }
    return full_result


# Khởi chạy luồng monitor ngay khi module được load
# (Để đảm bảo nó chạy kể cả khi start bằng uvicorn main:app)
# Dùng flag để tránh khởi động 2 lần khi uvicorn reload
if not _FLUSH_THREAD_STARTED:
    _FLUSH_THREAD_STARTED = True
    monitor_thread = threading.Thread(target=background_health_monitor, daemon=True)
    monitor_thread.start()

    flush_thread = threading.Thread(target=flush_alerts_loop, daemon=True)
    flush_thread.start()

if __name__ == "__main__":

    print(f"🚀 Starting server at http://{API_HOST}:{API_PORT}")
    uvicorn.run("main:app", host=API_HOST, port=API_PORT, reload=False)

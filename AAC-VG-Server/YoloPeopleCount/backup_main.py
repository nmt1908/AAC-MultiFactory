import os
import json
import io
import base64
import asyncio
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone
import cv2 
import pymysql
from pymysql.cursors import DictCursor
from dotenv import load_dotenv
from fastapi import (
    FastAPI,
    HTTPException,
    UploadFile,
    File,
    Form,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
import uvicorn
import requests
from requests.auth import HTTPBasicAuth, HTTPDigestAuth
from PIL import Image
import httpx
from ultralytics import YOLO  # 👈 YOLO

LOG_DIR = "logs"
os.makedirs(LOG_DIR, exist_ok=True)
PS_DEMO_LOG_PATH = os.path.join(LOG_DIR, "ps_demo_log.txt")


def log_ps_demo(message: str):
    """
    Ghi log riêng cho camera PSDEMO vào file logs/ps_demo_log.txt
    """
    ts = datetime.now().isoformat()
    try:
        with open(PS_DEMO_LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"[{ts}] {message}\n")
    except Exception as e:
        # fallback: nếu lỗi ghi file thì in ra console để vẫn thấy
        print("[PS_DEMO_LOG_ERROR]", e, "when logging:", message)


# ==========================
# LOAD .env
# ==========================
load_dotenv()

DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_NAME = os.getenv("DB_NAME", "cctv_db")
DB_USER = os.getenv("DB_USER", "root")
DB_PASS = os.getenv("DB_PASS", "")

API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8001"))

# account dùng chung cho HTTP snapshot
SNAP_USER = os.getenv("SNAP_USER", "ps")
SNAP_PASS = os.getenv("SNAP_PASS", "ps@12345")

# Ollama
OLLAMA_URL = os.getenv("OLLAMA_URL", "http://10.13.34.181:11434/api/generate")
VISION_MODEL = os.getenv("CCTV_VISION_MODEL", "qwen3-vl:4b-instruct")

# YOLO model for people counting
YOLO_MODEL_PATH = os.getenv("YOLO_MODEL_PATH", "yolo11x.pt")
YOLO_MODEL = YOLO(YOLO_MODEL_PATH)

# Laravel warning endpoint
WARNING_API_URL = os.getenv(
    "WARNING_API_URL",
    "http://gmo021.cansportsvg.com/api/cctv/insertWarningFromAVG",
)

# CORS: mở hết cho dễ test
CORS_ORIGINS = ["*"]

# Thời gian nghỉ giữa 2 vòng loop tổng (không phải interval per camera)
BACKGROUND_LOOP_INTERVAL_SEC = int(os.getenv("AI_LOOP_INTERVAL_SEC", "1"))

# Số camera xử lý song song tối đa
MAX_CONCURRENT_CAMERAS = int(os.getenv("MAX_CONCURRENT_CAMERAS", "60"))
CAMERA_SEMAPHORE = asyncio.Semaphore(MAX_CONCURRENT_CAMERAS)

# ==== NEW: giới hạn concurrent call tới Ollama riêng ====
OLLAMA_MAX_CONCURRENT = int(os.getenv("OLLAMA_MAX_CONCURRENT", "4"))
OLLAMA_SEMAPHORE = asyncio.Semaphore(OLLAMA_MAX_CONCURRENT)

# ===== Demo video for a specific camera (E4018) =====
VIDEO_DEMO_CODE = os.getenv("DEMO_VIDEO_CAMERA_CODE", "B1025_G")
VIDEO_DEMO_PATH = os.getenv("DEMO_VIDEO_PATH", "videofirekhung.mp4")
VIDEO_DEMO_INTERVAL_SEC = float(os.getenv("DEMO_VIDEO_INTERVAL_SEC", "0.5"))  # 500ms

_video_demo_state = {
    "cap": None,
    "fps": None,
    "frame_step": None,
}

# ==========================
# DB helper
# ==========================
def get_conn():
    return pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASS,
        database=DB_NAME,
        cursorclass=DictCursor,
        autocommit=True,
    )


def get_cameras() -> List[Dict[str, Any]]:
    """
    Lấy danh sách camera từ cctv_tbl để cấu hình AI (UI).
    Chỉ lấy camera capture_method = 'snap'.
    """
    sql = """
        SELECT id, code, ip, cctv_url, ai_config
        FROM cctv_tbl
        WHERE capture_method = 'snap'
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


def get_working_snap_cameras() -> List[Dict[str, Any]]:
    """
    Lấy camera working + snap để chạy loop auto.
    Lấy thêm ai_result để check last_run_ts.
    """
    sql = """
        SELECT id, code, ip, cctv_url, ai_config, ai_result, status
        FROM cctv_tbl
        WHERE capture_method = 'snap'
          AND ip IS NOT NULL
          AND ip <> ''
    """
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall()
    finally:
        conn.close()
    return rows


def get_ai_config_by_code(camera_code: str) -> Optional[Dict[str, Any]]:
    """
    Lấy riêng ai_config của 1 camera (dùng cho endpoint test detect).
    """
    sql = """
        SELECT ai_config
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
        return json.loads(row["ai_config"])
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


def save_ai_result(camera_code: str, ai_result: Dict[str, Any]):
    """
    Lưu kết quả AI rút gọn vào cột ai_result (JSON).
    KHÔNG để NULL – luôn ghi ít nhất status + last_run_ts.
    """
    payload = json.dumps(ai_result, ensure_ascii=False)

    sql = """
        UPDATE cctv_tbl
        SET ai_result = %s
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
def polygon_to_bbox(points: List[Dict[str, float]], width: int, height: int, pad: int = 4):
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
    results = YOLO_MODEL(image)
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
        "  \"people_count\": <int>,\n"
        "  \"confidence\": <float between 0 and 1>,\n"
        "  \"explanation\": \"short English description of where each person is, "
        "e.g. '1 man climbing fence on the right, 3 people running in the middle, "
        "2 people in the background street, ...'\"\n"
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
        "  \"has_climbing\": true | false,\n"
        "  \"confidence\": <float between 0 and 1>,\n"
        "  \"description\": \"short English description about what you see, "
        "including how the person is interacting with the barrier\"\n"
        "}\n"
    ),
    "detect_fire": (
        "Task: Check if there is visible fire or heavy smoke in this region.\n"
        "Return JSON with this schema exactly:\n"
        "{\n"
        '  "has_fire": true | false,\n'
        '  "confidence": <float between 0 and 1>,\n'
        '  "description": "short English description about what you see"\n'
        "}\n"
    ),
}


def _parse_ollama_resp(data: Dict[str, Any]) -> str:
    """
    Ollama /generate với stream=false trả về JSON có field 'response'
    chứa string (cũng là JSON). Hàm này lấy ra phần đó.
    """
    if isinstance(data, dict) and isinstance(data.get("response"), str):
        return data["response"]
    return ""


async def call_ollama_json(b64img: str, sub_prompt: str, model: Optional[str] = None):
    # ==== NEW: giới hạn concurrency + timeout riêng cho Ollama ====
    payload = {
        "model": model or VISION_MODEL,
        "prompt": GLOBAL_PROMPT + "\n" + sub_prompt,
        "images": [b64img],
        "format": "json",
        "options": {"temperature": 0.0},
        "stream": False,
    }
    timeout = httpx.Timeout(connect=5.0, read=25.0, write=5.0, pool=5.0)
    async with OLLAMA_SEMAPHORE:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.post(OLLAMA_URL, json=payload)
            r.raise_for_status()
            data = r.json()
    text = _parse_ollama_resp(data)
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




# ==========================
# Snapshot helper (server side)
# ==========================
def fetch_snapshot_bytes(ip: str) -> bytes:
    """
    Gọi snapshot trực tiếp từ camera (server-side).
    Trả về bytes JPEG.
    """
    if not ip:
        raise ValueError("ip required")

    url = f"http://{ip}/cgi-bin/viewer/video.jpg?resolution=1920x1080"
    print(f"[fetch_snapshot_bytes] GET {url}")

    try:
        resp = requests.get(
            url,
            auth=HTTPBasicAuth(SNAP_USER, SNAP_PASS),
            timeout=5,
        )
        print("[fetch_snapshot_bytes] basic status:", resp.status_code)

        if resp.status_code == 401:
            resp = requests.get(
                url,
                auth=HTTPDigestAuth(SNAP_USER, SNAP_PASS),
                timeout=5,
            )
            print("[fetch_snapshot_bytes] digest status:", resp.status_code)

        if resp.status_code != 200:
            raise Exception(f"Camera returned {resp.status_code}")

        return resp.content
    except Exception as e:
        print("fetch_snapshot_bytes error:", e)
        raise


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
# WARNING endpoint helper
# ==========================
def make_thumbnail(jpeg_bytes: bytes, max_width: int = 480) -> bytes:
    """
    Tạo thumbnail từ JPEG bytes, giữ tỉ lệ, max_width.
    Nếu ảnh nhỏ sẵn thì trả lại như cũ.
    """
    try:
        img = Image.open(io.BytesIO(jpeg_bytes)).convert("RGB")
    except Exception:
        # lỗi đọc ảnh thì dùng luôn ảnh gốc
        return jpeg_bytes

    w, h = img.size
    if w <= max_width:
        return jpeg_bytes

    new_w = max_width
    new_h = int(h * new_w / w)
    img = img.resize((new_w, new_h), Image.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return buf.getvalue()


def send_warning_event(camera_code: str, event_code: str, full_bytes: bytes):
    """
    Gửi cảnh báo lên Laravel qua insertWarningFromAVG.
    - camera_code
    - event_code (crowb / intruder / fire)
    - fullshot_url (ảnh full)
    - thumbshot_url (ảnh nhỏ)
    """
    if not WARNING_API_URL:
        print("[WARN_API] WARNING_API_URL not set, skip")
        return

    try:
        thumb_bytes = make_thumbnail(full_bytes)
    except Exception as e:
        print("[WARN_API] make_thumbnail error:", e)
        thumb_bytes = full_bytes

    data = {
        "camera_code": camera_code,
        "event_code": event_code,
    }
    files = {
        "fullshot_url": (f"{camera_code}_full.jpg", full_bytes, "image/jpeg"),
        "thumbshot_url": (f"{camera_code}_thumb.jpg", thumb_bytes, "image/jpeg"),
    }

    try:
        resp = requests.post(
            WARNING_API_URL, data=data, files=files, timeout=10
        )
        print(
            f"[WARN_API] {camera_code} {event_code} "
            f"status={resp.status_code} body={resp.text[:200]}"
        )
    except Exception as e:
        print(f"[WARN_API] error sending warning for {camera_code} {event_code}: {e}")

def get_demo_frame_bytes() -> bytes:
    """
    Lấy 1 frame từ VIDEO_DEMO_PATH, nhảy thêm ~VIDEO_DEMO_INTERVAL_SEC (500ms) mỗi lần gọi.
    Trả về bytes JPEG giống như fetch_snapshot_bytes.
    """
    global _video_demo_state

    if not os.path.exists(VIDEO_DEMO_PATH):
        raise FileNotFoundError(f"Demo video not found: {VIDEO_DEMO_PATH}")

    cap = _video_demo_state.get("cap")
    fps = _video_demo_state.get("fps")
    frame_step = _video_demo_state.get("frame_step")

    # Khởi tạo VideoCapture + tính số frame cần nhảy cho mỗi 500ms
    if cap is None:
        cap = cv2.VideoCapture(VIDEO_DEMO_PATH)
        if not cap.isOpened():
            raise RuntimeError(f"Cannot open demo video: {VIDEO_DEMO_PATH}")

        fps = cap.get(cv2.CAP_PROP_FPS)
        if not fps or fps <= 0:
            fps = 25.0  # fallback nếu video không report FPS

        frame_step = max(1, int(round(fps * VIDEO_DEMO_INTERVAL_SEC)))

        _video_demo_state["cap"] = cap
        _video_demo_state["fps"] = fps
        _video_demo_state["frame_step"] = frame_step

        print(f"[DEMO_VIDEO] Opened {VIDEO_DEMO_PATH}, fps={fps:.2f}, frame_step={frame_step}")

    # Đọc tiếp frame: nhảy frame_step frame để tương đương ~500ms
    cap = _video_demo_state["cap"]
    frame_step = _video_demo_state["frame_step"]

    frame = None
    for _ in range(frame_step):
        ret, frame = cap.read()
        if not ret:
            # Nếu tới cuối video thì vòng lại từ đầu
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ret, frame = cap.read()
            if not ret:
                raise RuntimeError("Cannot read frame from demo video")

    # Encode JPEG
    ok, buf = cv2.imencode(".jpg", frame)
    if not ok:
        raise RuntimeError("Failed to encode demo frame to JPEG")

    return buf.tobytes()

# ==========================
# FASTAPI APP
# ==========================
app = FastAPI(title="CCTV AI Config + Test Server")

# Static folder (nếu sau này có css/js)
if not os.path.exists("static"):
    os.makedirs("static")

app.mount("/static", StaticFiles(directory="static"), name="static")

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


@app.get("/test", response_class=HTMLResponse)
def serve_test_html():
    """Trang test upload ảnh & vẽ polygon/bbox"""
    if not os.path.exists("ai_test.html"):
        return HTMLResponse("<h1>Missing ai_test.html</h1>")
    return FileResponse("ai_test.html")


# ==========================
# API: danh sách camera & lưu config
# ==========================
@app.get("/api/cctv/ai/cameras")
def list_cameras():
    try:
        cams = get_cameras()
        return {"ret_code": 0, "data": cams}
    except Exception as e:
        print("ERROR get_cameras:", e)
        raise HTTPException(status_code=500, detail="DB error")


@app.post("/api/cctv/ai/config")
def update_ai_config(payload: Dict[str, Any]):
    cam = (payload.get("camera_code") or "").strip()
    if not cam:
        raise HTTPException(status_code=400, detail="camera_code is required")

    try:
        save_ai_config(
            camera_code=cam,
            actions=payload.get("actions") or {},
            interval_seconds=int(payload.get("interval_seconds", 5)),  # default 5s
            regions=payload.get("regions") or {},
            max_people_allowed=payload.get("max_people_allowed"),
        )
        return {"ret_code": 0, "msg": f"Saved ai_config for {cam}"}
    except Exception as e:
        print("ERROR update_ai_config:", e)
        raise HTTPException(status_code=500, detail="Failed to save ai_config")


# ==========================
# API: proxy snapshot (cho trang config UI)
# ==========================
@app.get("/api/cctv/proxy/snapshot")
def proxy_snapshot(ip: str):
    """
    Proxy ảnh snapshot từ camera:
    browser -> fastapi -> camera -> fastapi -> browser
    Dùng user/password SNAP_USER / SNAP_PASS.
    """
    if not ip:
        raise HTTPException(status_code=400, detail="ip required")

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


# ==========================
# CORE: chạy AI trên 1 ảnh + cfg (full – dùng cho TEST)
# ==========================
async def run_ai_for_image(cam: str, img: Image.Image, cfg: Dict[str, Any]) -> Dict[str, Any]:
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
            max_allowed = int(max_allowed_raw) if max_allowed_raw not in (None, "") else 0

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
            if (cam or "").strip().upper() == "PSDEMO":
                log_ps_demo(
                    "[run_ai_for_image] count_people -> "
                    f"max_allowed_raw={max_allowed_raw!r}, "
                    f"max_allowed={max_allowed}, "
                    f"people_count={people_count}, "
                    f"avg_conf={avg_conf:.3f}, "
                    f"is_over_limit={is_over_limit}"
                )
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
            b64_crop = base64.b64encode(buf.getvalue()).decode("utf-8")

            try:
                parsed, raw = await call_ollama_json(
                    b64_crop, SUB_PROMPTS["detect_climb"]
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
            b64_crop = base64.b64encode(buf.getvalue()).decode("utf-8")

            try:
                parsed, raw = await call_ollama_json(
                    b64_crop, SUB_PROMPTS["detect_fire"]
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


# ==== NEW: Hàm chỉ chạy YOLO (dùng cho loop auto) ====
async def run_ai_for_image_yolo_only(cam: str, img: Image.Image, cfg: Dict[str, Any]) -> Dict[str, Any]:
    w, h = img.size

    actions_cfg = cfg.get("actions", {})
    regions_cfg = cfg.get("regions", {})

    flag_count = bool(actions_cfg.get("count_people"))

    people_poly = None
    result_count: Optional[Dict[str, Any]] = None

    if flag_count:
        try:
            max_allowed_raw = cfg.get("max_people_allowed")
            max_allowed = int(max_allowed_raw) if max_allowed_raw not in (None, "") else 0

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
            if (cam or "").strip().upper() == "PSDEMO":
                log_ps_demo(
                    "[run_ai_for_image_yolo_only] count_people -> "
                    f"max_allowed_raw={max_allowed_raw!r}, "
                    f"max_allowed={max_allowed}, "
                    f"people_count={people_count}, "
                    f"avg_conf={avg_conf:.3f}, "
                    f"is_over_limit={is_over_limit}"
                )
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
            print("count_people (YOLO only) error:", e)
            result_count = {
                "ok": False,
                "error": str(e),
            }

    return {
        "camera_code": cam,
        "image_size": {"width": w, "height": h},
        "has_ai_config": bool(cfg),
        "actions_enabled": {
            "count_people": flag_count,
            # Climb/Fire không xử lý ở đây
            "detect_climb": bool(actions_cfg.get("detect_climb")),
            "detect_fire": bool(actions_cfg.get("detect_fire")),
        },
        "polygons": {
            "people": people_poly,
            "climb": None,
            "fire": None,
        },
        "results": {
            "count_people": result_count,
            "detect_climb": None,
            "detect_fire": None,
        },
    }


def summarize_result_for_db(full: Dict[str, Any]) -> Dict[str, Any]:
    """
    Rút gọn kết quả để lưu vào ai_result:
    - Không lưu polygon / crop_box / description dài.
    - Chỉ giữ các flag & số liệu quan trọng.
    """
    img_size = full.get("image_size") or {}
    actions = full.get("actions_enabled") or {}
    res = full.get("results") or {}

    summary: Dict[str, Any] = {
        "camera_code": full.get("camera_code"),
        "image_width": img_size.get("width"),
        "image_height": img_size.get("height"),
        "actions_enabled": actions,
    }

    # People
    people_info = None
    r_count = res.get("count_people")
    if r_count:
        people_info = {
            "ok": r_count.get("ok", False),
            "people_count": None,
            "confidence": None,
            "max_allowed": None,
            "is_over_limit": None,
        }
        parsed = r_count.get("parsed") or {}
        if isinstance(parsed, dict):
            people_info["people_count"] = parsed.get("people_count")
            people_info["confidence"] = parsed.get("confidence")
            people_info["max_allowed"] = parsed.get("max_allowed")
            people_info["is_over_limit"] = parsed.get("is_over_limit")
        if not r_count.get("ok"):
            people_info["error"] = r_count.get("error")
    summary["people"] = people_info

    # Climb
    climb_info = None
    r_climb = res.get("detect_climb")
    if r_climb:
        climb_info = {
            "ok": r_climb.get("ok", False),
            "has_climbing": None,
            "confidence": None,
        }
        parsed = r_climb.get("parsed") or {}
        if isinstance(parsed, dict):
            climb_info["has_climbing"] = parsed.get("has_climbing")
            climb_info["confidence"] = parsed.get("confidence")
        if not r_climb.get("ok"):
            climb_info["error"] = r_climb.get("error")
    summary["climb"] = climb_info

    # Fire
    fire_info = None
    r_fire = res.get("detect_fire")
    if r_fire:
        fire_info = {
            "ok": r_fire.get("ok", False),
            "has_fire": None,
            "confidence": None,
        }
        parsed = r_fire.get("parsed") or {}
        if isinstance(parsed, dict):
            fire_info["has_fire"] = parsed.get("has_fire")
            fire_info["confidence"] = parsed.get("confidence")
        if not r_fire.get("ok"):
            fire_info["error"] = r_fire.get("error")
    summary["fire"] = fire_info

    return summary


# ==== NEW: task nền xử lý Climb/Fire bằng Ollama, không block loop ====
async def run_ollama_for_climb_fire_and_update_db(
    code: str,
    img: Image.Image,
    cfg: Dict[str, Any],
    snap_bytes: bytes,
    base_summary: Dict[str, Any],
):
    """
    Chạy detect_climb + detect_fire bằng Ollama trong background.
    - Không đụng tới YOLO/people nữa (đã có trong base_summary).
    - Cập nhật thêm climb/fire vào ai_result.
    - Gửi warning intruder/fire nếu có.

    Hàm này được gọi bằng asyncio.create_task(...)
    nên có try/except để không làm crash event loop.
    """
    try:
        w, h = img.size
        actions_cfg = cfg.get("actions") or {}
        regions_cfg = cfg.get("regions") or {}

        flag_climb = bool(actions_cfg.get("detect_climb"))
        flag_fire = bool(actions_cfg.get("detect_fire"))

        result_climb = None
        result_fire = None

        # ----- CLIMB -----
        if flag_climb:
            climb_regions = regions_cfg.get("climb") or []
            if climb_regions and climb_regions[0].get("points"):
                climb_poly = climb_regions[0]["points"]
                l, t, r, b = polygon_to_bbox(climb_poly, w, h)
                crop_img = img.crop((l, t, r, b))
                buf = io.BytesIO()
                crop_img.save(buf, format="JPEG")
                b64_crop = base64.b64encode(buf.getvalue()).decode("utf-8")
                try:
                    parsed, raw = await call_ollama_json(
                        b64_crop, SUB_PROMPTS["detect_climb"]
                    )
                    parsed = postprocess_climb(parsed)
                    result_climb = {
                        "ok": True,
                        "parsed": parsed,
                        "raw": raw,
                        "crop_box": {"left": l, "top": t, "right": r, "bottom": b},
                    }
                except Exception as e:
                    print(f"[{code}] detect_climb (background) error:", e)
                    result_climb = {"ok": False, "error": str(e)}
            else:
                result_climb = {
                    "ok": False,
                    "error": "no polygon config for climb",
                }

        # ----- FIRE -----
        if flag_fire:
            fire_regions = regions_cfg.get("fire") or []
            if fire_regions and fire_regions[0].get("points"):
                fire_poly = fire_regions[0]["points"]
                l, t, r, b = polygon_to_bbox(fire_poly, w, h)
                crop_img = img.crop((l, t, r, b))
                buf = io.BytesIO()
                crop_img.save(buf, format="JPEG")
                b64_crop = base64.b64encode(buf.getvalue()).decode("utf-8")
                try:
                    parsed, raw = await call_ollama_json(
                        b64_crop, SUB_PROMPTS["detect_fire"]
                    )
                    result_fire = {
                        "ok": True,
                        "parsed": parsed,
                        "raw": raw,
                        "crop_box": {"left": l, "top": t, "right": r, "bottom": b},
                    }
                except Exception as e:
                    print(f"[{code}] detect_fire (background) error:", e)
                    result_fire = {"ok": False, "error": str(e)}
            else:
                result_fire = {
                    "ok": False,
                    "error": "no polygon config for fire",
                }

        # Build full để tận dụng summarize_result_for_db
        full = {
            "camera_code": code,
            "image_size": {
                "width": base_summary.get("image_width"),
                "height": base_summary.get("image_height"),
            },
            "has_ai_config": True,
            "actions_enabled": base_summary.get("actions_enabled") or {},
            "polygons": {
                "people": None,
                "climb": None,
                "fire": None,
            },
            "results": {
                "count_people": None,
                "detect_climb": result_climb,
                "detect_fire": result_fire,
            },
        }

        cf_summary = summarize_result_for_db(full)

        # Merge vào base_summary (keep people / last_run_ts / status)
        merged = dict(base_summary)  # shallow copy
        if cf_summary.get("climb") is not None:
            merged["climb"] = cf_summary["climb"]
        if cf_summary.get("fire") is not None:
            merged["fire"] = cf_summary["fire"]

        # Lưu lại
        await asyncio.to_thread(save_ai_result, code, merged)

        # Gửi warning intruder/fire nếu cần
        climb = merged.get("climb") or {}
        fire = merged.get("fire") or {}

        try:
            if climb.get("ok") and climb.get("has_climbing"):
                await asyncio.to_thread(send_warning_event, code, "intruder", snap_bytes)
        except Exception as e:
            print(f"[{code}] send_warning intruder (background) error:", e)

        try:
            if fire.get("ok") and fire.get("has_fire"):
                await asyncio.to_thread(send_warning_event, code, "fire", snap_bytes)
        except Exception as e:
            print(f"[{code}] send_warning fire (background) error:", e)

    except Exception as e:
        print(f"[{code}] run_ollama_for_climb_fire_and_update_db fatal error:", e)


# ==========================
# API: TEST DETECT (upload ảnh – dùng cho UI test)
# ==========================
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


# ==========================
# XỬ LÝ 1 CAMERA (song song)
# ==========================
async def process_camera_row(row: Dict[str, Any], now: datetime, now_iso: str) -> Dict[str, Any]:
    """
    Xử lý AI cho 1 camera (dùng trong asyncio.gather).
    Trả về dict chứa status để tổng hợp thống kê.

    ⚠️ ĐÃ ĐỔI: 
    - Vòng chính chỉ chạy snapshot + YOLO + crowd warning + save.
    - Climb/fire chạy nền bằng Ollama, không block.
    """
    async with CAMERA_SEMAPHORE:
        code = row.get("code")
        ip = row.get("ip")
        raw_cfg = row.get("ai_config")
        raw_ai_res = row.get("ai_result")

        # Parse ai_config
        cfg: Dict[str, Any] = {}
        if raw_cfg:
            try:
                cfg = json.loads(raw_cfg)
            except Exception as e:
                print(f"[{code}] parse ai_config error:", e)
                err_obj = {
                    "camera_code": code,
                    "status": "ai_config_parse_error",
                    "error": str(e),
                    "last_run_ts": now_iso,
                }
                await asyncio.to_thread(save_ai_result, code, err_obj)
                return {"camera": code, "status": "ai_config_parse_error", "error": str(e)}

        actions_cfg = cfg.get("actions") or {}

        # Không có action nào bật -> vẫn ghi JSON "no_actions_configured"
        if not any(actions_cfg.values()):
            ai_res_obj = {
                "camera_code": code,
                "actions_enabled": actions_cfg,
                "status": "no_actions_configured",
                "last_run_ts": now_iso,
            }
            await asyncio.to_thread(save_ai_result, code, ai_res_obj)
            return {"camera": code, "status": "no_actions_configured"}

        # interval mặc định 5s nếu không có
        interval_seconds = int(cfg.get("interval_seconds") or 5)

        # Parse ai_result để lấy last_run_ts
        last_run_ts = None
        if raw_ai_res:
            try:
                ai_res_obj_prev = json.loads(raw_ai_res)
                ts_str = ai_res_obj_prev.get("last_run_ts")
                if ts_str:
                    dt = datetime.fromisoformat(ts_str)
                    if dt.tzinfo is None:
                        dt = dt.replace(tzinfo=timezone.utc)
                    last_run_ts = dt
            except Exception as e:
                print(f"[{code}] parse previous ai_result error:", e)

        # Check interval
        if last_run_ts is not None:
            diff_sec = (now - last_run_ts).total_seconds()
            if diff_sec < interval_seconds:
                # giữ ai_result cũ, không ghi mới
                return {"camera": code, "status": "skipped_interval"}

        # ===== Đến hạn chạy AI cho camera này =====
        try:
            # fetch_snapshot_bytes là hàm sync → chạy trong threadpool
            snap_bytes = await asyncio.to_thread(fetch_snapshot_bytes, ip)
            img = Image.open(io.BytesIO(snap_bytes)).convert("RGB")
                # ===== Đến hạn chạy AI cho camera này =====
        # try:
        #     # 🔥 Camera demo: dùng video thay vì snapshot từ IP
        #     if (code or "").strip().upper() == (VIDEO_DEMO_CODE or "").strip().upper():
        #         snap_bytes = await asyncio.to_thread(get_demo_frame_bytes)
        #     else:
        #         # Camera bình thường: lấy snapshot từ IP
        #         snap_bytes = await asyncio.to_thread(fetch_snapshot_bytes, ip)

        #     img = Image.open(io.BytesIO(snap_bytes)).convert("RGB")

        except Exception as e:
            msg = f"snapshot error: {e}"
            print(f"[{code}] {msg}")
            err_obj = {
                "camera_code": code,
                "status": "snapshot_error",
                "error": str(e),
                "last_run_ts": now_iso,
            }
            await asyncio.to_thread(save_ai_result, code, err_obj)
            return {"camera": code, "status": "snapshot_error", "error": str(e)}

        try:
            # ==== NEW: chỉ chạy YOLO trong luồng chính ====
            full_result_yolo = await run_ai_for_image_yolo_only(code, img, cfg)
            summary = summarize_result_for_db(full_result_yolo)
            summary["last_run_ts"] = now_iso
            summary["status"] = "ok"
            await asyncio.to_thread(save_ai_result, code, summary)

            # ======= CHECK EVENTS & GỬI WARNING cho CROWD ngay lập tức =======
            ppl = summary.get("people") or {}
            climb = summary.get("climb") or {}
            fire = summary.get("fire") or {}

            if (code or "").strip().upper() == "PSDEMO":
                try:
                    log_ps_demo(
                        "[process_camera_row] summary.people = "
                        + json.dumps(ppl, ensure_ascii=False)
                    )
                except Exception:
                    log_ps_demo(
                        "[process_camera_row] summary.people (raw) = "
                        + repr(ppl)
                    )

            # Đám đông (crowd) – is_over_limit == True
                        # Đám đông (crowd) – is_over_limit == True && confidence > 0.7
            try:
                conf = ppl.get("confidence")
                conf_ok = isinstance(conf, (int, float)) and conf is not None and conf > 0.7

                if ppl.get("ok") and ppl.get("is_over_limit") and conf_ok:
                    if (code or "").strip().upper() == "PSDEMO":
                        log_ps_demo(
                            "[process_camera_row] is_over_limit=True & "
                            f"confidence={conf:.3f} > 0.7 -> "
                            "sending 'crowb' warning. "
                            f"people_count={ppl.get('people_count')}, "
                            f"max_allowed={ppl.get('max_allowed')}"
                        )
                    await asyncio.to_thread(send_warning_event, code, "crowb", snap_bytes)
            except Exception as e:
                print(f"[{code}] send_warning crowd error:", e)


            # ==== NEW: tạo task nền xử lý climb/fire bằng Ollama (không block) ====
            if actions_cfg.get("detect_climb") or actions_cfg.get("detect_fire"):
                try:
                    asyncio.create_task(
                        run_ollama_for_climb_fire_and_update_db(
                            code, img, cfg, snap_bytes, summary
                        )
                    )
                except Exception as e:
                    print(f"[{code}] create_task climb/fire error:", e)

            # ⚠️ Không chờ climb/fire; trả về luôn
            return {"camera": code, "status": "ok"}

        except Exception as e:
            msg = f"ai_run (YOLO part) error: {e}"
            print(f"[{code}] {msg}")
            err_obj = {
                "camera_code": code,
                "status": "ai_run_error",
                "error": str(e),
                "last_run_ts": now_iso,
            }
            await asyncio.to_thread(save_ai_result, code, err_obj)
            return {"camera": code, "status": "ai_run_error", "error": str(e)}


# ==========================
# AUTO LOOP – chạy 1 vòng cho tất cả camera (song song)
# ==========================
async def run_ai_loop_once() -> Dict[str, Any]:
    """
    Chạy 1 vòng AI cho tất cả camera (theo kiểu song song):
      - Lấy camera capture_method='snap', ip != ''.
      - Mỗi camera YOLO được xử lý trong process_camera_row (async).
      - Climb/fire xử lý nền, không block vòng loop.
    """
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()

    cams = get_working_snap_cameras()
    total = len(cams)

    # Tạo task cho từng camera
    tasks = [process_camera_row(row, now, now_iso) for row in cams]

    results: List[Any] = await asyncio.gather(*tasks, return_exceptions=True)

    processed = 0
    skipped_interval = 0
    skipped_no_config = 0
    errors: List[Dict[str, Any]] = []

    for res in results:
        if isinstance(res, Exception):
            # Lỗi bất ngờ ở mức task
            print("[AI LOOP] task exception:", repr(res))
            errors.append({"camera": None, "error": repr(res)})
            continue

        code = res.get("camera")
        status = res.get("status")

        if status == "ok":
            processed += 1
        elif status == "skipped_interval":
            skipped_interval += 1
        elif status == "no_actions_configured":
            skipped_no_config += 1
        else:
            # các lỗi khác: ai_config_parse_error / snapshot_error / ai_run_error ...
            errors.append(
                {"camera": code, "status": status, "error": res.get("error")}
            )

    return {
        "ret_code": 0,
        "total": total,
        "processed": processed,
        "skipped_due_interval": skipped_interval,
        "skipped_no_actions": skipped_no_config,
        "errors": errors,
        "now": now_iso,
    }


# (optional) vẫn để endpoint debug nếu cần xem status mỗi lần gọi tay
@app.post("/api/cctv/ai/run_loop_once")
async def run_ai_loop_once_api():
    return await run_ai_loop_once()


# ==========================
# BACKGROUND LOOP – TỰ CHẠY LIÊN TỤC
# ==========================
async def background_loop():
    print(f"[AI LOOP] Background loop started, interval={BACKGROUND_LOOP_INTERVAL_SEC}s")
    while True:
        try:
            result = await run_ai_loop_once()
            print("[AI LOOP] tick:", result)
        except Exception as e:
            print("[AI LOOP] unexpected error:", e)
        await asyncio.sleep(BACKGROUND_LOOP_INTERVAL_SEC)


@app.on_event("startup")
async def on_startup():
    # Tạo background task, không block server
    asyncio.create_task(background_loop())


# ==========================
# ENTRYPOINT: python main.py
# ==========================
if __name__ == "__main__":
    print(f"🚀 Starting server at http://{API_HOST}:{API_PORT}")
    uvicorn.run("main:app", host=API_HOST, port=API_PORT, reload=False)

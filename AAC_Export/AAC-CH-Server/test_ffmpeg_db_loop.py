import os
import time
import subprocess
from datetime import datetime
import pymysql
from urllib.parse import quote
from concurrent.futures import ThreadPoolExecutor, as_completed
import re

DB_HOST = "localhost"
DB_PORT = 3306
DB_NAME = "avg_db"
DB_USER = "root"
DB_PASS = "abcd@1234"
SNAP_USER = "it"
SNAP_PASS = "Chihung@12"

SNAPSHOT_DIR = "test_snapshots_loop"
os.makedirs(SNAPSHOT_DIR, exist_ok=True)


def sanitize_filename(name):
    # Loại bỏ ký tự cấm của Windows để không bị lỗi Invalid Argument
    return re.sub(r'[\\/*?:"<>|]', "_", name)


def get_cameras():
    conn = pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASS,
        database=DB_NAME,
        cursorclass=pymysql.cursors.DictCursor,
    )
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT code, ip, username, password, cctv_url FROM cctv_tbl WHERE ip IS NOT NULL AND ip != ''"
            )
            return cur.fetchall()
    finally:
        conn.close()


def capture_single(cam, iteration):
    raw_code = cam["code"]
    code = sanitize_filename(raw_code)
    ip = cam["ip"]
    user = cam.get("username") or SNAP_USER
    pw = cam.get("password") or SNAP_PASS
    url_suffix = cam.get("cctv_url") or "live.sdp"

    u_enc, p_enc = quote(user, safe=""), quote(pw, safe="")
    rtsp_url = f"rtsp://{u_enc}:{p_enc}@{ip}:554/{url_suffix}"

    # Ghi đè file jpg ở mỗi iteration
    filepath = os.path.join(SNAPSHOT_DIR, f"{code}.jpg")

    cmd = ["ffmpeg", "-y"]

    cmd.extend(
        [
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
            "-update",
            "1",
            filepath,
        ]
    )

    try:
        # Ép khung thời gian 4.5s để trừ hao code python chạy
        res = subprocess.run(
            cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, timeout=4.5
        )
        if res.returncode == 0 and os.path.exists(filepath):
            return {"code": raw_code, "status": "SUCCESS", "msg": "OK"}

        err_msg = res.stderr.decode("utf-8").strip()
        last_line = err_msg.split("\n")[-1] if err_msg else "Unknown Error"
        if "401 Unauthorized" in last_line:
            return {
                "code": raw_code,
                "status": "AUTH_ERROR",
                "msg": "Sai mật khẩu (401)",
            }
        return {"code": raw_code, "status": "ERROR", "msg": last_line}
    except subprocess.TimeoutExpired:
        return {"code": raw_code, "status": "TIMEOUT", "msg": "Timeout (chậm hơn 4.5s)"}
    except Exception as e:
        return {"code": raw_code, "status": "SYS_ERROR", "msg": str(e)}


def main():
    cameras = get_cameras()
    print(
        f"🚀 Bắt đầu loop 6 lần cho {len(cameras)} camera (Chu kỳ 5s/lần). Dữ liệu lưu tại {SNAPSHOT_DIR}/"
    )

    # Bộ đếm Tracking
    tracker = {
        cam["code"]: {
            "SUCCESS": 0,
            "TIMEOUT": 0,
            "AUTH_ERROR": 0,
            "ERROR": 0,
            "SYS_ERROR": 0,
            "LAST_MSG": "",
        }
        for cam in cameras
    }

    total_iterations = 6
    for i in range(1, total_iterations + 1):
        print(f"\n--- Đang chạy Lần thứ {i}/{total_iterations} ---")
        start_t = time.time()

        with ThreadPoolExecutor(max_workers=len(cameras)) as executor:
            futures = [executor.submit(capture_single, cam, i) for cam in cameras]
            for future in as_completed(futures):
                res = future.result()
                code = res["code"]
                status = res["status"]
                tracker[code][status] += 1
                if status != "SUCCESS":
                    tracker[code]["LAST_MSG"] = res["msg"]

        elapsed = time.time() - start_t
        # Đảm bảo mỗi vòng lặp tốn đúng 5 giây theo yêu cầu
        sleep_time = 5.0 - elapsed
        if sleep_time > 0 and i < total_iterations:
            print(
                f"Hoàn thành Lần {i} trong {elapsed:.2f}s. Chờ {sleep_time:.2f}s để qua Lần {i+1}..."
            )
            time.sleep(sleep_time)
        else:
            print(f"Hoàn thành Lần {i} trong {elapsed:.2f}s.")

    # PHÂN LOẠI REPORT
    always_success = []
    flaky = []
    auth_errors = []
    always_timeout = []
    other_errors = []

    for code, stats in tracker.items():
        if stats["SUCCESS"] == total_iterations:
            always_success.append(code)
        elif stats["SUCCESS"] > 0:
            flaky.append((code, stats["SUCCESS"]))
        elif stats["AUTH_ERROR"] == total_iterations:
            auth_errors.append(code)
        elif stats["TIMEOUT"] == total_iterations:
            always_timeout.append((code, stats["LAST_MSG"]))
        else:
            other_errors.append((code, stats["LAST_MSG"]))

    report_lines = []
    report_lines.append(
        f"====== TỔNG KẾT SAU 30 GIÂY ({total_iterations} LẦN CHỤP) TRÊN {len(cameras)} CAMERA ======"
    )
    report_lines.append(
        f"Hoàn hảo (100% Success {total_iterations}/{total_iterations} lần): {len(always_success)} cam"
    )
    report_lines.append(f"Chập chờn (Có lúc được lúc không): {len(flaky)} cam")
    report_lines.append(f"Lỗi Sai Mật Khẩu (100% Khước từ): {len(auth_errors)} cam")
    report_lines.append(f"Lỗi Chậm Timeout (Luôn luôn > 5s): {len(always_timeout)} cam")
    report_lines.append(
        f"Lỗi RTSP Bị Chết (100% lỗi mạng/sai link): {len(other_errors)} cam\n"
    )

    report_lines.append("\n--- CHI TIẾT CÁC CAM BỊ LỖI CẦN FIX ---")

    if flaky:
        report_lines.append(
            f"\n[1] CÁC CAM CHẬP CHỜN (Đường truyền lag, {len(flaky)} cam):"
        )
        for code, wins in flaky:
            report_lines.append(
                f"  - {code}: Rớt hình, chỉ thành công {wins}/{total_iterations} lần chớp."
            )

    if auth_errors:
        report_lines.append(
            f"\n[2] CÁC CAM SAI MẬT KHẨU HOẶC UNAUTHORIZED (Sửa trong database, {len(auth_errors)} cam):"
        )
        for code in auth_errors:
            report_lines.append(f"  - {code}")

    if always_timeout:
        report_lines.append(
            f"\n[3] CÁC CAM LUÔN LUÔN CHẬM TIMEOUT SAU 5 GIÂY (Mạng nội bộ chậm/Treo Camera, {len(always_timeout)} cam):"
        )
        for code, msg in always_timeout:
            report_lines.append(f"  - {code}")

    if other_errors:
        report_lines.append(
            f"\n[4] CÁC CAMERA BỊ LỖI NETWORK HOẶC ĐỨT CÁP (Mất Kết Nối, Sai Link, {len(other_errors)} cam):"
        )
        for code, msg in other_errors:
            report_lines.append(f"  - {code} (Chi tiết: {msg})")

    report_text = "\n".join(report_lines)

    report_file = "camera_error_report.txt"
    with open(report_file, "w", encoding="utf-8") as f:
        f.write(report_text)

    print(f"\n{report_text}")
    print(
        f"✅ Đã ghi danh sách lỗi chi tiết ra file văn bản: {os.path.abspath(report_file)}"
    )


if __name__ == "__main__":
    main()

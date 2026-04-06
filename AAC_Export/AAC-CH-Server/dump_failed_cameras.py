import os
import pymysql
from urllib.parse import quote

# --- CẤU HÌNH DATABASE NHƯ BẢN GỐC CỦA ANH ---
DB_HOST = "10.1.1.101"
DB_PORT = 3306
DB_NAME = "avg_db"
DB_USER = "root"
DB_PASS = "abcd@1234"
SNAP_USER = "it"
SNAP_PASS = "Chihung@12"

FAILED_CAMERAS = {
    "SAI_MAT_KHAU_401": [
        "SỐ 4",
        "SỐ 11",
        "SỐ 12",
        "SỐ 21",
        "SỐ 23",
        "SỐ 26",
        "SỐ 27",
        "SỐ 28",
        "SỐ 29",
        "SỐ 30",
        "SỐ 31",
        "SỐ 32",
        "SỐ 34",
        "SỐ 127",
        "SỐ 160",
    ],
    "TIMEOUT_CHAM": ["SỐ 37", "SỐ 38", "SỐ 39", "SỐ 42"],
    "LOI_TEN_FILE_HOAC_LINK": ["SỐ 25", "SỐ 88"],
}


def get_failed_cameras_from_db():
    # Gom tất cả mã lỗi thành 1 list phẳng để query một lần
    all_failed_codes = []
    for codes in FAILED_CAMERAS.values():
        all_failed_codes.extend(codes)

    conn = pymysql.connect(
        host=DB_HOST,
        port=DB_PORT,
        user=DB_USER,
        password=DB_PASS,
        database=DB_NAME,
        cursorclass=pymysql.cursors.DictCursor,
    )

    cameras = {}
    try:
        with conn.cursor() as cur:
            # Query theo list IN cho nhanh
            format_strings = ",".join(["%s"] * len(all_failed_codes))
            cur.execute(
                f"SELECT code, ip, username, password, cctv_url FROM cctv_tbl WHERE code IN ({format_strings})",
                tuple(all_failed_codes),
            )
            rows = cur.fetchall()
            for r in rows:
                cameras[r["code"]] = r
    finally:
        conn.close()

    return cameras


def main():
    print("Đang truy xuất thông tin 21 camera bị lỗi từ Database...")
    db_cams = get_failed_cameras_from_db()

    output_lines = []
    output_lines.append("=" * 80)
    output_lines.append("BÁO CÁO PARAMETER CHI TIẾT CÁC CAMERA BỊ LỖI TRONG DATABASE")
    output_lines.append(
        "Dùng để Copy & Paste Link RTSP sang ứng dụng VLC / iVMS để debug trực tiếp"
    )
    output_lines.append("=" * 80 + "\n")

    for category, codes in FAILED_CAMERAS.items():
        output_lines.append(f"🔴 NHÓM LỖI: {category} ({len(codes)} Camera) 🔴")
        output_lines.append("-" * 50)

        for code in codes:
            cam = db_cams.get(code)
            if not cam:
                output_lines.append(
                    f"[{code}] -> CHÚ Ý: Không tìm thấy mã camera này trong database!\n"
                )
                continue

            ip = cam["ip"]
            # Ưu tiên lấy từ DB, nếu None/Null thì lôi đồ dự phòng (SNAP_USER/PASS) ra xài
            db_user = cam.get("username")
            db_pass = cam.get("password")

            user = db_user or SNAP_USER
            pw = db_pass or SNAP_PASS
            url_suffix = cam.get("cctv_url") or "live.sdp"

            u_enc, p_enc = quote(user, safe=""), quote(pw, safe="")
            rtsp_url = f"rtsp://{u_enc}:{p_enc}@{ip}:554/{url_suffix}"

            # Câu lệnh nguyên gốc được sử dụng trong test_ffmpeg_db_fast
            ffmpeg_cmd = f"ffmpeg -y -analyzeduration 0 -probesize 32 -rtsp_transport tcp -fflags nobuffer -flags low_delay -i \"{rtsp_url}\" -vframes 1 -q:v 2 {code.replace(' ', '_')}.jpg"

            output_lines.append(f"📹 Camera Code : {code}")
            output_lines.append(f"📌 IP Address  : {ip}")
            # Hiển thị rõ đang dùng username/pass từ cột DB hay từ Dự Phòng
            output_lines.append(
                f"🔑 Username    : '{user}' (Lấy từ: {'DB' if db_user else 'Cứu hộ SNAP_USER'})"
            )
            output_lines.append(
                f"🔒 Password    : '{pw}' (Lấy từ: {'DB' if db_pass else 'Cứu hộ SNAP_PASS'})"
            )
            output_lines.append(f"🔗 Link RTSP   : {rtsp_url}")
            output_lines.append(f"🛠️ Lệnh FFMPEG : {ffmpeg_cmd}")
            output_lines.append("")

        output_lines.append("=" * 80 + "\n")

    report_text = "\n".join(output_lines)
    report_file = "failed_cameras_details.txt"

    with open(report_file, "w", encoding="utf-8") as f:
        f.write(report_text)

    print(f"✅ Đã trích xuất thông tin gốc của 21 Camera lỗi và lưu ra file txt!")
    print(f"👉 Mời anh mở file: {os.path.abspath(report_file)}")


if __name__ == "__main__":
    main()

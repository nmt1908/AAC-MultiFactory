import os
import time
import sys

SNAPSHOT_DIR = "snapshot"
KEEP_LATEST = 500
BATCH_SIZE = 1000
SLEEP_TIME = 1.0  # Giây nghỉ giữa mỗi batch để ổ đĩa kịp xả bộ đệm (flush)


def slow_cleanup():
    if not os.path.exists(SNAPSHOT_DIR):
        print(f"Thư mục {SNAPSHOT_DIR} không tồn tại.")
        return

    print(
        "Đang quét đọc danh sách file... (Với 1 triệu file sẽ mất khoảng vài chục giây để scan, anh vui lòng đợi)"
    )

    file_list = []
    # Dùng os.scandir thay vì os.listdir để tiết kiệm RAM và đọc cực nhanh với thư mục siêu lớn
    try:
        with os.scandir(SNAPSHOT_DIR) as it:
            for entry in it:
                if entry.is_file() and entry.name.lower().endswith((".jpg", ".jpeg")):
                    # Lưu lại cả path và thời gian tạo (mtime)
                    file_list.append((entry.path, entry.stat().st_mtime))
    except Exception as e:
        print(f"Lỗi khi quét thư mục: {e}")
        return

    total_files = len(file_list)
    print(f"Đã tìm thấy {total_files} ảnh trong thư mục.")

    if total_files <= KEEP_LATEST:
        print(
            f"Chỉ có {total_files} ảnh (dưới mức giới hạn {KEEP_LATEST}). Không cần xóa."
        )
        return

    print("Đang sắp xếp file theo độ cũ mới (xóa rác cũ trước)...")
    # Sắp xếp file cũ lên đầu
    file_list.sort(key=lambda x: x[1])

    # Chỉ xóa các file cũ, giữ lại đúng KEEP_LATEST file mới nhất
    to_delete = file_list[:-KEEP_LATEST]
    total_to_delete = len(to_delete)

    print(f"Bắt đầu xóa từ từ {total_to_delete} file rác.")
    print(
        f"Cơ chế: Xóa mỗi chu kỳ {BATCH_SIZE} file rồi nghỉ {SLEEP_TIME} giây để chống treo máy treo ổ cứng HDD."
    )

    deleted_count = 0

    for i in range(0, total_to_delete, BATCH_SIZE):
        batch = to_delete[i : i + BATCH_SIZE]
        for path, _ in batch:
            try:
                os.remove(path)
                deleted_count += 1
            except Exception:
                pass  # Bỏ qua nếu file đang bị lock hoặc không tồn tại

        percentage = (deleted_count / total_to_delete) * 100
        print(
            f"-> Đã xóa {deleted_count:,}/{total_to_delete:,} file ({percentage:.1f}%). Đang nghỉ {SLEEP_TIME}s xả IO..."
        )
        time.sleep(SLEEP_TIME)

    print(
        f"\nHoàn tất! Đã giải phóng thành công {deleted_count:,} ảnh cũ. Giữ lại đúng {KEEP_LATEST} ảnh mới nhất."
    )


if __name__ == "__main__":
    try:
        slow_cleanup()
    except KeyboardInterrupt:
        print("\nĐã ép dừng tiến trình xóa bằng phím Ctrl+C.")
        sys.exit(0)

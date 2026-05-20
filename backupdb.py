import os
import subprocess
from datetime import datetime

# --- CẤU HÌNH THÔNG SỐ (Anh có thể chỉnh sửa tại đây) ---
DB_HOST = "10.1.16.89"
DB_USER = "root"
DB_PASS = "admin"
DB_NAME = "vg-bdts_db"  # Tên database anh yêu cầu

# Đường dẫn ra Desktop (Tự động nhận diện trên Linux/Windows)
DESKTOP_PATH = os.path.join(os.path.expanduser("~"), "Desktop")

# Tạo tên file backup kèm ngày giờ để không bị ghi đè
timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
backup_filename = f"backup_{DB_NAME}_{timestamp}.sql"
backup_file_path = os.path.join(DESKTOP_PATH, backup_filename)

def backup_database():
    print(f"🚀 Đang bắt đầu backup database: {DB_NAME}...")
    
    # Lệnh mysqldump: --databases để lấy cả cấu trúc và dữ liệu
    # Nếu máy anh chưa cài mysql-client thì lệnh này sẽ báo lỗi
    dump_cmd = [
        "mysqldump",
        "-h", DB_HOST,
        "-u", DB_USER,
        f"-p{DB_PASS}",
        "--databases", DB_NAME,
        "--result-file=" + backup_file_path
    ]

    try:
        # Chạy lệnh hệ thống
        result = subprocess.run(dump_cmd, check=True, capture_output=True, text=True)
        
        if os.path.exists(backup_file_path):
            file_size = os.path.getsize(backup_file_path) / (1024 * 1024) # MB
            print(f"✅ Backup THÀNH CÔNG!")
            print(f"📍 File lưu tại: {backup_file_path}")
            print(f"📦 Dung lượng: {file_size:.2f} MB")
        else:
            print("❌ Lỗi: Không tìm thấy file sau khi chạy lệnh.")
            
    except subprocess.CalledProcessError as e:
        print(f"❌ Lỗi trong quá trình Backup: {e.stderr}")
    except Exception as e:
        print(f"❌ Lỗi hệ thống: {str(e)}")

if __name__ == "__main__":
    backup_database()

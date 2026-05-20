import os
import asyncio
import time
import base64
import io
from PIL import Image
from ollama import AsyncClient

# --- CONFIG ---
OLLAMA_URL = "http://10.13.34.154:11434" # Thay bằng URL Ollama của anh
MODEL_NAME = "llava:latest"
DEMO_FOLDER = "demo_images2" # Folder ảnh mẫu

async def benchmark():
    client = AsyncClient(host=OLLAMA_URL)
    
    # 1. Chuẩn bị ảnh
    files = [f for f in os.listdir(DEMO_FOLDER) if f.lower().endswith(('.png', '.jpg', '.jpeg'))][:4]
    if len(files) < 4:
        print("❌ Cần ít nhất 4 ảnh trong demo_images2 để test.")
        return

    images_bytes = []
    for f in files:
        with open(os.path.join(DEMO_FOLDER, f), "rb") as img_file:
            images_bytes.append(img_file.read())

    print(f"🚀 Bắt đầu Benchmark với model: {MODEL_NAME}")
    print("-" * 50)

    # --- TEST 1: SEQUENTIAL (Tuần tự - Giống cách cũ) ---
    print("⏳ Test 1: Chạy tuần tự 4 ảnh (4 requests)...")
    start_seq = time.time()
    for i, img in enumerate(images_bytes):
        resp = await client.generate(
            model=MODEL_NAME,
            prompt="Is there a person using a phone in this photo? Answer Y/N.",
            images=[img],
            stream=False
        )
        print(f"  > Ảnh {i+1}: {resp['response'].strip()}")
    duration_seq = time.time() - start_seq
    print(f"✅ Hoàn thành Test 1 trong: {duration_seq:.2f} giây")

    print("-" * 50)

    # --- TEST 2: BATCHING (Gộp 4 ảnh vào 1 request) ---
    print("⚡ Test 2: Chạy gộp 4 ảnh (1 request duy nhất)...")
    start_batch = time.time()
    # Gửi mảng images chứa cả 4 ảnh
    resp = await client.generate(
        model=MODEL_NAME,
        prompt="I am sending 4 photos. For each photo, strictly answer 'Y' if a person is using a phone, otherwise 'N'. Format: [Photo1: Y/N, Photo2: Y/N, ...]",
        images=images_bytes,
        stream=False
    )
    duration_batch = time.time() - start_batch
    print(f"  > Kết quả gộp: {resp['response'].strip()}")
    print(f"✅ Hoàn thành Test 2 trong: {duration_batch:.2f} giây")

    print("-" * 50)
    
    # --- KẾT LUẬN ---
    speedup = duration_seq / duration_batch
    print(f"📊 KẾT QUẢ: Cách chạy gộp (Batching) nhanh gấp {speedup:.2f} lần!")
    if speedup > 1.5:
        print("🔥 Đề xuất: Nên chuyển sang cơ chế Global Batching cho toàn hệ thống.")

if __name__ == "__main__":
    asyncio.run(benchmark())

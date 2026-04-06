import torch
from ultralytics import YOLO
import time
import numpy as np


def main():
    print("=== PyTorch CUDA Test ===")
    cuda_available = torch.cuda.is_available()
    print(f"CUDA Available: {cuda_available}")
    if cuda_available:
        print(f"Device Name: {torch.cuda.get_device_name(0)}")
    else:
        print("WARNING: CUDA is not available. Models will run on CPU.")

    print("\n=== YOLO Model Load Test ===")
    device = "cuda" if cuda_available else "cpu"

    # Try loading PersonModel
    try:
        print("Loading PersonModel.pt...")
        person_model = YOLO("PersonModel.pt")
        person_model.to(device)
        print(f"PersonModel loaded successfully on {device}")

        # Warmup
        print("Warming up PersonModel...")
        dummy_img = np.zeros((640, 640, 3), dtype=np.uint8)
        start = time.time()
        _ = person_model.predict(source=[dummy_img], imgsz=640, verbose=False)
        print(f"Warmup done in {max(0, time.time() - start):.3f}s")
    except Exception as e:
        print(f"Error loading PersonModel: {e}")

    # Try loading FireModel
    try:
        print("\nLoading FireModel.pt...")
        fire_model = YOLO("FireModel.pt")
        fire_model.to(device)
        print(f"FireModel loaded successfully on {device}")

        # Warmup
        print("Warming up FireModel...")
        dummy_img = np.zeros((640, 640, 3), dtype=np.uint8)
        start = time.time()
        _ = fire_model.predict(source=[dummy_img], imgsz=640, verbose=False)
        print(f"Warmup done in {max(0, time.time() - start):.3f}s")
    except Exception as e:
        print(f"Error loading FireModel: {e}")


if __name__ == "__main__":
    main()

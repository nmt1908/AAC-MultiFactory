import torch

print("🔥 PyTorch CUDA Test")

# Check CUDA available
cuda_available = torch.cuda.is_available()
print(f"CUDA available: {cuda_available}")

# Device info
if cuda_available:
    print(f"GPU count: {torch.cuda.device_count()}")
    print(f"Current device: {torch.cuda.current_device()}")
    print(f"Device name: {torch.cuda.get_device_name(0)}")

    # Test tensor on GPU
    x = torch.rand(3, 3).cuda()
    y = torch.rand(3, 3).cuda()
    z = x + y

    print("Tensor on GPU:")
    print(z)
else:
    print("⚠️ CUDA NOT AVAILABLE → đang chạy CPU")

# Torch version
print(f"PyTorch version: {torch.__version__}")
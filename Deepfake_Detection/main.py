import torch
from src.model import MultiModalFusionModel
from src.data_loader import LAVDFMultiModalDataset
from torch.utils.data import DataLoader
from pathlib import Path

def main():
    print(">>> Initializing Multi-Modal Deepfake Detection Project...")
    
    # Check for CUDA
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"   Device: {device}")
    
    # Initialize Model
    try:
        model = MultiModalFusionModel().to(device)
        print("   Model initialized successfully.")
    except Exception as e:
        print(f"   Model initialization failed: {e}")
        return

    # Example: How to initialize dataset (Mock paths for demonstration)
    print("\n   To train or run inference, update the paths in main.py:")
    print("   dataset_root = './data/LAV-DF'")
    print("   audio_root = './data/audio_cache'")
    
    # Mock Dry Run
    print("\n   Project structure is valid. Modules imported successfully.")

if __name__ == "__main__":
    main()

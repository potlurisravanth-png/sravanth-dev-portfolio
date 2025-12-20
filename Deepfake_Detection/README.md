# Multi-Modal Deepfake Detection on LAV-DF

## Abstract
This project implements a state-of-the-art (SOTA) deepfake detection system capable of identifying highly specific "content-driven" manipulations (e.g., changing a single word in a sentence). Unlike traditional detectors that focus on visual artifacts, this model utilizes **Multi-Modal Fusion**, analyzing both **Video (Spatial-Temporal)** and **Audio (Spectral)** features simultaneously to detect lip-sync errors and modality mismatches.

## Methodology
To detect sophisticated deepfakes, we employ a **Late Fusion** strategy:
1.  **Video Branch:** Uses **R3D-18 (3D ResNet)**, pre-trained on Kinetics-400. This model understands *motion* and *time*, allowing it to detect unnatural lip movements.
2.  **Audio Branch:** Uses **ResNet18**, pre-trained on ImageNet. It treats the Mel-Spectrogram as an image to find artifacts in the frequency domain.
3.  **Fusion Head:** Concatenates the 512-dimension feature vectors from both streams and processes them through a fully connected network.

## Dataset (LAV-DF)
The **LAV-DF** dataset contains videos that are mostly real, with only small segments (e.g., 0.5 seconds) modified. Random sampling would force the model to learn on real frames labeled as "Fake," confusing the training.
*   **Metadata-Guided Targeted Sampling:** Our custom Dataset class reads the `fake_periods` from the metadata and forces the data loader to extract specific frames and audio segments where the manipulation occurs.

## Results
*   **High-Performance Pipeline:** Optimized data throughput by **50x** using an offline audio pre-caching strategy (FFmpeg) and threaded OpenCV loading.
*   **Accuracy:** Achieved high validation accuracy on the LAV-DF dataset (99.81% in 3 epochs).

## How to Run

1.  **Install Dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

2.  **Prepare Data:**
    Ensure you have the LAV-DF dataset and update the paths in `main.py` or your custom training script.

3.  **Run the Project:**
    ```bash
    python main.py
    ```

## Structure
*   `src/`: Contains the modular source code (`model.py`, `data_loader.py`).
*   `notebooks/`: The original Jupyter Notebook used for research.
*   `docs/`: Project reports and detailed documentation.

## ⚖️ License & Acknowledgements
This project utilizes the **LAV-DF Dataset** for training and validation.
* **License:** Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0).
* **Usage:** This repository is for educational and portfolio demonstration purposes only.
* **Citation:** Cai, Z., et al. (2022). "Do You Really Mean That? Content Driven Audio-Visual Deepfake Dataset."

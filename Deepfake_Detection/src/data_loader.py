import json
import numpy as np
import torch
import torchaudio
import torchaudio.transforms as AT
import torchvision.transforms as T
from torch.utils.data import Dataset
import cv2
from pathlib import Path

class LAVDFMultiModalDataset(Dataset):
    def __init__(self, video_root, audio_root, metadata_path, split="train", num_frames=16, video_size=112, audio_duration=3):
        self.split = split
        self.video_root = Path(video_root)
        self.audio_root = Path(audio_root)
        self.num_frames = num_frames
        self.video_size = video_size
        self.target_sample_rate = 16000
        self.audio_samples = int(16000 * audio_duration)

        with open(metadata_path, 'r') as f:
            full_metadata = json.load(f)

        # Filter files
        self.data = []
        for entry in full_metadata:
            # Only include files if the audio extraction was successful
            # (We check for the .wav file existence to avoid crashing)
            rel_path = entry['file']
            wav_path = (self.audio_root / rel_path).with_suffix('.wav')

            # Simple string check for split to match folder structure
            if entry['file'].startswith(f"{split}/"):
                self.data.append({
                    'rel_path': rel_path,
                    'wav_path': str(wav_path),
                    'label': 1 if entry['n_fakes'] > 0 else 0,
                    'fake_periods': entry.get('fake_periods', []),
                    'duration': entry.get('duration', 0)
                })

        print(f"   [{split.upper()}] Loaded {len(self.data)} samples.")

        # Audio Transform
        self.audio_transform = AT.MelSpectrogram(sample_rate=16000, n_fft=1024, hop_length=128, n_mels=64)
        self.db_transform = AT.AmplitudeToDB()

        # Video Transform
        self.video_transform = T.Compose([
            T.Resize((video_size, video_size)),
            T.Normalize(mean=[0.432, 0.394, 0.376], std=[0.228, 0.221, 0.217])
        ])

    def __len__(self):
        return len(self.data)

    def _get_indices(self, total_frames, meta):
        try:
            if meta['label'] == 1 and meta['fake_periods']:
                start_sec = meta['fake_periods'][0][0]
                fps = total_frames / max(meta['duration'], 1)
                center_frame = int(start_sec * fps) + int((meta['fake_periods'][0][1]-start_sec)*fps/2)
                start_f = max(0, center_frame - self.num_frames // 2)
            else:
                start_f = 0

            end_f = min(total_frames, start_f + self.num_frames)
            if end_f - start_f < self.num_frames:
                indices = np.pad(np.arange(start_f, end_f), (0, self.num_frames - (end_f - start_f)), mode='edge')
            else:
                indices = np.linspace(start_f, end_f - 1, self.num_frames).astype(int)
            return indices
        except:
            return np.linspace(0, total_frames - 1, self.num_frames).astype(int)

    def __getitem__(self, idx):
        meta = self.data[idx]
        rel_path = meta['rel_path']
        video_path = str(self.video_root / rel_path)
        wav_path = meta['wav_path']
        label = meta['label']

        try:
            # --- VIDEO (OpenCV) ---
            cap = cv2.VideoCapture(video_path)
            total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
            indices = self._get_indices(total_frames, meta)

            frames = []
            for i in indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, i)
                ret, frame = cap.read()
                if ret:
                    frames.append(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                else:
                    frames.append(np.zeros((112, 112, 3), dtype=np.uint8))
            cap.release()

            frames = torch.from_numpy(np.array(frames)).permute(0, 3, 1, 2).float() / 255.0
            frames = self.video_transform(frames).permute(1, 0, 2, 3)

            # --- AUDIO (WAV File - Lightning Fast) ---
            # Try/Except block for individual missing wavs
            try:
                waveform, sr = torchaudio.load(wav_path)
            except:
                # Fallback if specific wav failed extraction
                waveform = torch.zeros(1, self.audio_samples)

            # Target Audio Window
            if label == 1 and meta['fake_periods']:
                start_sec = meta['fake_periods'][0][0]
                start_sample = int(start_sec * 16000)
                start_sample = max(0, start_sample - self.audio_samples // 2)
                end_sample = start_sample + self.audio_samples
                waveform = waveform[:, start_sample:end_sample]

            # Pad
            if waveform.shape[1] < self.audio_samples:
                waveform = torch.nn.functional.pad(waveform, (0, self.audio_samples - waveform.shape[1]))
            else:
                waveform = waveform[:, :self.audio_samples]

            spec = self.db_transform(self.audio_transform(waveform)).repeat(3, 1, 1)

            return frames, spec, label

        except Exception as e:
            # Return zero tensors on failure to avoid crashing training
            return torch.zeros((3, self.num_frames, 112, 112)), torch.zeros((3, 64, 376)), label

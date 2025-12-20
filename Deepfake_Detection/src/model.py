import torch
import torch.nn as nn
from torchvision.models.video import r3d_18, R3D_18_Weights
from torchvision.models import resnet18, ResNet18_Weights

class MultiModalFusionModel(nn.Module):
    def __init__(self):
        super().__init__()
        # Video Branch: R3D-18
        self.video_net = r3d_18(weights=R3D_18_Weights.KINETICS400_V1)
        self.video_net.fc = nn.Identity()

        # Audio Branch: ResNet-18
        self.audio_net = resnet18(weights=ResNet18_Weights.IMAGENET1K_V1)
        self.audio_net.fc = nn.Identity()

        # Fusion Head
        self.fusion = nn.Sequential(
            nn.Linear(1024, 512),
            nn.BatchNorm1d(512),
            nn.ReLU(),
            nn.Dropout(0.4),
            nn.Linear(512, 2)
        )

    def forward(self, video, audio):
        v_feat = self.video_net(video)
        a_feat = self.audio_net(audio)
        combined = torch.cat((v_feat, a_feat), dim=1)
        return self.fusion(combined)

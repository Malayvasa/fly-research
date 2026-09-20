"""Optional bounded recordings of neural features; no expert inputs enter the brain."""
import json
from pathlib import Path
from uuid import uuid4
import numpy as np


class FeatureRecording:
    def __init__(self, folder: Path, metadata: dict, limit=30000):
        self.path = folder / f'neural-{uuid4().hex}.npz'
        self.metadata = {**metadata, 'recordingSession': self.path.stem}
        self.limit = limit
        self.features, self.frames, self.sequences = [], [], []
        self.truncated = False

    def append(self, features, frame_id, sequence):
        if len(self.frames) >= self.limit:
            self.truncated = True
            return
        values = np.asarray(features, dtype=np.float32)
        if values.shape != (768,) or not np.isfinite(values).all():
            raise ValueError('Invalid recorded neural features')
        self.features.append(values.copy())
        self.frames.append(frame_id)
        self.sequences.append(sequence)

    def save(self):
        if not self.frames:
            return None
        self.path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(self.path, x=np.asarray(self.features),
            frameIds=np.asarray(self.frames, dtype=np.uint32),
            sequences=np.asarray(self.sequences, dtype=np.uint32),
            metadata=json.dumps(self.metadata), truncated=self.truncated)
        return self.path

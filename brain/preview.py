"""Export the model's binocular projection for an RGB8 camera atlas."""
import argparse
from pathlib import Path
import struct
import zlib

import numpy as np
from .backend import Brain, SHAPE, load_model_class


def write_png(path, rgb):
    height, width, _ = rgb.shape
    def chunk(kind, data):
        return struct.pack('>I', len(data)) + kind + data + struct.pack('>I', zlib.crc32(kind + data))
    rows = b''.join(b'\0' + row.tobytes() for row in rgb)
    path.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>2I5B', width, height, 8, 2, 0, 0, 0)) +
                     chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('atlas', type=Path)
    parser.add_argument('--output', type=Path, default=Path('artifacts/fly-eyes.png'))
    args = parser.parse_args()
    brain = Brain(load_model_class(Path('.cache/fly64')), Path('.cache/malecns'), False, 64, 'live')
    brain.step(np.frombuffer(args.atlas.read_bytes(), dtype=np.uint8).reshape(SHAPE))
    eyes = brain.eye_preview()
    write_png(args.output, np.repeat(np.repeat(eyes, 4, axis=0), 4, axis=1))

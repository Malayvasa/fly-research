"""Loopback WebSocket service. Reach it from another Mac through an SSH tunnel."""
from __future__ import annotations

import argparse
import base64
import asyncio
import json
from pathlib import Path
import struct
import time

import numpy as np
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from .backend import Brain, FRAME_BYTES, MODES, SHAPE, load_model_class
from .recording import FeatureRecording


def decode_frame(payload: bytes, last_id: int):
    if not isinstance(payload, bytes) or len(payload) != FRAME_BYTES + 4:
        raise ValueError("Expected uint32 frame ID followed by a 384x256 RGB8 atlas")
    frame_id = struct.unpack_from("<I", payload)[0]
    if frame_id <= last_id:
        raise ValueError("Frame IDs must increase within a session")
    return frame_id, np.frombuffer(payload, dtype=np.uint8, offset=4).reshape(SHAPE)


class Server:
    def __init__(self, factory, readout=None, record=None, motor_readout=None):
        self.factory = factory
        self.readout = readout
        self.record = record
        self.motor_readout = motor_readout
        self.busy = False

    async def handle(self, socket):
        if self.busy:
            await socket.close(1013, "One experiment at a time on this service")
            return
        self.busy = True
        receiver = None
        recording = None
        try:
            hello = json.loads(await asyncio.wait_for(socket.recv(), timeout=10))
            if not isinstance(hello, dict) or hello.get("type") != "hello" or hello.get("protocol") != 1:
                raise ValueError("Expected protocol-1 hello")
            seed, mode = hello.get("seed", 64), hello.get("mode", "live")
            previews = hello.get("eyePreviews", False)
            if type(previews) is not bool:
                raise ValueError("eyePreviews must be a boolean")
            if type(seed) is not int or not 0 <= seed < 2**32 or mode not in MODES:
                raise ValueError("Invalid seed or mode")
            brain = await asyncio.to_thread(self.factory, seed, mode)
            requested = hello.get('readout', 'descending')
            if requested not in ('descending', 'trained', 'hybrid'):
                raise ValueError('Unknown readout')
            if requested in ('trained', 'hybrid'):
                if self.readout is None or not self.readout.exists():
                    raise ValueError('Trained readout not installed')
                brain.use_readout(self.readout)
                brain.metadata['readout'] = requested
            if requested == 'hybrid':
                share = hello.get('motorShare', .5)
                if type(share) not in (int, float) or not 0 <= share <= 1:
                    raise ValueError('Invalid hybrid motor share')
                brain.metadata['motorShare'] = share
                motor_kind = hello.get('motorReadout', 'rates')
                if motor_kind not in ('rates', 'trained'):
                    raise ValueError('Unknown motor readout')
                brain.metadata['motorReadout'] = motor_kind
                if motor_kind == 'trained':
                    if self.motor_readout is None or not self.motor_readout.exists():
                        raise ValueError('Trained motor readout not installed')
                    brain.use_motor_readout(self.motor_readout)
            if self.record is not None:
                if requested not in ('trained', 'hybrid'):
                    raise ValueError('Feature recording requires a trained readout session')
                recording = FeatureRecording(self.record,
                    {**brain.metadata, 'features': brain.readout.features.kind})
                brain.metadata['recordingSession'] = recording.metadata['recordingSession']
            await socket.send(json.dumps({"type": "ready", "protocol": 1, **brain.metadata}))
            latest = None
            first_frame = asyncio.Event()

            async def receive():
                nonlocal latest
                last_id = -1
                async for payload in socket:
                    frame_id, frame = decode_frame(payload, last_id)
                    last_id = frame_id
                    latest = (frame_id, frame, time.monotonic())
                    first_frame.set()

            receiver = asyncio.create_task(receive())
            sequence = 0
            stale_reported = False
            while True:
                if receiver.done():
                    await receiver
                    break
                if latest is None:
                    try:
                        await asyncio.wait_for(first_frame.wait(), timeout=0.1)
                    except TimeoutError:
                        continue
                frame_id, frame, received = latest
                if time.monotonic() - received >= 0.5:
                    if not stale_reported:
                        await socket.send(json.dumps({"type": "stale", "frameId": frame_id}))
                        stale_reported = True
                    await asyncio.sleep(0.02)
                    continue
                stale_reported = False
                started = time.monotonic()
                rates = await asyncio.to_thread(brain.step, frame)
                if recording is not None:
                    recording.append(brain.readout.last_features, frame_id, sequence)
                elapsed = time.monotonic() - started
                await socket.send(json.dumps({"type": "activity", "sequence": sequence,
                    "frameId": frame_id, "simulationMs": (sequence + 1) * 20,
                    "computeMs": elapsed * 1000, **rates}, allow_nan=False))
                if previews and sequence % 10 == 0:
                    eyes = await asyncio.to_thread(brain.eye_preview)
                    await socket.send(json.dumps({"type": "eyes", "sequence": sequence,
                        "frameId": frame_id, "width": 256, "height": 128,
                        "mode": mode, "encoding": "rgb8-base64",
                        "pixels": base64.b64encode(eyes.tobytes()).decode("ascii")}))
                sequence += 1
                # Never drop neural steps or burst old controls to catch up.
                await asyncio.sleep(max(0, brain.model.dt - (time.monotonic() - started)))
        except (ValueError, TypeError, TimeoutError) as exc:
            await socket.close(1008, str(exc)[:100])
        except ConnectionClosed:
            pass
        finally:
            if receiver is not None:
                receiver.cancel()
                await asyncio.gather(receiver, return_exceptions=True)
            try:
                if recording is not None:
                    path = await asyncio.to_thread(recording.save)
                    if path is not None:
                        print(f'Neural recording: {path}', flush=True)
            finally:
                self.busy = False


async def run(args):
    model_class = load_model_class(args.fly64)
    if not args.fixture and not (args.cache / "manifest.json").exists():
        raise FileNotFoundError("Prepared MaleCNS cache missing; no automatic fixture fallback")
    service = Server(lambda seed, mode: Brain(model_class, args.cache, args.fixture, seed, mode), args.readout, args.record, args.motor_readout)
    async with serve(service.handle, "127.0.0.1", args.port,
                     origins=[None, "http://127.0.0.1:5173", "http://localhost:5173"],
                     max_size=FRAME_BYTES + 4, max_queue=1, compression=None):
        print(f"Fly service ws://127.0.0.1:{args.port} backend={'fixture' if args.fixture else 'malecns'}", flush=True)
        await asyncio.Future()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--fly64", type=Path, required=True)
    parser.add_argument("--cache", type=Path, default=Path(".cache/malecns"))
    parser.add_argument("--fixture", action="store_true")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument('--readout', type=Path)
    parser.add_argument('--motor-readout', type=Path)
    parser.add_argument('--record', type=Path, help='Record live neural features locally for offline training')
    asyncio.run(run(parser.parse_args()))

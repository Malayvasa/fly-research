"""Exercise the actual backend over a temporary loopback WebSocket connection."""
import argparse
import asyncio
import json
from pathlib import Path
import struct
import time

import numpy as np
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve

from .backend import Brain, load_model_class
from .experiment import stimulus
from .server import Server


async def run(args):
    model_class = load_model_class(args.fly64)
    app = Server(lambda seed, mode: Brain(model_class, args.cache, args.fixture, seed, mode))
    async with serve(app.handle, '127.0.0.1', 0, compression=None) as server:
        port = server.sockets[0].getsockname()[1]
        async with connect(f'ws://127.0.0.1:{port}', compression=None) as client:
            await client.send(json.dumps({"type": "hello", "protocol": 1, "seed": 64, "mode": "live"}))
            ready = json.loads(await asyncio.wait_for(client.recv(), 30))
            sent, latencies, compute, sequences = {}, [], [], []
            started = time.monotonic()

            async def send_frames():
                for i in range(20):
                    sent[i] = time.monotonic()
                    await client.send(struct.pack('<I', i) + stimulus(i * 5, False).tobytes())
                    await asyncio.sleep(0.1)

            sender = asyncio.create_task(send_frames())
            try:
                while True:
                    packet = json.loads(await asyncio.wait_for(client.recv(), 5))
                    if packet['type'] == 'stale':
                        break
                    assert packet['type'] == 'activity'
                    assert packet['frameId'] in sent
                    assert all(0 <= packet[k] <= 50 for k in ('forwardHz', 'leftHz', 'rightHz'))
                    sequences.append(packet['sequence'])
                    latencies.append((time.monotonic() - sent[packet['frameId']]) * 1000)
                    compute.append(packet['computeMs'])
                await sender
            finally:
                sender.cancel()
                await asyncio.gather(sender, return_exceptions=True)
            assert sequences == list(range(len(sequences))) and len(sequences) >= 20
            report = {"metadata": ready, "framesSent": len(sent), "controlPackets": len(sequences),
                "elapsedSecondsIncludingStaleWait": time.monotonic() - started,
                "p95SourceFrameAgeMs": float(np.percentile(latencies, 95)),
                "meanComputeMs": float(np.mean(compute)), "staleCameraDetected": True}
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(report, indent=2) + '\n')
            print(json.dumps(report, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--fly64', type=Path, default=Path('.cache/fly64'))
    parser.add_argument('--cache', type=Path, default=Path('.cache/malecns'))
    parser.add_argument('--fixture', action='store_true')
    parser.add_argument('--output', type=Path, default=Path('artifacts/brain-service-smoke.json'))
    asyncio.run(run(parser.parse_args()))

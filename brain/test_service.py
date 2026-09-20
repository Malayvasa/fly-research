import asyncio
import json
import struct
from types import SimpleNamespace

import numpy as np
import pytest
from websockets.asyncio.client import connect
from websockets.asyncio.server import serve
from websockets.exceptions import ConnectionClosed

from .backend import FRAME_BYTES, SHAPE
from .server import Server, decode_frame


def test_frame_shape_and_order():
    packet = struct.pack('<I', 7) + bytes(FRAME_BYTES)
    number, frame = decode_frame(packet, 6)
    assert number == 7 and frame.shape == SHAPE
    for value in (packet[:-1], packet + b'x', 'hello'):
        with pytest.raises(ValueError):
            decode_frame(value, 6)
    with pytest.raises(ValueError):
        decode_frame(packet, 7)


class Fixture:
    metadata = {"backend": "test-only"}
    model = SimpleNamespace(dt=0.02)

    def step(self, frame):
        return {"forwardHz": float(frame.mean() / 255), "leftHz": 0, "rightHz": 0}


def test_websocket_handshake_controls_expiry_and_exclusive_session():
    async def check():
        app = Server(lambda seed, mode: Fixture())
        async with serve(app.handle, '127.0.0.1', 0) as server:
            port = server.sockets[0].getsockname()[1]
            async with connect(f'ws://127.0.0.1:{port}') as client:
                await client.send(json.dumps({"type": "hello", "protocol": 1}))
                assert json.loads(await client.recv())["backend"] == 'test-only'
                async with connect(f'ws://127.0.0.1:{port}') as second:
                    with pytest.raises(ConnectionClosed):
                        await second.recv()
                await client.send(struct.pack('<I', 0) + bytes([255]) * FRAME_BYTES)
                result = json.loads(await client.recv())
                assert result['frameId'] == 0 and result['forwardHz'] == 1
                while result['type'] != 'stale':
                    result = json.loads(await asyncio.wait_for(client.recv(), 1))
                with pytest.raises(TimeoutError):
                    await asyncio.wait_for(client.recv(), 0.05)
                await client.send(struct.pack('<I', 1) + bytes(FRAME_BYTES))
                result = json.loads(await client.recv())
                assert result['frameId'] == 1 and result['forwardHz'] == 0
    asyncio.run(check())


def test_bad_hello_and_bad_frames_close_connection():
    async def check():
        app = Server(lambda seed, mode: Fixture())
        async with serve(app.handle, '127.0.0.1', 0) as server:
            uri = f'ws://127.0.0.1:{server.sockets[0].getsockname()[1]}'
            async with connect(uri) as client:
                await client.send('{bad json')
                with pytest.raises(ConnectionClosed):
                    await client.recv()
            # Wait for the previous handler's finally block to release the session.
            for _ in range(100):
                if not app.busy:
                    break
                await asyncio.sleep(0.001)
            async with connect(uri) as client:
                await client.send(json.dumps({"type": "hello", "protocol": 1}))
                await client.recv()
                await client.send(b'bad frame')
                with pytest.raises(ConnectionClosed):
                    await client.recv()
    asyncio.run(check())

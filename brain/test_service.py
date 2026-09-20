import asyncio
import base64
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

    def eye_preview(self):
        return np.full((128, 256, 3), 127, np.uint8)


def test_websocket_handshake_controls_expiry_and_exclusive_session():
    async def check():
        app = Server(lambda seed, mode: Fixture())
        async with serve(app.handle, '127.0.0.1', 0) as server:
            port = server.sockets[0].getsockname()[1]
            async with connect(f'ws://127.0.0.1:{port}') as client:
                await client.send(json.dumps({"type": "hello", "protocol": 1, "eyePreviews": True}))
                assert json.loads(await client.recv())["backend"] == 'test-only'
                async with connect(f'ws://127.0.0.1:{port}') as second:
                    with pytest.raises(ConnectionClosed):
                        await second.recv()
                await client.send(struct.pack('<I', 0) + bytes([255]) * FRAME_BYTES)
                result = json.loads(await client.recv())
                assert result['frameId'] == 0 and result['forwardHz'] == 1
                eyes = json.loads(await client.recv())
                assert eyes['type'] == 'eyes' and eyes['frameId'] == 0
                assert eyes['width'] == 256 and eyes['height'] == 128
                assert base64.b64decode(eyes['pixels']) == bytes([127]) * (256 * 128 * 3)
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


@pytest.mark.parametrize('readout', ['trained', 'hybrid', 'unknown'])
def test_unavailable_readout_fails_closed(readout):
    async def check():
        app = Server(lambda seed, mode: Fixture())
        async with serve(app.handle, '127.0.0.1', 0) as server:
            uri = f'ws://127.0.0.1:{server.sockets[0].getsockname()[1]}'
            async with connect(uri) as client:
                await client.send(json.dumps({'type': 'hello', 'protocol': 1, 'readout': readout}))
                with pytest.raises(ConnectionClosed) as error:
                    await client.recv()
                assert error.value.rcvd.code == 1008
    asyncio.run(check())


@pytest.mark.parametrize('installed', [False, True])
def test_learned_motor_readout_is_explicit_and_required(tmp_path, installed):
    class ReadoutFixture(Fixture):
        def __init__(self):
            self.metadata = {'backend': 'test-only'}

        def use_readout(self, path):
            pass

        def use_motor_readout(self, path):
            self.metadata['motorReadout'] = 'trained'

        def step(self, frame):
            return {**super().step(frame), 'steering': .8, 'motorSteering': -.4}

    weights = tmp_path / 'weights.npz'
    weights.touch()

    async def check():
        app = Server(lambda seed, mode: ReadoutFixture(), readout=weights,
                     motor_readout=weights if installed else None)
        async with serve(app.handle, '127.0.0.1', 0) as server:
            uri = f'ws://127.0.0.1:{server.sockets[0].getsockname()[1]}'
            async with connect(uri) as client:
                await client.send(json.dumps({'type':'hello', 'protocol':1,
                    'readout':'hybrid', 'motorReadout':'trained', 'motorShare':.5}))
                if not installed:
                    with pytest.raises(ConnectionClosed) as error:
                        await client.recv()
                    assert error.value.rcvd.code == 1008
                    return
                ready = json.loads(await client.recv())
                assert ready['motorReadout'] == 'trained' and ready['motorShare'] == .5
                await client.send(struct.pack('<I', 0) + bytes(FRAME_BYTES))
                result = json.loads(await client.recv())
                assert result['steering'] == .8 and result['motorSteering'] == -.4
    asyncio.run(check())


def test_plastic_motor_requires_patch_and_never_loads_visual_teacher(tmp_path):
    class MotorFixture(Fixture):
        def __init__(self):
            self.metadata = {'backend': 'test-only'}

        def use_motor_patch(self, path):
            self.metadata.update(readout='plastic-motor', throttleMode='neural', motorPatchSha256='a' * 64)

        def use_readout(self, path):
            raise AssertionError('Visual teacher must never run in motor-only runtime')

    patch = tmp_path / 'patch.npz'
    patch.touch()

    async def check(installed):
        app = Server(lambda seed, mode: MotorFixture(), readout=patch,
                     motor_patch=patch if installed else None)
        async with serve(app.handle, '127.0.0.1', 0) as server:
            async with connect(f'ws://127.0.0.1:{server.sockets[0].getsockname()[1]}') as client:
                await client.send(json.dumps({'type': 'hello', 'protocol': 1, 'readout': 'plastic-motor'}))
                if not installed:
                    with pytest.raises(ConnectionClosed) as error:
                        await client.recv()
                    assert error.value.rcvd.code == 1008
                    return
                ready = json.loads(await client.recv())
                assert ready['readout'] == 'plastic-motor'
                assert ready['throttleMode'] == 'neural'
                await client.send(struct.pack('<I', 0) + bytes(FRAME_BYTES))
                activity = json.loads(await client.recv())
                assert 'steering' not in activity and 'motorSteering' not in activity
    asyncio.run(check(False))
    asyncio.run(check(True))

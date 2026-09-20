import test from 'node:test';
import assert from 'node:assert/strict';
import {FlyClient, FLY_FRAME_BYTES, type FlySocket} from './fly-client.ts';

function setup(options = {}) {
  let now = 0;
  const sent: unknown[] = [];
  const socket: FlySocket = {
    bufferedAmount: 0, onopen: null, onmessage: null, onclose: null, onerror: null,
    send: data => { sent.push(data); }, close: () => {},
  };
  const client = new FlyClient({url: 'ws://127.0.0.1:8765', now: () => now,
    socketFactory: () => socket, controller: {smoothingSeconds: 0}, ...options});
  const receive = (value: unknown) => socket.onmessage?.call(socket as WebSocket, {data: JSON.stringify(value)} as MessageEvent);
  const ready = (backend = 'malecns') => receive({type: 'ready', protocol: 1, neuralHz: 50, seed: 64, mode: 'live', backend});
  const activity = (sequence = 0, frameId = 0) => receive({type: 'activity', sequence, frameId, forwardHz: 1, leftHz: 0, rightHz: 5});
  client.connect();
  socket.onopen?.call(socket as WebSocket, {} as Event);
  return {client, socket, sent, receive, ready, activity, clock: (value: number) => {now = value;}};
}

test('handshake gates input and binary frame IDs are little-endian', () => {
  const s = setup();
  assert.equal(s.client.sendFrame(new Uint8Array(FLY_FRAME_BYTES)), false);
  assert.equal(JSON.parse(s.sent[0] as string).protocol, 1);
  s.ready();
  assert.equal(s.client.sendFrame(new Uint8Array(FLY_FRAME_BYTES)), true);
  assert.equal(new DataView((s.sent[1] as Uint8Array).buffer).getUint32(0, true), 0);
  s.activity();
  assert.equal(s.client.input(0.02).steering, 1);
  s.client.close();
  assert.equal(s.client.input(0.02).throttle, 0);
});

test('fresh packets cannot keep driving with an expired source image', () => {
  const s = setup(); s.ready(); s.client.sendFrame(new Uint8Array(FLY_FRAME_BYTES));
  s.activity();
  s.clock(240); s.activity(1);
  s.clock(480); s.activity(2);
  assert.ok(s.client.input(0.02).throttle > 0);
  s.clock(500); s.activity(3);
  assert.equal(s.client.input(0.02).throttle, 0);
  assert.equal(s.client.status, 'stale');
});

test('missing activity becomes stale and recovers on a valid fresh response', () => {
  const s = setup(); s.ready(); s.client.sendFrame(new Uint8Array(FLY_FRAME_BYTES)); s.activity();
  s.clock(250);
  assert.equal(s.client.input(0.02).throttle, 0);
  assert.equal(s.client.status, 'stale');
  s.client.sendFrame(new Uint8Array(FLY_FRAME_BYTES)); s.activity(1, 1);
  assert.ok(s.client.input(0.02).throttle > 0);
  assert.equal(s.client.status, 'ready');
});

test('unknown frames, malformed JSON and stale-camera messages cannot drive', () => {
  const s = setup(); s.ready(); s.activity();
  assert.equal(s.client.input(0.02).throttle, 0);
  s.socket.onmessage?.call(s.socket as WebSocket, {data: '{bad'} as MessageEvent);
  s.client.sendFrame(new Uint8Array(FLY_FRAME_BYTES)); s.activity();
  s.receive({type: 'stale', frameId: 0});
  assert.equal(s.client.status, 'stale');
  assert.equal(s.client.input(0.02).throttle, 0);
});

test('synthetic backends require explicit opt-in', () => {
  const s = setup(); s.ready('synthetic-fixture');
  assert.equal(s.client.status, 'error');
  const allowed = setup({allowFixture: true}); allowed.ready('synthetic-fixture');
  assert.equal(allowed.client.status, 'ready');
});

test('hybrid handshake agrees on both the readout and motor share', () => {
  const options = {controller:{readout:'hybrid',smoothingSeconds:0,steeringDeadzone:0}};
  const s = setup(options);
  assert.equal(JSON.parse(s.sent[0] as string).motorShare,.5);
  const ready = {type:'ready',protocol:1,neuralHz:50,seed:64,mode:'live',backend:'malecns',readout:'hybrid',motorShare:.5};
  s.receive(ready);
  assert.equal(s.client.status,'ready');
  s.client.sendFrame(new Uint8Array(FLY_FRAME_BYTES));
  s.receive({type:'activity',sequence:0,frameId:0,forwardHz:1,leftHz:0,rightHz:5,steering:0});
  assert.equal(s.client.input(.02).steering,.5);
  const mismatch = setup(options);
  mismatch.receive({...ready,motorShare:.8});
  assert.equal(mismatch.client.status,'error');
});

test('learned motor handshake cannot silently use raw motor rates', () => {
  const options = {controller:{readout:'hybrid', motorReadout:'trained', smoothingSeconds:0, steeringDeadzone:0}};
  const ready = {type:'ready',protocol:1,neuralHz:50,seed:64,mode:'live',backend:'malecns',readout:'hybrid',motorShare:.5};
  const wrong = setup(options);
  wrong.receive(ready);
  assert.equal(wrong.client.status, 'error');
  const s = setup(options);
  assert.equal(JSON.parse(s.sent[0] as string).motorReadout, 'trained');
  s.receive({...ready, motorReadout:'trained'});
  assert.equal(s.client.status, 'ready');
  s.client.sendFrame(new Uint8Array(FLY_FRAME_BYTES));
  s.receive({type:'activity',sequence:0,frameId:0,forwardHz:1,leftHz:0,rightHz:50,steering:.8,motorSteering:-.4});
  assert.equal(s.client.input(.02).steering,.2);
});

test('trained and descending sessions cannot silently substitute for each other', () => {
  const trained = setup({controller: {readout: 'trained', smoothingSeconds: 0}});
  trained.ready();
  assert.equal(trained.client.status, 'error');
  const descending = setup();
  descending.receive({type: 'ready', protocol: 1, neuralHz: 50, seed: 64,
    mode: 'live', backend: 'malecns', readout: 'trained'});
  assert.equal(descending.client.status, 'error');
  const valid = setup({controller: {readout: 'trained', smoothingSeconds: 0}});
  valid.receive({type: 'ready', protocol: 1, neuralHz: 50, seed: 64,
    mode: 'live', backend: 'malecns', readout: 'trained'});
  assert.equal(valid.client.status, 'ready');
  valid.client.sendFrame(new Uint8Array(FLY_FRAME_BYTES));
  valid.receive({type: 'activity', sequence: 0, frameId: 0,
    forwardHz: 1, leftHz: 0, rightHz: 5, steering: -.4});
  assert.equal(valid.client.input(.02).steering, -.4);
});

test('backpressure and capture validation prevent stale queued frames', () => {
  const s = setup(); s.ready();
  Object.defineProperty(s.socket, 'bufferedAmount', {value: 1, configurable: true});
  assert.equal(s.client.sendFrame(new Uint8Array(FLY_FRAME_BYTES)), false);
  Object.defineProperty(s.socket, 'bufferedAmount', {value: 0});
  assert.equal(s.client.sendFrame(new Uint8Array(FLY_FRAME_BYTES), 1), false);
  assert.throws(() => s.client.sendFrame(new Uint8Array(2)), RangeError);
  s.clock(500);
  assert.equal(s.client.sendFrame(new Uint8Array(FLY_FRAME_BYTES), 0), false);
});

test('eye previews are validated and do not refresh the control watchdog', () => {
  const previews: unknown[] = [];
  const s = setup({onEyes: (eyes: unknown) => previews.push(eyes)});
  s.ready(); s.client.sendFrame(new Uint8Array(FLY_FRAME_BYTES)); s.activity();
  const packet = {type: 'eyes', sequence: 0, frameId: 0, width: 256, height: 128,
    mode: 'live', encoding: 'rgb8-base64', pixels: btoa('\x7f'.repeat(256 * 128 * 3))};
  s.receive(packet);
  assert.equal(previews.length, 1);
  s.receive({...packet, frameId: 99});
  s.receive({...packet, width: 128});
  s.receive({...packet, pixels: 'invalid'});
  assert.equal(previews.length, 1);
  s.clock(250); s.receive(packet);
  assert.equal(s.client.input(0.02).throttle, 0);
  s.clock(500); s.receive(packet);
  assert.equal(previews.length, 2);
});

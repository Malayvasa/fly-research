import {FlyController, type FlyControllerConfig} from './fly-controller.ts';

export const FLY_FRAME_BYTES = 384 * 256 * 3;
export type FlyMode = 'live' | 'blank' | 'frozen' | 'shuffled' | 'disconnected';
export type FlyStatus = 'offline' | 'connecting' | 'ready' | 'stale' | 'error';
export type FlyEyes = {frameId: number; sequence: number; width: 256; height: 128; rgb: Uint8Array};
export type FlySocket = Pick<WebSocket, 'send' | 'close' | 'bufferedAmount' | 'onopen' | 'onmessage' | 'onclose' | 'onerror'>;
type Options = {
  url: string;
  mode?: FlyMode;
  seed?: number;
  allowFixture?: boolean;
  controller?: Partial<FlyControllerConfig>;
  now?: () => number;
  socketFactory?: (url: string) => FlySocket;
  onStatus?: (status: FlyStatus) => void;
  onEyes?: (eyes: FlyEyes) => void;
  onActivity?: (rates: {forwardHz: number; leftHz: number; rightHz: number}) => void;
};

export class FlyClient {
  status: FlyStatus = 'offline';
  metadata: Readonly<Record<string, unknown>> | null = null;
  private socket: FlySocket | null = null;
  private ready = false;
  private nextFrame = 0;
  private frames = new Map<number, number>();
  private acceptedCaptureMs = -Infinity;
  private acceptedAtMs = -Infinity;
  private controller: FlyController;
  private now: () => number;
  private options: Options;

  constructor(options: Options) {
    if (!Number.isInteger(options.seed ?? 64) || (options.seed ?? 64) < 0 || (options.seed ?? 64) >= 2 ** 32) {
      throw new RangeError('Invalid neural seed');
    }
    this.options = options;
    this.controller = new FlyController(options.controller);
    this.now = options.now ?? (() => performance.now());
  }

  connect(): void {
    this.close();
    this.setStatus('connecting');
    const socket = (this.options.socketFactory ?? (url => new WebSocket(url)))(this.options.url);
    this.socket = socket;
    socket.onopen = () => {
      if (this.socket !== socket) return;
      socket.send(JSON.stringify({type: 'hello', protocol: 1, seed: this.options.seed ?? 64, mode: this.options.mode ?? 'live', eyePreviews: !!this.options.onEyes, readout: this.controller.config.readout,
        ...(this.controller.config.readout === 'hybrid' ? {motorShare:this.controller.config.motorShare, motorReadout:this.controller.config.motorReadout} : {})}));
    };
    socket.onmessage = event => {
      if (this.socket !== socket || typeof event.data !== 'string') return;
      let message: Record<string, unknown>;
      try { message = JSON.parse(event.data); } catch { return; }
      if (!message || typeof message !== 'object') return;
      if (message.type === 'ready') {
        const backendAllowed = message.backend === 'malecns' ||
          (this.options.allowFixture === true && message.backend === 'synthetic-fixture');
        if (this.controller.config.readout === 'plastic-motor' &&
            (typeof message.motorPatchSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(message.motorPatchSha256) ||
             message.throttleMode !== 'neural')) {
          this.close(); this.setStatus('error'); return;
        }
        if (this.ready || (message.readout ?? 'descending') !== this.controller.config.readout ||
            (this.controller.config.readout === 'hybrid' && message.motorShare !== this.controller.config.motorShare) ||
            (this.controller.config.readout === 'hybrid' && (message.motorReadout ?? 'rates') !== this.controller.config.motorReadout) ||
            message.protocol !== 1 || message.neuralHz !== 50 || !backendAllowed ||
            message.mode !== (this.options.mode ?? 'live') || message.seed !== (this.options.seed ?? 64)) {
          this.close();
          this.setStatus('error');
          return;
        }
        this.metadata = Object.freeze({...message});
        this.ready = true;
        this.setStatus('ready');
        return;
      }
      if (!this.ready) return;
      if (message.type === 'eyes') {
        const captured = this.frames.get(message.frameId as number);
        if (!this.options.onEyes || captured === undefined || this.now() - captured >= 500 ||
            message.width !== 256 || message.height !== 128 || message.encoding !== 'rgb8-base64' ||
            message.mode !== (this.options.mode ?? 'live') || !Number.isSafeInteger(message.sequence) ||
            (message.sequence as number) < 0 || typeof message.pixels !== 'string' || message.pixels.length !== 131072) return;
        let decoded: string;
        try { decoded = atob(message.pixels); } catch { return; }
        if (decoded.length !== 256 * 128 * 3) return;
        this.options.onEyes({frameId: message.frameId as number, sequence: message.sequence as number,
          width: 256, height: 128, rgb: Uint8Array.from(decoded, c => c.charCodeAt(0))});
        return;
      }
      if (message.type === 'stale') {
        this.acceptedCaptureMs = -Infinity;
        this.setStatus('stale');
        return;
      }
      if (message.type !== 'activity') return;
      const now = this.now();
      const captured = this.frames.get(message.frameId as number);
      if (captured === undefined || now < captured || now - captured >= 500) return;
      if (this.controller.accept(message, now)) {
        this.acceptedCaptureMs = captured;
        this.acceptedAtMs = now;
        this.setStatus('ready');
        this.options.onActivity?.({forwardHz: message.forwardHz as number, leftHz: message.leftHz as number, rightHz: message.rightHz as number});
      }
    };
    socket.onclose = () => {
      if (this.socket === socket) this.close();
    };
    socket.onerror = () => {
      if (this.socket !== socket) return;
      this.close();
      this.setStatus('error');
    };
  }

  // The caller supplies top-down RGB8 pixels and a local capture timestamp.
  sendFrame(rgb: Uint8Array, capturedAtMs = this.now()): boolean {
    const now = this.now();
    if (rgb.byteLength !== FLY_FRAME_BYTES) throw new RangeError('Expected a 384x256 RGB8 atlas');
    if (!Number.isFinite(capturedAtMs) || capturedAtMs < 0 || capturedAtMs > now || now - capturedAtMs >= 500) return false;
    if (!this.socket || !this.ready || this.socket.bufferedAmount > 0) return false;
    for (const [id, captured] of this.frames) if (now - captured >= 500) this.frames.delete(id);
    if (this.frames.size >= 32) return false;
    if (this.nextFrame >= 2 ** 32) { this.close(); return false; }
    const packet = new Uint8Array(4 + FLY_FRAME_BYTES);
    new DataView(packet.buffer).setUint32(0, this.nextFrame, true);
    packet.set(rgb, 4);
    try { this.socket.send(packet); } catch { this.close(); return false; }
    this.frames.set(this.nextFrame++, capturedAtMs);
    return true;
  }

  input(dtSeconds: number, active = true) {
    const now = this.now();
    const fresh = now >= this.acceptedCaptureMs && now - this.acceptedCaptureMs < 500;
    if (this.status === 'ready' && this.acceptedAtMs !== -Infinity &&
        (!fresh || now - this.acceptedAtMs >= this.controller.config.staleMs)) this.setStatus('stale');
    return this.controller.step(dtSeconds, now, active && this.ready && fresh && this.status === 'ready');
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    this.ready = false;
    this.metadata = null;
    this.frames.clear();
    this.nextFrame = 0;
    this.acceptedCaptureMs = -Infinity;
    this.acceptedAtMs = -Infinity;
    this.controller.reset();
    socket?.close();
    this.setStatus('offline');
  }

  private setStatus(status: FlyStatus) {
    if (status === this.status) return;
    this.status = status;
    this.options.onStatus?.(status);
  }
}

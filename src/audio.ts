import { RaceMusic } from "./music";

/** Audio starts only after a user gesture. One reusable engine loop per session. */
export class RaceAudio {
  private context?: AudioContext;
  private engine?: AudioBufferSourceNode;
  private gain?: GainNode;
  private master?: GainNode;
  private music = new RaceMusic();
  muted = false;
  async unlock() {
    this.music.play();
    if (this.context) {
      await this.context.resume();
      return;
    }
    const context = (this.context = new AudioContext());
    this.master = context.createGain();
    this.master.connect(context.destination);
    this.master.gain.value = this.muted ? 0 : 0.35;
    try {
      const response = await fetch("/assets/audio/engine.wav");
      if (!response.ok) throw new Error("Engine audio unavailable");
      const buffer = await context.decodeAudioData(
        await response.arrayBuffer(),
      );
      this.engine = context.createBufferSource();
      this.engine.buffer = buffer;
      this.engine.loop = true;
      this.gain = context.createGain();
      this.gain.gain.value = 0;
      this.engine.connect(this.gain).connect(this.master);
      this.engine.start();
    } catch (error) {
      console.warn("Audio unavailable", error);
    }
  }
  toggle() {
    this.muted = !this.muted;
    this.music.setMuted(this.muted);
    if (this.context && this.master)
      this.master.gain.setTargetAtTime(
        this.muted ? 0 : 0.35,
        this.context.currentTime,
        0.03,
      );
  }
  update(speed: number, active: boolean) {
    if (!this.context || !this.engine || !this.gain) return;
    this.engine.playbackRate.setTargetAtTime(
      0.65 + Math.min(Math.abs(speed) / 24, 1.5),
      this.context.currentTime,
      0.12,
    );
    this.gain.gain.setTargetAtTime(
      active ? 0.65 : 0,
      this.context.currentTime,
      0.08,
    );
  }
  cue(frequency: number, duration = 0.14, delay = 0) {
    if (!this.context || !this.master) return;
    const start = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator(),
      gain = this.context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.22, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
    oscillator.connect(gain).connect(this.master);
    oscillator.start(start);
    oscillator.stop(start + duration);
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
    };
  }
}

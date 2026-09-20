/** Local soundtrack, started by the race/sound user gesture. */
export class RaceMusic {
  private audio = new Audio("/assets/audio/race-theme.mp3");
  private readonly startSeconds = 20;
  private readonly fadeSeconds = 3;
  private starting = false;

  constructor() {
    this.audio.volume = 0;
    this.audio.preload = "metadata";
    this.audio.addEventListener("loadedmetadata", () => {
      this.audio.currentTime = this.startSeconds;
    });
    // Playback time keeps the fade aligned even if buffering interrupts playback.
    this.audio.addEventListener("timeupdate", () => {
      const progress = Math.max(0, Math.min(1,
        (this.audio.currentTime - this.startSeconds) / this.fadeSeconds));
      this.audio.volume = 0.4 * progress;
    });
    // Repeat from 0:20 too, rather than bringing the skipped intro back.
    this.audio.addEventListener("ended", () => {
      this.audio.volume = 0;
      this.audio.currentTime = this.startSeconds;
      this.play();
    });
  }

  play() {
    if (this.audio.paused && !this.starting) {
      this.starting = true;
      if (this.audio.currentTime < this.startSeconds) {
        this.audio.currentTime = this.startSeconds;
      }
      void this.audio.play().catch((error: unknown) => {
        console.warn("Background music could not start", error);
      }).finally(() => { this.starting = false; });
    }
  }

  setMuted(muted: boolean) {
    this.audio.muted = muted;
  }
}

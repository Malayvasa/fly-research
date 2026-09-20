/** Local soundtrack, started by the race/sound user gesture. */
export class RaceMusic {
  private audio = new Audio("/assets/audio/race-theme.mp3");

  constructor() {
    this.audio.loop = true;
    this.audio.volume = 0.4;
    this.audio.preload = "none";
  }

  play() {
    if (this.audio.paused) {
      void this.audio.play().catch((error: unknown) => {
        console.warn("Background music could not start", error);
      });
    }
  }

  setMuted(muted: boolean) {
    this.audio.muted = muted;
  }
}

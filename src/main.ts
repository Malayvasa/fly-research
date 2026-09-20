import "./style.css";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { buildWorld, scene, prototypes } from "./world";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { Kart, emptyInput, type VehicleInput } from "./vehicle";
import { gates, samples, pose } from "./track";
import { createPhysicsWorld } from "./physics";
import { advanceProgress, formatTime } from "./race";
import { RaceAudio } from "./audio";
const audio = new RaceAudio();
const hud = document.querySelector<HTMLElement>("#hud")!;
const canvas = document.querySelector<HTMLCanvasElement>("#world")!;
const mapPath =
  samples
    .filter((_, i) => i % 8 === 0)
    .map((p, i) => `${i ? "L" : "M"}${(p.x + 115) * 0.36},${(p.z + 80) * 0.36}`)
    .join(" ") + "Z";
hud.innerHTML = `<section class="racer npc"><div class="badge"><img src="/assets/cars/portrait-npc.png" alt="Opponent kart"/></div><div><div class="eyebrow">Practice opponent</div><div class="name">The challenger</div><div class="stats"><span class="metric" id="npc-lap">1<small>/ 3</small></span><span class="metric" id="npc-time">0:00.000</span></div></div><div class="speed"><span id="npc-speed">0</span><small>KM/H</small></div><div class="placement" id="npc-place" aria-label="Opponent position">—</div></section><section class="center"><svg class="map" viewBox="0 0 84 60" aria-label="Track positions"><path d="${mapPath}" fill="none" stroke="#d2d9c6" stroke-width="5" stroke-linejoin="round"/><path d="${mapPath}" fill="none" stroke="#f8faf1" stroke-width="1.5"/><circle id="npc-dot" r="3" fill="#db927b" stroke="#f6f7ee" stroke-width="1.5"/><circle id="human-dot" r="3" fill="#708a3f" stroke="#f6f7ee" stroke-width="1.5"/></svg><div class="center-info"><div class="eyebrow">Level 01 · Fly Racer</div><div class="circuit-title">Meadow Circuit</div><div id="status" aria-live="polite"><span class="substatus">Loading the meadow…</span></div></div></section><section class="racer human"><div class="badge"><img src="/assets/cars/portrait-human.png" alt="Your kart"/></div><div><div class="eyebrow" id="human-position">Human driver</div><div class="name">You</div><div class="stats"><span class="metric" id="human-lap">1<small>/ 3</small></span><span class="metric" id="human-time">0:00.000</span></div></div><div class="speed"><span id="human-speed">0</span><small>KM/H</small></div><div class="placement" id="human-place" aria-label="Your position">—</div></section><button class="icon-button sound-toggle" data-action="sound" aria-label="Mute sound">♪</button><section class="finish-panel hidden" id="results"></section>`;
const el = (id: string) => document.getElementById(id)!;
let renderer: THREE.WebGLRenderer;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
  });
} catch {
  el("status").textContent = "WebGL is unavailable in this browser.";
  throw new Error("WebGL unavailable");
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.95;
renderer.setScissorTest(true);
let world: RAPIER.World, npc: Kart, human: Kart;
type Phase = "loading" | "ready" | "countdown" | "racing" | "finished";
let phase: Phase = "loading",
  paused = false,
  time = 0,
  countdown = 3.5,
  lastCount = -1,
  accumulator = 0,
  lastFrame = 0,
  winner: string | null = null;
const verification =
  import.meta.env.DEV &&
  new URLSearchParams(location.search).get("verify") === "1";
let jumpQueued = false;
const keys = new Set<string>();
window.addEventListener("keydown", (e) => {
  if (["KeyW", "KeyA", "KeyS", "KeyD", "Space"].includes(e.code)) {
    if ((e.target as HTMLElement)?.tagName === "BUTTON" && e.code === "Space")
      return;
    e.preventDefault();
    keys.add(e.code);
    if (e.code === "Space" && !e.repeat) jumpQueued = true;
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => {
  keys.clear();
  if (phase === "racing" || phase === "countdown") {
    paused = true;
    updateStatus();
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    keys.clear();
    if (phase === "racing" || phase === "countdown") {
      paused = true;
      updateStatus();
    }
  }
});
function humanInput(): VehicleInput {
  return {
    throttle: keys.has("KeyW") ? 1 : 0,
    brake: keys.has("KeyS") ? 1 : 0,
    steering: Number(keys.has("KeyD")) - Number(keys.has("KeyA")),
    jump: keys.has("Space") || jumpQueued,
  };
}
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  if (npc)
    for (const kart of [npc, human]) {
      kart.camera.aspect = innerWidth / 2 / innerHeight;
      kart.camera.updateProjectionMatrix();
    }
}
window.addEventListener("resize", resize);
resize();
function updateStatus() {
  hud.dataset.phase = phase;
  hud.dataset.paused = String(paused);
  const status = el("status");
  if (paused) {
    status.innerHTML =
      '<button class="action" data-action="resume">RESUME ▶</button>';
    return;
  }
  if (phase === "ready")
    status.innerHTML =
      '<button class="action" data-action="start">LET’S RACE!</button>';
  else if (phase === "countdown")
    status.innerHTML = `<div class="race-clock count">${Math.max(1, Math.ceil(countdown))}</div>`;
  else if (phase === "racing")
    status.innerHTML =
      '<div class="race-actions"><span class="race-clock" id="race-clock">0:00.000</span><button class="icon-button" data-action="pause" aria-label="Pause race">Ⅱ</button><button class="icon-button" data-action="reset" aria-label="Recover your kart">↺</button></div>';
  else if (phase === "finished")
    status.innerHTML =
      '<button class="action" data-action="start">RACE AGAIN ↗</button>';
}
hud.addEventListener("click", (e) => {
  const action = (e.target as HTMLElement).closest<HTMLButtonElement>("button")
    ?.dataset.action;
  if (action === "start" || action === "resume" || action === "sound")
    void audio.unlock();
  if (action === "sound") {
    audio.toggle();
    const button = hud.querySelector(".sound-toggle")!;
    button.textContent = audio.muted ? "×♪" : "♪";
    button.setAttribute(
      "aria-label",
      audio.muted ? "Unmute sound" : "Mute sound",
    );
  }
  if (action === "start") startRace();
  if (action === "pause") {
    paused = true;
    keys.clear();
    updateStatus();
  }
  if (action === "resume") {
    paused = false;
    accumulator = 0;
    updateStatus();
  }
  if (action === "reset" && phase === "racing") human.reset();
  (e.target as HTMLElement).closest("button")?.blur();
});
function startRace() {
  npc.reset(true);
  human.reset(true);
  keys.clear();
  jumpQueued = false;
  time = 0;
  countdown = 3;
  lastCount = -1;
  accumulator = 0;
  winner = null;
  paused = false;
  phase = "countdown";
  el("results").classList.add("hidden");
  el("human-position").textContent = "Human driver";
  updateStatus();
}
function finish() {
  phase = "finished";
  [523, 659, 784, 1047].forEach((note, i) => audio.cue(note, 0.3, i * 0.16));
  keys.clear();
  updateStatus();
  el("human-position").textContent =
    winner === "human" ? "1st place · Finished" : "2nd place · Finished";
  const total = human.progress.finishTime;
  const best = Math.min(...human.progress.lapTimes);
  const result = el("results");
  result.classList.remove("hidden");
  result.innerHTML = `<div><div class="eyebrow">Meadow Circuit · Race complete</div><div class="finish-title">${winner === "human" ? "The meadow is yours." : "A good run. One more?"}</div><div class="finish-sub">${winner === "human" ? "1st place" : "2nd place"} · ${formatTime(total)} · Best lap ${formatTime(best)}${human.resets ? ` · ${human.resets} recoveries` : ""} · Opponent ${npc.progress.finishTime === null ? "unfinished" : formatTime(npc.progress.finishTime)}</div></div><div class="splits">${human.progress.lapTimes.map((t, i) => `<div class="split"><small>LAP 0${i + 1}</small>${formatTime(t)}</div>`).join("")}</div><button class="action" data-action="start">RACE AGAIN ↗</button>`;
  spawnConfetti();
}
const confetti: THREE.Mesh[] = [];
function spawnConfetti() {
  for (const c of confetti) {
    scene.remove(c);
    c.geometry.dispose();
    (c.material as THREE.Material).dispose();
  }
  confetti.length = 0;
  const p = human.body.translation();
  for (let i = 0; i < 100; i++) {
    const c = new THREE.Mesh(
      new THREE.PlaneGeometry(0.17, 0.3),
      new THREE.MeshBasicMaterial({
        color: [0xd6e887, 0xf0a184, 0xfff7db, 0x82baba][i % 4],
        side: THREE.DoubleSide,
      }),
    );
    c.position.set(
      p.x + (Math.random() - 0.5) * 15,
      5 + Math.random() * 10,
      p.z + (Math.random() - 0.5) * 15,
    );
    c.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    scene.add(c);
    confetti.push(c);
  }
}
function fixedStep(dt: number) {
  if (paused) return;
  if (phase === "countdown") {
    countdown -= dt;
    const n = Math.ceil(countdown);
    if (n !== lastCount) {
      lastCount = n;
      audio.cue(n > 0 ? 440 : 880, n > 0 ? 0.12 : 0.4);
      updateStatus();
    }
    if (countdown <= 0) {
      phase = "racing";
      time = 0;
      updateStatus();
    }
  }
  if (phase === "racing") time += dt;
  const active = phase === "racing";
  npc.step(
    dt,
    active ? npc.npcInput() : emptyInput(),
    active && npc.progress.finishTime === null,
  );
  human.step(
    dt,
    active ? (verification ? human.npcInput() : humanInput()) : emptyInput(),
    active && human.progress.finishTime === null,
  );
  jumpQueued = false;
  world.step();
  if (active) {
    for (const kart of [npc, human]) {
      const laps = kart.progress.lapTimes.length;
      advanceProgress(kart.progress, kart.body.translation(), gates, time);
      if (kart === human && kart.progress.lapTimes.length > laps)
        audio.cue(1047, 0.25);
      if (kart.progress.finishTime !== null && !winner)
        winner = kart === human ? "human" : "npc";
    }
    if (human.progress.finishTime !== null) finish();
  }
}
function updateHud() {
  for (const [id, kart] of [
    ["npc", npc],
    ["human", human],
  ] as const) {
    el(`${id}-speed`).textContent = String(
      Math.round(Math.abs(kart.speed) * 3.6),
    );
    el(`${id}-lap`).innerHTML =
      `${Math.min(3, kart.progress.lapTimes.length + 1)}<small>/ 3</small>`;
    el(`${id}-time`).textContent =
      phase === "finished" && kart.progress.finishTime === null
        ? "Unfinished"
        : formatTime(
            kart.progress.finishTime ??
              Math.max(0, time - kart.progress.lapStarted),
          );
    const p = kart.body.translation();
    el(`${id}-dot`).setAttribute("cx", String((p.x + 115) * 0.36));
    el(`${id}-dot`).setAttribute("cy", String((p.z + 80) * 0.36));
  }
  const humanFirst = winner
    ? winner === "human"
    : human.progress.passed + human.nearU >= npc.progress.passed + npc.nearU;
  for (const [id, first] of [
    ["human", humanFirst],
    ["npc", !humanFirst],
  ] as const) {
    const rank = el(`${id}-place`);
    rank.dataset.rank = first ? "1" : "2";
    rank.innerHTML =
      phase === "ready" || phase === "countdown"
        ? "—"
        : `${first ? "1" : "2"}<small>${first ? "st" : "nd"}</small>`;
    rank.setAttribute(
      "aria-label",
      `${id === "human" ? "Your" : "Opponent"} position: ${phase === "ready" || phase === "countdown" ? "waiting" : first ? "1st" : "2nd"}`,
    );
  }
  const clock = el("race-clock");
  if (clock) clock.textContent = formatTime(time);
  if (phase === "racing") {
    const hp = human.progress.passed + human.nearU,
      np = npc.progress.passed + npc.nearU;
    el("human-position").textContent =
      winner === "npc"
        ? "Opponent finished"
        : hp >= np
          ? "1st position"
          : "2nd position";
  }
}
let hudTick = 0;
function frame(stamp: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((stamp - lastFrame) / 1000 || 0, 0.06);
  lastFrame = stamp;
  if (!npc) return;
  audio.update(human.speed, !paused && phase === "racing");
  if (!paused) {
    accumulator += dt * (verification ? 4 : 1);
    while (accumulator >= 1 / 60) {
      fixedStep(1 / 60);
      accumulator -= 1 / 60;
    }
  }
  for (const kart of [npc, human])
    kart.render(
      paused ? 0 : dt,
      paused ? 1 : accumulator * 60,
      phase === "finished",
    );
  for (const c of confetti) {
    c.position.y -= dt * 2;
    c.rotation.x += dt;
    c.rotation.z += dt * 0.6;
    c.visible = c.position.y > 0.1;
  }
  renderer.shadowMap.autoUpdate = true;
  const left = Math.floor(innerWidth / 2);
  renderer.setViewport(0, 0, left, innerHeight);
  renderer.setScissor(0, 0, left, innerHeight);
  renderer.render(scene, npc.camera);
  renderer.shadowMap.autoUpdate = false;
  renderer.setViewport(left, 0, innerWidth - left, innerHeight);
  renderer.setScissor(left, 0, innerWidth - left, innerHeight);
  renderer.render(scene, human.camera);
  hudTick += dt;
  if (hudTick > 0.07) {
    updateHud();
    hudTick = 0;
  }
}
async function init() {
  await Promise.all([
    RAPIER.init(),
    buildWorld((text) => {
      el("status").textContent = text;
    }),
  ]);
  world = createPhysicsWorld();
  // Low continuous safety rails: the same collision boundaries for both racers.
  const railGeometries: THREE.BufferGeometry[][] = [[], []];
  for (let i = 0; i < 240; i++)
    for (const side of [-1, 1]) {
      const p = pose(i / 240, side * 10.1);
      const q = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 1, 0),
        p.yaw,
      );
      const rail = new THREE.BoxGeometry(0.25, 0.5, 2.6);
      rail.rotateY(p.yaw);
      rail.translate(p.position.x, 0.25, p.position.z);
      railGeometries[i % 6 < 3 ? 0 : 1].push(rail);
    }
  railGeometries.forEach((geometries, i) => {
    const rail = new THREE.Mesh(
      mergeGeometries(geometries),
      new THREE.MeshStandardMaterial({
        color: i ? 0x829276 : 0xf1ecd8,
        roughness: 1,
      }),
    );
    rail.castShadow = true;
    rail.receiveShadow = true;
    scene.add(rail);
  });
  npc = new Kart(world, prototypes.get("cars/race")!, 2.7);
  human = new Kart(world, prototypes.get("cars/hatchback-sports")!, -2.7);
  scene.add(npc.visual, human.visual);
  world.step();
  resize();
  phase = "ready";
  updateStatus();
  updateHud();
  if (verification) startRace();
  // Read-only diagnostics for verification. No production input shortcuts.
  if (import.meta.env.DEV)
    Object.defineProperty(window, "__raceDebug", {
      get: () => ({
        phase,
        paused,
        time,
        winner,
        cars: [npc, human].map((k) => ({
          position: { ...k.body.translation() },
          speed: k.speed,
          yaw: k.yaw,
          progress: structuredClone(k.progress),
          resets: k.resets,
          nearU: k.nearU,
        })),
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      }),
    });
}
init().catch((error) => {
  console.error(error);
  el("status").innerHTML =
    '<span class="substatus">Could not load the circuit.</span> <button class="action" data-action="reload">Retry</button>';
  hud.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).dataset.action === "reload")
      location.reload();
  });
});
requestAnimationFrame(frame);

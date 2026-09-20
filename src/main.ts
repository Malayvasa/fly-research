import "./style.css";
import * as THREE from "three";
import RAPIER from "@dimforge/rapier3d-compat";
import { buildWorld, scene, prototypes } from "./world";
import { Kart, emptyInput, type VehicleInput } from "./vehicle";
import { gates, samples, trackBorder } from "./track";
import { createPhysicsWorld } from "./physics";
import { advanceProgress, formatTime } from "./race";
import { ControllerInput } from "./gamepad";
import { RaceRumble } from "./rumble";
const rumble = new RaceRumble();
const controller = new ControllerInput();
let controllerInput = emptyInput();
import { FlyDriver as FlyAvatar } from "./fly";
let flyAvatar: FlyAvatar;
import { RaceAudio } from "./audio";
import { FlyDriver } from "./fly-driver";
const audio = new RaceAudio();
const hud = document.querySelector<HTMLElement>("#hud")!;
const canvas = document.querySelector<HTMLCanvasElement>("#world")!;
const mapPath =
  samples
    .filter((_, i) => i % 8 === 0)
    .map((p, i) => `${i ? "L" : "M"}${(p.x + 115) * 0.36},${(p.z + 80) * 0.36}`)
    .join(" ") + "Z";
hud.innerHTML = `<section class="racer npc"><div class="badge"><img src="/assets/cars/portrait-fruitis-car.png" alt="Fruitis Flyilton"/></div><div><div class="eyebrow">Practice opponent</div><div class="name">Fruitis Flyilton</div><div class="stats"><span class="metric" id="npc-lap">1<small>/ 3</small></span><span class="metric" id="npc-time">0:00.000</span></div></div><div class="speed"><span id="npc-speed">0</span><small>KM/H</small></div><div class="placement" id="npc-place" aria-label="Opponent position">—</div></section><svg class="race-minimap" viewBox="-10 -10 104 80" role="img" aria-label="Circuit map with live racer positions"><defs><pattern id="finish-checks" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="white"/><path d="M0 0h2v2H0zM2 2h2v2H2z" fill="#243645"/></pattern></defs><path d="${mapPath}" fill="none" stroke="#243645" stroke-opacity=".45" stroke-width="5.5" stroke-linejoin="round"/><path d="${mapPath}" fill="none" stroke="#fffdf1" stroke-width="3" stroke-linejoin="round"/><rect x="${(samples[0].x + 115) * 0.36 - 3}" y="${(samples[0].z + 80) * 0.36 - 4}" width="6" height="8" fill="url(#finish-checks)" stroke="white" stroke-width=".6"/>${["npc", "human"].map((id) => `<g id="${id}-marker"><circle r="5.3" fill="${id === "human" ? "#57cbe9" : "#e68c63"}" stroke="white" stroke-width="1.1"/><image href="/assets/cars/${id === "npc" ? "portrait-fruitis-car.png" : "portrait-human.png"}" x="-5" y="-5" width="10" height="10"/></g>`).join("")}</svg><section class="center"><div class="center-info"><div id="status" aria-live="polite"><span class="substatus">Loading the meadow…</span></div></div></section><section class="racer human"><div class="badge"><img src="/assets/cars/portrait-human.png" alt="Your kart"/></div><div><div class="eyebrow" id="human-position">Human driver</div><div class="name">You</div><div class="stats"><span class="metric" id="human-lap">1<small>/ 3</small></span><span class="metric" id="human-time">0:00.000</span></div></div><div class="speed"><span id="human-speed">0</span><small>KM/H</small></div><div class="placement" id="human-place" aria-label="Your position">—</div></section><button class="icon-button sound-toggle" data-action="sound" aria-label="Mute sound">♪</button><section class="finish-panel hidden" id="results"></section>`;
const goSignal = document.createElement("div");
goSignal.className = "go-signal hidden";
goSignal.textContent = "GO!";
goSignal.setAttribute("role", "status");
hud.append(goSignal);
const el = (id: string) => document.getElementById(id)!;
const fly = new FlyDriver(() => { if (npc && human) startRace(); });
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
function setPaused(value: boolean) {
  if (value) rumble.stop();
  paused = value;
  keys.clear();
  jumpQueued = false;
  accumulator = 0;
  audio.update(0, false);
  updateStatus();
}
window.addEventListener("keydown", (e) => {
  if (e.code === "Escape" && (phase === "racing" || phase === "countdown")) {
    e.preventDefault();
    if (!e.repeat) setPaused(!paused);
    return;
  }
  if (paused) {
    if (e.code === "Tab") {
      const buttons = Array.from(
        hud.querySelectorAll<HTMLButtonElement>(
          ".pause-menu button:not(:disabled)",
        ),
      );
      const index = buttons.indexOf(
        document.activeElement as HTMLButtonElement,
      );
      e.preventDefault();
      buttons[
        (index + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length
      ]?.focus();
    }
    return;
  }
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
    setPaused(true);
  }
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    keys.clear();
    if (phase === "racing" || phase === "countdown") {
      setPaused(true);
    }
  }
});
function humanInput(): VehicleInput {
  const brake = keys.has("KeyS") ? 1 : controllerInput.brake;
  return {
    throttle: brake > 0 ? 0 : keys.has("KeyW") ? 1 : controllerInput.throttle,
    brake,
    steering:
      keys.has("KeyD") || keys.has("KeyA")
        ? Number(keys.has("KeyD")) - Number(keys.has("KeyA"))
        : controllerInput.steering,
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
    status.innerHTML = `<div class="pause-menu" role="dialog" aria-modal="true" aria-labelledby="pause-title"><h2 id="pause-title">PAUSED</h2><button class="action" data-action="resume">RESUME ▶</button><button class="action pause-secondary" data-action="reset" ${phase === "countdown" ? "disabled" : ""}>RESET POSITION</button><button class="action pause-secondary" data-action="start">RESTART RACE</button></div>`;
    status.querySelector<HTMLButtonElement>("button")?.focus();
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
    setPaused(true);
  }
  if (action === "resume") {
    setPaused(false);
  }
  if (action === "reset" && phase === "racing") {
    human.reset();
    setPaused(false);
  }
  (e.target as HTMLElement).closest("button")?.blur();
});
function startRace() {
  fly.reset();
  hud.querySelector('.npc .eyebrow')!.textContent = fly.enabled ? (fly.highSpeed ? 'Fly · learned steering + speed' : fly.plasticMotor ? 'Fly · motor steering + throttle' : 'Fly · assisted throttle') : 'Practice opponent';
  rumble.stop();
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
  goSignal.classList.add("hidden");
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
  const best = Math.min(...human.progress.lapTimes);
  const result = el("results");
  result.classList.remove("hidden");
  const racers = winner === "human" ? [human, npc] : [npc, human];
  result.innerHTML = `<div class="result-hero"><div class="finish-title">FINISH!</div><div class="result-place">${winner === "human" ? "1<small>st</small>" : "2<small>nd</small>"}</div></div><div class="result-details"><div class="result-standings">${racers.map((kart, index) => `<div class="result-row ${kart === human ? "is-you" : ""}"><span class="result-rank">${index + 1}</span><img src="/assets/cars/${kart === human ? "portrait-human.png" : "portrait-fruitis-car.png"}" alt=""/><strong>${kart === human ? "You" : "Fruitis Flyilton"}</strong><span class="result-time">${kart.progress.finishTime === null ? "Unfinished" : formatTime(kart.progress.finishTime)}</span></div>`).join("")}</div><div class="splits">${human.progress.lapTimes.map((t, i) => `<div class="split"><small>LAP ${i + 1}</small>${formatTime(t)}</div>`).join("")}<div class="split best-split"><small>BEST LAP</small>${formatTime(best)}</div></div>${human.resets ? `<div class="finish-sub">${human.resets} recoveries</div>` : ""}</div><button class="action result-replay" data-action="start">RACE AGAIN <span aria-hidden="true">▶</span></button>`;
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
      goSignal.classList.remove("hidden");
      updateStatus();
    }
  }
  if (phase === "racing") {
    time += dt;
    if (time >= 1) goSignal.classList.add("hidden");
  }
  const active = phase === "racing";
  const flyInput = fly.step(dt, active, npc.speed);
  npc.step(
    dt,
    active ? (fly.enabled ? flyInput : npc.npcInput()) : emptyInput(),
    active && npc.progress.finishTime === null && (!fly.enabled || fly.client.status === 'ready'),
  );
  human.step(
    dt,
    active ? (verification ? human.npcInput() : humanInput()) : emptyInput(),
    active && human.progress.finishTime === null,
  );
  jumpQueued = false;
  if (fly.recoverIfStuck(dt, npc.speed, active && npc.progress.finishTime === null)) npc.reset();
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
    el(`${id}-marker`).setAttribute(
      "transform",
      `translate(${(p.x + 115) * 0.36} ${(p.z + 80) * 0.36})`,
    );
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
  let pads: (Gamepad | null)[] = [];
  try {
    pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
  } catch {
    /* Keyboard remains available if gamepad access is denied. */
  }
  const pad = controller.poll(pads);
  controllerInput = emptyInput();
  if (pad.disconnected && (phase === "racing" || phase === "countdown"))
    setPaused(true);
  if (document.hasFocus() && !document.hidden && !pad.disconnected) {
    controllerInput = pad.input;
    const actions = pad.actions;
    if (actions.pause && (phase === "racing" || phase === "countdown"))
      setPaused(!paused);
    else if (paused) {
      const buttons = Array.from(
        hud.querySelectorAll<HTMLButtonElement>(
          ".pause-menu button:not(:disabled)",
        ),
      );
      if (actions.up || actions.down) {
        const current = Math.max(
          0,
          buttons.indexOf(document.activeElement as HTMLButtonElement),
        );
        buttons[
          (current + (actions.up ? -1 : 1) + buttons.length) % buttons.length
        ]?.focus();
      }
      if (actions.back) setPaused(false);
      else if (actions.confirm)
        (document.activeElement as HTMLButtonElement)?.click();
    } else if (actions.confirm && (phase === "ready" || phase === "finished")) {
      hud
        .querySelector<HTMLButtonElement>(
          phase === "ready"
            ? '#status [data-action="start"]'
            : '#results [data-action="start"]',
        )
        ?.click();
    } else if (actions.confirm && phase === "racing") jumpQueued = true;
  }
  audio.update(human.speed, !paused && phase === "racing");
  if (!paused) {
    accumulator += dt * (verification ? 4 : 1);
    while (accumulator >= 1 / 60) {
      fixedStep(1 / 60);
      accumulator -= 1 / 60;
    }
  }
  const vibration =
    pad.index === null
      ? null
      : (pads.find((p) => p?.index === pad.index)?.vibrationActuator ?? null);
  const velocity = human.body.linvel();
  rumble.update(
    stamp,
    vibration,
    !paused && phase === "racing" && document.hasFocus() && !document.hidden,
    {
      speed: Math.hypot(velocity.x, velocity.z),
      verticalSpeed: velocity.y,
      grounded: human.grounded,
      throttle: humanInput().throttle,
    },
  );
  for (const kart of [npc, human])
    kart.render(
      paused ? 0 : dt,
      paused ? 1 : accumulator * 60,
      phase === "finished",
    );
  flyAvatar?.update(
    paused ? 0 : dt,
    npc.speed,
    npc.steer,
    npc.body.linvel().y,
    npc.grounded,
  );
  for (const c of confetti) {
    c.position.y -= dt * 2;
    c.rotation.x += dt;
    c.rotation.z += dt * 0.6;
    c.visible = c.position.y > 0.1;
  }
  renderer.shadowMap.autoUpdate = true;
  fly.capture(renderer, scene, new THREE.Vector3().copy(npc.body.translation()), npc.yaw, npc.visual,
    !paused && (phase === 'countdown' || phase === 'racing') && npc.progress.finishTime === null);
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
  const railMaterials = [0xf1ecd8, 0x829276].map(
    (color) =>
      new THREE.MeshStandardMaterial({
        color,
        roughness: 1,
        side: THREE.DoubleSide,
      }),
  );
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(
      trackBorder(side * 10.1, 0.25, 0, 0.5, 960, 12),
      railMaterials,
    );
    rail.castShadow = true;
    rail.receiveShadow = true;
    scene.add(rail);
  }
  npc = new Kart(world, prototypes.get("cars/race")!, 2.7);
  human = new Kart(world, prototypes.get("cars/hatchback-sports")!, -2.7);
  flyAvatar = new FlyAvatar();
  flyAvatar.root.position.set(0, 0.22, -0.1);
  flyAvatar.root.scale.setScalar(1.15);
  npc.visual.add(flyAvatar.root);
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
        fly: {mode: fly.enabled, status: fly.client.status, frames: fly.frames, eyeFrames: fly.eyeFrames, recoveries: fly.recovery.count, input: {...fly.input}, metadata: fly.client.metadata, motorEffect: fly.client.motorEffect},
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

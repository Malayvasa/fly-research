# Training/game parity audit

The Meadow centreline, visual road/rails, car dynamics, tone mapping and six-face camera layout were shared. However, the following differences were found and corrected:

- Training/evaluation used the F1 physics helper even for Meadow: a 4000 m ground half-extent and `ceil(length/2.5)` rail segments, versus 600 m and 240 rail segments in gameplay. Both now call the same physics factory; Meadow retains the original game settings.
- Gameplay supplied an interpolated display position to the eye camera; evaluation supplied the latest physical position. Both now use the rigid-body position.
- Eye capture disabled shadow updates and inherited spectator shadow history. Gameplay refreshed shadows every display frame with the car visible; training rendered one initial shadow map. Eye capture now refreshes once with the observed car hidden and reuses that result for all six faces. The spectator shadow map is invalidated afterward.
- Gameplay begins neural processing during its 3.5-second countdown. Evaluation now includes a 3.5-second neutral-control warm-up after handshake.

`vision-parity.html` exercises the real WebGL capture: changing only the hidden car's prior spectator shadow must produce zero changed sensor RGB bytes, while preserving viewport/scissor state and visibility. This passed in the in-app browser. All 55 existing tests and TypeScript checking passed.

This is not a claim that existing learned weights now drive reliably. Existing data/features were captured with the previous rendering and physics setup. They should be versioned as legacy evidence and fresh captures used for further fitting. Remaining differences include a human-driven opponent and race effects in gameplay, and realtime render/neural scheduling versus fixed offline encoding. The visual parity check covers shadow-history contamination, not every difference between a full game and a training rollout.

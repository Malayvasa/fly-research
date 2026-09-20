# Meadow braking correction, batch C

Batch B failed both seeds before completing one lap. Both left the road around u=0.63. The speed decoder sometimes still requested 22.45 m/s (~81 km/h) at a measured offset of 9.39 m.

Batch C changes offline supervisory labels, not the runtime driver:

- Look 60 m ahead, with a 12 m braking margin and a 5 m/s² braking envelope.
- Use a more conservative 7 m/s² lateral acceleration target for corners.
- Label large offsets with progressively lower speed targets (down to 4 m/s).
- Reuse all six cached neural-feature batches with newly computed labels.
- Re-render the recorded failed approaches and small pose perturbations as an additional training-only dataset. These are reconstructed camera views, not recovered original camera frames or successful physical laps. Repeated poses do not count as independent evidence.

The existing held-out segments remain the offline validation/test split. Reconstructed failure examples are excluded from those sets. Fresh closed-loop runs, including actual throttle/brake telemetry, determine whether the correction improves driving. The original runtime speed servo is unchanged; it receives the new learned target speed. There is no track-aware braking override at runtime.

The dashboard runs two one-lap screening attempts (seeds 64 and 65). Both must pass before the longer three-lap attempts run. The model is not automatically promoted to the main game.

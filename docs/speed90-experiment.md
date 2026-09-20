# 90 km/h experiment

Target: 25 m/s on straights, slower corners. This is an experimental learned
steering and target-speed readout, not a change to the default 8 m/s driver.
The fixed full connectome runs; motor decoder influence may be zero if validation
selects that candidate. Throttle and brake follow a deterministic speed servo.
No map position, curvature, or teacher commands enter the learned runtime.

The isolated training page collects current-scene RGB camera atlases and labels
from the scripted teacher. The teacher uses geometry to plan braking. Sequential
laps and randomized off-center poses are separate captures. The last contiguous
segments of each recording are held out; this is not evaluation on unseen tracks.

Local tools:

- `scripts/vite-training90.config.mjs`: loopback capture and run-report endpoints.
- `/training90.html`: fixed overhead teacher view. `?recovery=1` collects posed
  recovery examples, not physical driving runs.
- `brain/train_speed.py`: fits steering plus normalized target speed using joint
  visual and motor features. Compares motor-enabled and zero-motor candidates.
- `/evaluate90.html`: independent neural seeds, ordered three-lap checkpoints,
  reset/failure gates. Runs are sequential to avoid competing neural workloads.
- `/runs.html`: simultaneous top-down views of recorded and current trajectories.

Candidate model artifacts live under ignored `artifacts/`; they are not promoted
to `brain/models/` by training. Each evaluation must use the matching candidate.
The experimental game flag is `?opponent=fly&readout=combined&pace=90` and requires
a service announcing `speedControl=learned-target-25mps`. Without a valid fresh
speed prediction, it sends neutral controls. Normal combined mode keeps its
existing speed cap.

Initial training: 1,800 consecutive camera frames from 180 simulated seconds.
Teacher maximum 89.26 km/h, 95th percentile 88.04 km/h, maximum lateral distance
2.89 m, zero resets. The initial learned candidate failed at the first bend;
low offline prediction errors did not establish driving success. Recovery-data
retraining and closed-loop evaluation are recorded separately.

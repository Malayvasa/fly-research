# Five selectable GP circuits

All five layouts use mapped geographic centerlines from [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits), under the MIT license retained in `src/circuits/LICENSE-MONZA.txt`.

| Circuit | Source file | Calibrated lap |
| --- | --- | --- |
| Monza | it-1922.geojson | 5.793 km |
| Silverstone | gb-1948.geojson | 5.891 km |
| Spa-Francorchamps | be-1925.geojson | 7.004 km |
| Interlagos | br-1940.geojson | 4.309 km |
| Red Bull Ring | at-1969.geojson | 4.318 km |

Choose a circuit from the cards before starting. Keyboard arrows or controller stick/D-pad navigate the cards; Enter/Cross selects. Selecting the current track focuses Let's Race. Selection lives in the URL (`?track=spa`), so links/bookmarks retain it. Switching circuits reloads the world and resets the race. Cards disappear during the race.

Projection, densification, and uniform length calibration are shared by every circuit. Roads, barriers, minimap, grid, and ordered checkpoints derive from that same geometry. Unknown track IDs fall back to Monza. These are actual mapped layouts but not laser-scanned replicas: elevation is flat, width is fixed at 16 m, and scenery is stylized. In particular Spa's elevation changes are not modeled. Kart handling stays unchanged.

To run the physical three-lap check on a specific circuit: `FLY_TRACK=spa node --experimental-strip-types --test src/physics.test.ts src/monza.test.ts`.

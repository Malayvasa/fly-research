# Asset sources

Retrieved 20 September 2026 from Kenney's official website. All selected packs list **Creative Commons Zero (CC0)**. Original license files are included beside the assets.

| Pack                                              | Included models                                                        | License                              |
| ------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------ |
| [Car Kit 3.1](https://kenney.nl/assets/car-kit)   | `kart-ooli` (human), `race` (opponent), kart variants, palette texture | `public/assets/cars/License.txt`     |
| [Nature Kit](https://kenney.nl/assets/nature-kit) | Oak and pine trees, shrubs, rocks, red/yellow flowers                  | `public/assets/nature/License.txt`   |
| [Skyboxes](https://kenney.nl/assets/skyboxes)     | Daytime panoramic sky and environment illumination                     | `public/assets/skyboxes/License.txt` |
| [Racing Kit](https://kenney.nl/assets/racing-kit) | Grandstands, awning, tent, flags, pylons                               | `public/assets/racing/License.txt`   |

Models are loaded as GLB through Three.js GLTFLoader. Kart body materials are tinted to distinguish the racers. Source wheels are animated. The road, curbs, safety rails, start posts, pond, hills, signs, and confetti are procedural geometry. Asphalt grain and sign graphics are generated canvas textures. No proprietary Nintendo or Mario Kart assets are used.

The Racing Kit's modular road pieces were reviewed, but Level 1 uses a continuous spline road for smooth, readable corners and predictable checkpoint geometry. The Nature Kit's own colors are retained to keep the environment cohesive. Included but unused source variants are available for further level iteration.

Engine loop: [Racing car engine sound loops](https://opengameart.org/content/racing-car-engine-sound-loops) by domasx2, CC0, stored as `public/assets/audio/engine.wav`. Countdown, lap and finish tones are synthesized with Web Audio.

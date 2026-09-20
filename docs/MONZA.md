# Monza GP circuit

Branch: `codex/f1-circuit`. Actual mapped Monza GP centerline, not an invented circuit.

Source: [Tomislav Bacinger's F1 circuits dataset](https://github.com/bacinger/f1-circuits/blob/master/circuits/it-1922.geojson), MIT; license retained in `src/circuits/LICENSE-MONZA.txt`.

Longitude/latitude is projected into local metres, long straight segments are densified before centripetal smoothing, and a single uniform scale calibrates the closed lap to 5,793 m. This preserves the mapped proportions and corner order, including Rettifilo, Roggia, the Lesmos, Ascari, and Parabolica/Alboreto. [Official circuit reference](https://www.monzanet.it/en/circuit/).

The minimap, road, barriers, starting grid, checkpoint gates, and practice controller use this same centerline. The existing kart speed/handling remains unchanged, so laps take longer than an F1 car's lap.

Limitations: this is a mapped centerline recreation, not laser-scanned geometry. Road width is a constant 16 m, terrain is flat, buildings and vegetation are simplified, and current-year curb/runoff changes are not surveyed. The oval is not part of this GP course.

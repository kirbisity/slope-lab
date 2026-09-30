# Slope Lab

Design ski runs with maths, then watch real physics ride them.

Every track is the graph of `y = f(x)` over an x range, or a line you sketch.
Press **Ride** and a skier takes it on, and you can pop, tuck, brake and
spin (180s, 360s and more: land facing forward, or backwards on a small hop
and ride switch with no brakes, but never sideways): gravity along the slope, snow
friction, air drag, leaving the snow over crests when `v²κ > g·cosθ`, flying
a parabola, and landing softly only when the hill matches the flight.

Slope Lab grew out of *Skateboarding*, the JavaScript skateboarding
simulator. The equation tracks, sketching, start flag, Joy/Ouch scoring and
the original save files all carry over.

## Play

```sh
npm run serve        # http://127.0.0.1:8932/
```

Works with mouse, keyboard, touch and pen, on phones and desktops.

| Action | Keys | Touch |
| --- | --- | --- |
| Ride / pause | Enter, P | Ride button |
| Tuck (less drag) | ↓ or S | hold Tuck |
| Brake (snowplough) | ← or A | hold Brake |
| Pop off the snow | Space, ↑ or W | Pop |
| Spin: a tap pops and turns; momentum carries it, and the skier lines up to land | → or D | Spin |
| Backflip about the belly, the same way | F | Flip |
| New Joyride slope | N | New slope |
| Back to editing | R or Esc | ↺ |
| Move, sketch, erase, start flag | V, D, E, S | tool bar |
| Equations panel, fit view | T, F | tool bar |

## Courses

- **Joyride** — the first level: a new random slope every time, no maths
  needed; runs are 450 m to over a kilometre. Every slope is built from equations (1 − cos rollers, half-cosine
  drops, landing hills fitted to a measured takeoff) and ridden hands-off
  before it is offered, so it is always finishable. Finish one and the game
  points you to the equation challenges; Joyride stays first in the list.
- **Sandbox** — build anything; loads with a 319 m demo run with two jumps.
- **First Tracks** (green) — a line gets you down; a curve lands softly.
- **The Kicker** (blue) — build a landing hill that matches the flight parabola.
- **Energy Bank** (blue) — ½v² + gh, friction and drag decide if you climb out.
- **Hidden Curve** (black) — fit amplitude, period and phase through six snowflakes.
- **Big Air** (double black) — build the whole jump; tucking flies further.

Each challenge carries a reference solution that the tests ride, so every
course is proven solvable.

## Code

| File | What it holds |
| --- | --- |
| `src/config.js` | Every tuning value, with the reasoning it was set against |
| `src/expression.js` | The `y = f(x)` parser |
| `src/track.js` | Sampling equations, smoothing sketches, surface geometry |
| `src/physics.js` | The skier: ground contact, curvature, flight, landings |
| `src/run.js` | One attempt: scoring, goals, how a run ends, stars |
| `src/courses.js` | Sandbox and challenges with reference solutions |
| `src/camera.js`, `src/renderer.js` | The 2.5D projection and drawing |
| `src/backdrop.js` | The 3D mountain range: height field, lit mesh, haze, and the rule for reusing a cached render |
| `src/input.js`, `src/main.js` | Gestures, keyboard, panels, the game loop |
| `src/storage.js` | Course files (including old Skateboarding saves), progress |
| `src/joyride.js` | The random slope generator and its hands-off validation |
| `src/debris.js` | Skis, poles and helmet thrown off in a crash, each with its own physics |
| `src/ragdoll.js` | The body: load-driven springs while skiing, a Verlet ragdoll that folds and rolls in a crash |
| `src/model.js` | The skier as a lit 3D mesh built from one skeleton, driven by the pose or the ragdoll |
| `src/ghost.js`, `src/audio.js` | Best-run ghost recording; procedural sound |

```sh
npm test             # physics, parser, courses, storage, camera
```

`test/layout-sweep.browser.js` checks the interface at nine screen sizes in
every view; run it from the browser console as described in the file.

## Publishing

The game is live at **https://kirbisity.github.io/slope-lab/**.

`.github/workflows/pages.yml` runs the tests on every push to `main`, then
copies `index.html`, `slopelab.css` and `src/` to GitHub Pages. There is no
build step. `test/deploy.test.js` fails if the page references a file the
workflow does not copy, or uses a root-absolute path (the site lives under
`/slope-lab/`).

- **Health check:** open the live URL in a private window, press **Ride** on the
  Sandbox demo: the skier lands the jump and the result says **Finished**, with
  no errors in the console.
- **Rollback:** `git revert <bad commit> && git push` redeploys the previous
  state. For an instant rollback without a new commit, open the last good
  *Deploy to GitHub Pages* run under Actions and choose *Re-run all jobs*.
- **Caching:** Pages serves files with a 10-minute cache, so a returning player
  can see the previous build for up to 10 minutes after a deploy.

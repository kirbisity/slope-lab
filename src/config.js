// Every tuning value lives here with the reasoning it was set against.
// Units are SI throughout: metres, seconds, kilograms.

export const PHYSICS = {
  gravity: 9.81,
  // Fine enough that a 40 m/s skier moves 0.17 m per step, under the 0.2 m
  // sample spacing of equation tracks, so no vertex is ever skipped.
  stepSeconds: 1 / 240,
  massKg: 75,
  airDensity: 1.2,
  // Drag area (Cd·A). Upright recreational skier ~0.6 m²; racers in a tuck
  // reach ~0.25 m². Terminal speed on a 30° pitch: ~32 m/s upright, ~49 tucked.
  dragAreaUpright: 0.6,
  dragAreaTuck: 0.25,
  // Waxed ski on groomed snow is 0.03–0.06.
  snowFriction: 0.045,
  // Brake is a hockey stop: the skis swing across the way of travel over
  // hockeyTurnSeconds and the edges bite. Edge grip is a friction coefficient
  // against the snow's push (0.55 holds against gravity up to ~29°), and the
  // snow the edges throw out slows the rider in proportion to speed. Past
  // ~29° grip loses to gravity and the spray only caps the speed at
  // g(sinθ − μcosθ)/k: ~12 m/s on 40°, so the rider never truly stops.
  hockeyGrip: 0.55,
  hockeySprayDrag: 0.15,
  hockeyTurnSeconds: 0.25,
  // Once the skis are fully across, too much speed or too steep a slope
  // catches the downhill edge and throws the rider over the tips. The limit
  // is (speed / hockeyCrashSpeed)² + (slope / hockeyCrashSlope)² > 1: a stop
  // from a Joyride cruise (22 m/s on 20°) holds, 25 m/s on 30° does not.
  hockeyCrashSpeed: 30,
  hockeyCrashSlope: 0.7,
  // A fallen skier slides on jacket and pants, which run on snow nearly as
  // freely as skis do: a crash carries on down a slope.
  crashFriction: 0.3,
  // Speed into the surface on touchdown. 4 m/s is a 0.8 m drop onto flat,
  // which legs absorb; 11 m/s is a 6 m drop onto flat, which they do not.
  // Landing on a slope parallel to the flight keeps this near zero, which is
  // why real landing hills are steep.
  softLandingSpeed: 4,
  crashLandingSpeed: 11,
  startSpeed: 1,
  // A pop off the tails: 4 m/s up is ~0.8 m of lift (v²/2g), enough to
  // clear a roller or add height at a lip.
  jumpImpulse: 4,
  // Holding Spin wraps the arms in and turns the body about the vertical
  // axis: 9 rad/s is a 360 in ~0.70 s. Letting go opens the arms and the
  // rider spots the landing: the turn carries on at the open rate (a fifth,
  // as angular momentum demands) until the body faces straight down the
  // hill or straight back, then holds there. A release crashes only if the
  // air runs out before that heading comes round.
  spinRateTucked: 9,
  openSpinFactor: 0.2,
  // Touchdown is judged by the heading against the direction of travel.
  // Facing forward, skis forgive a lot; riding backwards (switch), less;
  // in between the skis are across the fall line and catch an edge.
  forwardCleanAngle: 0.4,
  forwardSafeAngle: 0.8,
  switchCleanAngle: 0.2,
  switchSafeAngle: 0.4,
  // Riding backwards the legs cannot absorb a big landing: more airtime
  // than this, landed switch, is a crash. A pop (~0.8 s) is still fine.
  switchMaxAirSeconds: 1.2,
  // Flip tucks the knees and rolls the body backwards about the belly:
  // 7 rad/s is a backflip in ~0.90 s, slower than a spin because the body
  // is long in that direction. Kept fast enough that a flip plus the landing
  // spare fits Joyride's shortest jumps (1 s of air).
  flipRateTucked: 7,
  // Off upright at touchdown: past the first a sketchy landing, past the
  // second the skier lands on their back.
  flipCleanAngle: 0.3,
  flipSafeAngle: 0.5,
  // Flips stop off upright the same way spins stop off heading, but worse:
  // the rider sees the snow for only part of the rotation.
  flipSpotError: 1.2,
  // The rider sees the landing coming: this often (s) they look ahead along
  // the flight, and they start lining up with this much time to spare.
  landingLookAheadSeconds: 0.05,
  landingSpareSeconds: 0.06,
  // Riders never stop a rotation exactly where they aim. Each jump the stop
  // is off by spotError × u^spotErrorShape, u drawn fresh in ±1. A higher
  // shape keeps most stops close; lower makes the line-up weaker. The share
  // of spins that crash is 1 − (safe angle / spinSpotError)^(1/shape): with
  // shape 3 and 1.1 rad about 10% of forward landings and 29% of the
  // tighter switch ones; flips about 25%.
  spotErrorShape: 3,
  spinSpotError: 1.1,
  // Skis align with the flight path this fast while airborne (rad/s).
  airAlignRate: 2.2,
  // A vertex turning less than this is sampled curvature, not a kink:
  // 0.2 m samples of any curve with radius over 2 m stay under it. Charging
  // those as impacts leaked ~2% of the energy per valley.
  kinkAngle: 0.1,
  // Two pieces whose ends meet within this distance ride as one track, so a
  // hand-placed join does not become a micro-jump or a gap to fall through.
  joinTolerance: 0.3,
  restSpeed: 0.2,
  restSeconds: 1.5,
  crashSettleSeconds: 3.5,
  // Well below every course: falling past this ends the run.
  lostDepthBelowCourse: 60,
  maxRunSeconds: 180,
};

// Gear thrown off in a crash: each piece is its own little body.
export const DEBRIS = {
  // Snow is soft: a ski keeps a fifth of its normal speed on a bounce, and
  // slides with more friction than a ski on its base.
  restitution: 0.25,
  slideFriction: 0.25,
  spinKeptOnBounce: 0.6,
  airDrag: 0.02,
  // Thrown clear of the body: up and outward on top of the skier's speed.
  launchUp: [3, 7],
  launchSideways: 3,
  spin: [4, 14],
  restSpeed: 0.25,
};

// How the body answers loads while skiing: each part is a damped spring.
// Frequencies (rad/s) and damping ratios below 1 give the overshoot and
// rebound that read as weight; the gains turn loads into pose.
export const BODY = {
  // Knees and hips: rest crouch on flat snow, extra crouch per g above 1,
  // and how hard a landing (m/s into the snow) kicks them down.
  standingCrouch: 0.22,
  crouchPerG: 0.6,
  airCrouch: 0.05,
  crouchFrequency: 12,
  crouchDamping: 0.3,
  impactKick: 0.2,
  // Torso lean (rad) per g of slowing down; forward when braking.
  leanPerG: 0.9,
  leanFrequency: 8,
  leanDamping: 0.5,
  // Arms and head hang off the torso and swing when it changes.
  armFrequency: 6,
  armDamping: 0.25,
  armCoupling: 1,
  headFrequency: 10,
  headDamping: 0.4,
  headCoupling: 0.6,
  limit: 1.5,
};

// The crash ragdoll: jointed points with momentum, folding and rolling.
export const RAGDOLL = {
  substeps: 4,
  constraintPasses: 6,
  // Losses are per second, not per substep: a per-substep share compounds
  // 240 times a second and stalled a body even on a 35° slope.
  airDragPerSecond: 0.05,
  // Coulomb friction between a tumbling body and snow: a contact takes at
  // most μ times the speed pushed into the snow off the slide. Each thump of a
  // roll also loses the speed pushed into the snow, so a tumbling body only
  // keeps gaining speed on ground steeper than about 29° (measured), and slows
  // to a stop below about 20°. Hard contacts push more, so they grip more,
  // which is what makes the body roll.
  contactFriction: 0.3,
  contactLift: 0.005,
  // Joints that touched snow in the last few substeps are dragged by it a
  // little (per second), which ends buzzing contacts on flat ground.
  snowDragSubsteps: 4,
  snowDragPerSecond: 0.4,
  // Nearly still for this long and the body sleeps: it stops simulating.
  sleepSpeed: 0.45,
  sleepSeconds: 0.5,
};

export const SCORING = {
  // Joy for each backflip landed.
  joyPerFlip: 60,
  // Joy for each half turn (180°) landed.
  joyPerHalfTurn: 30,
  // Joy per second is speed above a walking pace, boosted in the air.
  joySpeedFloor: 2,
  airJoyMultiplier: 1.5,
  // Each m/s of landing speed above the soft limit costs this much Ouch.
  ouchPerImpactSpeed: 10,
  crashOuch: 100,
  scoreFactor: 50,
};

export const TRACKS = {
  // Arc-length spacing of generated points. Matches the original game's
  // 0.2 m sample step, which keeps smooth curves smooth to the physics.
  sampleSpacing: 0.2,
  sketchSpacing: 0.25,
  sketchSmoothingPasses: 6,
  maxRangeWidth: 400,
  maxPoints: 8000,
  // A jump bigger than this between neighbouring samples is a discontinuity
  // (tan, 1/x) and splits the track rather than drawing a vertical wall.
  maxStepRise: 4,
};

export const VIEW = {
  pixelsPerMeter: 22,
  // Low enough to fit a 170 m course across a 390 px phone.
  minPixelsPerMeter: 1.5,
  maxPixelsPerMeter: 90,
  // Camera focus distance behind the z = 0 plane; smaller is more
  // perspective. Lift raises far points so the snow surface faces the viewer.
  focusDistance: 16,
  // A camera framing a wide view stands further back, so perspective stays a
  // few percent at any zoom instead of skewing lanes at the screen edges.
  focusPerViewWidth: 0.9,
  depthLift: 0.5,
  laneHalfWidth: 1.4,
  slabThickness: 0.9,
  followLookAhead: 0.35,
  followSmoothing: 0.12,
  // Zoom out gently at speed so there is time to see what is coming.
  speedZoomOut: 70,
  treeSpacing: 5.5,
  trailMaxPoints: 900,
  maxParticles: 260,
  // Snow thrown up by a crash: soft puffs that billow, drift and fade.
  // The first impact throws a big cloud; later hits and slides add puffs in
  // proportion to how hard they are, a few times a second at most.
  crashCloudPuffs: 70,
  cloudPuffsPerImpactSpeed: 1.2,
  cloudMinImpactSpeed: 2,
  cloudCooldownSeconds: 0.09,
  maxCloudPuffs: 220,
};

// The mountain range behind the course: a lit height-field mesh seen by its
// own perspective camera, far enough away that zooming the course leaves it
// alone while panning slides it with true depth parallax.
export const BACKDROP = {
  nearDepth: 450,
  farDepth: 1900,
  // Rows packed tighter near the front, where each metre spans more pixels.
  rowCount: 16,
  columnSpacing: 20,
  peakHeight: 230,
  // The nearest row keeps to foothills this share of the peaks, rising to
  // full height by the back of the range.
  foothillShare: 0.28,
  // Focal length as a share of the larger screen side: ~53° across.
  focalShare: 0.95,
  horizonShare: 0.56,
  eyeHeight: 60,
  // Course metres of height move the eye this much: enough to feel, not
  // enough that a 100 m drop swings the range off screen.
  verticalParallax: 0.35,
  snowLine: 105,
  treeLine: 42,
  // Steeper than this, snow will not stay: bare rock shows.
  snowMaxSlope: 1.1,
  // Share of the way to the sky colour at the farthest row.
  farHaze: 0.6,
  nearHaze: 0.1,
  // The rendered backdrop is reused, slid by a middle depth's parallax,
  // until near and far ridges would be this many pixels out of place.
  redrawDriftPixels: 3,
  cacheMarginPixels: 12,
};

export const COLORS = {
  pieces: ['#e2552d', '#2f7dd1', '#20a36b', '#9b4fd1', '#d19a1b', '#d13f8a'],
  locked: '#23324a',
  jacket: '#e2552d',
  pants: '#23324a',
};

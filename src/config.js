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
  // Waxed ski on groomed snow is 0.03–0.06; a snowplough digs the edges in.
  snowFriction: 0.045,
  brakeFriction: 0.3,
  // A fallen skier slides on jacket and pants.
  crashFriction: 0.6,
  // Speed into the surface on touchdown. 4 m/s is a 0.8 m drop onto flat,
  // which legs absorb; 11 m/s is a 6 m drop onto flat, which they do not.
  // Landing on a slope parallel to the flight keeps this near zero, which is
  // why real landing hills are steep.
  softLandingSpeed: 4,
  crashLandingSpeed: 11,
  startSpeed: 1,
  // A pop off the tails: 3 m/s up is ~0.45 m of lift, enough to time a
  // takeoff at a lip without turning every bump into a launch pad.
  jumpImpulse: 3,
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

export const SCORING = {
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
};

export const COLORS = {
  pieces: ['#e2552d', '#2f7dd1', '#20a36b', '#9b4fd1', '#d19a1b', '#d13f8a'],
  locked: '#23324a',
  jacket: '#e2552d',
  pants: '#23324a',
};

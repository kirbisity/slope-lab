// The sandbox and the challenge courses. A challenge locks some pieces in
// place and asks the player to build the rest; every challenge carries a
// reference solution that the tests ride, so each one is proven solvable.
//
// Difficulty uses North American trail signs: green circle, blue square,
// black diamond, double black diamond.

export const SANDBOX = {
  id: 'sandbox',
  name: 'Sandbox',
  difficulty: 'sandbox',
  brief: 'Build anything. Add equations or sketch with your finger, move the start flag, and press Ride.',
  lesson: 'Every track is a graph of y = f(x). The skier feels its slope, f′(x), as acceleration and its curvature as g-force.',
  start: { x: 1.5, y: 24.9 },
  editableStart: true,
  pieces: [
    { equation: 'y = 0.035(x-28)^2', fromX: 0, toX: 26 },
    { equation: 'y = -0.3 - 0.14(x-26) - 0.011(x-26)^2', fromX: 26, toX: 58 },
    { equation: 'y = 0.01275(x-91.1)^2 - 30', fromX: 58, toX: 91.1 },
    { equation: 'y = -30', fromX: 91, toX: 140 },
  ],
  finish: { x: 112, yMin: -31, yMax: -26 },
  ink: null,
  stars: [],
};

export const CHALLENGES = [
  {
    id: 'first-tracks',
    name: 'First Tracks',
    difficulty: 'green',
    brief: 'Connect the start ramp to the finish flat below it.',
    lesson: 'A straight line gets you there, but it meets the flat at an angle and the knees take the hit. A curve that ends level lands softly.',
    hint: 'Try y = 8 - 0.4x from x = 0 to 30. Then find a parabola that is level at x = 30.',
    start: { x: -7, y: 10.1 },
    pieces: [
      { equation: 'y = 8 - 0.3x', fromX: -8, toX: 0 },
      { equation: 'y = -4', fromX: 30, toX: 48 },
    ],
    finish: { x: 36, yMin: -4.5, yMax: 0 },
    ink: 60,
    stars: [{ type: 'finish' }, { type: 'maxOuch', value: 0 }, { type: 'minScore', value: 1500 }],
    solution: [{ equation: 'y = 0.0133(x-30)^2 - 4', fromX: 0, toX: 30 }],
    naive: [{ equation: 'y = 8 - 0.4x', fromX: 0, toX: 30 }],
  },
  {
    id: 'the-kicker',
    name: 'The Kicker',
    difficulty: 'blue',
    brief: 'The in-run throws you off a lip at about 20 m/s. Build a landing hill.',
    lesson: 'In the air you follow a parabola, y ≈ y₀ − 0.14d − 0.012d². Land on a slope that matches it and you barely feel the ground. Land on the flat and you crash.',
    hint: 'Shape the landing like the flight: y = -0.3 - 0.14(x-26) - 0.011(x-26)^2, then curve it out to the finish.',
    start: { x: 1.5, y: 25.6 },
    pieces: [
      { equation: 'y = 0.035(x-28)^2', fromX: 0, toX: 26 },
      { equation: 'y = -30', fromX: 90, toX: 115 },
    ],
    finish: { x: 100, yMin: -31, yMax: -26 },
    ink: 140,
    stars: [{ type: 'finish' }, { type: 'maxOuch', value: 0 }, { type: 'minAir', value: 1.5 }],
    solution: [
      { equation: 'y = -0.3 - 0.14(x-26) - 0.011(x-26)^2', fromX: 26, toX: 58 },
      { equation: 'y = 0.01275(x-91.1)^2 - 30', fromX: 58, toX: 91.1 },
    ],
    naive: [{ equation: 'y = 0', fromX: 27, toX: 75 }],
  },
  {
    id: 'energy-bank',
    name: 'Energy Bank',
    difficulty: 'blue',
    brief: 'The finish sits 10 m below the start, 70 m away. Build a valley that still has the energy to climb out.',
    lesson: 'Height becomes speed and back again: ½v² + gh stays nearly constant. Friction and air drag take a cut, and the faster you go, the more drag takes. Tuck to cheat the air.',
    hint: 'A shallow parabola from (0, 19.2) to (56, 10) makes it. Go deeper for speed, but tuck on the way down.',
    start: { x: -6, y: 20.3 },
    pieces: [
      { equation: 'y = 20 - 0.1(x+8)', fromX: -8, toX: 0 },
      { equation: 'y = 10', fromX: 56, toX: 75 },
    ],
    finish: { x: 62, yMin: 10, yMax: 14 },
    ink: 90,
    stars: [{ type: 'finish' }, { type: 'maxOuch', value: 0 }, { type: 'minSpeed', value: 16.7 }],
    solution: [{ equation: 'y = 0.01285(x-34.39)^2 + 4', fromX: 0, toX: 56 }],
    naive: [{ equation: 'y = 19.2 - 0.5x', fromX: 0, toX: 28 }, { equation: 'y = 5.2 + 0.171(x-28)', fromX: 28, toX: 56 }],
  },
  {
    id: 'hidden-curve',
    name: 'Hidden Curve',
    difficulty: 'black',
    brief: 'Six snowflakes float just above one smooth curve. Find its equation and ride through every one.',
    lesson: 'A sine wave on a slope: y = a − bx + A·sin(kx). The peaks and troughs give A and the wavelength 2π/k; the flakes in between pin the phase.',
    hint: 'The flakes at x = 10.5 and 52.4 sit on peaks, the one at 31.4 in a trough. The slope underneath is −0.3.',
    start: { x: -6, y: 17.5 },
    pieces: [
      { equation: 'y = 17 - 0.15(x+8)', fromX: -8, toX: 0 },
      { equation: 'y = -9.1', fromX: 76, toX: 95 },
    ],
    tokens: [
      { x: 10.5, y: 16.2 }, { x: 21, y: 10.6 }, { x: 31.4, y: 5 },
      { x: 42, y: 4.3 }, { x: 52.4, y: 3.7 }, { x: 63, y: -2.1 },
    ],
    finish: { x: 84, yMin: -10, yMax: -5 },
    ink: 110,
    stars: [{ type: 'finish' }, { type: 'allTokens' }, { type: 'maxOuch', value: 0 }],
    solution: [{ equation: 'y = 16 - 0.3x + 2.5sin(0.15x)', fromX: 0, toX: 76 }],
    naive: [{ equation: 'y = 16 - 0.3x + 1.2sin(0.15x)', fromX: 0, toX: 76 }],
  },
  {
    id: 'big-air',
    name: 'Big Air',
    difficulty: 'double',
    brief: 'Start 50 m up and build everything: in-run, lip, landing and outrun. Hang in the air as long as you dare.',
    lesson: 'Airtime comes from how long the landing hill keeps falling away beneath the flight. Tucking flies further, so the hill has to be built for the tucked parabola too.',
    hint: 'Steepen the in-run, then curve it up into a lip near level. Shape the landing as the flight parabola, about −0.014(x−lip)², and bend it out gently.',
    start: { x: -8, y: 50.3 },
    pieces: [
      { equation: 'y = 50 - 0.1(x+10)', fromX: -10, toX: 0 },
      { equation: 'y = -49.5', fromX: 132, toX: 165 },
    ],
    finish: { x: 145, yMin: -51, yMax: -45 },
    ink: 280,
    stars: [{ type: 'finish' }, { type: 'minAir', value: 2 }, { type: 'minAir', value: 3 }],
    solution: [
      { equation: 'y = 49 - 0.1x - 0.03x^2', fromX: 0, toX: 20 },
      { equation: 'y = 0.02875(x-42.6)^2 + 20.31', fromX: 20, toX: 40 },
      { equation: 'y = 20 - 0.15(x-40) - 0.0142(x-40)^2', fromX: 40.5, toX: 85 },
      { equation: 'y = 0.015(x-132.6)^2 - 49.49', fromX: 85, toX: 132.6 },
    ],
    naive: [{ equation: 'y = 49 - 0.9x', fromX: 0, toX: 110 }],
  },
];

export const ALL_COURSES = [SANDBOX, ...CHALLENGES];

export function findCourse(id) {
  return ALL_COURSES.find((course) => course.id === id) || SANDBOX;
}

export const DIFFICULTY_LABELS = {
  sandbox: 'Free build',
  green: 'Green circle',
  blue: 'Blue square',
  black: 'Black diamond',
  double: 'Double black',
};

/** The original game's samples, kept so old muscle memory still works. */
export const SAMPLE_EQUATIONS = [
  { equation: 'y = 2', fromX: -10, toX: 10 },
  { equation: 'y = -0.5x', fromX: -15, toX: 25 },
  { equation: 'y = -0.3x - 2', fromX: -10, toX: 30 },
  { equation: 'y = 0.1x^2', fromX: -10, toX: 6 },
  { equation: 'y = 0.05(x+5)^2', fromX: -17, toX: 7 },
  { equation: 'y = sin(0.5x) - 0.2x', fromX: -20, toX: 25 },
  { equation: 'y = -3log(0.1x+0.1) + 0.4x - 6', fromX: -20, toX: 40 },
  { equation: 'y = 16 - 0.3x + 2.5sin(0.15x)', fromX: 0, toX: 76 },
  { equation: 'y = -15 + 15cos(pi(x-26)/64)', fromX: 26, toX: 90 },
];

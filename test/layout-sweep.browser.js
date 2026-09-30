// Browser-only layout check: load the game in same-origin frames of many
// sizes, walk every view and state, and report anything off-screen,
// overlapping, overflowing, or scrolling. Run from the page console:
//   const { runLayoutSweep } = await import('./test/layout-sweep.browser.js');
//   await runLayoutSweep();
// It avoids timers so it also runs in a background tab.

export const SIZES = [[360, 640], [390, 844], [414, 736], [844, 390], [667, 375], [768, 1024], [1024, 768], [1280, 720], [1440, 900]];

const MUST_FIT = ['.topbar', '.tools', '.ride-bar', '.readout', '.ride-controls .hold-pair:first-child', '.ride-controls .hold-pair:last-child', '#tracks-panel', '.overlay:not([hidden]) .sheet'];
const MUST_NOT_OVERLAP = [
  ['.tools', '.ride-bar'], ['.readout', '.ride-bar'], ['.readout', '.tools'],
  ['.ride-controls .hold-pair:last-child', '.ride-bar'], ['.ride-controls .hold-pair:first-child', '.ride-bar'],
  ['.ride-controls .hold-pair:first-child', '.readout'], ['.ride-controls .hold-pair:last-child', '.readout'],
  ['.ride-controls .hold-pair:first-child', '.ride-controls .hold-pair:last-child'],
  ['.readout', '.topbar'], ['.tools', '.topbar'], ['#tracks-panel', '.tools'], ['#tracks-panel', '.readout'], ['#tracks-panel', '.topbar'],
];
const MUST_NOT_OVERFLOW = ['.topbar', '.overlay:not([hidden]) .sheet', '.equation-form', '.overlay:not([hidden]) .course-grid', '.overlay:not([hidden]) .help-pages'];

async function openFrame(width, height) {
  const frame = document.createElement('iframe');
  frame.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;border:0;z-index:99999;background:#fff`;
  frame.src = `index.html?layout=${width}x${height}`;
  document.body.append(frame);
  await new Promise((resolve) => { frame.onload = resolve; });
  const style = frame.contentDocument.createElement('style');
  style.textContent = '*{transition:none!important;animation:none!important}';
  frame.contentDocument.head.append(style);
  return frame;
}

function checker(frame, width, height, results) {
  const win = frame.contentWindow;
  const doc = frame.contentDocument;
  const visible = (element) => element && !element.hidden && win.getComputedStyle(element).display !== 'none' && element.getBoundingClientRect().width > 0;
  const rectOf = (selector) => { const element = doc.querySelector(selector); return visible(element) ? element.getBoundingClientRect() : null; };
  const overlap = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  const inside = (r) => !r || (r.left >= -1 && r.top >= -1 && r.right <= width + 1 && r.bottom <= height + 1);
  return (stateName) => {
    const problems = [];
    for (const selector of MUST_FIT) {
      const r = rectOf(selector);
      if (!inside(r)) problems.push(`${selector} off-screen`);
    }
    for (const [a, b] of MUST_NOT_OVERLAP) if (overlap(rectOf(a), rectOf(b))) problems.push(`${a} overlaps ${b}`);
    for (const selector of MUST_NOT_OVERFLOW) {
      const element = doc.querySelector(selector);
      if (visible(element) && (element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1)) {
        problems.push(`${selector} overflows ${element.scrollWidth}x${element.scrollHeight} > ${element.clientWidth}x${element.clientHeight}`);
      }
    }
    if (doc.documentElement.scrollWidth > width + 1 || doc.documentElement.scrollHeight > height + 1) problems.push('page scrolls');
    results.push({ size: `${width}x${height}`, state: stateName, problems });
  };
}

export async function runLayoutSweep(sizes = SIZES, courseIds = ['hidden-curve', 'joyride']) {
  const results = [];
  for (const courseId of courseIds) results.push(...(await sweepCourse(sizes, courseId)));
  return { states: results.length, problems: results.filter((result) => result.problems.length).map((result) => `${result.size} ${result.state}: ${result.problems.join('; ')}`) };
}

async function sweepCourse(sizes, courseId) {
  const results = [];
  for (const [width, height] of sizes) {
    const frame = await openFrame(width, height);
    const doc = frame.contentDocument;
    const lab = frame.contentWindow.slopeLab;
    const check = checker(frame, width, height, results);
    try {
      lab.loadCourse(courseId); lab.advance(0.02); check('edit');
      doc.getElementById('tracks-toggle').click(); lab.advance(0.02); check('edit+equations');
      doc.querySelector('#hint-box summary')?.click(); check('edit+equations+hint');
      doc.getElementById('tracks-toggle').click();
      doc.getElementById('courses-button').click(); check('courses');
      doc.querySelector('#courses-overlay [data-close]').click();
      doc.getElementById('help-button').click();
      for (let page = 1; page <= 4; page += 1) { check(`help ${page}`); doc.getElementById('help-next').click(); }
      lab.startRide(); lab.advance(1); check(`${courseId} ride`);
      lab.advance(20); check('result');
    } catch (error) {
      results.push({ size: `${width}x${height}`, state: 'error', problems: [error.message] });
    }
    frame.remove();
  }
  return results;
}

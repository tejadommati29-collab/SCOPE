/* Makes the app look like it does at 80% browser zoom, even when the browser is at 100%.
   TARGET is the look you want (0.8 = "80%"). If the user really zooms the browser,
   the page is compensated so the look stays the same.
   Also publishes --zf / --vw / --vh so viewport units (vw / vh) stay correct under the scaling. */
(function () {
  var TARGET = 0.8;
  var de = document.documentElement;
  var LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9];

  function browserZoom() {
    var r = window.outerWidth / window.innerWidth;            /* ~1 at 100%, ~0.8 at 80% */
    if (!(r > 0) || r >= 0.97) return 1;
    var best = 1, d = 1;
    for (var i = 0; i < LEVELS.length; i++) {
      var e = Math.abs(LEVELS[i] - r);
      if (e < d) { d = e; best = LEVELS[i]; }
    }
    return d < 0.045 ? best : 1;
  }

  function apply() {
    var z = TARGET / browserZoom();                           /* 100% -> 0.8 ; 80% -> 1.0 */
    window.__zf = z;
    de.style.zoom = z === 1 ? '' : String(z);
    de.style.setProperty('--zf', z);
    de.style.setProperty('--vw', (window.innerWidth / z / 100) + 'px');
    de.style.setProperty('--vh', (window.innerHeight / z / 100) + 'px');
  }

  apply();
  window.addEventListener('resize', apply);
})();

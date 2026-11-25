/*!
 * Nateq - Invisible Ink particle veil
 * A dependency-free canvas overlay that dissolves the active Arabic word into
 * a flowing, shimmering particle field modelled after iMessage's Invisible Ink.
 */
(function () {
  'use strict';

  var TAU = Math.PI * 2;
  var MIN_PARTICLES = 180;
  var MAX_PARTICLES = 280;
  var COLORS = [
    { color: 'rgba(255, 255, 255, 0.75)', weight: 0.62, spark: false },
    { color: 'rgba(161, 161, 170, 0.5)', weight: 0.3, spark: false },
    { color: 'rgba(16, 185, 129, 0.85)', weight: 0.08, spark: true }
  ];

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function prefersReducedMotion() {
    return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }

  function pickColor() {
    var roll = Math.random();
    for (var i = 0; i < COLORS.length; i += 1) {
      if (roll < COLORS[i].weight) return COLORS[i];
      roll -= COLORS[i].weight;
    }
    return COLORS[0];
  }

  function InvisibleInkOverlay(canvas, textEl, hostEl) {
    if (!canvas || !textEl) {
      throw new Error('InvisibleInkOverlay needs a canvas and a text element.');
    }

    this.canvas = canvas;
    this.textEl = textEl;
    this.hostEl = hostEl || textEl.parentElement || textEl;
    this.ctx = canvas.getContext('2d');

    this.enabled = false;
    this.concealed = false;
    this.peeking = false;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.particles = [];
    this.raf = null;
    this.lastTime = 0;
    this.elapsed = 0;
    this.peekTimer = null;
    this.revealTimer = null;
    this.fitRaf = null;
    this.reduceMotion = prefersReducedMotion();

    this._tick = this._tick.bind(this);
    this._scheduleFit = this._scheduleFit.bind(this);

    this._attachObservers();
    this.fit();
  }

  InvisibleInkOverlay.prototype._attachObservers = function () {
    var self = this;

    if (typeof ResizeObserver !== 'undefined') {
      // The wrapper drives layout changes: font switches, mobile size presets,
      // drawer changes, and window resizes all alter its box.
      this.resizeObserver = new ResizeObserver(this._scheduleFit);
      this.resizeObserver.observe(this.hostEl);
      this.resizeObserver.observe(this.textEl);
    }

    if (typeof MutationObserver !== 'undefined') {
      // New words and font-family swaps mutate the text node without resizing
      // the wrapper, so watch the rendered string itself too.
      this.mutationObserver = new MutationObserver(this._scheduleFit);
      this.mutationObserver.observe(this.textEl, {
        childList: true,
        characterData: true,
        subtree: true
      });
    }

    window.addEventListener('resize', this._scheduleFit, { passive: true });
    window.addEventListener('orientationchange', this._scheduleFit, { passive: true });

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(this._scheduleFit).catch(function () {});
    }

    if (window.matchMedia) {
      var query = window.matchMedia('(prefers-reduced-motion: reduce)');
      var onChange = function () {
        self.reduceMotion = query.matches;
      };
      if (query.addEventListener) query.addEventListener('change', onChange);
      else if (query.addListener) query.addListener(onChange);
    }
  };

  InvisibleInkOverlay.prototype._scheduleFit = function () {
    var self = this;
    if (this.fitRaf) return;
    this.fitRaf = window.requestAnimationFrame(function () {
      self.fitRaf = null;
      self.fit();
    });
  };

  /** Re-measure the rendered glyph box and resize the backing canvas. */
  InvisibleInkOverlay.prototype.fit = function () {
    if (!this.textEl || !this.hostEl || !this.canvas) return;

    var text = this.textEl.textContent;
    if (!text || !text.trim()) {
      this.width = 0;
      this.height = 0;
      this.particles = [];
      this.canvas.classList.remove('is-visible');
      return;
    }

    var hostRect = this.hostEl.getBoundingClientRect();
    if (!hostRect.width || !hostRect.height) return;

    var glyphRect;
    if (typeof Range !== 'undefined') {
      var range = document.createRange();
      range.selectNodeContents(this.textEl);
      glyphRect = range.getBoundingClientRect();
    }
    if (!glyphRect || !glyphRect.width || !glyphRect.height) {
      glyphRect = this.textEl.getBoundingClientRect();
    }
    if (!glyphRect.width || !glyphRect.height) return;

    var fontSize = parseFloat(window.getComputedStyle(this.textEl).fontSize) || 40;
    var padX = clamp(fontSize * 0.3, 10, 28);
    var padY = clamp(fontSize * 0.22, 8, 20);

    var left = glyphRect.left - hostRect.left - padX;
    var top = glyphRect.top - hostRect.top - padY;
    var width = Math.max(1, glyphRect.width + padX * 2);
    var height = Math.max(1, glyphRect.height + padY * 2);

    // Keep the field anchored to the stage if a very long phrase overflows.
    if (left < -padX) left = -padX;
    if (left + width > hostRect.width + padX) {
      width = Math.max(1, hostRect.width + padX - left);
    }

    var dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    var pixelWidth = Math.round(width * dpr);
    var pixelHeight = Math.round(height * dpr);
    var sizeChanged = Math.abs(width - this.width) > 1 || Math.abs(height - this.height) > 1;
    var dprChanged = dpr !== this.dpr;

    this.width = width;
    this.height = height;
    this.dpr = dpr;

    this.canvas.style.left = left.toFixed(2) + 'px';
    this.canvas.style.top = top.toFixed(2) + 'px';
    this.canvas.style.width = width.toFixed(2) + 'px';
    this.canvas.style.height = height.toFixed(2) + 'px';

    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }

    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (sizeChanged || dprChanged || !this.particles.length) {
      this._buildParticles();
    }

    if (this.concealed && !this.peeking) {
      this._start();
    }
  };

  InvisibleInkOverlay.prototype._buildParticles = function () {
    var width = this.width;
    var height = this.height;
    if (!width || !height) {
      this.particles = [];
      return;
    }

    var count = Math.round(clamp(width * 0.46, MIN_PARTICLES, MAX_PARTICLES));
    var ampUnit = clamp(height * 0.085, 4, 18);
    var particles = [];

    for (var i = 0; i < count; i += 1) {
      var palette = pickColor();

      // Bias particles toward the middle band so the veil hugs the word
      // instead of reading as an even sheet of television snow.
      var xBias = (Math.random() + Math.random() + Math.random()) / 3;
      var yBias = (Math.random() + Math.random() + Math.random()) / 3;
      var x = width * (0.06 + xBias * 0.88);
      var y = height * (0.14 + yBias * 0.72);

      particles.push({
        x: x,
        y: y,
        radius: rand(1, 2.2),
        alpha: palette.color,
        spark: palette.spark,
        ampX: rand(5, 17) * (height / 120) * 0.5 + rand(2, 8),
        ampY: rand(2, 7) * ampUnit * 0.18,
        freqX: rand(0.32, 1.05),
        freqY: rand(0.28, 0.86),
        phase: rand(0, TAU),
        twinkle: rand(0.8, 2.6),
        twinklePhase: rand(0, TAU),
        baseAlpha: rand(0.55, 1)
      });
    }

    this.particles = particles;
  };

  InvisibleInkOverlay.prototype._start = function () {
    if (this.raf) return;
    this.lastTime = performance.now();
    this.raf = window.requestAnimationFrame(this._tick);
  };

  InvisibleInkOverlay.prototype._stop = function () {
    if (this.raf) {
      window.cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    if (this.ctx && this.width && this.height) {
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
  };

  InvisibleInkOverlay.prototype._tick = function (now) {
    this.raf = null;

    var delta = Math.min(64, Math.max(0, now - this.lastTime));
    this.lastTime = now;
    this.elapsed += delta;

    this._draw();

    if (this.concealed ||
        this.canvas.classList.contains('is-visible') ||
        this.canvas.classList.contains('is-revealing')) {
      this.raf = window.requestAnimationFrame(this._tick);
    }
  };

  InvisibleInkOverlay.prototype._draw = function () {
    var ctx = this.ctx;
    var width = this.width;
    var height = this.height;
    if (!ctx || !width || !height) return;

    ctx.clearRect(0, 0, width, height);
    ctx.globalCompositeOperation = 'lighter';

    var t = this.elapsed / 1000;
    var motion = this.reduceMotion ? 0.22 : 1;
    var particles = this.particles;

    for (var i = 0; i < particles.length; i += 1) {
      var p = particles[i];

      var driftX =
        Math.sin(t * p.freqX + p.phase) * p.ampX +
        Math.sin(t * 0.41 + p.phase * 1.7) * p.ampX * 0.38;
      var driftY =
        Math.cos(t * p.freqY + p.phase * 1.3) * p.ampY +
        Math.sin(t * 0.57 + p.x * 0.02 + p.phase) * p.ampY * 0.5;

      if (this.reduceMotion) {
        driftX *= motion;
        driftY *= motion;
      }

      var twinkle = 0.5 + 0.5 * Math.sin(t * p.twinkle + p.twinklePhase);
      var alpha = p.baseAlpha * (0.32 + 0.68 * twinkle);
      var radius = p.radius + twinkle * 0.32;

      ctx.globalAlpha = Math.min(1, alpha);
      ctx.fillStyle = p.alpha;
      ctx.beginPath();
      ctx.arc(p.x + driftX, p.y + driftY, radius, 0, TAU);
      ctx.fill();

      // Rare emerald sparks get a soft halo without the cost of shadowBlur.
      if (p.spark && twinkle > 0.55) {
        ctx.globalAlpha = alpha * 0.16;
        ctx.beginPath();
        ctx.arc(p.x + driftX, p.y + driftY, radius * 3.4, 0, TAU);
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  InvisibleInkOverlay.prototype._clearPeek = function () {
    if (this.peekTimer) {
      window.clearTimeout(this.peekTimer);
      this.peekTimer = null;
    }
    this.peeking = false;
  };

  InvisibleInkOverlay.prototype.setEnabled = function (enabled) {
    var next = !!enabled;
    if (this.enabled === next) return;
    this.enabled = next;
    if (!this.enabled) {
      this.reveal(true);
    }
  };

  /** Dissolve the word and raise the fluid particle veil. */
  InvisibleInkOverlay.prototype.conceal = function () {
    if (!this.enabled) return;
    if (!this.particles.length) this.fit();

    this._clearPeek();
    this.concealed = true;

    this.textEl.classList.add('is-ink-hidden');
    this.canvas.classList.remove('is-revealing');
    this.canvas.classList.add('is-visible');

    window.clearTimeout(this.revealTimer);
    this.revealTimer = null;

    this._start();
  };

  /** Snap/fade the word back to crisp clarity and let the particles disperse. */
  InvisibleInkOverlay.prototype.reveal = function (immediate) {
    this._clearPeek();
    this.concealed = false;

    this.textEl.classList.remove('is-ink-hidden');
    this.canvas.classList.remove('is-visible');

    window.clearTimeout(this.revealTimer);
    this.revealTimer = null;

    if (immediate) {
      this.canvas.classList.add('is-instant');
      // Commit the zero-opacity state before restoring the transition.
      void this.canvas.offsetWidth;
      this.canvas.classList.remove('is-instant', 'is-revealing');
      this._stop();
      return;
    }

    this.canvas.classList.add('is-revealing');
    var self = this;
    this.revealTimer = window.setTimeout(function () {
      self.revealTimer = null;
      if (!self.concealed) {
        self.canvas.classList.remove('is-revealing');
        self._stop();
      }
    }, 140);
  };

  /** Part the veil for a short, readable peek (the `?` escape hatch). */
  InvisibleInkOverlay.prototype.peek = function (duration) {
    if (!this.enabled || !this.concealed) return;

    this._clearPeek();
    this.peeking = true;

    this.textEl.classList.remove('is-ink-hidden');
    this.canvas.classList.remove('is-visible');
    this.canvas.classList.add('is-revealing');

    var self = this;
    this.peekTimer = window.setTimeout(function () {
      self.peekTimer = null;
      self.peeking = false;
      if (!self.enabled || !self.concealed) return;

      self.textEl.classList.add('is-ink-hidden');
      self.canvas.classList.remove('is-revealing');
      self.canvas.classList.add('is-visible');
      self._start();
    }, Math.max(300, duration || 1200));
  };

  InvisibleInkOverlay.prototype.isConcealed = function () {
    return this.concealed;
  };

  InvisibleInkOverlay.prototype.destroy = function () {
    this._clearPeek();
    window.clearTimeout(this.revealTimer);
    if (this.fitRaf) window.cancelAnimationFrame(this.fitRaf);
    this._stop();
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.mutationObserver) this.mutationObserver.disconnect();
    window.removeEventListener('resize', this._scheduleFit);
    window.removeEventListener('orientationchange', this._scheduleFit);
  };

  window.InvisibleInkOverlay = InvisibleInkOverlay;
})();

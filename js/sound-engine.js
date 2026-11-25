/*!
 * Nateq - procedural sound engine
 * No audio files, no dependencies. Web Audio API only.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'nateq_sound';
  var ctx = null;
  var master = null;
  var enabled = readEnabled();

  function readEnabled() {
    try {
      var value = window.localStorage.getItem(STORAGE_KEY);
      return value == null ? true : value === 'true';
    } catch (error) {
      return true;
    }
  }

  function persistEnabled() {
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? 'true' : 'false');
    } catch (error) {
      // Storage can fail in private mode; sound still works for this session.
    }
  }

  function safeResume(context) {
    if (!context || context.state !== 'suspended' || typeof context.resume !== 'function') return;
    try {
      var pending = context.resume();
      if (pending && typeof pending.catch === 'function') {
        pending.catch(function () {});
      }
    } catch (error) {}
  }

  function ensureContext() {
    if (ctx) {
      safeResume(ctx);
      return ctx;
    }
    var AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return null;
    try {
      ctx = new AudioCtor({ latencyHint: 'interactive' });
    } catch (error) {
      try {
        ctx = new AudioCtor();
      } catch (fallbackError) {
        return null;
      }
    }
    master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);
    return ctx;
  }

  function isEnabled() {
    return enabled;
  }

  function setEnabled(value) {
    enabled = !!value;
    persistEnabled();
    if (enabled) ensureContext();
  }

  function toggle() {
    setEnabled(!enabled);
    return enabled;
  }

  function envelope(gain, now, peak, attack, decay) {
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
  }

  function playKeystroke() {
    if (!enabled) return;
    var c = ensureContext();
    if (!c) return;
    var now = c.currentTime;
    var jitter = 1 + (Math.random() * 0.12 - 0.06);
    var osc = c.createOscillator();
    var filter = c.createBiquadFilter();
    var gain = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140 * jitter, now);
    osc.frequency.exponentialRampToValueAtTime(45 * jitter, now + 0.035);
    filter.type = 'lowpass';
    filter.frequency.value = 1100;
    filter.Q.value = 0.8;
    envelope(gain, now, 0.16, 0.004, 0.031);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 0.06);
    osc.onended = function () {
      try { osc.disconnect(); filter.disconnect(); gain.disconnect(); } catch (error) {}
    };
  }

  function playTone(c, now, frequency, type, peak, attack, decay) {
    var osc = c.createOscillator();
    var gain = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(frequency, now);
    envelope(gain, now, peak, attack, decay);
    osc.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + attack + decay + 0.02);
    osc.onended = function () {
      try { osc.disconnect(); gain.disconnect(); } catch (error) {}
    };
  }

  function playWordComplete(step) {
    if (!enabled) return;
    var c = ensureContext();
    if (!c) return;
    var semitones = Math.max(0, Math.min(12, typeof step === 'number' ? step : 0));
    var mult = Math.pow(2, semitones / 12);
    var now = c.currentTime;
    playTone(c, now, 523.25 * mult, 'sine', 0.11, 0.012, 0.168);
    playTone(c, now, 783.99 * mult, 'triangle', 0.07, 0.012, 0.168);
  }

  function playTypo() {
    if (!enabled) return;
    var c = ensureContext();
    if (!c) return;
    var now = c.currentTime;
    var osc = c.createOscillator();
    var filter = c.createBiquadFilter();
    var gain = c.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90, now);
    osc.frequency.exponentialRampToValueAtTime(70, now + 0.025);
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    envelope(gain, now, 0.07, 0.003, 0.022);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start(now);
    osc.stop(now + 0.05);
    osc.onended = function () {
      try { osc.disconnect(); filter.disconnect(); gain.disconnect(); } catch (error) {}
    };
  }

  function unlock() {
    if (!enabled) return;
    var c = ensureContext();
    safeResume(c);
  }

  window.addEventListener('pointerdown', unlock, { once: true, passive: true });
  window.addEventListener('keydown', unlock, { once: true });

  window.NateqSound = {
    isEnabled: isEnabled,
    setEnabled: setEnabled,
    toggle: toggle,
    playKeystroke: playKeystroke,
    playWordComplete: playWordComplete,
    playTypo: playTypo,
    unlock: unlock
  };
})();

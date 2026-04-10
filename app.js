(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const display = $('#timer-display');
  const minEl = $('#minutes');
  const secEl = $('#seconds');
  const btnStart = $('#btn-start');
  const btnReset = $('#btn-reset');
  const buzzer = $('#buzzer');
  const durBtns = document.querySelectorAll('.dur');

  let totalSeconds = 300;
  let remaining = totalSeconds;
  let state = 'ready'; // ready | running | paused | expired
  let interval = null;
  let wakeLock = null;

  // --- Rendering ---

  function render() {
    const mins = Math.floor(remaining / 60);
    const secs = remaining % 60;
    minEl.textContent = mins;
    secEl.textContent = String(secs).padStart(2, '0');

    display.className = state;
    btnStart.textContent = state === 'running' ? 'PAUSE' : state === 'expired' ? 'RESET' : 'START';
    btnStart.classList.toggle('running', state === 'running');
  }

  // --- Timer Core ---

  function tick() {
    if (remaining <= 0) {
      expire();
      return;
    }
    remaining--;
    render();
    if (remaining <= 0) {
      expire();
    }
  }

  function start() {
    if (state === 'expired') { reset(); return; }
    state = 'running';
    interval = setInterval(tick, 1000);
    acquireWakeLock();
    render();
  }

  function pause() {
    state = 'paused';
    clearInterval(interval);
    interval = null;
    releaseWakeLock();
    render();
  }

  function reset() {
    clearInterval(interval);
    interval = null;
    remaining = totalSeconds;
    state = 'ready';
    releaseWakeLock();
    render();
  }

  function expire() {
    clearInterval(interval);
    interval = null;
    state = 'expired';
    render();
    playBuzzer();
    releaseWakeLock();
  }

  // --- Buzzer ---

  function playBuzzer() {
    // Use Web Audio API to generate a buzzer tone if no audio file
    buzzer.play().catch(() => {
      generateBuzzerTone();
    });
  }

  function generateBuzzerTone() {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = 440;
    gain.gain.value = 0.3;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    // Three short beeps
    const beepPattern = [0, 0.2, 0.4, 0.6, 0.8, 1.0];
    beepPattern.forEach((t, i) => {
      gain.gain.setValueAtTime(i % 2 === 0 ? 0.3 : 0, ctx.currentTime + t);
    });
    osc.stop(ctx.currentTime + 1.2);
  }

  // --- Wake Lock ---

  async function acquireWakeLock() {
    if ('wakeLock' in navigator) {
      try {
        wakeLock = await navigator.wakeLock.request('screen');
      } catch (_) { /* ignore */ }
    }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      wakeLock.release();
      wakeLock = null;
    }
  }

  // Re-acquire wake lock when page becomes visible again
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state === 'running') {
      acquireWakeLock();
    }
  });

  // --- Event Handlers ---

  btnStart.addEventListener('click', () => {
    if (state === 'running') pause();
    else start();
  });

  btnReset.addEventListener('click', reset);

  durBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (state === 'running') return; // don't change duration while running
      durBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      totalSeconds = parseInt(btn.dataset.seconds, 10);
      remaining = totalSeconds;
      state = 'ready';
      render();
    });
  });

  // --- Service Worker ---

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js');
  }

  // --- Init ---
  render();
})();

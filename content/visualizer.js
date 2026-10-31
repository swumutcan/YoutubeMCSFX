/**
 * YouTube Music SFX - Audio Reactive Background Visualizer
 * Runs in MAIN world context for direct Web Audio API access to the HTML5 <video> element.
 */

(function () {
  'use strict';

  // Prevent multiple initializations
  if (window.__ytm_sfx_initialized) return;
  window.__ytm_sfx_initialized = true;

  // --- Configuration State ---
  let config = {
    enabled: true,
    visualizerMode: 'aurora', // 'aurora' | 'pulse' | 'wave' | 'particles'
    colorMode: 'album',       // 'album' | 'cyberpunk' | 'synthwave' | 'emerald' | 'fire'
    sensitivity: 1.2,
    blur: 40,
    opacity: 0.75,
    speed: 1.0
  };

  // Preset Color Palettes (Primary, Secondary, Accent)
  const COLOR_PRESETS = {
    cyberpunk: [
      { r: 255, g: 0, b: 128 },   // Hot Pink
      { r: 0, g: 240, b: 255 },   // Cyan
      { r: 128, g: 0, b: 255 }    // Electric Purple
    ],
    synthwave: [
      { r: 255, g: 110, b: 0 },   // Neon Orange
      { r: 170, g: 0, b: 255 },   // Deep Violet
      { r: 255, g: 0, b: 100 }    // Magenta
    ],
    emerald: [
      { r: 0, g: 255, b: 160 },   // Bright Mint
      { r: 0, g: 150, b: 255 },   // Ocean Blue
      { r: 20, g: 80, b: 120 }    // Deep Teal
    ],
    fire: [
      { r: 255, g: 60, b: 0 },    // Flame Red
      { r: 255, g: 180, b: 0 },   // Amber
      { r: 180, g: 10, b: 40 }    // Crimson
    ]
  };

  // Current smoothly transitioned color palette
  let currentColors = [
    { r: 180, g: 40, b: 80 },
    { r: 50, g: 70, b: 180 },
    { r: 120, g: 30, b: 140 }
  ];
  let targetColors = [...currentColors];

  // --- Web Audio Graph ---
  let audioCtx = null;
  let analyser = null;
  let audioSource = null;
  let freqData = null;
  let isAudioConnected = false;

  // Smoothed Audio Levels
  let smoothedBass = 0;
  let smoothedMid = 0;
  let smoothedTreble = 0;
  let overallEnergy = 0;

  // --- Canvas Setup ---
  let container = null;
  let canvas = null;
  let ctx = null;
  let width = 0;
  let height = 0;
  let animFrameId = null;
  let animTime = 0;

  // Particles for 'particles' mode
  const particles = [];
  const PARTICLE_COUNT = 55;

  // Rings for 'pulse' mode
  const pulseRings = [];

  // Track album cover changes
  let lastArtworkUrl = '';

  /**
   * Initialize DOM Canvas elements
   */
  function initDOM() {
    if (document.getElementById('ytm-sfx-container')) return;

    container = document.createElement('div');
    container.id = 'ytm-sfx-container';

    canvas = document.createElement('canvas');
    canvas.id = 'ytm-sfx-canvas';
    ctx = canvas.getContext('2d', { alpha: false });

    const overlay = document.createElement('div');
    overlay.id = 'ytm-sfx-overlay';

    container.appendChild(canvas);
    container.appendChild(overlay);

    // Insert before body so it is physically behind the entire application DOM
    if (document.body && document.documentElement) {
      document.documentElement.insertBefore(container, document.body);
    } else {
      document.body.prepend(container);
    }

    updateCanvasSize();
    window.addEventListener('resize', updateCanvasSize);

    // Initialize particles
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 1.5,
        vy: (Math.random() - 0.5) * 1.5,
        size: Math.random() * 3 + 1.5,
        colorIndex: Math.floor(Math.random() * 3),
        alpha: Math.random() * 0.7 + 0.3
      });
    }
  }

  function updateCanvasSize() {
    if (!canvas) return;
    // Scale down canvas for buttery smooth 60fps & organic blur
    const scale = 0.5;
    width = Math.floor(window.innerWidth * scale);
    height = Math.floor(window.innerHeight * scale);
    canvas.width = width;
    canvas.height = height;

    applyVisualStyles();
  }

  function updatePlayerPageState() {
    const appLayout = document.querySelector('ytmusic-app-layout');
    const isPlayerOpen = appLayout && (
      appLayout.getAttribute('player-ui-state') === 'PLAYER_PAGE_OPEN' ||
      (appLayout.hasAttribute('player-page-open') && appLayout.getAttribute('player-ui-state') !== 'MINIPLAYER')
    );

    if (isPlayerOpen) {
      if (!document.documentElement.hasAttribute('data-ytm-sfx-player-open')) {
        document.documentElement.setAttribute('data-ytm-sfx-player-open', 'true');
      }
    } else {
      if (document.documentElement.hasAttribute('data-ytm-sfx-player-open')) {
        document.documentElement.removeAttribute('data-ytm-sfx-player-open');
      }
    }
    return isPlayerOpen;
  }

  function applyVisualStyles() {
    if (!container) return;
    const isPlayerOpen = updatePlayerPageState();
    container.style.opacity = (config.enabled && isPlayerOpen) ? config.opacity : '0';
    if (canvas) {
      canvas.style.filter = `blur(${config.blur}px)`;
    }
  }

  /**
   * Connect Web Audio API to the YouTube Music <video> element
   */
  function initAudio() {
    if (isAudioConnected) return;

    const video = document.querySelector('video');
    if (!video) return;

    if (video.__ytm_sfx_source_attached) {
      isAudioConnected = true;
      return;
    }

    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!audioCtx) {
        audioCtx = new AudioContextClass();
      }

      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      freqData = new Uint8Array(analyser.frequencyBinCount);

      audioSource = audioCtx.createMediaElementSource(video);
      audioSource.connect(analyser);
      analyser.connect(audioCtx.destination);

      video.__ytm_sfx_source_attached = true;
      isAudioConnected = true;

      // Handle suspended audio context (browser autoplay policies)
      const resumeAudio = () => {
        if (audioCtx && audioCtx.state === 'suspended') {
          audioCtx.resume();
        }
      };

      video.addEventListener('play', resumeAudio);
      video.addEventListener('playing', resumeAudio);
      document.addEventListener('click', resumeAudio, { once: true });
      document.addEventListener('keydown', resumeAudio, { once: true });

      console.log('[YTM-SFX] AudioContext successfully connected to video stream.');
    } catch (err) {
      console.warn('[YTM-SFX] AudioContext connection notice:', err.message);
    }
  }

  /**
   * Sample audio frequencies (Bass, Mid, Treble)
   */
  function updateAudioMetrics() {
    if (!analyser || !freqData) {
      // Idle idle breathing animation if no audio active
      const idleWave = (Math.sin(animTime * 1.5) + 1) * 0.15;
      smoothedBass += (idleWave - smoothedBass) * 0.05;
      smoothedMid += (idleWave * 0.8 - smoothedMid) * 0.05;
      smoothedTreble += (idleWave * 0.5 - smoothedTreble) * 0.05;
      overallEnergy = smoothedBass * 0.5;
      return;
    }

    analyser.getByteFrequencyData(freqData);

    // Bass: bins 1 to 10 (~30Hz - 200Hz)
    let bassSum = 0;
    const bassBins = 10;
    for (let i = 1; i <= bassBins; i++) {
      bassSum += freqData[i];
    }
    const rawBass = (bassSum / bassBins / 255) * config.sensitivity;

    // Mid: bins 11 to 45 (~220Hz - 1800Hz)
    let midSum = 0;
    const midBins = 35;
    for (let i = 11; i <= 11 + midBins; i++) {
      midSum += freqData[i];
    }
    const rawMid = (midSum / midBins / 255) * config.sensitivity;

    // Treble: bins 46 to 110 (~2000Hz - 8000Hz)
    let trebleSum = 0;
    const trebleBins = 65;
    for (let i = 46; i <= 46 + trebleBins; i++) {
      trebleSum += freqData[i];
    }
    const rawTreble = (trebleSum / trebleBins / 255) * config.sensitivity;

    // Smooth values using EMA (Exponential Moving Average)
    const smoothFactor = 0.22;
    smoothedBass += (rawBass - smoothedBass) * smoothFactor;
    smoothedMid += (rawMid - smoothedMid) * smoothFactor;
    smoothedTreble += (rawTreble - smoothedTreble) * smoothFactor;

    overallEnergy = (smoothedBass * 0.6 + smoothedMid * 0.3 + smoothedTreble * 0.1);

    // Trigger pulse rings on strong bass hits
    if (config.visualizerMode === 'pulse' && rawBass > 0.65) {
      if (pulseRings.length === 0 || pulseRings[pulseRings.length - 1].radius > 60) {
        pulseRings.push({
          radius: 10,
          maxRadius: Math.max(width, height) * 0.7,
          alpha: Math.min(1, rawBass * 0.9),
          colorIndex: Math.floor(Math.random() * 3)
        });
      }
    }
  }

  /**
   * Extract dominant colors from current playing artwork
   */
  function checkAlbumArtwork() {
    if (config.colorMode !== 'album') {
      const preset = COLOR_PRESETS[config.colorMode] || COLOR_PRESETS.cyberpunk;
      targetColors = preset;
      return;
    }

    // Attempt to get artwork from MediaSession or player thumbnail
    let artworkSrc = '';
    if (navigator.mediaSession && navigator.mediaSession.metadata && navigator.mediaSession.metadata.artwork) {
      const arts = navigator.mediaSession.metadata.artwork;
      if (arts.length > 0) {
        artworkSrc = arts[arts.length - 1].src;
      }
    }

    if (!artworkSrc) {
      const imgEl = document.querySelector('ytmusic-player-bar .image') ||
                    document.querySelector('.thumbnail-image-wrapper img');
      if (imgEl && imgEl.src) {
        artworkSrc = imgEl.src;
      }
    }

    if (artworkSrc && artworkSrc !== lastArtworkUrl) {
      lastArtworkUrl = artworkSrc;
      extractColorsFromImage(artworkSrc);
    }
  }

  function extractColorsFromImage(src) {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const offCanvas = document.createElement('canvas');
        const offCtx = offCanvas.getContext('2d', { willReadFrequently: true });
        offCanvas.width = 40;
        offCanvas.height = 40;
        offCtx.drawImage(img, 0, 0, 40, 40);

        const imgData = offCtx.getImageData(0, 0, 40, 40).data;
        const colorSamples = [];

        for (let i = 0; i < imgData.length; i += 16) {
          const r = imgData[i];
          const g = imgData[i + 1];
          const b = imgData[i + 2];
          // Filter out dull black/near-white for vibrant atmosphere
          const brightness = (r * 299 + g * 587 + b * 114) / 1000;
          const saturation = Math.max(r, g, b) - Math.min(r, g, b);
          if (brightness > 25 && brightness < 235 && saturation > 30) {
            colorSamples.push({ r, g, b, sat: saturation });
          }
        }

        if (colorSamples.length >= 3) {
          // Sort by saturation to prioritize vivid tones
          colorSamples.sort((a, b) => b.sat - a.sat);
          targetColors = [
            colorSamples[0],
            colorSamples[Math.floor(colorSamples.length * 0.4)],
            colorSamples[Math.min(colorSamples.length - 1, Math.floor(colorSamples.length * 0.8))]
          ];
        }
      } catch (e) {
        // Fallback silently if canvas is tainted
      }
    };
    img.src = src;
  }

  /**
   * Smoothly lerp colors towards target
   */
  function updateColors() {
    const lerpRate = 0.04;
    for (let i = 0; i < 3; i++) {
      if (targetColors[i] && currentColors[i]) {
        currentColors[i].r += (targetColors[i].r - currentColors[i].r) * lerpRate;
        currentColors[i].g += (targetColors[i].g - currentColors[i].g) * lerpRate;
        currentColors[i].b += (targetColors[i].b - currentColors[i].b) * lerpRate;
      }
    }
  }

  function getRgba(color, alpha) {
    return `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha})`;
  }

  /**
   * RENDER MODE 1: Aurora & Fluid Glowing Orbs
   */
  function renderAurora() {
    const bassScale = 1 + smoothedBass * 0.85;
    const midShift = smoothedMid * 40;

    // Fill dark background base
    ctx.fillStyle = '#050508';
    ctx.fillRect(0, 0, width, height);

    // Orb 1: Center-Left Bass Pulsar (Primary Color)
    const x1 = width * 0.35 + Math.sin(animTime * 0.7) * 45;
    const y1 = height * 0.45 + Math.cos(animTime * 0.9) * 35;
    const r1 = Math.min(width, height) * 0.55 * bassScale;

    const g1 = ctx.createRadialGradient(x1, y1, 0, x1, y1, r1);
    g1.addColorStop(0, getRgba(currentColors[0], 0.95 + overallEnergy * 0.05));
    g1.addColorStop(0.5, getRgba(currentColors[0], 0.55));
    g1.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g1;
    ctx.beginPath();
    ctx.arc(x1, y1, r1, 0, Math.PI * 2);
    ctx.fill();

    // Orb 2: Top-Right Rhythm Harmonic (Secondary Color)
    const x2 = width * 0.72 + Math.cos(animTime * 0.8) * (50 + midShift);
    const y2 = height * 0.32 + Math.sin(animTime * 0.6) * 40;
    const r2 = Math.min(width, height) * (0.5 + smoothedMid * 0.4);

    const g2 = ctx.createRadialGradient(x2, y2, 0, x2, y2, r2);
    g2.addColorStop(0, getRgba(currentColors[1], 0.88 + smoothedMid * 0.12));
    g2.addColorStop(0.55, getRgba(currentColors[1], 0.45));
    g2.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.arc(x2, y2, r2, 0, Math.PI * 2);
    ctx.fill();

    // Orb 3: Bottom Ambient Glow (Accent Color)
    const x3 = width * 0.5 + Math.sin(animTime * 1.1) * 60;
    const y3 = height * 0.8 + Math.cos(animTime * 0.7) * 30;
    const r3 = Math.min(width, height) * (0.52 + smoothedTreble * 0.4);

    const g3 = ctx.createRadialGradient(x3, y3, 0, x3, y3, r3);
    g3.addColorStop(0, getRgba(currentColors[2], 0.82 + smoothedTreble * 0.18));
    g3.addColorStop(0.6, getRgba(currentColors[2], 0.38));
    g3.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g3;
    ctx.beginPath();
    ctx.arc(x3, y3, r3, 0, Math.PI * 2);
    ctx.fill();

    // Orb 4: Wandering Treble Spark
    const x4 = width * 0.2 + Math.cos(animTime * 1.3) * 70;
    const y4 = height * 0.75 + Math.sin(animTime * 1.4) * 40;
    const r4 = Math.min(width, height) * (0.35 + smoothedTreble * 0.35);

    const g4 = ctx.createRadialGradient(x4, y4, 0, x4, y4, r4);
    g4.addColorStop(0, getRgba(currentColors[0], 0.75));
    g4.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g4;
    ctx.beginPath();
    ctx.arc(x4, y4, r4, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * RENDER MODE 2: Bass Pulse Rings
   */
  function renderPulse() {
    ctx.fillStyle = '#040407';
    ctx.fillRect(0, 0, width, height);

    const cx = width * 0.5;
    const cy = height * 0.48;

    // Glowing Core
    const coreRadius = Math.min(width, height) * (0.2 + smoothedBass * 0.35);
    const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius);
    coreGrad.addColorStop(0, getRgba(currentColors[0], 0.9));
    coreGrad.addColorStop(0.5, getRgba(currentColors[1], 0.4));
    coreGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = coreGrad;
    ctx.beginPath();
    ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
    ctx.fill();

    // Render & expand rings
    for (let i = pulseRings.length - 1; i >= 0; i--) {
      const ring = pulseRings[i];
      ring.radius += 3.5 * config.speed;
      ring.alpha -= 0.012;

      if (ring.alpha <= 0 || ring.radius > ring.maxRadius) {
        pulseRings.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.lineWidth = 14 + smoothedBass * 10;
      ctx.strokeStyle = getRgba(currentColors[ring.colorIndex], ring.alpha * 0.7);
      ctx.beginPath();
      ctx.arc(cx, cy, ring.radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * RENDER MODE 3: Fluid Waveform Ribbon
   */
  function renderWave() {
    ctx.fillStyle = '#040407';
    ctx.fillRect(0, 0, width, height);

    const layers = 3;
    for (let l = 0; l < layers; l++) {
      ctx.beginPath();
      ctx.moveTo(0, height);

      const color = currentColors[l % 3];
      const yOffset = height * (0.45 + l * 0.15);
      const waveFreq = 0.008 + l * 0.003;
      const waveAmp = (40 + smoothedBass * 80 + smoothedMid * 40) * (l + 1) * 0.5;

      for (let x = 0; x <= width; x += 15) {
        const y = yOffset + Math.sin(x * waveFreq + animTime * (1 + l * 0.4)) * waveAmp;
        ctx.lineTo(x, y);
      }

      ctx.lineTo(width, height);
      ctx.closePath();

      const waveGrad = ctx.createLinearGradient(0, yOffset - waveAmp, 0, height);
      waveGrad.addColorStop(0, getRgba(color, 0.45));
      waveGrad.addColorStop(1, getRgba(color, 0.02));
      ctx.fillStyle = waveGrad;
      ctx.fill();
    }
  }

  /**
   * RENDER MODE 4: Floating Dynamic Particles
   */
  function renderParticles() {
    ctx.fillStyle = '#030306';
    ctx.fillRect(0, 0, width, height);

    const speedBoost = 1 + smoothedBass * 3.5;

    for (let p of particles) {
      p.x += p.vx * speedBoost * config.speed;
      p.y += p.vy * speedBoost * config.speed;

      // Wrap around bounds
      if (p.x < 0) p.x = width;
      if (p.x > width) p.x = 0;
      if (p.y < 0) p.y = height;
      if (p.y > height) p.y = 0;

      const pSize = p.size * (1 + smoothedTreble * 1.5);
      const color = currentColors[p.colorIndex];

      const pGrad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, pSize * 4);
      pGrad.addColorStop(0, getRgba(color, p.alpha));
      pGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');

      ctx.fillStyle = pGrad;
      ctx.beginPath();
      ctx.arc(p.x, p.y, pSize * 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /**
   * Remove background colors hidden inside Web Component Shadow DOMs (e.g. tp-yt-app-drawer)
   */
  function cleanShadowDOMBackgrounds() {
    // 1. Drawer shadow root
    const drawers = document.querySelectorAll('tp-yt-app-drawer');
    drawers.forEach(drawer => {
      if (drawer && drawer.shadowRoot) {
        if (!drawer.shadowRoot.getElementById('ytm-sfx-drawer-style')) {
          const style = document.createElement('style');
          style.id = 'ytm-sfx-drawer-style';
          style.textContent = `
            #contentContainer, #scrim, :host {
              background: transparent !important;
              background-color: transparent !important;
              overflow-x: hidden !important;
              scrollbar-width: none !important;
            }
            ::-webkit-scrollbar {
              display: none !important;
              width: 0 !important;
              height: 0 !important;
            }
          `;
          drawer.shadowRoot.appendChild(style);
        }
      }
    });

    // 2. Guide renderer shadow root
    const guides = document.querySelectorAll('ytmusic-guide-renderer');
    guides.forEach(guide => {
      if (guide && guide.shadowRoot) {
        if (!guide.shadowRoot.getElementById('ytm-sfx-guide-style')) {
          const style = document.createElement('style');
          style.id = 'ytm-sfx-guide-style';
          style.textContent = `
            #background, #content, #sections, :host {
              background: transparent !important;
              background-color: transparent !important;
              overflow-x: hidden !important;
              scrollbar-width: none !important;
            }
            ::-webkit-scrollbar {
              display: none !important;
              width: 0 !important;
              height: 0 !important;
            }
          `;
          guide.shadowRoot.appendChild(style);
        }
      }
    });

    // 3. Guide section renderers shadow root
    const sections = document.querySelectorAll('ytmusic-guide-section-renderer');
    sections.forEach(sec => {
      if (sec && sec.shadowRoot) {
        if (!sec.shadowRoot.getElementById('ytm-sfx-sec-style')) {
          const style = document.createElement('style');
          style.id = 'ytm-sfx-sec-style';
          style.textContent = `
            #items, :host {
              overflow-x: hidden !important;
              scrollbar-width: none !important;
            }
            ::-webkit-scrollbar {
              display: none !important;
              width: 0 !important;
              height: 0 !important;
            }
          `;
          sec.shadowRoot.appendChild(style);
        }
      }
    });

    // 4. Mark html active and body class
    if (!document.documentElement.hasAttribute('ytm-sfx-active')) {
      document.documentElement.setAttribute('ytm-sfx-active', 'true');
    }
    if (!document.body.classList.contains('ytm-sfx-enabled')) {
      document.body.classList.add('ytm-sfx-enabled');
    }
  }

  /**
   * Main Render Loop
   */
  function render(timestamp) {
    animFrameId = requestAnimationFrame(render);

    if (!config.enabled) return;

    animTime += 0.016 * config.speed;

    // Check periodically for audio node, artwork, state & Shadow DOM cleaning
    if (!isAudioConnected && Math.floor(animTime * 10) % 15 === 0) {
      initAudio();
    }
    if (Math.floor(animTime * 10) % 20 === 0) {
      applyVisualStyles();
    }
    if (Math.floor(animTime * 10) % 25 === 0) {
      checkAlbumArtwork();
    }
    if (Math.floor(animTime * 10) % 60 === 0) {
      cleanShadowDOMBackgrounds();
    }

    updateAudioMetrics();
    updateColors();

    switch (config.visualizerMode) {
      case 'pulse':
        renderPulse();
        break;
      case 'wave':
        renderWave();
        break;
      case 'particles':
        renderParticles();
        break;
      case 'aurora':
      default:
        renderAurora();
        break;
    }
  }

  /**
   * Handle incoming configurations from Bridge script
   */
  window.addEventListener('message', (event) => {
    if (event.data && event.data.source === 'YTM_SFX_EXT' && event.data.type === 'CONFIG_UPDATE') {
      config = { ...config, ...event.data.config };
      applyVisualStyles();
    }
  });

  // Request initial config from bridge script
  window.postMessage({ source: 'YTM_SFX_PAGE', type: 'REQUEST_CONFIG' }, '*');

  // Boot
  initDOM();
  initAudio();
  cleanShadowDOMBackgrounds();
  animFrameId = requestAnimationFrame(render);

  // Seamlessly switch between Home / Player Page when clicking left navigation
  document.addEventListener('click', (e) => {
    const guideItem = e.target.closest('ytmusic-guide-entry-renderer');
    if (guideItem) {
      const appLayout = document.querySelector('ytmusic-app-layout');
      if (appLayout && (appLayout.hasAttribute('player-page-open') || appLayout.getAttribute('player-ui-state') === 'PLAYER_PAGE_OPEN')) {
        const closeBtn = document.querySelector('ytmusic-player-page .down-button, ytmusic-player-page .toggle-player-page-button, ytmusic-player-bar .toggle-player-page-button, ytmusic-player-page #down-button');
        if (closeBtn) {
          closeBtn.click();
        } else {
          appLayout.removeAttribute('player-page-open');
          appLayout.setAttribute('player-ui-state', 'MINIPLAYER');
        }
      }
    }
  }, true);

  console.log('[YTM-SFX] Visualizer loaded successfully in MAIN world.');
})();

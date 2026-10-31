/**
 * YouTube Music SFX - Popup Settings Controller
 * Optimized with debouncing and chrome.storage.local to prevent quota limits.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Elements
  const toggleEnabled = document.getElementById('toggleEnabled');
  const visualizerMode = document.getElementById('visualizerMode');
  const colorMode = document.getElementById('colorMode');
  const sensitivity = document.getElementById('sensitivity');
  const opacity = document.getElementById('opacity');
  const blur = document.getElementById('blur');
  const speed = document.getElementById('speed');

  // Value display spans
  const valSensitivity = document.getElementById('valSensitivity');
  const valOpacity = document.getElementById('valOpacity');
  const valBlur = document.getElementById('valBlur');
  const valSpeed = document.getElementById('valSpeed');

  const DEFAULT_CONFIG = {
    enabled: true,
    visualizerMode: 'aurora',
    colorMode: 'album',
    sensitivity: 1.2,
    opacity: 0.75,
    blur: 40,
    speed: 1.0
  };

  let saveTimeout = null;

  // Use local storage to prevent MAX_WRITE_OPERATIONS_PER_MINUTE quota errors
  const storage = chrome.storage.local || chrome.storage.sync;

  // Load saved settings
  storage.get(DEFAULT_CONFIG, (cfg) => {
    if (chrome.runtime.lastError) {
      console.warn('[YTM-SFX] Storage get notice:', chrome.runtime.lastError.message);
    }
    const current = cfg || DEFAULT_CONFIG;
    toggleEnabled.checked = current.enabled !== false;
    visualizerMode.value = current.visualizerMode || 'aurora';
    colorMode.value = current.colorMode || 'album';
    sensitivity.value = current.sensitivity || 1.2;
    opacity.value = current.opacity || 0.75;
    blur.value = current.blur || 40;
    speed.value = current.speed || 1.0;

    updateDisplays();
  });

  function updateDisplays() {
    valSensitivity.textContent = `${parseFloat(sensitivity.value).toFixed(1)}x`;
    valOpacity.textContent = `${Math.round(parseFloat(opacity.value) * 100)}%`;
    valBlur.textContent = `${blur.value}px`;
    valSpeed.textContent = `${parseFloat(speed.value).toFixed(1)}x`;
  }

  function getCurrentConfig() {
    return {
      enabled: toggleEnabled.checked,
      visualizerMode: visualizerMode.value,
      colorMode: colorMode.value,
      sensitivity: parseFloat(sensitivity.value),
      opacity: parseFloat(opacity.value),
      blur: parseInt(blur.value, 10),
      speed: parseFloat(speed.value)
    };
  }

  function broadcastToTabs(config) {
    chrome.tabs.query({ url: "*://music.youtube.com/*" }, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'YTM_SFX_SET_CONFIG',
          config: config
        }).catch(() => {
          // Tab may not have injected script yet
        });
      });
    });
  }

  function onConfigChange(immediateSave = false) {
    updateDisplays();
    const config = getCurrentConfig();

    // Broadcast immediately to YouTube Music tabs for 60fps real-time visual response
    broadcastToTabs(config);

    // Debounce storage write to completely prevent MAX_WRITE_OPERATIONS_PER_MINUTE errors
    clearTimeout(saveTimeout);
    if (immediateSave) {
      storage.set(config, () => {
        if (chrome.runtime.lastError) {
          console.warn('[YTM-SFX] Storage save notice:', chrome.runtime.lastError.message);
        }
      });
    } else {
      saveTimeout = setTimeout(() => {
        storage.set(config, () => {
          if (chrome.runtime.lastError) {
            console.warn('[YTM-SFX] Storage save notice:', chrome.runtime.lastError.message);
          }
        });
      }, 300);
    }
  }

  // Event Listeners:
  // Dropdowns & Toggles save immediately
  toggleEnabled.addEventListener('change', () => onConfigChange(true));
  visualizerMode.addEventListener('change', () => onConfigChange(true));
  colorMode.addEventListener('change', () => onConfigChange(true));

  // Sliders broadcast in real-time and debounce storage saving
  sensitivity.addEventListener('input', () => onConfigChange(false));
  opacity.addEventListener('input', () => onConfigChange(false));
  blur.addEventListener('input', () => onConfigChange(false));
  speed.addEventListener('input', () => onConfigChange(false));
});

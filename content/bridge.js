/**
 * YouTube Music SFX - Bridge Script (Isolated Content Script)
 * Bridges communication between Chrome Extension Storage/Popup and the Page-Context Visualizer.
 */

(function () {
  const DEFAULT_CONFIG = {
    enabled: true,
    visualizerMode: 'aurora',
    colorMode: 'album',
    sensitivity: 1.2,
    blur: 40,
    opacity: 0.75,
    speed: 1.0
  };

  let currentConfig = { ...DEFAULT_CONFIG };
  const storage = chrome.storage.local || chrome.storage.sync;

  // Load configuration from local storage
  storage.get(DEFAULT_CONFIG, (items) => {
    currentConfig = items || DEFAULT_CONFIG;
    applyConfig(currentConfig);
  });

  // Listen for changes from chrome.storage
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' || area === 'sync') {
      for (let key in changes) {
        currentConfig[key] = changes[key].newValue;
      }
      applyConfig(currentConfig);
    }
  });

  // Listen for direct messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'YTM_SFX_SET_CONFIG') {
      currentConfig = { ...currentConfig, ...message.config };
      storage.set(currentConfig);
      applyConfig(currentConfig);
      sendResponse({ status: 'ok', config: currentConfig });
    } else if (message.type === 'YTM_SFX_GET_CONFIG') {
      sendResponse({ status: 'ok', config: currentConfig });
    }
    return true;
  });

  function applyConfig(cfg) {
    // Toggle body class and root attribute for CSS transparency
    if (cfg.enabled) {
      document.body.classList.add('ytm-sfx-enabled');
      document.documentElement.setAttribute('ytm-sfx-active', 'true');
    } else {
      document.body.classList.remove('ytm-sfx-enabled');
      document.documentElement.removeAttribute('ytm-sfx-active');
    }

    // Forward configuration to MAIN world visualizer script
    window.postMessage({
      source: 'YTM_SFX_EXT',
      type: 'CONFIG_UPDATE',
      config: cfg
    }, '*');
  }

  // Answer ping from page if visualizer initializes late
  window.addEventListener('message', (event) => {
    if (event.data && event.data.source === 'YTM_SFX_PAGE' && event.data.type === 'REQUEST_CONFIG') {
      applyConfig(currentConfig);
    }
  });
})();

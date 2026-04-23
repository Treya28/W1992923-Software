// Background service worker script — runs constantly in browser background

// Known AI websites and their display names used for detection and badge labels
const AI_SITES = {
  'chat.openai.com': 'ChatGPT',
  'chatgpt.com': 'ChatGPT',
  'claude.ai': 'Claude',
  'gemini.google.com': 'Gemini',
  'midjourney.com': 'Midjourney',
  'perplexity.ai': 'Perplexity'
};

// Returns the display name of the AI site matching the URL, or null if not recognised
function detectAISite(url) {
  if (!url) return null;
  for (const [site, name] of Object.entries(AI_SITES)) {
    if (url.includes(site)) return name;  // first match returns
  }
  return null;
}

// Puts a star badge on the extension icon for the given tab to show an AI site is active
function setActiveBadge(tabId) {
  chrome.action.setBadgeText({ text: '✦', tabId });
  chrome.action.setBadgeBackgroundColor({ color: '#ea66df', tabId });
}

// Removes the badge from the extension icon for the given tab
function clearBadge(tabId) {
  chrome.action.setBadgeText({ text: '', tabId });
}

// Injects popup panel into the current page as an iframe, by both the icon-click and auto-activation 

// autoShow = false ->  toggle open if closed, close if open
// autoShow = true  -> show after a 3s delay (skip if already open)
function injectPanel(popupUrl, autoShow, toolName) {
  const PANEL_ID = 'ai-assistant-panel';

  // Injects the panel's CSS into the host page once; skips if already injected
  function ensureStyles() {
    if (document.getElementById('ai-panel-styles')) return;  // already injected
    const style = document.createElement('style');
    style.id = 'ai-panel-styles';
    style.textContent = `
      @keyframes ai-panel-slideIn {
        from { transform: translateX(110%); opacity: 0; }
        to   { transform: translateX(0);    opacity: 1; }
      }
      #ai-assistant-panel {
        position: fixed !important;
        bottom: 20px !important;
        right: 20px !important;
        width: 380px !important;
        border-radius: 12px !important;
        box-shadow: 0 10px 40px rgba(0,0,0,0.25) !important;
        z-index: 2147483647 !important;
        overflow: visible !important;
        animation: ai-panel-slideIn 0.3s ease-out !important;
      }
      #ai-assistant-panel iframe {
        width: 100% !important;
        height: 570px !important;
        border: none !important;
        display: block !important;
        border-radius: 12px !important;
      }
    
      #ai-panel-close {
        position: absolute !important;
        top: -10px !important;
        right: -10px !important;
        width: 26px !important;
        height: 26px !important;
        border-radius: 50% !important;
        background: #81b27c !important;
        color: #296029 !important;
        border: none !important;
        font-size: 16px !important;
        line-height: 26px !important;
        text-align: center !important;
        cursor: pointer !important;
        z-index: 1 !important;
        padding: 0 !important;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3) !important;
      }
      #ai-panel-close:hover { background: #306830 !important; }
    `;
    document.head.appendChild(style);
  }

  // Builds the floating panel div with an iframe and a close button, then appends it to page
  function createPanel() {
    if (document.getElementById(PANEL_ID)) return;  // panel already exists — don't duplicate
    ensureStyles();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;

    // Close button for the panel
    const closeBtn = document.createElement('button');
    closeBtn.id = 'ai-panel-close';
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', () => {
      // If the panel appeared automatically, record that the user dismissed it so it won't reappear on site during this session
      if (autoShow && toolName) {
        chrome.runtime.sendMessage({ action: 'dismissWidget', tool: toolName });
      }
      panel.remove();
    });

    // The iframe loads popup.html — extension's full UI inside the panel
    const iframe = document.createElement('iframe');
    iframe.src = popupUrl;
    iframe.allow = 'clipboard-write';

    panel.appendChild(closeBtn);
    panel.appendChild(iframe);
    document.body.appendChild(panel);

    // Allow popup.js to close the panel via window.close() -> postMessage
    window.addEventListener('message', function onMsg(e) {
      if (e.data && e.data.action === 'closeAIPanel') {
        panel.remove();
        window.removeEventListener('message', onMsg);  // clean up listener once used
      }
    });
  }

  if (autoShow) {
    // Auto-activation: show after 3s, skip if already open
    setTimeout(createPanel, 3000);
  } else {
    // Icon click: toggle — remove panel if visible, otherwise create it
    const existing = document.getElementById(PANEL_ID);
    if (existing) { existing.remove(); return; }
    createPanel();
  }
}

// Icon click: inject panel on any injectable tab
chrome.action.onClicked.addListener(async (tab) => {
  // Only inject on real web pages — skip chrome:// and other restricted URLs
  if (!tab.url || !tab.url.startsWith('http')) return;
  const popupUrl = chrome.runtime.getURL('popup.html');
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: injectPanel,
      args: [popupUrl, false]  // false = manual toggle, no delay
    });
  } catch (err) {
    console.error('AI Assistant: could not inject panel', err);
  }
});

// Auto-activate on AI sites ───────────────────────────────────────────────
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  // Only act once the page has fully loaded
  if (changeInfo.status !== 'complete' || !tab.url) return;

  const tool = detectAISite(tab.url);
  if (!tool) { clearBadge(tabId); return; }  // not an AI site — clear any old badge

  setActiveBadge(tabId);

  // Respect the contextual-activation setting and per-site dismiss state
  const stored = await chrome.storage.local.get([
    'contextualActivation',
    `widget_dismissed_${tool}`
  ]);
  if (stored.contextualActivation === false) return;  // user turned off auto-activation
  if (stored[`widget_dismissed_${tool}`]) return;  // user already dismissed on this site

  const popupUrl = chrome.runtime.getURL('popup.html');
  chrome.scripting.executeScript({
    target: { tabId },
    func: injectPanel,
    args: [popupUrl, true, tool]  // true = auto-show with 3s delay
  }).catch(() => {});  // silently ignore errors on restricted pages
});

// Update badge when the user switches tabs
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    // Show badge if the newly active tab is an AI site, otherwise clear it
    if (detectAISite(tab.url)) {
      setActiveBadge(tabId);
    } else {
      clearBadge(tabId);
    }
  } catch (_) {}  // tab may have been closed — ignore the error
});


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Remove the badge when the popup opens so the notification is acknowledged
  if (request.action === 'clearBadge') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab) clearBadge(tab.id);
    });
    return;
  }

  // Open a recommended tool in a new tab
  if (request.action === 'openTool' && request.url) {
    chrome.tabs.create({ url: request.url });
    return;
  }

  // Mark a site's widget as dismissed so it won't auto-show again this session
  if (request.action === 'dismissWidget' && request.tool) {
    chrome.storage.local.set({ [`widget_dismissed_${request.tool}`]: true });
    return;
  }

  // Open the settings page in a new tab
  if (request.action === 'openSettings') {
    chrome.tabs.create({ url: chrome.runtime.getURL('settings.html') });
    return;
  }

  // Forward the task to the Flask backend for keyword-based tool matching
  if (request.action === 'analyseTask') {
    fetch('https://w19929235-fyp.hf.space:7860/analyse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: request.task })
    })
      .then(r => r.json())
      .then(data => sendResponse(data))
      .catch(err => sendResponse({ error: err.message }));
    return true;  // returning true keeps the message channel open for the async response
  }
});

// Keep backend alive ────────────────────────────────────────────────────
// Ping the Flask server every 5 minutes so it stays responsive
chrome.alarms.create('pingBackend', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'pingBackend') {
    fetch('https://w19929235-fyp.hf.space:7860/health').catch(() => {});  // ignore failures — server may just be offline
  }
});

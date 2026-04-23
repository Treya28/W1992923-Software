// List of AI tools that can have their "dismissed" flag reset from settings
const AI_TOOLS = ['ChatGPT', 'Claude', 'Gemini', 'Midjourney', 'Perplexity'];

// Load saved settings on page open
document.addEventListener('DOMContentLoaded', () => {
  // Read the contextual activation toggle from storage
  // Default to true so new installs have the feature enabled out of the box
  chrome.storage.local.get(['contextualActivation'], (result) => {
    const enabled = result.contextualActivation !== false;
    document.getElementById('contextualActivation').checked = enabled;
  });

  // Complete the profile section and feedback table with stored data
  loadProfile();
  loadFeedbackStats();
});

// Persist the contextual activation preference 
document.getElementById('contextualActivation').addEventListener('change', (e) => {
  chrome.storage.local.set({ contextualActivation: e.target.checked });
});

// Remove all site dismissed flags so the pop-up widget shows again on AI sites
document.getElementById('resetWidgets').addEventListener('click', () => {
  // Build the list of storage keys to delete — one per known AI tool
  const keysToRemove = AI_TOOLS.map(tool => `widget_dismissed_${tool}`);
  chrome.storage.local.remove(keysToRemove, () => {
    // Give the user visual confirmation of the reset success
    const btn = document.getElementById('resetWidgets');
    btn.textContent = 'Reset Successful!';
    btn.style.background = '#2e8732';
    setTimeout(() => {
      btn.textContent = 'Reset Dismissed Pop-Up';
      btn.style.background = '';  // restore original CSS colour
    }, 2000);
  });
});

// Profile ───────────────────────────────────────────────────────────────────

// Reads the saved user profile from storage and displays it, shows the empty message if nothing is saved
function loadProfile() {
  chrome.storage.local.get(['userProfile'], (result) => {
    const profile = result.userProfile;
    // Only show the profile card if at least one field has been saved
    if (profile && (profile.course || profile.year)) {
      document.getElementById('profileCourse').textContent = profile.course || '—';
      document.getElementById('profileYear').textContent   = profile.year   || '—';
      document.getElementById('profileDisplay').classList.remove('hidden');
      document.getElementById('noProfile').classList.add('hidden');
    }
  });
}

// Delete the saved profile and show the empty message
document.getElementById('clearProfile').addEventListener('click', () => {
  chrome.storage.local.remove('userProfile', () => {
    document.getElementById('profileDisplay').classList.add('hidden');
    document.getElementById('noProfile').classList.remove('hidden');
  });
});

// Feedback Statistics ───────────────────────────────────────────────────────

// Reads all stored feedback ratings and creates summary table 
function loadFeedbackStats() {
  chrome.storage.local.get(['feedbackStats', 'feedbackLog'], (result) => {
    const stats = result.feedbackStats || {};
    const log   = result.feedbackLog   || [];
    const container = document.getElementById('feedbackStatsContainer');

    // Show a placeholder message if no ratings recorded 
    if (Object.keys(stats).length === 0) {
      container.innerHTML = '<p class="no-data">No feedback recorded yet.</p>';
      return;
    }

    // Calculate overall helpfulness across all tools
    const totalHelpful = log.filter(e => e.rating === 'helpful').length;
    const overallAcc   = Math.round((totalHelpful / log.length) * 100);

    // Build one table row per tool with its helpful / not helpful counts and percentage
    const rows = Object.entries(stats).map(([tool, s]) => {
      const total      = s.helpful + s.notHelpful;
      const acc        = Math.round((s.helpful / total) * 100);
      // Green text for >= 60% helpfulness, else red 
      const accClass   = acc >= 60 ? 'acc-good' : 'acc-bad';
      return `<tr>
        <td>${tool}</td>
        <td>${s.helpful}</td>
        <td>${s.notHelpful}</td>
        <td>${total}</td>
        <td class="${accClass}">${acc}%</td>
      </tr>`;
    }).join('');

    // Render the summary line and the full table 
    container.innerHTML = `
      <p class="stats-total">
        Total ratings: <strong>${log.length}</strong>
        &nbsp;|&nbsp;
        Overall helpfulness: <strong>${overallAcc}%</strong>
      </p>
      <table>
        <thead>
          <tr><th>Tool</th><th>Helpful</th><th>Not Helpful</th><th>Total</th><th>Percentage</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  });
}

// Clear all feedback data and re-render (now empty) stats section
document.getElementById('clearFeedback').addEventListener('click', () => {
  chrome.storage.local.remove(['feedbackStats', 'feedbackLog'], () => {
    loadFeedbackStats();  // reload to show the "no feedback" placeholder
  });
});

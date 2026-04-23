// When running inside the injected panel iframe, route window.close() to postMessage to remove panel div.
window.close = function () {
  if (window.parent !== window) {
    window.parent.postMessage({ action: 'closeAIPanel' }, '*');
  }
};

document.addEventListener('DOMContentLoaded', function() {

  const taskInput = document.getElementById('taskInput');

  // Detects if active tab is an AI site to show banner
  async function checkContextualActivation() {
    // Get  URL of the active browser tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) return;

    const url = tab.url.toLowerCase();

    // Map of known AI site to their display names
    const aiSites = {
      'chat.openai.com': 'ChatGPT',
      'chatgpt.com': 'ChatGPT',
      'claude.ai': 'Claude',
      'gemini.google.com': 'Gemini',
      'midjourney.com': 'Midjourney',
      'perplexity.ai': 'Perplexity'
    };

    let detectedTool = null;
    // Loop through known sites and check if the current URL contains any of them
    for (const [site, name] of Object.entries(aiSites)) {
      if (url.includes(site)) {
        detectedTool = name;
        break;  // stop at the first match
      }
    }

    if (detectedTool) {
      // Show detection banner at the top of the popup
      const detectionMessage = document.createElement('div');
      detectionMessage.className = 'detection-message';
      detectionMessage.innerHTML = `
        <div class="detection-badge">Detected: You're using ${detectedTool}</div>
        <p class="detection-text">Find a <strong>better specialised tool</strong> for your specific task!</p>
      `;
      // Insert the banner directly below the main heading
      const h1 = document.querySelector('h1');
      h1.insertAdjacentElement('afterend', detectionMessage);

      taskInput.focus();  // move cursor into the task box so user can type immediately

      // Clear the extension badge since popup is open
      chrome.runtime.sendMessage({ action: 'clearBadge' });

      // Store the current AI tool for other parts of the extension
      chrome.storage.local.set({ currentAItool: detectedTool });
    }
  }

  // Activate contextual mode as soon as the popup opens
  checkContextualActivation();


  // DOM references for the Tool Recommender section ───────────────────────
  const findToolBtn = document.getElementById('findToolBtn');
  const recommendationSection = document.getElementById('recommendationSection');
  const generalToolSection = document.getElementById('generalToolSection');
  const useGeneralBtn = document.getElementById('useGeneralBtn');
  const toolName = document.getElementById('toolName');
  const toolDescription = document.getElementById('toolDescription');
  const useToolBtn = document.getElementById('useToolBtn');
  const promptBuilderBtn = document.getElementById('promptBuilderBtn');
  const openPromptBuilderBtn = document.getElementById('openPromptBuilderBtn');
  const statusDiv = document.getElementById('status');

  // DOM references for the Prompt Builder section ─────────────────────────
  const promptBuilderSection = document.getElementById('promptBuilderSection');
  const closePromptBuilder = document.getElementById('closePromptBuilder');
  const templateSelection = document.getElementById('templateSelection');
  const templateForm = document.getElementById('templateForm');
  const generatedPromptSection = document.getElementById('generatedPromptSection');
  const backToTemplatesBtn = document.getElementById('backToTemplatesBtn');
  const generatePromptBtn = document.getElementById('generatePromptBtn');
  const templateTitle = document.getElementById('templateTitle');
  const templateDescription = document.getElementById('templateDescription');
  const templateFields = document.getElementById('templateFields');
  const finalPrompt = document.getElementById('finalPrompt');
  const copyPromptBtn = document.getElementById('copyPromptBtn');
  const editPromptBtn = document.getElementById('editPromptBtn');
  const copyStatus = document.getElementById('copyStatus');

  
  let recommendedTool = null;       // tool object currently recommended to user
  let formData = {};                // values collected from the active template form
  let selectedTemplate = null;     // id of the template the user picked
  let currentGeneratedPrompt = ''; // the finished prompt text ready to copy

  // Feedback ────────────────────────────────────────────────────

  // Increments the helpfulness counter for tool and appends timestamped log entry
  async function saveFeedback(toolName, rating) {
    const stored = await chrome.storage.local.get(['feedbackStats', 'feedbackLog']);
    const stats = stored.feedbackStats || {};
    const log   = stored.feedbackLog   || [];

    // Initialise counters for this tool if it hasn't been rated before
    if (!stats[toolName]) stats[toolName] = { helpful: 0, notHelpful: 0 };
    stats[toolName][rating]++;
    // Append a timestamped entry to the log for history in Settings
    log.push({ toolName, rating, timestamp: Date.now() });

    await chrome.storage.local.set({ feedbackStats: stats, feedbackLog: log });
  }

  // Shows a confirmation message after rating 
  function showFeedbackConfirm(message) {
    const confirm = document.getElementById('feedbackConfirm');
    confirm.textContent = message;
    confirm.classList.remove('hidden');
    // Disable buttons so user can't rate the same recommendation 
    document.getElementById('thumbsUpBtn').disabled = true;
    document.getElementById('thumbsDownBtn').disabled = true;
  }

  // Profile ────────────────────────────────────────────────────────

  // Returns the saved user profile objects (course, year) from chrome.storage
  async function loadUserProfile() {
    const { userProfile } = await chrome.storage.local.get('userProfile');
    return userProfile || {};  // return empty object if nothing saved
  }

  // Saves the user's course and year of study to chrome.storage for future prompt builder sessions
  function saveUserProfile(course, year) {
    if (course || year) {
      chrome.storage.local.set({ userProfile: { course: course || '', year: year || '' } });
    }
  }

  // Restore the last task the user typed when the popup re-opens
  loadRecentTask();


  // Tool Recommender functions ─────────────────────────────────────────────

  // Fetches and returns the tools array from tools.json 
  async function loadTools() {
    try {
      const response = await fetch(chrome.runtime.getURL('tools.json'));
      return await response.json();
    } catch (error) {
      console.error('Error loading tools:', error);
      return { tools: [] };  // return empty list so the rest of the UI doesn't break
    }
  }

  // Keyword matching then falls back to the LLM endpoint, displays the result or  fallback option
  async function findBestTool() {
    const task = taskInput.value.trim();

    // Stop if the input is empty
    if (!task) {
      showStatus('Please describe your task first!', 'error');
      taskInput.focus();
      return;
    }

    saveTask(task);  // persist the task so it's still there if the popup closes and reopens
    showStatus('Finding the best AI tool for your task...', 'info');
    // Hide any previous results while searching
    recommendationSection.classList.add('hidden');
    generalToolSection.classList.add('hidden');

    try {
      const toolsData = await loadTools();
      const matchedTool = findMatchingTool(task, toolsData.tools);

      if (matchedTool) {
        // A keyword match was found in tools.json — show it immediately
        showRecommendation(matchedTool, false);
      } else {
        // No keyword match — ask the LLM
        showStatus('No direct match found. Asking AI for a suggestion...', 'info');
        const llmResult = await fetchLLMSuggestion(task);

        if (llmResult && llmResult.recommended && llmResult.tool) {
          // LLM returned a tool suggestion — show it with the AI badge
          showRecommendation(llmResult.tool, true);
        } else {
          // Neither keyword nor LLM found anything — offer the general AI fallback
          generalToolSection.classList.remove('hidden');
          showStatus('No specialised tool found. Try a general AI instead.', 'info');
        }
      }
    } catch (error) {
      console.error('Error finding tool:', error);
      showStatus('Error finding tool. Try again.', 'error');
      generalToolSection.classList.remove('hidden');
    }
  }

  // Fills the recommendation card with the tool details and makes it visible.
  function showRecommendation(tool, isAISuggested) {
    recommendedTool = tool;  // save so the "Use This Tool" button can navigate
    toolName.textContent = tool.name;
    toolDescription.textContent = tool.description;

    // Show the "AI Suggested" badge only when the result came from the LLM
    const badge = document.getElementById('aiSuggestedBadge');
    if (badge) {
      badge.classList.toggle('hidden', !isAISuggested);
    }

    recommendationSection.classList.remove('hidden');

    // Reset feedback state for each new recommendation so the user can rate again
    document.getElementById('feedbackConfirm').classList.add('hidden');
    document.getElementById('thumbsUpBtn').disabled = false;
    document.getElementById('thumbsDownBtn').disabled = false;

    const label = isAISuggested ? `AI suggested: ${tool.name}` : `Found ${tool.name} for your task!`;
    showStatus(label, 'success');
  }

  // Sends the task to the Flask LLM endpoint and returns the result
  async function fetchLLMSuggestion(task) {
    try {
      const response = await fetch('http://localhost:7700/analyze-llm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task })
      });
      if (!response.ok) return null;  
      return await response.json();
    } catch (e) {
      // If backend fails, silently so the UI can show fallback
      console.log('LLM backend not available:', e.message);
      return null;
    }
  }

  // Searches categories, tags, then tool names for a keyword match
  function findMatchingTool(task, tools) {
    const taskLower = task.toLowerCase();

    // 1. check categories 
    for (const tool of tools) {
      if (tool.categories) {
        for (const category of tool.categories) {
          if (taskLower.includes(category.toLowerCase())) {
            return tool;  // first category match wins
          }
        }
      }
    }

    // 2. check tags 
    for (const tool of tools) {
      if (tool.tags) {
        for (const tag of tool.tags) {
          if (taskLower.includes(tag.toLowerCase())) {
            return tool;
          }
        }
      }
    }

    // 3. check if the user typed the tool's name directly
    for (const tool of tools) {
      if (taskLower.includes(tool.name.toLowerCase())) {
        return tool;
      }
    }

    return null;  // no match found in any
  }

  // Displays status message
  function showStatus(message, type = 'info') {
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.classList.remove('hidden');

    // Automatically hide non-error messages after 5 seconds
    if (type !== 'error') {
      setTimeout(() => {
        statusDiv.classList.add('hidden');
      }, 5000);
    }
  }

  // Persists the task text to chrome.storage so it is still present if the popup closes and reopens
  function saveTask(task) {
    chrome.storage.local.set({ lastTask: task });
  }

  // Reads the last saved task from chrome.storage and pre-fills the task input box.
  function loadRecentTask() {
    chrome.storage.local.get(['lastTask'], function(result) {
      if (result.lastTask) {
        taskInput.value = result.lastTask;
      }
    });
  }


  // Event Listeners ────────────────────────────────────────────────────────

  // Open settings page in a new tab
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.sendMessage({ action: 'openSettings' });
  });

  // Trigger tool recommendation when the button is clicked
  findToolBtn.addEventListener('click', findBestTool);

  // Open the recommended tool's website in a new tab and close the popup
  useToolBtn.addEventListener('click', () => {
    if (recommendedTool && recommendedTool.url) {
      chrome.tabs.create({ url: recommendedTool.url });
      window.close();
    }
  });

  // Thumbs-up: record a positive rating for the current recommendation
  document.getElementById('thumbsUpBtn').addEventListener('click', async () => {
    if (!recommendedTool) return;
    await saveFeedback(recommendedTool.name, 'helpful');
    showFeedbackConfirm('Thanks for the positive feedback!');
  });

  // Thumbs-down: record a negative rating for the current recommendation
  document.getElementById('thumbsDownBtn').addEventListener('click', async () => {
    if (!recommendedTool) return;
    await saveFeedback(recommendedTool.name, 'notHelpful');
    showFeedbackConfirm('Your feedback is appreciated!');
  });

  // Show the prompt builder panel 
  promptBuilderBtn.addEventListener('click', () => {
    promptBuilderSection.classList.remove('hidden');
    templateSelection.classList.remove('hidden');
    // Reset builder to the template selection
    templateForm.classList.add('hidden');
    generatedPromptSection.classList.add('hidden');
    // Scroll the builder into view smoothly
    promptBuilderSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  // Show the prompt builder panel (triggered from the "no tool found" fallback section)
  openPromptBuilderBtn.addEventListener('click', () => {
    promptBuilderSection.classList.remove('hidden');
    templateSelection.classList.remove('hidden');
    templateForm.classList.add('hidden');
    generatedPromptSection.classList.add('hidden');
    promptBuilderSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  // Fallback: open ChatGPT with the task pre-filled in the query string
  useGeneralBtn.addEventListener('click', () => {
    const task = taskInput.value.trim();
    if (task) {
      const encodedTask = encodeURIComponent(task);
      chrome.tabs.create({
        url: `https://chat.openai.com/?q=${encodedTask}`
      });
    }
    window.close();
  });

  // Autosave the task text as the user types so it's never lost on popup close
  taskInput.addEventListener('input', function() {
    saveTask(this.value);
  });


  // Prompt Builder ─────────────────────────────────────────────────────────

  // Template definitions — generatePrompt() assembles the final prompt string from the user's form data
  const templates = {
    detailed: {
      title: "Detailed Instruction Template",
      description: "Perfect for complex tasks requiring specific details and structure.",
      fields: [
        {
          id: "objective",
          label: "Main Objective",
          placeholder: "What is the primary goal?",
          required: true
        },
        {
          id: "course",
          label: "Faculty/Course Studying",
          placeholder: "Computer science, humanities, law...",
          required: true
        },
        {
          id: "year",
          label: "What year of study are you in?",
          placeholder: "First year, masters, phd...",
          required: true
        },
        {
          id: "requirements",
          label: "Specific Requirements",
          placeholder: "List all specific requirements...",
          type: "textarea",
          required: true
        },
        {
          id: "format",
          label: "Desired Format",
          placeholder: "Bullet points, paragraphs, steps...",
          required: false
        },
        {
          id: "tone",
          label: "Tone/Style",
          placeholder: "Professional, casual, academic...",
          required: false
        }
      ],
      generatePrompt: (data) => {
        let prompt = `Objective: ${data.objective}\n\n`;
        prompt += `For a student studying: ${data.course}\n\n`;
        prompt += `In their: ${data.year} studies\n\n`;
        prompt += `Requirements:\n${data.requirements}\n\n`;
        if (data.format) prompt += `Format: ${data.format}\n`;
        if (data.tone) prompt += `Tone: ${data.tone}\n`;
        prompt += `\nPlease provide a comprehensive response addressing all requirements.`;
        return prompt;
      }
    },
    creative: {
      title: "Creative Generation Template",
      description: "Artistic, writing, or creative content generation.",
      fields: [
        {
          id: "concept",
          label: "Main Concept/Idea",
          placeholder: "Describe the main idea...",
          required: true
        },
        {
          id: "course",
          label: "Faculty/Course Studying",
          placeholder: "Computer science, humanities, law...",
          required: true
        },{
          id: "year",
          label: "What year of study are you in?",
          placeholder: "First year, masters, phd...",
          required: true
        },
        {
          id: "style",
          label: "Style/Genre",
          placeholder: "Fantasy, sci-fi, realistic, poetic...",
          required: true
        },
        {
          id: "elements",
          label: "Key Elements",
          placeholder: "List important elements to include...",
          type: "textarea",
          required: false
        },
        {
          id: "length",
          label: "Desired Length",
          placeholder: "Short, medium, detailed...",
          required: false
        }
      ],
      generatePrompt: (data) => {
        let prompt = `Concept: ${data.concept}\n\n`;
        prompt += `Style: ${data.style}\n\n`;
        prompt += `For a student studying: ${data.course}\n\n`;
        prompt += `In their: ${data.year} studies\n\n`;
        if (data.elements) prompt += `Key Elements:\n${data.elements}\n\n`;
        if (data.length) prompt += `Length: ${data.length}\n\n`;
        prompt += `Please create something imaginative and engaging.`;
        return prompt;
      }
    },
    technical: {
      title: "Technical/Code Template",
      description: "Programming, analysis, or technical explanations.",
      fields: [
        {
          id: "problem",
          label: "Problem Statement",
          placeholder: "Describe the technical problem...",
          type: "textarea",
          required: true
        },
        {
          id: "course",
          label: "Faculty/Course Studying",
          placeholder: "Computer science, humanities, law...",
          required: true
        },{
          id: "year",
          label: "What year of study are you in?",
          placeholder: "First year, masters, phd...",
          required: true
        },
        {
          id: "language",
          label: "Programming Language/Tools",
          placeholder: "Python, JavaScript, SQL...",
          required: true
        },
        {
          id: "constraints",
          label: "Constraints/Limitations",
          placeholder: "Any specific constraints?",
          required: false
        },
        {
          id: "explanation",
          label: "Explanation Level",
          placeholder: "Beginner, intermediate, expert...",
          required: false
        }
      ],
      generatePrompt: (data) => {
        let prompt = `Problem:\n${data.problem}\n\n`;
        prompt += `For a student studying: ${data.course}\n\n`;
        prompt += `In their: ${data.year} studies\n\n`;
        prompt += `Language/Tools: ${data.language}\n\n`;
        if (data.constraints) prompt += `Constraints: ${data.constraints}\n`;
        if (data.explanation) prompt += `Explanation Level: ${data.explanation}\n`;
        prompt += `\nPlease provide a clear, well-explained solution.`;
        return prompt;
      }
    },
    simple: {
      title: "Simple Request Template",
      description: "For straightforward tasks without many details.",
      fields: [
        {
          id: "request",
          label: "Your Request Explained:",
          placeholder: "What do you need?",
          type: "textarea",
          required: true
        },
        {
          id: "course",
          label: "Faculty/Course Studying",
          placeholder: "Computer science, humanities, law...",
          required: true
        },{
          id: "year",
          label: "What year of study are you in?",
          placeholder: "First year, masters, phd...",
          required: true
        },
        {
          id: "extra",
          label: "Additional Context (Optional)",
          placeholder: "Any extra information?",
          type: "textarea",
          required: false
        }
      ],
      generatePrompt: (data) => {
        let prompt = `Request: ${data.request}\n\n`;
        prompt += `For a student studying: ${data.course}\n\n`;
        prompt += `In their: ${data.year} studies\n\n`;
        if (data.extra) prompt += `Additional Context:\n${data.extra}\n\n`;
        prompt += `Please provide a helpful response.`;
        return prompt;
      }
    },
    image: {
      title: "Image Generation",
      description: "Create detailed prompts for AI image generation.",
      fields: [
        {
          id: "idea",
          label: "Main Concept/Idea",
          placeholder: "Describe the main idea...",
          type: "textarea",
          required: true
        },
        {
          id: "course",
          label: "Faculty/Course Studying",
          placeholder: "Computer science, humanities, law...",
          required: true
        },{
          id: "year",
          label: "What year of study are you in?",
          placeholder: "First year, masters, phd...",
          required: true
        },
        {
          id: "style",
          label: "Art Style",
          placeholder: "Digital art, oil painting, anime...",
          required: true
        },
        {
          id: "details",
          label: "Additional Details",
          placeholder: "Flying over mountains at sunset...",
          required: false
        },
        {
          id: "quality",
          label: "Quality Specifics",
          placeholder: "8K, ultra detailed, photorealistic...",
          required: false
        }
      ],
      generatePrompt: (data) => {
        let prompt = `Idea: ${data.idea}\n\n`;
        prompt += `For a student studying: ${data.course}\n\n`;
        prompt += `In their: ${data.year} studies\n\n`;
        prompt += `Art style: ${data.style}\n\n`;
        prompt += `Additional details: ${data.details}\n\n`;
        if (data.quality) prompt += `Image Quality:\n${data.quality}\n\n`;
        prompt += `Please provide an image that reflects the specifications and conditions provided.`;
        return prompt;
      }
    },
    code: {
      title: "Code Explanation",
      description: "Get explanations for code snippets.",
      fields: [
        {
          id: "description",
          label: "Description",
          placeholder: "Describe the desired outcome...",
          type: "textarea",
          required: true
        },
        {
          id: "course",
          label: "Faculty/Course Studying",
          placeholder: "Computer science, humanities, law...",
          required: true
        },{
          id: "year",
          label: "What year of study are you in?",
          placeholder: "First year, masters, phd...",
          required: true
        },
        {
          id: "language",
          label: "Specify Programming Language/Tools",
          placeholder: "Python, JavaScript, SQL, C++...",
          required: true
        },
        {
          id: "code",
          label: "Code Snippet",
          placeholder: "Paste your code here as text.",
          required: false
        },
        {
          id: "level",
          label: "Explanation Level",
          placeholder: "Beginner, intermediate, expert...",
          required: false
        }
      ],
      generatePrompt: (data) => {
        let prompt = `Description:\n${data.description}\n\n`;
        prompt += `For a student studying: ${data.course}\n\n`;
        prompt += `In their: ${data.year} studies\n\n`;
        prompt += `Language/Tools: ${data.language}\n\n`;
        prompt += `Code: ${data.code}\n\n\n`;
        if (data.level) prompt += `Explanation Level: ${data.level}\n`;
        prompt += `\nPlease provide a clear, well-structured explanation of the code provided.`;
        return prompt;
      }
    },
    rewrite: {
      title: "Content Rewriting",
      description: "Rewrite or improve existing text.",
      fields: [
        {
          id: "context",
          label: "Context",
          placeholder: "Describe the desired task...",
          type: "textarea",
          required: true
        },
        {
          id: "course",
          label: "Faculty/Course Studying",
          placeholder: "Computer science, humanities, law...",
          required: true
        },{
          id: "year",
          label: "What year of study are you in?",
          placeholder: "First year, masters, phd...",
          required: true
        },
        {
          id: "original",
          label: "Original Text",
          placeholder: "Paste the text you want to improve here.",
          required: true
        },
        {
          id: "tone",
          label: "Desired Tone",
          placeholder: "Professional, casual, persuasive...",
          required: false
        },
        {
          id: "purpose",
          label: "Purpose",
          placeholder: "Email, blog post, social media...",
          required: false
        }
      ],
      generatePrompt: (data) => {
        let prompt = `Context:\n${data.context}\n\n`;
        prompt += `For a student studying: ${data.course}\n\n`;
        prompt += `In their: ${data.year} studies\n\n`;
        prompt += `Original text: ${data.original}\n\n`;
        prompt += `Tone: ${data.tone}\n`;
        if (data.purpose) prompt += `Purpose: ${data.purpose}\n`;
        prompt += `\nPlease provide an improved revision of this text considering the specifications provided.`;
        return prompt;
      }
    },
    summarise: {
      title: "Research Summary",
      description: "Summarise research papers or articles.",
      fields: [
        {
          id: "task",
          label: "Task Desired",
          placeholder: "Describe the main intention...",
          required: true
        },
        {
          id: "course",
          label: "Faculty/Course Studying",
          placeholder: "Computer science, humanities, law...",
          required: true
        },{
          id: "year",
          label: "What year of study are you in?",
          placeholder: "First year, masters, phd...",
          required: true
        },
        {
          id: "topic",
          label: "Research Topic",
          placeholder: "Explain the topic to focus on and highlight.",
          required: true
        },
        {
          id: "sources",
          label: "Key Sources/Findings",
          placeholder: "List or describe the main sources.",
          type: "textarea",
          required: false
        },
        {
          id: "length",
          label: "Summary Length",
          placeholder: "Brief, bullet points, detailed, comprehensive...",
          required: false
        }
      ],
      generatePrompt: (data) => {
        let prompt = `Task Desired: ${data.task}\n\n`;
        prompt += `For a student studying: ${data.course}\n\n`;
        prompt += `In their: ${data.year} studies\n\n`;
        prompt += `Main topic: ${data.topic}\n\n`;
        if (data.sources) prompt += `Key Sources/Findings:\n${data.sources}\n\n`;
        if (data.length) prompt += `Length: ${data.length}\n\n`;
        prompt += `Please summaries the sources provided in the manner described.`;
        return prompt;
      }
    }
  };

  // Attach a click to every template card in the grid
  document.querySelectorAll('.template-option').forEach(option => {
    option.addEventListener('click', function() {
      // Remove the highlight from whichever card was previously selected
      document.querySelectorAll('.template-option').forEach(opt => {
        opt.classList.remove('selected');
      });

      // Highlight the clicked card
      this.classList.add('selected');
      selectedTemplate = this.dataset.template;

      // Brief pause so the highlight is visible before switching to the form view
      setTimeout(() => {
        openTemplateForm(selectedTemplate);
      }, 300);
    });
  });

  // Renders the input form for the selected template and pre-fills with the task and saved profile
  async function openTemplateForm(templateId) {
    const template = templates[templateId];
    if (!template) return;

    selectedTemplate = templateId;
    templateTitle.textContent = template.title;
    templateDescription.textContent = template.description;

    // Render each field defined in the template as either an input or textarea
    templateFields.innerHTML = template.fields.map(field => `
      <div class="field-group">
        <label>${field.label}${field.required ? ' *' : ''}</label>
        ${field.type === 'textarea' ?
          `<textarea id="field-${field.id}"
                    placeholder="${field.placeholder}"
                    data-id="${field.id}"
                    ${field.required ? 'required' : ''}></textarea>` :
          `<input type="text" id="field-${field.id}"
                 placeholder="${field.placeholder}"
                 data-id="${field.id}"
                 ${field.required ? 'required' : ''}>`}
      </div>
    `).join('');

    // Pre-fill the first field with the task the user already typed
    const task = taskInput.value.trim();
    if (task) {
      const firstField = templateFields.querySelector('textarea, input');
      if (firstField && !firstField.value) {
        firstField.value = task;
      }
    }

    // Pre-fill course and year from the saved user profile if available
    const profile = await loadUserProfile();
    const courseField = document.getElementById('field-course');
    const yearField   = document.getElementById('field-year');
    if (profile.course && courseField && !courseField.value) courseField.value = profile.course;
    if (profile.year   && yearField   && !yearField.value)   yearField.value   = profile.year;

    // Switch to form view — hide template grid, show the form
    templateSelection.classList.add('hidden');
    templateForm.classList.remove('hidden');
    generatedPromptSection.classList.add('hidden');
  }

  // Go back to the template grid without losing the task text
  backToTemplatesBtn.addEventListener('click', () => {
    templateForm.classList.add('hidden');
    generatedPromptSection.classList.add('hidden');
    templateSelection.classList.remove('hidden');
    selectedTemplate = null;  // clear selection to pick different template
  });

  // Validate the form and build the final prompt string
  generatePromptBtn.addEventListener('click', () => {
    if (!selectedTemplate) return;

    formData = {};
    const template = templates[selectedTemplate];

    // Check all required fields are filled in
    let hasErrors = false;
    template.fields.forEach(field => {
      const input = document.getElementById(`field-${field.id}`);
      if (input) {
        const value = input.value.trim();
        formData[field.id] = value;

        if (field.required && !value) {
          input.style.borderColor = 'red';  // highlight the missing field in red
          hasErrors = true;
        } else {
          input.style.borderColor = '';  // reset colour if the field is now filled
        }
      }
    });

    if (hasErrors) {
      showStatus('Please fill in all required fields.', 'error');
      return;
    }

    // Persist course/year so future prompt builder sessions pre-fill automatically
    saveUserProfile(formData.course, formData.year);

    // Call the template's generatePrompt function to build the final text
    const task = taskInput.value.trim();
    currentGeneratedPrompt = template.generatePrompt(formData, task);
    finalPrompt.textContent = currentGeneratedPrompt;

    // Show the generated prompt panel and scrollable view
    templateForm.classList.add('hidden');
    generatedPromptSection.classList.remove('hidden');
    generatedPromptSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  // Copy the generated prompt to the clipboard
  copyPromptBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(currentGeneratedPrompt);
      copyStatus.textContent = 'Prompt copied to clipboard!';
      copyStatus.className = 'status success small';
      copyStatus.classList.remove('hidden');

      // Hide the confirmation after 3 seconds
      setTimeout(() => {
        copyStatus.classList.add('hidden');
      }, 3000);
    } catch (error) {
      // If copy fails, ask the user to copy manually
      copyStatus.textContent = 'Failed to copy. Please copy manually.';
      copyStatus.className = 'status error small';
      copyStatus.classList.remove('hidden');
    }
  });

  // Go back to the form so the user can change their answers
  editPromptBtn.addEventListener('click', () => {
    generatedPromptSection.classList.add('hidden');
    templateForm.classList.remove('hidden');
  });

  // Collapse entire prompt builder panel
  closePromptBuilder.addEventListener('click', () => {
    promptBuilderSection.classList.add('hidden');
  });

});

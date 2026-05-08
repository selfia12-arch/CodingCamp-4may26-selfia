/* js/app.js — To-Do Life Dashboard application logic */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  const STORAGE_KEYS = {
    tasks:         'tld_tasks',
    links:         'tld_links',
    theme:         'tld_theme',
    userName:      'tld_user_name',
    timerSettings: 'tld_timer_settings'
  };

  // Default Pomodoro durations (minutes)
  var timerFocusMin      = 25;
  var timerShortBreakMin = 5;
  var timerLongBreakMin  = 15;

  // Derived from timerFocusMin; updated when settings change
  var TIMER_DURATION = timerFocusMin * 60;

  // ── Utilities ──────────────────────────────────────────────────────────────

  /**
   * Pads a single-digit number with a leading zero.
   * @param {number} n
   * @returns {string}
   */
  function padTwo(n) {
    return String(n).padStart(2, '0');
  }

  /**
   * Formats hours and minutes as "HH:MM".
   * @param {number} h - hours (0–23)
   * @param {number} m - minutes (0–59)
   * @returns {string}
   */
  function formatTime(h, m) {
    return padTwo(h) + ':' + padTwo(m);
  }

  /**
   * Formats a Date object as a human-readable string,
   * e.g. "Monday, July 14, 2025".
   * @param {Date} date
   * @returns {string}
   */
  function formatDate(date) {
    try {
      return new Intl.DateTimeFormat('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }).format(date);
    } catch (_) {
      // Fallback for environments without Intl support
      var days   = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
      var months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
      return days[date.getDay()] + ', ' +
             months[date.getMonth()] + ' ' +
             date.getDate() + ', ' +
             date.getFullYear();
    }
  }

  /**
   * Returns a time-of-day greeting based on the given hour (0–23).
   *   05–11 → "Good morning"
   *   12–17 → "Good afternoon"
   *   18–20 → "Good evening"
   *   21–04 → "Good night"
   * @param {number} hour
   * @returns {string}
   */
  function getGreeting(hour) {
    if (hour >= 5  && hour < 12) return 'Good morning';
    if (hour >= 12 && hour < 18) return 'Good afternoon';
    if (hour >= 18 && hour < 21) return 'Good evening';
    return 'Good night';
  }

  /**
   * Trims leading and trailing whitespace from a string.
   * @param {string} str
   * @returns {string}
   */
  function sanitizeText(str) {
    return str.trim();
  }

  /**
   * Generates a collision-resistant unique ID.
   * Uses crypto.randomUUID() when available; falls back to a
   * timestamp + random string combination.
   * @returns {string}
   */
  function generateId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).slice(2);
  }

  /**
   * Loads and parses a JSON array from localStorage.
   * Returns an empty array if the key is absent or the data is corrupt.
   * @param {string} key
   * @returns {Array}
   */
  function loadFromStorage(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : [];
    } catch (_) {
      return [];
    }
  }

  /**
   * Serialises data to JSON and writes it to localStorage.
   * Fails silently if localStorage is unavailable or full.
   * @param {string} key
   * @param {*} data
   */
  function saveToStorage(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (_) {
      // localStorage unavailable or quota exceeded — continue without persistence
    }
  }

  // ── Greeting Widget ────────────────────────────────────────────────────────

  /** The user's custom name, or empty string if not set. */
  var userName = '';

  /**
   * Reads the current time and date, then updates the greeting widget DOM nodes.
   */
  function renderGreeting() {
    var now     = new Date();
    var hours   = now.getHours();
    var minutes = now.getMinutes();

    var timeStr     = formatTime(hours, minutes);
    var greetingStr = getGreeting(hours);
    var dateStr     = formatDate(now);

    // Append name if set
    var displayGreeting = userName
      ? greetingStr + ', ' + userName + '!'
      : greetingStr;

    document.querySelector('.greeting-text').textContent = displayGreeting;
    document.querySelector('.greeting-time').textContent = timeStr;
    document.querySelector('.greeting-date').textContent = dateStr;
  }

  /**
   * Shows the inline name-edit form and hides the edit button.
   */
  function openNameForm() {
    var form  = document.getElementById('greeting-name-form');
    var input = document.getElementById('greeting-name-input');
    input.value = userName;
    form.removeAttribute('hidden');
    input.focus();
    input.select();
  }

  /**
   * Hides the inline name-edit form.
   */
  function closeNameForm() {
    document.getElementById('greeting-name-form').setAttribute('hidden', '');
  }

  /**
   * Saves the custom name from the input, persists it, and re-renders.
   */
  function saveName() {
    var input = document.getElementById('greeting-name-input');
    userName = sanitizeText(input.value);
    try {
      localStorage.setItem(STORAGE_KEYS.userName, userName);
    } catch (_) {}
    closeNameForm();
    renderGreeting();
  }

  /**
   * Initialises the greeting widget: loads saved name, renders immediately,
   * then refreshes every 60 seconds so the displayed time stays current.
   */
  function initGreeting() {
    // Load saved name
    try {
      userName = localStorage.getItem(STORAGE_KEYS.userName) || '';
    } catch (_) {
      userName = '';
    }

    renderGreeting();
    setInterval(renderGreeting, 60000);

    // Wire up name-edit controls
    document.getElementById('greeting-edit-btn').addEventListener('click', openNameForm);
    document.getElementById('greeting-name-save').addEventListener('click', saveName);
    document.getElementById('greeting-name-cancel').addEventListener('click', closeNameForm);

    document.getElementById('greeting-name-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter')  saveName();
      if (e.key === 'Escape') closeNameForm();
    });
  }

  // ── Focus Timer ───────────────────────────────────────────────────────────

  /** setInterval handle; null when the timer is not running. */
  var timerInterval = null;

  /** Remaining seconds on the countdown. */
  var timerSeconds = TIMER_DURATION;

  /** True while the countdown is actively ticking. */
  var timerRunning = false;

  /**
   * Loads timer settings from localStorage and applies them.
   * Falls back to defaults (25 / 5 / 15) if absent or corrupt.
   */
  function loadTimerSettings() {
    try {
      var raw = localStorage.getItem(STORAGE_KEYS.timerSettings);
      if (raw) {
        var s = JSON.parse(raw);
        if (s.focus      >= 1 && s.focus      <= 180) timerFocusMin      = s.focus;
        if (s.shortBreak >= 1 && s.shortBreak <= 180) timerShortBreakMin = s.shortBreak;
        if (s.longBreak  >= 1 && s.longBreak  <= 180) timerLongBreakMin  = s.longBreak;
      }
    } catch (_) {}
    TIMER_DURATION = timerFocusMin * 60;
    timerSeconds   = TIMER_DURATION;
  }

  /**
   * Validates a timer input value: must be a whole number 1–180.
   * @param {string|number} value
   * @returns {boolean}
   */
  function validateTimerInput(value) {
    var n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= 180;
  }

  /**
   * Opens the settings panel and pre-populates inputs with current durations.
   */
  function openTimerSettings() {
    var panel = document.getElementById('timer-settings-panel');
    var btn   = document.getElementById('timer-settings-btn');
    document.getElementById('settings-focus').value = timerFocusMin;
    document.getElementById('settings-short').value = timerShortBreakMin;
    document.getElementById('settings-long').value  = timerLongBreakMin;
    // Clear any previous errors
    ['settings-focus-error', 'settings-short-error', 'settings-long-error'].forEach(function (id) {
      document.getElementById(id).textContent = '';
    });
    ['settings-focus', 'settings-short', 'settings-long'].forEach(function (id) {
      document.getElementById(id).removeAttribute('aria-invalid');
    });
    panel.removeAttribute('hidden');
    btn.setAttribute('aria-expanded', 'true');
    document.getElementById('settings-focus').focus();
  }

  /**
   * Closes the settings panel without saving.
   */
  function closeTimerSettings() {
    document.getElementById('timer-settings-panel').setAttribute('hidden', '');
    document.getElementById('timer-settings-btn').setAttribute('aria-expanded', 'false');
  }

  /**
   * Validates and saves timer settings. Shows inline errors on failure.
   */
  function saveTimerSettings() {
    var focusVal = document.getElementById('settings-focus').value;
    var shortVal = document.getElementById('settings-short').value;
    var longVal  = document.getElementById('settings-long').value;

    var focusErr = document.getElementById('settings-focus-error');
    var shortErr = document.getElementById('settings-short-error');
    var longErr  = document.getElementById('settings-long-error');
    var focusIn  = document.getElementById('settings-focus');
    var shortIn  = document.getElementById('settings-short');
    var longIn   = document.getElementById('settings-long');

    var valid = true;

    if (!validateTimerInput(focusVal)) {
      focusErr.textContent = 'Enter a whole number between 1 and 180.';
      focusIn.setAttribute('aria-invalid', 'true');
      valid = false;
    } else {
      focusErr.textContent = '';
      focusIn.removeAttribute('aria-invalid');
    }

    if (!validateTimerInput(shortVal)) {
      shortErr.textContent = 'Enter a whole number between 1 and 180.';
      shortIn.setAttribute('aria-invalid', 'true');
      valid = false;
    } else {
      shortErr.textContent = '';
      shortIn.removeAttribute('aria-invalid');
    }

    if (!validateTimerInput(longVal)) {
      longErr.textContent = 'Enter a whole number between 1 and 180.';
      longIn.setAttribute('aria-invalid', 'true');
      valid = false;
    } else {
      longErr.textContent = '';
      longIn.removeAttribute('aria-invalid');
    }

    if (!valid) return;

    timerFocusMin      = Number(focusVal);
    timerShortBreakMin = Number(shortVal);
    timerLongBreakMin  = Number(longVal);
    TIMER_DURATION     = timerFocusMin * 60;

    try {
      localStorage.setItem(STORAGE_KEYS.timerSettings, JSON.stringify({
        focus:      timerFocusMin,
        shortBreak: timerShortBreakMin,
        longBreak:  timerLongBreakMin
      }));
    } catch (_) {}

    // If timer is not running, reset to new focus duration
    if (!timerRunning) {
      timerSeconds = TIMER_DURATION;
      renderTimer(timerSeconds);
    }

    closeTimerSettings();
  }

  /**
   * Syncs the enabled/disabled state of the three timer buttons to the
   * current timerRunning / timerSeconds state.
   */
  function updateTimerButtons() {
    var btnStart = document.getElementById('timer-start');
    var btnStop  = document.getElementById('timer-stop');
    var btnReset = document.getElementById('timer-reset');

    if (timerRunning) {
      btnStart.disabled = true;
      btnStop.disabled  = false;
      btnReset.disabled = false;
    } else if (timerSeconds === 0) {
      btnStart.disabled = true;
      btnStop.disabled  = true;
      btnReset.disabled = false;
    } else {
      btnStart.disabled = false;
      btnStop.disabled  = true;
      btnReset.disabled = false;
    }
  }

  /**
   * Updates the #timer-display element with the formatted MM:SS string.
   * @param {number} seconds
   */
  function renderTimer(seconds) {
    var mins = Math.floor(seconds / 60);
    var secs = seconds % 60;
    var display = document.getElementById('timer-display');

    display.textContent = padTwo(mins) + ':' + padTwo(secs);

    if (seconds === 0) {
      display.classList.add('timer--finished');
    } else {
      display.classList.remove('timer--finished');
    }

    updateTimerButtons();
  }

  /**
   * Called by setInterval every 1000 ms while the timer is running.
   */
  function tickTimer() {
    timerSeconds -= 1;
    if (timerSeconds <= 0) {
      timerSeconds = 0;
      clearInterval(timerInterval);
      timerInterval = null;
      timerRunning  = false;
    }
    renderTimer(timerSeconds);
  }

  /**
   * Starts the countdown from the current timerSeconds value.
   */
  function startTimer() {
    if (timerRunning) return;
    timerRunning  = true;
    timerInterval = setInterval(tickTimer, 1000);
    renderTimer(timerSeconds);
  }

  /**
   * Pauses the countdown, retaining the current remaining time.
   */
  function stopTimer() {
    if (!timerRunning) return;
    clearInterval(timerInterval);
    timerInterval = null;
    timerRunning  = false;
    renderTimer(timerSeconds);
  }

  /**
   * Stops any active countdown and restores the display to the focus duration.
   */
  function resetTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    timerRunning  = false;
    timerSeconds  = TIMER_DURATION;
    renderTimer(timerSeconds);
  }

  /**
   * Wires up timer button click listeners, settings panel, and renders initial display.
   */
  function initTimer() {
    loadTimerSettings();

    document.getElementById('timer-start').addEventListener('click', startTimer);
    document.getElementById('timer-stop').addEventListener('click', stopTimer);
    document.getElementById('timer-reset').addEventListener('click', resetTimer);

    document.getElementById('timer-settings-btn').addEventListener('click', function () {
      var panel = document.getElementById('timer-settings-panel');
      if (panel.hasAttribute('hidden')) {
        openTimerSettings();
      } else {
        closeTimerSettings();
      }
    });

    document.getElementById('settings-save-btn').addEventListener('click', saveTimerSettings);
    document.getElementById('settings-cancel-btn').addEventListener('click', closeTimerSettings);

    renderTimer(timerSeconds);
  }

  // ── Task Manager ──────────────────────────────────────────────────────────

  /** In-memory array of task objects. Kept in sync with localStorage. */
  var tasks = [];

  /**
   * Persists the current tasks array to localStorage.
   * Requirements: 3.4, 4.6, 5.3, 6.1, 6.3
   */
  function persistTasks() {
    saveToStorage(STORAGE_KEYS.tasks, tasks);
  }

  /**
   * Fully re-renders the #task-list <ul> from the in-memory tasks array.
   * Each task gets a checkbox, text span, Edit button, and Delete button.
   * Requirements: 3.2, 4.1, 5.1, 5.2, 5.4, 6.1
   */
  function renderTaskList() {
    var ul = document.getElementById('task-list');
    ul.innerHTML = '';

    if (tasks.length === 0) return;

    tasks.forEach(function (task) {
      var li = document.createElement('li');
      li.className = 'task-item';
      li.dataset.id = task.id;
      if (task.completed) {
        li.classList.add('task-item--completed');
      }

      // Checkbox
      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.className = 'task-checkbox';
      checkbox.checked = task.completed;
      checkbox.setAttribute('aria-label', 'Mark complete');

      // Task text
      var span = document.createElement('span');
      span.className = 'task-text';
      span.textContent = task.text;

      // Edit button
      var editBtn = document.createElement('button');
      editBtn.className = 'task-btn task-edit';
      editBtn.setAttribute('aria-label', 'Edit task');
      editBtn.textContent = 'Edit';

      // Delete button
      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'task-btn task-delete';
      deleteBtn.setAttribute('aria-label', 'Delete task');
      deleteBtn.textContent = 'Delete';

      li.appendChild(checkbox);
      li.appendChild(span);
      li.appendChild(editBtn);
      li.appendChild(deleteBtn);
      ul.appendChild(li);
    });
  }

  /**
   * Adds a new task with the given description.
   * Ignores empty or whitespace-only input (requirement 3.3).
   * Requirements: 3.2, 3.3, 3.4
   * @param {string} description
   */
  function addTask(description) {
    var text = sanitizeText(description);
    if (text === '') return;

    var task = {
      id: generateId(),
      text: text,
      completed: false
    };

    tasks.push(task);
    persistTasks();
    renderTaskList();
  }

  /**
   * Toggles the completed state of the task with the given id.
   * Requirements: 5.1, 5.2, 5.3
   * @param {string} id
   */
  function toggleTask(id) {
    var task = tasks.find(function (t) { return t.id === id; });
    if (!task) return;

    task.completed = !task.completed;
    persistTasks();
    renderTaskList();
  }

  /**
   * Replaces a task's display row with an inline edit field.
   * Requirements: 4.1, 4.2
   * @param {string} id
   */
  function beginEditTask(id) {
    var task = tasks.find(function (t) { return t.id === id; });
    if (!task) return;

    var li = document.querySelector('#task-list [data-id="' + id + '"]');
    if (!li) return;

    li.innerHTML = '';
    li.classList.add('task-item--editing');

    // Edit input pre-populated with current text
    var input = document.createElement('input');
    input.type = 'text';
    input.className = 'task-edit-input';
    input.value = task.text;

    // Save button
    var saveBtn = document.createElement('button');
    saveBtn.className = 'task-btn task-save';
    saveBtn.setAttribute('aria-label', 'Save edit');
    saveBtn.textContent = 'Save';

    // Cancel button
    var cancelBtn = document.createElement('button');
    cancelBtn.className = 'task-btn task-cancel';
    cancelBtn.setAttribute('aria-label', 'Cancel edit');
    cancelBtn.textContent = 'Cancel';

    li.appendChild(input);
    li.appendChild(saveBtn);
    li.appendChild(cancelBtn);

    input.focus();
  }

  /**
   * Saves the edited text for a task.
   * Retains edit mode (with focus) if the new text is empty (requirement 4.4).
   * Requirements: 4.3, 4.4, 4.6
   * @param {string} id
   * @param {string} newText
   */
  function confirmEditTask(id, newText) {
    var text = sanitizeText(newText);
    if (text === '') {
      // Retain edit mode — keep focus on the input
      var li = document.querySelector('#task-list [data-id="' + id + '"]');
      if (li) {
        var input = li.querySelector('.task-edit-input');
        if (input) input.focus();
      }
      return;
    }

    var task = tasks.find(function (t) { return t.id === id; });
    if (!task) return;

    task.text = text;
    persistTasks();
    renderTaskList();
  }

  /**
   * Cancels an in-progress edit and restores the task's display row.
   * Requirements: 4.5
   */
  function cancelEditTask() {
    renderTaskList();
  }

  /**
   * Removes the task with the given id from the list.
   * Requirements: 5.4, 5.5
   * @param {string} id
   */
  function deleteTask(id) {
    tasks = tasks.filter(function (t) { return t.id !== id; });
    persistTasks();
    renderTaskList();
  }

  /**
   * Initialises the Task Manager: loads persisted tasks, renders the list,
   * and wires up all event handlers via delegation.
   * Requirements: 6.1, 6.2, 3.1, 3.2
   */
  function initTasks() {
    // 7.11 — load from storage and render
    tasks = loadFromStorage(STORAGE_KEYS.tasks);
    renderTaskList();

    // 7.10 — task input event handlers
    var taskInput  = document.getElementById('task-input');
    var taskAddBtn = document.getElementById('task-add-btn');

    taskInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        addTask(taskInput.value);
        taskInput.value = '';
        taskInput.focus();
      }
    });

    taskAddBtn.addEventListener('click', function () {
      addTask(taskInput.value);
      taskInput.value = '';
      taskInput.focus();
    });

    // 7.9 — delegated click handler on the task list
    var taskList = document.getElementById('task-list');

    taskList.addEventListener('click', function (e) {
      var item = e.target.closest('.task-item');
      if (!item) return;
      var id = item.dataset.id;

      if (e.target.classList.contains('task-checkbox')) {
        toggleTask(id);
      } else if (e.target.classList.contains('task-edit')) {
        beginEditTask(id);
      } else if (e.target.classList.contains('task-save')) {
        var editInput = item.querySelector('.task-edit-input');
        confirmEditTask(id, editInput ? editInput.value : '');
      } else if (e.target.classList.contains('task-cancel')) {
        cancelEditTask(id);
      } else if (e.target.classList.contains('task-delete')) {
        deleteTask(id);
      }
    });

    // 7.9 — delegated keydown handler for Enter/Escape in edit inputs
    taskList.addEventListener('keydown', function (e) {
      var input = e.target.closest('.task-edit-input');
      if (!input) return;
      var item = input.closest('.task-item');
      if (!item) return;
      var id = item.dataset.id;

      if (e.key === 'Enter')  confirmEditTask(id, input.value);
      if (e.key === 'Escape') cancelEditTask(id);
    });
  }

  // ── Quick Links ───────────────────────────────────────────────────────────

  /** In-memory array of link objects. Kept in sync with localStorage. */
  var links = [];

  /**
   * Persists the current links array to localStorage.
   * Requirements: 7.2, 7.6, 8.1, 8.3
   */
  function persistLinks() {
    saveToStorage(STORAGE_KEYS.links, links);
  }

  /**
   * Fully re-renders the #links-list div from the in-memory links array.
   * Each link gets an anchor button and a Delete button.
   * Requirements: 7.4, 7.5, 8.1
   */
  function renderLinkList() {
    var container = document.getElementById('links-list');
    container.innerHTML = '';

    if (links.length === 0) return;

    links.forEach(function (link) {
      var div = document.createElement('div');
      div.className = 'link-item';
      div.dataset.id = link.id;

      // Anchor button that opens the URL in a new tab
      var anchor = document.createElement('a');
      anchor.className = 'link-btn';
      anchor.href = link.url;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.textContent = link.label;

      // Delete button
      var deleteBtn = document.createElement('button');
      deleteBtn.className = 'link-delete';
      deleteBtn.setAttribute('aria-label', 'Delete link');
      deleteBtn.textContent = '×';

      div.appendChild(anchor);
      div.appendChild(deleteBtn);
      container.appendChild(div);
    });
  }

  /**
   * Adds a new link with the given label and URL.
   * Validates that both fields are non-empty after trimming (requirement 7.3).
   * Returns true on success, false if validation fails.
   * Requirements: 7.1, 7.2, 7.3
   * @param {string} label
   * @param {string} url
   * @returns {boolean}
   */
  function addLink(label, url) {
    var sanitizedLabel = sanitizeText(label);
    var sanitizedUrl   = sanitizeText(url);

    var labelInput = document.getElementById('link-label-input');
    var urlInput   = document.getElementById('link-url-input');

    // Clear any previous validation state
    labelInput.removeAttribute('aria-invalid');
    urlInput.removeAttribute('aria-invalid');

    if (sanitizedLabel === '') {
      labelInput.setAttribute('aria-invalid', 'true');
      return false;
    }

    if (sanitizedUrl === '') {
      urlInput.setAttribute('aria-invalid', 'true');
      return false;
    }

    var link = {
      id:    generateId(),
      label: sanitizedLabel,
      url:   sanitizedUrl
    };

    links.push(link);
    persistLinks();
    renderLinkList();
    return true;
  }

  /**
   * Removes the link with the given id from the list.
   * Requirements: 7.5, 7.6
   * @param {string} id
   */
  function deleteLink(id) {
    links = links.filter(function (l) { return l.id !== id; });
    persistLinks();
    renderLinkList();
  }

  /**
   * Initialises the Quick Links widget: loads persisted links, renders the
   * list, and wires up all event handlers.
   * Requirements: 8.1, 8.2
   */
  function initLinks() {
    // 8.7 — load from storage and render
    links = loadFromStorage(STORAGE_KEYS.links);
    renderLinkList();

    // 8.6 — link add button event handler
    var labelInput = document.getElementById('link-label-input');
    var urlInput   = document.getElementById('link-url-input');
    var addBtn     = document.getElementById('link-add-btn');

    addBtn.addEventListener('click', function () {
      var success = addLink(labelInput.value, urlInput.value);
      if (success) {
        labelInput.value = '';
        urlInput.value   = '';
        labelInput.focus();
      }
    });

    // 8.5 — delegated click handler on the links list
    var linksList = document.getElementById('links-list');

    linksList.addEventListener('click', function (e) {
      if (e.target.classList.contains('link-delete')) {
        var item = e.target.closest('.link-item');
        if (item) {
          deleteLink(item.dataset.id);
        }
      }
    });
  }

  // ── Theme Toggle ──────────────────────────────────────────────────────────

  /** Current theme: 'dark' (default) or 'light'. */
  var currentTheme = 'dark';

  /**
   * Applies the given theme to the document root and updates the toggle button icon.
   * @param {string} theme - 'dark' or 'light'
   */
  function applyTheme(theme) {
    currentTheme = theme;
    var root = document.documentElement;
    var btn  = document.getElementById('theme-toggle');
    var icon = btn ? btn.querySelector('.theme-icon') : null;

    if (theme === 'light') {
      root.setAttribute('data-theme', 'light');
      if (icon) icon.textContent = '☀️';
      if (btn)  btn.setAttribute('aria-label', 'Switch to dark mode');
    } else {
      root.removeAttribute('data-theme');
      if (icon) icon.textContent = '🌙';
      if (btn)  btn.setAttribute('aria-label', 'Switch to light mode');
    }
  }

  /**
   * Toggles between light and dark themes and persists the choice.
   */
  function toggleTheme() {
    var next = currentTheme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    try {
      localStorage.setItem(STORAGE_KEYS.theme, next);
    } catch (_) {}
  }

  /**
   * Initialises the theme: loads saved preference (or system preference),
   * applies it, and wires up the toggle button.
   */
  function initTheme() {
    var saved = null;
    try {
      saved = localStorage.getItem(STORAGE_KEYS.theme);
    } catch (_) {}

    var theme = saved || (
      window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
    );

    applyTheme(theme);
    document.getElementById('theme-toggle').addEventListener('click', toggleTheme);
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    initTheme();
    initGreeting();
    initTimer();
    initTasks();
    initLinks();
  });

}());

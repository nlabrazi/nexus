/**
 * task-progress.mjs
 * Manages in-flight live task progress steps for clean collapsible disclosure in the UI.
 */

/**
 * Creates a reactive-friendly progress tracker instance.
 */
export function createProgressTracker() {
  const steps = [];

  /**
   * Adds or updates a progress step.
   * Marking a new step as 'running' automatically marks previous running steps as 'done'.
   */
  function addStep(text, status = 'running', icon = '⟳') {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();

    // Deduplicate identical sequential messages
    const last = steps[steps.length - 1];
    if (last && last.text === cleanText) {
      last.status = status;
      last.icon = icon;
      return;
    }

    // Auto-complete previous running step when advancing
    if (status === 'running') {
      for (const s of steps) {
        if (s.status === 'running') {
          s.status = 'done';
          s.icon = '✓';
        }
      }
    }

    steps.push({
      text: cleanText,
      status,
      icon,
      timestamp: Date.now(),
    });

    // Bound in-memory history to avoid memory growth during long tasks
    if (steps.length > 20) {
      steps.shift();
    }
  }

  /**
   * Marks all in-flight steps as completed.
   */
  function complete(finalText) {
    for (const s of steps) {
      if (s.status === 'running') {
        s.status = 'done';
        s.icon = '✓';
      }
    }
    if (finalText) {
      addStep(finalText, 'done', '✓');
    }
  }

  /**
   * Marks in-flight steps as failed with an optional error description.
   */
  function fail(errorText) {
    for (const s of steps) {
      if (s.status === 'running') {
        s.status = 'failed';
        s.icon = '✕';
      }
    }
    if (errorText) {
      addStep(errorText, 'failed', '✕');
    }
  }

  /**
   * Clears all steps.
   */
  function clear() {
    steps.length = 0;
  }

  /**
   * Returns a copy of the steps array.
   */
  function getSteps() {
    return [...steps];
  }

  return {
    addStep,
    complete,
    fail,
    clear,
    getSteps,
  };
}

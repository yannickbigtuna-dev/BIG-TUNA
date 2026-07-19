'use strict';

function defaultSafeError() {
  return 'Unable to generate a verified question right now. Please try again.';
}

function createTriviaTopicPool({
  generate,
  normalize,
  clock = Date.now,
  targetSize = 10,
  maxKeys = 24,
  maxExclude = 80,
  maxHistory = 120,
  retryMs = 15_000,
  safeError = defaultSafeError,
} = {}) {
  if (typeof generate !== 'function') throw new TypeError('generate must be a function');
  if (typeof normalize !== 'function') throw new TypeError('normalize must be a function');

  const now = typeof clock === 'function'
    ? clock
    : () => clock.now();
  const inventoryTarget = Math.max(1, Number.parseInt(targetSize, 10) || 10);
  const keyLimit = Math.max(1, Number.parseInt(maxKeys, 10) || 24);
  const excludeLimit = Math.max(1, Number.parseInt(maxExclude, 10) || 80);
  const historyLimit = Math.max(1, Number.parseInt(maxHistory, 10) || 120);
  const cooldownMs = Math.max(0, Number(retryMs) || 0);
  const states = new Map();

  function poolKey(topic, difficulty) {
    return JSON.stringify([
      String(difficulty || 'any').toLowerCase(),
      String(topic || '').trim().toLowerCase(),
    ]);
  }

  function prune(protectedKey = '') {
    if (states.size <= keyLimit) return;
    const removable = [...states.entries()]
      .filter(([key, state]) => key !== protectedKey && !state.filling)
      .sort((left, right) => left[1].lastUsedAt - right[1].lastUsedAt);
    while (states.size > keyLimit && removable.length) {
      states.delete(removable.shift()[0]);
    }
  }

  function getState(topic, difficulty) {
    const key = poolKey(topic, difficulty);
    let state = states.get(key);
    if (!state) {
      state = {
        key,
        questions: [],
        seen: new Set(),
        history: [],
        filling: null,
        nextRetryAt: 0,
        lastUsedAt: now(),
        lastError: '',
      };
      states.set(key, state);
      prune(key);
    }
    state.lastUsedAt = now();
    return state;
  }

  function normalizeValue(value) {
    return normalize(value?.question || value);
  }

  function exclusionSet(exclude) {
    return new Set((Array.isArray(exclude) ? exclude : [])
      .map(normalizeValue)
      .filter(Boolean));
  }

  function generationExclusions(state, exclude) {
    const combined = [...state.history, ...(Array.isArray(exclude) ? exclude : [])];
    const unique = new Map();
    for (const item of combined) {
      const key = normalizeValue(item);
      if (!key) continue;
      unique.delete(key);
      unique.set(key, item?.question || item);
    }
    return [...unique.values()].slice(-excludeLimit);
  }

  // Claiming is synchronous: no other request can observe a returned question
  // in inventory after this function returns it.
  function claim(state, count, excluded) {
    const selected = [];
    const remaining = [];
    for (const question of state.questions) {
      const key = normalizeValue(question);
      if (!key || excluded.has(key)) continue;
      if (selected.length < count) selected.push(question);
      else remaining.push(question);
    }
    state.questions = remaining;
    return selected;
  }

  function addGenerated(state, generated) {
    let added = 0;
    for (const question of Array.isArray(generated) ? generated : []) {
      const key = normalizeValue(question);
      if (!key || state.seen.has(key)) continue;
      state.seen.add(key);
      state.history.push(question.question);
      state.questions.push(question);
      added += 1;
      if (state.questions.length >= inventoryTarget) break;
    }
    if (state.history.length > historyLimit) {
      state.history = state.history.slice(-historyLimit);
    }
    return added;
  }

  function safeMessage(error) {
    try {
      const message = safeError(error);
      if (typeof message === 'string' && message.trim()) return message.trim();
    } catch {}
    return defaultSafeError();
  }

  function startFill(state, { topic, difficulty, count, exclude }) {
    if (state.filling) return state.filling;
    if (now() < state.nextRetryAt) return null;

    const avoid = generationExclusions(state, exclude);
    let fill;
    fill = Promise.resolve()
      .then(() => generate({ topic, difficulty, count, exclude: avoid }))
      .then(generated => {
        const added = addGenerated(state, generated);
        if (!added) throw new Error('No new validated Trivia question was returned');
        state.lastError = '';
        state.nextRetryAt = 0;
        return { added };
      })
      .catch(error => {
        state.lastError = safeMessage(error);
        state.nextRetryAt = now() + cooldownMs;
        return { added: 0, error: state.lastError };
      })
      .finally(() => {
        if (state.filling === fill) state.filling = null;
        prune(state.key);
      });
    state.filling = fill;
    return fill;
  }

  function result(state, questions) {
    return {
      questions,
      error: questions.length ? '' : state.lastError,
      refillPending: !!state.filling,
      retryAfterMs: Math.max(0, state.nextRetryAt - now()),
    };
  }

  async function request({ topic = '', difficulty = 'any', count = 1, exclude = [] } = {}) {
    const wanted = Math.max(1, Math.min(inventoryTarget, Number.parseInt(count, 10) || 1));
    const state = getState(topic, difficulty);
    const excluded = exclusionSet(exclude);
    let questions = claim(state, wanted, excluded);
    if (questions.length) return result(state, questions);

    // Two fill observations are enough to handle the important waiter race:
    // after a shared fill is claimed by another request, this caller can own or
    // await one fresh fill. It then returns an empty, retriable result instead
    // of ever reusing the shared generator's raw output.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const fill = startFill(state, { topic, difficulty, count: wanted, exclude });
      if (!fill) break;
      await fill;
      questions = claim(state, wanted, excluded);
      if (questions.length) return result(state, questions);
      if (now() < state.nextRetryAt) break;
    }
    return result(state, []);
  }

  function getStatus({ topic = '', difficulty = 'any' } = {}) {
    const state = states.get(poolKey(topic, difficulty));
    if (!state) {
      return { inventorySize: 0, filling: false, retryAfterMs: 0, lastError: '' };
    }
    return {
      inventorySize: state.questions.length,
      filling: !!state.filling,
      retryAfterMs: Math.max(0, state.nextRetryAt - now()),
      lastError: state.lastError,
    };
  }

  return { request, getStatus };
}

module.exports = { createTriviaTopicPool };

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createTriviaTopicPool } = require('../lib/trivia-topic-pool');

const normalize = value => String(value || '')
  .toLowerCase()
  .replace(/\s+/g, ' ')
  .replace(/[?.!]+$/, '')
  .trim();

const question = text => ({ question: text });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('topic pool propagates requested demand and caller exclusions to generation', async () => {
  const calls = [];
  const generated = Array.from({ length: 5 }, (_, index) => question(`Space question ${index + 1}?`));
  const pool = createTriviaTopicPool({
    normalize,
    targetSize: 5,
    generate: async options => {
      calls.push(options);
      return generated;
    },
  });

  const result = await pool.request({
    topic: 'Space',
    difficulty: 'hard',
    count: 5,
    exclude: ['Previously asked question?'],
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].topic, 'Space');
  assert.equal(calls[0].difficulty, 'hard');
  assert.equal(calls[0].count, 5);
  assert.deepEqual(calls[0].exclude, ['Previously asked question?']);
  assert.deepEqual(result.questions, generated);
  assert.equal(result.error, '');
});

test('concurrent same-key requests coalesce generation and atomically claim unique questions', async () => {
  const firstFill = deferred();
  let generateCalls = 0;
  const pool = createTriviaTopicPool({
    normalize,
    targetSize: 2,
    generate: async () => {
      generateCalls++;
      if (generateCalls === 1) return firstFill.promise;
      if (generateCalls === 2) return [question('Which ocean is the smallest?')];
      throw new Error('unexpected extra generation');
    },
  });

  const firstPromise = pool.request({ topic: 'Oceans', difficulty: 'medium', count: 1, exclude: [] });
  const secondPromise = pool.request({ topic: 'Oceans', difficulty: 'medium', count: 1, exclude: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(generateCalls, 1, 'same-key misses should share one generation call');

  firstFill.resolve([question('Which ocean is the largest?')]);
  const [first, second] = await Promise.all([firstPromise, secondPromise]);
  const firstTexts = first.questions.map(item => item.question);
  const secondTexts = second.questions.map(item => item.question);

  assert.equal(generateCalls, 2, 'the waiter that loses the first atomic claim should own a fresh fill');
  assert.equal(firstTexts.length, 1);
  assert.equal(secondTexts.length, 1);
  assert.equal(new Set([...firstTexts, ...secondTexts]).size, 2);
  assert.deepEqual(firstTexts.filter(text => secondTexts.includes(text)), []);
});

test('topic pool removes normalized duplicates and never returns caller-excluded questions', async () => {
  const calls = [];
  const pool = createTriviaTopicPool({
    normalize,
    targetSize: 5,
    generate: async options => {
      calls.push(options);
      return [
        question('What is a nebula?'),
        question('What   is a nebula!'),
        question('Which planet is excluded?'),
        question('What is a pulsar?'),
      ];
    },
  });

  const result = await pool.request({
    topic: 'Astronomy',
    difficulty: 'easy',
    count: 5,
    exclude: ['Which planet is excluded?'],
  });

  assert.deepEqual(
    result.questions.map(item => normalize(item.question)),
    ['what is a nebula', 'what is a pulsar']
  );
  assert.deepEqual(calls[0].exclude, ['Which planet is excluded?']);
  assert.equal(new Set(result.questions.map(item => normalize(item.question))).size, result.questions.length);
});

test('failed generation observes retry cooldown and retries only after the fake clock advances', async () => {
  let now = 10_000;
  let generateCalls = 0;
  const pool = createTriviaTopicPool({
    normalize,
    clock: () => now,
    retryMs: 500,
    safeError: () => 'Safe fixture failure',
    generate: async () => {
      generateCalls++;
      if (generateCalls === 1) throw new Error('private upstream detail');
      return [question('Recovered question?')];
    },
  });

  const failed = await pool.request({ topic: 'Recovery', difficulty: 'any', count: 1, exclude: [] });
  assert.deepEqual(failed.questions, []);
  assert.equal(failed.error, 'Safe fixture failure');
  assert.equal(failed.retryAfterMs, 500);
  assert.equal(generateCalls, 1);
  assert.deepEqual(pool.getStatus({ topic: 'Recovery', difficulty: 'any' }), {
    inventorySize: 0,
    filling: false,
    retryAfterMs: 500,
    lastError: 'Safe fixture failure',
  });

  now += 499;
  const cooling = await pool.request({ topic: 'Recovery', difficulty: 'any', count: 1, exclude: [] });
  assert.deepEqual(cooling.questions, []);
  assert.equal(cooling.retryAfterMs, 1);
  assert.equal(generateCalls, 1, 'cooldown requests must not call the generator');

  now += 1;
  const recovered = await pool.request({ topic: 'Recovery', difficulty: 'any', count: 1, exclude: [] });
  assert.deepEqual(recovered.questions.map(item => item.question), ['Recovered question?']);
  assert.equal(recovered.error, '');
  assert.equal(recovered.retryAfterMs, 0);
  assert.equal(generateCalls, 2);
});

test('a partial successful generation is returned safely and is not invalidated by a later failure', async () => {
  let generateCalls = 0;
  const pool = createTriviaTopicPool({
    normalize,
    targetSize: 5,
    retryMs: 500,
    safeError: () => 'Refill failed safely',
    generate: async () => {
      generateCalls++;
      if (generateCalls === 1) {
        return [
          question('Partial question one?'),
          question('Partial question two?'),
        ];
      }
      throw new Error('upstream refill failure');
    },
  });

  const first = await pool.request({ topic: 'Partial', difficulty: 'hard', count: 5, exclude: [] });
  assert.deepEqual(first.questions.map(item => item.question), [
    'Partial question one?',
    'Partial question two?',
  ]);
  assert.equal(first.error, '');
  assert.equal(generateCalls, 1);

  const failed = await pool.request({ topic: 'Partial', difficulty: 'hard', count: 5, exclude: [] });
  assert.deepEqual(failed.questions, []);
  assert.equal(failed.error, 'Refill failed safely');
  assert.deepEqual(first.questions.map(item => item.question), [
    'Partial question one?',
    'Partial question two?',
  ], 'a later refill failure must not mutate questions already returned to a caller');
  const status = pool.getStatus({ topic: 'Partial', difficulty: 'hard' });
  assert.equal(status.inventorySize, 0);
  assert.equal(status.filling, false);
  assert.equal(status.lastError, 'Refill failed safely');
});

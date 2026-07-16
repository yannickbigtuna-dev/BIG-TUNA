const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTriviaFormat,
  buildTriviaMessages,
  normalizeQuestionText,
  pickTriviaModel,
  selectFallbackQuestions,
  validateTriviaQuestions,
  _test,
} = require('../lib/trivia-generator');

function assertValidQuestion(question) {
  assert.equal(typeof question.id, 'string');
  assert.ok(question.id.length > 10);
  assert.match(question.question, /\S/);
  assert.equal(question.answers.length, 4);
  assert.equal(new Set(question.answers.map(answer => answer.toLowerCase())).size, 4);
  assert.ok(Number.isInteger(question.correct));
  assert.ok(question.correct >= 0 && question.correct <= 3);
  assert.match(question.answers[question.correct], /\S/);
  assert.ok(['easy', 'medium', 'hard'].includes(question.difficulty));
}

test('the complete safety bank normalizes into valid four-answer questions', () => {
  const questions = validateTriviaQuestions(
    _test.FALLBACK_QUESTIONS,
    _test.FALLBACK_QUESTIONS.length,
    new Set()
  );
  assert.equal(questions.length, _test.FALLBACK_QUESTIONS.length);
  assert.ok(questions.length >= 200);
  questions.forEach(assertValidQuestion);
});

test('fallback selection honors requested difficulty and exclusions', () => {
  const first = selectFallbackQuestions({ difficulty: 'hard', count: 10 });
  assert.equal(first.questions.length, 10);
  first.questions.forEach(question => {
    assertValidQuestion(question);
    assert.equal(question.difficulty, 'hard');
  });

  const excluded = first.questions.map(question => question.question);
  const second = selectFallbackQuestions({
    difficulty: 'hard',
    count: 10,
    exclude: excluded,
  });
  assert.equal(second.questions.length, 10);
  const firstKeys = new Set(excluded.map(normalizeQuestionText));
  second.questions.forEach(question => {
    assert.equal(firstKeys.has(normalizeQuestionText(question.question)), false);
  });
});

test('fallback topic matching prefers relevant built-in questions', () => {
  const result = selectFallbackQuestions({
    topic: 'space astronomy',
    difficulty: 'medium',
    count: 3,
  });
  assert.equal(result.topicMatched, true);
  assert.equal(result.questions.length, 3);
  result.questions.forEach(question => {
    assert.match(
      [question.question, question.category, question.explanation].join(' ').toLowerCase(),
      /space|planet|moon|satellite|solar|astronomy/
    );
  });
});

test('compact model output aliases are accepted and shuffled safely', () => {
  const [question] = validateTriviaQuestions([{
    q: 'Which planet is closest to the Sun?',
    a: ['Mercury', 'Venus', 'Earth', 'Mars'],
    c: 0,
    g: 'Science',
    d: 'easy',
    e: 'Mercury has the smallest orbit around the Sun.',
  }], 1, new Set());

  assertValidQuestion(question);
  assert.equal(question.answers[question.correct], 'Mercury');
  assert.equal(question.category, 'Science');
  assert.equal(question.explanation, 'Mercury has the smallest orbit around the Sun.');
});

test('dedupe rejects normalized repeats', () => {
  const excluded = new Set([normalizeQuestionText('What is the capital of Canada?')]);
  const questions = validateTriviaQuestions([{
    question: 'What is the capital of Canada?!',
    answers: ['Ottawa', 'Toronto', 'Montreal', 'Vancouver'],
    correct: 0,
  }], 1, excluded);
  assert.deepEqual(questions, []);
});

test('trivia model selection prefers the dedicated small model', () => {
  const models = [
    { name: 'qwen2.5-coder:7b' },
    { name: 'llama3.1:8b' },
    { name: 'qwen2.5:1.5b' },
    { name: 'phi4-mini:latest' },
  ];
  assert.equal(pickTriviaModel(models), 'phi4-mini:latest');
  assert.equal(pickTriviaModel(models, 'llama3.1:8b'), 'llama3.1:8b');
});

test('AI prompt uses the compact schema and bounds duplicate hints', () => {
  const exclude = Array.from({ length: 30 }, (_, index) => `Old question ${index}?`);
  const messages = buildTriviaMessages('marine biology', 6, 'hard', exclude);
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /"q"/);
  assert.match(messages[0].content, /"a"/);
  assert.match(messages[1].content, /exactly 6/i);
  assert.match(messages[1].content, /marine biology/i);
  assert.match(messages[1].content, /d="hard"/);
  assert.doesNotMatch(messages[1].content, /Old question 0/);
  assert.match(messages[1].content, /Old question 29/);
});

test('structured output schema requires exactly the requested number of complete items', () => {
  const format = buildTriviaFormat(6);
  assert.equal(format.properties.questions.minItems, 6);
  assert.equal(format.properties.questions.maxItems, 6);
  assert.deepEqual(format.properties.questions.items.required, ['q', 'a', 'c', 'g', 'd', 'e']);
  assert.equal(format.properties.questions.items.properties.a.minItems, 4);
  assert.equal(format.properties.questions.items.properties.a.maxItems, 4);
});

test('placeholder answer letters are rejected', () => {
  const questions = validateTriviaQuestions([{
    q: 'Who wrote the Harry Potter books?',
    a: ['A', 'B', 'C', 'D'],
    c: 2,
    g: 'Literature',
    d: 'easy',
    e: 'J.K. Rowling wrote the series.',
  }], 1, new Set());
  assert.deepEqual(questions, []);
});

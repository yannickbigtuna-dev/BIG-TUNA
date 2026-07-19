'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const trivia = require('../lib/trivia-generator');
const bankCli = require('../scripts/generate-trivia-bank');

function sample(overrides = {}) {
  return {
    question: 'What is the capital city of France?',
    correctAnswer: 'Paris',
    incorrectAnswers: ['Lyon', 'Marseille', 'Nice'],
    category: 'Geography',
    difficulty: 'easy',
    explanation: 'Paris is the capital city of France.',
    ...overrides,
  };
}

function completedPayload(value) {
  return {
    status: 'completed',
    output: [{
      type: 'message',
      content: [{ type: 'output_text', text: JSON.stringify(value) }],
    }],
  };
}

function mockResponse(payload, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => payload };
}

test('fixed model and bank constants use GPT-5.6 Luna', () => {
  assert.equal(trivia.TRIVIA_MODEL, 'gpt-5.6-luna');
  assert.equal(trivia.TRIVIA_BANK_SIZE, 1000);
  assert.equal(trivia.TRIVIA_BANK_SCHEMA_VERSION, 1);
});

test('canonical validation sanitizes data and creates a stable id', () => {
  const value = trivia.validateCanonicalQuestion(sample({ question: '  What is the capital city of France?  ' }));
  assert.match(value.id, /^luna_[a-f0-9]{20}$/);
  assert.equal(value.question, 'What is the capital city of France?');
  assert.equal(value.correctAnswer, 'Paris');
  assert.deepEqual(value.incorrectAnswers, ['Lyon', 'Marseille', 'Nice']);
  assert.equal(
    trivia.validateCanonicalQuestion(sample()).id,
    value.id,
    'the same question and answer should receive the same id'
  );
});

test('canonical validation rejects unreliable or malformed questions', () => {
  assert.throws(
    () => trivia.validateCanonicalQuestion(sample({ question: 'Who is currently the president of France?' })),
    /time-sensitive/
  );
  assert.throws(
    () => trivia.validateCanonicalQuestion(sample({ incorrectAnswers: ['Paris', 'Lyon', 'Nice'] })),
    /distinct/
  );
  assert.throws(
    () => trivia.validateCanonicalQuestion(sample({ explanation: 'France has a capital city.' })),
    /verbatim/
  );
  assert.throws(
    () => trivia.validateCanonicalQuestion(sample(), { exclude: ['What is the capital city of France?'] }),
    /excluded|duplicated/
  );
});

test('semantic duplicate gate catches paraphrases and reciprocal question-answer forms', () => {
  const capital = trivia.validateCanonicalQuestion(sample());
  const capitalParaphrase = sample({ question: 'France has which city as its capital?' });
  assert.equal(trivia.questionsAreNearDuplicates(capital, capitalParaphrase), true);
  assert.throws(
    () => trivia.validateCanonicalQuestion(capitalParaphrase, { exclude: [capital] }),
    /semantic duplicate/
  );

  const kimonoDefinition = sample({
    question: 'What is a kimono?',
    correctAnswer: 'A traditional Japanese garment',
    incorrectAnswers: ['A drum', 'A hat', 'A spice mixture'],
    category: 'Culture',
    explanation: 'A traditional Japanese garment is the definition of a kimono.',
  });
  const kimonoName = sample({
    question: 'Which traditional Japanese garment is a long robe with wide sleeves?',
    correctAnswer: 'Kimono',
    incorrectAnswers: ['Sari', 'Hanbok', 'Kaftan'],
    category: 'Culture',
    explanation: 'Kimono is a traditional Japanese robe with wide sleeves.',
  });
  assert.equal(trivia.questionsAreNearDuplicates(kimonoDefinition, kimonoName), true);

  const kotoCountry = sample({
    question: 'With which country is the koto most strongly associated?',
    correctAnswer: 'Japan',
    incorrectAnswers: ['China', 'Korea', 'Vietnam'],
    category: 'Music',
    explanation: 'Japan is the country most strongly associated with the koto.',
  });
  const kotoDefinition = sample({
    question: 'Which traditional Japanese zither has movable bridges?',
    correctAnswer: 'Koto',
    incorrectAnswers: ['Erhu', 'Gayageum', 'Dan tranh'],
    category: 'Music',
    explanation: 'Koto is the traditional Japanese zither with movable bridges.',
  });
  assert.equal(trivia.questionsAreNearDuplicates(kotoCountry, kotoDefinition), true);

  const versaillesShort = sample({
    question: 'Which treaty formally ended World War I for Germany?',
    correctAnswer: 'Treaty of Versailles',
    incorrectAnswers: ['Treaty of Utrecht', 'Treaty of Tordesillas', 'Treaty of Brest-Litovsk'],
    category: 'History',
    explanation: 'Treaty of Versailles formally ended World War I for Germany.',
  });
  const versaillesLong = sample({
    question: 'Which treaty, signed in 1919, formally imposed the postwar peace terms on Germany after World War I?',
    correctAnswer: 'The Treaty of Versailles',
    incorrectAnswers: ['Treaty of Utrecht', 'Treaty of Tordesillas', 'Treaty of Brest-Litovsk'],
    category: 'History',
    explanation: 'The Treaty of Versailles imposed the postwar peace terms on Germany in 1919.',
  });
  assert.equal(trivia.questionsAreNearDuplicates(versaillesShort, versaillesLong), true);

  const unrelatedFranceFact = sample({
    question: 'Which country uses the tricolour flag with blue, white, and red vertical bands?',
    correctAnswer: 'France',
    incorrectAnswers: ['Belgium', 'Ireland', 'Romania'],
    explanation: 'France uses a blue, white, and red vertical tricolour.',
  });
  const anotherFranceFact = sample({
    question: 'Which country has Paris as its capital?',
    correctAnswer: 'France',
    incorrectAnswers: ['Belgium', 'Spain', 'Italy'],
    explanation: 'France has Paris as its capital.',
  });
  assert.equal(trivia.questionsAreNearDuplicates(unrelatedFranceFact, anotherFranceFact), false);
});

test('client preparation shuffles without losing the canonical correct answer', () => {
  const canonical = trivia.validateCanonicalQuestion(sample());
  const originalWrong = canonical.incorrectAnswers.slice();
  const client = trivia.prepareQuestionForClient(canonical, { rng: () => 0 });
  assert.equal(client.answers.length, 4);
  assert.equal(client.answers[client.correct], 'Paris');
  assert.equal(new Set(client.answers).size, 4);
  assert.deepEqual(canonical.incorrectAnswers, originalWrong, 'canonical data must not be mutated');
});

test('bank selection is non-mutating and respects difficulty and exclusions', () => {
  const easy = trivia.validateCanonicalQuestion(sample());
  const hard = trivia.validateCanonicalQuestion(sample({
    question: 'Which element has the chemical symbol W?',
    correctAnswer: 'Tungsten',
    incorrectAnswers: ['Tin', 'Titanium', 'Tantalum'],
    category: 'Science',
    difficulty: 'hard',
    explanation: 'Tungsten has the chemical symbol W.',
  }));
  const bank = [easy, hard];
  const snapshot = JSON.stringify(bank);
  const chosen = trivia.selectBankQuestions(bank, {
    difficulty: 'hard',
    count: 1,
    exclude: [easy.question],
    rng: () => 0.5,
  });
  assert.deepEqual(chosen.map(item => item.id), [hard.id]);
  assert.equal(JSON.stringify(bank), snapshot);
  assert.equal(trivia.selectBankQuestions(bank, { difficulty: 'any', count: 2 }).length, 2);
});

test('question schema is strict and pins the requested batch size', () => {
  const schema = trivia.buildQuestionSchema(3);
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.questions.minItems, 3);
  assert.equal(schema.properties.questions.maxItems, 3);
  assert.equal(schema.properties.questions.items.additionalProperties, false);
});

test('Responses request uses exact endpoint, Luna, auth, and strict structured output', async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return mockResponse(completedPayload({ questions: [sample()] }));
  };
  const questions = await trivia.requestTriviaQuestions({
    apiKey: 'test-secret-key',
    topic: 'European geography',
    count: 1,
    difficulty: 'easy',
    fetchImpl,
  });
  assert.equal(questions.length, 1);
  assert.equal(captured.url, 'https://api.openai.com/v1/responses');
  assert.equal(captured.options.method, 'POST');
  assert.equal(captured.options.headers.Authorization, 'Bearer test-secret-key');
  const body = JSON.parse(captured.options.body);
  assert.equal(body.model, 'gpt-5.6-luna');
  assert.equal(body.store, false);
  assert.equal(body.reasoning.effort, 'low');
  assert.equal(body.text.format.type, 'json_schema');
  assert.equal(body.text.format.strict, true);
  assert.match(body.input[1].content, /European geography/);
});

test('Responses errors are safe and never echo upstream bodies or credentials', async () => {
  const fetchImpl = async () => mockResponse(
    { error: { message: 'sk-live-do-not-leak upstream private detail' } },
    { ok: false, status: 429 }
  );
  await assert.rejects(
    trivia.requestTriviaQuestions({ apiKey: 'top-secret', topic: 'science', fetchImpl }),
    error => {
      assert.equal(error.code, 'OPENAI_RATE_LIMIT');
      assert.doesNotMatch(error.message, /sk-live|top-secret|private detail/);
      return true;
    }
  );
  await assert.rejects(
    trivia.requestTriviaQuestions({ topic: 'science', fetchImpl }),
    error => error.code === 'OPENAI_NOT_CONFIGURED'
  );
});

test('incomplete, refusal, and malformed outputs fail closed', () => {
  assert.throws(
    () => trivia.parseStructuredResponse({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }),
    error => error.code === 'OPENAI_INCOMPLETE'
  );
  assert.throws(
    () => trivia.extractResponseText({ output: [{ content: [{ type: 'refusal', refusal: 'no' }] }] }),
    error => error.code === 'OPENAI_REFUSAL'
  );
  assert.throws(
    () => trivia.extractResponseText({ status: 'in_progress', output_text: '{"questions":[]}' }),
    error => error.code === 'OPENAI_INCOMPLETE'
  );
  assert.throws(
    () => trivia.extractResponseText({
      status: 'completed',
      output_text: '{"questions":[]}',
      output: [{ content: [{ type: 'refusal', refusal: 'no' }] }],
    }),
    error => error.code === 'OPENAI_REFUSAL'
  );
  assert.throws(
    () => trivia.parseStructuredResponse({ output_text: 'not json' }),
    error => error.code === 'OPENAI_INVALID_JSON'
  );
});

test('verification hides the proposed answer marker and returns aligned verdicts', async () => {
  const canonical = trivia.validateCanonicalQuestion(sample());
  let requestBody;
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return mockResponse(completedPayload({
      verdicts: [{
        id: canonical.id,
        selectedAnswer: 'Paris',
        valid: true,
        unambiguous: true,
        timeless: true,
        reason: 'Paris is the capital of France.',
      }],
    }));
  };
  const verdicts = await trivia.verifyTriviaQuestions({
    apiKey: 'test-key',
    questions: [canonical],
    fetchImpl,
  });
  assert.equal(verdicts[0].selectedAnswer, 'Paris');
  assert.equal(verdicts[0].valid, true);
  assert.doesNotMatch(requestBody.input[1].content, /correctAnswer|explanation/);
  assert.equal(requestBody.model, 'gpt-5.6-luna');
  assert.equal(requestBody.text.format.strict, true);
});

test('shared verification gate accepts only exact ids, all true flags, and the normalized correct answer', () => {
  const canonical = trivia.validateCanonicalQuestion(sample());
  const accepted = {
    id: canonical.id,
    selectedAnswer: '  PARIS  ',
    valid: true,
    unambiguous: true,
    timeless: true,
    reason: 'Verified independently.',
  };

  assert.equal(trivia.verificationVerdictAccepts(canonical, accepted), true);
  assert.equal(trivia.verificationVerdictAccepts(canonical, { ...accepted, id: 'luna_wrong' }), false);
  assert.equal(trivia.verificationVerdictAccepts(canonical, { ...accepted, valid: false }), false);
  assert.equal(trivia.verificationVerdictAccepts(canonical, { ...accepted, unambiguous: false }), false);
  assert.equal(trivia.verificationVerdictAccepts(canonical, { ...accepted, timeless: false }), false);
  assert.equal(trivia.verificationVerdictAccepts(canonical, { ...accepted, selectedAnswer: 'Lyon' }), false);
  assert.equal(trivia.verificationVerdictAccepts(canonical, null), false);

  assert.deepEqual(
    trivia.filterIndependentlyVerifiedQuestions([canonical], [[accepted], [{ ...accepted }]]),
    [canonical]
  );
  assert.deepEqual(
    trivia.filterIndependentlyVerifiedQuestions([canonical], [[accepted]]),
    [],
    'one verification pass must never be sufficient'
  );
  assert.deepEqual(
    trivia.filterIndependentlyVerifiedQuestions([canonical], [[accepted], [{ ...accepted, selectedAnswer: 'Lyon' }]]),
    [],
    'a candidate must pass every independent verification'
  );
});

test('verified request launches two verification calls concurrently and returns only a twice-confirmed candidate', async () => {
  const canonical = trivia.validateCanonicalQuestion(sample());
  let verificationStarts = 0;
  let releaseVerifiers;
  const bothVerifiersStarted = new Promise(resolve => { releaseVerifiers = resolve; });
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.text.format.name === 'verified_trivia_questions') {
      return mockResponse(completedPayload({ questions: [sample()] }));
    }

    verificationStarts += 1;
    if (verificationStarts === 2) releaseVerifiers();
    await Promise.race([
      bothVerifiersStarted,
      new Promise((_, reject) => setTimeout(() => reject(new Error('verification calls were not concurrent')), 250)),
    ]);
    return mockResponse(completedPayload({
      verdicts: [{
        id: canonical.id,
        selectedAnswer: 'Paris',
        valid: true,
        unambiguous: true,
        timeless: true,
        reason: 'Paris is correct.',
      }],
    }));
  };

  const questions = await trivia.requestVerifiedTriviaQuestions({
    apiKey: 'test-key',
    topic: 'France',
    count: 1,
    fetchImpl,
  });
  assert.equal(verificationStarts, 2);
  assert.deepEqual(questions, [canonical]);
});

test('verified request fails closed when either independent verifier rejects the candidate', async () => {
  const canonical = trivia.validateCanonicalQuestion(sample());
  let verificationCall = 0;
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    if (body.text.format.name === 'verified_trivia_questions') {
      return mockResponse(completedPayload({ questions: [sample()] }));
    }

    const accepted = verificationCall++ === 0;
    return mockResponse(completedPayload({
      verdicts: [{
        id: canonical.id,
        selectedAnswer: accepted ? 'Paris' : 'Lyon',
        valid: true,
        unambiguous: true,
        timeless: true,
        reason: accepted ? 'Paris is correct.' : 'The second verifier disagreed.',
      }],
    }));
  };

  await assert.rejects(
    trivia.requestVerifiedTriviaQuestions({
      apiKey: 'test-key',
      topic: 'France',
      count: 1,
      fetchImpl,
    }),
    error => error.code === 'OPENAI_VERIFICATION_FAILED'
  );
  assert.equal(verificationCall, 2);
});

test('bank loader enforces provenance, verification, size, and uniqueness', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'big-tuna-trivia-'));
  const file = path.join(dir, 'bank.json');
  const questions = [
    trivia.validateCanonicalQuestion(sample()),
    trivia.validateCanonicalQuestion(sample({
      question: 'Which element has the chemical symbol W?',
      correctAnswer: 'Tungsten',
      incorrectAnswers: ['Tin', 'Titanium', 'Tantalum'],
      category: 'Science',
      difficulty: 'hard',
      explanation: 'Tungsten has the chemical symbol W.',
    })),
  ];
  const metadata = {
    schemaVersion: 1,
    model: 'gpt-5.6-luna',
    generatedAt: new Date().toISOString(),
    count: 2,
    verificationModel: 'gpt-5.6-luna',
    verificationPasses: 2,
    questions,
  };
  try {
    fs.writeFileSync(file, JSON.stringify(metadata));
    const bank = trivia.loadTriviaBank(file, { expectedSize: 2 });
    assert.equal(bank.questions.length, 2);
    assert.equal(bank.model, 'gpt-5.6-luna');
    fs.writeFileSync(file, JSON.stringify({
      ...metadata,
      questions: [{ ...questions[0], id: 'luna_invalid' }, questions[1]],
    }));
    assert.throws(() => trivia.loadTriviaBank(file, { expectedSize: 2 }), /id is invalid/);
    fs.writeFileSync(file, JSON.stringify({ ...metadata, questions: [questions[0], questions[0]] }));
    assert.throws(() => trivia.loadTriviaBank(file, { expectedSize: 2 }), /excluded|duplicated/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('committed Luna bank is deployable at exactly 1,000 immutable questions', () => {
  const bank = trivia.loadTriviaBank();
  assert.equal(bank.count, 1000);
  assert.equal(bank.questions.length, 1000);
  assert.equal(bank.model, 'gpt-5.6-luna');
  assert.equal(bank.verificationModel, 'gpt-5.6-luna');
  assert.ok(bank.verificationPasses >= 2);
  assert.equal(Object.isFrozen(bank), true);
  assert.equal(Object.isFrozen(bank.questions), true);
  assert.equal(new Set(bank.questions.map(question => question.id)).size, 1000);
  for (const question of bank.questions) {
    assert.equal(Object.isFrozen(question), true);
    assert.equal(Object.isFrozen(question.incorrectAnswers), true);
  }
});

test('bank repair mode filters semantic duplicates and explicitly dropped ids', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'big-tuna-trivia-repair-'));
  const file = path.join(dir, 'bank.json');
  const first = trivia.validateCanonicalQuestion(sample());
  const paraphrase = trivia.validateCanonicalQuestion(sample({ question: 'France has which city as its capital?' }));
  const keep = trivia.validateCanonicalQuestion(sample({
    question: 'Which element has the chemical symbol W?',
    correctAnswer: 'Tungsten',
    incorrectAnswers: ['Tin', 'Titanium', 'Tantalum'],
    category: 'Science',
    difficulty: 'hard',
    explanation: 'Tungsten has the chemical symbol W.',
  }));
  const drop = trivia.validateCanonicalQuestion(sample({
    question: 'Which planet is closest to the Sun?',
    correctAnswer: 'Mercury',
    incorrectAnswers: ['Venus', 'Earth', 'Mars'],
    category: 'Astronomy',
    explanation: 'Mercury is the planet closest to the Sun.',
  }));
  try {
    fs.writeFileSync(file, JSON.stringify({
      schemaVersion: 1,
      model: 'gpt-5.6-luna',
      verificationModel: 'gpt-5.6-luna',
      verificationPasses: 2,
      generatedAt: new Date().toISOString(),
      count: 4,
      questions: [first, paraphrase, keep, drop],
    }));
    const options = bankCli.parseArgs([
      '--repair', '--target', '4', '--output', file, '--drop-id', drop.id,
    ]);
    const state = bankCli.loadRepairSeed(options);
    assert.deepEqual(state.questions.map(question => question.id), [first.id, keep.id]);
    assert.equal(state.filtered, 2);
    assert.throws(
      () => bankCli.parseArgs(['--drop-id', drop.id]),
      /requires --repair/
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

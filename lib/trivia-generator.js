'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const TRIVIA_MODEL = 'gpt-5.6-luna';
const TRIVIA_BANK_SIZE = 1000;
const TRIVIA_BANK_SCHEMA_VERSION = 1;
const DEFAULT_TRIVIA_BANK_PATH = path.join(__dirname, 'trivia-bank.json');
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MAX_GENERATION_BATCH = 25;
const NEAR_DUPLICATE_THRESHOLD = 0.48;
const ALLOWED_DIFFICULTIES = new Set(['easy', 'medium', 'hard']);
const QUESTION_STOP_WORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'by', 'called', 'did', 'do', 'does',
  'following', 'for', 'from', 'had', 'has', 'have', 'identify', 'in', 'into',
  'is', 'known', 'name', 'of', 'on', 'or', 'that', 'the', 'these', 'this',
  'those', 'to', 'was', 'were', 'what', 'when', 'where', 'which', 'who',
  'whom', 'whose', 'with',
]);
const DUPLICATE_SIGNATURE_CACHE = new WeakMap();

const PLACEHOLDER_RE = /^(?:answer|option|choice|unknown|n\/?a|null|undefined|placeholder|tbd|none|\?+|\.*)(?:\s*\d+)?$/i;
const TIME_SENSITIVE_RE = /\b(?:currently|current|latest|today|tonight|yesterday|tomorrow|this\s+(?:week|month|year|season)|last\s+(?:week|month|year|season)|next\s+(?:week|month|year|season)|as\s+of|recent(?:ly)?|newest|most\s+recent|present-day|sitting\s+president|reigning\s+champion)\b/i;
const AMBIGUOUS_RE = /\b(?:all\s+of\s+the\s+above|none\s+of\s+the\s+above|both\s+[a-d]\s+and\s+[a-d]|which\s+is\s+best|most\s+popular|most\s+famous|greatest\s+ever|widely\s+considered|generally\s+regarded|arguably|in\s+your\s+opinion|trick\s+question)\b/i;

function triviaError(message, code = 'TRIVIA_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cleanString(value, field, { min = 1, max = 500 } = {}) {
  if (typeof value !== 'string') throw triviaError(`${field} must be a string`);
  const cleaned = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned.length < min || cleaned.length > max) {
    throw triviaError(`${field} must be ${min}-${max} characters`);
  }
  return cleaned;
}

function normalizeQuestionText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/[?.!]+$/g, '')
    .trim();
}

function normalizeAnswer(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\p{L}\p{N}%+.'°-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function exclusionValues(exclude) {
  if (exclude instanceof Set) return [...exclude];
  return Array.isArray(exclude) ? exclude : [];
}

function meaningfulQuestionTokens(value) {
  return new Set(normalizeQuestionText(value)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(/\s+/)
    .filter(token => token.length > 1 && !QUESTION_STOP_WORDS.has(token))
    .map(token => {
      if (token.length > 5 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
      if (token.length > 5 && token.endsWith('ing')) return token.slice(0, -3);
      if (token.length > 4 && token.endsWith('ed')) return token.slice(0, -2);
      if (token.length > 4 && token.endsWith('es')) return token.slice(0, -2);
      if (token.length > 3 && token.endsWith('s') && !token.endsWith('ss')) return token.slice(0, -1);
      return token;
    }));
}

function normalizedFactAnswer(value) {
  return normalizeAnswer(value).replace(/^(?:the|a|an)\s+/, '');
}

function duplicateSignature(value) {
  if (value && typeof value === 'object' && DUPLICATE_SIGNATURE_CACHE.has(value)) {
    return DUPLICATE_SIGNATURE_CACHE.get(value);
  }
  const text = normalizeQuestionText(value?.question || value);
  const answer = normalizedFactAnswer(value?.correctAnswer);
  const signature = {
    text,
    answer,
    tokens: meaningfulQuestionTokens(text),
    answerTokens: meaningfulQuestionTokens(answer),
  };
  if (value && typeof value === 'object') DUPLICATE_SIGNATURE_CACHE.set(value, signature);
  return signature;
}

function duplicateTokensMatch(left, right) {
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  let prefix = 0;
  while (prefix < shorter.length && shorter[prefix] === longer[prefix]) prefix += 1;
  return prefix >= 4 && (prefix / shorter.length) >= 0.8;
}

function matchingTokenCount(leftTokens, rightTokens) {
  const remaining = [...rightTokens];
  let count = 0;
  for (const left of leftTokens) {
    const index = remaining.findIndex(right => duplicateTokensMatch(left, right));
    if (index < 0) continue;
    remaining.splice(index, 1);
    count += 1;
  }
  return count;
}

function tokensContained(needles, haystack) {
  return needles.size > 0 && matchingTokenCount(needles, haystack) === needles.size;
}

function factAnswersEquivalent(left, right) {
  if (left.answer && left.answer === right.answer) return true;
  if (!left.answerTokens.size || !right.answerTokens.size) return false;
  const smaller = left.answerTokens.size <= right.answerTokens.size ? left.answerTokens : right.answerTokens;
  const larger = left.answerTokens.size <= right.answerTokens.size ? right.answerTokens : left.answerTokens;
  return tokensContained(smaller, larger);
}

function duplicateSignaturesMatch(left, right, threshold = NEAR_DUPLICATE_THRESHOLD) {
  if (!left.text || !right.text) return false;
  if (left.text === right.text) return true;
  if (!left.tokens.size || !right.tokens.size) return false;

  const inverted = left.answerTokens.size > 0
    && right.answerTokens.size > 0
    && tokensContained(left.answerTokens, right.tokens)
    && tokensContained(right.answerTokens, left.tokens);
  if (inverted) return true;
  if (!factAnswersEquivalent(left, right)) return false;

  const intersection = matchingTokenCount(left.tokens, right.tokens);
  const denominator = Math.min(left.tokens.size, right.tokens.size);
  return intersection >= 2 && denominator > 0 && (intersection / denominator) >= threshold;
}

function questionsAreNearDuplicates(left, right, threshold = NEAR_DUPLICATE_THRESHOLD) {
  return duplicateSignaturesMatch(duplicateSignature(left), duplicateSignature(right), threshold);
}

function hasNearDuplicate(candidate, exclude) {
  const candidateSignature = duplicateSignature(candidate);
  return exclusionValues(exclude).some(item => (
    item && typeof item === 'object'
    && duplicateSignaturesMatch(candidateSignature, duplicateSignature(item))
  ));
}

function questionId(question, correctAnswer) {
  return `luna_${crypto.createHash('sha256')
    .update(`${normalizeQuestionText(question)}\n${normalizeAnswer(correctAnswer)}`)
    .digest('hex')
    .slice(0, 20)}`;
}

function exclusionSet(exclude) {
  const values = exclusionValues(exclude);
  return new Set(values.map(item => normalizeQuestionText(item?.question || item)).filter(Boolean));
}

function validateCanonicalQuestion(raw, { exclude = [] } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw triviaError('Question must be an object');
  }

  const question = cleanString(raw.question, 'question', { min: 8, max: 300 });
  if (TIME_SENSITIVE_RE.test(question)) throw triviaError('Question is time-sensitive');
  if (AMBIGUOUS_RE.test(question)) throw triviaError('Question is ambiguous');
  const normalizedQuestion = normalizeQuestionText(question);
  if (exclusionSet(exclude).has(normalizedQuestion)) throw triviaError('Question is excluded or duplicated');

  const correctAnswer = cleanString(raw.correctAnswer, 'correctAnswer', { min: 1, max: 160 });
  if (PLACEHOLDER_RE.test(correctAnswer)) throw triviaError('Correct answer is a placeholder');
  if (hasNearDuplicate({ question, correctAnswer }, exclude)) {
    throw triviaError('Question is a semantic duplicate');
  }
  if (!Array.isArray(raw.incorrectAnswers) || raw.incorrectAnswers.length !== 3) {
    throw triviaError('incorrectAnswers must contain exactly three answers');
  }
  const incorrectAnswers = raw.incorrectAnswers.map((answer, index) => {
    const cleaned = cleanString(answer, `incorrectAnswers[${index}]`, { min: 1, max: 160 });
    if (PLACEHOLDER_RE.test(cleaned)) throw triviaError('Distractor is a placeholder');
    return cleaned;
  });
  const answerKeys = [correctAnswer, ...incorrectAnswers].map(normalizeAnswer);
  if (answerKeys.some(key => !key) || new Set(answerKeys).size !== 4) {
    throw triviaError('All four answers must be distinct');
  }

  const category = cleanString(raw.category, 'category', { min: 2, max: 80 });
  const difficulty = cleanString(raw.difficulty, 'difficulty', { min: 4, max: 6 }).toLowerCase();
  if (!ALLOWED_DIFFICULTIES.has(difficulty)) throw triviaError('Difficulty must be easy, medium, or hard');
  const explanation = cleanString(raw.explanation, 'explanation', { min: 8, max: 500 });
  if (TIME_SENSITIVE_RE.test(explanation)) throw triviaError('Explanation is time-sensitive');
  if (!normalizeAnswer(explanation).includes(normalizeAnswer(correctAnswer))) {
    throw triviaError('Explanation must state the correct answer verbatim');
  }

  const id = raw.id === undefined || raw.id === null || raw.id === ''
    ? questionId(question, correctAnswer)
    : cleanString(raw.id, 'id', { min: 4, max: 100 });

  return {
    id,
    question,
    correctAnswer,
    incorrectAnswers,
    category,
    difficulty,
    explanation,
  };
}

function randomIndex(maxExclusive, rng) {
  if (maxExclusive <= 1) return 0;
  if (typeof rng === 'function') {
    const value = Number(rng());
    if (!Number.isFinite(value)) throw triviaError('Random source returned an invalid value');
    return Math.min(maxExclusive - 1, Math.max(0, Math.floor(value * maxExclusive)));
  }
  return crypto.randomInt(maxExclusive);
}

function shuffled(items, rng) {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, rng);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function prepareQuestionForClient(raw, { rng } = {}) {
  const question = validateCanonicalQuestion(raw);
  const choices = shuffled([
    { text: question.correctAnswer, correct: true },
    ...question.incorrectAnswers.map(text => ({ text, correct: false })),
  ], rng);
  const correct = choices.findIndex(choice => choice.correct);
  if (correct < 0) throw triviaError('Correct answer was lost while shuffling');
  return {
    id: question.id,
    question: question.question,
    answers: choices.map(choice => choice.text),
    correct,
    category: question.category,
    difficulty: question.difficulty,
    explanation: question.explanation,
  };
}

function selectBankQuestions(bankOrQuestions, { difficulty = 'any', count = 5, exclude = [], rng } = {}) {
  const questions = Array.isArray(bankOrQuestions) ? bankOrQuestions : bankOrQuestions?.questions;
  if (!Array.isArray(questions)) throw triviaError('Trivia bank does not contain a questions array');
  const requestedDifficulty = String(difficulty || 'any').toLowerCase();
  if (!['any', 'mixed', ...ALLOWED_DIFFICULTIES].includes(requestedDifficulty)) {
    throw triviaError('Invalid Trivia difficulty');
  }
  const wanted = Math.max(1, Math.min(10, Number.parseInt(count, 10) || 5));
  const excluded = exclusionSet(exclude);
  const eligible = questions.filter(question => {
    if (!question || excluded.has(normalizeQuestionText(question.question))) return false;
    return requestedDifficulty === 'any'
      || requestedDifficulty === 'mixed'
      || question.difficulty === requestedDifficulty;
  });
  return shuffled(eligible, rng).slice(0, wanted);
}

function loadTriviaBank(filePath = DEFAULT_TRIVIA_BANK_PATH, { expectedSize = TRIVIA_BANK_SIZE } = {}) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw triviaError('Trivia bank file could not be read', 'TRIVIA_BANK_UNAVAILABLE');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw triviaError('Trivia bank metadata is invalid');
  }
  if (parsed.schemaVersion !== TRIVIA_BANK_SCHEMA_VERSION) throw triviaError('Trivia bank schema version is invalid');
  if (parsed.model !== TRIVIA_MODEL || parsed.verificationModel !== TRIVIA_MODEL) {
    throw triviaError('Trivia bank was not generated and verified by the required model');
  }
  if (!Number.isInteger(parsed.verificationPasses) || parsed.verificationPasses < 2) {
    throw triviaError('Trivia bank must record at least two verification passes');
  }
  if (!Array.isArray(parsed.questions) || parsed.questions.length !== expectedSize || parsed.count !== expectedSize) {
    throw triviaError(`Trivia bank must contain exactly ${expectedSize} questions`);
  }
  if (typeof parsed.generatedAt !== 'string' || Number.isNaN(Date.parse(parsed.generatedAt))) {
    throw triviaError('Trivia bank generatedAt is invalid');
  }

  const seen = [];
  const seenIds = new Set();
  const questions = parsed.questions.map(raw => {
    const question = validateCanonicalQuestion(raw, { exclude: seen });
    if (question.id !== questionId(question.question, question.correctAnswer) || seenIds.has(question.id)) {
      throw triviaError('Trivia bank question id is invalid or duplicated');
    }
    seenIds.add(question.id);
    seen.push(question);
    return Object.freeze({ ...question, incorrectAnswers: Object.freeze(question.incorrectAnswers.slice()) });
  });
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    model: parsed.model,
    generatedAt: parsed.generatedAt,
    count: parsed.count,
    verificationModel: parsed.verificationModel,
    verificationPasses: parsed.verificationPasses,
    questions: Object.freeze(questions),
  });
}

function difficultyInstruction(difficulty) {
  const value = String(difficulty || 'mixed').toLowerCase();
  if (ALLOWED_DIFFICULTIES.has(value)) return value;
  return 'mixed';
}

function promptExclusions(exclude, topic) {
  const values = Array.isArray(exclude) ? exclude : [];
  const hasCanonicalQuestions = values.some(item => item && typeof item === 'object' && item.question);
  if (!hasCanonicalQuestions) {
    return values
      .map(item => String(item || '').replace(/\s+/g, ' ').trim().slice(0, 180))
      .filter(Boolean)
      .slice(-30);
  }

  const topicTokens = meaningfulQuestionTokens(topic);
  const entries = values.map((item, index) => {
    const question = String(item?.question || '').replace(/\s+/g, ' ').trim();
    const answer = String(item?.correctAnswer || '').replace(/\s+/g, ' ').trim();
    const category = String(item?.category || '');
    const score = matchingTokenCount(topicTokens, meaningfulQuestionTokens(`${category} ${question}`));
    return {
      index,
      score,
      key: normalizeQuestionText(question),
      text: `${question}${answer ? ` [answer: ${answer}]` : ''}`.slice(0, 240),
    };
  }).filter(entry => entry.key && entry.text);

  const ranked = entries.slice().sort((left, right) => right.score - left.score || left.index - right.index);
  const selected = [
    ...ranked.slice(0, 100),
    ...Array.from({ length: Math.min(40, entries.length) }, (_, index) => (
      entries[Math.floor((index * entries.length) / Math.min(40, entries.length))]
    )),
    ...entries.slice(-20),
  ];
  const seen = new Set();
  return selected.filter(entry => {
    if (!entry || seen.has(entry.key)) return false;
    seen.add(entry.key);
    return true;
  }).slice(0, 160).map(entry => entry.text);
}

function buildQuestionPrompt({ topic = '', count = 1, difficulty = 'mixed', exclude = [] } = {}) {
  const cleanTopic = String(topic || '').replace(/[\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100);
  const avoided = promptExclusions(exclude, cleanTopic);
  return [
    `Create exactly ${count} unique four-choice trivia question${count === 1 ? '' : 's'}.`,
    cleanTopic ? `Every question must be specifically about: ${cleanTopic}.` : 'Use a varied mix of durable general-knowledge subjects.',
    `Difficulty: ${difficultyInstruction(difficulty)}.`,
    'Use only objective, timeless, independently verifiable facts with one indisputable correct answer.',
    'Do not use current events, changing records or office-holders, estimates, opinions, disputed facts, trick questions, or all/none-of-the-above choices.',
    'Before returning each item, solve it yourself and check that correctAnswer is factually correct and each incorrect answer is definitely wrong.',
    'The explanation must state correctAnswer verbatim and briefly explain why it is correct.',
    avoided.length ? `Do not repeat these questions:\n- ${avoided.join('\n- ')}` : '',
  ].filter(Boolean).join('\n');
}

function canonicalQuestionSchema() {
  return {
    type: 'object',
    properties: {
      question: { type: 'string', minLength: 8, maxLength: 300 },
      correctAnswer: { type: 'string', minLength: 1, maxLength: 160 },
      incorrectAnswers: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: { type: 'string', minLength: 1, maxLength: 160 },
      },
      category: { type: 'string', minLength: 2, maxLength: 80 },
      difficulty: { type: 'string', enum: ['easy', 'medium', 'hard'] },
      explanation: { type: 'string', minLength: 8, maxLength: 500 },
    },
    required: ['question', 'correctAnswer', 'incorrectAnswers', 'category', 'difficulty', 'explanation'],
    additionalProperties: false,
  };
}

function buildQuestionSchema(count = 1) {
  const size = Math.max(1, Math.min(MAX_GENERATION_BATCH, Number.parseInt(count, 10) || 1));
  return {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        minItems: size,
        maxItems: size,
        items: canonicalQuestionSchema(),
      },
    },
    required: ['questions'],
    additionalProperties: false,
  };
}

function buildVerificationPrompt(questions, { rng } = {}) {
  if (!Array.isArray(questions) || !questions.length) throw triviaError('No questions were supplied for verification');
  const presented = questions.map(raw => {
    const question = validateCanonicalQuestion(raw);
    return {
      id: question.id,
      question: question.question,
      options: shuffled([question.correctAnswer, ...question.incorrectAnswers], rng),
    };
  });
  return [
    'Independently fact-check every trivia item below. The proposed answer is intentionally not identified.',
    'Solve each question from your own knowledge, select the single correct option exactly as written, and reject any item that is ambiguous, subjective, disputed, time-sensitive, or has multiple/no correct options.',
    'Set valid=true only when one option is factually correct and the other three are definitely false. Set unambiguous and timeless independently.',
    JSON.stringify({ questions: presented }),
  ].join('\n');
}

function buildVerificationSchema(questionsOrCount = 1) {
  const questions = Array.isArray(questionsOrCount) ? questionsOrCount : null;
  const size = questions ? questions.length : Math.max(1, Number.parseInt(questionsOrCount, 10) || 1);
  const ids = questions ? questions.map(question => String(question.id)) : null;
  return {
    type: 'object',
    properties: {
      verdicts: {
        type: 'array',
        minItems: size,
        maxItems: size,
        items: {
          type: 'object',
          properties: {
            id: ids ? { type: 'string', enum: ids } : { type: 'string' },
            selectedAnswer: { type: 'string', minLength: 1, maxLength: 160 },
            valid: { type: 'boolean' },
            unambiguous: { type: 'boolean' },
            timeless: { type: 'boolean' },
            reason: { type: 'string', minLength: 1, maxLength: 300 },
          },
          required: ['id', 'selectedAnswer', 'valid', 'unambiguous', 'timeless', 'reason'],
          additionalProperties: false,
        },
      },
    },
    required: ['verdicts'],
    additionalProperties: false,
  };
}

function extractResponseText(payload) {
  if (!payload || typeof payload !== 'object') throw triviaError('OpenAI returned an invalid response', 'OPENAI_INVALID_RESPONSE');
  if (payload.status === 'incomplete') {
    const reason = payload.incomplete_details?.reason;
    throw triviaError(reason === 'content_filter'
      ? 'OpenAI could not complete this Trivia request'
      : 'OpenAI returned an incomplete Trivia response', 'OPENAI_INCOMPLETE');
  }
  if (typeof payload.status === 'string' && payload.status !== 'completed') {
    throw triviaError('OpenAI did not complete this Trivia response', 'OPENAI_INCOMPLETE');
  }
  if (payload.error) throw triviaError('OpenAI could not complete this Trivia request', 'OPENAI_RESPONSE_ERROR');
  let nestedText = '';
  for (const item of Array.isArray(payload.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === 'refusal') throw triviaError('OpenAI declined this Trivia request', 'OPENAI_REFUSAL');
      if (!nestedText && content?.type === 'output_text' && typeof content.text === 'string' && content.text.trim()) {
        nestedText = content.text.trim();
      }
    }
  }
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  if (nestedText) return nestedText;
  throw triviaError('OpenAI returned no structured Trivia output', 'OPENAI_EMPTY');
}

function parseStructuredResponse(payload) {
  const text = extractResponseText(payload);
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    return parsed;
  } catch {
    throw triviaError('OpenAI returned malformed structured Trivia output', 'OPENAI_INVALID_JSON');
  }
}

function openAiFailure(status) {
  if (status === 401 || status === 403) return triviaError('OpenAI credentials were rejected', 'OPENAI_AUTH');
  if (status === 429) return triviaError('OpenAI is rate-limited or out of API credits', 'OPENAI_RATE_LIMIT');
  if (status >= 500) return triviaError('OpenAI is temporarily unavailable', 'OPENAI_UNAVAILABLE');
  return triviaError('OpenAI rejected the Trivia request', 'OPENAI_REQUEST_FAILED');
}

async function readJsonResponse(response) {
  if (response && typeof response.json === 'function') {
    try { return await response.json(); } catch {}
  }
  if (response && typeof response.text === 'function') {
    try { return JSON.parse(await response.text()); } catch {}
  }
  return null;
}

async function postOpenAi({ apiKey, body, signal, fetchImpl }) {
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) throw triviaError('OpenAI topic generation is not configured', 'OPENAI_NOT_CONFIGURED');
  const requestFetch = fetchImpl || globalThis.fetch;
  if (typeof requestFetch !== 'function') throw triviaError('Fetch is unavailable', 'OPENAI_UNAVAILABLE');
  let response;
  try {
    response = await requestFetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError' || signal?.aborted) {
      throw triviaError('OpenAI Trivia generation timed out', 'OPENAI_TIMEOUT');
    }
    throw triviaError('Could not reach OpenAI for Trivia generation', 'OPENAI_UNAVAILABLE');
  }
  const payload = await readJsonResponse(response);
  if (!response?.ok) throw openAiFailure(Number(response?.status) || 500);
  return payload;
}

function reasoningEffort(value) {
  return ['none', 'low', 'medium', 'high', 'xhigh', 'max'].includes(value) ? value : 'low';
}

async function requestTriviaQuestions({
  apiKey,
  topic = '',
  count = 1,
  difficulty = 'mixed',
  exclude = [],
  allowPartial = false,
  signal,
  fetchImpl,
  reasoningEffort: requestedEffort = 'low',
} = {}) {
  const size = Math.max(1, Math.min(MAX_GENERATION_BATCH, Number.parseInt(count, 10) || 1));
  const body = {
    model: TRIVIA_MODEL,
    store: false,
    reasoning: { effort: reasoningEffort(requestedEffort) },
    max_output_tokens: Math.min(12000, Math.max(900, 420 * size)),
    input: [
      {
        role: 'developer',
        content: 'You are a meticulous trivia editor. Accuracy is more important than novelty. Follow the supplied schema exactly.',
      },
      {
        role: 'user',
        content: buildQuestionPrompt({ topic, count: size, difficulty, exclude }),
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'verified_trivia_questions',
        strict: true,
        schema: buildQuestionSchema(size),
      },
    },
  };
  const parsed = parseStructuredResponse(await postOpenAi({ apiKey, body, signal, fetchImpl }));
  if (!Array.isArray(parsed.questions) || parsed.questions.length !== size) {
    throw triviaError('OpenAI returned the wrong number of Trivia questions', 'OPENAI_INVALID_RESPONSE');
  }
  const seen = exclusionValues(exclude).slice();
  const questions = [];
  for (const raw of parsed.questions) {
    try {
      const question = validateCanonicalQuestion(raw, { exclude: seen });
      seen.push(question);
      questions.push(question);
    } catch (error) {
      if (!allowPartial) throw error;
    }
  }
  if (!questions.length) {
    throw triviaError('OpenAI returned no valid Trivia questions', 'OPENAI_INVALID_RESPONSE');
  }
  return questions;
}

async function verifyTriviaQuestions({
  apiKey,
  questions,
  signal,
  fetchImpl,
  reasoningEffort: requestedEffort = 'low',
} = {}) {
  if (!Array.isArray(questions) || !questions.length || questions.length > MAX_GENERATION_BATCH) {
    throw triviaError(`Verification requires 1-${MAX_GENERATION_BATCH} questions`);
  }
  const canonical = questions.map(question => validateCanonicalQuestion(question));
  const body = {
    model: TRIVIA_MODEL,
    store: false,
    reasoning: { effort: reasoningEffort(requestedEffort) },
    max_output_tokens: Math.min(10000, Math.max(800, 260 * canonical.length)),
    input: [
      {
        role: 'developer',
        content: 'You are an independent fact-checker. Do not defer to the question author. Return only the strict schema.',
      },
      {
        role: 'user',
        content: buildVerificationPrompt(canonical),
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'trivia_verification',
        strict: true,
        schema: buildVerificationSchema(canonical),
      },
    },
  };
  const parsed = parseStructuredResponse(await postOpenAi({ apiKey, body, signal, fetchImpl }));
  if (!Array.isArray(parsed.verdicts) || parsed.verdicts.length !== canonical.length) {
    throw triviaError('OpenAI returned incomplete Trivia verification', 'OPENAI_INVALID_RESPONSE');
  }
  const byId = new Map();
  for (const raw of parsed.verdicts) {
    if (!raw || typeof raw !== 'object') throw triviaError('Trivia verification verdict is invalid');
    const id = cleanString(raw.id, 'verification id', { min: 4, max: 100 });
    if (byId.has(id)) throw triviaError('Trivia verification returned a duplicate id');
    const selectedAnswer = cleanString(raw.selectedAnswer, 'selectedAnswer', { min: 1, max: 160 });
    if (![raw.valid, raw.unambiguous, raw.timeless].every(value => typeof value === 'boolean')) {
      throw triviaError('Trivia verification flags are invalid');
    }
    const reason = cleanString(raw.reason, 'verification reason', { min: 1, max: 300 });
    byId.set(id, {
      id,
      selectedAnswer,
      valid: raw.valid,
      unambiguous: raw.unambiguous,
      timeless: raw.timeless,
      reason,
    });
  }
  return canonical.map(question => {
    const verdict = byId.get(question.id);
    if (!verdict) throw triviaError('Trivia verification omitted a question');
    const choices = [question.correctAnswer, ...question.incorrectAnswers].map(normalizeAnswer);
    if (!choices.includes(normalizeAnswer(verdict.selectedAnswer))) {
      throw triviaError('Trivia verification selected an unknown answer');
    }
    return verdict;
  });
}

// This is the single acceptance rule used by both live topic generation and
// the offline bank builder. It intentionally returns false for malformed input
// so callers cannot accidentally treat an incomplete verifier response as a
// successful fact-check.
function verificationVerdictAccepts(question, verdict) {
  let canonical;
  try {
    canonical = validateCanonicalQuestion(question);
  } catch {
    return false;
  }

  return Boolean(
    verdict
    && typeof verdict === 'object'
    && verdict.id === canonical.id
    && verdict.valid === true
    && verdict.unambiguous === true
    && verdict.timeless === true
    && normalizeAnswer(verdict.selectedAnswer) === normalizeAnswer(canonical.correctAnswer)
  );
}

function filterIndependentlyVerifiedQuestions(questions, verificationPasses) {
  if (!Array.isArray(questions) || !Array.isArray(verificationPasses) || verificationPasses.length < 2) {
    return [];
  }

  const canonical = [];
  for (const question of questions) {
    try {
      canonical.push(validateCanonicalQuestion(question));
    } catch {
      // Fail closed for this candidate while still allowing other independently
      // verified candidates in an offline batch to proceed.
    }
  }

  return canonical.filter(question => verificationPasses.every(pass => {
    if (!Array.isArray(pass)) return false;
    const matchingVerdicts = pass.filter(verdict => verdict?.id === question.id);
    return matchingVerdicts.length === 1
      && verificationVerdictAccepts(question, matchingVerdicts[0]);
  }));
}

// Generate first, then launch two separate fact-check requests concurrently.
// A caller-supplied AbortSignal covers all three requests, allowing the server
// to enforce one overall deadline rather than three independent time budgets.
async function requestVerifiedTriviaQuestions({
  apiKey,
  topic = '',
  count = 1,
  difficulty = 'mixed',
  exclude = [],
  allowPartial = false,
  signal,
  fetchImpl,
  reasoningEffort: requestedEffort = 'low',
  verificationReasoningEffort = requestedEffort,
} = {}) {
  const candidates = await requestTriviaQuestions({
    apiKey,
    topic,
    count,
    difficulty,
    exclude,
    allowPartial,
    signal,
    fetchImpl,
    reasoningEffort: requestedEffort,
  });

  const verify = () => verifyTriviaQuestions({
    apiKey,
    questions: candidates,
    signal,
    fetchImpl,
    reasoningEffort: verificationReasoningEffort,
  });
  const verificationPasses = await Promise.all([verify(), verify()]);
  const verified = filterIndependentlyVerifiedQuestions(candidates, verificationPasses);
  if (!verified.length) {
    throw triviaError(
      'OpenAI verification did not confirm a Trivia question',
      'OPENAI_VERIFICATION_FAILED'
    );
  }
  return verified;
}

module.exports = {
  TRIVIA_MODEL,
  TRIVIA_BANK_SIZE,
  TRIVIA_BANK_SCHEMA_VERSION,
  NEAR_DUPLICATE_THRESHOLD,
  DEFAULT_TRIVIA_BANK_PATH,
  normalizeQuestionText,
  canonicalQuestionId: questionId,
  questionsAreNearDuplicates,
  validateCanonicalQuestion,
  prepareQuestionForClient,
  selectBankQuestions,
  loadTriviaBank,
  requestTriviaQuestions,
  verifyTriviaQuestions,
  verificationVerdictAccepts,
  filterIndependentlyVerifiedQuestions,
  requestVerifiedTriviaQuestions,
  buildQuestionPrompt,
  buildQuestionSchema,
  buildVerificationPrompt,
  buildVerificationSchema,
  extractResponseText,
  parseStructuredResponse,
  _test: {
    OPENAI_RESPONSES_URL,
    normalizeAnswer,
    shuffled,
    questionId,
    postOpenAi,
    TIME_SENSITIVE_RE,
    AMBIGUOUS_RE,
  },
};

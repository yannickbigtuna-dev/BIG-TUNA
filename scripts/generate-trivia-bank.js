'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  TRIVIA_MODEL,
  TRIVIA_BANK_SIZE,
  TRIVIA_BANK_SCHEMA_VERSION,
  DEFAULT_TRIVIA_BANK_PATH,
  canonicalQuestionId,
  validateCanonicalQuestion,
  loadTriviaBank,
  requestTriviaQuestions,
  verifyTriviaQuestions,
  filterIndependentlyVerifiedQuestions,
} = require('../lib/trivia-generator');

const TOPICS = Object.freeze([
  'ancient and medieval world history',
  'modern world history before 2000',
  'physical science and chemistry',
  'biology and human anatomy',
  'Earth science and geology',
  'astronomy and space science',
  'world geography and landmarks',
  'literature and authors',
  'visual art and art history',
  'classical and traditional music',
  'film, theatre, and television history',
  'mathematics and logic',
  'language, words, and linguistics',
  'computing, engineering, and invention history',
  'architecture and the built environment',
  'food science and culinary history',
  'plants, animals, and ecology',
  'mythology and folklore',
  'philosophy and major ideas',
  'archaeology and ancient civilizations',
  'transportation and exploration history',
  'objective facts about world cultures and traditions',
  'economics and foundational social science',
  'historic sports rules, terminology, and events',
]);
const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);
const RETRYABLE_CODES = new Set([
  'OPENAI_RATE_LIMIT',
  'OPENAI_UNAVAILABLE',
  'OPENAI_TIMEOUT',
  'OPENAI_INCOMPLETE',
  'OPENAI_EMPTY',
  'OPENAI_INVALID_RESPONSE',
]);

function parseInteger(value, name, { min, max }) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || String(parsed) !== String(value) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function parseArgs(argv = []) {
  const options = {
    target: TRIVIA_BANK_SIZE,
    output: DEFAULT_TRIVIA_BANK_PATH,
    concurrency: 3,
    batchSize: 20,
    requestTimeoutMs: 120000,
    maxRounds: 250,
    fresh: false,
    repair: false,
    dropIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--fresh') {
      options.fresh = true;
      continue;
    }
    if (argument === '--repair') {
      options.repair = true;
      continue;
    }
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) throw new Error(`${argument} requires a value`);
    index += 1;
    if (argument === '--target') options.target = parseInteger(next, '--target', { min: 1, max: TRIVIA_BANK_SIZE });
    else if (argument === '--output') options.output = path.resolve(next);
    else if (argument === '--concurrency') options.concurrency = parseInteger(next, '--concurrency', { min: 1, max: 8 });
    else if (argument === '--batch-size') options.batchSize = parseInteger(next, '--batch-size', { min: 1, max: 25 });
    else if (argument === '--timeout-ms') options.requestTimeoutMs = parseInteger(next, '--timeout-ms', { min: 5000, max: 300000 });
    else if (argument === '--max-rounds') options.maxRounds = parseInteger(next, '--max-rounds', { min: 1, max: 1000 });
    else if (argument === '--drop-id') {
      if (!/^luna_[a-f0-9]{20}$/.test(next)) throw new Error('--drop-id must be a Luna question id');
      options.dropIds.push(next);
    }
    else throw new Error(`Unknown option: ${argument}`);
  }

  options.output = path.resolve(options.output);
  options.dropIds = [...new Set(options.dropIds)].sort();
  if (options.dropIds.length && !options.repair) throw new Error('--drop-id requires --repair');
  return options;
}

function checkpointPath(output) {
  const fingerprint = crypto.createHash('sha256').update(path.resolve(output)).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), 'big-tuna-trivia', `${fingerprint}.json`);
}

function atomicWriteJson(filePath, value, { validate } = {}) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    if (typeof validate === 'function') validate(temporary);
    fs.renameSync(temporary, filePath);
  } finally {
    try { fs.unlinkSync(temporary); } catch {}
  }
}

function loadCheckpoint(filePath, options) {
  if (options.fresh || !fs.existsSync(filePath)) return null;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error(`Checkpoint is unreadable; rerun with --fresh (${filePath})`);
  }
  if (
    parsed?.model !== TRIVIA_MODEL
    || parsed?.target !== options.target
    || parsed?.output !== options.output
    || parsed?.repair !== options.repair
    || JSON.stringify(parsed?.dropIds || []) !== JSON.stringify(options.dropIds)
  ) {
    throw new Error(`Checkpoint does not match this run; rerun with --fresh (${filePath})`);
  }
  if (!Array.isArray(parsed.questions) || !Number.isInteger(parsed.rounds) || parsed.rounds < 0) {
    throw new Error(`Checkpoint is invalid; rerun with --fresh (${filePath})`);
  }
  const seen = [];
  const questions = parsed.questions.map(raw => {
    const question = validateCanonicalQuestion(raw, { exclude: seen });
    if (question.id !== canonicalQuestionId(question.question, question.correctAnswer)) {
      throw new Error('Checkpoint contains an invalid question id');
    }
    seen.push(question);
    return question;
  });
  if (questions.length > options.target) throw new Error('Checkpoint contains too many questions');
  return { questions, rounds: parsed.rounds };
}

function saveCheckpoint(filePath, options, state) {
  atomicWriteJson(filePath, {
    model: TRIVIA_MODEL,
    target: options.target,
    output: options.output,
    repair: options.repair,
    dropIds: options.dropIds,
    rounds: state.rounds,
    updatedAt: new Date().toISOString(),
    questions: state.questions,
  });
}

function loadRepairSeed(options) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(options.output, 'utf8'));
  } catch {
    throw new Error(`Repair source is unreadable: ${options.output}`);
  }
  if (
    !parsed || typeof parsed !== 'object' || Array.isArray(parsed)
    || parsed.schemaVersion !== TRIVIA_BANK_SCHEMA_VERSION
    || parsed.model !== TRIVIA_MODEL
    || parsed.verificationModel !== TRIVIA_MODEL
    || !Number.isInteger(parsed.verificationPasses)
    || parsed.verificationPasses < 2
    || !Array.isArray(parsed.questions)
    || parsed.count !== options.target
    || parsed.questions.length !== options.target
    || typeof parsed.generatedAt !== 'string'
    || Number.isNaN(Date.parse(parsed.generatedAt))
  ) {
    throw new Error('Repair source lacks valid twice-Luna-verified provenance');
  }

  const dropped = new Set(options.dropIds);
  const foundDropIds = new Set();
  const questions = [];
  let filtered = 0;
  for (const raw of parsed.questions) {
    if (dropped.has(raw?.id)) {
      foundDropIds.add(raw.id);
      filtered += 1;
      continue;
    }
    try {
      const question = validateCanonicalQuestion(raw, { exclude: questions });
      if (question.id !== canonicalQuestionId(question.question, question.correctAnswer)) {
        throw new Error('invalid question id');
      }
      questions.push(question);
    } catch {
      filtered += 1;
    }
  }
  const missingDropIds = options.dropIds.filter(id => !foundDropIds.has(id));
  if (missingDropIds.length) throw new Error(`Repair source does not contain --drop-id ${missingDropIds[0]}`);
  if (questions.length > options.target) questions.length = options.target;
  return { questions, rounds: 0, filtered };
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function withRetry(label, operation, attempts = 6) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!RETRYABLE_CODES.has(error?.code) || attempt === attempts) throw error;
      const waitMs = Math.min(20000, 750 * (2 ** (attempt - 1))) + crypto.randomInt(500);
      console.warn(`[trivia-bank] ${label} retry ${attempt}/${attempts - 1} after ${error.code}`);
      await delay(waitMs);
    }
  }
  throw lastError;
}

async function withRequestTimeout(timeoutMs, operation) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

async function generateVerifiedBatch({ apiKey, topic, difficulty, count, exclude, requestTimeoutMs }) {
  const candidates = await withRetry('generation', () => withRequestTimeout(requestTimeoutMs, signal => requestTriviaQuestions({
    apiKey,
    topic,
    difficulty,
    count,
    exclude,
    allowPartial: true,
    signal,
    reasoningEffort: 'medium',
  })));

  const verify = pass => withRetry(`verification-${pass}`, () => withRequestTimeout(requestTimeoutMs, signal => verifyTriviaQuestions({
    apiKey,
    questions: candidates,
    signal,
    reasoningEffort: 'medium',
  })));
  const [firstPass, secondPass] = await Promise.all([verify(1), verify(2)]);
  const questions = filterIndependentlyVerifiedQuestions(candidates, [firstPass, secondPass]);
  return { questions, generated: candidates.length, rejected: candidates.length - questions.length };
}

function makeWork(round, remaining, options, exclude) {
  const workerCount = Math.min(options.concurrency, Math.ceil(remaining / options.batchSize));
  const work = [];
  let unassigned = remaining;
  for (let worker = 0; worker < workerCount; worker += 1) {
    const count = Math.min(options.batchSize, unassigned);
    // Repairs should not restart at the first topic on every run. Offset by
    // the accepted seed size so small maintenance repairs rotate through the
    // same balanced topic/difficulty schedule as a full build.
    const sequence = exclude.length + (round * options.concurrency) + worker;
    work.push({
      topic: TOPICS[sequence % TOPICS.length],
      difficulty: DIFFICULTIES[sequence % DIFFICULTIES.length],
      count,
      exclude,
    });
    unassigned -= count;
  }
  return work;
}

async function buildBank(options, apiKey) {
  const checkpoint = checkpointPath(options.output);
  let state = loadCheckpoint(checkpoint, options);
  if (options.fresh && fs.existsSync(checkpoint)) fs.unlinkSync(checkpoint);
  if (!state) state = options.repair ? loadRepairSeed(options) : { questions: [], rounds: 0 };
  let consecutiveEmptyRounds = 0;

  const seedNote = options.repair ? ` repairFiltered=${state.filtered || 0}` : '';
  console.log(`[trivia-bank] model=${TRIVIA_MODEL} target=${options.target} resumed=${state.questions.length}${seedNote}`);
  while (state.questions.length < options.target) {
    if (state.rounds >= options.maxRounds) throw new Error(`Stopped after ${options.maxRounds} rounds; checkpoint preserved`);
    const remaining = options.target - state.questions.length;
    const exclude = state.questions.slice();
    const work = makeWork(state.rounds, remaining, options, exclude);
    const results = await Promise.all(work.map(item => generateVerifiedBatch({
      apiKey,
      requestTimeoutMs: options.requestTimeoutMs,
      ...item,
    })));
    state.rounds += 1;

    let added = 0;
    let generated = 0;
    let rejected = 0;
    for (const result of results) {
      generated += result.generated;
      rejected += result.rejected;
      for (const raw of result.questions) {
        if (state.questions.length >= options.target) break;
        let question;
        try {
          question = validateCanonicalQuestion(raw, { exclude: state.questions });
        } catch {
          rejected += 1;
          continue;
        }
        state.questions.push(question);
        added += 1;
      }
    }
    consecutiveEmptyRounds = added ? 0 : consecutiveEmptyRounds + 1;
    saveCheckpoint(checkpoint, options, state);
    console.log(`[trivia-bank] round=${state.rounds} accepted=${state.questions.length}/${options.target} added=${added} rejected=${rejected}/${generated}`);
    if (consecutiveEmptyRounds >= 8) throw new Error('Eight rounds produced no independently verified questions; checkpoint preserved');
  }

  const bank = {
    schemaVersion: TRIVIA_BANK_SCHEMA_VERSION,
    model: TRIVIA_MODEL,
    generatedAt: new Date().toISOString(),
    count: options.target,
    verificationModel: TRIVIA_MODEL,
    verificationPasses: 2,
    questions: state.questions.slice(0, options.target),
  };
  atomicWriteJson(options.output, bank, {
    validate: temporary => loadTriviaBank(temporary, { expectedSize: options.target }),
  });
  try { fs.unlinkSync(checkpoint); } catch {}
  return bank;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is required');
  const started = Date.now();
  const bank = await buildBank(options, apiKey);
  console.log(`[trivia-bank] complete count=${bank.count} seconds=${((Date.now() - started) / 1000).toFixed(1)} output=${options.output}`);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[trivia-bank] failed (${error?.code || 'ERROR'}): ${error?.message || 'Unknown error'}`);
    process.exitCode = 1;
  });
}

module.exports = {
  TOPICS,
  DIFFICULTIES,
  parseArgs,
  checkpointPath,
  loadCheckpoint,
  loadRepairSeed,
  makeWork,
  buildBank,
};

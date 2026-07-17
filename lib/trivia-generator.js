const crypto = require('crypto');

const REGIONS = ['Africa', 'Asia', 'Europe', 'the Americas', 'Oceania'];

// A compact, deterministic safety bank keeps Trivia playable while Ollama is
// cold, busy, updating, or offline. Capital facts create three independently
// worded questions each, so every difficulty has enough material for a long
// run without making the source file enormous.
const CAPITAL_FACTS = [
  // Easy
  { country: 'Canada', capital: 'Ottawa', region: 'the Americas', difficulty: 'easy' },
  { country: 'United States', capital: 'Washington, D.C.', region: 'the Americas', difficulty: 'easy' },
  { country: 'France', capital: 'Paris', region: 'Europe', difficulty: 'easy' },
  { country: 'United Kingdom', capital: 'London', region: 'Europe', difficulty: 'easy' },
  { country: 'Japan', capital: 'Tokyo', region: 'Asia', difficulty: 'easy' },
  { country: 'China', capital: 'Beijing', region: 'Asia', difficulty: 'easy' },
  { country: 'Australia', capital: 'Canberra', region: 'Oceania', difficulty: 'easy' },
  { country: 'Italy', capital: 'Rome', region: 'Europe', difficulty: 'easy' },
  { country: 'Germany', capital: 'Berlin', region: 'Europe', difficulty: 'easy' },
  { country: 'Spain', capital: 'Madrid', region: 'Europe', difficulty: 'easy' },
  { country: 'India', capital: 'New Delhi', region: 'Asia', difficulty: 'easy' },
  { country: 'Mexico', capital: 'Mexico City', region: 'the Americas', difficulty: 'easy' },
  { country: 'Brazil', capital: 'Brasilia', region: 'the Americas', difficulty: 'easy' },
  { country: 'Egypt', capital: 'Cairo', region: 'Africa', difficulty: 'easy' },
  { country: 'South Korea', capital: 'Seoul', region: 'Asia', difficulty: 'easy' },
  { country: 'Austria', capital: 'Vienna', region: 'Europe', difficulty: 'easy' },
  { country: 'Argentina', capital: 'Buenos Aires', region: 'the Americas', difficulty: 'easy' },
  { country: 'Thailand', capital: 'Bangkok', region: 'Asia', difficulty: 'easy' },
  { country: 'Greece', capital: 'Athens', region: 'Europe', difficulty: 'easy' },
  { country: 'Ireland', capital: 'Dublin', region: 'Europe', difficulty: 'easy' },

  // Medium
  { country: 'New Zealand', capital: 'Wellington', region: 'Oceania', difficulty: 'medium' },
  { country: 'Norway', capital: 'Oslo', region: 'Europe', difficulty: 'medium' },
  { country: 'Sweden', capital: 'Stockholm', region: 'Europe', difficulty: 'medium' },
  { country: 'Finland', capital: 'Helsinki', region: 'Europe', difficulty: 'medium' },
  { country: 'Poland', capital: 'Warsaw', region: 'Europe', difficulty: 'medium' },
  { country: 'Portugal', capital: 'Lisbon', region: 'Europe', difficulty: 'medium' },
  { country: 'Turkey', capital: 'Ankara', region: 'Asia', difficulty: 'medium' },
  { country: 'Saudi Arabia', capital: 'Riyadh', region: 'Asia', difficulty: 'medium' },
  { country: 'United Arab Emirates', capital: 'Abu Dhabi', region: 'Asia', difficulty: 'medium' },
  { country: 'Pakistan', capital: 'Islamabad', region: 'Asia', difficulty: 'medium' },
  { country: 'Vietnam', capital: 'Hanoi', region: 'Asia', difficulty: 'medium' },
  { country: 'Philippines', capital: 'Manila', region: 'Asia', difficulty: 'medium' },
  { country: 'Nigeria', capital: 'Abuja', region: 'Africa', difficulty: 'medium' },
  { country: 'Kenya', capital: 'Nairobi', region: 'Africa', difficulty: 'medium' },
  { country: 'Morocco', capital: 'Rabat', region: 'Africa', difficulty: 'medium' },
  { country: 'Chile', capital: 'Santiago', region: 'the Americas', difficulty: 'medium' },
  { country: 'Peru', capital: 'Lima', region: 'the Americas', difficulty: 'medium' },
  { country: 'Colombia', capital: 'Bogota', region: 'the Americas', difficulty: 'medium' },
  { country: 'Cuba', capital: 'Havana', region: 'the Americas', difficulty: 'medium' },
  { country: 'Jamaica', capital: 'Kingston', region: 'the Americas', difficulty: 'medium' },

  // Hard
  { country: 'Bhutan', capital: 'Thimphu', region: 'Asia', difficulty: 'hard' },
  { country: 'Kyrgyzstan', capital: 'Bishkek', region: 'Asia', difficulty: 'hard' },
  { country: 'Tajikistan', capital: 'Dushanbe', region: 'Asia', difficulty: 'hard' },
  { country: 'Turkmenistan', capital: 'Ashgabat', region: 'Asia', difficulty: 'hard' },
  { country: 'Myanmar', capital: 'Naypyidaw', region: 'Asia', difficulty: 'hard' },
  { country: 'Laos', capital: 'Vientiane', region: 'Asia', difficulty: 'hard' },
  { country: 'Sri Lanka', capital: 'Sri Jayawardenepura Kotte', region: 'Asia', difficulty: 'hard' },
  { country: 'Burkina Faso', capital: 'Ouagadougou', region: 'Africa', difficulty: 'hard' },
  { country: "Cote d'Ivoire", capital: 'Yamoussoukro', region: 'Africa', difficulty: 'hard' },
  { country: 'Tanzania', capital: 'Dodoma', region: 'Africa', difficulty: 'hard' },
  { country: 'Burundi', capital: 'Gitega', region: 'Africa', difficulty: 'hard' },
  { country: 'Botswana', capital: 'Gaborone', region: 'Africa', difficulty: 'hard' },
  { country: 'Namibia', capital: 'Windhoek', region: 'Africa', difficulty: 'hard' },
  { country: 'Suriname', capital: 'Paramaribo', region: 'the Americas', difficulty: 'hard' },
  { country: 'Belize', capital: 'Belmopan', region: 'the Americas', difficulty: 'hard' },
  { country: 'Paraguay', capital: 'Asuncion', region: 'the Americas', difficulty: 'hard' },
  { country: 'Montenegro', capital: 'Podgorica', region: 'Europe', difficulty: 'hard' },
  { country: 'Moldova', capital: 'Chisinau', region: 'Europe', difficulty: 'hard' },
  { country: 'Liechtenstein', capital: 'Vaduz', region: 'Europe', difficulty: 'hard' },
  { country: 'Palau', capital: 'Ngerulmud', region: 'Oceania', difficulty: 'hard' },
];

const CURATED_QUESTIONS = [
  {
    question: 'Which planet is commonly called the Red Planet?',
    answers: ['Mars', 'Venus', 'Jupiter', 'Mercury'],
    correct: 0,
    category: 'Science',
    difficulty: 'easy',
    explanation: 'Iron minerals in the Martian soil oxidize, giving Mars its reddish appearance.',
    tags: ['science', 'space', 'astronomy', 'planets'],
  },
  {
    question: 'Who wrote the play Romeo and Juliet?',
    answers: ['William Shakespeare', 'Charles Dickens', 'Jane Austen', 'Oscar Wilde'],
    correct: 0,
    category: 'Literature',
    difficulty: 'easy',
    explanation: 'Shakespeare wrote the tragedy early in his career, probably in the 1590s.',
    tags: ['literature', 'books', 'plays', 'shakespeare'],
  },
  {
    question: 'Which is the largest ocean on Earth?',
    answers: ['Pacific Ocean', 'Atlantic Ocean', 'Indian Ocean', 'Arctic Ocean'],
    correct: 0,
    category: 'Geography',
    difficulty: 'easy',
    explanation: 'The Pacific covers more area than all of Earth’s land combined.',
    tags: ['geography', 'earth', 'oceans', 'nature'],
  },
  {
    question: 'What is the chemical formula for water?',
    answers: ['H2O', 'CO2', 'O2', 'NaCl'],
    correct: 0,
    category: 'Science',
    difficulty: 'easy',
    explanation: 'Each water molecule contains two hydrogen atoms and one oxygen atom.',
    tags: ['science', 'chemistry', 'water'],
  },
  {
    question: 'How many sides does a hexagon have?',
    answers: ['Six', 'Five', 'Seven', 'Eight'],
    correct: 0,
    category: 'Mathematics',
    difficulty: 'easy',
    explanation: 'The prefix hex- means six, so a hexagon has six sides.',
    tags: ['math', 'mathematics', 'geometry', 'shapes'],
  },
  {
    question: 'Who painted the Mona Lisa?',
    answers: ['Leonardo da Vinci', 'Vincent van Gogh', 'Claude Monet', 'Pablo Picasso'],
    correct: 0,
    category: 'Art',
    difficulty: 'easy',
    explanation: 'Leonardo painted the portrait during the Italian Renaissance.',
    tags: ['art', 'painting', 'renaissance', 'leonardo'],
  },
  {
    question: 'Which of these mammals lays eggs?',
    answers: ['Platypus', 'Dolphin', 'Bat', 'Kangaroo'],
    correct: 0,
    category: 'Nature',
    difficulty: 'easy',
    explanation: 'The platypus is a monotreme, one of the rare mammals that lays eggs.',
    tags: ['nature', 'animals', 'biology', 'mammals'],
  },
  {
    question: 'Which instrument normally has 88 keys?',
    answers: ['Piano', 'Violin', 'Trumpet', 'Flute'],
    correct: 0,
    category: 'Music',
    difficulty: 'easy',
    explanation: 'A standard modern piano keyboard spans 88 black and white keys.',
    tags: ['music', 'instruments', 'piano'],
  },
  {
    question: 'Which gas do plants absorb during photosynthesis?',
    answers: ['Carbon dioxide', 'Oxygen', 'Helium', 'Hydrogen'],
    correct: 0,
    category: 'Science',
    difficulty: 'easy',
    explanation: 'Plants use carbon dioxide, water, and light to make sugars during photosynthesis.',
    tags: ['science', 'biology', 'plants', 'nature'],
  },
  {
    question: 'Wimbledon is a major tournament in which sport?',
    answers: ['Tennis', 'Golf', 'Cricket', 'Rugby'],
    correct: 0,
    category: 'Sport',
    difficulty: 'easy',
    explanation: 'Wimbledon is the oldest of tennis’s four Grand Slam tournaments.',
    tags: ['sport', 'sports', 'tennis', 'wimbledon'],
  },
  {
    question: 'What is the official language of Brazil?',
    answers: ['Portuguese', 'Spanish', 'French', 'Italian'],
    correct: 0,
    category: 'Geography',
    difficulty: 'easy',
    explanation: 'Brazil was colonized by Portugal, making Portuguese its official language.',
    tags: ['geography', 'languages', 'brazil', 'portuguese'],
  },
  {
    question: 'Which month begins the calendar year?',
    answers: ['January', 'March', 'June', 'December'],
    correct: 0,
    category: 'General',
    difficulty: 'easy',
    explanation: 'January is the first month in the Gregorian calendar.',
    tags: ['general', 'calendar', 'time'],
  },

  {
    question: 'Which element has the atomic number 79?',
    answers: ['Gold', 'Silver', 'Copper', 'Platinum'],
    correct: 0,
    category: 'Science',
    difficulty: 'medium',
    explanation: 'Gold is element 79 and uses the chemical symbol Au.',
    tags: ['science', 'chemistry', 'elements', 'gold'],
  },
  {
    question: 'Which treaty formally ended World War I between Germany and the Allied powers?',
    answers: ['Treaty of Versailles', 'Treaty of Paris', 'Treaty of Utrecht', 'Treaty of Tordesillas'],
    correct: 0,
    category: 'History',
    difficulty: 'medium',
    explanation: 'The Treaty of Versailles was signed in 1919 after the fighting ended in 1918.',
    tags: ['history', 'war', 'world war one', 'wwi'],
  },
  {
    question: 'Which pair names the two moons of Mars?',
    answers: ['Phobos and Deimos', 'Io and Europa', 'Titan and Rhea', 'Ariel and Umbriel'],
    correct: 0,
    category: 'Science',
    difficulty: 'medium',
    explanation: 'Mars’s two small moons are named Phobos and Deimos.',
    tags: ['science', 'space', 'astronomy', 'mars', 'moons'],
  },
  {
    question: 'Who wrote the science-fiction novel Dune?',
    answers: ['Frank Herbert', 'Isaac Asimov', 'Arthur C. Clarke', 'Ray Bradbury'],
    correct: 0,
    category: 'Literature',
    difficulty: 'medium',
    explanation: 'Frank Herbert published Dune in 1965.',
    tags: ['literature', 'books', 'science fiction', 'dune'],
  },
  {
    question: 'What was the name of the first artificial satellite placed in orbit?',
    answers: ['Sputnik 1', 'Explorer 1', 'Vostok 1', 'Luna 2'],
    correct: 0,
    category: 'Science',
    difficulty: 'medium',
    explanation: 'The Soviet Union launched Sputnik 1 in October 1957.',
    tags: ['science', 'space', 'history', 'satellites'],
  },
  {
    question: 'Which city served as the capital of the Byzantine Empire?',
    answers: ['Constantinople', 'Alexandria', 'Antioch', 'Athens'],
    correct: 0,
    category: 'History',
    difficulty: 'medium',
    explanation: 'Constantinople, now Istanbul, was the empire’s political and cultural center.',
    tags: ['history', 'byzantine', 'cities', 'empires'],
  },
  {
    question: 'What is the SI unit of electrical resistance?',
    answers: ['Ohm', 'Volt', 'Ampere', 'Watt'],
    correct: 0,
    category: 'Science',
    difficulty: 'medium',
    explanation: 'Electrical resistance is measured in ohms, represented by the omega symbol.',
    tags: ['science', 'physics', 'electricity'],
  },
  {
    question: 'Who painted The Persistence of Memory?',
    answers: ['Salvador Dali', 'Joan Miro', 'Henri Matisse', 'Edvard Munch'],
    correct: 0,
    category: 'Art',
    difficulty: 'medium',
    explanation: 'Salvador Dali’s surrealist painting is famous for its melting clocks.',
    tags: ['art', 'painting', 'surrealism', 'dali'],
  },
  {
    question: 'Which river flows through Budapest?',
    answers: ['Danube', 'Rhine', 'Seine', 'Po'],
    correct: 0,
    category: 'Geography',
    difficulty: 'medium',
    explanation: 'The Danube separates the historic Buda and Pest sides of the city.',
    tags: ['geography', 'rivers', 'budapest', 'europe'],
  },
  {
    question: 'Which band released the album The Dark Side of the Moon?',
    answers: ['Pink Floyd', 'Led Zeppelin', 'The Who', 'Queen'],
    correct: 0,
    category: 'Music',
    difficulty: 'medium',
    explanation: 'Pink Floyd released the landmark album in 1973.',
    tags: ['music', 'albums', 'rock', 'pink floyd'],
  },
  {
    question: 'What is the largest moon in the Solar System?',
    answers: ['Ganymede', 'Titan', 'Europa', 'Earth’s Moon'],
    correct: 0,
    category: 'Science',
    difficulty: 'medium',
    explanation: 'Jupiter’s moon Ganymede is even larger than the planet Mercury.',
    tags: ['science', 'space', 'astronomy', 'moons'],
  },
  {
    question: 'In computing, what does HTTP stand for?',
    answers: ['Hypertext Transfer Protocol', 'High Transfer Text Process', 'Host Terminal Transport Program', 'Hyperlink Transmission Path'],
    correct: 0,
    category: 'Technology',
    difficulty: 'medium',
    explanation: 'HTTP is the application protocol used to transfer web resources.',
    tags: ['technology', 'computers', 'internet', 'web'],
  },

  {
    question: 'Which chemical symbol represents tungsten?',
    answers: ['W', 'Tg', 'Tu', 'Sn'],
    correct: 0,
    category: 'Science',
    difficulty: 'hard',
    explanation: 'Tungsten uses W from its older name, wolfram.',
    tags: ['science', 'chemistry', 'elements', 'tungsten'],
  },
  {
    question: 'Which conflict was ended by the Peace of Westphalia in 1648?',
    answers: ['Thirty Years’ War', 'Seven Years’ War', 'War of the Roses', 'Crimean War'],
    correct: 0,
    category: 'History',
    difficulty: 'hard',
    explanation: 'The Westphalian treaties ended the Thirty Years’ War in the Holy Roman Empire.',
    tags: ['history', 'war', 'europe', 'westphalia'],
  },
  {
    question: 'Who is traditionally credited with writing The Tale of Genji?',
    answers: ['Murasaki Shikibu', 'Sei Shonagon', 'Yosano Akiko', 'Izumi Shikibu'],
    correct: 0,
    category: 'Literature',
    difficulty: 'hard',
    explanation: 'Murasaki Shikibu wrote the Japanese court classic around the early 11th century.',
    tags: ['literature', 'books', 'japan', 'genji'],
  },
  {
    question: 'Which is the closest star system to the Solar System?',
    answers: ['Alpha Centauri', 'Sirius', 'Barnard’s Star', 'Epsilon Eridani'],
    correct: 0,
    category: 'Science',
    difficulty: 'hard',
    explanation: 'The Alpha Centauri system is about 4.37 light-years away.',
    tags: ['science', 'space', 'astronomy', 'stars'],
  },
  {
    question: 'Which enzyme unwinds the DNA double helix during replication?',
    answers: ['Helicase', 'Ligase', 'Amylase', 'Catalase'],
    correct: 0,
    category: 'Science',
    difficulty: 'hard',
    explanation: 'Helicase separates the two DNA strands so they can be copied.',
    tags: ['science', 'biology', 'dna', 'genetics'],
  },
  {
    question: 'Which volcano’s 1815 eruption caused the “Year Without a Summer”?',
    answers: ['Mount Tambora', 'Krakatoa', 'Mount Vesuvius', 'Mount Pinatubo'],
    correct: 0,
    category: 'History',
    difficulty: 'hard',
    explanation: 'Tambora’s enormous eruption cooled global temperatures during 1816.',
    tags: ['history', 'nature', 'volcanoes', 'climate'],
  },
  {
    question: 'Triton is the largest moon of which planet?',
    answers: ['Neptune', 'Uranus', 'Saturn', 'Jupiter'],
    correct: 0,
    category: 'Science',
    difficulty: 'hard',
    explanation: 'Triton orbits Neptune in a retrograde direction.',
    tags: ['science', 'space', 'astronomy', 'moons'],
  },
  {
    question: 'Who composed the ballet The Rite of Spring?',
    answers: ['Igor Stravinsky', 'Sergei Prokofiev', 'Claude Debussy', 'Gustav Mahler'],
    correct: 0,
    category: 'Music',
    difficulty: 'hard',
    explanation: 'Stravinsky’s rhythmically radical ballet premiered in Paris in 1913.',
    tags: ['music', 'classical', 'ballet', 'stravinsky'],
  },
  {
    question: 'Which European language is generally classified as a language isolate?',
    answers: ['Basque', 'Catalan', 'Welsh', 'Albanian'],
    correct: 0,
    category: 'Language',
    difficulty: 'hard',
    explanation: 'Basque has no demonstrated genealogical relationship to another living language.',
    tags: ['language', 'languages', 'europe', 'basque'],
  },
  {
    question: 'Who painted The Arnolfini Portrait?',
    answers: ['Jan van Eyck', 'Albrecht Durer', 'Hans Holbein the Younger', 'Hieronymus Bosch'],
    correct: 0,
    category: 'Art',
    difficulty: 'hard',
    explanation: 'Jan van Eyck completed the richly detailed oil painting in 1434.',
    tags: ['art', 'painting', 'renaissance', 'van eyck'],
  },
  {
    question: 'Which theorem states that no three positive integers satisfy a^n + b^n = c^n for n greater than 2?',
    answers: ['Fermat’s Last Theorem', 'Pythagorean theorem', 'Bayes’ theorem', 'Four color theorem'],
    correct: 0,
    category: 'Mathematics',
    difficulty: 'hard',
    explanation: 'Andrew Wiles proved Fermat’s centuries-old claim in the 1990s.',
    tags: ['math', 'mathematics', 'theorems', 'fermat'],
  },
  {
    question: 'What is the deepest known point in Earth’s oceans?',
    answers: ['Challenger Deep', 'Tonga Trench', 'Puerto Rico Trench', 'Java Trench'],
    correct: 0,
    category: 'Geography',
    difficulty: 'hard',
    explanation: 'Challenger Deep lies in the Mariana Trench in the western Pacific.',
    tags: ['geography', 'oceans', 'earth', 'nature'],
  },
];

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function normalizeQuestionText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[?.!]+$/, '')
    .trim();
}

function buildCapitalQuestions() {
  const questions = [];
  for (const difficulty of ['easy', 'medium', 'hard']) {
    const group = CAPITAL_FACTS.filter(fact => fact.difficulty === difficulty);
    group.forEach((fact, index) => {
      const distractors = [1, 7, 13].map(offset => group[(index + offset) % group.length]);
      const tags = [
        'geography', 'world', 'country', 'countries', 'capital', 'capitals',
        fact.country.toLowerCase(), fact.capital.toLowerCase(), fact.region.toLowerCase(),
      ];

      questions.push({
        question: `What is the capital of ${fact.country}?`,
        answers: [fact.capital, ...distractors.map(item => item.capital)],
        correct: 0,
        category: 'Geography',
        difficulty,
        explanation: `${fact.capital} is the capital of ${fact.country}.`,
        tags,
      });
      questions.push({
        question: `${fact.capital} is the capital of which country?`,
        answers: [fact.country, ...distractors.map(item => item.country)],
        correct: 0,
        category: 'Geography',
        difficulty,
        explanation: `${fact.capital} is the capital city of ${fact.country}.`,
        tags,
      });
      questions.push({
        question: `In which world region is ${fact.capital}, the capital of ${fact.country}?`,
        answers: [fact.region, ...REGIONS.filter(region => region !== fact.region).slice(0, 3)],
        correct: 0,
        category: 'Geography',
        difficulty,
        explanation: `${fact.capital} is in ${fact.region} and is the capital of ${fact.country}.`,
        tags,
      });
    });
  }
  return questions;
}

const FALLBACK_QUESTIONS = Object.freeze([
  ...CURATED_QUESTIONS,
  ...buildCapitalQuestions(),
]);

function buildTriviaMessages(topic, count, difficulty, exclude) {
  const subject = topic
    ? `Topic: ${topic}.`
    : 'Use varied general knowledge: science, history, geography, sport, music, film, art, literature, technology, nature, food, and pop culture.';
  const difficultyRule = ['easy', 'medium', 'hard'].includes(difficulty)
    ? `Every item must have d="${difficulty}".`
    : 'Mix d values naturally among easy, medium, and hard.';
  const avoid = Array.isArray(exclude)
    ? exclude.filter(item => typeof item === 'string' && item.trim()).slice(-18)
    : [];
  const avoidRule = avoid.length
    ? `Do not repeat or paraphrase these earlier questions: ${avoid.map(item => JSON.stringify(item)).join(', ')}.`
    : '';

  return [
    {
      role: 'system',
      content: [
        'Create accurate multiple-choice trivia. Output only one compact JSON object with no markdown.',
        'Shape: {"questions":[{"q":"question?","a":["answer one","answer two","answer three","answer four"],"c":0,"g":"category","d":"easy","e":"short fact"}]}.',
        'The four entries in "a" must be the ACTUAL answer texts, never letters such as A/B/C/D and never placeholders.',
        'Each item needs exactly four distinct concise answers, one correct 0-based index, a self-contained question, and a one-sentence explanation under 120 characters.',
        'Use only stable facts you are highly confident are true; avoid disputed, ambiguous, or time-sensitive claims.',
        'Wrong answers must be plausible but unambiguously wrong. Do not add keys or prose.',
        'Example: {"questions":[{"q":"What is the capital of Canada?","a":["Ottawa","Toronto","Montreal","Vancouver"],"c":0,"g":"Geography","d":"easy","e":"Ottawa became Canada’s capital in 1857."}]}.',
      ].join(' '),
    },
    {
      role: 'user',
      content: `Generate exactly ${count} new question${count === 1 ? '' : 's'}. ${subject} ${difficultyRule} ${avoidRule}`.trim(),
    },
  ];
}

function buildTriviaFormat(count) {
  const safeCount = Math.max(1, Math.min(10, Number.parseInt(count, 10) || 1));
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      questions: {
        type: 'array',
        minItems: safeCount,
        maxItems: safeCount,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            q: { type: 'string' },
            a: {
              type: 'array',
              minItems: 4,
              maxItems: 4,
              items: { type: 'string' },
            },
            c: { type: 'integer', minimum: 0, maximum: 3 },
            g: { type: 'string' },
            d: { type: 'string', enum: ['easy', 'medium', 'hard'] },
            e: { type: 'string' },
          },
          required: ['q', 'a', 'c', 'g', 'd', 'e'],
        },
      },
    },
    required: ['questions'],
  };
}

function extractTriviaArray(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.questions)) return parsed.questions;
  if (parsed && Array.isArray(parsed.items)) return parsed.items;
  if (parsed && typeof parsed === 'object') {
    const values = Object.values(parsed);
    if (values.length && values.every(value => value && typeof value === 'object' && ('question' in value || 'q' in value))) {
      return values;
    }
  }
  return [];
}

function validateTriviaQuestions(rawList, limit, excludeSet) {
  const out = [];
  const seen = new Set(excludeSet instanceof Set ? excludeSet : []);
  for (const raw of Array.isArray(rawList) ? rawList : []) {
    if (out.length >= limit) break;
    if (!raw || typeof raw !== 'object') continue;

    const questionValue = raw.question ?? raw.q;
    const question = typeof questionValue === 'string' ? questionValue.trim().slice(0, 500) : '';
    if (!question) continue;

    const answersRaw = Array.isArray(raw.answers) ? raw.answers
      : Array.isArray(raw.options) ? raw.options
        : Array.isArray(raw.a) ? raw.a : [];
    const answers = answersRaw
      .map(answer => (typeof answer === 'string'
        ? answer.trim().slice(0, 240)
        : (answer == null ? '' : String(answer).trim().slice(0, 240))))
      .filter(Boolean);
    if (answers.length !== 4) continue;
    if (new Set(answers.map(answer => answer.toLowerCase())).size !== 4) continue;
    if (answers.every(answer => /^[a-d](?:[.)])?$/i.test(answer))) continue;
    if (answers.some(answer => /^(answer|option|choice)\s*[a-d0-4]?$/i.test(answer))) continue;

    let correct = Number(raw.correct ?? raw.c);
    if (!Number.isInteger(correct) || correct < 0 || correct > 3) {
      const correctText = String(raw.answer ?? raw.correctAnswer ?? '').trim().toLowerCase();
      const byText = answers.findIndex(answer => answer.toLowerCase() === correctText);
      if (byText < 0) continue;
      correct = byText;
    }

    const dedupeKey = normalizeQuestionText(question);
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const correctText = answers[correct];
    shuffleInPlace(answers);
    const newCorrect = answers.indexOf(correctText);
    const rawDifficulty = String(raw.difficulty ?? raw.d ?? '').toLowerCase();
    const normalizedDifficulty = ['easy', 'medium', 'hard'].includes(rawDifficulty)
      ? rawDifficulty : 'medium';
    const categoryValue = raw.category ?? raw.g;
    const category = typeof categoryValue === 'string' && categoryValue.trim()
      ? categoryValue.trim().slice(0, 40) : 'General';
    const explanationValue = raw.explanation ?? raw.explain ?? raw.e;
    const explanation = typeof explanationValue === 'string'
      ? explanationValue.trim().slice(0, 300) : '';

    out.push({
      id: crypto.randomUUID(),
      question,
      answers,
      correct: newCorrect,
      category,
      difficulty: normalizedDifficulty,
      explanation,
    });
  }
  return out;
}

function questionMatchesTopic(raw, topic) {
  const normalizedTopic = normalizeQuestionText(topic);
  if (!normalizedTopic) return true;
  const terms = normalizedTopic.split(/[^a-z0-9]+/).filter(term => term.length >= 3);
  const haystack = [
    raw.question,
    raw.category,
    ...(raw.answers || []),
    ...(raw.tags || []),
  ].map(normalizeQuestionText).join(' ');
  return haystack.includes(normalizedTopic) || terms.some(term => haystack.includes(term));
}

function selectFallbackQuestions({ topic = '', difficulty = 'any', count = 1, exclude = [] } = {}) {
  if (String(topic || '').trim()) {
    return {
      topicMatched: false,
      questions: [],
    };
  }

  const safeCount = Math.max(1, Math.min(10, Number.parseInt(count, 10) || 1));
  const excludeSet = new Set(
    (Array.isArray(exclude) ? exclude : [])
      .filter(item => typeof item === 'string')
      .map(normalizeQuestionText)
      .filter(Boolean)
  );
  const difficultyPool = FALLBACK_QUESTIONS.filter(question =>
    !['easy', 'medium', 'hard'].includes(difficulty) || question.difficulty === difficulty
  );
  shuffleInPlace(difficultyPool);

  return {
    topicMatched: true,
    questions: validateTriviaQuestions(difficultyPool, safeCount, excludeSet),
  };
}

function pickTriviaModel(models, requestedModel = '') {
  const available = Array.isArray(models) ? models.filter(model => model && model.name) : [];
  if (!available.length) return null;
  if (requestedModel) {
    const exact = available.find(model => model.name === requestedModel);
    if (exact) return exact.name;
  }

  const preferences = [
    /^qwen2\.5:1\.5b$/i,
    /phi4-mini/i,
    /gemma3:4b/i,
    /^qwen2\.5:0\.5b$/i,
    /qwen2\.5.*1\.5b/i,
    /qwen2\.5.*0\.5b/i,
    /llama3\.1:8b/i,
    /mistral:7b/i,
  ];
  for (const pattern of preferences) {
    const match = available.find(model => pattern.test(model.name));
    if (match) return match.name;
  }
  const general = available.find(model => !/(coder|deepseek|llava|moondream)/i.test(model.name));
  return (general || available[0]).name;
}

module.exports = {
  buildTriviaFormat,
  buildTriviaMessages,
  extractTriviaArray,
  normalizeQuestionText,
  pickTriviaModel,
  selectFallbackQuestions,
  validateTriviaQuestions,
  _test: {
    CAPITAL_FACTS,
    CURATED_QUESTIONS,
    FALLBACK_QUESTIONS,
    questionMatchesTopic,
  },
};

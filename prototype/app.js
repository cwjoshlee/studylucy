const MODES = [
  {
    id: "korean",
    icon: "책",
    title: "동화 읽기",
    subtitle: "짧은 단락 읽기"
  },
  {
    id: "math",
    icon: "1",
    title: "수학 문제",
    subtitle: "지문 읽고 답하기"
  },
  {
    id: "mixed",
    icon: "+",
    title: "오늘 연습",
    subtitle: "동화와 수학 같이"
  }
];

const PROBLEMS = [
  {
    id: "ko-01",
    mode: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 1",
    level: "1단계",
    readLabel: "동화 단락 읽기",
    text: "수아는 작은 숲길에서 반짝이는 돌멩이를 보았어요. 돌멩이는 별빛처럼 조용히 빛났어요.",
    hint: "Read one sentence at a time. You can pause at the period.",
    tokens: ["수아", "숲길", "반짝이는", "돌멩이", "별빛"]
  },
  {
    id: "ko-02",
    mode: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 2",
    level: "1단계",
    readLabel: "동화 단락 읽기",
    text: "수아는 돌멩이를 손에 올리고 천천히 걸었어요. 길 끝에는 낮은 문이 있는 파란 집이 있었어요.",
    hint: "Slow reading is good reading.",
    tokens: ["돌멩이", "손", "천천히", "길", "파란 집"]
  },
  {
    id: "ko-03",
    mode: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 3",
    level: "2단계",
    readLabel: "동화 단락 읽기",
    text: "문 앞에는 작은 종이 매달려 있었어요. 수아가 종을 살짝 치자 집 안에서 따뜻한 불빛이 켜졌어요.",
    hint: "Look carefully at final consonants.",
    tokens: ["문 앞", "작은 종", "매달려", "살짝", "따뜻한 불빛"]
  },
  {
    id: "ko-04",
    mode: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 4",
    level: "2단계",
    readLabel: "동화 단락 읽기",
    text: "파란 집의 할머니는 길을 잃은 별을 찾고 있었어요. 수아는 돌멩이가 별의 조각일지도 모른다고 생각했어요.",
    hint: "Read to the end before checking meaning.",
    tokens: ["할머니", "길을 잃은 별", "돌멩이", "별의 조각", "생각했어요"]
  },
  {
    id: "ko-05",
    mode: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 5",
    level: "3단계",
    readLabel: "동화 단락 읽기",
    text: "수아가 돌멩이를 하늘로 들어 올리자 작은 별 하나가 반짝였어요. 별은 제자리로 돌아가며 고맙다고 속삭였어요.",
    hint: "Two sentences. Pause once, then continue.",
    tokens: ["하늘", "작은 별", "반짝였어요", "제자리", "속삭였어요"]
  },
  {
    id: "ko-06",
    mode: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 6",
    level: "3단계",
    readLabel: "동화 단락 읽기",
    text: "집으로 돌아오는 길에 숲길은 더 이상 어둡지 않았어요. 수아의 마음에도 작은 등불이 켜진 것 같았어요.",
    hint: "Notice the feeling in the final sentence.",
    tokens: ["집", "숲길", "어둡지", "마음", "작은 등불"]
  },
  {
    id: "math-01",
    mode: "math",
    unit: "수학 이야기",
    title: "꽃을 세어요",
    level: "1단계",
    readLabel: "수학 지문 읽기",
    text: "수아는 숲길에서 빨간 꽃 4송이와 노란 꽃 3송이를 보았어요.",
    question: "꽃은 모두 몇 송이일까요?",
    hint: "Find both numbers before adding.",
    tokens: ["수아", "숲길", "빨간 꽃", "4송이", "노란 꽃", "3송이", "모두"],
    answer: 7,
    unitLabel: "송이",
    checkHint: "빨간 꽃 4송이와 노란 꽃 3송이를 다시 찾아보자."
  },
  {
    id: "math-02",
    mode: "math",
    unit: "수학 이야기",
    title: "쿠키가 남았어요",
    level: "2단계",
    readLabel: "수학 지문 읽기",
    text: "작은 요정은 쿠키 9개를 접시에 놓았어요. 친구들이 쿠키 4개를 먹었어요.",
    question: "남은 쿠키는 몇 개일까요?",
    hint: "This is a take-away problem.",
    tokens: ["요정", "쿠키", "9개", "4개", "먹었어요", "남은"],
    answer: 5,
    unitLabel: "개",
    checkHint: "처음 쿠키 9개에서 먹은 쿠키 4개를 빼야 해."
  },
  {
    id: "math-03",
    mode: "math",
    unit: "수학 이야기",
    title: "구슬을 모아요",
    level: "2단계",
    readLabel: "수학 지문 읽기",
    text: "토끼 인형은 파란 구슬 6개를 모았어요. 수아가 초록 구슬 2개를 더 찾았어요.",
    question: "구슬은 모두 몇 개일까요?",
    hint: "Add the blue beads and green beads.",
    tokens: ["토끼 인형", "파란 구슬", "6개", "초록 구슬", "2개", "모두"],
    answer: 8,
    unitLabel: "개",
    checkHint: "파란 구슬 6개와 초록 구슬 2개를 더해보자."
  },
  {
    id: "math-04",
    mode: "math",
    unit: "수학 이야기",
    title: "별 조각",
    level: "3단계",
    readLabel: "수학 지문 읽기",
    text: "별 조각이 10개 있었어요. 그중 3개가 하늘로 올라갔어요.",
    question: "아직 손에 남은 별 조각은 몇 개일까요?",
    hint: "Read what went away.",
    tokens: ["별 조각", "10개", "3개", "하늘", "남은"],
    answer: 7,
    unitLabel: "개",
    checkHint: "별 조각 10개 중에서 하늘로 올라간 3개를 빼보자."
  },
  {
    id: "math-05",
    mode: "math",
    unit: "수학 이야기",
    title: "연필통",
    level: "3단계",
    readLabel: "수학 지문 읽기",
    text: "연필통에 연필 5자루가 있었어요. 아빠가 연필 5자루를 더 넣어 주었어요.",
    question: "연필은 모두 몇 자루일까요?",
    hint: "The same number appears twice.",
    tokens: ["연필통", "연필", "5자루", "아빠", "더", "모두"],
    answer: 10,
    unitLabel: "자루",
    checkHint: "처음 5자루와 더 넣은 5자루를 합쳐보자."
  }
];

const els = {
  modeList: document.querySelector("#modeList"),
  unitName: document.querySelector("#unitName"),
  problemTitle: document.querySelector("#problemTitle"),
  levelPill: document.querySelector("#levelPill"),
  readLabel: document.querySelector("#readLabel"),
  readingText: document.querySelector("#readingText"),
  englishHint: document.querySelector("#englishHint"),
  hintToggle: document.querySelector("#hintToggle"),
  startReading: document.querySelector("#startReading"),
  sampleVoice: document.querySelector("#sampleVoice"),
  nextProblem: document.querySelector("#nextProblem"),
  recordingStatus: document.querySelector("#recordingStatus"),
  feedbackPanel: document.querySelector("#feedbackPanel"),
  scoreLabel: document.querySelector("#scoreLabel"),
  scoreValue: document.querySelector("#scoreValue"),
  heardText: document.querySelector("#heardText"),
  readingReviewText: document.querySelector("#readingReviewText"),
  missedTokens: document.querySelector("#missedTokens"),
  coachNote: document.querySelector("#coachNote"),
  guardianNote: document.querySelector("#guardianNote"),
  manualPanel: document.querySelector("#manualPanel"),
  manualTranscript: document.querySelector("#manualTranscript"),
  manualJudge: document.querySelector("#manualJudge"),
  mathQuestionPanel: document.querySelector("#mathQuestionPanel"),
  mathQuestionText: document.querySelector("#mathQuestionText"),
  mathAnswerPanel: document.querySelector("#mathAnswerPanel"),
  mathAnswer: document.querySelector("#mathAnswer"),
  answerUnit: document.querySelector("#answerUnit"),
  checkAnswer: document.querySelector("#checkAnswer"),
  answerFeedback: document.querySelector("#answerFeedback"),
  progressRing: document.querySelector(".progress-ring"),
  progressPercent: document.querySelector("#progressPercent"),
  progressText: document.querySelector("#progressText"),
  reviewList: document.querySelector("#reviewList"),
  resetProgress: document.querySelector("#resetProgress")
};

let activeMode = "korean";
let problemIndex = 0;
let recognition = null;
let isListening = false;
let isProcessingReading = false;
let progress = loadProgress();

function boot() {
  renderModes();
  renderProblem();
  renderProgress();
  setupSpeechRecognition();
  bindEvents();
  registerServiceWorker();
}

function bindEvents() {
  els.hintToggle.addEventListener("change", renderProblem);
  els.startReading.addEventListener("click", startReading);
  els.sampleVoice.addEventListener("click", speakCurrentProblem);
  els.nextProblem.addEventListener("click", goNext);
  els.manualJudge.addEventListener("click", () => {
    judgeTranscript(els.manualTranscript.value);
  });
  els.checkAnswer.addEventListener("click", checkMathAnswer);
  els.mathAnswer.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      checkMathAnswer();
    }
  });
  els.resetProgress.addEventListener("click", () => {
    progress = { readIds: [], review: [] };
    saveProgress();
    renderProgress();
    renderFeedback(null);
  });
}

function renderModes() {
  els.modeList.innerHTML = "";
  MODES.forEach((mode) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `mode-button ${mode.id === activeMode ? "active" : ""}`;
    button.innerHTML = `
      <span class="mode-icon">${mode.icon}</span>
      <span>
        <strong>${mode.title}</strong>
        <span>${mode.subtitle}</span>
      </span>
    `;
    button.addEventListener("click", () => {
      activeMode = mode.id;
      problemIndex = 0;
      renderModes();
      renderProblem();
    });
    els.modeList.appendChild(button);
  });
}

function getActiveProblems() {
  if (activeMode === "mixed") {
    return PROBLEMS;
  }
  return PROBLEMS.filter((problem) => problem.mode === activeMode);
}

function currentProblem() {
  const list = getActiveProblems();
  return list[problemIndex % list.length];
}

function renderProblem() {
  const problem = currentProblem();
  els.unitName.textContent = problem.unit;
  els.problemTitle.textContent = problem.title;
  els.levelPill.textContent = problem.level;
  els.readLabel.textContent = problem.readLabel || "소리 내어 읽기";
  els.readingText.textContent = problem.text;
  els.readingText.classList.toggle("long-text", problem.text.length > 22);
  els.englishHint.textContent = els.hintToggle.checked ? problem.hint : "";
  els.mathQuestionText.textContent = problem.question || "";
  els.mathQuestionPanel.classList.toggle("hidden", !problem.question);
  els.feedbackPanel.classList.add("hidden");
  els.manualTranscript.value = "";
  els.answerFeedback.textContent = "";
  els.answerFeedback.className = "soft-feedback math-feedback";
  els.mathAnswer.value = "";
  els.mathAnswerPanel.classList.toggle("hidden", typeof problem.answer !== "number");
  els.answerUnit.textContent = problem.unitLabel || "";
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    els.manualPanel.classList.remove("hidden");
    els.recordingStatus.textContent = "이 브라우저에서는 자동 음성 인식이 어려워요. Chrome에서 다시 열거나 수동 입력을 사용해 주세요.";
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "ko-KR";
  recognition.interimResults = false;
  recognition.continuous = false;

  recognition.addEventListener("result", (event) => {
    const transcript = Array.from(event.results)
      .map((result) => result[0].transcript)
      .join(" ");
    judgeTranscript(transcript);
  });

  recognition.addEventListener("end", () => {
    isListening = false;
    setReadingButtonIdle();
  });

  recognition.addEventListener("error", () => {
    isListening = false;
    setReadingButtonIdle();
    els.recordingStatus.textContent = "음성 인식 결과가 없어요. 다시 읽거나 수동 입력으로 확인해 주세요.";
    els.manualPanel.classList.remove("hidden");
  });
}

function startReading() {
  if (isProcessingReading) {
    return;
  }

  if (isListening) {
    stopBrowserSpeechRecognition();
    return;
  }

  startBrowserSpeechRecognition();
}

function startBrowserSpeechRecognition() {
  if (!recognition) {
    els.manualPanel.classList.remove("hidden");
    els.manualTranscript.focus();
    els.recordingStatus.textContent = "이 브라우저에서는 자동 음성 인식이 어려워요. Chrome에서 다시 열거나 수동 입력으로 확인해 주세요.";
    return;
  }

  isListening = true;
  els.startReading.classList.add("listening");
  els.startReading.innerHTML = '<span aria-hidden="true">■</span>듣기 중지';
  els.recordingStatus.textContent = "Chrome 브라우저 음성 인식으로 듣고 있어요. 다 읽으면 잠깐 기다려 주세요.";

  try {
    recognition.start();
  } catch {
    isListening = false;
    setReadingButtonIdle();
    els.manualPanel.classList.remove("hidden");
    els.recordingStatus.textContent = "음성 인식을 다시 시작할 수 없어요. 잠시 후 다시 누르거나 수동 입력을 사용해 주세요.";
  }
}

function stopBrowserSpeechRecognition() {
  if (recognition) {
    recognition.stop();
  }
}

function setReadingButtonIdle() {
  els.startReading.classList.remove("listening");
  els.startReading.innerHTML = '<span aria-hidden="true">●</span>읽기 시작';
}

function speakCurrentProblem() {
  if (!window.speechSynthesis) {
    return;
  }

  const utterance = new SpeechSynthesisUtterance(getExpectedReadingText(currentProblem()));
  utterance.lang = "ko-KR";
  utterance.rate = 0.82;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function judgeTranscript(rawTranscript) {
  const problem = currentProblem();
  const transcript = rawTranscript.trim();
  if (!transcript) {
    return;
  }

  const result = compareReading(problem, transcript);
  markRead(problem.id);
  if (result.missed.length) {
    addReview(result.missed);
  }
  renderProgress();
  renderFeedback(result);
  els.recordingStatus.textContent = "Chrome 음성 인식 전사 결과로 바로 채점했어요.";
}

function compareReading(problem, transcript) {
  const expected = normalizeText(getExpectedReadingText(problem));
  const heard = normalizeText(transcript);
  const distance = levenshtein(toJamo(expected), toJamo(heard));
  const maxLength = Math.max(toJamo(expected).length, 1);
  const similarity = Math.max(0, 1 - distance / maxLength);
  const tokenHits = problem.tokens.filter((token) => {
    const normalized = normalizeText(token);
    return heard.includes(normalized) || numberAlias(normalized).some((alias) => heard.includes(alias));
  });
  const missed = problem.tokens.filter((token) => !tokenHits.includes(token));
  const tokenScore = tokenHits.length / Math.max(problem.tokens.length, 1);
  const score = Math.round((similarity * 0.58 + tokenScore * 0.42) * 100);

  let level = "retry";
  let label = "한 번 더";
  let note = "천천히 한 글자씩 다시 읽어보자.";

  if (score >= 86 && missed.length === 0) {
    level = "good";
    label = "아주 좋아요";
    note = "문장을 끝까지 정확하게 읽었어요.";
  } else if (score >= 68 || missed.length <= 1) {
    level = "close";
    label = "거의 됐어요";
    note = "어려운 부분만 다시 보면 더 정확해져요.";
  }

  return {
    level,
    label,
    note,
    score,
    transcript,
    expectedText: getExpectedReadingText(problem),
    missed
  };
}

function renderFeedback(result) {
  if (!result) {
    els.feedbackPanel.classList.add("hidden");
    return;
  }

  els.feedbackPanel.classList.remove("hidden");
  els.scoreLabel.textContent = result.label;
  els.scoreValue.textContent = `${result.score}점`;
  els.heardText.textContent = `들은 문장: ${result.transcript}`;
  els.coachNote.textContent = result.note;
  els.guardianNote.textContent = result.guardianNote || "";
  els.missedTokens.innerHTML = "";
  renderReadingReviewText(result);

  if (result.missed.length === 0) {
    const chip = document.createElement("span");
    chip.textContent = "다 읽었어요";
    els.missedTokens.appendChild(chip);
    return;
  }

  result.missed.forEach((token) => {
    const chip = document.createElement("span");
    chip.textContent = token;
    els.missedTokens.appendChild(chip);
  });
}

function renderReadingReviewText(result) {
  els.readingReviewText.innerHTML = "";

  const label = document.createElement("span");
  label.className = "review-label";
  label.textContent = result.missed.length ? "다시 읽을 부분: " : "읽은 기준 문장: ";
  els.readingReviewText.appendChild(label);

  appendHighlightedReading(els.readingReviewText, result.expectedText || "", result.missed || []);
}

function appendHighlightedReading(container, text, missedTokens) {
  const ranges = findTokenRanges(text, missedTokens);

  if (!ranges.length) {
    container.appendChild(document.createTextNode(text || "전사 결과가 없어요."));
    return;
  }

  let cursor = 0;
  ranges.forEach((range) => {
    if (range.start > cursor) {
      container.appendChild(document.createTextNode(text.slice(cursor, range.start)));
    }

    const error = document.createElement("strong");
    error.className = "reading-error";
    error.textContent = text.slice(range.start, range.end);
    container.appendChild(error);
    cursor = range.end;
  });

  if (cursor < text.length) {
    container.appendChild(document.createTextNode(text.slice(cursor)));
  }
}

function findTokenRanges(text, tokens) {
  const ranges = [];

  tokens.forEach((token) => {
    const cleanToken = String(token || "").trim();
    if (!cleanToken) {
      return;
    }

    const start = text.indexOf(cleanToken);
    if (start !== -1) {
      ranges.push({ start, end: start + cleanToken.length });
    }
  });

  return ranges
    .sort((a, b) => a.start - b.start || b.end - a.end)
    .filter((range, index, sorted) => {
      const previous = sorted[index - 1];
      return !previous || range.start >= previous.end;
    });
}

function checkMathAnswer() {
  const problem = currentProblem();
  if (typeof problem.answer !== "number") {
    return;
  }

  const value = Number(els.mathAnswer.value.trim());
  if (Number.isNaN(value)) {
    renderMathFeedback("fail", "숫자로 적어보자.");
    return;
  }

  renderMathFeedback(
    value === problem.answer ? "pass" : "fail",
    value === problem.answer
      ? `정답이에요. 정답은 ${formatAnswer(problem)}.`
      : `다시 해보자. ${problem.checkHint || "지문에서 중요한 수를 다시 찾아보자."}`
  );
}

function renderMathFeedback(result, message) {
  els.answerFeedback.className = `soft-feedback math-feedback ${result}`;
  els.answerFeedback.innerHTML = "";

  const badge = document.createElement("strong");
  badge.className = "math-result-badge";
  badge.textContent = result === "pass" ? "PASS" : "FAIL";

  const detail = document.createElement("span");
  detail.textContent = ` ${message}`;

  els.answerFeedback.append(badge, detail);
}

function getExpectedReadingText(problem) {
  return [problem.text, problem.question].filter(Boolean).join(" ");
}

function formatAnswer(problem) {
  const unit = problem.unitLabel || "";
  return unit ? `${problem.answer}${unit}예요` : `${problem.answer}이에요`;
}

function goNext() {
  const list = getActiveProblems();
  problemIndex = (problemIndex + 1) % list.length;
  renderProblem();
}

function normalizeText(value) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[.,!?~\s]/g, "")
    .replace(/영/g, "0")
    .replace(/공/g, "0")
    .replace(/일/g, "1")
    .replace(/하나/g, "1")
    .replace(/이/g, "2")
    .replace(/둘/g, "2")
    .replace(/삼/g, "3")
    .replace(/셋/g, "3")
    .replace(/사/g, "4")
    .replace(/넷/g, "4")
    .replace(/오/g, "5")
    .replace(/다섯/g, "5")
    .replace(/육/g, "6")
    .replace(/여섯/g, "6")
    .replace(/칠/g, "7")
    .replace(/일곱/g, "7")
    .replace(/팔/g, "8")
    .replace(/여덟/g, "8")
    .replace(/구/g, "9")
    .replace(/아홉/g, "9")
    .replace(/십/g, "10")
    .replace(/열/g, "10");
}

function numberAlias(value) {
  const aliases = {
    "1": ["하나", "일"],
    "2": ["둘", "이"],
    "3": ["셋", "삼"],
    "4": ["넷", "사"],
    "5": ["다섯", "오"],
    "6": ["여섯", "육"],
    "7": ["일곱", "칠"],
    "8": ["여덟", "팔"],
    "9": ["아홉", "구"],
    "10": ["열", "십"]
  };
  return aliases[value] || [];
}

function toJamo(value) {
  return value.normalize("NFD");
}

function levenshtein(a, b) {
  const rows = Array.from({ length: a.length + 1 }, () => []);
  for (let i = 0; i <= a.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) rows[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + cost
      );
    }
  }

  return rows[a.length][b.length];
}

function markRead(id) {
  if (!progress.readIds.includes(id)) {
    progress.readIds.push(id);
  }
  saveProgress();
}

function addReview(tokens) {
  tokens.forEach((token) => {
    if (!progress.review.includes(token)) {
      progress.review.unshift(token);
    }
  });
  progress.review = progress.review.slice(0, 8);
  saveProgress();
}

function renderProgress() {
  const percent = Math.round((progress.readIds.length / PROBLEMS.length) * 100);
  els.progressPercent.textContent = `${percent}%`;
  els.progressText.textContent = `단락/문제 ${progress.readIds.length}개를 읽었어요.`;
  els.progressRing.style.background = `conic-gradient(var(--green) ${percent * 3.6}deg, var(--mint) 0deg)`;
  els.reviewList.innerHTML = "";

  if (!progress.review.length) {
    const item = document.createElement("li");
    item.textContent = "아직 기록이 없어요.";
    els.reviewList.appendChild(item);
    return;
  }

  progress.review.forEach((token) => {
    const item = document.createElement("li");
    item.textContent = token;
    els.reviewList.appendChild(item);
  });
}

function loadProgress() {
  try {
    const saved = window.localStorage.getItem("sua-learning-progress");
    return saved ? JSON.parse(saved) : { readIds: [], review: [] };
  } catch {
    return { readIds: [], review: [] };
  }
}

function saveProgress() {
  try {
    window.localStorage.setItem("sua-learning-progress", JSON.stringify(progress));
  } catch {
    // Local storage can be disabled in some browsers; the app still works without it.
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Offline caching is optional; speech practice still works when registration fails.
    });
  });
}

boot();

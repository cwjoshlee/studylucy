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
    text: "수아는 작은 숲길에서 반짝이는 돌멩이를 보았어요. 돌멩이는 별빛처럼 조용히 빛나며 수아의 손바닥을 따뜻하게 해 주었어요.",
    hint: "Read one sentence at a time. You can pause at the period.",
    tokens: ["수아", "숲길", "반짝이는", "돌멩이", "손바닥"]
  },
  {
    id: "ko-02",
    mode: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 2",
    level: "1단계",
    readLabel: "동화 단락 읽기",
    text: "수아는 돌멩이를 손에 올리고 천천히 걸었어요. 길 끝에는 낮은 문과 둥근 창문이 있는 파란 집이 조용히 서 있었어요.",
    hint: "Slow reading is good reading.",
    tokens: ["돌멩이", "천천히", "낮은 문", "둥근 창문", "파란 집"]
  },
  {
    id: "ko-03",
    mode: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 3",
    level: "2단계",
    readLabel: "동화 단락 읽기",
    text: "문 앞에는 은빛 종이 매달려 있었어요. 수아가 종을 살짝 치자 집 안에서 따뜻한 불빛이 켜지고 작은 발소리가 들렸어요.",
    hint: "Look carefully at final consonants.",
    tokens: ["은빛 종", "매달려", "살짝", "따뜻한 불빛", "발소리"]
  },
  {
    id: "ko-04",
    mode: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 4",
    level: "2단계",
    readLabel: "동화 단락 읽기",
    text: "파란 집의 할머니는 길을 잃은 별을 찾고 있었어요. 수아는 손바닥의 돌멩이가 별의 조각일지도 모른다고 조심스럽게 말했어요.",
    hint: "Read to the end before checking meaning.",
    tokens: ["할머니", "길을 잃은 별", "손바닥", "별의 조각", "조심스럽게"]
  },
  {
    id: "ko-05",
    mode: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 5",
    level: "3단계",
    readLabel: "동화 단락 읽기",
    text: "할머니는 수아에게 별빛 씨앗을 담은 작은 주머니를 주었어요. 씨앗은 흔들릴 때마다 딸랑딸랑 소리를 내며 길을 알려 주었어요.",
    hint: "Two sentences. Pause once, then continue.",
    tokens: ["할머니", "별빛 씨앗", "작은 주머니", "딸랑딸랑", "길"]
  },
  {
    id: "ko-06",
    mode: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 6",
    level: "3단계",
    readLabel: "동화 단락 읽기",
    text: "수아는 주머니를 들고 이끼가 폭신한 길을 지나갔어요. 나뭇잎 사이에서는 초록 반딧불이 하나둘 깨어나 수아를 따라왔어요.",
    hint: "Notice the feeling in the final sentence.",
    tokens: ["주머니", "이끼", "폭신한 길", "나뭇잎", "반딧불"]
  },
  {
    id: "ko-07",
    mode: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 7",
    level: "4단계",
    readLabel: "동화 단락 읽기",
    text: "숲 가운데에는 별빛이 사라진 작은 다리가 있었어요. 수아는 다리 위에 씨앗을 하나씩 놓으며 어두운 널빤지를 환하게 밝혔어요.",
    hint: "Longer paragraph. Keep your eyes on each word.",
    tokens: ["숲 가운데", "작은 다리", "씨앗", "널빤지", "환하게"]
  },
  {
    id: "ko-08",
    mode: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 8",
    level: "4단계",
    readLabel: "동화 단락 읽기",
    text: "다리 아래의 물결은 별빛을 받아 은색 리본처럼 반짝였어요. 수아는 겁이 조금 났지만 발끝을 보며 천천히 건넜어요.",
    hint: "Pause after the first sentence.",
    tokens: ["물결", "은색 리본", "반짝였어요", "겁", "천천히"]
  },
  {
    id: "ko-09",
    mode: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 9",
    level: "5단계",
    readLabel: "동화 단락 읽기",
    text: "다리를 건너자 작은 별들이 둥근 광장에 모여 있었어요. 별들은 제자리를 찾으려고 서로의 빛을 맞추며 조용히 기다렸어요.",
    hint: "Read calmly. The story is almost done.",
    tokens: ["다리", "작은 별들", "둥근 광장", "제자리", "기다렸어요"]
  },
  {
    id: "ko-10",
    mode: "korean",
    unit: "동화 읽기",
    title: "숲속 작은 등불 10",
    level: "5단계",
    readLabel: "동화 단락 읽기",
    text: "수아가 마지막 씨앗을 하늘로 올리자 숲 전체가 부드러운 빛으로 물들었어요. 집으로 돌아오는 길에 수아의 마음에도 작은 등불이 오래도록 켜져 있었어요.",
    hint: "Finish the ending slowly.",
    tokens: ["마지막 씨앗", "하늘", "숲 전체", "부드러운 빛", "작은 등불"]
  },
  {
    id: "math-01",
    mode: "math",
    unit: "숲속 수학 이야기",
    title: "별빛 씨앗 주머니",
    level: "1단계",
    readLabel: "수학 지문 읽기",
    text: "할머니는 수아에게 별빛 씨앗 8개를 주었어요. 수아는 문 앞 상자에서 별빛 씨앗 7개를 더 찾았어요.",
    question: "수아가 가진 별빛 씨앗은 모두 몇 개일까요?",
    hint: "Find both numbers before adding.",
    tokens: ["할머니", "수아", "별빛 씨앗", "8개", "7개", "모두"],
    answer: 15,
    unitLabel: "개",
    checkHint: "별빛 씨앗 8개와 7개를 더해보자."
  },
  {
    id: "math-02",
    mode: "math",
    unit: "숲속 수학 이야기",
    title: "반딧불 친구들",
    level: "1단계",
    readLabel: "수학 지문 읽기",
    text: "숲길 왼쪽에서 반딧불 9마리가 날아왔어요. 오른쪽 풀숲에서도 반딧불 5마리가 더 날아왔어요.",
    question: "수아를 따라온 반딧불은 모두 몇 마리일까요?",
    hint: "This is an adding problem.",
    tokens: ["숲길", "반딧불", "9마리", "5마리", "더", "모두"],
    answer: 14,
    unitLabel: "마리",
    checkHint: "왼쪽 9마리와 오른쪽 5마리를 합쳐보자."
  },
  {
    id: "math-03",
    mode: "math",
    unit: "숲속 수학 이야기",
    title: "다리의 널빤지",
    level: "2단계",
    readLabel: "수학 지문 읽기",
    text: "별빛 다리에는 밝은 널빤지 10개가 있었어요. 수아가 씨앗을 놓자 널빤지 6개가 더 밝아졌어요.",
    question: "밝아진 널빤지는 모두 몇 개일까요?",
    hint: "Add the bright boards.",
    tokens: ["별빛 다리", "밝은 널빤지", "10개", "6개", "더", "모두"],
    answer: 16,
    unitLabel: "개",
    checkHint: "밝은 널빤지 10개와 더 밝아진 6개를 더해보자."
  },
  {
    id: "math-04",
    mode: "math",
    unit: "숲속 수학 이야기",
    title: "은색 리본 물결",
    level: "2단계",
    readLabel: "수학 지문 읽기",
    text: "다리 아래 물결에는 은색 빛 12줄이 반짝였어요. 별빛 씨앗이 떨어지자 은색 빛 4줄이 더 생겼어요.",
    question: "은색 빛은 모두 몇 줄일까요?",
    hint: "A two-digit number can be added too.",
    tokens: ["물결", "은색 빛", "12줄", "4줄", "더", "모두"],
    answer: 16,
    unitLabel: "줄",
    checkHint: "은색 빛 12줄과 4줄을 더해보자."
  },
  {
    id: "math-05",
    mode: "math",
    unit: "숲속 수학 이야기",
    title: "둥근 광장의 별",
    level: "3단계",
    readLabel: "수학 지문 읽기",
    text: "둥근 광장에는 작은 별 11개가 기다리고 있었어요. 하늘에서 작은 별 8개가 더 내려왔어요.",
    question: "광장에 모인 작은 별은 모두 몇 개일까요?",
    hint: "Read both numbers carefully.",
    tokens: ["둥근 광장", "작은 별", "11개", "8개", "더", "모두"],
    answer: 19,
    unitLabel: "개",
    checkHint: "기다리던 별 11개와 내려온 별 8개를 더해보자."
  },
  {
    id: "math-06",
    mode: "math",
    unit: "숲속 수학 이야기",
    title: "파란 집 창문",
    level: "3단계",
    readLabel: "수학 지문 읽기",
    text: "파란 집의 둥근 창문에는 노란 불빛 13개가 켜졌어요. 할머니가 초록 불빛 5개를 더 켰어요.",
    question: "창문에 켜진 불빛은 모두 몇 개일까요?",
    hint: "Add yellow lights and green lights.",
    tokens: ["파란 집", "둥근 창문", "노란 불빛", "13개", "5개", "모두"],
    answer: 18,
    unitLabel: "개",
    checkHint: "노란 불빛 13개와 초록 불빛 5개를 더해보자."
  },
  {
    id: "math-07",
    mode: "math",
    unit: "숲속 수학 이야기",
    title: "이끼 길의 발자국",
    level: "4단계",
    readLabel: "수학 지문 읽기",
    text: "이끼 길에 수아의 발자국 7개가 남았어요. 별빛 고양이의 작은 발자국 12개도 옆에 생겼어요.",
    question: "이끼 길의 발자국은 모두 몇 개일까요?",
    hint: "The story has two kinds of footprints.",
    tokens: ["이끼 길", "수아", "발자국", "7개", "12개", "모두"],
    answer: 19,
    unitLabel: "개",
    checkHint: "수아의 발자국 7개와 고양이 발자국 12개를 더해보자."
  },
  {
    id: "math-08",
    mode: "math",
    unit: "숲속 수학 이야기",
    title: "하늘 사다리",
    level: "4단계",
    readLabel: "수학 지문 읽기",
    text: "별들이 하늘로 올라가려고 빛 사다리 14칸을 만들었어요. 수아가 씨앗을 놓자 빛 사다리 3칸이 더 생겼어요.",
    question: "빛 사다리는 모두 몇 칸일까요?",
    hint: "Add the ladder steps.",
    tokens: ["별들", "빛 사다리", "14칸", "3칸", "더", "모두"],
    answer: 17,
    unitLabel: "칸",
    checkHint: "처음 14칸과 더 생긴 3칸을 더해보자."
  },
  {
    id: "math-09",
    mode: "math",
    unit: "숲속 수학 이야기",
    title: "별빛 편지",
    level: "5단계",
    readLabel: "수학 지문 읽기",
    text: "할머니는 수아에게 별빛 편지 6장을 보여 주었어요. 별들도 고마운 마음을 담아 편지 13장을 더 보냈어요.",
    question: "별빛 편지는 모두 몇 장일까요?",
    hint: "Find 6 and 13, then add.",
    tokens: ["할머니", "수아", "별빛 편지", "6장", "13장", "모두"],
    answer: 19,
    unitLabel: "장",
    checkHint: "할머니의 편지 6장과 별들이 보낸 13장을 더해보자."
  },
  {
    id: "math-10",
    mode: "math",
    unit: "숲속 수학 이야기",
    title: "마지막 등불",
    level: "5단계",
    readLabel: "수학 지문 읽기",
    text: "숲길에는 작은 등불 15개가 켜져 있었어요. 수아가 마지막 씨앗을 놓자 등불 5개가 더 켜졌어요.",
    question: "숲길의 등불은 모두 몇 개일까요?",
    hint: "This one reaches twenty.",
    tokens: ["숲길", "작은 등불", "15개", "5개", "마지막 씨앗", "모두"],
    answer: 20,
    unitLabel: "개",
    checkHint: "처음 등불 15개와 더 켜진 5개를 더해보자."
  }
];

const READING_PASS_SCORE = 85;
const READING_LISTENING_LIMIT_MS = 60000;
const RECOGNITION_RESTART_DELAY_MS = 250;
const PROGRESS_STORAGE_KEY = "sua-learning-progress-v4";
const TODAY_KEY = getTodayKey();

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
let isFinishingRecognition = false;
let shouldRestartRecognition = false;
let recognitionStopTimer = null;
let recognitionStartedAt = 0;
let speechTranscriptParts = [];
let speechSessionResults = [];
let speechInterimTranscript = "";
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
    progress = createEmptyProgress();
    saveProgress();
    renderProgress();
    renderFeedback(null);
    updateMathAnswerGate(currentProblem());
    updateNextGate(currentProblem());
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
      scrollPracticeIntoView();
    });
    els.modeList.appendChild(button);
  });
}

function getActiveProblems() {
  const baseProblems = activeMode === "mixed"
    ? PROBLEMS
    : PROBLEMS.filter((problem) => problem.mode === activeMode);

  return getDailyProblems(baseProblems, `${TODAY_KEY}:${activeMode}`);
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
  updateReadingAvailability();
  updateMathAnswerGate(problem);
  updateNextGate(problem);
}

function setupSpeechRecognition() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    showManualReadingFallback();
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = "ko-KR";
  recognition.interimResults = true;
  recognition.continuous = true;

  recognition.addEventListener("result", (event) => {
    collectSpeechTranscript(event);
  });

  recognition.addEventListener("end", () => {
    if (isListening && shouldRestartRecognition && !isFinishingRecognition) {
      scheduleRecognitionRestart();
      return;
    }

    finishSpeechRecognitionCapture();
  });

  recognition.addEventListener("error", () => {
    if (isListening && shouldRestartRecognition && !isFinishingRecognition) {
      scheduleRecognitionRestart();
      return;
    }

    finishSpeechRecognitionCapture();
  });

  updateReadingAvailability();
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
    showManualReadingFallback(true);
    return;
  }

  resetSpeechCapture();
  isListening = true;
  isFinishingRecognition = false;
  shouldRestartRecognition = true;
  recognitionStartedAt = Date.now();
  els.startReading.classList.add("listening");
  els.startReading.innerHTML = '<span aria-hidden="true">■</span>읽기 완료';
  els.recordingStatus.textContent = "최대 1분 동안 듣고 있어요. 다 읽으면 읽기 완료를 눌러주세요.";
  recognitionStopTimer = window.setTimeout(() => {
    els.recordingStatus.textContent = "읽기 시간이 끝나서 지금까지 들은 내용으로 채점해요.";
    stopBrowserSpeechRecognition();
  }, READING_LISTENING_LIMIT_MS);

  if (!startRecognitionEngine()) {
    isListening = false;
    shouldRestartRecognition = false;
    clearRecognitionStopTimer();
    setReadingButtonIdle();
    els.manualPanel.classList.remove("hidden");
    els.recordingStatus.textContent = "음성 인식을 다시 시작할 수 없어요. 잠시 후 다시 누르거나 수동 입력을 사용해 주세요.";
  }
}

function updateReadingAvailability() {
  if (!recognition) {
    showManualReadingFallback();
    return;
  }

  els.manualPanel.classList.add("hidden");
  els.recordingStatus.textContent = "읽을 준비가 되었어요.";
}

function showManualReadingFallback(shouldFocus = false) {
  els.manualPanel.classList.remove("hidden");
  els.recordingStatus.textContent = "이 브라우저에서는 자동 음성 인식이 어려워요. Android Chrome에서 열거나 수동 입력으로 판정해 주세요.";

  if (shouldFocus) {
    els.manualTranscript.focus();
  }
}

function stopBrowserSpeechRecognition() {
  if (!isListening) {
    return;
  }

  isFinishingRecognition = true;
  shouldRestartRecognition = false;
  clearRecognitionStopTimer();
  els.startReading.disabled = true;
  els.startReading.classList.add("processing");
  els.recordingStatus.textContent = "읽은 내용을 정리하고 있어요.";

  if (recognition) {
    try {
      recognition.stop();
    } catch {
      finishSpeechRecognitionCapture();
    }
  }
}

function setReadingButtonIdle() {
  els.startReading.disabled = false;
  els.startReading.classList.remove("listening");
  els.startReading.classList.remove("processing");
  els.startReading.innerHTML = '<span aria-hidden="true">●</span>읽기 시작';
}

function startRecognitionEngine() {
  try {
    recognition.start();
    return true;
  } catch {
    return false;
  }
}

function scheduleRecognitionRestart() {
  if (Date.now() - recognitionStartedAt >= READING_LISTENING_LIMIT_MS) {
    stopBrowserSpeechRecognition();
    return;
  }

  commitSpeechSessionTranscript();
  window.setTimeout(() => {
    if (isListening && shouldRestartRecognition && !isFinishingRecognition) {
      startRecognitionEngine();
    }
  }, RECOGNITION_RESTART_DELAY_MS);
}

function collectSpeechTranscript(event) {
  let interimText = "";
  const startIndex = Number.isInteger(event.resultIndex) ? event.resultIndex : 0;

  for (let index = startIndex; index < event.results.length; index += 1) {
    const result = event.results[index];
    const transcript = cleanSpeechText(result?.[0]?.transcript);
    if (!transcript) {
      continue;
    }

    if (result.isFinal) {
      speechSessionResults[index] = transcript;
    } else {
      interimText = `${interimText} ${transcript}`.trim();
    }
  }

  speechInterimTranscript = interimText;
  els.recordingStatus.textContent = "계속 듣고 있어요. 다 읽으면 읽기 완료를 눌러주세요.";
}

function finishSpeechRecognitionCapture() {
  if (!isListening && !isFinishingRecognition) {
    return;
  }

  const transcript = getCapturedSpeechTranscript();
  isListening = false;
  isFinishingRecognition = false;
  shouldRestartRecognition = false;
  clearRecognitionStopTimer();
  setReadingButtonIdle();

  if (transcript) {
    judgeTranscript(transcript);
    return;
  }

  els.recordingStatus.textContent = "음성 인식 결과가 없어요. 다시 읽거나 수동 입력으로 확인해 주세요.";
  els.manualPanel.classList.remove("hidden");
}

function resetSpeechCapture() {
  speechTranscriptParts = [];
  speechSessionResults = [];
  speechInterimTranscript = "";
}

function getCapturedSpeechTranscript() {
  commitSpeechSessionTranscript();
  return collapseSpeechSegments(speechTranscriptParts);
}

function commitSpeechSessionTranscript() {
  const sessionText = collapseSpeechSegments([...speechSessionResults, speechInterimTranscript]);
  if (sessionText) {
    addSpeechTranscriptPart(sessionText);
  }

  speechSessionResults = [];
  speechInterimTranscript = "";
}

function addSpeechTranscriptPart(text) {
  addCollapsedSpeechPart(speechTranscriptParts, text);
}

function collapseSpeechSegments(segments) {
  const collapsed = [];
  segments.forEach((segment) => addCollapsedSpeechPart(collapsed, segment));
  return cleanSpeechText(collapsed.join(" "));
}

function addCollapsedSpeechPart(parts, text) {
  const cleaned = cleanSpeechText(text);
  const previous = parts[parts.length - 1] || "";
  if (!cleaned) {
    return;
  }

  if (!previous) {
    parts.push(cleaned);
    return;
  }

  if (cleaned === previous || previous.includes(cleaned) || previous.endsWith(cleaned)) {
    return;
  }

  if (cleaned.startsWith(previous) || cleaned.includes(previous)) {
    parts[parts.length - 1] = cleaned;
    return;
  }

  const merged = mergeOverlappingSpeech(previous, cleaned);
  if (merged) {
    parts[parts.length - 1] = merged;
    return;
  }

  parts.push(cleaned);
}

function mergeOverlappingSpeech(previous, next) {
  const previousWords = previous.split(" ");
  const nextWords = next.split(" ");
  const maxOverlap = Math.min(previousWords.length, nextWords.length);

  for (let size = maxOverlap; size > 0; size -= 1) {
    const previousTail = previousWords.slice(-size).join(" ");
    const nextHead = nextWords.slice(0, size).join(" ");
    if (previousTail === nextHead) {
      return cleanSpeechText([
        ...previousWords,
        ...nextWords.slice(size)
      ].join(" "));
    }
  }

  return "";
}

function cleanSpeechText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function clearRecognitionStopTimer() {
  if (recognitionStopTimer) {
    window.clearTimeout(recognitionStopTimer);
    recognitionStopTimer = null;
  }
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
  const transcript = prepareTranscriptForJudging(rawTranscript, problem);
  if (!transcript) {
    return;
  }

  const result = compareReading(problem, transcript);
  setReadingPass(problem.id, result.passed);
  if (result.missed.length) {
    addReview(result.missed);
  }
  renderProgress();
  renderFeedback(result);
  updateMathAnswerGate(problem);
  updateNextGate(problem);
  els.recordingStatus.textContent = result.passed
    ? "읽기 PASS예요."
    : getNextGateMessage(problem);
}

function prepareTranscriptForJudging(rawTranscript, problem) {
  const transcript = cleanSpeechText(rawTranscript);
  const expectedText = getExpectedReadingText(problem);
  const transcriptWords = transcript.split(" ").filter(Boolean);
  const expectedWords = cleanSpeechText(expectedText).split(" ").filter(Boolean);

  if (transcriptWords.length <= Math.max(expectedWords.length * 2, expectedWords.length + 8)) {
    return transcript;
  }

  return findBestTranscriptWindow(transcriptWords, expectedText, expectedWords.length);
}

function findBestTranscriptWindow(words, expectedText, expectedWordCount) {
  const minSize = Math.max(4, expectedWordCount - 5);
  const maxSize = Math.min(words.length, expectedWordCount + 10);
  let bestText = words.join(" ");
  let bestScore = -1;

  for (let size = minSize; size <= maxSize; size += 1) {
    for (let start = 0; start <= words.length - size; start += 1) {
      const candidate = words.slice(start, start + size).join(" ");
      const score = transcriptSimilarity(expectedText, candidate);
      if (score > bestScore) {
        bestScore = score;
        bestText = candidate;
      }
    }
  }

  return cleanSpeechText(bestText);
}

function transcriptSimilarity(expectedText, candidateText) {
  const expected = normalizeText(expectedText);
  const candidate = normalizeText(candidateText);
  const distance = levenshtein(toJamo(expected), toJamo(candidate));
  return 1 - distance / Math.max(toJamo(expected).length, 1);
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

  const passed = score >= READING_PASS_SCORE && missed.length === 0;
  let level = "retry";
  let label = "읽기 FAIL";
  let note = `빠진 표현 없이 ${READING_PASS_SCORE}점 이상이어야 PASS예요. 천천히 다시 읽어보자.`;

  if (passed) {
    level = "good";
    label = "읽기 PASS";
    note = "문장을 끝까지 정확하게 읽었어요.";
  } else if (score >= 68 || missed.length <= 1) {
    level = "close";
    note = `거의 됐어요. 빠진 표현을 다시 읽고 ${READING_PASS_SCORE}점 이상을 만들어 보자.`;
  }

  return {
    level,
    label,
    note,
    passed,
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

  if (result.passed) {
    const chip = document.createElement("span");
    chip.textContent = "PASS";
    els.missedTokens.appendChild(chip);
    return;
  }

  if (result.missed.length === 0) {
    const chip = document.createElement("span");
    chip.textContent = `${READING_PASS_SCORE}점 이상 필요`;
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

  if (!isMathAnswerUnlocked(problem)) {
    renderMathGateMessage(problem);
    return;
  }

  const value = Number(els.mathAnswer.value.trim());
  if (Number.isNaN(value)) {
    renderMathFeedback("fail", "숫자로 적어보자.");
    return;
  }

  const passed = value === problem.answer;
  setMathPass(problem.id, passed);
  renderMathFeedback(
    passed ? "pass" : "fail",
    passed
      ? `정답이에요. 정답은 ${formatAnswer(problem)}. 이제 다음 문제로 갈 수 있어요.`
      : `다시 해보자. ${problem.checkHint || "지문에서 중요한 수를 다시 찾아보자."}`
  );
  updateNextGate(problem);
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

function updateMathAnswerGate(problem) {
  if (typeof problem.answer !== "number") {
    els.mathAnswer.disabled = false;
    els.checkAnswer.disabled = false;
    return;
  }

  const unlocked = isMathAnswerUnlocked(problem);
  els.mathAnswer.disabled = !unlocked;
  els.checkAnswer.disabled = !unlocked;
  els.mathAnswer.placeholder = unlocked ? "숫자" : "먼저 읽기";
  els.mathAnswerPanel.classList.toggle("locked", !unlocked);
  renderMathGateMessage(problem);
}

function isMathAnswerUnlocked(problem) {
  return progress.readIds.includes(problem.id);
}

function renderMathGateMessage(problem) {
  if (typeof problem.answer !== "number") {
    return;
  }

  els.answerFeedback.className = `soft-feedback answer-lock ${isMathAnswerUnlocked(problem) ? "unlocked" : "locked"}`;
  els.answerFeedback.textContent = isMathAnswerUnlocked(problem)
    ? "읽기 PASS. 이제 답을 쓸 수 있어요."
    : `먼저 지문과 문제를 끝까지 읽어 PASS를 받아야 해요. 기준은 ${READING_PASS_SCORE}점 이상, 빠진 표현 없음이에요.`;
}

function updateNextGate(problem) {
  const unlocked = canGoNext(problem);
  els.nextProblem.disabled = !unlocked;
  els.nextProblem.classList.toggle("locked", !unlocked);
  els.nextProblem.title = unlocked ? "다음 문제" : getNextGateMessage(problem);
  els.nextProblem.setAttribute("aria-disabled", String(!unlocked));
}

function canGoNext(problem) {
  if (!isReadingPassed(problem)) {
    return false;
  }

  if (typeof problem.answer === "number") {
    return progress.mathPassIds.includes(problem.id);
  }

  return true;
}

function getNextGateMessage(problem) {
  if (!isReadingPassed(problem)) {
    return `읽기 PASS를 받아야 다음 문제로 갈 수 있어요. 기준은 ${READING_PASS_SCORE}점 이상, 빠진 표현 없음이에요.`;
  }

  if (typeof problem.answer === "number" && !progress.mathPassIds.includes(problem.id)) {
    return "수학 답이 PASS여야 다음 문제로 갈 수 있어요.";
  }

  return "";
}

function isReadingPassed(problem) {
  return progress.readIds.includes(problem.id);
}

function getExpectedReadingText(problem) {
  return [problem.text, problem.question].filter(Boolean).join(" ");
}

function formatAnswer(problem) {
  const unit = problem.unitLabel || "";
  return unit ? `${problem.answer}${unit}예요` : `${problem.answer}이에요`;
}

function goNext() {
  const problem = currentProblem();
  if (!canGoNext(problem)) {
    const message = getNextGateMessage(problem);
    if (typeof problem.answer === "number") {
      els.answerFeedback.className = "soft-feedback answer-lock locked";
      els.answerFeedback.textContent = message;
    } else {
      els.recordingStatus.textContent = message;
    }
    updateNextGate(problem);
    return;
  }

  const list = getActiveProblems();
  problemIndex = (problemIndex + 1) % list.length;
  renderProblem();
  scrollPracticeIntoView();
}

function scrollPracticeIntoView() {
  window.requestAnimationFrame?.(() => {
    document.querySelector(".practice-stage")?.scrollIntoView({
      block: "start",
      behavior: "smooth"
    });
  });
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

function setReadingPass(id, passed) {
  if (passed && !progress.readIds.includes(id)) {
    progress.readIds.push(id);
  }

  if (!passed) {
    progress.readIds = progress.readIds.filter((readId) => readId !== id);
    progress.mathPassIds = progress.mathPassIds.filter((mathId) => mathId !== id);
  }

  saveProgress();
}

function setMathPass(id, passed) {
  if (passed && !progress.mathPassIds.includes(id)) {
    progress.mathPassIds.push(id);
  }

  if (!passed) {
    progress.mathPassIds = progress.mathPassIds.filter((mathId) => mathId !== id);
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
  els.progressText.textContent = `오늘 단락/문제 ${progress.readIds.length}개를 PASS했어요.`;
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
    const saved = window.localStorage.getItem(PROGRESS_STORAGE_KEY);
    return normalizeProgress(saved ? JSON.parse(saved) : null);
  } catch {
    return createEmptyProgress();
  }
}

function saveProgress() {
  try {
    window.localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Local storage can be disabled in some browsers; the app still works without it.
  }
}

function normalizeProgress(saved) {
  if (saved?.dateKey !== TODAY_KEY) {
    return createEmptyProgress();
  }

  return {
    dateKey: TODAY_KEY,
    readIds: Array.isArray(saved?.readIds) ? saved.readIds : [],
    mathPassIds: Array.isArray(saved?.mathPassIds) ? saved.mathPassIds : [],
    review: Array.isArray(saved?.review) ? saved.review : []
  };
}

function createEmptyProgress() {
  return {
    dateKey: TODAY_KEY,
    readIds: [],
    mathPassIds: [],
    review: []
  };
}

function getTodayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDailyProblems(problems, seedKey) {
  return seededShuffle(problems, hashSeed(seedKey));
}

function seededShuffle(items, seed) {
  const shuffled = [...items];
  let state = seed || 1;

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    state = nextSeed(state);
    const swapIndex = state % (index + 1);
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function hashSeed(value) {
  let hash = 2166136261;
  const text = String(value || "");

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function nextSeed(seed) {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
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

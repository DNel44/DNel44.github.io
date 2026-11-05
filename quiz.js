const sampleTracks = [
  { id: "track-1", title: "Neon Garden", artist: "The Example" },
  { id: "track-2", title: "Paper Moons", artist: "Demo Avenue" },
  { id: "track-3", title: "Quiet Signals", artist: "Northbound Lights" },
  { id: "track-4", title: "Summer Static", artist: "The Placeholder Band" }
];

const mode = document.body.dataset.mode;
const answerForm = document.getElementById("answer-form");
const questionPanel = document.getElementById("question-panel");
const questionNumber = document.getElementById("question-number");
const questionTotal = document.getElementById("question-total");
const scoreElement = document.getElementById("score");
const streakElement = document.getElementById("streak");
const feedback = document.getElementById("feedback");
const nextButton = document.getElementById("next-button");
const skipButton = document.getElementById("skip-button");
const completion = document.getElementById("completion");
const songAudio = document.getElementById("song-audio");
const playlistInfo = document.getElementById("playlist-info");

let currentQuestion = 0;
let score = 0;
let streak = 0;
let awaitingNextQuestion = false;
let questionWasSkipped = false;

questionTotal.textContent = sampleTracks.length;
playlistInfo.textContent = new URLSearchParams(window.location.search).has("playlist")
  ? `Playlist URL: ${new URLSearchParams(window.location.search).get("playlist")}`
  : "No playlist URL was provided.";
document.getElementById("audio-status").textContent =
  "Demo round: sample questions are shown; loading playlist tracks and audio is not connected yet.";

function formatScore(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function updateScoreboard() {
  scoreElement.textContent = formatScore(score);
  streakElement.textContent = streak;
}

function normalizeAnswer(value) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function renderQuestion() {
  const track = sampleTracks[currentQuestion];
  questionNumber.textContent = currentQuestion + 1;
  feedback.textContent = "";
  feedback.dataset.state = "";
  nextButton.hidden = true;
  awaitingNextQuestion = false;
  questionWasSkipped = false;
  answerForm.reset();
  answerForm.querySelectorAll(".is-correct, .is-wrong").forEach(element => {
    element.classList.remove("is-correct", "is-wrong");
  });
  answerForm.querySelectorAll("input, button[type='submit']").forEach(control => {
    control.disabled = false;
  });
  skipButton.disabled = false;
  songAudio.removeAttribute("src");
  songAudio.load();

  if (mode === "classic") {
    document.getElementById("song-title").focus();
    return;
  }

  const options = document.getElementById("answer-options");
  options.replaceChildren();

  shuffle(sampleTracks).forEach(option => {
    const label = document.createElement("label");
    label.className = "answer-option";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "answer";
    radio.value = option.id;

    const choiceText = document.createElement("span");
    choiceText.textContent = `${option.title} — ${option.artist}`;

    label.append(radio, choiceText);
    options.append(label);
  });
}

function finishQuiz(skipped = false) {
  questionPanel.hidden = true;
  completion.hidden = false;
  completion.dataset.state = skipped ? "skipped" : "";
  completion.textContent =
    `${skipped ? "Question skipped. " : ""}Quiz complete! Final score: ${formatScore(score)} out of ${sampleTracks.length}.`;
}

function advanceQuestion(message) {
  currentQuestion += 1;
  if (currentQuestion >= sampleTracks.length) {
    finishQuiz(questionWasSkipped);
    return;
  }

  renderQuestion();
  if (message) {
    setFeedback(`${message} Now on question ${currentQuestion + 1}.`, "skipped");
  }
}

function setFeedback(message, state) {
  feedback.textContent = message;
  feedback.dataset.state = state;
}

function skipQuestion() {
  if (awaitingNextQuestion) return;

  streak = 0;
  questionWasSkipped = true;
  updateScoreboard();
  answerForm.querySelectorAll("input, button[type='submit']").forEach(control => {
    control.disabled = true;
  });
  skipButton.disabled = true;
  awaitingNextQuestion = true;
  setFeedback("Question skipped. You earned 0 points.", "skipped");
  nextButton.hidden = false;
}

answerForm.addEventListener("submit", event => {
  event.preventDefault();
  if (awaitingNextQuestion) return;

  const track = sampleTracks[currentQuestion];
  let points = 0;
  let isPerfectAnswer = false;
  if (mode === "classic") {
    const title = normalizeAnswer(document.getElementById("song-title").value);
    const artist = normalizeAnswer(document.getElementById("artist-name").value);

    if (!title && !artist) {
      skipQuestion();
      return;
    } else {
      const titleIsCorrect = title === normalizeAnswer(track.title);
      const artistIsCorrect = artist === normalizeAnswer(track.artist);
      points = Number(titleIsCorrect) * 0.5 + Number(artistIsCorrect) * 0.5;
      isPerfectAnswer = titleIsCorrect && artistIsCorrect;
      document.getElementById("song-title").classList.add(
        titleIsCorrect ? "is-correct" : "is-wrong"
      );
      document.getElementById("artist-name").classList.add(
        artistIsCorrect ? "is-correct" : "is-wrong"
      );
    }
  } else {
    const selectedAnswer = answerForm.querySelector('input[name="answer"]:checked');
    if (!selectedAnswer) {
      skipQuestion();
      return;
    } else if (selectedAnswer.value === track.id) {
      points = 1;
      isPerfectAnswer = true;
    }

    answerForm.querySelectorAll(".answer-option").forEach(label => {
      const radio = label.querySelector("input");
      if (radio.value === track.id) {
        label.classList.add("is-correct");
      } else if (radio.checked) {
        label.classList.add("is-wrong");
      }
    });
  }

  score += points;
  streak = isPerfectAnswer ? streak + 1 : 0;
  updateScoreboard();

  if (mode === "classic") {
    setFeedback(
      points === 1
        ? "Both answers are correct! You earned 1 point."
        : points === 0.5
          ? "One answer is correct. You earned 0.5 points."
          : "Neither answer is correct. You earned 0 points.",
      points === 1 ? "correct" : points === 0.5 ? "partial" : "wrong"
    );
  } else {
    setFeedback(
      isPerfectAnswer ? "Correct! You earned 1 point." : "Incorrect. You earned 0 points.",
      isPerfectAnswer ? "correct" : "wrong"
    );
  }

  answerForm.querySelectorAll("input, button[type='submit']").forEach(control => {
    control.disabled = true;
  });
  awaitingNextQuestion = true;
  nextButton.hidden = false;
});

nextButton.addEventListener("click", () => {
  if (awaitingNextQuestion) {
    advanceQuestion(questionWasSkipped ? "Skipped." : "");
  }
});

skipButton.addEventListener("click", skipQuestion);

if (mode === "easy") {
  answerForm.addEventListener("change", event => {
    if (event.target.matches('input[name="answer"]')) {
      answerForm.querySelectorAll(".answer-option").forEach(label => {
        label.classList.toggle(
          "is-selected",
          label.querySelector("input").checked
        );
      });
    }
  });
}

renderQuestion();

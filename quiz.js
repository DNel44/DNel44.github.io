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
const playlistInfo = document.getElementById("playlist-info");
const playlistLink = document.getElementById("playlist-link");
const playerStatus = document.getElementById("player-status");
const playClipButton = document.getElementById("play-clip-button");
const pauseClipButton = document.getElementById("pause-clip-button");

let currentQuestion = 0;
let score = 0;
let streak = 0;
let awaitingNextQuestion = false;
let questionWasSkipped = false;
let lastAnswerNeedsReveal = false;
let playlistTracks = [];
let questionTracks = [];
let youtubePlayer;
let youtubePlayerReady = false;
let currentVideoCued = false;
let currentClipStartSeconds = 0;
let clipTimer;
let clipRemainingSeconds;
let clipTimerStartedAt;

const clipDuration = mode === "classic" ? 5 : 7;

const playlistId = new URLSearchParams(window.location.search).get("playlistId");
playlistInfo.textContent = playlistId
  ? `YouTube playlist ID: ${playlistId}`
  : "No YouTube playlist was provided.";
if (playlistId) {
  playlistLink.href = `https://www.youtube.com/playlist?list=${encodeURIComponent(playlistId)}`;
}
document.getElementById("audio-status").textContent =
  "Preparing playlist...";

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
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function titleMatchesAnswer(answer, playlistTitle) {
  const answerWords = normalizeAnswer(answer).split(" ");
  const titleWords = normalizeAnswer(playlistTitle).split(" ");
  if (!answerWords[0]) return false;

  return titleWords.some((_, start) =>
    answerWords.every((word, offset) => titleWords[start + offset] === word)
  );
}

function correctAnswerText(track) {
  return `Correct answer: ${track.title} — ${track.artist}.`;
}

function shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

async function loadPlaylistTracks() {
  const apiKey = window.YOUTUBE_API_KEY;
  if (!apiKey || apiKey === "PASTE_YOUR_RESTRICTED_API_KEY_HERE") {
    throw new Error(
      "The YouTube API key is missing. Check the YOUTUBE_API_KEY GitHub Actions secret and redeploy the site."
    );
  }
  if (!playlistId) {
    throw new Error("No YouTube playlist ID was provided. Return to the menu and enter a playlist link.");
  }

  const tracks = [];
  let pageToken = "";

  do {
    const params = new URLSearchParams({
      key: apiKey,
      part: "snippet,contentDetails",
      playlistId,
      maxResults: "50"
    });
    if (pageToken) params.set("pageToken", pageToken);

    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/playlistItems?${params}`
    );
    const data = await response.json();

    if (!response.ok) {
      const apiMessage = data.error?.message || `YouTube API returned ${response.status}.`;
      throw new Error(apiMessage);
    }

    for (const item of data.items || []) {
      const videoId = item.snippet?.resourceId?.videoId;
      const title = item.snippet?.title;
      if (!videoId || !title || /^(deleted video|private video)$/i.test(title)) continue;

      tracks.push({
        videoId,
        title,
        artist: item.snippet.videoOwnerChannelTitle || "Unknown channel"
      });

      if (tracks.length >= 100) break;
    }

    pageToken = tracks.length >= 100 ? "" : data.nextPageToken || "";
  } while (pageToken);

  if (tracks.length === 0) {
    throw new Error("This playlist has no videos that can be used in the quiz.");
  }

  return tracks;
}

function loadYouTubeIframeAPI() {
  if (window.YT?.Player) return Promise.resolve();

  return new Promise((resolve, reject) => {
    window.onYouTubeIframeAPIReady = resolve;
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.onerror = () => reject(new Error("Could not load the YouTube player API."));
    document.head.append(script);
  });
}

function initializeYouTubePlayer() {
  return loadYouTubeIframeAPI().then(() => new Promise((resolve, reject) => {
    let playerReady = false;
    youtubePlayer = new window.YT.Player("youtube-player", {
      width: "100%",
      height: "100%",
      playerVars: {
        autoplay: 0,
        controls: 1,
        playsinline: 1,
        rel: 0,
        origin: window.location.origin
      },
      events: {
        onReady: event => {
          playerReady = true;
          youtubePlayerReady = true;
          event.target.getIframe().title = "YouTube video player";
          cueCurrentVideo();
          resolve();
        },
        onStateChange: event => {
          if (event.data === window.YT.PlayerState.CUED) {
            const isFirstCue = !currentVideoCued;
            currentVideoCued = true;
            playClipButton.disabled = false;
            pauseClipButton.disabled = true;
            playerStatus.textContent =
              `Ready. The ${clipDuration}-second clip starts at a random point.`;
            if (isFirstCue) {
              currentClipStartSeconds = randomStartForDuration(
                youtubePlayer.getDuration()
              );
              if (currentClipStartSeconds > 0) {
                youtubePlayer.seekTo(currentClipStartSeconds, true);
              }
            }
          } else if (event.data === window.YT.PlayerState.PLAYING) {
            if (clipRemainingSeconds === undefined) {
              clipRemainingSeconds = clipDuration;
            }
            playClipButton.disabled = true;
            pauseClipButton.disabled = false;
            playerStatus.textContent = "Playing a short clip...";
            startClipTimer();
          } else if (
            event.data === window.YT.PlayerState.PAUSED ||
            event.data === window.YT.PlayerState.BUFFERING
          ) {
            pauseClipTimer();
            playClipButton.disabled =
              event.data === window.YT.PlayerState.BUFFERING || !currentVideoCued;
            pauseClipButton.disabled = true;
            if (
              event.data === window.YT.PlayerState.PAUSED &&
              clipRemainingSeconds !== undefined
            ) {
              playerStatus.textContent =
                "Clip paused. Resume with the YouTube player or replay the same clip.";
            }
          } else if (event.data === window.YT.PlayerState.ENDED) {
            pauseClipTimer();
            clipRemainingSeconds = undefined;
            playClipButton.disabled = !currentVideoCued;
            pauseClipButton.disabled = true;
            playerStatus.textContent = "The video ended before the clip finished.";
          }
        },
        onError: event => {
          pauseClipTimer();
          clipRemainingSeconds = undefined;
          playClipButton.disabled = true;
          pauseClipButton.disabled = true;
          playerStatus.textContent =
            `YouTube could not play this video (error ${event.data}). Use the link below to open it on YouTube.`;
          if (!playerReady) {
            reject(new Error(`YouTube player error ${event.data}.`));
          }
        }
      }
    });
  }));
}

function cueCurrentVideo() {
  if (!youtubePlayerReady) return;

  const track = questionTracks[currentQuestion];
  if (!track) return;

  pauseClipTimer();
  clipRemainingSeconds = undefined;
  currentVideoCued = false;
  currentClipStartSeconds = 0;
  playClipButton.disabled = true;
  pauseClipButton.disabled = true;
  playClipButton.textContent = `Play random ${clipDuration}-second clip`;
  playerStatus.textContent = "Loading the current video...";
  youtubePlayer.cueVideoById(track.videoId);
}

function randomStartForDuration(duration) {
  if (!Number.isFinite(duration) || duration <= clipDuration) return 0;

  const latestStart = Math.floor(duration - clipDuration);
  return Math.floor(Math.random() * (latestStart + 1));
}

function stopClip() {
  pauseClipTimer();
  clipRemainingSeconds = undefined;
  if (youtubePlayerReady) youtubePlayer.pauseVideo();
}

function startClipTimer() {
  if (clipRemainingSeconds === undefined) return;

  window.clearTimeout(clipTimer);
  clipTimerStartedAt = performance.now();
  clipTimer = window.setTimeout(() => {
    clipRemainingSeconds = undefined;
    clipTimerStartedAt = undefined;
    pauseClipButton.disabled = true;
    youtubePlayer.pauseVideo();
    playClipButton.disabled = false;
    playerStatus.textContent =
      `Clip finished (${clipDuration} seconds). Play it again or answer the question.`;
  }, clipRemainingSeconds * 1000);
}

function pauseClipTimer() {
  window.clearTimeout(clipTimer);
  if (clipTimerStartedAt !== undefined && clipRemainingSeconds !== undefined) {
    const elapsedSeconds = (performance.now() - clipTimerStartedAt) / 1000;
    clipRemainingSeconds = Math.max(0, clipRemainingSeconds - elapsedSeconds);
  }
  clipTimerStartedAt = undefined;
}

function renderQuestion() {
  const track = questionTracks[currentQuestion];
  questionNumber.textContent = currentQuestion + 1;
  playlistLink.href = `https://www.youtube.com/watch?v=${encodeURIComponent(track.videoId)}`;
  cueCurrentVideo();
  feedback.textContent = "";
  feedback.dataset.state = "";
  nextButton.hidden = true;
  awaitingNextQuestion = false;
  questionWasSkipped = false;
  lastAnswerNeedsReveal = false;
  answerForm.reset();
  answerForm.querySelectorAll(".is-correct, .is-wrong").forEach(element => {
    element.classList.remove("is-correct", "is-wrong");
  });
  answerForm.querySelectorAll("input, button[type='submit']").forEach(control => {
    control.disabled = false;
  });
  skipButton.disabled = false;
  if (mode === "classic") {
    document.getElementById("song-title").focus();
    return;
  }

  const options = document.getElementById("answer-options");
  options.replaceChildren();

  const otherTracks = shuffle(
    playlistTracks.filter(option => option.videoId !== track.videoId)
  ).slice(0, 3);
  shuffle([track, ...otherTracks]).forEach(option => {
    const label = document.createElement("label");
    label.className = "answer-option";

    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "answer";
    radio.value = option.videoId;

    const choiceText = document.createElement("span");
    choiceText.textContent = `${option.title} — ${option.artist}`;

    label.append(radio, choiceText);
    options.append(label);
  });
}

function finishQuiz(skipped = false, completedTrack) {
  stopClip();
  questionPanel.hidden = true;
  completion.hidden = false;
  completion.dataset.state = skipped ? "skipped" : "";
  completion.textContent =
    `${skipped ? "Question skipped. " : ""}Quiz complete! Final score: ${formatScore(score)} out of ${questionTracks.length}.${lastAnswerNeedsReveal && mode === "classic" ? ` ${correctAnswerText(completedTrack)}` : ""}`;
}

function advanceQuestion(message) {
  const completedTrack = questionTracks[currentQuestion];
  currentQuestion += 1;
  if (currentQuestion >= questionTracks.length) {
    finishQuiz(questionWasSkipped, completedTrack);
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

  stopClip();
  streak = 0;
  questionWasSkipped = true;
  lastAnswerNeedsReveal = mode === "classic";
  updateScoreboard();
  answerForm.querySelectorAll("input, button[type='submit']").forEach(control => {
    control.disabled = true;
  });
  skipButton.disabled = true;
  awaitingNextQuestion = true;
  setFeedback(
    `Question skipped. You earned 0 points.${mode === "classic" ? ` ${correctAnswerText(questionTracks[currentQuestion])}` : ""}`,
    "skipped"
  );
  nextButton.hidden = false;
}

answerForm.addEventListener("submit", event => {
  event.preventDefault();
  if (awaitingNextQuestion) return;

  const track = questionTracks[currentQuestion];
  let points = 0;
  let isPerfectAnswer = false;
  if (mode === "classic") {
    const title = normalizeAnswer(document.getElementById("song-title").value);
    const artist = normalizeAnswer(document.getElementById("artist-name").value);

    if (!title && !artist) {
      setFeedback("Enter the song title or artist, or choose Skip question.", "required");
      document.getElementById("song-title").focus();
      return;
    }

    const titleIsCorrect = titleMatchesAnswer(title, track.title);
    const artistIsCorrect = artist === normalizeAnswer(track.artist);
    points = Number(titleIsCorrect) * 0.5 + Number(artistIsCorrect) * 0.5;
    isPerfectAnswer = titleIsCorrect && artistIsCorrect;
    document.getElementById("song-title").classList.add(
      titleIsCorrect ? "is-correct" : "is-wrong"
    );
    document.getElementById("artist-name").classList.add(
      artistIsCorrect ? "is-correct" : "is-wrong"
    );
  } else {
    const selectedAnswer = answerForm.querySelector('input[name="answer"]:checked');
    if (!selectedAnswer) {
      setFeedback("Choose an answer, or choose Skip question.", "required");
      return;
    }

    if (selectedAnswer.value === track.videoId) {
      points = 1;
      isPerfectAnswer = true;
    }

    answerForm.querySelectorAll(".answer-option").forEach(label => {
      const radio = label.querySelector("input");
      if (radio.value === track.videoId) {
        label.classList.add("is-correct");
      } else if (radio.checked) {
        label.classList.add("is-wrong");
      }
    });
  }

  stopClip();
  score += points;
  streak = isPerfectAnswer ? streak + 1 : 0;
  lastAnswerNeedsReveal = mode === "classic" && points < 1;
  updateScoreboard();

  if (mode === "classic") {
    const resultMessage = points === 1
      ? "Both answers are correct! You earned 1 point."
      : points === 0.5
        ? "One answer is correct. You earned 0.5 points."
        : "Neither answer is correct. You earned 0 points.";
    setFeedback(
      `${resultMessage}${lastAnswerNeedsReveal ? ` ${correctAnswerText(track)}` : ""}`,
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
pauseClipButton.addEventListener("click", () => {
  if (!youtubePlayerReady || youtubePlayer.getPlayerState() !== window.YT.PlayerState.PLAYING) {
    return;
  }

  youtubePlayer.pauseVideo();
});
playClipButton.textContent = `Play random ${clipDuration}-second clip`;
playClipButton.addEventListener("click", () => {
  if (!youtubePlayerReady || !currentVideoCued) return;

  window.clearTimeout(clipTimer);
  clipRemainingSeconds = clipDuration;
  youtubePlayer.seekTo(currentClipStartSeconds, true);
  youtubePlayer.playVideo();
  playClipButton.textContent = `Replay same ${clipDuration}-second clip`;
  playerStatus.textContent = `Playing the same ${clipDuration}-second clip...`;
});

if (mode === "easy") {
  answerForm.addEventListener("change", event => {
    if (event.target.matches('input[name="answer"]')) {
      if (feedback.dataset.state === "required") {
        feedback.textContent = "";
        feedback.dataset.state = "";
      }
      answerForm.querySelectorAll(".answer-option").forEach(label => {
        label.classList.toggle(
          "is-selected",
          label.querySelector("input").checked
        );
      });
    }
  });
} else {
  answerForm.addEventListener("input", () => {
    if (feedback.dataset.state === "required") {
      feedback.textContent = "";
      feedback.dataset.state = "";
    }
  });
}

async function startQuiz() {
  const status = document.getElementById("audio-status");
  answerForm.querySelectorAll("input, button[type='submit']").forEach(control => {
    control.disabled = true;
  });
  skipButton.disabled = true;
  nextButton.disabled = true;
  status.textContent = "Loading videos from the YouTube playlist...";

  try {
    playlistTracks = await loadPlaylistTracks();
    questionTracks = shuffle(playlistTracks).slice(0, 10);
    questionTotal.textContent = questionTracks.length;
    status.textContent =
      `Loaded ${playlistTracks.length} playlist videos.`;
    answerForm.querySelectorAll("input, button[type='submit']").forEach(control => {
      control.disabled = false;
    });
    skipButton.disabled = false;
    nextButton.disabled = false;
    renderQuestion();
    initializeYouTubePlayer().catch(error => {
      console.error("Could not initialize YouTube player:", error);
      playClipButton.disabled = true;
      playerStatus.textContent =
        "The embedded player could not be loaded. You can still open the video using the link below.";
    });
  } catch (error) {
    console.error("Could not load YouTube playlist:", error);
    status.textContent = `Could not load playlist: ${error.message}`;
    questionPanel.hidden = true;
    completion.hidden = false;
    completion.dataset.state = "wrong";
    completion.textContent = "The quiz could not be started. Check the message above, then return to the menu and try again.";
  }
}

startQuiz();

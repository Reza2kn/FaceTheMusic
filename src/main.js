import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.module.js';
import { RGBELoader } from 'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/loaders/RGBELoader.js';

const GameState = Object.freeze({
  INIT: 'init',
  CALIBRATING: 'calibrating',
  READY: 'ready',
  COUNTDOWN: 'countdown',
  RUNNING: 'running',
  PAUSED: 'paused',
  GAME_OVER: 'gameOver',
  VICTORY: 'victory',
});

const HIT_WINDOW = 0.25; // seconds on either side of the beat
const TRACK_SPEED = 14; // world units per second to sweep the platforms
const PLATFORM_INTERVAL = 0.5;
const PLATFORM_OFFSET_Z = -4;

const lanePositions = {
  left: -3.5,
  center: 0,
  right: 3.5,
};

const levelHeights = {
  low: 1,
  high: 2.35,
};

const overlay = document.getElementById('status-overlay');
const statusMessage = document.getElementById('status-message');
const startButton = document.getElementById('start-button');
const calibrateButton = document.getElementById('calibrate-button');
const scoreValue = document.getElementById('score-value');
const streakValue = document.getElementById('streak-value');
const inputModeValue = document.getElementById('input-mode');

const canvas = document.getElementById('game-canvas');
const audioElement = document.getElementById('game-audio');
const videoElement = document.getElementById('input-video');

let state = GameState.INIT;
let countdownTimer = null;
let score = 0;
let streak = 0;
let useKeyboardFallback = false;
let trackAvailable = true;

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
});
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050812);

const camera = new THREE.PerspectiveCamera(55, canvas.clientWidth / canvas.clientHeight, 0.1, 200);
camera.position.set(0, 3.8, 8);

const clock = new THREE.Clock();

const ambientLight = new THREE.AmbientLight(0x6680ff, 0.5);
scene.add(ambientLight);

const mainLight = new THREE.DirectionalLight(0xffffff, 1.1);
mainLight.position.set(3, 8, 6);
mainLight.castShadow = false;
scene.add(mainLight);

const platformGroup = new THREE.Group();
scene.add(platformGroup);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(30, 200),
  new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.85 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.z = -60;
floor.receiveShadow = true;
scene.add(floor);

const sideRailGeometry = new THREE.BoxGeometry(0.2, 1.6, 120);
const sideRailMaterial = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.6 });
const leftRail = new THREE.Mesh(sideRailGeometry, sideRailMaterial);
leftRail.position.set(lanePositions.left - 1.9, 1.1, -35);
const rightRail = leftRail.clone();
rightRail.position.x = lanePositions.right + 1.9;
scene.add(leftRail, rightRail);

const orbGeometry = new THREE.SphereGeometry(0.6, 48, 48);
const orbMaterial = new THREE.MeshStandardMaterial({
  color: 0xfacc15,
  emissive: 0xfacc15,
  emissiveIntensity: 0.7,
  roughness: 0.25,
  metalness: 0.1,
});
const orb = new THREE.Mesh(orbGeometry, orbMaterial);
orb.position.set(0, levelHeights.low, PLATFORM_OFFSET_Z);
scene.add(orb);

const glowGeometry = new THREE.RingGeometry(0.8, 1.1, 32);
const glowMaterial = new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide, transparent: true, opacity: 0.35 });
const orbGlow = new THREE.Mesh(glowGeometry, glowMaterial);
orbGlow.rotation.x = Math.PI / 2;
orbGlow.position.copy(orb.position);
scene.add(orbGlow);

const trailPoints = [];
for (let i = 0; i < 40; i += 1) {
  trailPoints.push(new THREE.Vector3(0, levelHeights.low, PLATFORM_OFFSET_Z - i * 0.35));
}
const trailGeometry = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trailPoints), 64, 0.05, 8, false);
const trailMaterial = new THREE.MeshBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.28 });
const trail = new THREE.Mesh(trailGeometry, trailMaterial);
scene.add(trail);

const platformObjects = [];
const platformScaleTarget = new THREE.Vector3(1, 1, 1);
const platformMaterial = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  emissive: 0x2563eb,
  emissiveIntensity: 0.35,
  roughness: 0.45,
  metalness: 0.05,
});
const platformGeometry = new THREE.BoxGeometry(2.4, 0.4, 2.4);

function createPlatformSequence(duration = 60, interval = PLATFORM_INTERVAL) {
  const pattern = [
    { lane: 'center', level: 'low' },
    { lane: 'center', level: 'high' },
    { lane: 'left', level: 'low' },
    { lane: 'right', level: 'low' },
    { lane: 'left', level: 'high' },
    { lane: 'right', level: 'high' },
  ];

  const sequence = [];
  const startDelay = 2.5;
  let time = startDelay;
  let index = 0;

  while (time < duration - 1.5) {
    const patternEntry = pattern[index % pattern.length];
    sequence.push({ time, lane: patternEntry.lane, level: patternEntry.level });

    // Insert a center accent every second beat for accessibility.
    if (index % 4 === 1) {
      sequence.push({
        time: time + interval * 0.5,
        lane: 'center',
        level: index % 8 === 1 ? 'low' : 'high',
      });
    }

    time += interval;
    index += 1;
  }

  return sequence.sort((a, b) => a.time - b.time);
}

const platformSequence = createPlatformSequence();

function buildPlatforms() {
  platformSequence.forEach((item) => {
    const mesh = new THREE.Mesh(platformGeometry, platformMaterial.clone());
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.visible = false;
    platformGroup.add(mesh);
    platformObjects.push({ mesh, data: item, windowOpened: false, resolved: false });
  });
}

buildPlatforms();

const starGeometry = new THREE.BufferGeometry();
const starCount = 400;
const starPositions = new Float32Array(starCount * 3);
for (let i = 0; i < starCount; i += 1) {
  starPositions[i * 3] = (Math.random() - 0.5) * 80;
  starPositions[i * 3 + 1] = Math.random() * 30 + 5;
  starPositions[i * 3 + 2] = -Math.random() * 120;
}
starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
const starMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 0.1, transparent: true, opacity: 0.6 });
const stars = new THREE.Points(starGeometry, starMaterial);
scene.add(stars);

const playerState = {
  targetLane: 'center',
  targetLevel: 'low',
  currentX: lanePositions.center,
  currentY: levelHeights.low,
  bounceVelocity: 0,
  bounceOffset: 0,
};

const faceState = {
  available: false,
  smoothedX: null,
  smoothedY: null,
  lastUpdate: 0,
};

const calibration = {
  collecting: false,
  ready: false,
  samples: [],
  centerX: 0.5,
  centerY: 0.5,
  spreadX: 0.12,
  spreadY: 0.08,
};

function resizeRenderer() {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (canvas.width !== width || canvas.height !== height) {
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }
}

function showOverlay(message, { showStart = false, showCalibrate = true } = {}) {
  statusMessage.textContent = message;
  startButton.style.display = showStart ? 'inline-flex' : 'none';
  calibrateButton.style.display = showCalibrate ? 'inline-flex' : 'none';
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  overlay.classList.add('hidden');
}

function updateScoreboard() {
  scoreValue.textContent = score.toString();
  streakValue.textContent = streak.toString();
}

function resetPlatforms() {
  platformObjects.forEach((platform) => {
    platform.windowOpened = false;
    platform.resolved = false;
    platform.mesh.visible = false;
    platform.mesh.scale.set(1, 1, 1);
    platform.mesh.material.emissiveIntensity = 0.35;
  });
}

function resetGameState() {
  score = 0;
  streak = 0;
  updateScoreboard();
  resetPlatforms();
  playerState.targetLane = 'center';
  playerState.targetLevel = 'low';
  playerState.currentX = lanePositions.center;
  playerState.currentY = levelHeights.low;
  playerState.bounceOffset = 0;
  playerState.bounceVelocity = 0;
}

audioElement.addEventListener('error', () => {
  trackAvailable = false;
  showOverlay('Audio track missing. Add your song as <code>track.mp3</code> next to this page.', {
    showStart: false,
    showCalibrate: true,
  });
});

audioElement.addEventListener('loadeddata', () => {
  trackAvailable = true;
});

audioElement.addEventListener('ended', () => {
  if (state === GameState.RUNNING) {
    state = GameState.VICTORY;
    showOverlay('You nailed it! Ready to spin the track again?', {
      showStart: true,
      showCalibrate: true,
    });
  }
});

function triggerBounce() {
  playerState.bounceVelocity = 2.4;
}

function isPlayerOnPlatform({ lane, level }) {
  return playerState.targetLane === lane && playerState.targetLevel === level;
}

function updateInputModeLabel() {
  inputModeValue.textContent = useKeyboardFallback ? 'Keyboard' : 'Face';
}

function openHitWindow(platform, audioTime) {
  if (!platform.windowOpened && audioTime >= platform.data.time - HIT_WINDOW) {
    platform.windowOpened = true;
  }
}

function resolvePlatform(platform, audioTime) {
  if (!platform.windowOpened || platform.resolved) return;
  if (audioTime <= platform.data.time + HIT_WINDOW) {
    if (isPlayerOnPlatform(platform.data)) {
      platform.resolved = true;
      score += 1;
      streak += 1;
      updateScoreboard();
      triggerBounce();
    }
  } else {
    platform.resolved = true;
    streak = 0;
    updateScoreboard();
    handleGameOver('You missed a platform. Let\'s try that section again!');
  }
}

function updatePlatforms(audioTime) {
  let nextIndex = -1;
  for (let i = 0; i < platformObjects.length; i += 1) {
    const platform = platformObjects[i];
    const offset = (platform.data.time - audioTime) * TRACK_SPEED;
    const visible = offset < 40 && offset > -20;
    platform.mesh.visible = visible;
    platform.mesh.position.set(
      lanePositions[platform.data.lane],
      levelHeights[platform.data.level] - 0.4,
      PLATFORM_OFFSET_Z + offset
    );

    if (!platform.resolved) {
      openHitWindow(platform, audioTime);
      resolvePlatform(platform, audioTime);
    }

    if (!platform.resolved && nextIndex === -1 && platform.data.time >= audioTime) {
      nextIndex = i;
    }
  }

  platformObjects.forEach((platform, index) => {
    const material = platform.mesh.material;
    const targetIntensity = index === nextIndex ? 1.2 : 0.3;
    material.emissiveIntensity += (targetIntensity - material.emissiveIntensity) * 0.1;
    const targetScale = index === nextIndex ? 1.1 : 1;
    platformScaleTarget.set(targetScale, 1, targetScale);
    platform.mesh.scale.lerp(platformScaleTarget, 0.1);
  });
}

function handleGameOver(message) {
  if (state !== GameState.RUNNING) return;
  state = GameState.GAME_OVER;
  audioElement.pause();
  audioElement.currentTime = 0;
  showOverlay(`${message}\nScore: ${score}`, { showStart: true, showCalibrate: true });
}

function updateOrb(delta) {
  const lerpFactorX = Math.min(1, delta * 8);
  const lerpFactorY = Math.min(1, delta * 6);
  const targetX = lanePositions[playerState.targetLane];
  const targetY = levelHeights[playerState.targetLevel];

  playerState.currentX += (targetX - playerState.currentX) * lerpFactorX;
  playerState.currentY += (targetY - playerState.currentY) * lerpFactorY;

  if (playerState.bounceVelocity !== 0 || playerState.bounceOffset !== 0) {
    playerState.bounceOffset += playerState.bounceVelocity * delta;
    playerState.bounceVelocity -= 5 * delta;
    if (playerState.bounceOffset < 0) {
      playerState.bounceOffset = 0;
      playerState.bounceVelocity = 0;
    }
  }

  const wobble = Math.sin(clock.elapsedTime * 6) * 0.05;
  orb.position.set(playerState.currentX, playerState.currentY + playerState.bounceOffset + wobble, PLATFORM_OFFSET_Z);
  orbGlow.position.copy(orb.position);
  orbGlow.rotation.z += delta * 1.2;
}

function updateStars(delta) {
  stars.rotation.y += delta * 0.01;
  stars.rotation.x += delta * 0.005;
}

function setPlayerTargetFromFace(x, y) {
  if (!calibration.ready) return;

  const normalizedX = (x - calibration.centerX) / calibration.spreadX;
  const normalizedY = (calibration.centerY - y) / calibration.spreadY;

  if (normalizedX < -0.85) {
    playerState.targetLane = 'left';
  } else if (normalizedX > 0.85) {
    playerState.targetLane = 'right';
  } else {
    playerState.targetLane = 'center';
  }

  if (normalizedY > 0.8) {
    playerState.targetLevel = 'high';
  } else if (normalizedY < -0.6) {
    playerState.targetLevel = 'low';
  }
}

function processFaceLandmarks(landmarks) {
  if (!landmarks || !landmarks.length) {
    faceState.available = false;
    return;
  }

  const firstFace = landmarks[0];
  if (!firstFace || firstFace.length === 0) {
    faceState.available = false;
    return;
  }

  const noseTip = firstFace[1];
  const rawX = noseTip?.x ?? 0.5;
  const rawY = noseTip?.y ?? 0.5;

  if (faceState.smoothedX === null) {
    faceState.smoothedX = rawX;
    faceState.smoothedY = rawY;
  } else {
    faceState.smoothedX += (rawX - faceState.smoothedX) * 0.35;
    faceState.smoothedY += (rawY - faceState.smoothedY) * 0.35;
  }

  faceState.available = true;
  faceState.lastUpdate = performance.now();

  if (calibration.collecting) {
    calibration.samples.push({ x: faceState.smoothedX, y: faceState.smoothedY });
    if (calibration.samples.length >= 120) {
      finalizeCalibration();
    }
  }

  if (!calibration.collecting && calibration.ready && !useKeyboardFallback) {
    setPlayerTargetFromFace(faceState.smoothedX, faceState.smoothedY);
  }
}

function finalizeCalibration() {
  if (!calibration.collecting || calibration.samples.length === 0) return;
  const xs = calibration.samples.map((sample) => sample.x);
  const ys = calibration.samples.map((sample) => sample.y);
  const centerX = xs.reduce((acc, value) => acc + value, 0) / xs.length;
  const centerY = ys.reduce((acc, value) => acc + value, 0) / ys.length;
  const spreadX = Math.max(0.06, Math.sqrt(xs.reduce((acc, value) => acc + (value - centerX) ** 2, 0) / xs.length) * 1.8);
  const spreadY = Math.max(0.05, Math.sqrt(ys.reduce((acc, value) => acc + (value - centerY) ** 2, 0) / ys.length) * 1.8);

  calibration.centerX = centerX;
  calibration.centerY = centerY;
  calibration.spreadX = spreadX;
  calibration.spreadY = spreadY;
  calibration.collecting = false;
  calibration.ready = true;
  calibration.samples = [];

  state = GameState.READY;
  showOverlay('Calibration complete! When you are ready, start the track and follow the beat.', {
    showStart: true,
    showCalibrate: true,
  });
}

function startCalibration() {
  state = GameState.CALIBRATING;
  calibration.collecting = true;
  calibration.ready = false;
  calibration.samples = [];
  useKeyboardFallback = false;
  updateInputModeLabel();
  showOverlay('Let\'s calibrate! Gently move your head left/right and up/down for a moment.', {
    showStart: false,
    showCalibrate: false,
  });
}

function beginCountdown() {
  if (!trackAvailable) {
    showOverlay('Audio track missing. Add <code>track.mp3</code> next to this page.', {
      showStart: false,
      showCalibrate: true,
    });
    return;
  }

  state = GameState.COUNTDOWN;
  let counter = 3;
  showOverlay(`Starting in ${counter}…`, { showStart: false, showCalibrate: false });
  countdownTimer = setInterval(() => {
    counter -= 1;
    if (counter <= 0) {
      clearInterval(countdownTimer);
      countdownTimer = null;
      hideOverlay();
      launchGame();
    } else {
      showOverlay(`Starting in ${counter}…`, { showStart: false, showCalibrate: false });
    }
  }, 1000);
}

async function launchGame() {
  resetGameState();
  state = GameState.RUNNING;
  clock.start();

  try {
    audioElement.currentTime = 0;
    await audioElement.play();
  } catch (error) {
    console.warn('Unable to start audio automatically:', error);
    showOverlay('Tap the Start button again after interacting with the page to unlock audio.', {
      showStart: true,
      showCalibrate: true,
    });
    state = GameState.READY;
    return;
  }
}

function stopGame() {
  audioElement.pause();
  audioElement.currentTime = 0;
  state = GameState.READY;
  showOverlay('Playback stopped. Ready when you are!', {
    showStart: true,
    showCalibrate: true,
  });
}

startButton.addEventListener('click', () => {
  if (state === GameState.COUNTDOWN) return;

  if (!calibration.ready) {
    startCalibration();
    return;
  }

  if (state === GameState.RUNNING) {
    stopGame();
    return;
  }

  beginCountdown();
});

calibrateButton.addEventListener('click', () => {
  if (state === GameState.RUNNING) {
    stopGame();
  }
  startCalibration();
});

document.addEventListener('keydown', (event) => {
  if (event.repeat) return;
  switch (event.key.toLowerCase()) {
    case 'a':
    case 'arrowleft':
      playerState.targetLane = 'left';
      useKeyboardFallback = true;
      break;
    case 'd':
    case 'arrowright':
      playerState.targetLane = 'right';
      useKeyboardFallback = true;
      break;
    case 's':
    case 'arrowdown':
      playerState.targetLevel = 'low';
      useKeyboardFallback = true;
      break;
    case 'w':
    case 'arrowup':
      playerState.targetLevel = 'high';
      useKeyboardFallback = true;
      break;
    case 'r':
      startCalibration();
      break;
    default:
      return;
  }
  updateInputModeLabel();
});

function updateInputModeUsage() {
  if (useKeyboardFallback && faceState.available) {
    const inactiveDuration = performance.now() - faceState.lastUpdate;
    if (inactiveDuration < 1500) {
      useKeyboardFallback = false;
      updateInputModeLabel();
    }
  }

  if (!useKeyboardFallback && faceState.available) {
    setPlayerTargetFromFace(faceState.smoothedX, faceState.smoothedY);
  }
}

function animate() {
  requestAnimationFrame(animate);
  resizeRenderer();
  const delta = clock.getDelta();

  if (state === GameState.RUNNING) {
    const audioTime = audioElement.currentTime;
    updatePlatforms(audioTime);
    updateInputModeUsage();
  }

  updateOrb(delta);
  updateStars(delta);

  renderer.render(scene, camera);
}

animate();

function setupFaceMesh() {
  if (!window.FaceMesh || !window.Camera) {
    console.warn('Mediapipe libraries not loaded yet. Retrying…');
    setTimeout(setupFaceMesh, 300);
    return;
  }

  const faceMesh = new window.FaceMesh.FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
  });

  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  faceMesh.onResults((results) => {
    processFaceLandmarks(results.multiFaceLandmarks);
  });

  const cameraFeed = new window.Camera(videoElement, {
    onFrame: async () => {
      await faceMesh.send({ image: videoElement });
    },
    width: 640,
    height: 480,
  });

  cameraFeed
    .start()
    .then(() => {
      videoElement.classList.add('visible');
      if (!calibration.collecting && !calibration.ready) {
        startCalibration();
      }
    })
    .catch((error) => {
      console.error('Unable to start camera:', error);
      showOverlay('Camera access is required to play. Please enable your webcam and reload.', {
        showStart: false,
        showCalibrate: false,
      });
    });
}

setupFaceMesh();

function initBackground() {
  const loader = new RGBELoader();
  loader.load(
    'https://cdn.jsdelivr.net/gh/pmndrs/drei-assets@master/hdri/moonless_golf_1k.hdr',
    (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.environment = texture;
    },
    undefined,
    (error) => {
      console.warn('Unable to load HDR environment:', error);
    }
  );
}

initBackground();

updateInputModeLabel();

showOverlay('Hold tight… we\'re warming up the track.', { showStart: false, showCalibrate: false });

window.addEventListener('blur', () => {
  if (state === GameState.RUNNING) {
    stopGame();
  }
});

window.addEventListener('resize', () => {
  resizeRenderer();
});

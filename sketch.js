// Physarum-inspired particle, chemotaxis, and flow-reinforcement simulation.
const FIELD_PIXEL_SIZE = 4;
const MAX_GRID_WIDTH = 480;
const MAX_GRID_HEIGHT = 270;
const TARGET_FPS = 30;
const INITIAL_FOOD_COUNT = 2;
const INITIAL_OBSTACLE_COUNT = 3;
const PALETTE_STEPS = 48;
const STATE_VERSION = 1;
const STATE_SAVE_INTERVAL_MS = 30_000;

const APP_PARAMETERS = new URLSearchParams(window.location.search);
const IS_EXHIBIT_MODE = APP_PARAMETERS.get("mode") === "exhibit";
const TRACKING_INPUT_ENABLED = IS_EXHIBIT_MODE || APP_PARAMETERS.get("input") === "tracking";

const SENSOR_OFFSET = 6;
const SENSOR_ANGLE = Math.PI / 4;
const TURN_ANGLE = Math.PI / 4.8;
const TRAIL_DEPOSIT = 0.4;
const TUBE_REINFORCEMENT = 0.005;
const DIFFUSION_INTERVAL = 3;
const REMODELING_INTERVAL = 12;
const FOOD_UPDATE_INTERVAL = 6;

const COLORS = {
  edge: [96, 67, 2],
  body: [225, 176, 8],
  core: [255, 244, 94],
  food: [229, 128, 72],
  foodCore: [255, 231, 185],
};

const ENVIRONMENTS = [
  {
    name: "朽ち木",
    kind: "wood",
    base: [18, 11, 5],
    mid: [53, 31, 13],
    highlight: [105, 69, 30],
    shadow: [7, 5, 3],
    obstacle: [25, 20, 13],
    obstacleEdge: [124, 97, 55],
    obstacleText: [184, 157, 105],
    noiseOffset: 17.3,
  },
  {
    name: "腐葉土",
    kind: "leaf-litter",
    base: [13, 9, 5],
    mid: [47, 29, 13],
    highlight: [103, 66, 27],
    shadow: [5, 5, 3],
    obstacle: [29, 24, 15],
    obstacleEdge: [112, 91, 55],
    obstacleText: [174, 148, 99],
    noiseOffset: 53.9,
  },
  {
    name: "湿った岩",
    kind: "wet-rock",
    base: [8, 14, 12],
    mid: [28, 42, 35],
    highlight: [76, 89, 68],
    shadow: [4, 8, 8],
    obstacle: [20, 29, 27],
    obstacleEdge: [106, 125, 109],
    obstacleText: [163, 182, 156],
    noiseOffset: 91.7,
  },
];

let gridWidth;
let gridHeight;
let cellImage;
let environmentImage;
let previousEnvironmentImage;
let environmentTransition = 1;
let environmentIndex = 0;
let trailField;
let nextTrailField;
let tubeField;
let nextTubeField;
let occupancy;
let obstacleMask;
let particles;
let foods;
let obstacles;
let palette;
let baseParticleTarget;
let simulationFrame = 0;
let speedAccumulator = 0;
let growthSpeedMultiplier = 20;
let generationSeed = 0;
let isPaused = false;
let isExperienceStarted = false;
let draggedFood = null;
let didDragFood = false;
let dragSnapshot = null;
let draggedObstacle = null;
let didDragObstacle = false;
let obstacleDragSnapshot = null;
let nextFoodId = 1;
let trackingClient = null;
let trackingStatus = "disabled";
let latestTrackingSequence = -1;
let dormancyLevel = 0;
let dailyStateStore = null;
let stateSaveTimer = null;
let isStateRestoreComplete = false;

function setup() {
  pixelDensity(1);

  document.body.classList.toggle("is-exhibit-mode", IS_EXHIBIT_MODE);
  if (IS_EXHIBIT_MODE) {
    document.body.classList.remove("is-awaiting-start");
    isExperienceStarted = true;
  }

  const size = getFittedCanvasSize();
  const canvas = createCanvas(size.width, size.height);
  canvas.parent("artwork");

  noSmooth();
  frameRate(TARGET_FPS);
  setupFullscreenControls();
  setupSpeedControls();
  setupEnvironmentControl();
  regenerate();
  setupDailyStatePersistence().finally(setupTrackingInput);
}

function setupFullscreenControls() {
  const overlay = document.getElementById("experience-start");
  const fullscreenStart = document.getElementById("experience-start-fullscreen");
  const windowedStart = document.getElementById("experience-start-windowed");
  const fullscreenToggle = document.getElementById("fullscreen-toggle");

  if (IS_EXHIBIT_MODE) {
    isExperienceStarted = true;
    document.body.classList.remove("is-awaiting-start");
    if (overlay) {
      overlay.classList.add("is-dismissed");
      overlay.setAttribute("aria-hidden", "true");
      overlay.inert = true;
    }
    return;
  }

  if (!overlay || !fullscreenStart || !windowedStart) {
    isExperienceStarted = true;
    document.body.classList.remove("is-awaiting-start");
    return;
  }

  const beginExperience = async (useFullscreen) => {
    fullscreenStart.disabled = true;
    windowedStart.disabled = true;

    if (useFullscreen) {
      await enterAppFullscreen();
    }

    isExperienceStarted = true;
    fullscreenStart.blur();
    windowedStart.blur();
    document.body.classList.remove("is-awaiting-start");
    overlay.classList.add("is-dismissed");
    overlay.setAttribute("aria-hidden", "true");
    overlay.inert = true;
  };

  fullscreenStart.addEventListener("click", () => beginExperience(true));
  windowedStart.addEventListener("click", () => beginExperience(false));

  if (fullscreenToggle) {
    fullscreenToggle.addEventListener("click", toggleAppFullscreen);
  }

  document.addEventListener("fullscreenchange", updateFullscreenControl);
  updateFullscreenControl();

  if (!document.fullscreenEnabled || !document.documentElement.requestFullscreen) {
    fullscreenStart.hidden = true;
    windowedStart.textContent = "体験を始める";
    if (fullscreenToggle) {
      fullscreenToggle.hidden = true;
    }
  }
}

async function enterAppFullscreen() {
  if (!document.fullscreenEnabled || document.fullscreenElement) {
    return;
  }

  try {
    await document.documentElement.requestFullscreen({ navigationUI: "hide" });
  } catch (error) {
    console.warn("Fullscreen request was rejected:", error);
  }
}

async function toggleAppFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await enterAppFullscreen();
    }
  } catch (error) {
    console.warn("Fullscreen toggle failed:", error);
  }
}

function updateFullscreenControl() {
  const fullscreenToggle = document.getElementById("fullscreen-toggle");
  const fullscreenLabel = document.getElementById("fullscreen-label");
  if (!fullscreenToggle || !fullscreenLabel) {
    return;
  }

  const isFullscreen = Boolean(document.fullscreenElement);
  fullscreenLabel.textContent = isFullscreen ? "解除" : "全画面";
  fullscreenToggle.setAttribute(
    "aria-label",
    isFullscreen ? "全画面を終了する" : "全画面にする",
  );
  fullscreenToggle.setAttribute("aria-pressed", String(isFullscreen));
}

function setupSpeedControls() {
  const buttons = document.querySelectorAll("[data-speed]");

  for (const button of buttons) {
    button.addEventListener("click", () => {
      growthSpeedMultiplier = Number(button.dataset.speed);
      speedAccumulator = 0;

      for (const target of buttons) {
        const isActive = target === button;
        target.classList.toggle("is-active", isActive);
        target.setAttribute("aria-pressed", String(isActive));
      }
    });
  }
}

function setupEnvironmentControl() {
  const button = document.getElementById("environment-toggle");
  if (!button) {
    return;
  }

  button.addEventListener("click", () => {
    environmentIndex = (environmentIndex + 1) % ENVIRONMENTS.length;
    palette = buildPalette();
    updateEnvironmentControl();
    buildEnvironmentImage(!isPaused && !prefersReducedMotion());

    if (isPaused) {
      redraw();
    }
  });

  updateEnvironmentControl();
}

function updateEnvironmentControl() {
  const button = document.getElementById("environment-toggle");
  const name = document.getElementById("environment-name");
  const environment = ENVIRONMENTS[environmentIndex];

  if (name) {
    name.textContent = environment.name;
  }
  if (button) {
    button.setAttribute("aria-label", `環境を変える。現在: ${environment.name}`);
  }
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function setupTrackingInput() {
  if (!TRACKING_INPUT_ENABLED || trackingClient || !window.MojihokoriTracking) {
    return;
  }

  trackingClient = new window.MojihokoriTracking.TrackingClient({
    onFrame: applyTrackingFrame,
    onStatus: (status) => {
      if (status.state === "connected") {
        // The tracking server may have restarted its sequence at zero.
        latestTrackingSequence = -1;
      }
      if (trackingStatus !== status.state) {
        trackingStatus = status.state;
        console.info("Tracking connection:", status.state);
      }
    },
  });
  trackingClient.connect();
}

function applyTrackingFrame(frame) {
  if (!TRACKING_INPUT_ENABLED || !gridWidth || frame.sequence <= latestTrackingSequence) {
    return;
  }
  latestTrackingSequence = frame.sequence;
  trackingStatus = frame.camera === "ok" ? "receiving" : "camera-lost";

  const previousFoods = new Map(foods.map((food) => [String(food.id), food]));
  const previousObstacles = new Map(obstacles.map((obstacle) => [String(obstacle.id), obstacle]));
  const nextFoods = [];
  const nextObstacles = [];

  for (const tracked of frame.objects) {
    if (tracked.kind === "food") {
      const x = clamp(tracked.x * gridWidth, 1, gridWidth - 2);
      const y = clamp(tracked.y * gridHeight, 1, gridHeight - 2);
      const existing = previousFoods.get(tracked.id);
      const food = existing || createFood(x, y, tracked.id);
      const stoppedMoving = Boolean(food.trackedMoving) && !tracked.moving;
      food.x = x;
      food.y = y;
      food.isPlaced = true;
      food.trackedMoving = tracked.moving;
      if (tracked.contour.length >= 3) {
        const contour = tracked.contour.map((point) => [
          point[0] * gridWidth,
          point[1] * gridHeight,
        ]);
        food.radius = Math.max(3, getContourRadius(contour, x, y));
      }
      if (stoppedMoving) {
        replenishFood(food);
      }
      nextFoods.push(food);
      continue;
    }

    const obstacle = createTrackedObstacle(tracked, previousObstacles.get(tracked.id));
    nextObstacles.push(obstacle);
  }

  const obstacleGeometryChanged = haveObstacleGeometriesChanged(obstacles, nextObstacles);
  foods = nextFoods;
  obstacles = nextObstacles;
  if (obstacleGeometryChanged) {
    buildObstacleMask();
    reconcileOrganismWithObstacles();
  }

  if (isPaused) {
    redraw();
  }
}

function replenishFood(food) {
  food.nutrition = 1;
  food.engulfment = 0;
  food.activation = 1;
  food.recovery = 0;
}

function getContourRadius(contour, centerX, centerY) {
  if (!contour.length) {
    return Math.min(gridWidth, gridHeight) * 0.025;
  }
  const distances = contour.map((point) => Math.hypot(point[0] - centerX, point[1] - centerY));
  return distances.reduce((sum, distance) => sum + distance, 0) / distances.length;
}

function createTrackedObstacle(tracked, existing) {
  const x = clamp(tracked.x * gridWidth, 1, gridWidth - 2);
  const y = clamp(tracked.y * gridHeight, 1, gridHeight - 2);
  const contour = tracked.contour.length >= 3
    ? tracked.contour.map((point) => [
      clamp(point[0] * gridWidth, 0, gridWidth - 1),
      clamp(point[1] * gridHeight, 0, gridHeight - 1),
    ])
    : [];
  const extentX = contour.length
    ? Math.max(...contour.map((point) => Math.abs(point[0] - x)))
    : Math.min(gridWidth, gridHeight) * 0.075;
  const extentY = contour.length
    ? Math.max(...contour.map((point) => Math.abs(point[1] - y)))
    : Math.min(gridWidth, gridHeight) * 0.055;
  return {
    id: tracked.id,
    x,
    y,
    radiusX: Math.max(3, extentX),
    radiusY: Math.max(3, extentY),
    rotation: existing ? existing.rotation : 0,
    edgePhase: existing ? existing.edgePhase : random(TWO_PI),
    contour,
    isPlaced: true,
    trackedMoving: tracked.moving,
  };
}

function haveObstacleGeometriesChanged(previous, next) {
  if (previous.length !== next.length) {
    return true;
  }
  const previousById = new Map(previous.map((obstacle) => [String(obstacle.id), obstacle]));
  for (const obstacle of next) {
    const old = previousById.get(String(obstacle.id));
    if (!old || Math.hypot(old.x - obstacle.x, old.y - obstacle.y) > 0.2) {
      return true;
    }
    if ((old.contour || []).length !== obstacle.contour.length) {
      return true;
    }
    for (let index = 0; index < obstacle.contour.length; index += 1) {
      if (Math.hypot(
        old.contour[index][0] - obstacle.contour[index][0],
        old.contour[index][1] - obstacle.contour[index][1],
      ) > 0.2) {
        return true;
      }
    }
  }
  return false;
}

async function setupDailyStatePersistence() {
  isStateRestoreComplete = false;
  if (!IS_EXHIBIT_MODE || !window.MojihokoriState) {
    isStateRestoreComplete = true;
    return;
  }

  dailyStateStore = new window.MojihokoriState.DailyStateStore();
  try {
    if (APP_PARAMETERS.get("reset") === "1") {
      await dailyStateStore.clear();
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete("reset");
      window.history.replaceState(null, "", cleanUrl);
    } else {
      const savedState = await dailyStateStore.load();
      if (savedState) {
        restoreSimulationState(savedState);
        console.info("Restored exhibition state saved at", new Date(savedState.savedAt));
      }
    }
    await dailyStateStore.pruneExcept();
  } catch (error) {
    console.warn("Daily state restoration is unavailable:", error);
  } finally {
    isStateRestoreComplete = true;
    stateSaveTimer = window.setInterval(saveSimulationState, STATE_SAVE_INTERVAL_MS);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        saveSimulationState();
      }
    });
  }
}

let stateSaveInProgress = false;

async function saveSimulationState() {
  if (!dailyStateStore || !isStateRestoreComplete || stateSaveInProgress || !trailField) {
    return;
  }
  stateSaveInProgress = true;
  try {
    await dailyStateStore.save({
      version: STATE_VERSION,
      gridWidth,
      gridHeight,
      generationSeed,
      simulationFrame,
      speedAccumulator,
      environmentIndex: 0,
      dormancyLevel,
      trailField: trailField.slice(),
      tubeField: tubeField.slice(),
      occupancy: occupancy.slice(),
      obstacleMask: obstacleMask.slice(),
      particles: particles.map((particle) => ({ ...particle })),
      foods: foods.map((food) => ({ ...food })),
      obstacles: obstacles.map((obstacle) => ({
        ...obstacle,
        contour: (obstacle.contour || []).map((point) => [...point]),
      })),
    });
  } catch (error) {
    console.warn("Daily state save failed:", error);
  } finally {
    stateSaveInProgress = false;
  }
}

function restoreSimulationState(saved) {
  const expectedLength = gridWidth * gridHeight;
  if (
    saved.version !== STATE_VERSION
    || saved.gridWidth !== gridWidth
    || saved.gridHeight !== gridHeight
    || !saved.trailField
    || saved.trailField.length !== expectedLength
    || !saved.tubeField
    || saved.tubeField.length !== expectedLength
    || !saved.occupancy
    || saved.occupancy.length !== expectedLength
    || !saved.obstacleMask
    || saved.obstacleMask.length !== expectedLength
  ) {
    console.warn("Saved exhibition state is incompatible with the current canvas and was ignored");
    return false;
  }

  generationSeed = Number(saved.generationSeed) || generationSeed;
  simulationFrame = Number(saved.simulationFrame) || 0;
  speedAccumulator = Number(saved.speedAccumulator) || 0;
  environmentIndex = 0;
  dormancyLevel = clamp(Number(saved.dormancyLevel) || 0, 0, 1);
  trailField = new Float32Array(saved.trailField);
  nextTrailField = trailField.slice();
  tubeField = new Float32Array(saved.tubeField);
  nextTubeField = tubeField.slice();
  occupancy = new Uint8Array(saved.occupancy);
  obstacleMask = new Uint8Array(saved.obstacleMask);
  particles = Array.isArray(saved.particles) ? saved.particles : particles;
  foods = Array.isArray(saved.foods) ? saved.foods : [];
  obstacles = Array.isArray(saved.obstacles) ? saved.obstacles : [];
  nextFoodId = foods.reduce(
    (maximum, food) => typeof food.id === "number" ? Math.max(maximum, food.id + 1) : maximum,
    1,
  );
  randomSeed(generationSeed);
  noiseSeed(generationSeed);
  palette = buildPalette();
  buildEnvironmentImage(false);
  return true;
}

function draw() {
  if (isExperienceStarted && !isPaused) {
    speedAccumulator += growthSpeedMultiplier;
    const steps = Math.floor(speedAccumulator);
    speedAccumulator -= steps;

    for (let step = 0; step < steps; step += 1) {
      simulateStep();
    }
  }

  renderSimulation();
  updateInteractionCursor();
}

function getFittedCanvasSize() {
  const aspect = 16 / 9;
  let canvasWidth;
  let canvasHeight;

  if (windowWidth / windowHeight > aspect) {
    canvasHeight = Math.floor(windowHeight / FIELD_PIXEL_SIZE) * FIELD_PIXEL_SIZE;
    canvasWidth = Math.floor((canvasHeight * aspect) / FIELD_PIXEL_SIZE) * FIELD_PIXEL_SIZE;
  } else {
    canvasWidth = Math.floor(windowWidth / FIELD_PIXEL_SIZE) * FIELD_PIXEL_SIZE;
    canvasHeight = Math.floor((canvasWidth / aspect) / FIELD_PIXEL_SIZE) * FIELD_PIXEL_SIZE;
  }

  return {
    width: Math.max(FIELD_PIXEL_SIZE, canvasWidth),
    height: Math.max(FIELD_PIXEL_SIZE, canvasHeight),
  };
}

function regenerate() {
  generationSeed = Math.floor(Math.random() * 1_000_000_000);
  randomSeed(generationSeed);
  noiseSeed(generationSeed);
  simulationFrame = 0;
  speedAccumulator = 0;
  draggedFood = null;
  didDragFood = false;
  dragSnapshot = null;
  draggedObstacle = null;
  didDragObstacle = false;
  obstacleDragSnapshot = null;
  nextFoodId = 1;
  dormancyLevel = 0;

  initializeGrid();
  buildEnvironmentImage(false);
  if (TRACKING_INPUT_ENABLED) {
    buildObstacleMask();
  } else {
    initializeFoods();
    initializeObstacles();
  }
  initializeOrganism();

  for (let pass = 0; pass < 5; pass += 1) {
    diffuseFields(1);
  }

  if (isPaused) {
    redraw();
  }
}

function initializeGrid() {
  const rawGridWidth = Math.max(1, Math.floor(width / FIELD_PIXEL_SIZE));
  const rawGridHeight = Math.max(1, Math.floor(height / FIELD_PIXEL_SIZE));
  const scale = Math.max(
    1,
    rawGridWidth / MAX_GRID_WIDTH,
    rawGridHeight / MAX_GRID_HEIGHT,
  );

  gridWidth = Math.max(1, Math.floor(rawGridWidth / scale));
  gridHeight = Math.max(1, Math.floor(rawGridHeight / scale));

  const cellCount = gridWidth * gridHeight;
  trailField = new Float32Array(cellCount);
  nextTrailField = new Float32Array(cellCount);
  tubeField = new Float32Array(cellCount);
  nextTubeField = new Float32Array(cellCount);
  occupancy = new Uint8Array(cellCount);
  obstacleMask = new Uint8Array(cellCount);
  particles = [];
  foods = [];
  obstacles = [];
  baseParticleTarget = clamp(Math.floor(cellCount * 0.028), 1500, 4200);

  cellImage = createImage(gridWidth, gridHeight);
  environmentImage = null;
  previousEnvironmentImage = null;
  environmentTransition = 1;
  palette = buildPalette();
}

function buildEnvironmentImage(animate) {
  const environment = ENVIRONMENTS[environmentIndex];
  const nextImage = createImage(gridWidth, gridHeight);
  nextImage.loadPixels();

  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const color = getEnvironmentPixel(environment, x, y);
      const pixelIndex = (y * gridWidth + x) * 4;
      nextImage.pixels[pixelIndex] = color[0];
      nextImage.pixels[pixelIndex + 1] = color[1];
      nextImage.pixels[pixelIndex + 2] = color[2];
      nextImage.pixels[pixelIndex + 3] = 255;
    }
  }

  nextImage.updatePixels();
  previousEnvironmentImage = animate ? environmentImage : null;
  environmentImage = nextImage;
  environmentTransition = previousEnvironmentImage ? 0 : 1;
}

function getEnvironmentPixel(environment, x, y) {
  const seedOffset = (generationSeed % 10_000) * 0.0001;
  const offset = environment.noiseOffset + seedOffset;
  const broad = noise(x * 0.018 + offset, y * 0.018 - offset);
  const detail = noise(x * 0.092 - offset, y * 0.092 + offset);
  const fleck = pixelHash(x, y, generationSeed + environment.noiseOffset * 100);
  let color;

  if (environment.kind === "wood") {
    const warp = noise(x * 0.027 + offset * 2, offset) * 9;
    const grain = Math.sin(y * 0.31 + x * 0.012 + warp);
    const amount = clamp(broad * 0.58 + detail * 0.14 + (grain + 1) * 0.14, 0, 1);
    color = mixColor(environment.base, environment.mid, amount);

    if (Math.abs(grain) > 0.88) {
      color = mixColor(color, grain > 0 ? environment.highlight : environment.shadow, 0.2);
    }
    if (fleck > 0.996) {
      color = mixColor(color, environment.highlight, 0.35);
    }
    return color;
  }

  if (environment.kind === "leaf-litter") {
    const clump = noise(x * 0.045 + offset * 3, y * 0.038 - offset * 2);
    const amount = clamp(broad * 0.48 + clump * 0.38 + detail * 0.14, 0, 1);
    color = mixColor(environment.base, environment.mid, amount);

    if (fleck > 0.982) {
      color = mixColor(color, environment.highlight, 0.45 + fleck * 0.25);
    } else if (fleck < 0.025) {
      color = mixColor(color, environment.shadow, 0.55);
    }
    return color;
  }

  const cloud = noise(x * 0.034 + offset * 2, y * 0.029 - offset * 2);
  const seamNoise = noise(x * 0.025 - offset, y * 0.025 + offset * 3);
  const amount = clamp(broad * 0.36 + cloud * 0.5 + detail * 0.14, 0, 1);
  color = mixColor(environment.base, environment.mid, amount);

  if (Math.abs(seamNoise - 0.5) < 0.018) {
    color = mixColor(color, environment.shadow, 0.72);
  } else if (cloud > 0.66 && detail > 0.55) {
    color = mixColor(color, environment.highlight, (cloud - 0.66) * 0.9);
  }
  if (fleck > 0.995) {
    color = mixColor(color, environment.highlight, 0.4);
  }
  return color;
}

function pixelHash(x, y, salt) {
  const value = Math.sin(x * 12.9898 + y * 78.233 + salt * 0.001) * 43758.5453;
  return value - Math.floor(value);
}

function initializeFoods() {
  const shortestSide = Math.min(gridWidth, gridHeight);
  const marginX = gridWidth * 0.14;
  const marginY = gridHeight * 0.17;
  const minimumSeparation = shortestSide * 0.42;

  for (let i = 0; i < INITIAL_FOOD_COUNT; i += 1) {
    let x = gridWidth * 0.5;
    let y = gridHeight * 0.5;

    for (let attempt = 0; attempt < 64; attempt += 1) {
      x = random(marginX, gridWidth - marginX);
      y = random(marginY, gridHeight - marginY);
      if (foods.every((food) => Math.hypot(food.x - x, food.y - y) >= minimumSeparation)) {
        break;
      }
    }

    foods.push(createFood(x, y));
  }
}

function createFood(x, y, id = null) {
  const shortestSide = Math.min(gridWidth, gridHeight);

  return {
    id: id === null ? nextFoodId++ : String(id),
    x: clamp(x, 5, gridWidth - 5),
    y: clamp(y, 5, gridHeight - 5),
    radius: Math.max(5, shortestSide * 0.025),
    nutrition: 1,
    engulfment: 0,
    activation: 0,
    recovery: 0,
    pulsePhase: random(TWO_PI),
    isPlaced: true,
    trackedMoving: false,
  };
}

function initializeObstacles() {
  const shortestSide = Math.min(gridWidth, gridHeight);
  obstacles = [];

  for (let i = 0; i < INITIAL_OBSTACLE_COUNT; i += 1) {
    let candidate = null;

    for (let attempt = 0; attempt < 80; attempt += 1) {
      const radiusX = shortestSide * random(0.055, 0.115);
      const radiusY = shortestSide * random(0.04, 0.09);
      let x;
      let y;

      if (i === 0 && foods.length >= 2 && attempt < 28) {
        const first = foods[0];
        const second = foods[1];
        const progress = random(0.36, 0.64);
        const dx = second.x - first.x;
        const dy = second.y - first.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const offset = random(-shortestSide * 0.07, shortestSide * 0.07);
        x = lerp(first.x, second.x, progress) - (dy / distance) * offset;
        y = lerp(first.y, second.y, progress) + (dx / distance) * offset;
      } else {
        x = random(radiusX + 8, gridWidth - radiusX - 8);
        y = random(radiusY + 8, gridHeight - radiusY - 8);
      }

      candidate = {
        id: i + 1,
        x,
        y,
        radiusX,
        radiusY,
        rotation: random(TWO_PI),
        edgePhase: random(TWO_PI),
        isPlaced: true,
      };

      const insideBounds = (
        x - radiusX > 5
        && x + radiusX < gridWidth - 5
        && y - radiusY > 5
        && y + radiusY < gridHeight - 5
      );
      const clearOfFoods = foods.every(
        (food) => Math.hypot(food.x - x, food.y - y) > Math.max(radiusX, radiusY) + food.radius * 2.2,
      );
      const clearOfObstacles = obstacles.every((obstacle) => (
        Math.hypot(obstacle.x - x, obstacle.y - y)
        > Math.max(obstacle.radiusX, obstacle.radiusY) + Math.max(radiusX, radiusY) + shortestSide * 0.035
      ));

      if (insideBounds && clearOfFoods && clearOfObstacles) {
        break;
      }
      candidate = null;
    }

    if (candidate) {
      obstacles.push(candidate);
    }
  }

  buildObstacleMask();
}

function buildObstacleMask() {
  obstacleMask.fill(0);

  for (const obstacle of obstacles) {
    if (!obstacle.isPlaced) {
      continue;
    }

    const extent = Math.ceil(Math.max(obstacle.radiusX, obstacle.radiusY) * 1.2);
    for (let y = Math.floor(obstacle.y - extent); y <= Math.ceil(obstacle.y + extent); y += 1) {
      for (let x = Math.floor(obstacle.x - extent); x <= Math.ceil(obstacle.x + extent); x += 1) {
        if (isInsideGrid(x, y) && isPointInsideObstacle(x, y, obstacle)) {
          obstacleMask[y * gridWidth + x] = 1;
        }
      }
    }
  }
}

function reconcileOrganismWithObstacles() {
  const retainedParticles = [];
  const displacedParticles = [];
  occupancy.fill(0);

  for (const particle of particles) {
    const index = particle.y * gridWidth + particle.x;
    if (obstacleMask[index] !== 0) {
      displacedParticles.push({
        particle,
        trail: trailField[index],
        tube: tubeField[index],
      });
      continue;
    }

    if (occupancy[index] === 0) {
      occupancy[index] = 1;
      retainedParticles.push(particle);
    }
  }

  for (let index = 0; index < obstacleMask.length; index += 1) {
    if (obstacleMask[index] === 0) {
      continue;
    }

    occupancy[index] = 0;
    trailField[index] = 0;
    nextTrailField[index] = 0;
    tubeField[index] = 0;
    nextTubeField[index] = 0;
  }

  const maxSearchRadius = Math.ceil(Math.min(gridWidth, gridHeight) * 0.38);
  for (const displaced of displacedParticles) {
    const particle = displaced.particle;
    const target = findNearestFreeCell(particle.x, particle.y, maxSearchRadius);
    if (!target) {
      continue;
    }

    const escapeHeading = Math.atan2(target.y - particle.y, target.x - particle.x);
    particle.x = target.x;
    particle.y = target.y;
    particle.heading = normalizeAngle(escapeHeading + randomSigned(0.3));

    const targetIndex = target.y * gridWidth + target.x;
    occupancy[targetIndex] = 1;
    trailField[targetIndex] = Math.max(trailField[targetIndex], displaced.trail * 0.72, 0.38);
    nextTrailField[targetIndex] = Math.max(nextTrailField[targetIndex], trailField[targetIndex]);
    tubeField[targetIndex] = Math.max(tubeField[targetIndex], displaced.tube * 0.68);
    nextTubeField[targetIndex] = Math.max(nextTubeField[targetIndex], tubeField[targetIndex]);
    retainedParticles.push(particle);
  }

  particles = retainedParticles;
}

function findNearestFreeCell(x, y, maxRadius) {
  const phase = pixelHash(Math.round(x), Math.round(y), generationSeed) * TWO_PI;

  for (let radius = 1; radius <= maxRadius; radius += 1) {
    const sampleCount = Math.max(8, Math.ceil(TWO_PI * radius * 1.3));
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const angle = phase + (TWO_PI * sample) / sampleCount;
      const candidateX = Math.round(x + Math.cos(angle) * radius);
      const candidateY = Math.round(y + Math.sin(angle) * radius);
      if (!isInsideGrid(candidateX, candidateY)) {
        continue;
      }

      const index = candidateY * gridWidth + candidateX;
      if (obstacleMask[index] === 0 && occupancy[index] === 0) {
        return { x: candidateX, y: candidateY };
      }
    }
  }

  return null;
}

function isPointInsideObstacle(x, y, obstacle, padding = 0) {
  if (obstacle.contour && obstacle.contour.length >= 3) {
    if (window.MojihokoriTracking.isPointInPolygon(x, y, obstacle.contour)) {
      return true;
    }
    if (padding <= 0) {
      return false;
    }
    for (let index = 0; index < obstacle.contour.length; index += 1) {
      const start = obstacle.contour[index];
      const end = obstacle.contour[(index + 1) % obstacle.contour.length];
      if (distanceToSegment(x, y, start[0], start[1], end[0], end[1]) <= padding) {
        return true;
      }
    }
    return false;
  }

  const dx = x - obstacle.x;
  const dy = y - obstacle.y;
  const cosRotation = Math.cos(obstacle.rotation);
  const sinRotation = Math.sin(obstacle.rotation);
  const localX = dx * cosRotation + dy * sinRotation;
  const localY = -dx * sinRotation + dy * cosRotation;
  const radiusX = obstacle.radiusX + padding;
  const radiusY = obstacle.radiusY + padding;
  const normalizedX = localX / radiusX;
  const normalizedY = localY / radiusY;
  const angle = Math.atan2(normalizedY, normalizedX);
  const distance = Math.hypot(normalizedX, normalizedY);

  return distance <= getObstacleEdgeScale(angle, obstacle);
}

function distanceToSegment(x, y, x1, y1, x2, y2) {
  const segmentX = x2 - x1;
  const segmentY = y2 - y1;
  const lengthSquared = segmentX * segmentX + segmentY * segmentY;
  if (lengthSquared === 0) {
    return Math.hypot(x - x1, y - y1);
  }
  const progress = clamp(
    ((x - x1) * segmentX + (y - y1) * segmentY) / lengthSquared,
    0,
    1,
  );
  return Math.hypot(x - (x1 + segmentX * progress), y - (y1 + segmentY * progress));
}

function getObstacleEdgeScale(angle, obstacle) {
  return 1
    + Math.sin(angle * 3 + obstacle.edgePhase) * 0.105
    + Math.sin(angle * 5 - obstacle.edgePhase * 1.7) * 0.055
    + Math.sin(angle * 8 + obstacle.edgePhase * 0.6) * 0.025;
}

function isObstacleCell(x, y) {
  return isInsideGrid(x, y) && obstacleMask[y * gridWidth + x] !== 0;
}

function initializeOrganism() {
  const shortestSide = Math.min(gridWidth, gridHeight);
  const origin = chooseOrganismOrigin(shortestSide);
  const radiusX = shortestSide * random(0.2, 0.25);
  const radiusY = shortestSide * random(0.12, 0.16);
  const rotation = random(TWO_PI);
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);
  let attempts = 0;

  while (particles.length < baseParticleTarget && attempts < baseParticleTarget * 35) {
    attempts += 1;
    const angle = random(TWO_PI);
    const distance = Math.sqrt(random());
    const localX = Math.cos(angle) * radiusX * distance;
    const localY = Math.sin(angle) * radiusY * distance;
    const x = Math.round(origin.x + localX * cosRotation - localY * sinRotation);
    const y = Math.round(origin.y + localX * sinRotation + localY * cosRotation);

    if (!isInsideGrid(x, y)) {
      continue;
    }

    const contour = noise(x * 0.055, y * 0.055, generationSeed * 0.00001);
    if (distance > 0.78 + contour * 0.28) {
      continue;
    }

    const index = y * gridWidth + x;
    if (occupancy[index] !== 0 || obstacleMask[index] !== 0) {
      continue;
    }

    const food = getNearestFood(x, y);
    const foodHeading = food ? Math.atan2(food.y - y, food.x - x) : random(TWO_PI);
    if (!addParticle(x, y, foodHeading + random(-Math.PI * 0.85, Math.PI * 0.85))) {
      continue;
    }
    trailField[index] = Math.max(trailField[index], random(0.75, 1.2));
    tubeField[index] = Math.max(tubeField[index], random(0.08, 0.22));
  }
}

function chooseOrganismOrigin(shortestSide) {
  const marginX = gridWidth * 0.2;
  const marginY = gridHeight * 0.22;
  let best = { x: gridWidth * 0.5, y: gridHeight * 0.5 };
  let bestDistance = -1;

  for (let attempt = 0; attempt < 48; attempt += 1) {
    const candidate = {
      x: random(marginX, gridWidth - marginX),
      y: random(marginY, gridHeight - marginY),
    };
    if (obstacles.some((obstacle) => (
      isPointInsideObstacle(candidate.x, candidate.y, obstacle, shortestSide * 0.16)
    ))) {
      continue;
    }

    const nearestDistance = foods.length > 0
      ? Math.min(...foods.map((food) => Math.hypot(food.x - candidate.x, food.y - candidate.y)))
      : shortestSide * 0.3;

    if (nearestDistance > bestDistance) {
      best = candidate;
      bestDistance = nearestDistance;
    }
    if (nearestDistance >= shortestSide * 0.3) {
      break;
    }
  }

  return best;
}

function addParticle(x, y, heading) {
  const cellX = Math.round(x);
  const cellY = Math.round(y);
  if (!isInsideGrid(cellX, cellY)) {
    return false;
  }

  const index = cellY * gridWidth + cellX;
  if (occupancy[index] !== 0 || obstacleMask[index] !== 0) {
    return false;
  }

  occupancy[index] = 1;
  particles.push({ x: cellX, y: cellY, heading });
  return true;
}

function simulateStep() {
  simulationFrame += 1;
  const hasFood = foods.some((food) => food.isPlaced);
  const dormancyTarget = hasFood ? 0 : 1;
  const dormancyRate = hasFood ? 0.00022 : 0.00006;
  dormancyLevel += (dormancyTarget - dormancyLevel) * dormancyRate;
  const activity = 1 - dormancyLevel * 0.95;
  if (Math.random() < activity) {
    moveParticles();
  }

  if (simulationFrame % DIFFUSION_INTERVAL === 0) {
    diffuseFields(DIFFUSION_INTERVAL);
  }
  if (simulationFrame % FOOD_UPDATE_INTERVAL === 0) {
    updateFoods(FOOD_UPDATE_INTERVAL);
  }
  if (simulationFrame % REMODELING_INTERVAL === 0) {
    remodelPopulation();
  }
}

function moveParticles() {
  if (particles.length === 0) {
    return;
  }

  const startOffset = Math.floor(Math.random() * particles.length);

  for (let offset = 0; offset < particles.length; offset += 1) {
    const particle = particles[(startOffset + offset) % particles.length];
    steerParticle(particle);

    const currentX = particle.x;
    const currentY = particle.y;
    const currentIndex = currentY * gridWidth + currentX;
    const nextX = Math.round(currentX + Math.cos(particle.heading));
    const nextY = Math.round(currentY + Math.sin(particle.heading));

    if (!isInsideGrid(nextX, nextY) || isObstacleCell(nextX, nextY)) {
      particle.heading = normalizeAngle(particle.heading + Math.PI + randomSigned(0.55));
      continue;
    }

    const nextIndex = nextY * gridWidth + nextX;
    if (nextIndex === currentIndex || occupancy[nextIndex] !== 0) {
      particle.heading = normalizeAngle(particle.heading + randomSigned(Math.PI * 0.9));
      continue;
    }

    occupancy[currentIndex] = 0;
    occupancy[nextIndex] = 1;
    particle.x = nextX;
    particle.y = nextY;

    trailField[nextIndex] = Math.min(4.5, trailField[nextIndex] + TRAIL_DEPOSIT);
    tubeField[nextIndex] = Math.min(1.4, tubeField[nextIndex] + TUBE_REINFORCEMENT);
  }
}

function steerParticle(particle) {
  const forward = sampleGuidance(
    particle.x + Math.cos(particle.heading) * SENSOR_OFFSET,
    particle.y + Math.sin(particle.heading) * SENSOR_OFFSET,
  );
  const leftHeading = particle.heading - SENSOR_ANGLE;
  const rightHeading = particle.heading + SENSOR_ANGLE;
  const left = sampleGuidance(
    particle.x + Math.cos(leftHeading) * SENSOR_OFFSET,
    particle.y + Math.sin(leftHeading) * SENSOR_OFFSET,
  );
  const right = sampleGuidance(
    particle.x + Math.cos(rightHeading) * SENSOR_OFFSET,
    particle.y + Math.sin(rightHeading) * SENSOR_OFFSET,
  );

  if (forward >= left && forward >= right) {
    particle.heading += randomSigned(0.025);
  } else if (forward < left && forward < right) {
    particle.heading += (Math.random() < 0.5 ? -1 : 1) * TURN_ANGLE;
  } else if (left > right) {
    particle.heading -= TURN_ANGLE * randomRange(0.72, 1.2);
  } else {
    particle.heading += TURN_ANGLE * randomRange(0.72, 1.2);
  }

  if (Math.random() < 0.012) {
    particle.heading += randomSigned(0.5);
  }
  particle.heading = normalizeAngle(particle.heading);
}

function sampleGuidance(x, y) {
  const cellX = Math.round(x);
  const cellY = Math.round(y);
  if (!isInsideGrid(cellX, cellY) || isObstacleCell(cellX, cellY)) {
    return -100;
  }

  const index = cellY * gridWidth + cellX;
  const selfTrail = trailField[index] * 0.9 + tubeField[index] * 0.72;
  const foodTrail = getFoodSignal(cellX, cellY);
  const time = simulationFrame * 0.0018;
  const exploration = (
    Math.sin(cellX * 0.071 + cellY * 0.019 + time)
    + Math.sin(cellY * 0.057 - cellX * 0.014 - time * 0.73)
  ) * 0.055;

  return selfTrail + foodTrail + exploration;
}

function getFoodSignal(x, y) {
  const shortestSide = Math.min(gridWidth, gridHeight);
  let signal = 0;

  for (const food of foods) {
    if (!food.isPlaced) {
      continue;
    }

    const distance = Math.hypot(food.x - x, food.y - y);
    const range = shortestSide * (0.54 + food.nutrition * 0.08);
    const gradient = clamp(1 - distance / range, 0, 1);
    const pulse = 0.94 + Math.sin(simulationFrame * 0.006 + food.pulsePhase) * 0.06;
    const attraction = (
      (0.14 + food.nutrition * 0.86)
      * (1 - food.engulfment * 0.74)
      * (1 + food.activation * 0.75)
    );
    signal += gradient * gradient * 4.6 * attraction * pulse;
  }

  return signal;
}

function diffuseFields(elapsedSteps) {
  const trailDecay = Math.pow(0.985, elapsedSteps);
  const tubeDecay = Math.pow(0.9985, elapsedSteps);

  for (let y = 0; y < gridHeight; y += 1) {
    const row = y * gridWidth;
    const upRow = (y > 0 ? y - 1 : y) * gridWidth;
    const downRow = (y < gridHeight - 1 ? y + 1 : y) * gridWidth;

    for (let x = 0; x < gridWidth; x += 1) {
      const index = row + x;
      if (obstacleMask[index] !== 0) {
        nextTrailField[index] = 0;
        nextTubeField[index] = 0;
        continue;
      }

      const left = row + (x > 0 ? x - 1 : x);
      const right = row + (x < gridWidth - 1 ? x + 1 : x);
      const up = upRow + x;
      const down = downRow + x;

      const trailNeighbors = (
        trailField[left] + trailField[right] + trailField[up] + trailField[down]
      ) * 0.25;
      const tubeNeighbors = (
        tubeField[left] + tubeField[right] + tubeField[up] + tubeField[down]
      ) * 0.25;

      nextTrailField[index] = (
        trailField[index] * 0.64 + trailNeighbors * 0.36
      ) * trailDecay;
      nextTubeField[index] = (
        tubeField[index] * 0.97 + tubeNeighbors * 0.03
      ) * tubeDecay;
    }
  }

  [trailField, nextTrailField] = [nextTrailField, trailField];
  [tubeField, nextTubeField] = [nextTubeField, tubeField];
}

function updateFoods(elapsedSteps) {
  for (const food of foods) {
    if (!food.isPlaced) {
      continue;
    }

    const coverage = measureFoodCoverage(food);
    food.engulfment += (coverage - food.engulfment) * 0.17;
    food.activation = Math.max(0, food.activation - 0.0025 * elapsedSteps);

    if (coverage > 0.06 && food.nutrition > 0.035) {
      food.nutrition = Math.max(0.03, food.nutrition - coverage * 0.00075 * elapsedSteps);
      food.recovery = 0;
    } else if (food.nutrition <= 0.05) {
      food.recovery += elapsedSteps;
      if (food.recovery > TARGET_FPS * 16) {
        food.nutrition = Math.min(1, food.nutrition + 0.00065 * elapsedSteps);
      }
    } else if (coverage < 0.025) {
      food.nutrition = Math.min(1, food.nutrition + 0.00008 * elapsedSteps);
    }
  }
}

function measureFoodCoverage(food) {
  const radius = Math.ceil(food.radius * 1.35);
  let occupied = 0;
  let sampled = 0;

  for (let y = Math.floor(food.y - radius); y <= Math.ceil(food.y + radius); y += 1) {
    for (let x = Math.floor(food.x - radius); x <= Math.ceil(food.x + radius); x += 1) {
      if (!isInsideGrid(x, y) || Math.hypot(food.x - x, food.y - y) > radius) {
        continue;
      }
      sampled += 1;
      occupied += occupancy[y * gridWidth + x];
    }
  }

  return sampled > 0 ? clamp((occupied / sampled) * 3.2, 0, 1) : 0;
}

function remodelPopulation() {
  if (particles.length < 2) {
    return;
  }

  const placedFoods = foods.filter((food) => food.isPlaced);
  const averageNutrition = placedFoods.length > 0
    ? placedFoods.reduce((sum, food) => sum + food.nutrition, 0) / placedFoods.length
    : 0;
  const desiredFactor = placedFoods.length > 0
    ? 0.68 + averageNutrition * 0.28
    : lerp(0.68, 0.38, dormancyLevel);
  const desiredCount = Math.round(baseParticleTarget * desiredFactor);
  const adjustment = clamp(Math.ceil(Math.abs(desiredCount - particles.length) * 0.03), 0, 12);

  if (particles.length < desiredCount) {
    for (let i = 0; i < adjustment; i += 1) {
      growAtProductiveEdge();
    }
  } else if (particles.length > desiredCount) {
    for (let i = 0; i < adjustment; i += 1) {
      removeWeakParticle();
    }
  }

  const remodelingCount = Math.max(1, Math.floor(particles.length * 0.0012));
  for (let i = 0; i < remodelingCount; i += 1) {
    if (removeWeakParticle()) {
      growAtProductiveEdge();
    }
  }
}

function growAtProductiveEdge() {
  let source = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let sample = 0; sample < 28; sample += 1) {
    const candidate = particles[Math.floor(Math.random() * particles.length)];
    const density = countOccupiedNeighbors(candidate.x, candidate.y, 2);
    if (density > 18) {
      continue;
    }

    const index = candidate.y * gridWidth + candidate.x;
    const score = (
      getFoodSignal(candidate.x, candidate.y) * 0.42
      + tubeField[index] * 0.36
      + (18 - density) * 0.045
      + Math.random() * 0.28
    );
    if (score > bestScore) {
      bestScore = score;
      source = candidate;
    }
  }

  if (!source) {
    return false;
  }

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const angle = source.heading + randomSigned(1.35);
    const distance = randomRange(1, 2.8);
    const x = Math.round(source.x + Math.cos(angle) * distance);
    const y = Math.round(source.y + Math.sin(angle) * distance);
    if (addParticle(x, y, source.heading + randomSigned(0.45))) {
      const index = y * gridWidth + x;
      trailField[index] = Math.max(trailField[index], 0.5);
      tubeField[index] = Math.max(tubeField[index], 0.04);
      return true;
    }
  }

  return false;
}

function removeWeakParticle() {
  const minimumRatio = lerp(0.72, 0.34, dormancyLevel);
  if (particles.length <= Math.max(300, baseParticleTarget * minimumRatio)) {
    return false;
  }

  let weakestIndex = -1;
  let weakestScore = Number.POSITIVE_INFINITY;

  for (let sample = 0; sample < 30; sample += 1) {
    const particleIndex = Math.floor(Math.random() * particles.length);
    const particle = particles[particleIndex];
    const index = particle.y * gridWidth + particle.x;
    const density = countOccupiedNeighbors(particle.x, particle.y, 2);
    const score = (
      tubeField[index] * 1.25
      + trailField[index] * 0.09
      + getFoodSignal(particle.x, particle.y) * 0.08
      - Math.max(0, density - 15) * 0.025
      + Math.random() * 0.08
    );

    if (score < weakestScore) {
      weakestScore = score;
      weakestIndex = particleIndex;
    }
  }

  if (weakestIndex < 0) {
    return false;
  }

  const removed = particles[weakestIndex];
  occupancy[removed.y * gridWidth + removed.x] = 0;
  const last = particles.pop();
  if (weakestIndex < particles.length) {
    particles[weakestIndex] = last;
  }
  return true;
}

function countOccupiedNeighbors(x, y, radius) {
  let count = 0;

  for (let offsetY = -radius; offsetY <= radius; offsetY += 1) {
    for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) {
        continue;
      }

      const neighborX = x + offsetX;
      const neighborY = y + offsetY;
      if (isInsideGrid(neighborX, neighborY)) {
        count += occupancy[neighborY * gridWidth + neighborX];
      }
    }
  }

  return count;
}

function renderSimulation() {
  renderEnvironment();
  cellImage.loadPixels();
  cellImage.pixels.fill(0);

  const globalPulse = 1 + Math.sin(simulationFrame * 0.025) * 0.045;
  for (let index = 0; index < trailField.length; index += 1) {
    const material = (
      trailField[index] * 0.09
      + tubeField[index] * 0.6
      + occupancy[index] * 0.42
    );
    if (material < 0.018) {
      continue;
    }

    const x = index % gridWidth;
    const y = Math.floor(index / gridWidth);
    const localPulse = 1 + Math.sin(
      simulationFrame * 0.038 + x * 0.14 - y * 0.09,
    ) * 0.055;
    const brightness = clamp(
      (1 - Math.exp(-material * 0.78))
      * 1.25
      * globalPulse
      * localPulse
      * (1 - dormancyLevel * 0.48),
      0,
      1,
    );
    const paletteIndex = Math.max(1, Math.floor(brightness * (PALETTE_STEPS - 1)));
    const color = palette[paletteIndex];
    const pixelIndex = index * 4;

    cellImage.pixels[pixelIndex] = color[0];
    cellImage.pixels[pixelIndex + 1] = color[1];
    cellImage.pixels[pixelIndex + 2] = color[2];
    cellImage.pixels[pixelIndex + 3] = 255;
  }

  cellImage.updatePixels();
  image(cellImage, 0, 0, width, height);
  if (!IS_EXHIBIT_MODE) {
    renderObstacles();
    renderFoods();
  }
}

function renderEnvironment() {
  const environment = ENVIRONMENTS[environmentIndex];
  background(...environment.base);

  if (!environmentImage) {
    return;
  }

  if (previousEnvironmentImage && environmentTransition < 1) {
    image(previousEnvironmentImage, 0, 0, width, height);
    const easedTransition = environmentTransition * environmentTransition * (3 - 2 * environmentTransition);
    push();
    tint(255, Math.round(easedTransition * 255));
    image(environmentImage, 0, 0, width, height);
    pop();

    environmentTransition = Math.min(1, environmentTransition + 0.055);
    if (environmentTransition >= 1) {
      previousEnvironmentImage = null;
    }
    return;
  }

  image(environmentImage, 0, 0, width, height);
}

function renderObstacles() {
  const scaleX = width / gridWidth;
  const scaleY = height / gridHeight;
  const environment = ENVIRONMENTS[environmentIndex];

  push();
  noSmooth();
  textAlign(CENTER, CENTER);
  textSize(10);

  for (const obstacle of obstacles) {
    const isPreview = !obstacle.isPlaced;
    drawingContext.setLineDash(isPreview ? [5, 4] : []);
    fill(...environment.obstacle, isPreview ? 82 : 248);
    stroke(...environment.obstacleEdge, isPreview ? 225 : 205);
    strokeWeight(isPreview ? 1.7 : 1.25);
    beginShape();

    if (obstacle.contour && obstacle.contour.length >= 3) {
      for (const point of obstacle.contour) {
        vertex(point[0] * scaleX, point[1] * scaleY);
      }
    } else {
      for (let step = 0; step < 48; step += 1) {
        const angle = (TWO_PI * step) / 48;
        const edgeScale = getObstacleEdgeScale(angle, obstacle);
        const localX = Math.cos(angle) * obstacle.radiusX * edgeScale;
        const localY = Math.sin(angle) * obstacle.radiusY * edgeScale;
        const cosRotation = Math.cos(obstacle.rotation);
        const sinRotation = Math.sin(obstacle.rotation);
        const x = obstacle.x + localX * cosRotation - localY * sinRotation;
        const y = obstacle.y + localX * sinRotation + localY * cosRotation;
        vertex(x * scaleX, y * scaleY);
      }
    }

    endShape(CLOSE);

    noFill();
    drawingContext.setLineDash([]);
    stroke(...environment.obstacleEdge, isPreview ? 110 : 55);
    circle(
      obstacle.x * scaleX,
      obstacle.y * scaleY,
      Math.min(obstacle.radiusX * scaleX, obstacle.radiusY * scaleY) * 1.15,
    );
    noStroke();
    fill(...environment.obstacleText, isPreview ? 230 : 175);
    text(isPreview ? "離して配置" : "障害物", obstacle.x * scaleX, obstacle.y * scaleY);
  }

  drawingContext.setLineDash([]);
  pop();
}

function renderFoods() {
  const scaleX = width / gridWidth;
  const scaleY = height / gridHeight;

  push();
  noSmooth();
  textAlign(CENTER, BOTTOM);
  textSize(11);

  for (const food of foods) {
    const x = food.x * scaleX;
    const y = food.y * scaleY;
    const isDragging = draggedFood === food;
    const pulse = 1 + Math.sin(simulationFrame * 0.045 + food.pulsePhase) * 0.1;
    const markerRadius = food.radius * Math.min(scaleX, scaleY) * pulse;
    const nourishment = 0.55 + food.nutrition * 0.45;

    if (!food.isPlaced) {
      noFill();
      stroke(...COLORS.food, 105);
      strokeWeight(1.5);
      circle(x, y, markerRadius * 2.7);
      line(x - markerRadius * 0.45, y, x + markerRadius * 0.45, y);
      line(x, y - markerRadius * 0.45, x, y + markerRadius * 0.45);
      noStroke();
      fill(...COLORS.food, 180);
      text("離して配置", x, y - markerRadius * 1.65);
      continue;
    }

    noFill();
    stroke(...COLORS.food, isDragging ? 155 : 62);
    strokeWeight(isDragging ? 2 : 1);
    circle(x, y, markerRadius * 3.1);

    noStroke();
    fill(...COLORS.food, 40 + food.nutrition * 85);
    circle(x, y, markerRadius * 2.7);
    fill(...COLORS.food, isDragging ? 255 : 225);
    circle(x, y, markerRadius * 1.8 * nourishment);
    fill(...COLORS.foodCore, 255);
    circle(x, y, Math.max(3, markerRadius * 0.55));

    fill(...COLORS.food, 235);
    text("餌", x, y - markerRadius * 1.7);
  }

  pop();
}

function getNearestFood(x, y) {
  if (foods.length === 0) {
    return null;
  }
  let nearest = foods[0];
  let nearestDistance = squaredDistance(x, y, nearest.x, nearest.y);

  for (let i = 1; i < foods.length; i += 1) {
    const food = foods[i];
    const distance = squaredDistance(x, y, food.x, food.y);
    if (distance < nearestDistance) {
      nearest = food;
      nearestDistance = distance;
    }
  }

  return nearest;
}

function squaredDistance(x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return dx * dx + dy * dy;
}

function isInsideGrid(x, y) {
  return x >= 0 && y >= 0 && x < gridWidth && y < gridHeight;
}

function buildPalette() {
  const colors = [];
  const background = ENVIRONMENTS[environmentIndex].base;

  for (let i = 0; i < PALETTE_STEPS; i += 1) {
    const amount = i / (PALETTE_STEPS - 1);
    let color;

    if (amount < 0.34) {
      color = mixColor(background, COLORS.edge, amount / 0.34);
    } else if (amount < 0.78) {
      color = mixColor(COLORS.edge, COLORS.body, (amount - 0.34) / 0.44);
    } else {
      color = mixColor(COLORS.body, COLORS.core, (amount - 0.78) / 0.22);
    }

    colors.push(color);
  }

  return colors;
}

function mixColor(from, to, amount) {
  return [
    Math.round(lerp(from[0], to[0], amount)),
    Math.round(lerp(from[1], to[1], amount)),
    Math.round(lerp(from[2], to[2], amount)),
  ];
}

function randomRange(minimum, maximum) {
  return minimum + Math.random() * (maximum - minimum);
}

function randomSigned(amount) {
  return (Math.random() * 2 - 1) * amount;
}

function normalizeAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function beginInteraction(canvasX, canvasY) {
  if (TRACKING_INPUT_ENABLED) {
    return true;
  }
  if (canvasX < 0 || canvasY < 0 || canvasX >= width || canvasY >= height) {
    return true;
  }

  const gridX = (canvasX / width) * gridWidth;
  const gridY = (canvasY / height) * gridHeight;
  draggedFood = findFoodAt(gridX, gridY);
  didDragFood = false;
  dragSnapshot = null;
  draggedObstacle = null;
  didDragObstacle = false;
  obstacleDragSnapshot = null;

  if (draggedFood) {
    dragSnapshot = {
      x: draggedFood.x,
      y: draggedFood.y,
      nutrition: draggedFood.nutrition,
      engulfment: draggedFood.engulfment,
      activation: draggedFood.activation,
      recovery: draggedFood.recovery,
    };
    draggedFood.isPlaced = false;
    draggedFood.activation = 0;
  } else {
    draggedObstacle = findObstacleAt(gridX, gridY);
    if (!draggedObstacle) {
      return true;
    }

    obstacleDragSnapshot = {
      x: draggedObstacle.x,
      y: draggedObstacle.y,
    };
    draggedObstacle.isPlaced = false;
    buildObstacleMask();
  }

  if (isPaused) {
    redraw();
  }
  return false;
}

function findFoodAt(x, y) {
  for (let i = foods.length - 1; i >= 0; i -= 1) {
    const food = foods[i];
    if (food.isPlaced && Math.hypot(food.x - x, food.y - y) <= food.radius * 2.35) {
      return food;
    }
  }
  return null;
}

function findObstacleAt(x, y) {
  for (let i = obstacles.length - 1; i >= 0; i -= 1) {
    const obstacle = obstacles[i];
    if (obstacle.isPlaced && isPointInsideObstacle(x, y, obstacle, 1.5)) {
      return obstacle;
    }
  }
  return null;
}

function updateInteractionCursor() {
  if (IS_EXHIBIT_MODE) {
    cursor("none");
    return;
  }
  if (TRACKING_INPUT_ENABLED) {
    cursor("default");
    return;
  }
  if (draggedFood || draggedObstacle) {
    cursor("grabbing");
    return;
  }

  const gridX = (mouseX / width) * gridWidth;
  const gridY = (mouseY / height) * gridHeight;
  cursor(
    findFoodAt(gridX, gridY) || findObstacleAt(gridX, gridY)
      ? "grab"
      : "default",
  );
}

function moveDraggedInteraction(canvasX, canvasY) {
  if (!draggedFood && !draggedObstacle) {
    return true;
  }

  if (draggedFood) {
    const nextX = clamp((canvasX / width) * gridWidth, 5, gridWidth - 5);
    const nextY = clamp((canvasY / height) * gridHeight, 5, gridHeight - 5);
    if (Math.hypot(nextX - draggedFood.x, nextY - draggedFood.y) > 0.03) {
      draggedFood.x = nextX;
      draggedFood.y = nextY;
      didDragFood = true;
    }
  } else {
    const cosRotation = Math.abs(Math.cos(draggedObstacle.rotation));
    const sinRotation = Math.abs(Math.sin(draggedObstacle.rotation));
    const extentX = (
      draggedObstacle.radiusX * cosRotation
      + draggedObstacle.radiusY * sinRotation
    ) * 1.2;
    const extentY = (
      draggedObstacle.radiusX * sinRotation
      + draggedObstacle.radiusY * cosRotation
    ) * 1.2;
    const nextX = clamp((canvasX / width) * gridWidth, extentX + 1, gridWidth - extentX - 1);
    const nextY = clamp((canvasY / height) * gridHeight, extentY + 1, gridHeight - extentY - 1);

    if (Math.hypot(nextX - draggedObstacle.x, nextY - draggedObstacle.y) > 0.03) {
      draggedObstacle.x = nextX;
      draggedObstacle.y = nextY;
      didDragObstacle = true;
    }
  }

  if (isPaused) {
    redraw();
  }
  return false;
}

function endInteraction() {
  if (!draggedFood && !draggedObstacle) {
    return true;
  }

  if (draggedFood) {
    if (didDragFood) {
      draggedFood.isPlaced = true;
      draggedFood.nutrition = 1;
      draggedFood.engulfment = 0;
      draggedFood.activation = 1;
      draggedFood.recovery = 0;
    } else if (dragSnapshot) {
      Object.assign(draggedFood, dragSnapshot, { isPlaced: true });
    } else {
      draggedFood.isPlaced = true;
    }
    draggedFood = null;
    didDragFood = false;
    dragSnapshot = null;
  } else {
    if (!didDragObstacle && obstacleDragSnapshot) {
      Object.assign(draggedObstacle, obstacleDragSnapshot);
    }
    draggedObstacle.isPlaced = true;
    buildObstacleMask();
    reconcileOrganismWithObstacles();
    draggedObstacle = null;
    didDragObstacle = false;
    obstacleDragSnapshot = null;
  }

  if (isPaused) {
    redraw();
  }
  return false;
}

function mousePressed() {
  return beginInteraction(mouseX, mouseY);
}

function mouseDragged() {
  return moveDraggedInteraction(mouseX, mouseY);
}

function mouseReleased() {
  return endInteraction();
}

function touchStarted() {
  return beginInteraction(mouseX, mouseY);
}

function touchMoved() {
  return moveDraggedInteraction(mouseX, mouseY);
}

function touchEnded() {
  return endInteraction();
}

function keyPressed() {
  if (!isExperienceStarted) {
    return true;
  }

  if (key === "r" || key === "R") {
    regenerate();
    return false;
  }

  if (key === "s" || key === "S") {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    saveCanvas(`mojihokori-${timestamp}`, "png");
    return false;
  }

  if (key === " " || keyCode === 32) {
    isPaused = !isPaused;
    if (isPaused) {
      noLoop();
    } else {
      loop();
    }
    return false;
  }

  return true;
}

function windowResized() {
  const size = getFittedCanvasSize();
  resizeCanvas(size.width, size.height, true);
  noSmooth();

  if (!cellImage) {
    regenerate();
  } else {
    renderSimulation();
    updateInteractionCursor();
  }
}

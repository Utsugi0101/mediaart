// Physarum-inspired particle, chemotaxis, and flow-reinforcement simulation.
const FIELD_PIXEL_SIZE = 4;
const MAX_GRID_WIDTH = 480;
const MAX_GRID_HEIGHT = 270;
const TARGET_FPS = 30;
const INITIAL_FOOD_COUNT = 2;
const PALETTE_STEPS = 48;

const SENSOR_OFFSET = 6;
const SENSOR_ANGLE = Math.PI / 4;
const TURN_ANGLE = Math.PI / 4.8;
const TRAIL_DEPOSIT = 0.4;
const TUBE_REINFORCEMENT = 0.005;
const DIFFUSION_INTERVAL = 3;
const REMODELING_INTERVAL = 12;
const FOOD_UPDATE_INTERVAL = 6;

const COLORS = {
  background: [1, 4, 9],
  edge: [19, 45, 66],
  body: [93, 147, 181],
  core: [239, 248, 255],
  food: [255, 188, 82],
  foodCore: [255, 246, 204],
};

let gridWidth;
let gridHeight;
let cellImage;
let trailField;
let nextTrailField;
let tubeField;
let nextTubeField;
let occupancy;
let particles;
let foods;
let palette;
let baseParticleTarget;
let simulationFrame = 0;
let speedAccumulator = 0;
let growthSpeedMultiplier = 1;
let generationSeed = 0;
let isPaused = false;
let draggedFood = null;
let didDragFood = false;
let nextFoodId = 1;

function setup() {
  pixelDensity(1);

  const size = getFittedCanvasSize();
  const canvas = createCanvas(size.width, size.height);
  canvas.parent("artwork");

  noSmooth();
  frameRate(TARGET_FPS);
  setupSpeedControls();
  regenerate();
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

function draw() {
  if (!isPaused) {
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
  nextFoodId = 1;

  initializeGrid();
  initializeFoods();
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
  particles = [];
  foods = [];
  baseParticleTarget = clamp(Math.floor(cellCount * 0.028), 1500, 4200);

  cellImage = createImage(gridWidth, gridHeight);
  palette = buildPalette();
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

function createFood(x, y) {
  const shortestSide = Math.min(gridWidth, gridHeight);

  return {
    id: nextFoodId++,
    x: clamp(x, 5, gridWidth - 5),
    y: clamp(y, 5, gridHeight - 5),
    radius: Math.max(5, shortestSide * 0.025),
    nutrition: 1,
    engulfment: 0,
    activation: 0,
    recovery: 0,
    pulsePhase: random(TWO_PI),
  };
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
    if (occupancy[index] !== 0) {
      continue;
    }

    const food = getNearestFood(x, y);
    const foodHeading = Math.atan2(food.y - y, food.x - x);
    addParticle(x, y, foodHeading + random(-Math.PI * 0.85, Math.PI * 0.85));
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
    const nearestDistance = Math.min(
      ...foods.map((food) => Math.hypot(food.x - candidate.x, food.y - candidate.y)),
    );

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
  if (occupancy[index] !== 0) {
    return false;
  }

  occupancy[index] = 1;
  particles.push({ x: cellX, y: cellY, heading });
  return true;
}

function simulateStep() {
  simulationFrame += 1;
  moveParticles();

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

    if (!isInsideGrid(nextX, nextY)) {
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
  if (!isInsideGrid(cellX, cellY)) {
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

  const averageNutrition = foods.reduce((sum, food) => sum + food.nutrition, 0) / foods.length;
  const desiredCount = Math.round(baseParticleTarget * (0.68 + averageNutrition * 0.28));
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
  if (particles.length <= Math.max(300, baseParticleTarget * 0.72)) {
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
  background(...COLORS.background);
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
      (1 - Math.exp(-material * 0.78)) * 1.25 * globalPulse * localPulse,
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
  renderFoods();
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

  for (let i = 0; i < PALETTE_STEPS; i += 1) {
    const amount = i / (PALETTE_STEPS - 1);
    let color;

    if (amount < 0.34) {
      color = mixColor(COLORS.background, COLORS.edge, amount / 0.34);
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

function beginFoodInteraction(canvasX, canvasY) {
  if (canvasX < 0 || canvasY < 0 || canvasX >= width || canvasY >= height) {
    return true;
  }

  const gridX = (canvasX / width) * gridWidth;
  const gridY = (canvasY / height) * gridHeight;
  draggedFood = findFoodAt(gridX, gridY);
  didDragFood = false;
  if (!draggedFood) {
    return true;
  }

  if (isPaused) {
    redraw();
  }
  return false;
}

function findFoodAt(x, y) {
  for (let i = foods.length - 1; i >= 0; i -= 1) {
    const food = foods[i];
    if (Math.hypot(food.x - x, food.y - y) <= food.radius * 2.35) {
      return food;
    }
  }
  return null;
}

function updateInteractionCursor() {
  if (draggedFood) {
    cursor("grabbing");
    return;
  }

  const gridX = (mouseX / width) * gridWidth;
  const gridY = (mouseY / height) * gridHeight;
  cursor(findFoodAt(gridX, gridY) ? "grab" : "default");
}

function moveDraggedFood(canvasX, canvasY) {
  if (!draggedFood) {
    return true;
  }

  const nextX = clamp((canvasX / width) * gridWidth, 5, gridWidth - 5);
  const nextY = clamp((canvasY / height) * gridHeight, 5, gridHeight - 5);
  if (Math.hypot(nextX - draggedFood.x, nextY - draggedFood.y) > 0.03) {
    draggedFood.x = nextX;
    draggedFood.y = nextY;
    draggedFood.nutrition = 1;
    draggedFood.engulfment = 0;
    draggedFood.activation = 1;
    draggedFood.recovery = 0;
    didDragFood = true;
  }

  if (isPaused) {
    redraw();
  }
  return false;
}

function endFoodInteraction() {
  if (!draggedFood) {
    return true;
  }

  if (didDragFood) {
    draggedFood.activation = 1;
  }
  draggedFood = null;
  didDragFood = false;

  if (isPaused) {
    redraw();
  }
  return false;
}

function mousePressed() {
  return beginFoodInteraction(mouseX, mouseY);
}

function mouseDragged() {
  return moveDraggedFood(mouseX, mouseY);
}

function mouseReleased() {
  return endFoodInteraction();
}

function touchStarted() {
  return beginFoodInteraction(mouseX, mouseY);
}

function touchMoved() {
  return moveDraggedFood(mouseX, mouseY);
}

function touchEnded() {
  return endFoodInteraction();
}

function keyPressed() {
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
  resizeCanvas(size.width, size.height);
  noSmooth();
  regenerate();
}

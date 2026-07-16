// 見た目の主な調整値
const PIXEL_SIZE = 2;
const CORE_DENSITY = 0.82;
const GROWTH_SPEED = 0.4;
const COLORS = {
  background: [1, 4, 9],
  edge: [24, 52, 76],
  body: [105, 154, 188],
  core: [239, 248, 255],
};

const TARGET_FPS = 30;
const BRANCH_COUNT = 17;
const UPDATE_INTERVAL = 8;
const BIRTH_ATTEMPTS = 150;
const TWINKLE_SPEED = 0.035;
const PULSE_SPEED = 0.012;
const STABLE_THRESHOLD = 0.5;
const PALETTE_STEPS = 32;
const VIRTUAL_FOOD_COUNT = 2;
const EXPLORER_INTERVAL = 75;
const MAX_GROWING_BRANCHES = 10;
const METABOLISM_SAMPLES = 360;

let gridWidth;
let gridHeight;
let cellImage;
let energy;
let stability;
let phase;
let lifetime;
let known;
let activeCells;
let activeList;
let dynamicCells;
let branches;
let palette;
let simulationFrame = 0;
let generationSeed = 0;
let isPaused = false;
let maxDynamicCells = 0;
let growthSpeedMultiplier = 1;
let virtualFoods;
let organismCenterX = 0;
let organismCenterY = 0;
let protectedCoreRadius = 0;
let targetCellCount = 0;

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
    simulationFrame += 1;
    updateVirtualFoods();
    growBranchTips();

    if (simulationFrame % EXPLORER_INTERVAL === 0) {
      spawnExploratoryBranch();
    }

    if (simulationFrame % UPDATE_INTERVAL === 0) {
      updateLivingEdge();
    }
  }

  renderCells();
}

// 画面内に収まる最大の16:9キャンバスを計算する
function getFittedCanvasSize() {
  const aspect = 16 / 9;
  let canvasWidth;
  let canvasHeight;

  if (windowWidth / windowHeight > aspect) {
    canvasHeight = Math.floor(windowHeight / PIXEL_SIZE) * PIXEL_SIZE;
    canvasWidth = Math.floor((canvasHeight * aspect) / PIXEL_SIZE) * PIXEL_SIZE;
  } else {
    canvasWidth = Math.floor(windowWidth / PIXEL_SIZE) * PIXEL_SIZE;
    canvasHeight = Math.floor((canvasWidth / aspect) / PIXEL_SIZE) * PIXEL_SIZE;
  }

  return {
    width: Math.max(PIXEL_SIZE, canvasWidth),
    height: Math.max(PIXEL_SIZE, canvasHeight),
  };
}

function regenerate() {
  generationSeed = Math.floor(Math.random() * 1_000_000_000);
  randomSeed(generationSeed);
  noiseSeed(generationSeed);
  simulationFrame = 0;

  initializeGrid();

  const centerX = gridWidth * 0.5 + random(-gridWidth * 0.018, gridWidth * 0.018);
  const centerY = gridHeight * 0.5 + random(-gridHeight * 0.025, gridHeight * 0.025);
  const coreScale = Math.min(gridWidth, gridHeight) * 0.1;

  organismCenterX = centerX;
  organismCenterY = centerY;
  protectedCoreRadius = coreScale * 0.48;
  initializeVirtualFoods();

  generateCentralMass(centerX, centerY, coreScale);
  generateMainBranches(centerX, centerY, coreScale);
  generateNetworkConnections();
  scatterParticles(centerX, centerY, coreScale);
  targetCellCount = Math.max(1, Math.floor(activeCells.size * 1.22));

  if (isPaused) {
    redraw();
  }
}

function initializeGrid() {
  gridWidth = Math.max(1, Math.floor(width / PIXEL_SIZE));
  gridHeight = Math.max(1, Math.floor(height / PIXEL_SIZE));

  const cellCount = gridWidth * gridHeight;
  energy = new Float32Array(cellCount);
  stability = new Float32Array(cellCount);
  phase = new Float32Array(cellCount);
  lifetime = new Float32Array(cellCount);
  known = new Uint8Array(cellCount);

  activeCells = new Set();
  activeList = [];
  dynamicCells = new Set();
  branches = [];
  virtualFoods = [];
  targetCellCount = 0;
  maxDynamicCells = Math.max(500, Math.floor(cellCount * 0.014));

  cellImage = createImage(gridWidth, gridHeight);
  palette = buildPalette();
}

// 複数のずれた楕円を重ね、中心の密集領域を作る
function generateCentralMass(centerX, centerY, coreScale) {
  stampOrganicEllipse(
    centerX,
    centerY,
    coreScale * 1.12,
    coreScale * 0.88,
    random(-0.35, 0.35),
    Math.min(0.96, CORE_DENSITY + 0.1),
    1,
  );

  const blobCount = 7;
  for (let i = 0; i < blobCount; i += 1) {
    const angle = random(TWO_PI);
    const offset = random(coreScale * 0.1, coreScale * 0.68);
    const blobX = centerX + Math.cos(angle) * offset;
    const blobY = centerY + Math.sin(angle) * offset * random(0.65, 1.1);

    stampOrganicEllipse(
      blobX,
      blobY,
      coreScale * random(0.48, 0.9),
      coreScale * random(0.38, 0.76),
      random(-0.9, 0.9),
      CORE_DENSITY * random(0.85, 1.03),
      random(0.76, 0.94),
    );
  }
}

function stampOrganicEllipse(cx, cy, radiusX, radiusY, rotation, density, strength) {
  const extent = Math.ceil(Math.max(radiusX, radiusY) * 1.3);
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);

  for (let y = Math.floor(cy - extent); y <= Math.ceil(cy + extent); y += 1) {
    for (let x = Math.floor(cx - extent); x <= Math.ceil(cx + extent); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const localX = (dx * cosRotation + dy * sinRotation) / radiusX;
      const localY = (-dx * sinRotation + dy * cosRotation) / radiusY;
      const distance = Math.sqrt(localX * localX + localY * localY);

      const contourNoise = noise(x * 0.07, y * 0.07, generationSeed * 0.00001);
      const fineNoise = noise(x * 0.23 + 90, y * 0.23 + 90);
      const unevenEdge = 1 + (contourNoise - 0.5) * 0.42;

      if (distance > unevenEdge) {
        continue;
      }

      const centerBias = clamp(1 - distance, 0, 1);
      const placementChance = density + centerBias * 0.2 - Math.max(0, distance - 0.72) * 0.35;
      const deliberateGap = distance > 0.55 && fineNoise < 0.19;

      if (!deliberateGap && random() < placementChance) {
        const brightness = strength * (0.62 + centerBias * 0.4 + (fineNoise - 0.5) * 0.12);
        const permanence = 0.82 + centerBias * 0.17;
        addCell(x, y, brightness, permanence);
      } else if (distance > 0.72 && random() < 0.045) {
        addCell(x, y, random(0.14, 0.28), 0.08, random(210, 620));
      }
    }
  }
}

// 中心から蛇行するランダムウォークを放射状に伸ばす
function generateMainBranches(centerX, centerY, coreScale) {
  const shortestSide = Math.min(gridWidth, gridHeight);
  const angleOffset = random(TWO_PI);

  for (let i = 0; i < BRANCH_COUNT; i += 1) {
    const baseAngle = angleOffset + (TWO_PI * i) / BRANCH_COUNT + random(-0.22, 0.22);
    const pathLength = Math.floor(shortestSide * random(0.18, 0.33));
    const branch = createBranchPath(
      centerX,
      centerY,
      coreScale,
      baseAngle,
      pathLength,
      i,
    );

    if (branch.path.length === 0) {
      continue;
    }

    const initialFraction = random(0.48, 0.72);
    branch.drawn = Math.max(1, Math.floor(branch.path.length * initialFraction));
    branch.growthBudget = random();
    branch.growthRate = random(0.72, 1.22);

    for (let pointIndex = 0; pointIndex < branch.drawn; pointIndex += 1) {
      paintBranchPoint(branch.path[pointIndex]);
    }

    branches.push(branch);
  }
}

function createBranchPath(cx, cy, originScale, baseAngle, pathLength, branchIndex) {
  const startDistance = random(originScale * 0.18, originScale * 0.65);
  let x = cx + Math.cos(baseAngle) * startDistance;
  let y = cy + Math.sin(baseAngle) * startDistance;
  let heading = baseAngle + random(-0.38, 0.38);
  const waveOffset = random(TWO_PI);
  const slowCurl = random(-0.0028, 0.0028);
  const path = [];
  let lastX = Number.NaN;
  let lastY = Number.NaN;

  for (let step = 0; step < pathLength; step += 1) {
    const progress = step / Math.max(1, pathLength - 1);
    const turnNoise = (noise(branchIndex * 7.3 + step * 0.037, generationSeed * 0.00002) - 0.5) * 1.45;
    const wave = Math.sin(step * 0.11 + waveOffset) * 0.18;
    const desiredHeading = baseAngle + turnNoise + wave + slowCurl * step;
    heading = lerpAngle(heading, desiredHeading, 0.11);
    heading += random(-0.055, 0.055);

    x += Math.cos(heading) * random(0.78, 1.17);
    y += Math.sin(heading) * random(0.78, 1.17);

    if (x < 4 || y < 4 || x >= gridWidth - 4 || y >= gridHeight - 4) {
      break;
    }

    const pointX = Math.round(x);
    const pointY = Math.round(y);
    if (pointX === lastX && pointY === lastY) {
      continue;
    }

    const knot = noise(branchIndex * 2.1 + step * 0.16, 400) > 0.78 ? 0.75 : 0;
    path.push({
      x: pointX,
      y: pointY,
      radius: Math.max(0.58, lerp(2.15, 0.68, progress) + knot + random(-0.22, 0.22)),
      brightness: clamp(lerp(0.7, 0.3, progress) + random(-0.07, 0.07), 0.24, 0.75),
      permanence: lerp(0.86, 0.64, progress),
    });

    lastX = pointX;
    lastY = pointY;
  }

  return { path, drawn: 0, growthBudget: 0, growthRate: 1 };
}

function paintBranchPoint(point) {
  addCell(point.x, point.y, point.brightness, point.permanence);

  const extent = Math.ceil(point.radius);
  for (let offsetY = -extent; offsetY <= extent; offsetY += 1) {
    for (let offsetX = -extent; offsetX <= extent; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) {
        continue;
      }

      const distance = Math.sqrt(offsetX * offsetX + offsetY * offsetY);
      if (distance > point.radius + random(-0.18, 0.25)) {
        continue;
      }

      const falloff = clamp(1 - distance / (point.radius + 0.45), 0, 1);
      if (random() < 0.44 + falloff * 0.45) {
        addCell(
          point.x + offsetX,
          point.y + offsetY,
          point.brightness * random(0.58, 0.91),
          point.permanence * random(0.82, 0.98),
        );
      }
    }
  }

  if (random() < 0.075) {
    const particleAngle = random(TWO_PI);
    const particleDistance = random(2, 4.5);
    addCell(
      point.x + Math.cos(particleAngle) * particleDistance,
      point.y + Math.sin(particleAngle) * particleDistance,
      random(0.12, 0.26),
      0.06,
      random(180, 580),
    );
  }
}

// 枝の途中同士を曲線でつなぎ、網目を作る
function generateNetworkConnections() {
  if (branches.length < 2) {
    return;
  }

  const connectionCount = Math.floor(BRANCH_COUNT * 0.45);

  for (let i = 0; i < connectionCount; i += 1) {
    const firstIndex = Math.floor(random(branches.length));
    const separation = Math.floor(random(1, 4));
    const secondIndex = (firstIndex + separation) % branches.length;
    const firstBranch = branches[firstIndex];
    const secondBranch = branches[secondIndex];

    if (firstBranch.drawn < 4 || secondBranch.drawn < 4) {
      continue;
    }

    const firstPoint = firstBranch.path[
      Math.floor(random(firstBranch.drawn * 0.38, firstBranch.drawn * 0.82))
    ];
    const secondPoint = secondBranch.path[
      Math.floor(random(secondBranch.drawn * 0.38, secondBranch.drawn * 0.82))
    ];

    paintConnection(firstPoint, secondPoint, i);
  }
}

function paintConnection(start, end, connectionIndex) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const steps = Math.max(2, Math.ceil(distance * 1.18));
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const bow = random(-distance * 0.14, distance * 0.14);
  const noiseOffset = random(1000);

  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    const bend = Math.sin(progress * Math.PI) * bow;
    const wobble = (noise(noiseOffset + progress * 3.2, connectionIndex * 3.7) - 0.5) * 5.5;
    const x = lerp(start.x, end.x, progress) + normalX * (bend + wobble);
    const y = lerp(start.y, end.y, progress) + normalY * (bend + wobble);

    const connectionPoint = {
      x: Math.round(x),
      y: Math.round(y),
      radius: random() < 0.1 ? 1.35 : 0.78,
      brightness: random(0.3, 0.48),
      permanence: random(0.62, 0.76),
    };
    paintBranchPoint(connectionPoint);
  }
}

function scatterParticles(centerX, centerY, coreScale) {
  const shortestSide = Math.min(gridWidth, gridHeight);
  const particleCount = Math.floor(shortestSide * 0.36);

  for (let i = 0; i < particleCount; i += 1) {
    const angle = random(TWO_PI);
    const distance = random(coreScale * 1.35, shortestSide * 0.43);
    const x = centerX + Math.cos(angle) * distance * random(0.7, 1.2);
    const y = centerY + Math.sin(angle) * distance * random(0.65, 1.05);

    addCell(x, y, random(0.1, 0.26), 0.04, random(180, 760));
  }
}

// 通常時の探索先。将来はここをユーザーが置く餌へ置き換える
function initializeVirtualFoods() {
  virtualFoods = [];

  for (let i = 0; i < VIRTUAL_FOOD_COUNT; i += 1) {
    virtualFoods.push({
      noiseX: random(1000),
      noiseY: random(1000),
      speed: random(0.00042, 0.00072),
      x: organismCenterX,
      y: organismCenterY,
    });
  }

  updateVirtualFoods();
}

function updateVirtualFoods() {
  const marginX = gridWidth * 0.1;
  const marginY = gridHeight * 0.12;

  for (const food of virtualFoods) {
    const time = simulationFrame * food.speed;
    food.x = lerp(marginX, gridWidth - marginX, noise(food.noiseX + time, food.noiseY));
    food.y = lerp(marginY, gridHeight - marginY, noise(food.noiseX, food.noiseY + time));
  }
}

function spawnExploratoryBranch() {
  if (activeCells.size === 0 || activeCells.size >= targetCellCount * 1.22) {
    return;
  }

  let growingBranchCount = 0;
  for (const branch of branches) {
    if (branch.drawn < branch.path.length) {
      growingBranchCount += 1;
    }
  }
  if (growingBranchCount >= MAX_GROWING_BRANCHES) {
    return;
  }

  const target = virtualFoods[Math.floor(random(virtualFoods.length))];
  const originIndex = findExplorationOrigin(target);
  if (originIndex < 0) {
    return;
  }

  const branch = createForagingBranch(originIndex, target);
  if (branch.path.length > 0) {
    branches.push(branch);
  }
}

function findExplorationOrigin(target) {
  const shortestSide = Math.min(gridWidth, gridHeight);
  let bestIndex = -1;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let attempt = 0; attempt < 72; attempt += 1) {
    const index = getRandomActiveIndex();
    if (index < 0) {
      continue;
    }

    const x = index % gridWidth;
    const y = Math.floor(index / gridWidth);
    const neighbors = countLivingNeighbors(x, y);
    if (neighbors > 6) {
      continue;
    }

    const distanceToFood = Math.hypot(target.x - x, target.y - y);
    const score = -distanceToFood - neighbors * shortestSide * 0.018 + random(-8, 8);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex >= 0 ? bestIndex : getRandomActiveIndex();
}

function createForagingBranch(originIndex, target) {
  const shortestSide = Math.min(gridWidth, gridHeight);
  const pathLength = Math.floor(shortestSide * random(0.075, 0.16));
  let x = originIndex % gridWidth;
  let y = Math.floor(originIndex / gridWidth);
  let heading = Math.atan2(target.y - y, target.x - x) + random(-0.5, 0.5);
  const noiseOffset = random(2000);
  const waveOffset = random(TWO_PI);
  const path = [];
  let lastX = Math.round(x);
  let lastY = Math.round(y);

  for (let step = 0; step < pathLength; step += 1) {
    const progress = step / Math.max(1, pathLength - 1);
    const foodHeading = Math.atan2(target.y - y, target.x - x);
    const wander = (noise(noiseOffset + step * 0.055, simulationFrame * 0.0008) - 0.5) * 1.7;
    const wave = Math.sin(step * 0.13 + waveOffset) * 0.16;
    heading = lerpAngle(heading, foodHeading + wander + wave, 0.085);
    heading += random(-0.045, 0.045);

    x += Math.cos(heading) * random(0.82, 1.2);
    y += Math.sin(heading) * random(0.82, 1.2);
    if (x < 4 || y < 4 || x >= gridWidth - 4 || y >= gridHeight - 4) {
      break;
    }

    const pointX = Math.round(x);
    const pointY = Math.round(y);
    if (pointX === lastX && pointY === lastY) {
      continue;
    }

    path.push({
      x: pointX,
      y: pointY,
      radius: Math.max(0.52, lerp(1.45, 0.58, progress) + random(-0.15, 0.18)),
      brightness: clamp(lerp(0.58, 0.25, progress) + random(-0.06, 0.06), 0.2, 0.64),
      permanence: lerp(0.58, 0.22, progress),
    });

    lastX = pointX;
    lastY = pointY;
  }

  return {
    path,
    drawn: 0,
    growthBudget: random(),
    growthRate: random(0.78, 1.24),
  };
}

function growBranchTips() {
  for (const branch of branches) {
    if (branch.drawn >= branch.path.length) {
      continue;
    }

    branch.growthBudget += GROWTH_SPEED * growthSpeedMultiplier * branch.growthRate;
    while (branch.growthBudget >= 1 && branch.drawn < branch.path.length) {
      paintBranchPoint(branch.path[branch.drawn]);
      branch.drawn += 1;
      branch.growthBudget -= 1;
    }
  }
}

// 外縁だけを低頻度で増殖・消滅させる
function updateLivingEdge() {
  ageDynamicCells();
  erodePersistentCells();

  if (dynamicCells.size >= maxDynamicCells || activeList.length === 0) {
    return;
  }

  const populationPressure = 1 - dynamicCells.size / maxDynamicCells;
  const massPressure = targetCellCount > 0
    ? clamp((targetCellCount * 1.18 - activeCells.size) / (targetCellCount * 0.38), 0.04, 1)
    : 1;
  for (let attempt = 0; attempt < BIRTH_ATTEMPTS; attempt += 1) {
    const sourceIndex = getRandomActiveIndex();
    if (sourceIndex < 0) {
      break;
    }

    const sourceX = sourceIndex % gridWidth;
    const sourceY = Math.floor(sourceIndex / gridWidth);
    const offsetX = Math.floor(random(-1, 2));
    const offsetY = Math.floor(random(-1, 2));
    if (offsetX === 0 && offsetY === 0) {
      continue;
    }

    const targetX = sourceX + offsetX;
    const targetY = sourceY + offsetY;
    if (!isInsideGrid(targetX, targetY)) {
      continue;
    }

    const targetIndex = targetY * gridWidth + targetX;
    if (energy[targetIndex] > 0) {
      continue;
    }

    const neighbors = countLivingNeighbors(targetX, targetY);
    const food = getNearestVirtualFood(sourceX, sourceY);
    const sourceDistance = squaredDistance(sourceX, sourceY, food.x, food.y);
    const targetDistance = squaredDistance(targetX, targetY, food.x, food.y);
    const foodBias = targetDistance < sourceDistance ? 1.28 : 0.72;
    const birthChance = (neighbors >= 2 && neighbors <= 5 ? 0.3 : 0.09)
      * populationPressure
      * massPressure
      * foodBias;
    if (random() < birthChance) {
      addCell(
        targetX,
        targetY,
        clamp(energy[sourceIndex] * random(0.38, 0.72), 0.1, 0.34),
        random(0.03, 0.16),
        random(190, 720),
      );
    }
  }
}

function erodePersistentCells() {
  if (targetCellCount <= 0 || activeCells.size <= targetCellCount * 0.72) {
    return;
  }

  const populationRatio = activeCells.size / targetCellCount;
  const erosionPressure = clamp((populationRatio - 0.72) / 0.5, 0.12, 1);

  for (let attempt = 0; attempt < METABOLISM_SAMPLES; attempt += 1) {
    const index = getRandomActiveIndex();
    if (index < 0 || stability[index] < STABLE_THRESHOLD) {
      continue;
    }

    const x = index % gridWidth;
    const y = Math.floor(index / gridWidth);
    if (Math.hypot(x - organismCenterX, y - organismCenterY) < protectedCoreRadius) {
      continue;
    }

    const neighbors = countLivingNeighbors(x, y);
    const erosionField = noise(x * 0.018 + 600, y * 0.018 + 600, simulationFrame * 0.00075);
    const erosionChance = (neighbors <= 3 ? 0.58 : 0.2) * erosionPressure;
    if (erosionField > 0.53 || random() >= erosionChance) {
      continue;
    }

    stability[index] = Math.max(0, stability[index] - random(0.035, 0.07));
    energy[index] *= random(0.9, 0.97);

    if (stability[index] < STABLE_THRESHOLD) {
      lifetime[index] = random(240, 620);
      dynamicCells.add(index);
    }
  }
}

function getNearestVirtualFood(x, y) {
  let nearest = virtualFoods[0];
  let nearestDistance = squaredDistance(x, y, nearest.x, nearest.y);

  for (let i = 1; i < virtualFoods.length; i += 1) {
    const food = virtualFoods[i];
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

function ageDynamicCells() {
  for (const index of dynamicCells) {
    if (energy[index] <= 0 || stability[index] >= STABLE_THRESHOLD) {
      dynamicCells.delete(index);
      continue;
    }

    lifetime[index] -= UPDATE_INTERVAL;
    if (lifetime[index] < 90) {
      energy[index] *= 0.94;
    }

    const x = index % gridWidth;
    const y = Math.floor(index / gridWidth);
    const isolated = countLivingNeighbors(x, y) === 0;
    const earlyDeath = isolated && random() < 0.045;

    if (lifetime[index] <= 0 || energy[index] < 0.045 || earlyDeath) {
      removeCell(index);
    }
  }
}

function renderCells() {
  background(...COLORS.background);
  cellImage.loadPixels();
  cellImage.pixels.fill(0);

  const globalPulse = 1 + Math.sin(simulationFrame * PULSE_SPEED) * 0.038;
  for (const index of activeCells) {
    if (energy[index] <= 0) {
      continue;
    }

    const personalFlicker = 1 + Math.sin(simulationFrame * TWINKLE_SPEED + phase[index]) * 0.085;
    const secondaryFlicker = Math.sin(simulationFrame * 0.011 + phase[index] * 2.7) * 0.025;
    const fade = stability[index] < STABLE_THRESHOLD ? clamp(lifetime[index] / 100, 0.25, 1) : 1;
    const brightness = clamp(energy[index] * globalPulse * (personalFlicker + secondaryFlicker) * fade, 0, 1);
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
}

function addCell(x, y, brightness, permanence, ttl = 0) {
  const cellX = Math.round(x);
  const cellY = Math.round(y);
  if (!isInsideGrid(cellX, cellY)) {
    return;
  }

  const index = cellY * gridWidth + cellX;
  const wasEmpty = energy[index] <= 0;
  const nextBrightness = clamp(brightness, 0.04, 1);

  energy[index] = wasEmpty
    ? nextBrightness
    : Math.min(1, Math.max(energy[index], nextBrightness) + permanence * 0.015);
  stability[index] = Math.max(stability[index], permanence);

  if (wasEmpty) {
    activeCells.add(index);
    phase[index] = random(TWO_PI);
  }

  if (known[index] === 0) {
    known[index] = 1;
    activeList.push(index);
  }

  if (stability[index] < STABLE_THRESHOLD) {
    lifetime[index] = Math.max(lifetime[index], ttl || random(180, 600));
    dynamicCells.add(index);
  } else {
    lifetime[index] = 0;
    dynamicCells.delete(index);
  }
}

function removeCell(index) {
  energy[index] = 0;
  stability[index] = 0;
  lifetime[index] = 0;
  activeCells.delete(index);
  dynamicCells.delete(index);
}

function getRandomActiveIndex() {
  for (let retry = 0; retry < 12; retry += 1) {
    const index = activeList[Math.floor(random(activeList.length))];
    if (energy[index] > 0) {
      return index;
    }
  }

  return -1;
}

function countLivingNeighbors(x, y) {
  let count = 0;

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      if (offsetX === 0 && offsetY === 0) {
        continue;
      }

      const neighborX = x + offsetX;
      const neighborY = y + offsetY;
      if (!isInsideGrid(neighborX, neighborY)) {
        continue;
      }

      const neighborIndex = neighborY * gridWidth + neighborX;
      if (energy[neighborIndex] > 0) {
        count += 1;
      }
    }
  }

  return count;
}

function isInsideGrid(x, y) {
  return x >= 0 && y >= 0 && x < gridWidth && y < gridHeight;
}

function buildPalette() {
  const colors = [];

  for (let i = 0; i < PALETTE_STEPS; i += 1) {
    const amount = i / (PALETTE_STEPS - 1);
    let color;

    if (amount < 0.36) {
      color = mixColor(COLORS.background, COLORS.edge, amount / 0.36);
    } else if (amount < 0.76) {
      color = mixColor(COLORS.edge, COLORS.body, (amount - 0.36) / 0.4);
    } else {
      color = mixColor(COLORS.body, COLORS.core, (amount - 0.76) / 0.24);
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

function lerpAngle(from, to, amount) {
  const difference = Math.atan2(Math.sin(to - from), Math.cos(to - from));
  return from + difference * amount;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

// クリック位置へ小さな塊と短い枝を追加する
function addSmallColony(canvasX, canvasY) {
  const centerX = (canvasX / width) * gridWidth;
  const centerY = (canvasY / height) * gridHeight;
  const localScale = Math.max(5, Math.min(gridWidth, gridHeight) * 0.025);

  for (let i = 0; i < 3; i += 1) {
    const angle = random(TWO_PI);
    const offset = random(localScale * 0.4);
    stampOrganicEllipse(
      centerX + Math.cos(angle) * offset,
      centerY + Math.sin(angle) * offset,
      localScale * random(0.55, 1.05),
      localScale * random(0.42, 0.82),
      random(-1, 1),
      CORE_DENSITY * random(0.84, 1),
      random(0.68, 0.9),
    );
  }

  const localBranchCount = Math.floor(random(3, 6));
  for (let i = 0; i < localBranchCount; i += 1) {
    const branch = createBranchPath(
      centerX,
      centerY,
      localScale,
      (TWO_PI * i) / localBranchCount + random(-0.45, 0.45),
      Math.floor(random(localScale * 2.5, localScale * 5.2)),
      branches.length + i + 100,
    );

    if (branch.path.length === 0) {
      continue;
    }

    branch.drawn = Math.max(1, Math.floor(branch.path.length * random(0.52, 0.78)));
    branch.growthBudget = random();
    branch.growthRate = random(0.7, 1.15);

    for (let pointIndex = 0; pointIndex < branch.drawn; pointIndex += 1) {
      paintBranchPoint(branch.path[pointIndex]);
    }
    branches.push(branch);
  }
}

function mousePressed() {
  if (mouseX < 0 || mouseY < 0 || mouseX >= width || mouseY >= height) {
    return true;
  }

  addSmallColony(mouseX, mouseY);
  if (isPaused) {
    redraw();
  }
  return false;
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

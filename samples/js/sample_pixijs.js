import {
  Application,
  Graphics,
  Particle,
  ParticleContainer,
  Text,
  Texture,
} from "pixi.js";
// liquidfun-wasm public sources:
// npm: https://www.npmjs.com/package/liquidfun-wasm
// GitHub: https://github.com/Birch-san/box2d-wasm/tree/liquidfun/box2d-wasm
// original LiquidFun upstream: https://github.com/google/liquidfun
import Box2DFactory from "liquidfun-wasm";

let Box2D;
let world;
let particleSystem;
let groundBody;
let ballBody;
let ballFixture;
let mouseJoint = null;
let dragTarget = null;

const METER = 100;
const TIME_STEP = 1 / 60;
const TARGET_FPS = 60;
const MAX_FRAME_DELTA = 0.25;
const MAX_PHYSICS_STEPS = 5;
const VELOCITY_ITERATIONS = 1;
const POSITION_ITERATIONS = 1;
const SIZE_PARTICLE = 4;
const SIZE_DRAGBLE = 50;
const PARTICLE_FPS_FLOOR = 58;
const PARTICLE_TUNE_WARMUP_FRAMES = 45;
const PARTICLE_TUNE_SAMPLE_FRAMES = 90;
// Use two budgets only: a conservative general-desktop target and a low-end fallback.
const PARTICLE_PRESETS = [
  { id: "low", halfWidth: 224, halfHeight: 128 },
  { id: "high", halfWidth: 317, halfHeight: 221 },
];

let windowW = innerWidth;
let windowH = innerHeight;
const dpi = devicePixelRatio ?? 1;

const performanceLevel = resolvePerformanceLevel();
let particlePresetIndex = selectInitialParticlePresetIndex();

let app;
let stage;
let pixiDragBall;
let fluidContainer;
let fpsLabel;
let particleTexture;
const pixiParticles = [];

let activePointerId = null;
let isDragging = false;
let particleIterations = 1;
let lastFrameTime = null;
let accumulatedTime = 0;
let currentParticleCount = 0;
let displayedFps = TARGET_FPS;
let lastStatsUpdateAt = 0;
let particleTuneWarmupFrames = PARTICLE_TUNE_WARMUP_FRAMES;
let particleTuneSampleFrames = 0;
let particleTuneSampleFpsTotal = 0;
let particleBudgetLocked = false;

init();

function resolvePerformanceLevel() {
  const ua = navigator.userAgent ?? "";
  const narrow = innerWidth < 640;
  const coarsePhone =
    /iPhone|Android.*Mobile/i.test(ua) ||
    (narrow && navigator.maxTouchPoints > 0);
  return coarsePhone ? "low" : "high";
}

function selectInitialParticlePresetIndex() {
  const deviceMemory = navigator.deviceMemory ?? 8;
  const hardwareConcurrency = navigator.hardwareConcurrency ?? 8;

  if (performanceLevel === "low") {
    return 0;
  }
  if (deviceMemory <= 4 || hardwareConcurrency <= 4) {
    return 0;
  }
  return 1;
}

function resetParticleBudgetSampling() {
  particleTuneWarmupFrames = PARTICLE_TUNE_WARMUP_FRAMES;
  particleTuneSampleFrames = 0;
  particleTuneSampleFpsTotal = 0;
  displayedFps = TARGET_FPS;
  lastStatsUpdateAt = 0;
}

function screenToWorld(sx, sy) {
  return { x: sx / METER, y: sy / METER };
}

function clientToPixiGlobal(clientX, clientY) {
  const rect = app.canvas.getBoundingClientRect();
  return {
    x: ((clientX - rect.left) / rect.width) * app.screen.width,
    y: ((clientY - rect.top) / rect.height) * app.screen.height,
  };
}

function getPointerWorld(eventLike) {
  if (eventLike.global) {
    return screenToWorld(eventLike.global.x, eventLike.global.y);
  }
  const nativeEvent = eventLike.nativeEvent ?? eventLike;
  const point = clientToPixiGlobal(nativeEvent.clientX ?? 0, nativeEvent.clientY ?? 0);
  return screenToWorld(point.x, point.y);
}

function updateWindowSize() {
  windowW = app.screen.width;
  windowH = app.screen.height;
}

function createPhysicsWalls() {
  const density = 0;
  const wallsBody = world.CreateBody(new Box2D.b2BodyDef());

  const groundShape = new Box2D.b2PolygonShape();
  groundShape.SetAsBox(
    windowW / METER / 2,
    5 / METER,
    new Box2D.b2Vec2(windowW / METER / 2, windowH / METER + 0.05),
    0
  );
  wallsBody.CreateFixture(groundShape, density);

  const leftWall = new Box2D.b2PolygonShape();
  leftWall.SetAsBox(
    5 / METER,
    windowH / METER / 2,
    new Box2D.b2Vec2(-0.05, windowH / METER / 2),
    0
  );
  wallsBody.CreateFixture(leftWall, density);

  const rightWall = new Box2D.b2PolygonShape();
  rightWall.SetAsBox(
    5 / METER,
    windowH / METER / 2,
    new Box2D.b2Vec2(windowW / METER + 0.05, windowH / METER / 2),
    0
  );
  wallsBody.CreateFixture(rightWall, density);
}

function createPhysicsParticles() {
  const particleSystemDef = new Box2D.b2ParticleSystemDef();
  particleSystemDef.radius = SIZE_PARTICLE / METER;
  particleSystemDef.pressureStrength = 4.0;
  particleSystemDef.strictContactCheck = true;
  particleSystem = world.CreateParticleSystem(particleSystemDef);

  const box = new Box2D.b2PolygonShape();
  const { halfWidth, halfHeight } = PARTICLE_PRESETS[particlePresetIndex];
  box.SetAsBox(
    halfWidth / METER,
    halfHeight / METER,
    new Box2D.b2Vec2(windowW / 2 / METER, -windowH / 2 / METER),
    0
  );

  const particleGroupDef = new Box2D.b2ParticleGroupDef();
  particleGroupDef.shape = box;
  particleSystem.CreateParticleGroup(particleGroupDef);
  currentParticleCount = particleSystem.GetParticleCount();
}

function createPhysicsBall() {
  const bodyDef = new Box2D.b2BodyDef();
  bodyDef.type = Box2D.b2_dynamicBody;
  bodyDef.position.Set(windowW / 2 / METER, (-windowH * 1.5) / METER);

  const circle = new Box2D.b2CircleShape();
  circle.m_radius = SIZE_DRAGBLE / METER;

  ballBody = world.CreateBody(bodyDef);
  ballFixture = ballBody.CreateFixture(circle, 8);
  ballFixture.SetFriction(0.1);
  ballFixture.SetRestitution(0.1);
}

function createParticleTexture() {
  if (particleTexture) {
    return particleTexture;
  }

  const canvas = document.createElement("canvas");
  canvas.width = SIZE_PARTICLE * 2 * dpi;
  canvas.height = SIZE_PARTICLE * 2 * dpi;
  const ctx = canvas.getContext("2d");
  ctx.beginPath();
  ctx.arc(
    SIZE_PARTICLE * dpi,
    SIZE_PARTICLE * dpi,
    (SIZE_PARTICLE * dpi) / 2,
    0,
    Math.PI * 2
  );
  ctx.fillStyle = "white";
  ctx.fill();
  particleTexture = Texture.from(canvas);
  return particleTexture;
}

function rebuildPixiParticles() {
  for (const particle of pixiParticles) {
    particle.destroy();
  }
  pixiParticles.length = 0;

  if (fluidContainer) {
    stage.removeChild(fluidContainer);
    fluidContainer.destroy();
  }

  fluidContainer = new ParticleContainer({
    dynamicProperties: {
      position: true,
    },
  });
  stage.addChildAt(fluidContainer, 0);

  const texture = createParticleTexture();
  for (let i = 0; i < currentParticleCount; i++) {
    const shape = new Particle({
      texture,
      x: 0,
      y: 0,
      scaleX: 1 / dpi,
      scaleY: 1 / dpi,
      anchorX: 0.5,
      anchorY: 0.5,
    });
    fluidContainer.addParticle(shape);
    pixiParticles[i] = shape;
  }
}

function createPixiWorld() {
  rebuildPixiParticles();

  pixiDragBall = new Graphics();
  pixiDragBall.circle(0, 0, SIZE_DRAGBLE);
  pixiDragBall.fill({ color: 0x990000 });
  pixiDragBall.eventMode = "static";
  pixiDragBall.cursor = "pointer";
  stage.addChild(pixiDragBall);

  fpsLabel = new Text({
    text: "FPS: --",
    style: {
      fill: 0xffffff,
      fontFamily: "monospace",
      fontSize: 16,
      stroke: { color: 0x000000, width: 3 },
    },
  });
  fpsLabel.x = 12;
  fpsLabel.y = 10;
  stage.addChild(fpsLabel);
}

function rebuildParticleSystem() {
  if (particleSystem) {
    world.DestroyParticleSystem(particleSystem);
    particleSystem = null;
  }

  createPhysicsParticles();
  rebuildPixiParticles();
  particleIterations = world.CalculateReasonableParticleIterations(TIME_STEP);
  particleBudgetLocked = false;
  resetParticleBudgetSampling();
}

function createMouseJoint(targetPoint) {
  if (mouseJoint) return;

  const jointDef = new Box2D.b2MouseJointDef();
  jointDef.bodyA = groundBody;
  jointDef.bodyB = ballBody;
  jointDef.target = new Box2D.b2Vec2(targetPoint.x, targetPoint.y);
  jointDef.maxForce = 1000 * ballBody.GetMass();

  const stiffnessPtr = Box2D._malloc(Float32Array.BYTES_PER_ELEMENT * 2);
  Box2D.b2LinearStiffness(
    stiffnessPtr,
    stiffnessPtr + Float32Array.BYTES_PER_ELEMENT,
    5,
    0.7,
    groundBody,
    ballBody
  );
  const stiffnessOffset = stiffnessPtr >> 2;
  jointDef.stiffness = Box2D.HEAPF32[stiffnessOffset];
  jointDef.damping = Box2D.HEAPF32[stiffnessOffset + 1];
  Box2D._free(stiffnessPtr);

  mouseJoint = Box2D.castObject(world.CreateJoint(jointDef), Box2D.b2MouseJoint);
  ballBody.SetAwake(true);
}

function destroyMouseJoint() {
  if (!mouseJoint) return;
  world.DestroyJoint(mouseJoint);
  mouseJoint = null;
}

function setupDragEvent() {
  function onPointerMove(event) {
    if (!isDragging || !mouseJoint || !dragTarget) return;
    if (
      activePointerId != null &&
      event.pointerId !== undefined &&
      event.pointerId !== activePointerId
    ) {
      return;
    }
    const p = getPointerWorld(event);
    dragTarget.Set(p.x, p.y);
    mouseJoint.SetTarget(dragTarget);
  }

  function onPointerEnd(event) {
    if (!isDragging) return;
    if (
      activePointerId != null &&
      event.pointerId !== undefined &&
      event.pointerId !== activePointerId
    ) {
      return;
    }

    isDragging = false;
    activePointerId = null;
    destroyMouseJoint();
    removeEventListener("pointermove", onPointerMove, true);
    removeEventListener("pointerup", onPointerEnd, true);
    removeEventListener("pointercancel", onPointerEnd, true);
  }

  pixiDragBall.on("pointerdown", (event) => {
    if (mouseJoint) return;

    try {
      event.preventDefault();
    } catch (_) {}

    if (event.pointerId !== undefined) {
      activePointerId = event.pointerId;
      try {
        app.canvas.setPointerCapture(event.pointerId);
      } catch (_) {}
    }

    isDragging = true;
    const p = getPointerWorld(event);
    if (!dragTarget) {
      dragTarget = new Box2D.b2Vec2(p.x, p.y);
    } else {
      dragTarget.Set(p.x, p.y);
    }
    createMouseJoint(p);

    addEventListener("pointermove", onPointerMove, true);
    addEventListener("pointerup", onPointerEnd, true);
    addEventListener("pointercancel", onPointerEnd, true);
  });
}

function renderParticles() {
  const positionBuffer = particleSystem.GetPositionBuffer();
  const offset = Box2D.getPointer(positionBuffer) >> 2;

  for (let i = 0; i < currentParticleCount; i++) {
    const particle = pixiParticles[i];
    particle.x = Box2D.HEAPF32[offset + i * 2] * METER;
    particle.y = Box2D.HEAPF32[offset + i * 2 + 1] * METER;
  }
}

function stepPhysics() {
  world.Step(
    TIME_STEP,
    VELOCITY_ITERATIONS,
    POSITION_ITERATIONS,
    particleIterations
  );
}

function maybeTuneParticleBudget(measuredFps) {
  if (particleBudgetLocked || isDragging) {
    return;
  }
  if (particleTuneWarmupFrames > 0) {
    particleTuneWarmupFrames--;
    return;
  }

  particleTuneSampleFrames++;
  particleTuneSampleFpsTotal += measuredFps;

  if (particleTuneSampleFrames < PARTICLE_TUNE_SAMPLE_FRAMES) {
    return;
  }

  const averageFps = particleTuneSampleFpsTotal / particleTuneSampleFrames;
  if (averageFps < PARTICLE_FPS_FLOOR && particlePresetIndex > 0) {
    particlePresetIndex--;
    rebuildParticleSystem();
    return;
  }

  particleBudgetLocked = true;
}

function updateStatsLabel(frameTime, displayFps) {
  const safeDisplayFps = Number.isFinite(displayFps) ? displayFps : TARGET_FPS;
  displayedFps += (safeDisplayFps - displayedFps) * 0.15;
  if (frameTime - lastStatsUpdateAt < 250) {
    return;
  }

  lastStatsUpdateAt = frameTime;
  fpsLabel.text =
    `FPS: ${Math.round(displayedFps)} | ` +
    `Particles: ${currentParticleCount.toLocaleString()}`;
}

function handleTick(frameTime) {
  if (lastFrameTime == null) {
    lastFrameTime = frameTime;
  }

  const rawElapsed = Math.max((frameTime - lastFrameTime) / 1000, 0);
  const measuredFps = rawElapsed > 0 ? 1 / rawElapsed : TARGET_FPS;
  const elapsed = Math.min(rawElapsed, MAX_FRAME_DELTA);
  lastFrameTime = frameTime;
  accumulatedTime += elapsed;

  let steps = 0;
  while (accumulatedTime >= TIME_STEP && steps < MAX_PHYSICS_STEPS) {
    stepPhysics();
    accumulatedTime -= TIME_STEP;
    steps++;
  }

  if (steps === MAX_PHYSICS_STEPS && accumulatedTime >= TIME_STEP) {
    accumulatedTime = 0;
  }

  renderParticles();

  const ballPosition = ballBody.GetPosition();
  pixiDragBall.x = ballPosition.x * METER;
  pixiDragBall.y = ballPosition.y * METER;
  maybeTuneParticleBudget(measuredFps);
  updateStatsLabel(frameTime, app.ticker.FPS);

  requestAnimationFrame(handleTick);
}

async function init() {
  Box2D = await Box2DFactory();

  app = new Application();
  await app.init({
    width: innerWidth,
    height: innerHeight,
    resolution: dpi,
    autoDensity: true,
    resizeTo: globalThis,
    preference: "webgpu",
  });
  document.body.appendChild(app.canvas);
  stage = app.stage;
  stage.eventMode = "static";

  updateWindowSize();

  const gravity = new Box2D.b2Vec2(0, 10);
  world = new Box2D.b2World(gravity);
  groundBody = world.CreateBody(new Box2D.b2BodyDef());

  createPhysicsWalls();
  createPhysicsParticles();
  createPhysicsBall();
  createPixiWorld();
  setupDragEvent();

  particleIterations = world.CalculateReasonableParticleIterations(TIME_STEP);
  resetParticleBudgetSampling();
  requestAnimationFrame(handleTick);
}

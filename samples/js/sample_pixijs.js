import {
  Application,
  Graphics,
  Particle,
  ParticleContainer,
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
const VELOCITY_ITERATIONS = 1;
const POSITION_ITERATIONS = 1;
const SIZE_PARTICLE = 4;
const SIZE_DRAGBLE = 50;

let windowW = innerWidth;
let windowH = innerHeight;
const dpi = devicePixelRatio ?? 1;

let performanceLevel;
{
  const ua = navigator.userAgent ?? "";
  const narrow = innerWidth < 640;
  const coarsePhone =
    /iPhone|Android.*Mobile/i.test(ua) ||
    (narrow && navigator.maxTouchPoints > 0);
  performanceLevel = coarsePhone ? "low" : "high";
}

let app;
let stage;
let pixiDragBall;
let fluidContainer;
const pixiParticles = [];

let activePointerId = null;
let isDragging = false;
let particleIterations = 1;

init();

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
  const w = performanceLevel === "high" ? 256 : 256;
  const h = performanceLevel === "high" ? 384 : 128;
  box.SetAsBox(
    w / METER,
    h / METER,
    new Box2D.b2Vec2(windowW / 2 / METER, -windowH / 2 / METER),
    0
  );

  const particleGroupDef = new Box2D.b2ParticleGroupDef();
  particleGroupDef.shape = box;
  particleSystem.CreateParticleGroup(particleGroupDef);
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

function createPixiWorld() {
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

  const texture = Texture.from(canvas);
  fluidContainer = new ParticleContainer({
    dynamicProperties: {
      position: true,
    },
  });
  stage.addChild(fluidContainer);

  const particleCount = particleSystem.GetParticleCount();
  for (let i = 0; i < particleCount; i++) {
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

  pixiDragBall = new Graphics();
  pixiDragBall.circle(0, 0, SIZE_DRAGBLE);
  pixiDragBall.fill({ color: 0x990000 });
  pixiDragBall.eventMode = "static";
  pixiDragBall.cursor = "pointer";
  stage.addChild(pixiDragBall);
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
  const particleCount = particleSystem.GetParticleCount();
  const positionBuffer = particleSystem.GetPositionBuffer();
  const offset = Box2D.getPointer(positionBuffer) >> 2;

  for (let i = 0; i < particleCount; i++) {
    const particle = pixiParticles[i];
    particle.x = Box2D.HEAPF32[offset + i * 2] * METER;
    particle.y = Box2D.HEAPF32[offset + i * 2 + 1] * METER;
  }
}

function handleTick() {
  world.Step(
    TIME_STEP,
    VELOCITY_ITERATIONS,
    POSITION_ITERATIONS,
    particleIterations
  );

  renderParticles();

  const ballPosition = ballBody.GetPosition();
  pixiDragBall.x = ballPosition.x * METER;
  pixiDragBall.y = ballPosition.y * METER;

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
    resizeTo: window,
    preference: "webgl",
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
  handleTick();
}

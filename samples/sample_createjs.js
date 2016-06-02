"use strict";

// グローバルに「world」インスタンスを用意しなければならない
var world = null;

/** LiquidFunの単位はメートル。px換算の数値を設定します。 */
var METER = 100;
/** 時間のステップを設定します。60FPSを示します。 */
var TIME_STEP = 1.0 / 60.0;
/** 速度の計算回数です。回数が多いほど正確になりますが、計算負荷が増えます。 */
var VELOCITY_ITERATIONS = 1;
/** 位置の計算回数です。回数が多いほど正確になりますが、計算負荷が増えます。 */
var POSITION_ITERATIONS = 1;
/** パーティクルのサイズです。 */
var SIZE_PARTICLE = 4;
/** ドラッグボールのサイズです。 */
var SIZE_DRAGBLE = 50;


/** 画面のサイズ(横幅)です。 */
var windowW = window.innerWidth;
/** 画面のサイズ(高さ)です。 */
var windowH = window.innerHeight;
/** DPIです。 */
var dpi = window.devicePixelRatio || 1.0;

/** [CreateJS] ステージです。 */
var stage;
/** [CreateJS] ドラッグボールの表示オブジェクトです。 */
var _cjsDragBall;
/** [CreateJS] 粒子の表示オブジェクトの配列です。 */
var _cjsParticles = [];

/** [LiquidFun] パーティクルシステムです。 */
var _b2ParticleSystem;
/** [LiquidFun] ドラッグボール用のインスタンスです。 */
var _b2DragBallFixutre;
/** [LiquidFun] マクスジョイントです。 */
var _b2MouseJoint;
/** [LiquidFun] ドラッグボール制御用のインスタンスです。 */
var _b2GroundBody;

/** 端末ごとにパフォーマンスを調整するための変数です。 */
var performanceLevel;
switch (navigator.platform) {
  case "Win32": // Windowsだったら
  case "MacIntel": // OS Xだったら
    performanceLevel = "high";
    break;
  case "iPhone": // iPhoneだったら
  default: // その他の端末も
    performanceLevel = "low";
}

// ページが読み込み終わったら初期化する
window.addEventListener("load", init);

function init() {
  // 重力の設定
  var gravity = new b2Vec2(0, 10);
  // Box2D(LiquidFun)の世界を作成
  world = new b2World(gravity);

  // グランドの作成
  _b2GroundBody = world.CreateBody(new b2BodyDef());

  // Box2Dのコンテンツを作成
  createPhysicsWalls();
  createPhysicsParticles();
  createPhysicsBall();

  // CreateJSのコンテンツを作成
  createCreatejsWorld();

  // 定期的に呼び出す関数(エンターフレーム)を設定
  createjs.Ticker.timingMode = createjs.Ticker.RAF;
  createjs.Ticker.setFPS(60);
  createjs.Ticker.on("tick", handleTick);

  setupDragEvent();
}


/** LiquidFunの世界で「壁」を生成します。 */
function createPhysicsWalls() {

  var density = 0;

  var bdDef = new b2BodyDef();
  var bobo = world.CreateBody(bdDef);
  // 壁の生成 (地面)
  var wg = new b2PolygonShape();
  wg.SetAsBoxXYCenterAngle(
    windowW / METER / 2, // 幅
    5 / METER, // 高さ
    new b2Vec2(windowW / METER / 2, // X座標
      windowH / METER + 0.05), // Y座標
    0);
  bobo.CreateFixtureFromShape(wg, density);


  // 壁の生成 (左側)
  var wgl = new b2PolygonShape();
  wgl.SetAsBoxXYCenterAngle(
    5 / METER,　// 幅
    windowH / METER / 2, // 高さ
    new b2Vec2(-0.05, // X座標
      windowH / METER / 2), // Y座標
    0);
  bobo.CreateFixtureFromShape(wgl, density);

  // 壁の生成 (右側)
  var wgr = new b2PolygonShape();
  wgr.SetAsBoxXYCenterAngle(
    5 / METER,　// 幅
    windowH / METER / 2, // 高さ
    new b2Vec2(windowW / METER + 0.05, // X座標
      windowH / METER / 2), // Y座標
    0);
  bobo.CreateFixtureFromShape(wgr, density);
}

/** LiquidFunの世界で「粒子」を生成します。 */
function createPhysicsParticles() {
  // 粒子の作成 (プロパティーの設定)
  var psd = new b2ParticleSystemDef();
  psd.radius = SIZE_PARTICLE / METER; // 粒子の半径
  psd.pressureStrength = 4.0; // Increases pressure in response to compression Smaller values allow more compression
  _b2ParticleSystem = world.CreateParticleSystem(psd);
  // 粒子の発生領域
  var box = new b2PolygonShape();

  var w = (performanceLevel == "high") ? 128 : 64;
  var h = (performanceLevel == "high") ? 128 : 128;

  box.SetAsBoxXYCenterAngle(
    w / METER, // 幅
    h / METER, // 高さ
    new b2Vec2(windowW / 2 / METER, // 発生X座標
      -windowH / 2 / METER), // 発生Y座標
    0);
  var particleGroupDef = new b2ParticleGroupDef();
  particleGroupDef.shape = box; // 発生矩形を登録
  _b2ParticleSystem.CreateParticleGroup(particleGroupDef);
}

function createPhysicsBall() {
  // 属性を設定
  var bd = new b2BodyDef();
  bd.type = b2_dynamicBody;
  bd.position.Set(windowW / 2 / METER,// 発生X座標
    -windowH / METER // 発生Y座標
  );
  // 形状を設定
  var circle = new b2CircleShape();
  circle.radius = SIZE_DRAGBLE / METER;

  // 実態を作成
  var body = world.CreateBody(bd);
  _b2DragBallFixutre = body.CreateFixtureFromShape(circle, 8); //鉄：7.9、アルミニウム：2.6、ゴム：0.4、木：1.4、コンクリート：2.4、氷：1;
  _b2DragBallFixutre.friction = 0.1; // 鉄：0.6、アルミニウム：0.6、ゴム：0.9、木：0.5、コンクリート：0.7、氷：0
  _b2DragBallFixutre.restitution = 0.1; // 鉄：0.2、アルミニウム：0.3、ゴム：0.9、木：0.3、コンクリート：0.1、氷：0.1

}


function createCreatejsWorld() {
  // CreateJSの世界を作成
  stage = new createjs.Stage("myCanvas");
  stage.enableMouseOver(); // マウスオーバーを有効化

  stage.canvas.width = windowW * dpi; // 実Pixel数を画面のPixel数に調整
  stage.canvas.height = windowH * dpi;
  stage.scaleX = stage.scaleY = dpi;

  // タッチ操作をサポートしているブラウザーならば
  if (createjs.Touch.isSupported() == true) {
    // タッチ操作を有効にします。
    createjs.Touch.enable(stage)
  }

  // パーティクルの作成
  var length = _b2ParticleSystem.GetPositionBuffer().length / 2;
  for (var i = 0; i < length; i++) {
    var shape = new createjs.Shape(); // シェイプを作成
    shape.mouseEnabled = false;
    shape.compositeOperation = Math.random() < 0.5 ? "normal" : "lighter";
    var hue = i / length * 100 + 180; // 色相
    var satuation = 40 * Math.random() + 60;
    shape.graphics
      .beginFill(createjs.Graphics.getHSL(hue, satuation, 70, 0.5)) // 色指定
      .drawCircle(0, 0, 12 * Math.random() * Math.random()); // 大きさを指定
    stage.addChild(shape); // 画面に追加
    _cjsParticles[i] = shape; // 配列に格納
  }

  // ドラッグボールの作成
  _cjsDragBall = new createjs.Shape();
  _cjsDragBall.cursor = "pointer";
  _cjsDragBall.graphics
    .beginFill("black") // 色指定
    .setStrokeStyle(3)
    .beginStroke("white")
    .drawCircle(0, 0, SIZE_DRAGBLE); // 大きさを指定
  stage.addChild(_cjsDragBall); // 画面に追加
}

/** 時間経過で指出される関数です。 */
function handleTick() {
  // 物理演算エンジンを更新
  world.Step(TIME_STEP, VELOCITY_ITERATIONS, POSITION_ITERATIONS);

  // パーティクルシステムの計算結果を取得
  var particlesPositions = _b2ParticleSystem.GetPositionBuffer();

  // 粒子表現 : 物理演算エンジンとCreateJSの座標を同期
  for (var i = 0; i < _cjsParticles.length; i++) {
    var shape = _cjsParticles[i]; // 配列から要素を取得
    // LiquidFunの配列から座標を取得
    var xx = particlesPositions[i * 2] * METER;
    var yy = particlesPositions[(i * 2) + 1] * METER;
    // 座標を表示パーツに適用
    shape.x = xx;
    shape.y = yy;
  }

  // ドラッグボール : 物理演算エンジンとCreateJSの座標を同期
  _cjsDragBall.x = _b2DragBallFixutre.body.GetPosition().x * METER;
  _cjsDragBall.y = _b2DragBallFixutre.body.GetPosition().y * METER;

  // 残像効果の演出
  // 詳細 ⇛ https://plus.google.com/102594170131511973965/posts/ZA6QadXfjzX
  stage.autoClear = false;
  var context = stage.canvas.getContext("2d");
  context.fillStyle = "rgba(0, 0, 0, 0.1)";
  context.fillRect(0, 0, stage.canvas.width, stage.canvas.height);

  // 画面を更新する
  stage.update();
}

/** ドラッグイベントを設定します。 */
function setupDragEvent() {
  _cjsDragBall.on('mousedown', function (event) {
    var p = getMouseCoords(event);
    var aabb = new b2AABB();
    aabb.lowerBound.Set(p.x - 0.001, p.y - 0.001);
    aabb.upperBound.Set(p.x + 0.001, p.y + 0.001);
    var queryCallback = new QueryCallback(p);
    world.QueryAABB(queryCallback, aabb);
    if (queryCallback.fixture) {
      var body = queryCallback.fixture.body;
      var md = new b2MouseJointDef();
      md.bodyA = _b2GroundBody;
      md.bodyB = body;
      md.target = p;
      md.maxForce = 1000 * body.GetMass();
      // マウスジョイントを作成
      _b2MouseJoint = world.CreateJoint(md);
      body.SetAwake(true);
    }
  });
  _cjsDragBall.on('pressmove', function (event) {
    var p = getMouseCoords(event);
    if (_b2MouseJoint) {
      // マウスジョイントの対象座標を更新
      _b2MouseJoint.SetTarget(p);
    }
  });
  _cjsDragBall.on('pressup', function (event) {
    if (_b2MouseJoint) {
      // マウスジョイントを破棄
      world.DestroyJoint(_b2MouseJoint);
      _b2MouseJoint = null;
    }
  });

}

/**
 * マウス座標を取得します。
 * @return b2Vec2 マウス座標のベクター情報です。
 */
function getMouseCoords(event) {
  var p = new b2Vec2((stage.mouseX / dpi / METER), (stage.mouseY / dpi / METER));
  return p;
}


/**
 * LiquidFun の衝突判定に使うクラスです。
 * @constructor
 */
function QueryCallback(point) {
  this.point = point;
  this.fixture = null;
}
/**@return bool 当たり判定があれば true を返します。 */
QueryCallback.prototype.ReportFixture = function (fixture) {
  var body = fixture.body;
  if (body.GetType() === b2_dynamicBody) {
    var inside = fixture.TestPoint(this.point);
    if (inside) {
      this.fixture = fixture;
      return true;
    }
  }
  return false;
};
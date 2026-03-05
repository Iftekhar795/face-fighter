'use strict';

/* ================================================================
   SLAP SIMULATOR — main.js
   3-D browser game: upload a face → detect it → slap the ragdoll
   → watch it fly with Cannon.js physics

   Structure
   ---------
   1.  Constants & state
   2.  Three.js renderer / scene / lights / room
   3.  Cannon.js physics world
   4.  Ragdoll (static display + physics activation on slap)
   5.  face-api.js face detection & texture creation
   6.  Slap input (mouse + touch)
   7.  Score system
   8.  UI helpers
   9.  Animation loop
   10. Bootstrap
   ================================================================ */


// ================================================================
// 1.  CONSTANTS & GLOBAL STATE
// ================================================================

/** URL prefix for face-api.js model weights (served from npm CDN). */
const MODELS_URL = 'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights';

/** Physics gravity (m/s² — exaggerated for fun). */
const GRAVITY = -22;

/** Room half-size in metres. */
const ROOM_HALF = 10;

/** Maximum impulse force that can be applied by one slap. */
const MAX_FORCE = 110;

/** Minimum slap force added regardless of swipe speed. */
const BASE_FORCE = 18;

/** How much px/s of swipe speed contributes to slap force. */
const FORCE_SPEED_MULTIPLIER = 0.07;

/** Fraction of head-bounding-box used as padding when cropping the face. */
const FACE_CROP_PADDING_RATIO = 0.38;

/** Head Y position (metres) below which we consider the character "landed". */
const LANDING_HEIGHT_THRESHOLD = 0.6;

/** Speed (m/s) below which a landed character is considered at rest. */
const LANDING_SPEED_THRESHOLD = 0.8;

/**
 * Combo messages, shown after the character lands.
 * Each entry requires the character to have flown at least `min` metres.
 */
const COMBOS = [
  { min: 0,  text: 'LIGHT TAP 😴',          color: '#aaaaaa' },
  { min: 2,  text: 'NICE SLAP! 👋',          color: '#ffde00' },
  { min: 5,  text: 'SUPER COMBO! 🔥',        color: '#ff8c00' },
  { min: 10, text: 'CRITICAL SLAP! 💥',      color: '#ff4444' },
  { min: 20, text: 'EMOTIONAL DAMAGE! 😭💢', color: '#ff00ff' },
];

/** Finite-state machine states for the game. */
const STATE = {
  INTRO:   'intro',    // start screen visible
  LOADING: 'loading',  // face detection / model load in progress
  READY:   'ready',    // character on screen, waiting for slap
  FLYING:  'flying',   // character was slapped and is in the air / tumbling
};
let gameState = STATE.INTRO;

// ---- Three.js globals ----------------------------------------
let scene, camera, renderer;

// ---- Cannon.js globals ---------------------------------------
let physicsWorld;
const FIXED_DT  = 1 / 60;   // physics step size
const MAX_STEPS = 3;         // max sub-steps per frame
let lastTimestamp = null;

// ---- Ragdoll -------------------------------------------------
/**
 * Active character object.
 * {
 *   parts:       Array<{ mesh: THREE.Mesh, body: CANNON.Body, mass: number }>
 *   neckMesh:    THREE.Mesh    (visual only — not a physics body)
 *   constraints: Array<CANNON.Constraint>
 *   headBody:    CANNON.Body
 *   torsoBody:   CANNON.Body
 *   isPhysicsOn: boolean
 * }
 */
let character = null;

/** Three.js texture from the uploaded face image. */
let faceTexture = null;

// ---- Slap input ----------------------------------------------
let pointerIsDown  = false;
let swipeStart     = null;   // { x, y, time }

// ---- Score ---------------------------------------------------
let slapOrigin = new THREE.Vector3(); // world pos of head when slapped
let maxFlyDist = 0;                   // maximum horizontal distance reached


// ================================================================
// 2.  THREE.JS — RENDERER, SCENE, LIGHTS, ROOM
// ================================================================

/** Set up the Three.js renderer and resize listener. */
function initRenderer() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0d0d1a);
  scene.fog = new THREE.FogExp2(0x0d0d1a, 0.035);

  // Perspective camera positioned in front of the character
  camera = new THREE.PerspectiveCamera(
    65,
    window.innerWidth / window.innerHeight,
    0.1,
    60
  );
  camera.position.set(0, 1.6, 4.0);
  camera.lookAt(0, 1.1, 0);

  const canvas = document.getElementById('game-canvas');
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

/** Add ambient, directional (shadow-casting), and accent lights. */
function initLights() {
  // Soft ambient fill
  scene.add(new THREE.AmbientLight(0xffffff, 0.38));

  // Main directional light with shadows
  const sun = new THREE.DirectionalLight(0xfff5e0, 1.1);
  sun.position.set(4, 10, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near   = 0.5;
  sun.shadow.camera.far    = 35;
  sun.shadow.camera.top    = 10;
  sun.shadow.camera.bottom = -2;
  sun.shadow.camera.left   = -10;
  sun.shadow.camera.right  =  10;
  scene.add(sun);

  // Cool purple rim light from behind
  const rim = new THREE.DirectionalLight(0x7733ff, 0.5);
  rim.position.set(-4, 4, -6);
  scene.add(rim);

  // Warm point light near camera
  const fill = new THREE.PointLight(0xff4400, 0.65, 14);
  fill.position.set(0, 3, 3.5);
  scene.add(fill);
}

/** Build the room: floor, grid overlay, and box-shaped walls/ceiling. */
function initRoom() {
  // Floor plane
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x1c1c2e, roughness: 0.95 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ROOM_HALF * 2, ROOM_HALF * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // Subtle grid for depth cue
  const grid = new THREE.GridHelper(ROOM_HALF * 2, ROOM_HALF * 2, 0x333355, 0x222244);
  grid.position.y = 0.003;
  scene.add(grid);

  // Room walls and ceiling rendered as the inside of a large box
  const wallMat = new THREE.MeshStandardMaterial({
    color:     0x16162a,
    roughness: 1.0,
    side:      THREE.BackSide,
  });
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(ROOM_HALF * 2, 12, ROOM_HALF * 2),
    wallMat
  );
  room.position.set(0, 6, 0);
  room.receiveShadow = true;
  scene.add(room);
}


// ================================================================
// 3.  CANNON.JS — PHYSICS WORLD
// ================================================================

/** Create the physics world with gravity, broadphase, and boundary planes. */
function initPhysics() {
  physicsWorld = new CANNON.World();
  physicsWorld.gravity.set(0, GRAVITY, 0);
  physicsWorld.broadphase = new CANNON.NaiveBroadphase();
  physicsWorld.solver.iterations = 18;
  physicsWorld.allowSleep = true;

  // Floor (horizontal plane, normal pointing up)
  const floorBody = new CANNON.Body({ mass: 0 });
  floorBody.addShape(new CANNON.Plane());
  floorBody.quaternion.setFromAxisAngle(new CANNON.Vec3(1, 0, 0), -Math.PI / 2);
  physicsWorld.addBody(floorBody);

  // Back wall (stops the character flying through the back wall)
  // CANNON.Plane default normal = +Z; placed at z = -ROOM_HALF it blocks -Z travel.
  const backWall = new CANNON.Body({ mass: 0 });
  backWall.addShape(new CANNON.Plane());
  backWall.position.set(0, 0, -ROOM_HALF);
  physicsWorld.addBody(backWall);

  // Left wall — rotate so normal points +X (blocks objects going below x = -ROOM_HALF)
  const leftWall = new CANNON.Body({ mass: 0 });
  leftWall.addShape(new CANNON.Plane());
  leftWall.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), Math.PI / 2);
  leftWall.position.set(-ROOM_HALF, 0, 0);
  physicsWorld.addBody(leftWall);

  // Right wall — rotate so normal points -X
  const rightWall = new CANNON.Body({ mass: 0 });
  rightWall.addShape(new CANNON.Plane());
  rightWall.quaternion.setFromAxisAngle(new CANNON.Vec3(0, 1, 0), -Math.PI / 2);
  rightWall.position.set(ROOM_HALF, 0, 0);
  physicsWorld.addBody(rightWall);
}


// ================================================================
// 4.  RAGDOLL
// ================================================================

/**
 * Anatomy measurements (all in metres).
 * These define every part's standing-pose centre position AND are
 * used to derive constraint pivot offsets so joints are already
 * satisfied when the character is first created.
 *
 * Layout (y = 0 is the floor):
 *   Head centre          y = 1.58
 *   Neck joint           y = 1.40
 *   Torso centre         y = 1.025
 *   Hip joint            y = 0.75
 *   Thigh centre         y = 0.55
 *   Knee joint           y = 0.35
 *   Shin centre          y = 0.175   (shin bottom = floor at y = 0)
 *   Shoulder joint       y = 1.25,   x = ±0.28
 *   Upper-arm centre     y = 1.11,   x = ±0.28
 *   Elbow joint          y = 0.97,   x = ±0.28
 *   Forearm centre       y = 0.85,   x = ±0.28
 */
const ANAT = {
  // Starting X position of the character (world)
  cx: 0,
  cz: -0.5,

  head:      { r: 0.18 },
  torso:     { hw: 0.21, hh: 0.275, hd: 0.11 },  // half-extents
  upperArm:  { hw: 0.06, hh: 0.14,  hd: 0.06 },
  foreArm:   { hw: 0.05, hh: 0.12,  hd: 0.05 },
  thigh:     { hw: 0.07, hh: 0.20,  hd: 0.07 },
  shin:      { hw: 0.055, hh: 0.175, hd: 0.055 },
};

/**
 * Create a complete standing-pose character.
 *
 * All Cannon bodies start as STATIC (mass = 0) so the figure holds
 * its pose without physics.  When the player slaps, `activateRagdoll()`
 * switches every body to DYNAMIC and creates the joint constraints.
 *
 * @param {THREE.Texture|null} faceTex - Cropped face texture for the head.
 * @returns {object} Character descriptor consumed by the rest of the game.
 */
function createCharacter(faceTex) {
  const parts = [];
  const { cx, cz } = ANAT;

  // ---- Helper: create one body+mesh pair -----------------------
  function makePart(name, geo, mat, pos, mass) {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);

    // Determine Cannon shape from Three geometry type
    let shape;
    if (geo.type === 'SphereGeometry' || geo.type === 'SphereBufferGeometry') {
      shape = new CANNON.Sphere(ANAT.head.r);
    } else if (geo.type === 'BoxGeometry' || geo.type === 'BoxBufferGeometry') {
      const p = geo.parameters;
      shape = new CANNON.Box(
        new CANNON.Vec3(p.width / 2, p.height / 2, p.depth / 2)
      );
    } else {
      throw new Error('[SlapSim] makePart: unsupported geometry type "' + geo.type + '"');
    }

    const body = new CANNON.Body({ mass: 0, linearDamping: 0.04, angularDamping: 0.08 });
    body.addShape(shape);
    body.position.set(pos.x, pos.y, pos.z);
    body.type = CANNON.Body.STATIC;
    body.allowSleep = true;
    physicsWorld.addBody(body);

    parts.push({ name, mesh, body, mass });
    return { mesh, body };
  }

  // ---- Materials -----------------------------------------------
  const skinMat  = new THREE.MeshStandardMaterial({ color: 0xffe0bd, roughness: 0.75 });
  const shirtMat = new THREE.MeshStandardMaterial({ color: 0x2255dd, roughness: 0.6  });
  const pantsMat = new THREE.MeshStandardMaterial({ color: 0x223300, roughness: 0.8  });
  const shoeMat  = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9  });

  // Face texture on the head sphere; fall back to skin colour
  const headMat = faceTex
    ? new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.7 })
    : new THREE.MeshStandardMaterial({ color: 0xffe0bd, roughness: 0.7 });

  const a = ANAT;

  // ---- HEAD ---------------------------------------------------
  const { body: headBody } = makePart(
    'head',
    new THREE.SphereGeometry(a.head.r, 18, 18),
    headMat,
    { x: cx, y: 1.58, z: cz },
    4
  );

  // ---- TORSO --------------------------------------------------
  const { body: torsoBody } = makePart(
    'torso',
    new THREE.BoxGeometry(a.torso.hw * 2, a.torso.hh * 2, a.torso.hd * 2),
    shirtMat,
    { x: cx, y: 1.025, z: cz },
    10
  );

  // ---- LEFT UPPER ARM -----------------------------------------
  const { body: luaBody } = makePart(
    'leftUpperArm',
    new THREE.BoxGeometry(a.upperArm.hw * 2, a.upperArm.hh * 2, a.upperArm.hd * 2),
    shirtMat,
    { x: cx - 0.28, y: 1.11, z: cz },
    2
  );

  // ---- RIGHT UPPER ARM ----------------------------------------
  const { body: ruaBody } = makePart(
    'rightUpperArm',
    new THREE.BoxGeometry(a.upperArm.hw * 2, a.upperArm.hh * 2, a.upperArm.hd * 2),
    shirtMat,
    { x: cx + 0.28, y: 1.11, z: cz },
    2
  );

  // ---- LEFT FOREARM -------------------------------------------
  const { body: lfaBody } = makePart(
    'leftForeArm',
    new THREE.BoxGeometry(a.foreArm.hw * 2, a.foreArm.hh * 2, a.foreArm.hd * 2),
    skinMat,
    { x: cx - 0.28, y: 0.85, z: cz },
    1.5
  );

  // ---- RIGHT FOREARM ------------------------------------------
  const { body: rfaBody } = makePart(
    'rightForeArm',
    new THREE.BoxGeometry(a.foreArm.hw * 2, a.foreArm.hh * 2, a.foreArm.hd * 2),
    skinMat,
    { x: cx + 0.28, y: 0.85, z: cz },
    1.5
  );

  // ---- LEFT THIGH ---------------------------------------------
  const { body: lthBody } = makePart(
    'leftThigh',
    new THREE.BoxGeometry(a.thigh.hw * 2, a.thigh.hh * 2, a.thigh.hd * 2),
    pantsMat,
    { x: cx - 0.12, y: 0.55, z: cz },
    4
  );

  // ---- RIGHT THIGH --------------------------------------------
  const { body: rthBody } = makePart(
    'rightThigh',
    new THREE.BoxGeometry(a.thigh.hw * 2, a.thigh.hh * 2, a.thigh.hd * 2),
    pantsMat,
    { x: cx + 0.12, y: 0.55, z: cz },
    4
  );

  // ---- LEFT SHIN ----------------------------------------------
  const { body: lshBody } = makePart(
    'leftShin',
    new THREE.BoxGeometry(a.shin.hw * 2, a.shin.hh * 2, a.shin.hd * 2),
    shoeMat,
    { x: cx - 0.12, y: 0.175, z: cz },
    3
  );

  // ---- RIGHT SHIN ---------------------------------------------
  const { body: rshBody } = makePart(
    'rightShin',
    new THREE.BoxGeometry(a.shin.hw * 2, a.shin.hh * 2, a.shin.hd * 2),
    shoeMat,
    { x: cx + 0.12, y: 0.175, z: cz },
    3
  );

  // ---- NECK (visual connector mesh, no physics body) ----------
  const neckMesh = new THREE.Mesh(
    new THREE.CylinderGeometry(0.055, 0.065, 0.18, 8),
    skinMat
  );
  neckMesh.castShadow = true;
  scene.add(neckMesh);

  return {
    parts,
    neckMesh,
    constraints: [],
    headBody,
    torsoBody,
    luaBody, ruaBody,
    lfaBody, rfaBody,
    lthBody, rthBody,
    lshBody, rshBody,
    isPhysicsOn: false,
  };
}

/**
 * Switch all ragdoll bodies from STATIC → DYNAMIC and wire up
 * point-to-point joint constraints.  Called once, when the player
 * lands their first slap.
 *
 * Constraint pivot maths:
 *   worldPivot = bodyCenter + localOffset
 * Both sides of each joint must evaluate to the same world position.
 */
function activateRagdoll(char) {
  if (char.isPhysicsOn) return;
  char.isPhysicsOn = true;

  const { cx, cz } = ANAT;

  // Switch every part to dynamic with its intended mass
  char.parts.forEach(({ body, mass }) => {
    body.mass = mass;
    body.updateMassProperties();
    body.type = CANNON.Body.DYNAMIC;
    body.wakeUp();
    body.linearDamping  = 0.02;
    body.angularDamping = 0.05;
  });

  // Helper: create and register a PointToPoint constraint
  function joint(bodyA, pivA, bodyB, pivB) {
    const c = new CANNON.PointToPointConstraint(bodyA, pivA, bodyB, pivB);
    physicsWorld.addConstraint(c);
    char.constraints.push(c);
  }

  const V = (x, y, z) => new CANNON.Vec3(x, y, z);

  // Neck joint — world y = 1.40
  // head centre 1.58  → local offset (0, -0.18, 0)
  // torso centre 1.025 → local offset (0, +0.375, 0)
  joint(char.headBody,  V(0, -0.18, 0),  char.torsoBody, V(0, 0.375, 0));

  // Shoulder joints — world y = 1.25, x = ±0.28
  // torso centre (0, 1.025) → local offset (±0.28, 0.225, 0)
  // upper-arm centre (±0.28, 1.11) → local offset (0, 0.14, 0)
  joint(char.torsoBody, V(-0.28, 0.225, 0), char.luaBody, V(0,  0.14, 0));
  joint(char.torsoBody, V( 0.28, 0.225, 0), char.ruaBody, V(0,  0.14, 0));

  // Elbow joints — world y = 0.97, x = ±0.28
  // upper-arm centre (±0.28, 1.11) → local offset (0, -0.14, 0)
  // forearm centre  (±0.28, 0.85) → local offset (0, 0.12, 0)
  joint(char.luaBody, V(0, -0.14, 0), char.lfaBody, V(0, 0.12, 0));
  joint(char.ruaBody, V(0, -0.14, 0), char.rfaBody, V(0, 0.12, 0));

  // Hip joints — world y = 0.75, x = ±0.12
  // torso centre (0, 1.025) → local offset (±0.12, -0.275, 0)
  // thigh centre (±0.12, 0.55) → local offset (0, 0.20, 0)
  joint(char.torsoBody, V(-0.12, -0.275, 0), char.lthBody, V(0, 0.20, 0));
  joint(char.torsoBody, V( 0.12, -0.275, 0), char.rthBody, V(0, 0.20, 0));

  // Knee joints — world y = 0.35, x = ±0.12
  // thigh centre (±0.12, 0.55) → local offset (0, -0.20, 0)
  // shin centre  (±0.12, 0.175) → local offset (0, 0.175, 0)
  joint(char.lthBody, V(0, -0.20, 0), char.lshBody, V(0, 0.175, 0));
  joint(char.rthBody, V(0, -0.20, 0), char.rshBody, V(0, 0.175, 0));
}

/** Remove character meshes from the scene and bodies from the physics world. */
function destroyCharacter(char) {
  if (!char) return;
  char.constraints.forEach(c => physicsWorld.removeConstraint(c));
  char.parts.forEach(({ mesh, body }) => {
    scene.remove(mesh);
    mesh.geometry.dispose();
    physicsWorld.removeBody(body);
  });
  scene.remove(char.neckMesh);
  char.neckMesh.geometry.dispose();
}

/**
 * Each frame: copy the Cannon body positions/rotations to the Three.js meshes.
 * Also positions the visual-only neck mesh between head and torso.
 */
function syncCharacterToPhysics(char) {
  if (!char) return;
  char.parts.forEach(({ mesh, body }) => {
    mesh.position.copy(body.position);
    mesh.quaternion.copy(body.quaternion);
  });

  // Neck: interpolate between head bottom and torso top
  const h = char.headBody.position;
  const t = char.torsoBody.position;
  char.neckMesh.position.set(
    (h.x + t.x) / 2,
    h.y - 0.22,
    (h.z + t.z) / 2
  );
}

/**
 * Reset the character to its standing pose (move all bodies back to
 * their original positions and switch back to STATIC so it holds the pose).
 */
function resetCharacterPose(char) {
  if (!char) return;

  // Remove constraints from physics world
  char.constraints.forEach(c => physicsWorld.removeConstraint(c));
  char.constraints = [];
  char.isPhysicsOn = false;

  const { cx, cz } = ANAT;

  // Original standing positions for each named part
  const poses = {
    head:         { x: cx,        y: 1.58,  z: cz },
    torso:        { x: cx,        y: 1.025, z: cz },
    leftUpperArm: { x: cx - 0.28, y: 1.11,  z: cz },
    rightUpperArm:{ x: cx + 0.28, y: 1.11,  z: cz },
    leftForeArm:  { x: cx - 0.28, y: 0.85,  z: cz },
    rightForeArm: { x: cx + 0.28, y: 0.85,  z: cz },
    leftThigh:    { x: cx - 0.12, y: 0.55,  z: cz },
    rightThigh:   { x: cx + 0.12, y: 0.55,  z: cz },
    leftShin:     { x: cx - 0.12, y: 0.175, z: cz },
    rightShin:    { x: cx + 0.12, y: 0.175, z: cz },
  };

  char.parts.forEach(({ name, mesh, body }) => {
    const p = poses[name];
    if (!p) return;

    // Reset Cannon body
    body.mass = 0;
    body.updateMassProperties();
    body.type = CANNON.Body.STATIC;
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.position.set(p.x, p.y, p.z);
    body.quaternion.set(0, 0, 0, 1);
    body.force.set(0, 0, 0);
    body.torque.set(0, 0, 0);

    // Mirror to Three.js mesh
    mesh.position.set(p.x, p.y, p.z);
    mesh.quaternion.set(0, 0, 0, 1);
  });
}


// ================================================================
// 5.  FACE DETECTION & TEXTURE CREATION
// ================================================================

/** Load the lightweight TinyFaceDetector model weights. */
async function loadFaceModels() {
  await faceapi.nets.tinyFaceDetector.loadFromUri(MODELS_URL);
}

/**
 * Detect the largest face in `imgElement`, crop it with padding, apply a
 * circular mask so the texture sits naturally on the spherical head, and
 * return a Three.js CanvasTexture.
 *
 * Falls back to using the entire image when no face is detected.
 *
 * @param {HTMLImageElement} imgElement
 * @returns {Promise<THREE.CanvasTexture>}
 */
async function detectAndCropFace(imgElement) {
  const opts = new faceapi.TinyFaceDetectorOptions({
    inputSize:       224,
    scoreThreshold:  0.3,
  });

  const detection = await faceapi.detectSingleFace(imgElement, opts);

  const SIZE = 256;
  const canvas = document.createElement('canvas');
  canvas.width  = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');

  if (detection) {
    // Crop with 35% padding on each side so the full face fits comfortably
    const { x, y, width, height } = detection.box;
    const pad = Math.max(width, height) * FACE_CROP_PADDING_RATIO;
    const sx  = Math.max(0, x - pad);
    const sy  = Math.max(0, y - pad);
    const sw  = Math.min(imgElement.naturalWidth  - sx, width  + pad * 2);
    const sh  = Math.min(imgElement.naturalHeight - sy, height + pad * 2);
    ctx.drawImage(imgElement, sx, sy, sw, sh, 0, 0, SIZE, SIZE);
  } else {
    // No face found — use the whole image
    ctx.drawImage(imgElement, 0, 0, SIZE, SIZE);
  }

  // Apply circular mask so the edges of the face texture are transparent
  // (this prevents ugly rectangular seams on the head sphere)
  ctx.globalCompositeOperation = 'destination-in';
  ctx.beginPath();
  ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  return new THREE.CanvasTexture(canvas);
}


// ================================================================
// 6.  SLAP INPUT  (mouse + touch)
// ================================================================

/** Attach pointer/touch listeners to the canvas. */
function initSlapInput() {
  const canvas = document.getElementById('game-canvas');

  canvas.addEventListener('mousedown',  onPointerDown);
  canvas.addEventListener('mousemove',  onPointerMove);
  canvas.addEventListener('mouseup',    onPointerUp);
  canvas.addEventListener('mouseleave', onPointerCancel);

  canvas.addEventListener('touchstart', e => { e.preventDefault(); onPointerDown(e.touches[0]); },        { passive: false });
  canvas.addEventListener('touchmove',  e => { e.preventDefault(); onPointerMove(e.touches[0]); },        { passive: false });
  canvas.addEventListener('touchend',   e => { e.preventDefault(); onPointerUp(e.changedTouches[0]); },   { passive: false });
  canvas.addEventListener('touchcancel',e => { e.preventDefault(); onPointerCancel(); },                  { passive: false });
}

function onPointerDown(e) {
  if (gameState !== STATE.READY) return;
  pointerIsDown = true;
  swipeStart = { x: e.clientX, y: e.clientY, time: performance.now() };
  document.body.classList.add('swiping');
}

function onPointerMove(e) {
  // Nothing to track here beyond what onPointerUp uses; kept for future enhancements.
}

function onPointerUp(e) {
  if (!pointerIsDown || gameState !== STATE.READY) {
    onPointerCancel();
    return;
  }
  onPointerCancel();

  const dx   = e.clientX - swipeStart.x;
  const dy   = e.clientY - swipeStart.y;
  const dist = Math.hypot(dx, dy);
  const dt   = Math.max(8, performance.now() - swipeStart.time) / 1000; // seconds

  // Ignore tiny accidental movements
  if (dist < 22) return;

  // Swipe speed in px/s → physics force magnitude (capped)
  const speed    = dist / dt;
  const forceMag = Math.min(BASE_FORCE + speed * FORCE_SPEED_MULTIPLIER, MAX_FORCE);

  // Normalised swipe direction, converting screen-Y (inverted) to world-Y
  const dirX = dx / dist;
  const dirY = -(dy / dist); // screen down = negative world-Y

  applySlap(dirX, dirY, forceMag);
}

function onPointerCancel() {
  pointerIsDown = false;
  document.body.classList.remove('swiping');
}

/**
 * Convert the player's swipe gesture into a physics impulse on the ragdoll head.
 *
 * @param {number} dirX - Normalised horizontal swipe component.
 * @param {number} dirY - Normalised vertical swipe component (world space).
 * @param {number} force - Impulse magnitude (N·s).
 */
function applySlap(dirX, dirY, force) {
  if (!character) return;

  // Activate physics if this is the first slap
  activateRagdoll(character);

  // Record origin for distance tracking
  const hp = character.headBody.position;
  slapOrigin.set(hp.x, 0, hp.z);
  maxFlyDist = 0;
  gameState  = STATE.FLYING;
  setHintText('');

  // Impulse on head: horizontal swipe + upward toss + push away from camera
  const impulse = new CANNON.Vec3(
    dirX * force,
    Math.abs(dirY) * force * 0.6 + force * 0.35, // always some upward force
    -force * 0.45                                 // always push away from camera
  );
  character.headBody.applyImpulse(impulse, character.headBody.position);

  // Lighter impulse on the torso so the whole body follows
  const bodyImpulse = new CANNON.Vec3(
    dirX * force * 0.45,
    force * 0.15,
    -force * 0.2
  );
  character.torsoBody.applyImpulse(bodyImpulse, character.torsoBody.position);
}


// ================================================================
// 7.  SCORE SYSTEM
// ================================================================

/**
 * Called every frame while the character is in the FLYING state.
 * Tracks the maximum horizontal distance and detects landing.
 */
function tickScore() {
  if (!character || gameState !== STATE.FLYING) return;

  const hp   = character.headBody.position;
  const dist = Math.hypot(hp.x - slapOrigin.x, hp.z - slapOrigin.z);
  if (dist > maxFlyDist) {
    maxFlyDist = dist;
    setDistanceDisplay(maxFlyDist);
  }

  // Detect landing: head is close to the floor and moving slowly
  const vel   = character.headBody.velocity;
  const speed = Math.hypot(vel.x, vel.y, vel.z);
  if (hp.y < LANDING_HEIGHT_THRESHOLD && speed < LANDING_SPEED_THRESHOLD && maxFlyDist > 0) {
    onCharacterLanded();
  }
}

/** Trigger the end-of-slap UI after the character comes to rest. */
function onCharacterLanded() {
  gameState = STATE.READY;
  showCombo(maxFlyDist);
  setHintText('🖱️ Drag to SLAP again!');
}

/** Pick and display a combo message based on distance flown. */
function showCombo(dist) {
  // Find the highest-threshold combo that the distance qualifies for
  let chosen = COMBOS[0];
  for (const c of COMBOS) {
    if (dist >= c.min) chosen = c;
  }

  const el  = document.getElementById('combo-text');
  el.textContent  = chosen.text;
  el.style.color  = chosen.color;
  el.style.textShadow = `0 0 18px ${chosen.color}, 3px 3px 0 #000`;

  // Pop in, then fade out
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.classList.remove('show'), 2800);
}

function setDistanceDisplay(d) {
  document.getElementById('dist-value').textContent = d.toFixed(1) + ' m';
}


// ================================================================
// 8.  UI HELPERS
// ================================================================

function showScreen(id) {
  document.getElementById('start-screen').style.display  = 'none';
  document.getElementById('loading-screen').style.display = 'none';
  document.getElementById('game-ui').style.display       = 'none';

  if (id === 'start')   document.getElementById('start-screen').style.display   = 'flex';
  if (id === 'loading') document.getElementById('loading-screen').style.display  = 'flex';
  if (id === 'game')    document.getElementById('game-ui').style.display         = 'block';
}

function setLoadingText(msg) {
  document.getElementById('loading-text').textContent = msg;
}

function setHintText(msg) {
  const el = document.getElementById('hint-text');
  el.textContent   = msg;
  el.style.display = msg ? 'block' : 'none';
}


// ================================================================
// 9.  ANIMATION LOOP
// ================================================================

function animate(timestamp) {
  requestAnimationFrame(animate);

  // Advance physics simulation
  if (lastTimestamp !== null) {
    const elapsed = (timestamp - lastTimestamp) / 1000;
    physicsWorld.step(FIXED_DT, elapsed, MAX_STEPS);
  }
  lastTimestamp = timestamp;

  // Sync Three.js meshes to physics state
  syncCharacterToPhysics(character);

  // Track score while character is flying
  tickScore();

  renderer.render(scene, camera);
}


// ================================================================
// 10. BOOTSTRAP — IMAGE UPLOAD & EVENT WIRING
// ================================================================

/**
 * Full pipeline triggered when the player picks an image:
 *   load models → decode image → detect face → build character → start game
 */
async function handleImageUpload(file) {
  showScreen('loading');
  gameState = STATE.LOADING;

  try {
    // 1. Load face-api.js TinyFaceDetector (no-op on subsequent calls)
    setLoadingText('Loading face detection models…');
    await loadFaceModels();

    // 2. Decode the uploaded file into an HTMLImageElement
    setLoadingText('Reading image…');
    const objectURL = URL.createObjectURL(file);
    const img = await loadImage(objectURL);
    URL.revokeObjectURL(objectURL);

    // 3. Detect face and build a canvas texture
    setLoadingText('Detecting face…');
    faceTexture = await detectAndCropFace(img);

    // 4. Tear down any existing character
    if (character) {
      destroyCharacter(character);
      character = null;
    }

    setLoadingText('Building ragdoll…');
    await sleep(250); // brief pause for UX smoothness

    // 5. Build the new standing character
    character = createCharacter(faceTexture);

    // 6. Reset HUD and enter the game
    setDistanceDisplay(0);
    showScreen('game');
    setHintText('🖱️ Drag to SLAP!');
    gameState = STATE.READY;

  } catch (err) {
    console.error('[SlapSim] Image processing error:', err);
    setLoadingText('Oops! ' + err.message + ' — Please try again.');
    await sleep(2500);
    showScreen('start');
    gameState = STATE.INTRO;
  }
}

/** Decode a Blob URL into an HTMLImageElement. */
function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('Could not read image file.'));
    img.src = src;
  });
}

/** Promise-based sleep helper. */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Wire up all DOM event listeners. */
function setupEvents() {

  // File picker — triggered by the hidden <input type="file">
  document.getElementById('face-upload').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = ''; // allow re-uploading the same file
    if (file) await handleImageUpload(file);
  });

  // Restart button — keep current face, reset ragdoll pose
  document.getElementById('restart-btn').addEventListener('click', () => {
    if (!character) return;
    resetCharacterPose(character);
    setDistanceDisplay(0);
    maxFlyDist = 0;
    gameState  = STATE.READY;
    setHintText('🖱️ Drag to SLAP!');
  });

  // New face button — return to start screen
  document.getElementById('new-face-btn').addEventListener('click', () => {
    if (character) {
      destroyCharacter(character);
      character = null;
    }
    faceTexture = null;
    gameState   = STATE.INTRO;
    showScreen('start');
  });
}

/** Entry point: initialise everything and start the render loop. */
async function main() {
  initRenderer();
  initLights();
  initRoom();
  initPhysics();
  initSlapInput();
  setupEvents();

  showScreen('start');
  requestAnimationFrame(animate);
}

main();

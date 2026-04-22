// ----------- MODULES ------------------------------------------------------------
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadModel } from './components/modelLoader.js';
import { OrbitControls } from './components/orbitControls.js';
import { createEnvironment } from './components/createEnvironment.js';
import { createLoadingManager } from './components/loadingScreen.js';
import {
    createPhysicsWorld,
    makeLampBody,
    makeMapBody,
    syncMeshToBody,
    GROUPS,
} from './components/physics.js';

// ------------------------------ CAMERA --------------------------------------------------------
var camera;
const CAM_INITIAL_POS = { x: 0, y: 0, z: 0 }
const CAM_OFFSET = { x: 5, y: 2.5, z: 0 }; // Camera offset from the car in local space
const CAM_LAG = 0.1; // Smoothing factor for camera movement
const CAM_FOV = 45;
const CAM_NEAR = 0.1;
const CAM_FAR = 1000;

// ----------------------------- Renderer ------------------------------------------------------
var renderer;
const RND_ENABLE_SHADOWS = true;

// ----------------------------- Environment ---------------------------------------------------

const hdrPath = "hdr/sky.hdr";
const texName = "asphalt_02";
const texturePaths = {
    diffuseMap: `textures/floor/${texName}/${texName}_diff.jpg`,
    aoMap: `textures/floor/${texName}/${texName}_ao.jpg`,
    armMap: `textures/floor/${texName}/${texName}_arm.jpg`,
    normalMap: `textures/floor/${texName}/${texName}_nor.jpg`,
    displacementMap: `textures/floor/${texName}/${texName}_disp.jpg`,
    roughnessMap: `textures/floor/${texName}/${texName}_rough.jpg`,
};

// ----------------------------- AUDIO FEATURE (ILL ADD LATER) ---------------------------------------------------
// const listener = new THREE.AudioListener();
// camera.add(listener);

// const positionalSound = new THREE.PositionalAudio(listener);

// const audioLoader = new THREE.AudioLoader();
// audioLoader.load('path/to/sound.mp3', (buffer) => {
//     sound.setBuffer(buffer);
//     sound.setLoop(true);
//     sound.setVolume(0.5);
//     sound.play();
// });

// ---------------------------- ENVIROMENT & GAME SETTINGS --------------------------------------------------
const ENV_OPTIONS = {
    textureRepeat: 1,
    textureRotations: 'aligned',
};

// ----------------------------- CAR -------------------------------------------------
var car;

// WHEEL SYSTEM NOTES

//   wheelPivots  – outer Group, positioned on the car, handles steering (rotation.z)
//   wheelMeshes  – inner mesh/clone, handles spin (rotation.y)

var wheelPivots = [];
var wheelMeshes = [];

var carVelocityX = 0;
var carVelocityZ = 0;

// --- GRADUAL ACCELERATION ---
var carSpeed = 0;
const MAX_SPEED = 0.25;
const BOOST_SPEED = 0.4;
const REVERSE_SPEED = 0.06;
const ACCELERATION = 0.002;
const BOOST_ACCEL = 0.004;
const DECELERATION = 0.001;
// ----------------------------

// ------------------------- CRASH DETECTION AND DEACCELERATION --------------------------------------

const CRASH_THRESHOLD = 0.05;
const CRASH_VEL_DIFF = 2.0;

var _intendedVelX = 0;
var _intendedVelZ = 0;

const CAR_BODY_HEIGHT = 2;
const CAR_WHEEL_RADIUS = 0.15;

const CAR_VISUAL_Y = -0.5 + CAR_BODY_HEIGHT / 2 + CAR_WHEEL_RADIUS;
const CAR_WHEEL_ROTATION_FRONT = Math.PI / 6;

// -------------------- GRADUAL STEERING -------------------------------
var currentSteeringAngle = 0;
const MAX_STEER_ANGLE = Math.PI / 6;
const STEER_SPEED = 0.05;
const STEER_RETURN_SPEED = 0.08;


// ------------------------------ LIGHTS ---------------------------
const AMBIENT_LIGHT_COLOR = 0x404040;

const LIGHTS_DATA = [
    { color: 0xffffff, intensity: 5.5, distance: 10000, position: [-2.5, 0.75, -2.5] }
];

const SHADOWS_DATA = { mapSize: 2048, near: 0.5, far: 500 };

var scene;

var orbitControls;

var keys = {};

var useOrbitControls = true;

// ------------------------------ PHYSICS ------------------------------------------------------
var physicsWorld;
var carPhysicsBody;

var lampPhysicsBodies = [];

// ------------------------------ PHYSICS BOXES ----------------------------------------------
const CAR_BOX_HX = 1.75;
const CAR_BOX_HY = 0.25;
const CAR_BOX_HZ = 0.8;

const LAMP_HALF_WIDTH = 0.12;
const LAMP_HALF_HEIGHT = 1.5;

/**
 * Converts expensive MeshPhysicalMaterial to MeshStandardMaterial 
 * to improve performance.
 */
function optimizeMaterials(root) {
    root.traverse((node) => {
        if (node.isMesh && node.material) {
            // If it's a Physical material, downgrade it to Standard
            if (node.material.isMeshPhysicalMaterial) {
                const prevMaterial = node.material;
                const newMaterial = new THREE.MeshStandardMaterial();
                THREE.MeshStandardMaterial.prototype.copy.call(newMaterial, prevMaterial);

                // Physical-only properties to clean up/ignore
                newMaterial.clearcoat = 0;
                newMaterial.transmission = 0;
                newMaterial.ior = 1.5;
                newMaterial.thickness = 0;

                node.material = newMaterial;
                prevMaterial.dispose();
            }
        }
    });
}

const timer = new THREE.Timer();

function initPhysics() {
    const { world } = createPhysicsWorld({ gravity: -9.82, iterations: 10 });
    physicsWorld = world;

    carPhysicsBody = new CANNON.Body({
        mass: 150,
        linearDamping: 0.0,
        angularDamping: 1.0,
        collisionFilterGroup: GROUPS.CAR,
        collisionFilterMask: GROUPS.GROUND | GROUPS.OBJECT | GROUPS.MAP,
    });
    carPhysicsBody.addShape(new CANNON.Sphere(0.5));
    carPhysicsBody.position.set(0, 2, 0);
    carPhysicsBody.allowSleep = false;
    physicsWorld.addBody(carPhysicsBody);
}

// --------------------- makeMapBody --------------------------------------------------------

const MAP_SCALE = 50;

const MAP_OFFSET = {
    x: 0,
    y: -200,
    z: 0,
};

var mapBody = null;
var mapVisual = null;

function findGroundY(x, z) {
    const raycaster = new THREE.Raycaster();
    raycaster.set(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0));

    if (!mapVisual) return 2; // Fallback

    const intersects = raycaster.intersectObject(mapVisual, true);
    if (intersects.length > 0) {
        return intersects[0].point.y + 0.5;
    }
    return 2;
}

function respawnCar() {
    if (!car || !carPhysicsBody) return;

    // Pick a spot (could be randomized or fixed)
    const spawnX = 0;
    const spawnZ = 0;
    const spawnY = findGroundY(spawnX, spawnZ);

    carPhysicsBody.position.set(spawnX, spawnY, spawnZ);
    carPhysicsBody.velocity.set(0, 0, 0);
    carPhysicsBody.angularVelocity.set(0, 0, 0);
    carPhysicsBody.quaternion.set(0, 0, 0, 1);

    car.position.set(spawnX, spawnY, spawnZ);
    car.rotation.set(0, 0, 0);

    carSpeed = 0;
    console.log(`Car respawned at: ${spawnX}, ${spawnY}, ${spawnZ}`);
}

async function spawnMap(scene, manager) {
    const loader = new GLTFLoader(manager);

    // 1. Visual map — loaded into the scene, no physics
    await new Promise((resolve) => {
        loader.load('models/map.glb', (gltf) => {
            const mapScene = gltf.scene;

            mapScene.scale.setScalar(MAP_SCALE);
            mapScene.position.set(MAP_OFFSET.x, MAP_OFFSET.y, MAP_OFFSET.z);

            mapScene.traverse((node) => {
                if (node.isMesh) {
                    node.castShadow = true;
                    node.receiveShadow = true;
                }
            });

            scene.add(mapScene);
            optimizeMaterials(mapScene);
            mapVisual = mapScene;
            resolve();
        });
    });

    // ... after visual map is loaded, we can respawn the car correctly
    respawnCar();

    // 2. Collision proxy — same transform as the visual map, never added to scene
    await new Promise((resolve) => {
        loader.load('models/collisions.glb', (gltf) => {
            const collisionScene = gltf.scene;

            // Must match the visual map exactly so physics lines up
            collisionScene.scale.setScalar(MAP_SCALE);
            collisionScene.position.set(MAP_OFFSET.x, MAP_OFFSET.y, MAP_OFFSET.z);
            collisionScene.updateMatrixWorld(true);

            //mapBody = makeMapBody(physicsWorld, collisionScene);

            if (!mapBody) {
                console.warn('[spawnMap] collisions.glb produced no physics body — check the mesh export');
            } else {
                console.log('[spawnMap] Collision body built from collisions.glb');
            }

            resolve();
        }, undefined, (err) => {
            console.error('[spawnMap] Failed to load collisions.glb:', err);
            resolve(); // don't block startup if the file is missing
        });
    });
}

// ----------------------- STREET LAMP POSTS -------------------------------------------------
const STREET_LAMP_COUNT = 5;
const STREET_LAMP_SPACING = 15.0;
const STREET_LAMP_X = 1.5;
const STREET_LAMP_Z_START = -2.0;

async function spawnStreetLamps(scene, manager) {
    const loader = new GLTFLoader(manager);

    for (let i = 0; i < STREET_LAMP_COUNT; i++) {
        const posZ = STREET_LAMP_Z_START + i * STREET_LAMP_SPACING;
        const posX = STREET_LAMP_X;
        const posY = findGroundY(posX, posZ);

        const { model: lamp } = await loadModel(
            loader,
            'models/street_lamp.glb',
            3,
            new THREE.Vector3(posX, posY, posZ),
            scene,
            null,
            {
                groundAlign: false,
                baseRotation: { x: 0, y: 0, z: 0 },
            }
        );

        lamp.traverse((node) => {
            if (node.isMesh) {
                node.castShadow = true;
                node.receiveShadow = true;
            }
        });
        optimizeMaterials(lamp);

        const lampBody = makeLampBody(
            physicsWorld,
            posX, posY, posZ,
            LAMP_HALF_WIDTH, LAMP_HALF_HEIGHT,
            0,
        );

        const meshCentreOffset = LAMP_HALF_HEIGHT;

        lampPhysicsBodies.push({ body: lampBody, mesh: lamp, meshCentreOffset });

        // ------------ LIGHT FOR EACH LAMP POST ----------------------
        const lampLight = new THREE.PointLight(0xffddaa, 0.7, 6, 2);
        lampLight.position.set(posX, posY + 1.8, posZ);
        lampLight.castShadow = false;
        scene.add(lampLight);
    }
}


function drawCar(scene, manager) {
    car = new THREE.Group();
    const loader = new GLTFLoader(manager);

    // ------------ LOAD CAR BODY ----------------------
    loader.load('models/car.glb', (gltf) => {
        const carModel = gltf.scene;
        carModel.scale.set(0.01, 0.01, 0.01);
        carModel.rotation.y = Math.PI;
        carModel.position.y = 0;
        carModel.traverse((node) => { if (node.isMesh) node.castShadow = true; });
        optimizeMaterials(carModel);
        car.add(carModel);
    });

    // --------------- LOAD WHEELS ----------------------------
    const rotationFix = new THREE.Quaternion();
    rotationFix.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));

    loader.load('models/wheel.glb', (gltf) => {
        const wheelTemplate = gltf.scene.children[0];
        wheelTemplate.scale.set(0.01, 0.01, 0.01);
        wheelTemplate.rotation.x = Math.PI;
        wheelTemplate.quaternion.multiply(rotationFix);

        const wheelPositions = [
            { x: 0.78, y: 0.2, z: 0.5 }, // Front Right
            { x: 0.78, y: 0.2, z: -0.5 }, // Front Left
            { x: -1, y: 0.2, z: 0.5 }, // Rear  Right
            { x: -1, y: 0.2, z: -0.5 }, // Rear  Left
        ];

        wheelPivots = [];
        wheelMeshes = [];

        for (let i = 0; i < 4; i++) {
            const pivot = new THREE.Group();
            pivot.position.set(wheelPositions[i].x, wheelPositions[i].y, wheelPositions[i].z);

            const mesh = wheelTemplate.clone();
            mesh.castShadow = true;
            mesh.receiveShadow = false;
            mesh.position.set(0, 0, 0);

            pivot.add(mesh);
            car.add(pivot);

            wheelPivots.push(pivot);
            wheelMeshes.push(mesh);
        }
    });

    car.translateY(-0.5 + CAR_BODY_HEIGHT / 2 + CAR_WHEEL_RADIUS);
    scene.add(car);
}

// ----------------------- LIGHTS --------------------------------------------------------
function addLights(scene) {
    for (const LDATA of LIGHTS_DATA) {
        const light = new THREE.PointLight(LDATA.color, LDATA.intensity, LDATA.distance);
        light.position.set(...LDATA.position);
        light.castShadow = true;
        light.shadow.mapSize.width = SHADOWS_DATA.mapSize;
        light.shadow.mapSize.height = SHADOWS_DATA.mapSize;
        light.shadow.camera.near = SHADOWS_DATA.near;
        light.shadow.camera.far = SHADOWS_DATA.far;
        scene.add(light);
    }
    scene.add(new THREE.AmbientLight(AMBIENT_LIGHT_COLOR));
}

// ----------------------- SETUP & ANIMATE --------------------------------------------------------
async function setup() {
    const manager = createLoadingManager();

    camera = new THREE.PerspectiveCamera(CAM_FOV, window.innerWidth / window.innerHeight, CAM_NEAR, CAM_FAR);
    camera.position.set(CAM_INITIAL_POS.x, CAM_INITIAL_POS.y, CAM_INITIAL_POS.z);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(1);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    if (RND_ENABLE_SHADOWS) {
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = THREE.PCFShadowMap;
    }

    document.getElementById('app').appendChild(renderer.domElement);

    scene = new THREE.Scene();

    await createEnvironment(scene, hdrPath, {}, ENV_OPTIONS, null, manager);

    initPhysics();
    await spawnMap(scene, manager);
    spawnStreetLamps(scene, manager);
    drawCar(scene, manager);
    addLights(scene);

    window.addEventListener('resize', () => {
        const width = window.innerWidth;
        const height = window.innerHeight;

        camera.aspect = width / height;
        camera.updateProjectionMatrix();

        renderer.setSize(width, height);
    });

    window.addEventListener('keydown', (e) => {
        keys[e.code] = true;
        if (e.code === 'KeyC') {
            useOrbitControls = !useOrbitControls;
            console.log('Camera mode:', useOrbitControls ? 'Orbit Controls' : 'Third Person');
        }
        if (e.code === 'KeyR') {
            respawnCar();
        }
    });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });

    orbitControls = new OrbitControls(camera, renderer.domElement);
    orbitControls.enableDamping = true;
    orbitControls.dampingFactor = 0.05;
    orbitControls.target.set(0, 0, 0);

    animate();
}

// ----------------------- CAR CONTROL HELPERS --------------------------------------------------------

function setSteeringAngle(angle) {
    if (wheelPivots.length === 0) return;
    // Only steer the front two wheels (indices 0 & 1)
    wheelPivots[2].rotation.y = angle;
    wheelPivots[3].rotation.y = angle;
}

function updateWheelSpin() {
    if (wheelMeshes.length === 0) return;
    const spinSpeed = carSpeed * -4; // Proportional to current speed
    for (const mesh of wheelMeshes) {
        mesh.rotation.y += spinSpeed;
    }
}

// ------------------------ CAMERA FOLLOW ANGLE --------------------------------------------------------
function updateCameraFollow() {
    const offset = new THREE.Vector3(CAM_OFFSET.x, CAM_OFFSET.y, CAM_OFFSET.z);
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), car.rotation.y);

    const desired = new THREE.Vector3(
        car.position.x + offset.x,
        car.position.y + offset.y,
        car.position.z + offset.z
    );
    camera.position.lerp(desired, CAM_LAG);
    camera.lookAt(car.position.x, car.position.y + 0.5, car.position.z);
}

// ----------------------- ANIMATE --------------------------------------------------------
function animate() {

    const isBoosting = keys['ShiftLeft'] && keys['KeyW'];
    const pressingForward = keys['KeyW'];
    const pressingBackward = keys['KeyS'];

    // ---------------------- ACCELERATION & DECELERATION ------------------------------------------------------
    if (isBoosting) {
        carSpeed += BOOST_ACCEL;
        if (carSpeed > BOOST_SPEED) carSpeed = BOOST_SPEED;

    } else if (pressingForward) {
        if (carSpeed < 0) {
            carSpeed += DECELERATION * 2;
            if (carSpeed > 0) carSpeed = 0;
        } else {
            carSpeed += ACCELERATION;
            if (carSpeed > MAX_SPEED) carSpeed = MAX_SPEED;
        }

    } else if (pressingBackward) {
        if (carSpeed > 0) {
            carSpeed -= DECELERATION * 2;
            if (carSpeed < 0) carSpeed = 0;
        } else {
            carSpeed -= ACCELERATION;
            if (carSpeed < -REVERSE_SPEED) carSpeed = -REVERSE_SPEED;
        }

    } else {
        if (carSpeed > 0) { carSpeed -= DECELERATION; if (carSpeed < 0) carSpeed = 0; }
        else if (carSpeed < 0) { carSpeed += DECELERATION; if (carSpeed > 0) carSpeed = 0; }
    }

    // ------------------------- STEERING ------------------------------------------------------
    let targetSteeringAngle = 0;
    if (keys['KeyA']) targetSteeringAngle = MAX_STEER_ANGLE;
    if (keys['KeyD']) targetSteeringAngle = -MAX_STEER_ANGLE;

    const lerpRate = (targetSteeringAngle === 0) ? STEER_RETURN_SPEED : STEER_SPEED;
    currentSteeringAngle += (targetSteeringAngle - currentSteeringAngle) * lerpRate;
    currentSteeringAngle = Math.max(-MAX_STEER_ANGLE, Math.min(MAX_STEER_ANGLE, currentSteeringAngle));

    setSteeringAngle(currentSteeringAngle);

    if (Math.abs(carSpeed) > 0.0001) {
        const speedFactor = Math.min(Math.abs(carSpeed) / MAX_SPEED, 1.0);
        const highSpeedDamping = 1.0 - speedFactor * 0.8;
        const turnAmount = currentSteeringAngle * 0.18 * speedFactor * highSpeedDamping;
        car.rotation.y += (carSpeed >= 0) ? turnAmount : -turnAmount;
    }

    const carDirection = new THREE.Vector3();
    car.getWorldDirection(carDirection);

    carVelocityX = carDirection.x * carSpeed * 60;
    carVelocityZ = carDirection.z * carSpeed * 60;

    updateWheelSpin();

    _intendedVelX = carVelocityX;
    _intendedVelZ = carVelocityZ;

    carPhysicsBody.velocity.set(
        carVelocityX,
        carPhysicsBody.velocity.y,
        carVelocityZ,
    );

    carPhysicsBody.quaternion.set(
        car.quaternion.x, car.quaternion.y,
        car.quaternion.z, car.quaternion.w,
    );
    carPhysicsBody.angularVelocity.set(0, 0, 0);

    timer.update();
    const delta = timer.getDelta();
    physicsWorld.step(1 / 60, delta, 3);

    // ------------------------ CRASH DETECTION ------------------------------------------------------
    if (Math.abs(carSpeed) > CRASH_THRESHOLD) {
        const actualX = carPhysicsBody.velocity.x;
        const actualZ = carPhysicsBody.velocity.z;
        const diffX = _intendedVelX - actualX;
        const diffZ = _intendedVelZ - actualZ;
        const velDelta = Math.sqrt(diffX * diffX + diffZ * diffZ);

        if (velDelta > CRASH_VEL_DIFF) {
            carSpeed = 0;
        }
    }

    car.position.x = carPhysicsBody.position.x;
    car.position.z = carPhysicsBody.position.z;
    car.position.y = carPhysicsBody.position.y - CAR_BOX_HY + CAR_VISUAL_Y;

    for (const { body, mesh, meshCentreOffset } of lampPhysicsBodies) {
        syncMeshToBody(body, mesh, meshCentreOffset);
    }

    const dt = new Date();
    const secs = dt.getSeconds() + 60 * dt.getMinutes() + 3600 * dt.getHours();
    if (car.children.length > 0 && car.children[0].material) {
        car.children[0].material.color.setHSL(secs / 86400, 1, 0.5);
    }

    if (!useOrbitControls) {
        updateCameraFollow();
    } else {
        orbitControls.target.lerp(new THREE.Vector3(car.position.x, car.position.y + 0.5, car.position.z), 0.1);
        orbitControls.update();
    }

    requestAnimationFrame(animate);
    renderer.render(scene, camera);
}

setup();
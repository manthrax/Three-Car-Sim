// ----------- MODULES ------------------------------------------------------------
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadModel } from './components/modelLoader.js';
import { OrbitControls } from './components/orbitControls.js';
import { createEnvironment } from './components/createEnvironment.js';
import { createLoadingManager } from './components/loadingScreen.js';
import {
    createPhysicsWorld,
    makeMapBody,
    syncMeshToBody,
    createRigidBody,
} from './components/physics.js';

/* global Ammo */

// ------------------------------ CAMERA --------------------------------------------------------
var camera;
const CAM_INITIAL_POS = { x: 0, y: 0, z: 0 };
const CAM_OFFSET = { x: 5, y: 2.5, z: 0 };
const CAM_LAG = 0.1;
const CAM_FOV = 45;
const CAM_NEAR = 0.1;
const CAM_FAR = 1000;

// ----------------------------- Renderer ------------------------------------------------------
var renderer;
const RND_ENABLE_SHADOWS = true;

// ----------------------------- Environment ---------------------------------------------------
const hdrPath = "hdr/sky.hdr";
const ENV_OPTIONS = { textureRepeat: 1, textureRotations: 'aligned' };

// ----------------------------- CAR -------------------------------------------------
var car;
var wheelPivots = [];
var wheelMeshes = [];

// -------------------- VEHICLE SETTINGS -------------------------------
var vehicle;
const CHASSIS_MASS = 800;
const WHEEL_RADIUS = 0.4;
const STEER_MAX = 0.5;
const ENGINE_FORCE_MAX = 2000;
const BRAKE_FORCE_MAX = 100;

var currentSteeringValue = 0;
var currentEngineForce = 0;
var currentBrakeForce = 0;

// ------------------------------ LIGHTS ---------------------------
const AMBIENT_LIGHT_COLOR = 0x404040;
const LIGHTS_DATA = [
    { color: 0xffffff, intensity: 5.5, distance: 10000, position: [-2.5, 0.75, -2.5] }
];
const SHADOWS_DATA = { mapSize: 2048, near: 0.5, far: 500 };

var scene;
var orbitControls;
var keys = {};
var useOrbitControls = false;

// ------------------------------ PHYSICS ------------------------------------------------------
var physicsWorld;
var carPhysicsBody;

function optimizeMaterials(root) {
    root.traverse((node) => {
        if (node.isMesh && node.material) {
            if (node.material.isMeshPhysicalMaterial) {
                const prevMaterial = node.material;
                const newMaterial = new THREE.MeshStandardMaterial();
                THREE.MeshStandardMaterial.prototype.copy.call(newMaterial, prevMaterial);
                node.material = newMaterial;
                prevMaterial.dispose();
            }
        }
    });
}

function initPhysics() {
    const worldData = createPhysicsWorld();
    physicsWorld = worldData.physicsWorld;

    // 1. Chassis Body
    const chassisWidth = 1.8;
    const chassisHeight = 0.6;
    const chassisLength = 4;
    
    const chassisShape = new Ammo.btBoxShape(new Ammo.btVector3(chassisWidth * 0.5, chassisHeight * 0.5, chassisLength * 0.5));
    carPhysicsBody = createRigidBody(null, chassisShape, CHASSIS_MASS, { x: 0, y: 4, z: 0 }, { x: 0, y: 0, z: 0, w: 1 });
    physicsWorld.addRigidBody(carPhysicsBody);

    // 2. Raycast Vehicle
    const tuning = new Ammo.btVehicleTuning();
    const rayCaster = new Ammo.btDefaultVehicleRaycaster(physicsWorld);
    vehicle = new Ammo.btRaycastVehicle(tuning, carPhysicsBody, rayCaster);
    vehicle.setCoordinateSystem(0, 1, 2); // X, Y, Z
    physicsWorld.addAction(vehicle);

    // 3. Wheels
    const wheelDirectionCS0 = new Ammo.btVector3(0, -1, 0);
    const wheelAxleCS = new Ammo.btVector3(-1, 0, 0);
    const suspensionRestLength = 0.6;
    const rollInfluence = 0.2;

    function addWheel(isFront, pos) {
        const wheelInfo = vehicle.addWheel(
            pos,
            wheelDirectionCS0,
            wheelAxleCS,
            suspensionRestLength,
            WHEEL_RADIUS,
            tuning,
            isFront
        );
        wheelInfo.set_m_suspensionStiffness(20.0);
        wheelInfo.set_m_wheelsDampingRelaxation(2.3);
        wheelInfo.set_m_wheelsDampingCompression(4.4);
        wheelInfo.set_m_frictionSlip(1000);
        wheelInfo.set_m_rollInfluence(rollInfluence);
    }

    const wheelHalfTrack = 1.0;
    const wheelAxisHeight = 0.3;
    const wheelFrontPos = 1.7;
    const wheelBackPos = -1.0;

    addWheel(true, new Ammo.btVector3(wheelHalfTrack, wheelAxisHeight, wheelFrontPos));  // Front Left
    addWheel(true, new Ammo.btVector3(-wheelHalfTrack, wheelAxisHeight, wheelFrontPos)); // Front Right
    addWheel(false, new Ammo.btVector3(wheelHalfTrack, wheelAxisHeight, wheelBackPos));   // Back Left
    addWheel(false, new Ammo.btVector3(-wheelHalfTrack, wheelAxisHeight, wheelBackPos));  // Back Right
}

const MAP_SCALE = 50;
const MAP_OFFSET = { x: 0, y: -200, z: 0 };
var mapVisual = null;

function findGroundY(x, z) {
    const raycaster = new THREE.Raycaster();
    raycaster.set(new THREE.Vector3(x, 1000, z), new THREE.Vector3(0, -1, 0));
    if (!mapVisual) return 2;
    const intersects = raycaster.intersectObject(mapVisual, true);
    return intersects.length > 0 ? intersects[0].point.y : 2;
}

function respawnCar() {
    if (!car || !carPhysicsBody) return;
    const spawnX = 18;
    const spawnZ = 4.6;
    const spawnY = findGroundY(spawnX, spawnZ) + 2.0;

    const transform = new Ammo.btTransform();
    transform.setIdentity();
    transform.setOrigin(new Ammo.btVector3(spawnX, spawnY, spawnZ));
    carPhysicsBody.setWorldTransform(transform);
    carPhysicsBody.setLinearVelocity(new Ammo.btVector3(0, 0, 0));
    carPhysicsBody.setAngularVelocity(new Ammo.btVector3(0, 0, 0));
}

async function spawnMap(scene, manager) {
    const loader = new GLTFLoader(manager);
    await new Promise((resolve) => {
        loader.load('models/map.glb', (gltf) => {
            const mapScene = gltf.scene;
            mapScene.scale.setScalar(MAP_SCALE);
            mapScene.position.set(MAP_OFFSET.x, MAP_OFFSET.y, MAP_OFFSET.z);
            scene.add(mapScene);
            optimizeMaterials(mapScene);
            mapVisual = mapScene;
            makeMapBody(physicsWorld, mapScene);
            respawnCar();
            resolve();
        });
    });
}

function drawCar(scene, manager) {
    car = new THREE.Group();
    const loader = new GLTFLoader(manager);

    loader.load('models/car.glb', (gltf) => {
        const carModel = gltf.scene;
        carModel.scale.set(0.01, 0.01, 0.01);
        carModel.rotation.y = -Math.PI / 2; // Match forward direction in Ammo (Z forward)
        carModel.traverse((node) => { if (node.isMesh) node.castShadow = true; });
        optimizeMaterials(carModel);
        car.add(carModel);
    });

    const rotationFix = new THREE.Quaternion();
    rotationFix.setFromEuler(new THREE.Euler(Math.PI / 2, 0, 0));

    loader.load('models/wheel.glb', (gltf) => {
        const wheelTemplate = gltf.scene.children[0];
        wheelTemplate.scale.set(0.01, 0.01, 0.01);
        wheelTemplate.rotation.x = Math.PI;
        wheelTemplate.quaternion.multiply(rotationFix);
        
        for (let i = 0; i < 4; i++) {
            const pivot = new THREE.Group();
            const mesh = wheelTemplate.clone();
            mesh.castShadow = true;
            pivot.add(mesh);
            scene.add(pivot);
            wheelPivots.push(pivot);
            wheelMeshes.push(mesh);
        }
    });

    scene.add(car);
}

function addLights(scene) {
    for (const LDATA of LIGHTS_DATA) {
        const light = new THREE.PointLight(LDATA.color, LDATA.intensity, LDATA.distance);
        light.position.set(...LDATA.position);
        light.castShadow = true;
        light.shadow.mapSize.width = SHADOWS_DATA.mapSize;
        light.shadow.mapSize.height = SHADOWS_DATA.mapSize;
        scene.add(light);
    }
    scene.add(new THREE.AmbientLight(AMBIENT_LIGHT_COLOR));
}

async function setup() {
    console.log('[Setup] Starting setup...');
    const manager = createLoadingManager();

    camera = new THREE.PerspectiveCamera(CAM_FOV, window.innerWidth / window.innerHeight, CAM_NEAR, CAM_FAR);
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.getElementById('app').appendChild(renderer.domElement);

    scene = new THREE.Scene();
    console.log('[Setup] Creating environment...');
    await createEnvironment(scene, hdrPath, {}, ENV_OPTIONS, null, manager);

    console.log('[Setup] Initializing physics...');
    initPhysics();
    console.log('[Setup] Spawning map...');
    await spawnMap(scene, manager);
    console.log('[Setup] Drawing car...');
    drawCar(scene, manager);
    addLights(scene);

    window.addEventListener('keydown', (e) => {
        keys[e.code] = true;
        if (e.code === 'KeyC') useOrbitControls = !useOrbitControls;
        if (e.code === 'KeyR') respawnCar();
    });
    window.addEventListener('keyup', (e) => { keys[e.code] = false; });

    orbitControls = new OrbitControls(camera, renderer.domElement);
    animate();
}

function updateCameraFollow() {
    const offset = new THREE.Vector3(CAM_OFFSET.x, CAM_OFFSET.y, CAM_OFFSET.z);
    offset.applyQuaternion(car.quaternion);
    const desired = car.position.clone().add(offset);
    camera.position.lerp(desired, CAM_LAG);
    camera.lookAt(car.position.x, car.position.y + 0.5, car.position.z);
}

var TRANSFORM_AUX;

function animate() {
    if (!TRANSFORM_AUX) TRANSFORM_AUX = new Ammo.btTransform();
    const dt = 1 / 60;
    
    currentEngineForce = 0;
    currentBrakeForce = 0;
    if (keys['KeyW']) currentEngineForce = ENGINE_FORCE_MAX;
    if (keys['KeyS']) currentEngineForce = -ENGINE_FORCE_MAX / 2;
    if (keys['Space']) currentBrakeForce = BRAKE_FORCE_MAX;

    let targetSteering = 0;
    if (keys['KeyA']) targetSteering = STEER_MAX;
    if (keys['KeyD']) targetSteering = -STEER_MAX;
    currentSteeringValue += (targetSteering - currentSteeringValue) * 0.1;

    // Apply to Ammo vehicle
    vehicle.applyEngineForce(currentEngineForce, 2); // Rear left
    vehicle.applyEngineForce(currentEngineForce, 3); // Rear right
    vehicle.setBrake(currentBrakeForce, 0);
    vehicle.setBrake(currentBrakeForce, 1);
    vehicle.setBrake(currentBrakeForce, 2);
    vehicle.setBrake(currentBrakeForce, 3);
    vehicle.setSteeringValue(currentSteeringValue, 0); // Front left
    vehicle.setSteeringValue(currentSteeringValue, 1); // Front right

    physicsWorld.stepSimulation(dt, 10);

    // Sync chassis
    syncMeshToBody(carPhysicsBody, car, { x: 0, y: -0.4, z: 0 });

    // Sync wheels
    for (let i = 0; i < vehicle.getNumWheels(); i++) {
        vehicle.updateWheelTransform(i, true);
        const tm = vehicle.getWheelTransformWS(i);
        const p = tm.getOrigin();
        const q = tm.getRotation();
        if (wheelPivots[i]) {
            wheelPivots[i].position.set(p.x(), p.y(), p.z());
            wheelPivots[i].quaternion.set(q.x(), q.y(), q.z(), q.w());
        }
    }

    if (!useOrbitControls) updateCameraFollow();
    else orbitControls.update();

    renderer.render(scene, camera);
    requestAnimationFrame(animate);
}

// Start after Ammo initializes
console.log('Initializing Ammo.js...');
Ammo().then((AmmoLib) => {
    console.log('Ammo.js ready!');
    window.Ammo = AmmoLib;
    setup();
}).catch(err => {
    console.error('Failed to initialize Ammo.js:', err);
});
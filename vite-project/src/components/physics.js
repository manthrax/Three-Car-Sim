// CANNON PHYSICS FOR MAIN.JS

import * as CANNON from 'cannon-es';
import * as THREE  from 'three';

// ------ COLLISIONS -------------------------------------------------

// Each object belongs to its own collision group and what it should collide with is numbered by its mask

export const GROUPS = {
    CAR:    1,  // bit 0
    GROUND: 2,  // bit 1
    OBJECT: 4,  // bit 2
    MAP:    8,  // bit 3 — static map trimesh
};

// ---- PHYSICS WORLD ------------------------------------------------
// Creates a CANNON.World with gravity and a ground

export function createPhysicsWorld({ gravity = -9.82, iterations = 10 } = {}) {
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, gravity, 0) });
    world.allowSleep        = true;
    world.solver.iterations = iterations;
    world.broadphase        = new CANNON.SAPBroadphase(world);

    const groundBody = new CANNON.Body({
        type: CANNON.Body.STATIC,
        collisionFilterGroup: GROUPS.GROUND,
        collisionFilterMask:  GROUPS.CAR | GROUPS.OBJECT,
    });
    groundBody.addShape(new CANNON.Plane());
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0); // face upward
    world.addBody(groundBody);

    return { world, groundBody };
}

// ---- makeCarBody ---------------------------------------

export function makeCarBody(world, { hx, hy, hz }, mass = 150) {
    const body = new CANNON.Body({
        mass,
        linearDamping:  0.0,  // DO NOT raise — we own velocity each frame
        angularDamping: 1.0,  // damps spin from impacts but not our yaw control
        collisionFilterGroup: GROUPS.CAR,
        collisionFilterMask:  GROUPS.GROUND | GROUPS.OBJECT,
    });

    body.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
    body.position.set(0, hy + 0.01, 0); // start just above ground
    world.addBody(body);
    return body;
}

// ----- makeLampBody (Or any object i choose)--------------------------------------------------------

export function makeLampBody(world, x, y, z, halfWidth, halfHeight, mass = 0) {
    const body = new CANNON.Body({
        mass,
        linearDamping:  0.4,
        angularDamping: 0.6,
        collisionFilterGroup: GROUPS.OBJECT,
        collisionFilterMask:  GROUPS.CAR | GROUPS.GROUND | GROUPS.OBJECT,
    });

    body.addShape(
        new CANNON.Box(new CANNON.Vec3(halfWidth, halfHeight, halfWidth)),
        new CANNON.Vec3(0, halfHeight, 0),
    );

    body.position.set(x, 0.01, z); // 0.01 prevents immediate ground overlap
    body.allowSleep = true;
    world.addBody(body);
    return body;
}

// ----- syncMeshToBody -----------------------------------------

const _lc = new THREE.Vector3();
const _bq = new THREE.Quaternion();
export function syncMeshToBody(body, mesh, meshCentreOffset = 0) {
    _bq.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);

    if (meshCentreOffset !== 0) {
        _lc.set(0, meshCentreOffset, 0).applyQuaternion(_bq);
        mesh.position.set(
            body.position.x + _lc.x,
            body.position.y + _lc.y,
            body.position.z + _lc.z,
        );
    } else {
        mesh.position.set(body.position.x, body.position.y, body.position.z);
    }

    mesh.quaternion.copy(_bq);
}

// ---- makeMapBody -----------------------------------------------------

export function makeMapBody(world, gltfScene) {
    gltfScene.updateMatrixWorld(true);

    const allVertices = [];
    const allIndices  = [];
    const tempVec     = new THREE.Vector3();

    gltfScene.traverse((child) => {
        if (!child.isMesh) return;
        const geo = child.geometry;
        if (!geo?.attributes?.position) return;

        const posAttr    = geo.attributes.position;
        const vertOffset = allVertices.length / 3; 

        // World transform each vertex
        for (let i = 0; i < posAttr.count; i++) {
            tempVec.fromBufferAttribute(posAttr, i).applyMatrix4(child.matrixWorld);
            allVertices.push(tempVec.x, tempVec.y, tempVec.z);
        }

        if (geo.index) {
            for (let i = 0; i < geo.index.count; i++) {
                allIndices.push(geo.index.array[i] + vertOffset);
            }
        } else {
            for (let i = 0; i < posAttr.count; i++) {
                allIndices.push(i + vertOffset);
            }
        }
    });

    if (allVertices.length === 0) {
        console.warn('[physics] makeMapBody: no mesh geometry found in GLTF scene');
        return null;
    }

    const body = new CANNON.Body({
        type: CANNON.Body.STATIC,
        collisionFilterGroup: GROUPS.MAP,
        collisionFilterMask:  GROUPS.CAR | GROUPS.OBJECT,
    });

    body.addShape(new CANNON.Trimesh(
        new Float32Array(allVertices),
        new Int32Array(allIndices),
    ));

    body.position.set(0, 0, 0);
    body.quaternion.set(0, 0, 0, 1);
    world.addBody(body);

    console.log(`[physics] Map body: ${allVertices.length / 3} vertices, ${allIndices.length / 3} triangles`);
    return body;
}

// ---- CANNON DEBUGGER -----------------------------------------------------

export class CannonDebugger {
    constructor(scene, world, { color = 0x00ff00, visible = true } = {}) {
        this.scene   = scene;
        this.world   = world;
        this.visible = visible;
        this._meshes = [];
        this._mat    = new THREE.MeshBasicMaterial({ color, wireframe: true });
    }

    update() {
        const bodies = this.world.bodies;

        // Add a wireframe mesh for any newly added objects
        while (this._meshes.length < bodies.length) {
            const m = new THREE.Mesh(new THREE.BufferGeometry(), this._mat);
            m.visible = this.visible;
            this.scene.add(m);
            this._meshes.push(m);
        }

        for (let i = 0; i < bodies.length; i++) {
            const body = bodies[i];
            const dm   = this._meshes[i];

            if (!body.shapes.length) { dm.visible = false; continue; }

            const shape  = body.shapes[0];
            const offset = body.shapeOffsets[0] ?? new CANNON.Vec3();

            // Geomtry matches body shape
            dm.geometry.dispose();
            if (shape instanceof CANNON.Box) {
                const h = shape.halfExtents;
                dm.geometry = new THREE.BoxGeometry(h.x * 2, h.y * 2, h.z * 2);
            } else if (shape instanceof CANNON.Sphere) {
                dm.geometry = new THREE.SphereGeometry(shape.radius, 8, 6);
            } else if (shape instanceof CANNON.Plane) {
                dm.geometry = new THREE.PlaneGeometry(50, 50);
            } else {
                dm.geometry = new THREE.BoxGeometry(0.1, 0.1, 0.1); // unknown shape fallback
            }

            // Body Position
            const bq = new THREE.Quaternion(
                body.quaternion.x, body.quaternion.y,
                body.quaternion.z, body.quaternion.w,
            );
            const off = new THREE.Vector3(offset.x, offset.y, offset.z).applyQuaternion(bq);
            dm.position.set(
                body.position.x + off.x,
                body.position.y + off.y,
                body.position.z + off.z,
            );
            dm.quaternion.copy(bq);
            dm.visible = this.visible;
        }

        for (let i = bodies.length; i < this._meshes.length; i++) {
            this._meshes[i].visible = false;
        }
    }

    dispose() {
        for (const m of this._meshes) { this.scene.remove(m); m.geometry.dispose(); }
        this._meshes = [];
        this._mat.dispose();
    }
}
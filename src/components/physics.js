// AMMO.JS PHYSICS UTILITIES
/* global Ammo */

import * as THREE from 'three';

export function createPhysicsWorld() {
    const collisionConfiguration = new Ammo.btDefaultCollisionConfiguration();
    const dispatcher = new Ammo.btCollisionDispatcher(collisionConfiguration);
    const overlappingPairCache = new Ammo.btDbvtBroadphase();
    const solver = new Ammo.btSequentialImpulseConstraintSolver();
    const physicsWorld = new Ammo.btDiscreteDynamicsWorld(dispatcher, overlappingPairCache, solver, collisionConfiguration);
    
    physicsWorld.setGravity(new Ammo.btVector3(0, -9.82, 0));
    
    return {
        physicsWorld,
        dispatcher,
        overlappingPairCache,
        solver,
        collisionConfiguration
    };
}

export function createRigidBody(mesh, shape, mass, pos, quat) {
    const transform = new Ammo.btTransform();
    transform.setIdentity();
    transform.setOrigin(new Ammo.btVector3(pos.x, pos.y, pos.z));
    transform.setRotation(new Ammo.btQuaternion(quat.x, quat.y, quat.z, quat.w));
    
    const motionState = new Ammo.btDefaultMotionState(transform);
    const localInertia = new Ammo.btVector3(0, 0, 0);
    if (mass > 0) shape.calculateLocalInertia(mass, localInertia);
    
    const rbInfo = new Ammo.btRigidBodyConstructionInfo(mass, motionState, shape, localInertia);
    const body = new Ammo.btRigidBody(rbInfo);
    
    body.setFriction(0.5);
    body.setRestitution(0.2);
    
    if (mass > 0) {
        body.setActivationState(4); // DISABLE_DEACTIVATION
    }
    
    return body;
}

export function makeMapBody(physicsWorld, visualMesh) {
    const mesh = visualMesh.children[0]; // Assuming first child is the main mesh
    if (!mesh || !mesh.geometry) return null;

    const geometry = mesh.geometry;
    const vertices = geometry.attributes.position.array;
    const indices = geometry.index.array;
    
    const ammoMesh = new Ammo.btTriangleMesh();
    const scale = visualMesh.scale;
    const offset = visualMesh.position;

    for (let i = 0; i < indices.length; i += 3) {
        const i1 = indices[i] * 3;
        const i2 = indices[i + 1] * 3;
        const i3 = indices[i + 2] * 3;

        const v1 = new Ammo.btVector3(vertices[i1] * scale.x + offset.x, vertices[i1 + 1] * scale.y + offset.y, vertices[i1 + 2] * scale.z + offset.z);
        const v2 = new Ammo.btVector3(vertices[i2] * scale.x + offset.x, vertices[i2 + 1] * scale.y + offset.y, vertices[i2 + 2] * scale.z + offset.z);
        const v3 = new Ammo.btVector3(vertices[i3] * scale.x + offset.x, vertices[i3 + 1] * scale.y + offset.y, vertices[i3 + 2] * scale.z + offset.z);

        ammoMesh.addTriangle(v1, v2, v3, true);
    }

    const shape = new Ammo.btBvhTriangleMeshShape(ammoMesh, true, true);
    const transform = new Ammo.btTransform();
    transform.setIdentity();
    
    const motionState = new Ammo.btDefaultMotionState(transform);
    const rbInfo = new Ammo.btRigidBodyConstructionInfo(0, motionState, shape, new Ammo.btVector3(0, 0, 0));
    const body = new Ammo.btRigidBody(rbInfo);
    
    physicsWorld.addRigidBody(body);
    return body;
}

// Helpers for syncing
export function syncMeshToBody(body, mesh, visualOffset = { x: 0, y: 0, z: 0 }) {
    const ms = body.getMotionState();
    if (ms) {
        const TRANSFORM_AUX = new Ammo.btTransform();
        ms.getWorldTransform(TRANSFORM_AUX);
        const p = TRANSFORM_AUX.getOrigin();
        const q = TRANSFORM_AUX.getRotation();
        
        mesh.position.set(p.x(), p.y(), p.z());
        mesh.quaternion.set(q.x(), q.y(), q.z(), q.w());
        
        if (visualOffset.x !== 0 || visualOffset.y !== 0 || visualOffset.z !== 0) {
            const offset = new THREE.Vector3(visualOffset.x, visualOffset.y, visualOffset.z);
            offset.applyQuaternion(mesh.quaternion);
            mesh.position.add(offset);
        }
    }
}
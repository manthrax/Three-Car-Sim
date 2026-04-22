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
    console.log('[Physics] Starting map trimesh generation...');
    const startTime = performance.now();
    const ammoMesh = new Ammo.btTriangleMesh();
    visualMesh.updateMatrixWorld(true);

    const v1 = new Ammo.btVector3();
    const v2 = new Ammo.btVector3();
    const v3 = new Ammo.btVector3();

    let triCount = 0;
    visualMesh.traverse((node) => {
        if (node.isMesh && node.geometry) {
            console.log(`[Physics] Processing mesh: ${node.name}`);
            const geometry = node.geometry.index ? node.geometry : node.geometry.toNonIndexed();
            const vertices = geometry.attributes.position.array;
            const indices = geometry.index ? geometry.index.array : null;
            const worldMatrix = node.matrixWorld;

            const tempV1 = new THREE.Vector3();
            const tempV2 = new THREE.Vector3();
            const tempV3 = new THREE.Vector3();

            if (indices) {
                for (let i = 0; i < indices.length; i += 3) {
                    tempV1.set(vertices[indices[i] * 3], vertices[indices[i] * 3 + 1], vertices[indices[i] * 3 + 2]).applyMatrix4(worldMatrix);
                    tempV2.set(vertices[indices[i + 1] * 3], vertices[indices[i + 1] * 3 + 1], vertices[indices[i + 1] * 3 + 2]).applyMatrix4(worldMatrix);
                    tempV3.set(vertices[indices[i + 2] * 3], vertices[indices[i + 2] * 3 + 1], vertices[indices[i + 2] * 3 + 2]).applyMatrix4(worldMatrix);

                    v1.setValue(tempV1.x, tempV1.y, tempV1.z);
                    v2.setValue(tempV2.x, tempV2.y, tempV2.z);
                    v3.setValue(tempV3.x, tempV3.y, tempV3.z);
                    ammoMesh.addTriangle(v1, v2, v3, true);
                    triCount++;
                }
            } else {
                for (let i = 0; i < vertices.length; i += 9) {
                    tempV1.set(vertices[i], vertices[i + 1], vertices[i + 2]).applyMatrix4(worldMatrix);
                    tempV2.set(vertices[i + 3], vertices[i + 4], vertices[i + 5]).applyMatrix4(worldMatrix);
                    tempV3.set(vertices[i + 6], vertices[i + 7], vertices[i + 8]).applyMatrix4(worldMatrix);

                    v1.setValue(tempV1.x, tempV1.y, tempV1.z);
                    v2.setValue(tempV2.x, tempV2.y, tempV2.z);
                    v3.setValue(tempV3.x, tempV3.y, tempV3.z);
                    ammoMesh.addTriangle(v1, v2, v3, true);
                    triCount++;
                }
            }
        }
    });

    console.log(`[Physics] Built ammoMesh with ${triCount} triangles.`);
    
    // Cleanup local temp vectors
    Ammo.destroy(v1); Ammo.destroy(v2); Ammo.destroy(v3);

    console.log('[Physics] Building BVH Triangle Mesh Shape...');
    const shape = new Ammo.btBvhTriangleMeshShape(ammoMesh, true, true);
    const transform = new Ammo.btTransform();
    transform.setIdentity();
    
    const motionState = new Ammo.btDefaultMotionState(transform);
    const rbInfo = new Ammo.btRigidBodyConstructionInfo(0, motionState, shape, new Ammo.btVector3(0, 0, 0));
    const body = new Ammo.btRigidBody(rbInfo);
    
    physicsWorld.addRigidBody(body);
    const endTime = performance.now();
    console.log(`[Physics] Map trimesh built in ${(endTime - startTime).toFixed(2)}ms`);
    return body;
}

let SYNC_TRANSFORM_AUX;
// Helpers for syncing
export function syncMeshToBody(body, mesh, visualOffset = { x: 0, y: 0, z: 0 }) {
    const ms = body.getMotionState();
    if (ms) {
        if (!SYNC_TRANSFORM_AUX) SYNC_TRANSFORM_AUX = new Ammo.btTransform();
        ms.getWorldTransform(SYNC_TRANSFORM_AUX);
        const p = SYNC_TRANSFORM_AUX.getOrigin();
        const q = SYNC_TRANSFORM_AUX.getRotation();
        
        mesh.position.set(p.x(), p.y(), p.z());
        mesh.quaternion.set(q.x(), q.y(), q.z(), q.w());
        
        if (visualOffset.x !== 0 || visualOffset.y !== 0 || visualOffset.z !== 0) {
            const offset = new THREE.Vector3(visualOffset.x, visualOffset.y, visualOffset.z);
            offset.applyQuaternion(mesh.quaternion);
            mesh.position.add(offset);
        }
    }
}
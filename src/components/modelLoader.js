import * as THREE from "three";

export async function loadModel(
  loader,
  url,
  modelSize,
  position,
  scene,
  physics = null, // kept for API compatibility; ignored (no Ammo dependency)
  options = {},
) {
  return new Promise((resolve, reject) => {
    const ANIMATION_PLAYBACK_RATE = 1.0;

    loader.load(url, (gltf) => {
      const model = gltf.scene;
      let mixer = null;
      let activeAction = null;

      // Compute the bounding box of the model
      let bounds = new THREE.Box3().setFromObject(model);
      let size = bounds.getSize(new THREE.Vector3());
      let center = bounds.getCenter(new THREE.Vector3());
      const maxAxis = Math.max(size.x, size.y, size.z);

      // Uniformly scale the model so its largest axis matches modelSize
      if (maxAxis > 0) {
        const scaleFactor = modelSize / maxAxis;
        model.scale.multiplyScalar(scaleFactor);
        model.updateWorldMatrix(true, true);
        bounds = new THREE.Box3().setFromObject(model);
        size = bounds.getSize(new THREE.Vector3());
        center = bounds.getCenter(new THREE.Vector3());
      } else {
        model.updateWorldMatrix(true, true);
        bounds = new THREE.Box3().setFromObject(model);
        size = bounds.getSize(new THREE.Vector3());
        center = bounds.getCenter(new THREE.Vector3());
      }

      // Centre model geometry at origin
      model.position.sub(center);

      // Resolve base world position from caller
      const basePos = new THREE.Vector3(0, 0, 0);
      if (position instanceof THREE.Vector3) {
        basePos.copy(position);
      } else if (position) {
        basePos.set(position.x ?? 0, position.y ?? 0, position.z ?? 0);
      }

      // Resolve optional offsets
      const modelOff =
        options.modelOffset ?
          options.modelOffset instanceof THREE.Vector3 ?
            options.modelOffset.clone()
          : new THREE.Vector3(
              options.modelOffset.x || 0,
              options.modelOffset.y || 0,
              options.modelOffset.z || 0,
            )
        : new THREE.Vector3();

      // groundAlign: shift the model up by half its height so its bottom
      // sits at basePos.y rather than its centre being at basePos.y.
      if (options.groundAlign) {
        modelOff.y += size.y / 2;
      }

      // Apply configurable base orientation and optional per-instance rotation
      const br = options.baseRotation || {};
      const baseEuler = new THREE.Euler(br.x || 0, br.y || 0, br.z || 0);
      const baseQuat = new THREE.Quaternion().setFromEuler(baseEuler);
      let finalQuat = baseQuat.clone();
      if (options.rotation) {
        const r =
          options.rotation instanceof THREE.Vector3 ?
            new THREE.Euler(
              options.rotation.x,
              options.rotation.y,
              options.rotation.z,
            )
          : new THREE.Euler(
              options.rotation.x || 0,
              options.rotation.y || 0,
              options.rotation.z || 0,
            );
        const userQuat = new THREE.Quaternion().setFromEuler(r);
        finalQuat.multiply(userQuat);
      }
      model.quaternion.copy(finalQuat);

      // Place model at requested world position plus any modelOffset
      const worldPos = basePos.clone().add(modelOff);
      model.position.add(worldPos);
      scene.add(model);

      const nodes = [];
      model.traverse((child) => {
        nodes.push({ name: child.name, type: child.type });
      });

      if (gltf.animations && gltf.animations.length > 0) {
        mixer = new THREE.AnimationMixer(model);
        const clip = gltf.animations[0];
        activeAction = mixer.clipAction(clip);
        activeAction.reset();
        activeAction.setEffectiveTimeScale(ANIMATION_PLAYBACK_RATE);
        activeAction.play();
      }

      // collider is null — Cannon bodies are created externally in main.js
      resolve({ model, mixer, activeAction, collider: null, clips: gltf.animations });
    }, undefined, reject);
  });
}
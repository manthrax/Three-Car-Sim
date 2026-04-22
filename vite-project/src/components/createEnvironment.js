// Environment/terrain setup for 3D scene
import * as THREE from "three";
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

const TILE_SIZE = 3; // Each tile is 3x3 units

export async function createEnvironment(
  scene,
  hdrPath,
  floorTextures = {},
  options = {},
  physics = null, // kept for API compatibility; Cannon physics is handled in main.js
  manager = null,
) {
  if (hdrPath) {
    // Load HDRI for sky/environment lighting
    new RGBELoader(manager ?? undefined).load(hdrPath, (texture) => {
      texture.mapping = THREE.EquirectangularReflectionMapping;
      scene.background = texture;
      scene.environment = texture;
    });
  }

  // Prepare texture loader and config
  const textureLoader = new THREE.TextureLoader(manager ?? undefined);
  const textureConfig =
    typeof floorTextures === "string" ?
      { diffuseMap: floorTextures }
    : floorTextures;

  const {
    diffuseMap,
    aoMap,
    armMap,
    normalMap,
    displacementMap,
    roughnessMap,
  } = textureConfig || {};

  const {
    textureRepeat = 1,
    planeSize,
    width: inputWidth,
    depth: inputDepth,
    segments = 6,
    heightScale = 0,
    heightBias = 0,
    // Texture rotation options:
    // - Array of angles in radians: [0, Math.PI/2, Math.PI, ...]
    // - "natural": many rotations for organic textures (rocks, grass)
    // - "aligned": 0° and 180° only for structured textures (planks, tiles)
    // - "none": no rotation
    textureRotations = "none",
  } = options || {};

  const floorWidth = 30;
  const floorDepth = 30;

  const ROTATION_PRESETS = {
    natural: [
      0,
      Math.PI / 4,
      Math.PI / 2,
      (3 * Math.PI) / 4,
      Math.PI,
      (5 * Math.PI) / 4,
      (3 * Math.PI) / 2,
      (7 * Math.PI) / 4,
    ],
    aligned: [0, Math.PI],
    none: [0],
  };

  const rotations =
    Array.isArray(textureRotations) ? textureRotations : (
      (ROTATION_PRESETS[textureRotations] ?? ROTATION_PRESETS.natural)
    );

  const repeat = textureRepeat;

  const loadTextureBase = async (path, { isColor = false } = {}) => {
    if (!path) return null;
    const tex = await textureLoader.loadAsync(path);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    if (isColor) {
      tex.colorSpace = THREE.SRGBColorSpace; // replaces deprecated sRGBEncoding
    }
    return tex;
  };

  const [
    baseTexture,
    aoTexture,
    armTexture,
    normalTexture,
    displacementTexture,
    roughnessTexture,
  ] = await Promise.all([
    loadTextureBase(diffuseMap, { isColor: true }),
    loadTextureBase(aoMap),
    loadTextureBase(armMap),
    loadTextureBase(normalMap),
    loadTextureBase(displacementMap),
    loadTextureBase(roughnessMap),
  ]);

  const tilesX = Math.ceil(floorWidth / TILE_SIZE);
  const tilesZ = Math.ceil(floorDepth / TILE_SIZE);
  const actualWidth = tilesX * TILE_SIZE;
  const actualDepth = tilesZ * TILE_SIZE;
  const halfWidth = actualWidth / 2;
  const halfDepth = actualDepth / 2;

  const floorGroup = new THREE.Group();
  floorGroup.name = "floorTiles";
  floorGroup.userData.selectable = false;

  let globalMinHeight = Infinity;
  let globalMaxHeight = -Infinity;

  const globalCols = tilesX * segments + 1;
  const globalRows = tilesZ * segments + 1;
  const globalGrid = Array.from({ length: globalRows }, () =>
    new Array(globalCols).fill(0),
  );

  for (let tileZ = 0; tileZ < tilesZ; tileZ++) {
    for (let tileX = 0; tileX < tilesX; tileX++) {
      const textureRotation =
        rotations[Math.floor(Math.random() * rotations.length)];

      const cloneAndRotateTexture = (tex) => {
        if (!tex) return null;
        const cloned = tex.clone();
        cloned.needsUpdate = true;
        cloned.repeat.set(repeat, repeat);
        cloned.rotation = textureRotation;
        cloned.center.set(0.5, 0.5);
        return cloned;
      };

      const tileBaseTexture        = cloneAndRotateTexture(baseTexture);
      const tileAoTexture          = cloneAndRotateTexture(aoTexture);
      const tileArmTexture         = cloneAndRotateTexture(armTexture);
      const tileNormalTexture      = cloneAndRotateTexture(normalTexture);
      const tileDisplacementTexture = cloneAndRotateTexture(displacementTexture);
      const tileRoughnessTexture   = cloneAndRotateTexture(roughnessTexture);

      const tileGeometry = new THREE.PlaneGeometry(
        TILE_SIZE,
        TILE_SIZE,
        segments,
        segments,
      );

      if (tileGeometry.attributes.uv) {
        tileGeometry.setAttribute(
          "uv2",
          new THREE.BufferAttribute(
            tileGeometry.attributes.uv.array.slice(),
            2,
          ),
        );
      }

      if (tileDisplacementTexture) {
        const heightInfo = extractHeightData(
          tileGeometry,
          displacementTexture,
          repeat,
          heightScale,
          heightBias,
        );
        if (heightInfo) {
          applyHeightsToGeometry(tileGeometry, heightInfo.heights);
          if (heightInfo.min < globalMinHeight) globalMinHeight = heightInfo.min;
          if (heightInfo.max > globalMaxHeight) globalMaxHeight = heightInfo.max;

          const tileStartRow = tileZ * segments;
          const tileStartCol = tileX * segments;
          for (let r = 0; r < heightInfo.rows; r++) {
            for (let c = 0; c < heightInfo.cols; c++) {
              const globalR = tileStartRow + r;
              const globalC = tileStartCol + c;
              if (
                globalR < globalRows &&
                globalC < globalCols &&
                heightInfo.grid[r]
              ) {
                globalGrid[globalR][globalC] = heightInfo.grid[r][c];
              }
            }
          }
        }
      }

      const materialParams = {
        map:          tileBaseTexture     || undefined,
        aoMap:        tileAoTexture       || undefined,
        normalMap:    tileNormalTexture   || undefined,
        roughnessMap: tileRoughnessTexture || undefined,
        roughness:    1,
        metalness:    tileArmTexture ? 1 : 0,
      };

      if (tileArmTexture) {
        materialParams.metalnessMap  = tileArmTexture;
        materialParams.roughnessMap  = materialParams.roughnessMap || tileArmTexture;
        materialParams.aoMap         = materialParams.aoMap || tileArmTexture;
      }

      const tileMaterial = new THREE.MeshStandardMaterial(materialParams);

      // FIX: use plain THREE.Mesh instead of enable3d's ExtendedMesh.
      // Floor physics is handled by the infinite CANNON.Plane in main.js,
      // so no per-tile physics body is needed here.
      const tileMesh = new THREE.Mesh(tileGeometry, tileMaterial);
      tileMesh.receiveShadow = true;

      const posX = tileX * TILE_SIZE - halfWidth + TILE_SIZE / 2;
      const posZ = tileZ * TILE_SIZE - halfDepth + TILE_SIZE / 2;
      tileMesh.position.set(posX, 0, posZ);
      tileMesh.rotation.set(-Math.PI / 2, 0, 0);

      floorGroup.add(tileMesh);
    }
  }

  floorGroup.userData.selectable = false;
  scene.add(floorGroup);

  const heightBounds = {
    min: Number.isFinite(globalMinHeight) ? globalMinHeight : 0,
    max: Number.isFinite(globalMaxHeight) ? globalMaxHeight : 0,
  };

  const terrainData = {
    grid: globalGrid,
    rows: globalRows,
    cols: globalCols,
    cellSizeX: actualWidth / Math.max(globalCols - 1, 1),
    cellSizeZ: actualDepth / Math.max(globalRows - 1, 1),
    halfWidth: halfWidth,
    halfHeight: halfDepth,
    min: heightBounds.min,
    max: heightBounds.max,
  };

  return {
    floor: floorGroup,
    heightBounds,
    terrainData,
    floorSize: { width: actualWidth, depth: actualDepth },
  };
}

// Extracts height data from a displacement texture and geometry
function extractHeightData(geometry, texture, repeat, scale, bias) {
  const image = texture?.image;
  if (!image) return null;

  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;

  const { count } = geometry.attributes.position;
  const geometryParams = geometry.parameters || {};
  const widthSegments =
    geometryParams.widthSegments ??
    Math.max(Math.round(Math.sqrt(count)) - 1, 1);
  const heightSegments = geometryParams.heightSegments ?? widthSegments;

  let cols = Math.max(widthSegments + 1, 1);
  let rows = Math.max(heightSegments + 1, 1);
  if (cols * rows !== count) {
    cols = Math.max(Math.round(Math.sqrt(count)), 1);
    rows = Math.max(Math.round(count / cols), 1);
  }

  const heights = new Float32Array(count);
  const grid = Array.from({ length: rows }, () => new Array(cols));
  let minHeight = Infinity;
  let maxHeight = -Infinity;
  const uvAttr = geometry.attributes.uv;

  for (let i = 0; i < count; i++) {
    const u = wrapUv((uvAttr.getX(i) * repeat) % 1);
    const v = wrapUv((uvAttr.getY(i) * repeat) % 1);
    const x = Math.floor(u * (canvas.width - 1));
    const y = Math.floor((1 - v) * (canvas.height - 1));
    const idx = (y * canvas.width + x) * 4;
    const heightValue = pixels[idx] / 255;
    const mappedHeight = heightValue * scale + bias;
    heights[i] = mappedHeight;
    const row = Math.floor(i / cols);
    const col = i % cols;
    if (grid[row]) grid[row][col] = mappedHeight;
    if (mappedHeight < minHeight) minHeight = mappedHeight;
    if (mappedHeight > maxHeight) maxHeight = mappedHeight;
  }

  if (!Number.isFinite(minHeight) || !Number.isFinite(maxHeight)) return null;

  return { heights, grid, rows, cols, min: minHeight, max: maxHeight };
}

// Applies height values to the Z coordinate of geometry vertices
function applyHeightsToGeometry(geometry, heights) {
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    position.setZ(i, heights[i]);
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

// Ensures UV coordinates are wrapped to [0,1]
function wrapUv(value) {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
}
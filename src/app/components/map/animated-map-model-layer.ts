import { MercatorCoordinate } from 'maplibre-gl';
import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { MapAnimationTracker } from './map-animation-tracker';

import type {
    MapModelAppearance,
    MapModelColorUpdate,
    MapModelMarkerDefinition,
    MapModelPosition,
} from './map-model-markers';

type LoadedGltf = Awaited<ReturnType<GLTFLoader['parseAsync']>>;
type BlobLoader = (resourceKey: string) => Promise<Blob>;
type ColorRole = 'base' | 'accent';

type ColorMaterial = THREE.Material & { color: THREE.Color };

interface MaterialColorBinding {
    material: ColorMaterial;
    role: ColorRole;
}

interface MaterialColorTarget {
    material: ColorMaterial;
    from: THREE.Color;
    to: THREE.Color;
}

interface MaterialColorTransition {
    startedAt: number;
    durationMs: number;
    targets: MaterialColorTarget[];
}

interface ScaleTransition {
    startedAt: number;
    durationMs: number;
    from: number;
    to: number;
}

type RouteMarkerAnimation = 'start' | 'end';

interface RoutePulseTransition {
    startedAt: number;
    durationMs: number;
    role: RouteMarkerAnimation;
}

interface RuntimeMarker {
    definition: MapModelMarkerDefinition;
    lngLat: [number, number];
    /** Stable scene-local coordinates in meters relative to the layer origin. */
    localX: number;
    localY: number;
    /** Cached when terrain data first becomes available to avoid camera-driven height jumps. */
    groundElevationMeters?: number;
    index: number;
    pivot: THREE.Group;
    scaleRoot: THREE.Group;
    pulseRoot: THREE.Group;
    routePulse?: RoutePulseTransition;
    routePulseLiftMeters: number;
    /** True only while this marker's logical state is visually applied as `current`. */
    isCurrent: boolean;
    cameraFacingYaw?: number;
    mixer?: THREE.AnimationMixer;
    colorBindings: MaterialColorBinding[];
    colorTransitions: Partial<Record<ColorRole, MaterialColorTransition>>;
    scaleTransition?: ScaleTransition;
}

interface LogicalMapSize {
    width: number;
    height: number;
}

interface ImageSize {
    width: number;
    height: number;
}

export class AnimatedMapModelLayer implements CustomLayerInterface {
    readonly id = 'animated-map-models';
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;

    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.Camera();
    private readonly shadowLightDirection = new THREE.Vector3(-5, -6, 7).normalize();

    /** A single stable Mercator origin is shared by every model in the layer. */
    private sceneOriginMercator?: MercatorCoordinate;
    private sceneOriginElevationMeters = 0;
    private metersToMercator = 1;

    private renderer?: THREE.WebGLRenderer;
    private keyLight!: THREE.DirectionalLight;
    private readonly markers: RuntimeMarker[] = [];
    private disposed = false;
    private startedAt = 0;
    private readonly cameraFacingFrictionSeconds = 0.42;
    private lastFrameAt = 0;

    constructor(
        private readonly map: MapLibreMap,
        private readonly imageSize: ImageSize,
        private readonly logicalMapSize: LogicalMapSize,
        private readonly definitions: readonly MapModelMarkerDefinition[],
        private readonly loadBlob: BlobLoader,
    ) {
        this.setupLighting();
    }

    async loadAndAdd(): Promise<void> {
        if (this.disposed || this.definitions.length === 0) {
            return;
        }

        const loader = new GLTFLoader();
        const pendingModels = new Map<string, Promise<LoadedGltf>>();

        for (const definition of this.definitions) {
            if (!pendingModels.has(definition.resourceKey)) {
                pendingModels.set(
                    definition.resourceKey,
                    this.loadModel(loader, definition.resourceKey),
                );
            }
        }

        const loadedEntries = await Promise.all(
            Array.from(pendingModels.entries()).map(async ([resourceKey, promise]) => {
                return [resourceKey, await promise] as const;
            }),
        );

        const modelsByKey = new Map<string, LoadedGltf>(loadedEntries);

        if (this.disposed) {
            this.disposeObjects(Array.from(modelsByKey.values()).map(model => model.scene));
            return;
        }

        this.definitions.forEach((definition, index) => {
            const gltf = modelsByKey.get(definition.resourceKey);
            if (!gltf) {
                throw new Error(`Model resource "${definition.resourceKey}" was not loaded`);
            }

            const {
                container,
                animationRoot,
                colorBindings,
            } = this.createRenderableModel(
                gltf.scene,
                definition.modelHeightMeters ?? 160,
                definition.appearance?.accentMaterialNames ?? [],
                definition.smoothNormals ?? true,
            );

            this.applyInitialColors(colorBindings, definition.appearance);

            const pivot = new THREE.Group();
            pivot.visible = false;

            // Separate status scale from event pulses. Both scale around the model base,
            // so changing either one never moves the bottom away from its map altitude.
            const scaleRoot = new THREE.Group();
            scaleRoot.scale.setScalar(this.normalizeScale(definition.scale ?? 1));
            const pulseRoot = new THREE.Group();
            pulseRoot.add(container);
            scaleRoot.add(pulseRoot);
            pivot.add(scaleRoot);
            this.scene.add(pivot);

            let mixer: THREE.AnimationMixer | undefined;
            if (definition.playGltfAnimations && gltf.animations.length > 0) {
                mixer = new THREE.AnimationMixer(animationRoot);
                for (const clip of gltf.animations) {
                    mixer.clipAction(clip).play();
                }
            }

            this.markers.push({
                definition,
                lngLat: this.resolvePosition(definition.position),
                localX: 0,
                localY: 0,
                groundElevationMeters: undefined,
                index,
                pivot,
                scaleRoot,
                pulseRoot,
                routePulseLiftMeters: 0,
                isCurrent: false,
                cameraFacingYaw: undefined,
                mixer,
                colorBindings,
                colorTransitions: {},
            });
        });

        if (this.disposed) {
            this.releaseResources();
            return;
        }

        this.prepareSceneCoordinates();

        if (!this.map.getLayer(this.id)) {
            this.map.addLayer(this);
        }
    }

    /**
     * Builds one stable local-meter coordinate frame for every marker.
     *
     * A per-marker projection matrix can appear to slide against a terrain map
     * when camera transforms / elevation tiles change. MapLibre's recommended
     * Three.js terrain pattern uses one fixed Mercator origin and places every
     * object in that origin's local coordinate system instead.
     */
    private prepareSceneCoordinates(): void {
        const firstMarker = this.markers[0];
        if (!firstMarker) {
            return;
        }

        const sceneOriginLngLat: [number, number] = [
            firstMarker.lngLat[0],
            firstMarker.lngLat[1],
        ];
        this.sceneOriginElevationMeters =
            this.map.queryTerrainElevation(sceneOriginLngLat) ?? 0;

        this.sceneOriginMercator = MercatorCoordinate.fromLngLat(
            sceneOriginLngLat,
            this.sceneOriginElevationMeters,
        );
        this.metersToMercator =
            this.sceneOriginMercator.meterInMercatorCoordinateUnits();

        for (const marker of this.markers) {
            // x/y are Mercator positions; altitude is handled separately in meters.
            const coordinate = MercatorCoordinate.fromLngLat(marker.lngLat);
            marker.localX =
                (coordinate.x - this.sceneOriginMercator.x) / this.metersToMercator;
            // The scene's y axis is north-positive; the model matrix below flips it
            // into Mercator's south-positive y axis.
            marker.localY =
                (this.sceneOriginMercator.y - coordinate.y) / this.metersToMercator;

            const terrainElevation = this.map.queryTerrainElevation(marker.lngLat);
            marker.groundElevationMeters = terrainElevation ?? undefined;
        }
    }

    private async loadModel(loader: GLTFLoader, resourceKey: string): Promise<LoadedGltf> {
        const blob = await this.loadBlob(resourceKey);
        return loader.parseAsync(await blob.arrayBuffer(), '');
    }

    private createRenderableModel(
        source: THREE.Object3D,
        heightMeters: number,
        accentMaterialNames: readonly string[],
        smoothNormals: boolean,
    ): {
        container: THREE.Group;
        animationRoot: THREE.Object3D;
        colorBindings: MaterialColorBinding[];
    } {
        const animationRoot = cloneSkeleton(source);
        const materialClones = new Map<THREE.Material, THREE.Material>();

        const cloneMaterial = (material: THREE.Material): THREE.Material => {
            const previous = materialClones.get(material);
            if (previous) {
                return previous;
            }

            const cloned = material.clone();
            this.tuneMaterialForSoftLighting(cloned);
            materialClones.set(material, cloned);
            return cloned;
        };

        animationRoot.traverse(object => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) {
                return;
            }

            // Geometry is cloned per instance because optional normal smoothing
            // mutates its normal attribute. The source GLB remains untouched.
            mesh.geometry = mesh.geometry.clone();
            if (smoothNormals) {
                this.smoothNormalsAcrossCoincidentVertices(mesh.geometry);
            }

            mesh.material = Array.isArray(mesh.material)
                ? mesh.material.map(cloneMaterial)
                : cloneMaterial(mesh.material);

            // Necessary for real self-shadowing, e.g. the inner ring/recess.
            mesh.castShadow = true;
            mesh.receiveShadow = true;
        });

        // GLTF is Y-up. The map model layer uses Z-up.
        const axisRoot = new THREE.Group();
        axisRoot.rotation.x = Math.PI / 2;
        axisRoot.add(animationRoot);

        const container = new THREE.Group();
        container.add(axisRoot);
        container.updateMatrixWorld(true);

        const initialBounds = new THREE.Box3().setFromObject(container);
        const initialSize = initialBounds.getSize(new THREE.Vector3());
        const sourceHeight = initialSize.z > 0
            ? initialSize.z
            : Math.max(initialSize.x, initialSize.y, 1);
        const safeHeight = Number.isFinite(heightMeters)
            ? Math.max(heightMeters, 0.01)
            : 160;

        // Base physical size is independent of animated pivot scale.
        container.scale.setScalar(safeHeight / sourceHeight);
        container.updateMatrixWorld(true);

        // Center horizontally and place the model's base at z = 0.
        const bounds = new THREE.Box3().setFromObject(container);
        const center = bounds.getCenter(new THREE.Vector3());
        container.position.set(-center.x, -center.y, -bounds.min.z);
        container.updateMatrixWorld(true);

        const accentNames = new Set(
            accentMaterialNames.map(name => name.trim().toLowerCase()),
        );
        const colorBindings: MaterialColorBinding[] = [];
        const visitedMaterials = new Set<THREE.Material>();

        container.traverse(object => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) {
                return;
            }

            const materials = Array.isArray(mesh.material)
                ? mesh.material
                : [mesh.material];

            for (const material of materials) {
                if (visitedMaterials.has(material)) {
                    continue;
                }
                visitedMaterials.add(material);

                const candidate = material as THREE.Material & { color?: THREE.Color };
                if (!(candidate.color instanceof THREE.Color)) {
                    continue;
                }

                const role: ColorRole = accentNames.has(
                    material.name.trim().toLowerCase(),
                ) ? 'accent' : 'base';

                colorBindings.push({
                    material: material as ColorMaterial,
                    role,
                });
            }
        });

        return { container, animationRoot, colorBindings };
    }

    /**
     * Rebuild smooth vertex normals by averaging triangle normals across vertices
     * that occupy the same position. GLTF exporters may split a vertex at UV seams
     * or encode hard normals; in those cases rotating a rounded object can produce
     * visible light jumps from one polygon to the next.
     *
     * This is intentionally opt-out via marker `smoothNormals: false` for models
     * that are supposed to have deliberately sharp edges.
     */
    private smoothNormalsAcrossCoincidentVertices(geometry: THREE.BufferGeometry): void {
        const position = geometry.getAttribute('position');
        if (!position || position.itemSize < 3 || position.count < 3) {
            return;
        }

        const index = geometry.getIndex();
        const vertexCount = position.count;
        const box = new THREE.Box3().setFromBufferAttribute(
            position as THREE.BufferAttribute,
        );
        const size = box.getSize(new THREE.Vector3());
        const epsilon = Math.max(size.x, size.y, size.z, 1) * 1e-5;

        const keyFor = (vertexIndex: number): string => {
            const x = position.getX(vertexIndex);
            const y = position.getY(vertexIndex);
            const z = position.getZ(vertexIndex);
            return `${Math.round(x / epsilon)},${Math.round(y / epsilon)},${Math.round(z / epsilon)}`;
        };

        const sums = new Map<string, THREE.Vector3>();
        const a = new THREE.Vector3();
        const b = new THREE.Vector3();
        const c = new THREE.Vector3();
        const edge1 = new THREE.Vector3();
        const edge2 = new THREE.Vector3();
        const faceNormal = new THREE.Vector3();
        const elementCount = index ? index.count : vertexCount;

        // Area-weighted face normals avoid tiny triangles having the same weight
        // as the larger faces around them.
        for (let i = 0; i + 2 < elementCount; i += 3) {
            const ia = index ? index.getX(i) : i;
            const ib = index ? index.getX(i + 1) : i + 1;
            const ic = index ? index.getX(i + 2) : i + 2;

            a.fromBufferAttribute(position, ia);
            b.fromBufferAttribute(position, ib);
            c.fromBufferAttribute(position, ic);

            edge1.subVectors(b, a);
            edge2.subVectors(c, a);
            faceNormal.crossVectors(edge1, edge2);
            if (faceNormal.lengthSq() < 1e-20) {
                continue;
            }

            for (const vertexIndex of [ia, ib, ic]) {
                const key = keyFor(vertexIndex);
                const sum = sums.get(key);
                if (sum) {
                    sum.add(faceNormal);
                } else {
                    sums.set(key, faceNormal.clone());
                }
            }
        }

        const normals = new Float32Array(vertexCount * 3);
        const fallback = geometry.getAttribute('normal');
        const normal = new THREE.Vector3();

        for (let i = 0; i < vertexCount; i++) {
            const sum = sums.get(keyFor(i));
            if (sum && sum.lengthSq() > 1e-20) {
                normal.copy(sum).normalize();
            } else if (fallback && fallback.itemSize >= 3) {
                normal.set(fallback.getX(i), fallback.getY(i), fallback.getZ(i)).normalize();
            } else {
                normal.set(0, 0, 1);
            }

            normals[i * 3] = normal.x;
            normals[i * 3 + 1] = normal.y;
            normals[i * 3 + 2] = normal.z;
        }

        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
        geometry.computeBoundingSphere();
    }

    /** Tames excessive GLB highlights/emission while retaining its textures. */
    private tuneMaterialForSoftLighting(material: THREE.Material): void {
        const standard = material as THREE.MeshStandardMaterial;
        if (!standard.isMeshStandardMaterial) {
            return;
        }

        // Broadens highlights so a rotating face does not flash between extremes.
        standard.roughness = Math.max(standard.roughness, 0.72);
        standard.metalness = Math.min(standard.metalness, 0.08);
        standard.envMapIntensity = Math.min(standard.envMapIntensity, 0.25);

        // GLB emissive materials often look self-lit under additional scene lights.
        standard.emissive.multiplyScalar(0.05);
        standard.emissiveIntensity = Math.min(standard.emissiveIntensity, 0.01);
    }

    private applyInitialColors(
        bindings: MaterialColorBinding[],
        appearance?: MapModelAppearance,
    ): void {
        const baseColor = appearance?.baseColor
            ? new THREE.Color(appearance.baseColor)
            : undefined;
        const accentColor = appearance?.accentColor
            ? new THREE.Color(appearance.accentColor)
            : undefined;
        let accentCount = 0;

        for (const binding of bindings) {
            if (binding.role === 'accent') {
                accentCount++;
                if (accentColor) {
                    binding.material.color.copy(accentColor);
                }
            } else if (baseColor) {
                binding.material.color.copy(baseColor);
            }
        }

        if (accentColor && accentCount === 0) {
            console.warn(
                'Accent color configured, but no accent materials matched. Check the GLB material name.',
                appearance?.accentMaterialNames,
            );
        }
    }

    private resolvePosition(position: MapModelPosition): [number, number] {
        if (position.kind === 'lng-lat') {
            return [position.lng, position.lat];
        }

        const offsetX = (this.imageSize.width - this.logicalMapSize.width) / 2;
        const offsetY = (this.imageSize.height - this.logicalMapSize.height) / 2;

        const lng = (offsetX + position.x) / this.imageSize.width;
        const lat = (
            this.imageSize.height - offsetY - position.y
        ) / this.imageSize.width;

        return [lng, lat];
    }

    private setupLighting(): void {
        // Stable, broad illumination is deliberately stronger than direct light.
        // This reduces the contrast between adjacent polygons as the model rotates.
        const hemisphere = new THREE.HemisphereLight(
            0xffffff,
            0x777b88,
            1.15,
        );
        hemisphere.position.set(0, 0, 1);
        this.scene.add(hemisphere);

        const ambient = new THREE.AmbientLight(0xffffff, 0.28);
        this.scene.add(ambient);

        // A restrained neutral key light keeps form readable without making
        // faces flash between bright and dark. Soft shadow quality is configured below.
        this.keyLight = new THREE.DirectionalLight(0xfff6e8, 0.62);
        this.keyLight.castShadow = true;
        this.keyLight.shadow.mapSize.set(2048, 2048);
        this.keyLight.shadow.camera.near = 0.1;
        this.keyLight.shadow.camera.far = 1000;
        this.keyLight.shadow.bias = -0.00003;
        this.keyLight.shadow.normalBias = 0.008;
        this.keyLight.shadow.radius = 4;
        this.keyLight.shadow.camera.up.set(0, 0, 1);
        this.scene.add(this.keyLight);
        this.scene.add(this.keyLight.target);

        // Weak cool fill prevents black silhouettes but lets recesses remain visible.
        const fillLight = new THREE.DirectionalLight(0xd7e3ff, 0.16);
        fillLight.position.set(4, -3, 5);
        this.scene.add(fillLight);
    }

    private normalizeScale(scale: number): number {
        return Number.isFinite(scale) && scale > 0 ? scale : 1;
    }

    /** Animate base/accent materials. Returns false if the marker/role is unavailable. */
    public transitionColors(
        markerId: string,
        colors: MapModelColorUpdate,
        durationMs = 800,
    ): boolean {
        const marker = this.markers.find(item => item.definition.id === markerId);
        if (!marker) {
            return false;
        }

        const now = performance.now();
        this.updateColorTransitions(marker, now);
        const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 800;
        const requested: Array<[ColorRole, string | undefined]> = [
            ['base', colors.baseColor],
            ['accent', colors.accentColor],
        ];
        let changed = false;

        for (const [role, cssColor] of requested) {
            if (cssColor === undefined) {
                continue;
            }

            const bindings = marker.colorBindings.filter(binding => binding.role === role);
            if (bindings.length === 0) {
                continue;
            }

            const targetColor = new THREE.Color(cssColor);
            if (duration === 0) {
                for (const binding of bindings) {
                    binding.material.color.copy(targetColor);
                }
                delete marker.colorTransitions[role];
            } else {
                marker.colorTransitions[role] = {
                    startedAt: now,
                    durationMs: duration,
                    targets: bindings.map(binding => ({
                        material: binding.material,
                        from: binding.material.color.clone(),
                        to: targetColor.clone(),
                    })),
                };
            }
            changed = true;
        }

        if (changed) {
            if (duration > 0) this.markTransientAnimationStarted();
            this.map.triggerRepaint();
        }
        return changed;
    }

    private updateColorTransitions(marker: RuntimeMarker, now: number): void {
        for (const role of ['base', 'accent'] as const) {
            const transition = marker.colorTransitions[role];
            if (!transition) {
                continue;
            }

            const progress = Math.min(
                Math.max((now - transition.startedAt) / transition.durationMs, 0),
                1,
            );
            const eased = progress * progress * (3 - 2 * progress);

            for (const target of transition.targets) {
                target.material.color.lerpColors(target.from, target.to, eased);
            }

            if (progress >= 1) {
                delete marker.colorTransitions[role];
            }
        }
    }

    /**
     * Enables the gentle vertical float only for the marker whose state is
     * currently being shown as `current`. Other markers keep rotating but stay
     * vertically fixed. Called from applyMarkerAppearance so deferred destination
     * appearance timing also applies to floating.
     */
    public setMarkerCurrent(markerId: string, isCurrent: boolean): boolean {
        const marker = this.markers.find(item => item.definition.id === markerId);
        if (!marker || this.disposed) return false;
        if (marker.isCurrent === isCurrent) return true;

        marker.isCurrent = isCurrent;
        this.map.triggerRepaint();
        return true;
    }

    /**
     * Animates the marker's uniform scale multiplier. The configured `scale`
     * is the initial value; transitionScale(markerId, 1, ...) returns to 100%.
     */
    public transitionScale(
        markerId: string,
        targetScale: number,
        durationMs = 800,
    ): boolean {
        const marker = this.markers.find(item => item.definition.id === markerId);
        if (!marker || !Number.isFinite(targetScale) || targetScale <= 0) {
            return false;
        }

        const now = performance.now();
        this.updateScaleTransition(marker, now);
        const duration = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 800;
        const target = this.normalizeScale(targetScale);
        const from = marker.scaleRoot.scale.x;

        if (duration === 0) {
            marker.scaleRoot.scale.setScalar(target);
            marker.scaleTransition = undefined;
        } else {
            marker.scaleTransition = {
                startedAt: now,
                durationMs: duration,
                from,
                to: target,
            };
        }

        if (duration > 0) this.markTransientAnimationStarted();
        this.map.triggerRepaint();
        return true;
    }

    private updateScaleTransition(marker: RuntimeMarker, now: number): void {
        const transition = marker.scaleTransition;
        if (!transition) {
            return;
        }

        const progress = Math.min(
            Math.max((now - transition.startedAt) / transition.durationMs, 0),
            1,
        );
        const eased = progress * progress * (3 - 2 * progress);
        const scale = THREE.MathUtils.lerp(transition.from, transition.to, eased);
        marker.scaleRoot.scale.setScalar(scale);

        if (progress >= 1) {
            marker.scaleRoot.scale.setScalar(transition.to);
            marker.scaleTransition = undefined;
        }
    }

    /**
     * Plays one of the two route-triggered marker animations. `start` is a launch
     * pulse for the origin marker; `end` is a brighter double pulse for arrival.
     */
    public playRouteMarkerAnimation(
        markerId: string,
        role: RouteMarkerAnimation,
    ): boolean {
        const marker = this.markers.find(item => item.definition.id === markerId);
        if (!marker || this.disposed) return false;

        marker.routePulse = {
            startedAt: performance.now(),
            durationMs: role === 'start' ? 680 : 980,
            role,
        };
        this.markTransientAnimationStarted();
        this.map.triggerRepaint();
        return true;
    }

    private updateRoutePulse(marker: RuntimeMarker, now: number): void {
        const pulse = marker.routePulse;
        if (!pulse) {
            marker.pulseRoot.scale.setScalar(1);
            marker.routePulseLiftMeters = 0;
            return;
        }

        const progress = THREE.MathUtils.clamp(
            (now - pulse.startedAt) / pulse.durationMs,
            0,
            1,
        );

        if (pulse.role === 'start') {
            // A quick departure pop with a slight upward lift.
            let scale: number;
            if (progress < 0.28) {
                const t = progress / 0.28;
                scale = THREE.MathUtils.lerp(1, 1.28, 1 - Math.pow(1 - t, 3));
            } else {
                const t = (progress - 0.28) / 0.72;
                scale = THREE.MathUtils.lerp(1.28, 1, t * t * (3 - 2 * t));
            }
            marker.pulseRoot.scale.setScalar(scale);
            marker.routePulseLiftMeters = 14 * Math.sin(Math.PI * progress);
        } else {
            // Two damped arrival pulses; state scale remains untouched.
            const wave = Math.sin(progress * Math.PI * 4);
            const scale = Math.max(0.82, 1 + 0.31 * wave * Math.exp(-2.25 * progress));
            marker.pulseRoot.scale.setScalar(scale);
            marker.routePulseLiftMeters = 6 * Math.sin(Math.PI * progress);
        }

        if (progress >= 1) {
            marker.routePulse = undefined;
            marker.pulseRoot.scale.setScalar(1);
            marker.routePulseLiftMeters = 0;
        }
    }

    private updateShadowFrustum(marker: RuntimeMarker): void {
        const baseHeight = Math.max(marker.definition.modelHeightMeters ?? 160, 0.01);
        const height = baseHeight * marker.scaleRoot.scale.x * marker.pulseRoot.scale.x;
        const halfExtent = Math.max(height * 0.7, 4);
        const distance = Math.max(height * 3.5, 40);
        const shadowCamera = this.keyLight.shadow.camera as THREE.OrthographicCamera;

        // The light follows the model's center but retains a constant direction.
        this.keyLight.target.position.set(
            marker.pivot.position.x,
            marker.pivot.position.y,
            marker.pivot.position.z + height * 0.5,
        );
        this.keyLight.position.copy(this.keyLight.target.position)
            .addScaledVector(this.shadowLightDirection, distance);

        shadowCamera.left = -halfExtent;
        shadowCamera.right = halfExtent;
        shadowCamera.top = halfExtent;
        shadowCamera.bottom = -halfExtent;
        shadowCamera.near = 0.1;
        shadowCamera.far = distance + height * 2;
        shadowCamera.up.set(0, 0, 1);
        shadowCamera.updateProjectionMatrix();

        this.keyLight.target.updateMatrixWorld(true);
        this.keyLight.updateMatrixWorld(true);
    }

    onAdd: NonNullable<CustomLayerInterface['onAdd']> = (map, gl) => {
        this.startedAt = performance.now();
        this.lastFrameAt = this.startedAt;

        this.renderer = new THREE.WebGLRenderer({
            canvas: map.getCanvas(),
            context: gl,
            antialias: true,
        });
        this.renderer.autoClear = false;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.88;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    };

    render: NonNullable<CustomLayerInterface['render']> = (_gl, args) => {
        const renderer = this.renderer;
        const origin = this.sceneOriginMercator;
        if (!renderer || !origin || this.disposed || this.markers.length === 0) {
            return;
        }

        const now = performance.now();
        const elapsedSeconds = (now - this.startedAt) / 1000;
        const deltaSeconds = Math.min(
            Math.max((now - this.lastFrameAt) / 1000, 0),
            0.1,
        );
        this.lastFrameAt = now;

        // IMPORTANT: projection/camera transform is calculated once per map frame
        // from a fixed Mercator origin. Marker positions live in the scene itself.
        // This keeps each object anchored while MapLibre pans, zooms and pitches.
        const mapProjection = new THREE.Matrix4().fromArray(
            args.defaultProjectionData.mainMatrix,
        );
        const sceneTransform = new THREE.Matrix4()
            .makeTranslation(origin.x, origin.y, origin.z)
            .scale(new THREE.Vector3(
                this.metersToMercator,
                -this.metersToMercator,
                this.metersToMercator,
            ));
        const projectionMatrix = mapProjection.multiply(sceneTransform);

        this.camera.projectionMatrix.copy(projectionMatrix);
        this.camera.projectionMatrixInverse
            .copy(projectionMatrix)
            .invert();

        for (const marker of this.markers) {
            this.updateColorTransitions(marker, now);
            this.updateScaleTransition(marker, now);

            const animation = marker.definition.animation;
            const rotationSpeed = animation?.rotationRadiansPerSecond ?? 0.65;
            const floatAmplitude = animation?.floatAmplitudeMeters ?? 8;
            const floatPeriodSeconds = Math.max(
                (animation?.floatPeriodMs ?? 2800) / 1000,
                0.001,
            );
            const phase = animation?.phaseRadians ?? marker.index * Math.PI / 2;
            const floatOffset = marker.isCurrent
                ? floatAmplitude * Math.sin(
                    elapsedSeconds / floatPeriodSeconds * Math.PI * 2 + phase,
                )
                : 0;

            this.updateRoutePulse(marker, now);
            if (Math.abs(rotationSpeed) <= 1e-6) {
                this.updateCameraFacingRotation(marker, deltaSeconds);
            } else {
                marker.pivot.rotation.z = elapsedSeconds * rotationSpeed;
                marker.cameraFacingYaw = undefined;
            }
            marker.mixer?.update(deltaSeconds);

            // queryTerrainElevation can be null before the DEM tile is available.
            // Retry until a value is returned, then cache it: re-sampling every frame
            // while panning can otherwise cause small apparent vertical jumps.
            if (marker.groundElevationMeters === undefined) {
                const elevation = this.map.queryTerrainElevation(marker.lngLat);
                if (elevation !== null && elevation !== undefined) {
                    marker.groundElevationMeters = elevation;
                }
            }

            const groundElevation =
                marker.groundElevationMeters ?? this.sceneOriginElevationMeters;
            const baseZ = groundElevation
                + (marker.definition.altitudeMeters ?? 0)
                - this.sceneOriginElevationMeters;

            marker.pivot.position.set(
                marker.localX,
                marker.localY,
                baseZ + floatOffset + marker.routePulseLiftMeters,
            );

            this.updateShadowFrustum(marker);
            marker.pivot.visible = true;
            try {
                renderer.resetState();
                renderer.render(this.scene, this.camera);
            } finally {
                marker.pivot.visible = false;
            }
        }

        this.checkTransientAnimationCompletion();
        this.map.triggerRepaint();
    };

    private updateCameraFacingRotation(marker: RuntimeMarker, deltaSeconds: number): void {
        const targetYaw = Math.PI - THREE.MathUtils.degToRad(this.map.getBearing());
        const currentYaw = marker.cameraFacingYaw ?? marker.pivot.rotation.z;
        const fullTurn = Math.PI * 2;
        const difference = THREE.MathUtils.euclideanModulo(
            targetYaw - currentYaw + Math.PI,
            fullTurn,
        ) - Math.PI;
        const response = 1 - Math.exp(-deltaSeconds / this.cameraFacingFrictionSeconds);
        const nextYaw = currentYaw + difference * response;
        marker.cameraFacingYaw = nextYaw;
        marker.pivot.rotation.z = nextYaw;
    }

    private markTransientAnimationStarted(): void {
        MapAnimationTracker.setActive(this, true);
    }

    private hasRunningTransientAnimations(): boolean {
        return this.markers.some(marker =>
            marker.scaleTransition !== undefined
            || marker.routePulse !== undefined
            || Object.values(marker.colorTransitions).some(transition => transition !== undefined),
        );
    }

    private checkTransientAnimationCompletion(): void {
        MapAnimationTracker.setActive(this, this.hasRunningTransientAnimations());
    }

    onRemove: NonNullable<CustomLayerInterface['onRemove']> = () => {
        this.disposed = true;
        this.releaseResources();
    };

    public dispose(): void {
        this.disposed = true;
        if (this.map.getLayer(this.id)) {
            this.map.removeLayer(this.id);
        } else {
            this.releaseResources();
        }
    }

    private releaseResources(): void {
        MapAnimationTracker.unregister(this);
        for (const marker of this.markers) {
            marker.mixer?.stopAllAction();
        }

        this.disposeObjects([this.scene]);
        this.scene.clear();
        this.renderer?.dispose();
        this.renderer = undefined;
        this.markers.length = 0;
    }

    private disposeObjects(roots: THREE.Object3D[]): void {
        const geometries = new Set<THREE.BufferGeometry>();
        const materials = new Set<THREE.Material>();
        const textures = new Set<THREE.Texture>();

        for (const root of roots) {
            root.traverse(object => {
                const mesh = object as THREE.Mesh;
                if (!mesh.isMesh) {
                    return;
                }

                geometries.add(mesh.geometry);
                const meshMaterials = Array.isArray(mesh.material)
                    ? mesh.material
                    : [mesh.material];

                for (const material of meshMaterials) {
                    materials.add(material);
                    for (const value of Object.values(material)) {
                        if (value instanceof THREE.Texture) {
                            textures.add(value);
                        }
                    }
                }
            });
        }

        for (const geometry of geometries) geometry.dispose();
        for (const material of materials) material.dispose();
        for (const texture of textures) texture.dispose();
    }
}

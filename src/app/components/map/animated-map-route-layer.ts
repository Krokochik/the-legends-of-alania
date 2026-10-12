import { MercatorCoordinate } from 'maplibre-gl';
import type { CustomLayerInterface, Map as MapLibreMap } from 'maplibre-gl';
import * as THREE from 'three';
import { MapAnimationTracker } from './map-animation-tracker';

import type { MapModelMarkerDefinition, MapModelPosition } from './map-model-markers';
import {
    MAP_ROUTE_APPEARANCE,
    MAP_ROUTE_TIMING,
    type MapRouteDefinition,
    type MapRouteLineAppearance,
    type MapRoutePoint,
} from './map-routes';

export type RouteMarkerAnimation = 'start' | 'approach' | 'end';
export type RouteMarkerAnimationCallback = (markerId: string, animation: RouteMarkerAnimation) => void;
export type RouteRevealProgressCallback = (
    routeId: string,
    center: [number, number],
    revealing: boolean,
    revealedDistanceMeters: number,
    terrainElevationMeters?: number
) => void;

interface ImageSize {
    width: number;
    height: number;
}

interface LogicalMapSize {
    width: number;
    height: number;
}

interface TerrainHeightMapTargetLike {
    texture: WebGLTexture;
    width: number;
    height: number;
    bounds: [number, number, number, number];
}

interface DashRuntime {
    index: number;
    startDistance: number;
    endDistance: number;
    length: number;
    mesh: THREE.Mesh;
    profile: THREE.Vector3[];
    segmentCount: number;
    lastPartialSegment: number;
}

interface RouteParticle {
    active: boolean;
    position: THREE.Vector3;
    origin: THREE.Vector3;
    lateral: THREE.Vector3;
    tangent: THREE.Vector3;
    lateralTravelMeters: number;
    forwardTravelMeters: number;
    arcHeightMeters: number;
    velocity: THREE.Vector3;
    color: THREE.Color;
    bornAtMs: number;
    lifeSeconds: number;
}

interface RouteMaterialStyleSnapshot {
    color: THREE.Color;
    emissive: THREE.Color;
    emissiveIntensity: number;
    opacity: number;
    roughness: number;
    metalness: number;
}

interface RouteAppearanceTransition {
    startedAt: number;
    durationMs: number;
    from: RouteMaterialStyleSnapshot;
    to: RouteMaterialStyleSnapshot;
}

interface RuntimeRoute {
    definition: MapRouteDefinition;
    group: THREE.Group;
    pathPoints: THREE.Vector3[];
    cumulativeDistances: number[];
    totalLength: number;
    terrainDistances: number[];
    terrainRaw: Array<number | null>;
    terrainSmoothed: number[];
    terrainMissing: boolean;
    terrainProfileMissing: boolean;
    lastTerrainPollAt: number;
    terrainPollAttempts: number;
    dashes: DashRuntime[];
    dashMaterial: THREE.MeshStandardMaterial;
    appearanceIsCurrent: boolean;
    appearanceTransition?: RouteAppearanceTransition;
    particleMesh: THREE.InstancedMesh;
    particleStates: RouteParticle[];
    particleColors: THREE.Color[];
    nextParticleIndex: number;
    particleSequence: number;
    randomSeed: number;
    emissionAccumulator: number;
    desiredVisible: boolean;
    revealing: boolean;
    revealStartedAt: number;
    revealedDistance: number;
    lastFrameAt: number;
    startAnimationTriggered: boolean;
    endAppearanceTriggered: boolean;
    endAnimationTriggered: boolean;
}

const DEFAULT_PARTICLE_COLORS: [string, string, string] = [
    '#8fffe0', '#b9a0ff', '#fff2a1',
];

export class AnimatedMapRouteLayer implements CustomLayerInterface {
    readonly id = 'animated-map-routes';
    readonly type = 'custom' as const;
    readonly renderingMode = '3d' as const;

    private readonly scene = new THREE.Scene();
    private readonly camera = new THREE.Camera();
    private renderer?: THREE.WebGLRenderer;
    private disposed = false;
    private startedAt = 0;
    private lastFrameAt = 0;

    private terrainHeightMapBounds: [number, number, number, number] = [0, 0, 1, 1];
    private terrainHeightMapTarget?: TerrainHeightMapTargetLike;
    private terrainReadFramebuffer?: WebGLFramebuffer;
    private terrainHeightPixels?: Float32Array;
    private terrainHeightMapReady = false;
    private terrainHeightMapUnavailable = false;
    private terrainRefreshRequested = true;
    private lastTerrainHeightMapCaptureAt = Number.NEGATIVE_INFINITY;
    private terrainHeightMapGl?: WebGL2RenderingContext;
    private terrainHeightMapWarningShown = false;
    private terrainHeightMapRefreshTimer?: ReturnType<typeof setTimeout>;
    private readonly terrainHeightMapMaxDimension = 2048;
    private readonly terrainHeightMapTargetPixelSizeMeters = 8;
    private readonly terrainHeightMapRefreshIntervalMs = 120;

    private readonly originMercator: MercatorCoordinate;
    private readonly metersToMercator: number;
    private readonly originLngLat: [number, number];
    private readonly originElevationMeters = 0;
    private readonly routes: RuntimeRoute[] = [];
    private readonly tempParticleMatrix = new THREE.Matrix4();
    private readonly tempParticleColor = new THREE.Color();
    private readonly tempParticleQuaternion = new THREE.Quaternion();
    private readonly tempParticleScale = new THREE.Vector3();
    private readonly markerPositions = new Map<string, MapModelPosition>();
    private readonly unitDashBoxGeometry = new THREE.BoxGeometry(1, 1, 1);

    constructor(
        private readonly map: MapLibreMap,
        private readonly imageSize: ImageSize,
        private readonly logicalMapSize: LogicalMapSize,
        private readonly definitions: readonly MapRouteDefinition[],
        markerDefinitions: readonly MapModelMarkerDefinition[],
        originPosition: MapModelPosition | undefined,
        private readonly onMarkerAnimation?: RouteMarkerAnimationCallback,
        private readonly onRouteRevealProgress?: RouteRevealProgressCallback,
    ) {
        for (const marker of markerDefinitions) {
            this.markerPositions.set(marker.id, marker.position);
        }

        const firstRoutePoint = definitions[0]?.points[0];
        const candidate = originPosition
            ?? this.positionForRoutePoint(firstRoutePoint, markerDefinitions)
            ?? markerDefinitions[0]?.position;

        this.originLngLat = candidate
            ? this.resolvePosition(candidate)
            : [0, 0];
        this.originMercator = MercatorCoordinate.fromLngLat(this.originLngLat, 0);
        this.metersToMercator = this.originMercator.meterInMercatorCoordinateUnits();

        this.buildRoutes();
        this.terrainHeightMapBounds = this.calculateTerrainHeightMapBounds();
    }

    private calculateTerrainHeightMapBounds(): [number, number, number, number] {
        const allPoints = this.routes.flatMap(route => route.pathPoints);
        if (allPoints.length === 0) {
            const padding = 500 * this.metersToMercator;
            return [
                this.originMercator.x - padding,
                this.originMercator.y - padding,
                this.originMercator.x + padding,
                this.originMercator.y + padding,
            ];
        }

        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        let maxFootprintMeters = 0;

        for (const point of allPoints) {
            minX = Math.min(minX, point.x);
            maxX = Math.max(maxX, point.x);
            minY = Math.min(minY, point.y);
            maxY = Math.max(maxY, point.y);
        }

        for (const route of this.routes) {
            maxFootprintMeters = Math.max(
                maxFootprintMeters,
                route.definition.dash.widthMeters * 0.5
                    + Math.max(route.definition.dash.bendOffsetMeters ?? 0, 0),
            );
        }

        const paddingMeters = maxFootprintMeters + 250;
        const minMercatorX = this.originMercator.x + (minX - paddingMeters) * this.metersToMercator;
        const maxMercatorX = this.originMercator.x + (maxX + paddingMeters) * this.metersToMercator;
        const minMercatorY = this.originMercator.y - (maxY + paddingMeters) * this.metersToMercator;
        const maxMercatorY = this.originMercator.y - (minY - paddingMeters) * this.metersToMercator;

        return [minMercatorX, minMercatorY, maxMercatorX, maxMercatorY];
    }

    private initializeTerrainHeightMap(gl: WebGL2RenderingContext): void {
        this.terrainHeightMapGl = gl;

        if (!gl.getExtension('EXT_color_buffer_float')) {
            this.terrainHeightMapUnavailable = true;
            this.warnTerrainHeightMapOnce(
                'EXT_color_buffer_float is unavailable; using queryTerrainElevation fallback.',
            );
            return;
        }

        const [minX, minY, maxX, maxY] = this.terrainHeightMapBounds;
        const spanX = Math.max(maxX - minX, 1e-9);
        const spanY = Math.max(maxY - minY, 1e-9);
        const maxDimension = Math.max(32, Math.min(
            this.terrainHeightMapMaxDimension,
            Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || this.terrainHeightMapMaxDimension,
        ));

        const targetPixelSize = this.terrainHeightMapTargetPixelSizeMeters;
        const requestedWidth = Math.max(32, Math.ceil(spanX / this.metersToMercator / targetPixelSize));
        const requestedHeight = Math.max(32, Math.ceil(spanY / this.metersToMercator / targetPixelSize));
        const downscale = Math.min(1, maxDimension / Math.max(requestedWidth, requestedHeight));
        const width = Math.min(maxDimension, Math.max(32, Math.round(requestedWidth * downscale)));
        const height = Math.min(maxDimension, Math.max(32, Math.round(requestedHeight * downscale)));

        const previousTexture = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
        const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
        const texture = gl.createTexture();
        const framebuffer = gl.createFramebuffer();
        if (!texture || !framebuffer) {
            if (texture) gl.deleteTexture(texture);
            if (framebuffer) gl.deleteFramebuffer(framebuffer);
            this.terrainHeightMapUnavailable = true;
            this.warnTerrainHeightMapOnce('Could not allocate the rendered-terrain height-map resources.');
            return;
        }

        try {
            gl.bindTexture(gl.TEXTURE_2D, texture);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);

            gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
            if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
                throw new Error('Rendered-terrain height-map framebuffer is incomplete.');
            }

            this.terrainHeightMapTarget = {
                texture,
                width,
                height,
                bounds: this.terrainHeightMapBounds,
            };
            this.terrainReadFramebuffer = framebuffer;
            this.terrainHeightPixels = new Float32Array(width * height * 4);
        } catch (error) {
            gl.deleteTexture(texture);
            gl.deleteFramebuffer(framebuffer);
            this.terrainHeightMapUnavailable = true;
            this.warnTerrainHeightMapOnce(
                `Could not initialize rendered-terrain sampling; using queryTerrainElevation fallback. ${String(error)}`,
            );
        } finally {
            gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
            gl.bindTexture(gl.TEXTURE_2D, previousTexture);
        }
    }

    private warnTerrainHeightMapOnce(message: string): void {
        if (this.terrainHeightMapWarningShown) return;
        this.terrainHeightMapWarningShown = true;
        console.warn(`[AnimatedMapRouteLayer] ${message}`);
    }

    private readonly requestTerrainHeightMapRefresh = (): void => {
        this.terrainRefreshRequested = true;
        this.scheduleTerrainRefreshFrame();
    };

    private scheduleTerrainRefreshFrame(delayMs = this.terrainHeightMapRefreshIntervalMs): void {
        if (this.disposed || this.terrainHeightMapRefreshTimer !== undefined) return;
        this.terrainHeightMapRefreshTimer = setTimeout(() => {
            this.terrainHeightMapRefreshTimer = undefined;
            if (!this.disposed && this.terrainRefreshRequested) this.map.triggerRepaint();
        }, Math.max(0, delayMs));
    }

    private readonly onTerrainSourceData = (event: { sourceId?: string }): void => {
        if (event.sourceId === 'terrain-source') {
            this.requestTerrainHeightMapRefresh();
        }
    };

    private unregisterTerrainRefreshListeners(): void {
        if (this.terrainHeightMapRefreshTimer !== undefined) {
            clearTimeout(this.terrainHeightMapRefreshTimer);
            this.terrainHeightMapRefreshTimer = undefined;
        }
        this.map.off('move', this.requestTerrainHeightMapRefresh);
        this.map.off('moveend', this.requestTerrainHeightMapRefresh);
        this.map.off('sourcedata', this.onTerrainSourceData);
        this.map.off('styledata', this.requestTerrainHeightMapRefresh);
    }

    prerender: NonNullable<CustomLayerInterface['prerender']> = (gl, args) => {
        if (
            this.disposed
            || this.terrainHeightMapUnavailable
            || !this.terrainHeightMapTarget
            || !this.terrainReadFramebuffer
            || !this.terrainHeightPixels
            || !this.terrainRefreshRequested
        ) {
            return;
        }

        const renderTerrainHeightMap = (args as typeof args & {
            renderTerrainHeightMap?: (target: TerrainHeightMapTargetLike) => void;
        }).renderTerrainHeightMap;

        if (!renderTerrainHeightMap) {
            this.warnTerrainHeightMapOnce(
                'MapLibre did not provide renderTerrainHeightMap in this frame; terrain collision uses the queryTerrainElevation fallback.',
            );
            return;
        }

        const now = performance.now();
        const elapsedSinceCapture = now - this.lastTerrainHeightMapCaptureAt;
        if (elapsedSinceCapture < this.terrainHeightMapRefreshIntervalMs) {
            this.scheduleTerrainRefreshFrame(this.terrainHeightMapRefreshIntervalMs - elapsedSinceCapture);
            return;
        }
        this.lastTerrainHeightMapCaptureAt = now;
        if (this.terrainHeightMapRefreshTimer !== undefined) {
            clearTimeout(this.terrainHeightMapRefreshTimer);
            this.terrainHeightMapRefreshTimer = undefined;
        }

        const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
        const previousPackAlignment = gl.getParameter(gl.PACK_ALIGNMENT) as number;
        try {
            renderTerrainHeightMap(this.terrainHeightMapTarget);

            gl.bindFramebuffer(gl.FRAMEBUFFER, this.terrainReadFramebuffer);
            gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
            gl.readPixels(
                0,
                0,
                this.terrainHeightMapTarget.width,
                this.terrainHeightMapTarget.height,
                gl.RGBA,
                gl.FLOAT,
                this.terrainHeightPixels,
            );

            this.terrainHeightMapReady = true;
            this.terrainRefreshRequested = false;
            this.refreshRoutesFromRenderedTerrain();
        } catch (error) {
            this.warnTerrainHeightMapOnce(
                `Could not read the rendered-terrain height map; using queryTerrainElevation fallback. ${String(error)}`,
            );
            this.terrainRefreshRequested = false;
            this.terrainHeightMapUnavailable = true;
        } finally {
            gl.pixelStorei(gl.PACK_ALIGNMENT, previousPackAlignment);
            gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
        }
    };

    private refreshRoutesFromRenderedTerrain(): void {
        for (const route of this.routes) {
            const refreshed = route.terrainDistances.map((distance, sampleIndex) => {
                const localPoint = this.pathPointAt(
                    route.pathPoints,
                    route.cumulativeDistances,
                    distance,
                );
                const renderedHeight = this.sampleRenderedTerrainHeight(localPoint);
                if (renderedHeight !== null) return renderedHeight;

                if (this.isInsideTerrainHeightMapBounds(localPoint)) {
                    return route.terrainRaw[sampleIndex] ?? null;
                }
                return this.queryGroundElevation(this.lngLatAtLocalPoint(localPoint));
            });

            route.terrainRaw = refreshed;
            route.terrainSmoothed = this.smoothTerrain(
                refreshed,
                route.definition.terrain?.smoothingWindow ?? 5,
            );
            route.terrainProfileMissing = false;

            for (const dash of route.dashes) {
                dash.profile = this.buildDashVerticalProfile(route, dash, dash.segmentCount);
                this.writeDashGeometrySegments(
                    dash.mesh.geometry as THREE.BufferGeometry,
                    dash.profile,
                    route.definition.dash.widthMeters,
                    route.definition.dash.thicknessMeters,
                    true,
                );
                dash.lastPartialSegment = -1;
            }

            const validRatio = refreshed.filter(value => value !== null).length / Math.max(refreshed.length, 1);
            const centerProfileMissing = refreshed.some(value => value === null) && validRatio < 0.8;
            route.terrainMissing = (centerProfileMissing || route.terrainProfileMissing)
                && route.terrainPollAttempts < 15;
        }
    };

    private sampleRenderedTerrainHeight(localPoint: THREE.Vector3): number | null {
        const target = this.terrainHeightMapTarget;
        const pixels = this.terrainHeightPixels;
        if (!this.terrainHeightMapReady || !target || !pixels) return null;

        const mercatorX = this.originMercator.x + localPoint.x * this.metersToMercator;
        const mercatorY = this.originMercator.y - localPoint.y * this.metersToMercator;
        const [minX, minY, maxX, maxY] = target.bounds;
        if (mercatorX < minX || mercatorX > maxX || mercatorY < minY || mercatorY > maxY) {
            return null;
        }

        const x = THREE.MathUtils.clamp(
            (mercatorX - minX) / Math.max(maxX - minX, 1e-12) * (target.width - 1),
            0,
            target.width - 1,
        );
        const y = THREE.MathUtils.clamp(
            (maxY - mercatorY) / Math.max(maxY - minY, 1e-12) * (target.height - 1),
            0,
            target.height - 1,
        );

        const centerX = Math.round(x);
        const centerY = Math.round(y);
        let highest = Number.NEGATIVE_INFINITY;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const px = THREE.MathUtils.clamp(centerX + dx, 0, target.width - 1);
                const py = THREE.MathUtils.clamp(centerY + dy, 0, target.height - 1);
                const offset = (py * target.width + px) * 4;
                const elevation = pixels[offset];
                const loaded = pixels[offset + 3] > 0.5;
                if (loaded && Number.isFinite(elevation)) highest = Math.max(highest, elevation);
            }
        }
        return Number.isFinite(highest) ? highest : null;
    }

    private isInsideTerrainHeightMapBounds(localPoint: THREE.Vector3): boolean {
        const target = this.terrainHeightMapTarget;
        if (!target) return false;
        const mercatorX = this.originMercator.x + localPoint.x * this.metersToMercator;
        const mercatorY = this.originMercator.y - localPoint.y * this.metersToMercator;
        const [minX, minY, maxX, maxY] = target.bounds;
        return mercatorX >= minX && mercatorX <= maxX
            && mercatorY >= minY && mercatorY <= maxY;
    }

    private sampleGroundElevationAtLocalPoint(point: THREE.Vector3): number | null {
        const renderedTerrain = this.sampleRenderedTerrainHeight(point);
        if (renderedTerrain !== null) return renderedTerrain;

        if (this.terrainHeightMapReady && this.isInsideTerrainHeightMapBounds(point)) {
            return null;
        }
        return this.queryGroundElevation(this.lngLatAtLocalPoint(point));
    }

    private positionForRoutePoint(
        point: MapRoutePoint | undefined,
        markerDefinitions: readonly MapModelMarkerDefinition[],
    ): MapModelPosition | undefined {
        if (!point) return undefined;
        if (point.kind !== 'marker') return point;
        return markerDefinitions.find(marker => marker.id === point.markerId)?.position;
    }

    private buildRoutes(): void {
        for (const definition of this.definitions) {
            const route = this.buildRoute(definition);
            if (route) this.routes.push(route);
        }
    }

    private buildRoute(definition: MapRouteDefinition): RuntimeRoute | undefined {
        if (definition.points.length < 2) {
            console.error(`Route "${definition.id}" needs at least two points.`);
            return undefined;
        }

        const controlPoints: THREE.Vector3[] = [];
        for (const point of definition.points) {
            const position = this.resolveRoutePoint(point);
            if (!position) {
                console.error(`Route "${definition.id}" references an unknown marker or invalid point.`, point);
                return undefined;
            }
            controlPoints.push(this.toLocalXY(position));
        }

        const approximateCurve = new THREE.CatmullRomCurve3(
            controlPoints,
            false,
            'centripetal',
        );
        const approxLength = Math.max(approximateCurve.getLength(), 1);
        const segments = Math.max(controlPoints.length - 1, 1);
        const samplesPerSegment = THREE.MathUtils.clamp(
            Math.ceil((approxLength / segments) / 10),
            24,
            450,
        );
        const divisionCount = segments * samplesPerSegment;
        const curveSamples = approximateCurve.getPoints(divisionCount);
        const pathPoints: THREE.Vector3[] = [];
        const cumulativeDistances: number[] = [0];

        for (const point of curveSamples) {
            const xy = new THREE.Vector3(point.x, point.y, 0);
            if (pathPoints.length) {
                const previous = pathPoints[pathPoints.length - 1];
                const distance = Math.hypot(xy.x - previous.x, xy.y - previous.y);
                if (distance < 1e-4) continue;
                cumulativeDistances.push(cumulativeDistances[cumulativeDistances.length - 1] + distance);
            }
            pathPoints.push(xy);
        }

        const totalLength = cumulativeDistances[cumulativeDistances.length - 1] ?? 0;
        if (pathPoints.length < 2 || totalLength < 1) {
            console.error(`Route "${definition.id}" is too short to render.`);
            return undefined;
        }

        const terrainSpacing = Math.max(definition.terrain?.sampleSpacingMeters ?? 24, 5);
        const terrainCount = Math.max(2, Math.ceil(totalLength / terrainSpacing) + 1);
        const terrainDistances = Array.from(
            { length: terrainCount },
            (_, index) => (totalLength * index) / (terrainCount - 1),
        );
        const terrainRaw = terrainDistances.map(distance => this.queryGroundElevation(
            this.lngLatAtLocalPoint(this.pathPointAt(pathPoints, cumulativeDistances, distance)),
        ));
        const terrainSmoothed = this.smoothTerrain(terrainRaw, definition.terrain?.smoothingWindow ?? 5);
        const terrainMissing = terrainRaw.some(value => value === null);

        const group = new THREE.Group();
        group.visible = false;
        this.scene.add(group);

        const initialLineStyle = MAP_ROUTE_APPEARANCE.other;
        const dashMaterial = new THREE.MeshStandardMaterial({
            color: initialLineStyle.color,
            emissive: initialLineStyle.emissive,
            emissiveIntensity: initialLineStyle.emissiveIntensity,
            roughness: initialLineStyle.roughness,
            metalness: initialLineStyle.metalness,
            opacity: initialLineStyle.opacity,
            transparent: initialLineStyle.opacity < 1,
            depthWrite: initialLineStyle.opacity >= 1,
        });

        const particleConfig = definition.particles;
        const particleCapacity = Math.max(24, Math.min(particleConfig?.maxParticles ?? 320, 1200));
        const particleGeometry = new THREE.SphereGeometry(1, 7, 5);
        const particleMaterial = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            blending: THREE.AdditiveBlending,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
        });
        const particleMesh = new THREE.InstancedMesh(particleGeometry, particleMaterial, particleCapacity);
        particleMesh.count = particleCapacity;
        particleMesh.frustumCulled = false;
        particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        group.add(particleMesh);

        const particleColorStrings = particleConfig?.colors ?? DEFAULT_PARTICLE_COLORS;
        const particleColors = particleColorStrings.map(color => new THREE.Color(color));
        const particleStates: RouteParticle[] = Array.from({ length: particleCapacity }, () => ({
            active: false,
            position: new THREE.Vector3(),
            origin: new THREE.Vector3(),
            lateral: new THREE.Vector3(0, 1, 0),
            tangent: new THREE.Vector3(1, 0, 0),
            lateralTravelMeters: 0,
            forwardTravelMeters: 0,
            arcHeightMeters: 0,
            velocity: new THREE.Vector3(),
            color: new THREE.Color('#ffffff'),
            bornAtMs: 0,
            lifeSeconds: Math.max((particleConfig?.lifetimeMs ?? 680) / 1000, 0.05),
        }));

        const route: RuntimeRoute = {
            definition,
            group,
            pathPoints,
            cumulativeDistances,
            totalLength,
            terrainDistances,
            terrainRaw,
            terrainSmoothed,
            terrainMissing,
            terrainProfileMissing: false,
            lastTerrainPollAt: performance.now(),
            terrainPollAttempts: 0,
            dashes: [],
            dashMaterial,
            appearanceIsCurrent: false,
            appearanceTransition: undefined,
            particleMesh,
            particleStates,
            particleColors,
            nextParticleIndex: 0,
            particleSequence: 0,
            randomSeed: this.hashString(definition.id) || 0x1234567,
            emissionAccumulator: 0,
            desiredVisible: false,
            revealing: false,
            revealStartedAt: 0,
            revealedDistance: 0,
            lastFrameAt: performance.now(),
            startAnimationTriggered: false,
            endAppearanceTriggered: false,
            endAnimationTriggered: false,
        };

        route.dashes = this.createDashes(route);
        route.terrainProfileMissing = false;
        for (const dash of route.dashes) {
            dash.segmentCount = this.getDashVerticalSegmentCount(
                dash,
                definition.dash.shape,
            );
            dash.profile = this.buildDashVerticalProfile(route, dash, dash.segmentCount);

            const geometry = this.createDashGeometry(
                dash.profile,
                definition.dash.widthMeters,
                definition.dash.thicknessMeters,
            );
            const mesh = new THREE.Mesh(geometry, dashMaterial);
            mesh.visible = false;
            mesh.castShadow = false;
            mesh.receiveShadow = false;
            mesh.frustumCulled = false;
            dash.mesh = mesh;
            group.add(mesh);
        }
        route.terrainMissing = route.terrainMissing || route.terrainProfileMissing;

        const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
        for (let i = 0; i < particleCapacity; i++) {
            particleMesh.setMatrixAt(i, zeroMatrix);
            particleMesh.setColorAt(i, new THREE.Color('#000000'));
        }
        particleMesh.instanceMatrix.needsUpdate = true;
        if (particleMesh.instanceColor) particleMesh.instanceColor.needsUpdate = true;

        return route;
    }

    private createDashes(route: RuntimeRoute): DashRuntime[] {
        const config = route.definition.dash;
        const requestedDashLength = Math.max(config.lengthMeters, 1);
        const requestedGapLength = Math.max(config.gapMeters, 0);
        const dashCount = Math.max(
            1,
            Math.round((route.totalLength + requestedGapLength) / (requestedDashLength + requestedGapLength)),
        );
        const dashLength = Math.min(requestedDashLength, route.totalLength / dashCount);
        const gapLength = dashCount > 1
            ? Math.max(0, (route.totalLength - dashCount * dashLength) / (dashCount - 1))
            : 0;

        const result: DashRuntime[] = [];
        for (let index = 0; index < dashCount; index++) {
            const startDistance = index * (dashLength + gapLength);
            const endDistance = index === dashCount - 1
                ? route.totalLength
                : Math.min(route.totalLength, startDistance + dashLength);
            result.push({
                index,
                startDistance,
                endDistance,
                length: endDistance - startDistance,
                mesh: undefined as unknown as THREE.Mesh,
                profile: [],
                segmentCount: 0,
                lastPartialSegment: -1,
            });
        }
        return result;
    }

    private resolveRoutePoint(point: MapRoutePoint): [number, number] | undefined {
        if (point.kind === 'marker') {
            const markerPosition = this.markerPositions.get(point.markerId);
            return markerPosition ? this.resolvePosition(markerPosition) : undefined;
        }
        return this.resolvePosition(point);
    }

    private resolvePosition(position: MapModelPosition): [number, number] {
        if (position.kind === 'lng-lat') return [position.lng, position.lat];

        const offsetX = (this.imageSize.width - this.logicalMapSize.width) / 2;
        const offsetY = (this.imageSize.height - this.logicalMapSize.height) / 2;
        return [
            (offsetX + position.x) / this.imageSize.width,
            (this.imageSize.height - offsetY - position.y) / this.imageSize.width,
        ];
    }

    private toLocalXY(lngLat: [number, number]): THREE.Vector3 {
        const coordinate = MercatorCoordinate.fromLngLat(lngLat, 0);
        return new THREE.Vector3(
            (coordinate.x - this.originMercator.x) / this.metersToMercator,
            (this.originMercator.y - coordinate.y) / this.metersToMercator,
            0,
        );
    }

    private lngLatAtLocalPoint(point: THREE.Vector3): [number, number] {
        const coordinate = new MercatorCoordinate(
            this.originMercator.x + point.x * this.metersToMercator,
            this.originMercator.y - point.y * this.metersToMercator,
            0,
        );
        const lngLat = coordinate.toLngLat();
        return [lngLat.lng, lngLat.lat];
    }

    private queryGroundElevation(lngLat: [number, number]): number | null {
        const elevation = this.map.queryTerrainElevation(lngLat);
        return elevation === null || elevation === undefined || !Number.isFinite(elevation)
            ? null
            : elevation;
    }

    private smoothTerrain(values: Array<number | null>, requestedWindow: number): number[] {
        const resolved = values.map((value, index) => {
            if (value !== null) return value;
            for (let delta = 1; delta < values.length; delta++) {
                const before = index - delta;
                const after = index + delta;
                if (before >= 0 && values[before] !== null) return values[before] as number;
                if (after < values.length && values[after] !== null) return values[after] as number;
            }
            return 0;
        });

        let windowSize = Math.max(1, Math.floor(requestedWindow));
        if (windowSize % 2 === 0) windowSize++;
        windowSize = Math.min(windowSize, resolved.length % 2 === 0 ? resolved.length - 1 : resolved.length);
        if (windowSize <= 1) return resolved;

        const radius = Math.floor(windowSize / 2);
        const result: number[] = [];
        for (let i = 0; i < resolved.length; i++) {
            let weightedSum = 0;
            let weights = 0;
            for (let offset = -radius; offset <= radius; offset++) {
                const sample = Math.max(0, Math.min(resolved.length - 1, i + offset));
                const weight = radius + 1 - Math.abs(offset);
                weightedSum += resolved[sample] * weight;
                weights += weight;
            }
            result.push(weightedSum / weights);
        }
        return result;
    }

    private pollTerrain(route: RuntimeRoute, now: number): void {
        if (!route.terrainMissing || route.terrainPollAttempts >= 15 || now - route.lastTerrainPollAt < 900) return;
        route.lastTerrainPollAt = now;
        route.terrainPollAttempts++;
        const refreshed = route.terrainDistances.map((distance, sampleIndex) => {
            const point = this.pathPointAt(route.pathPoints, route.cumulativeDistances, distance);
            return this.sampleGroundElevationAtLocalPoint(point)
                ?? route.terrainRaw[sampleIndex]
                ?? this.queryGroundElevation(this.lngLatAtLocalPoint(point));
        });
        route.terrainRaw = refreshed;
        route.terrainSmoothed = this.smoothTerrain(refreshed, route.definition.terrain?.smoothingWindow ?? 5);
        route.terrainProfileMissing = false;
        for (const dash of route.dashes) {
            dash.profile = this.buildDashVerticalProfile(route, dash, dash.segmentCount);
            this.writeDashGeometrySegments(
                dash.mesh.geometry as THREE.BufferGeometry,
                dash.profile,
                route.definition.dash.widthMeters,
                route.definition.dash.thicknessMeters,
                true,
            );
        }
        const validRatio = refreshed.filter(value => value !== null).length / Math.max(refreshed.length, 1);

        const centerProfileMissing = refreshed.some(value => value === null)
            && validRatio < 0.8;
        route.terrainMissing = (centerProfileMissing || route.terrainProfileMissing)
            && route.terrainPollAttempts < 15;
    }

    private terrainAt(route: RuntimeRoute, distance: number): number {
        const count = route.terrainSmoothed.length;
        if (count === 0) return 0;
        if (count === 1) return route.terrainSmoothed[0];

        const t = THREE.MathUtils.clamp(distance / Math.max(route.totalLength, 1) * (count - 1), 0, count - 1);
        const index = Math.floor(t);
        const fraction = t - index;
        const p0 = route.terrainSmoothed[Math.max(0, index - 1)];
        const p1 = route.terrainSmoothed[index];
        const p2 = route.terrainSmoothed[Math.min(count - 1, index + 1)];
        const p3 = route.terrainSmoothed[Math.min(count - 1, index + 2)];

        const m1 = (p2 - p0) * 0.5;
        const m2 = (p3 - p1) * 0.5;
        const t2 = fraction * fraction;
        const t3 = t2 * fraction;
        const interpolated = (2 * t3 - 3 * t2 + 1) * p1
            + (t3 - 2 * t2 + fraction) * m1
            + (-2 * t3 + 3 * t2) * p2
            + (t3 - t2) * m2;
        return THREE.MathUtils.clamp(
            interpolated,
            Math.min(p1, p2),
            Math.max(p1, p2),
        );
    }

    private pathPointAt(
        points: THREE.Vector3[],
        cumulative: number[],
        distance: number,
    ): THREE.Vector3 {
        const total = cumulative[cumulative.length - 1] ?? 0;
        const clamped = THREE.MathUtils.clamp(distance, 0, total);
        let low = 0;
        let high = cumulative.length - 1;
        while (low < high) {
            const middle = Math.floor((low + high) / 2);
            if (cumulative[middle] < clamped) low = middle + 1;
            else high = middle;
        }
        const upper = Math.max(1, low);
        const lower = upper - 1;
        const segmentLength = cumulative[upper] - cumulative[lower];
        const fraction = segmentLength > 0 ? (clamped - cumulative[lower]) / segmentLength : 0;
        return points[lower].clone().lerp(points[upper], fraction);
    }

    private pointAtDistance(route: RuntimeRoute, distance: number): THREE.Vector3 {
        const point = this.pathPointAt(route.pathPoints, route.cumulativeDistances, distance);
        const clearance = route.definition.terrain?.clearanceMeters ?? 12;
        const thickness = route.definition.dash.thicknessMeters;
        point.z = this.terrainAt(route, distance) + clearance + thickness * 0.5 - this.originElevationMeters;
        return point;
    }

    private dashPoints(route: RuntimeRoute, dash: DashRuntime): [THREE.Vector3, THREE.Vector3, THREE.Vector3] {
        const start = this.pointAtDistance(route, dash.startDistance);
        const middleDistance = (dash.startDistance + dash.endDistance) * 0.5;
        const middle = this.pointAtDistance(route, middleDistance);
        const end = this.pointAtDistance(route, dash.endDistance);

        if (route.definition.dash.shape !== 'bent') return [start, middle, end];

        const before = this.pathPointAt(route.pathPoints, route.cumulativeDistances, Math.max(0, middleDistance - 5));
        const after = this.pathPointAt(route.pathPoints, route.cumulativeDistances, Math.min(route.totalLength, middleDistance + 5));
        const tangent = new THREE.Vector3(after.x - before.x, after.y - before.y, 0).normalize();
        const side = new THREE.Vector3(-tangent.y, tangent.x, 0);
        const seedFlip = this.hashString(route.definition.id) % 2 === 0 ? 1 : -1;
        const sign = (dash.index % 2 === 0 ? 1 : -1) * seedFlip;
        middle.addScaledVector(side, (route.definition.dash.bendOffsetMeters ?? 14) * sign);
        return [start, middle, end];
    }

    private getDashVerticalSegmentCount(
        dash: DashRuntime,
        shape: 'straight' | 'bent',
    ): number {
        const count = THREE.MathUtils.clamp(Math.ceil(dash.length / 8), 8, 48);

        return shape === 'bent' && count % 2 !== 0
            ? Math.min(count + 1, 48)
            : count;
    }

    private dashBasePointAt(
        controls: [THREE.Vector3, THREE.Vector3, THREE.Vector3],
        fraction: number,
        shape: 'straight' | 'bent',
    ): THREE.Vector3 {
        const t = THREE.MathUtils.clamp(fraction, 0, 1);
        if (shape === 'straight') {
            return controls[0].clone().lerp(controls[2], t);
        }
        if (t <= 0.5) {
            return controls[0].clone().lerp(controls[1], t * 2);
        }
        return controls[1].clone().lerp(controls[2], (t - 0.5) * 2);
    }

    private dashProfilePointAt(dash: DashRuntime, fraction: number): THREE.Vector3 {
        if (dash.profile.length === 0) return new THREE.Vector3();
        if (dash.profile.length === 1) return dash.profile[0].clone();

        const t = THREE.MathUtils.clamp(fraction, 0, 1) * dash.segmentCount;
        const index = Math.min(Math.floor(t), dash.segmentCount - 1);
        const localT = t - index;
        return dash.profile[index].clone().lerp(dash.profile[index + 1], localT);
    }

    private buildDashVerticalProfile(
        route: RuntimeRoute,
        dash: DashRuntime,
        segmentCount: number,
    ): THREE.Vector3[] {
        const controls = this.dashPoints(route, dash);
        const shape = route.definition.dash.shape;
        const clearance = route.definition.terrain?.clearanceMeters ?? 12;
        const thickness = Math.max(route.definition.dash.thicknessMeters, 0.1);
        const width = Math.max(route.definition.dash.widthMeters, 0.1);
        const sampleCount = segmentCount * 2;
        const requiredFloors: number[] = [];
        const basePoints: THREE.Vector3[] = [];

        const lateralIntervals = Math.max(2, Math.ceil(width / 20));
        const evenLateralIntervals = lateralIntervals % 2 === 0
            ? lateralIntervals
            : lateralIntervals + 1;
        const lateralOffsets = Array.from(
            { length: evenLateralIntervals + 1 },
            (_, index) => -width * 0.5 + width * index / evenLateralIntervals,
        );

        for (let i = 0; i <= sampleCount; i++) {
            const fraction = i / sampleCount;
            const point = this.dashBasePointAt(controls, fraction, shape);
            basePoints.push(point);

            const before = this.dashBasePointAt(
                controls,
                Math.max(0, fraction - 1 / sampleCount),
                shape,
            );
            const after = this.dashBasePointAt(
                controls,
                Math.min(1, fraction + 1 / sampleCount),
                shape,
            );
            const tangent = new THREE.Vector3(after.x - before.x, after.y - before.y, 0);
            if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0);
            tangent.normalize();
            const lateral = new THREE.Vector3(-tangent.y, tangent.x, 0).normalize();

            let highestGround = Number.NEGATIVE_INFINITY;
            for (const sideOffset of lateralOffsets) {
                const probe = point.clone().addScaledVector(lateral, sideOffset);
                const sampledGround = this.sampleGroundElevationAtLocalPoint(probe);
                if (sampledGround === null) route.terrainProfileMissing = true;
                const fallbackGround = this.terrainAt(
                    route,
                    dash.startDistance + fraction * dash.length,
                );
                highestGround = Math.max(
                    highestGround,
                    sampledGround ?? fallbackGround,
                );
            }
            requiredFloors.push(highestGround + clearance + thickness * 0.5);
        }

        const profile: THREE.Vector3[] = [];
        const requiredLift: number[] = [];
        for (let i = 0; i <= segmentCount; i++) {
            const point = basePoints[i * 2].clone();

            let sectionFloor = requiredFloors[i * 2];
            if (i > 0) sectionFloor = Math.max(sectionFloor, requiredFloors[i * 2 - 1]);
            if (i < segmentCount) sectionFloor = Math.max(sectionFloor, requiredFloors[i * 2 + 1]);

            profile.push(point);
            const deficit = sectionFloor - point.z;
            requiredLift.push(deficit > 0 ? deficit + 2 : 0);
        }

        const liftRadius = Math.max(2, Math.min(4, Math.floor(segmentCount / 3)));
        for (let i = 0; i < profile.length; i++) {
            let liftedAmount = 0;
            const first = Math.max(0, i - liftRadius);
            const last = Math.min(profile.length - 1, i + liftRadius);
            for (let sourceIndex = first; sourceIndex <= last; sourceIndex++) {
                const distance = Math.abs(sourceIndex - i) / liftRadius;
                const smoothstep = distance * distance * (3 - 2 * distance);
                const candidate = requiredLift[sourceIndex] * (1 - smoothstep);
                liftedAmount = Math.max(liftedAmount, candidate);
            }
            profile[i].z += liftedAmount;
        }

        return profile;
    }

    private createDashGeometry(
        profile: THREE.Vector3[],
        widthMeters: number,
        thicknessMeters: number,
    ): THREE.BufferGeometry {
        const segmentCount = Math.max(profile.length - 1, 1);
        const verticesPerSegment = this.unitDashBoxGeometry.getAttribute('position').count;
        const indexPerSegment = this.unitDashBoxGeometry.index?.count ?? 0;
        const positions = new Float32Array(segmentCount * verticesPerSegment * 3);
        const normals = new Float32Array(segmentCount * verticesPerSegment * 3);
        const indices = new Uint16Array(segmentCount * indexPerSegment);
        const unitIndices = this.unitDashBoxGeometry.index;

        for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
            for (let i = 0; i < indexPerSegment; i++) {
                indices[segmentIndex * indexPerSegment + i] =
                    segmentIndex * verticesPerSegment + (unitIndices?.getX(i) ?? 0);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage));
        geometry.setIndex(new THREE.BufferAttribute(indices, 1));

        this.writeDashGeometrySegments(
            geometry,
            profile,
            widthMeters,
            thicknessMeters,
            true,
        );
        geometry.setDrawRange(0, 0);
        return geometry;
    }

    private writeDashGeometrySegments(
        geometry: THREE.BufferGeometry,
        profile: THREE.Vector3[],
        widthMeters: number,
        thicknessMeters: number,
        writeAll: boolean,
    ): void {
        const position = geometry.getAttribute('position') as THREE.BufferAttribute;
        const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
        const segmentCount = Math.min(profile.length - 1, Math.floor(position.count / 24));

        for (let segmentIndex = 0; segmentIndex < segmentCount; segmentIndex++) {
            if (!writeAll && segmentIndex !== segmentCount - 1) continue;
            this.writeDashGeometrySegment(
                position,
                normal,
                segmentIndex,
                profile[segmentIndex],
                profile[segmentIndex + 1],
                widthMeters,
                thicknessMeters,
                segmentIndex > 0 ? 0.75 : 0,
                segmentIndex < segmentCount - 1 ? 0.75 : 0,
            );
        }
        position.needsUpdate = true;
        normal.needsUpdate = true;
        if (writeAll) geometry.computeBoundingSphere();
    }

    private writeDashGeometrySegment(
        positionAttribute: THREE.BufferAttribute,
        normalAttribute: THREE.BufferAttribute,
        segmentIndex: number,
        start: THREE.Vector3,
        end: THREE.Vector3,
        widthMeters: number,
        thicknessMeters: number,
        startOverlapMeters: number,
        endOverlapMeters: number,
    ): void {
        const originalDirection = end.clone().sub(start);
        const originalLength = originalDirection.length();
        if (originalLength < 1e-5) return;
        originalDirection.divideScalar(originalLength);

        const extendedStart = start.clone().addScaledVector(originalDirection, -startOverlapMeters);
        const extendedEnd = end.clone().addScaledVector(originalDirection, endOverlapMeters);
        const center = extendedStart.clone().add(extendedEnd).multiplyScalar(0.5);
        const length = extendedStart.distanceTo(extendedEnd);
        const direction = extendedEnd.clone().sub(extendedStart).normalize();
        const lateral = new THREE.Vector3(-direction.y, direction.x, 0);
        if (lateral.lengthSq() < 1e-8) lateral.set(0, 1, 0);
        lateral.normalize();
        const up = new THREE.Vector3().crossVectors(direction, lateral).normalize();

        const templatePosition = this.unitDashBoxGeometry.getAttribute('position');
        const templateNormal = this.unitDashBoxGeometry.getAttribute('normal');
        const vertexOffset = segmentIndex * 24;

        for (let vertex = 0; vertex < 24; vertex++) {
            const x = templatePosition.getX(vertex) * length;
            const y = templatePosition.getY(vertex) * widthMeters;
            const z = templatePosition.getZ(vertex) * thicknessMeters;

            const worldPosition = center.clone()
                .addScaledVector(direction, x)
                .addScaledVector(lateral, y)
                .addScaledVector(up, z);
            positionAttribute.setXYZ(vertexOffset + vertex, worldPosition.x, worldPosition.y, worldPosition.z);

            const transformedNormal = direction.clone().multiplyScalar(templateNormal.getX(vertex))
                .addScaledVector(lateral, templateNormal.getY(vertex))
                .addScaledVector(up, templateNormal.getZ(vertex))
                .normalize();
            normalAttribute.setXYZ(
                vertexOffset + vertex,
                transformedNormal.x,
                transformedNormal.y,
                transformedNormal.z,
            );
        }
    }

    private updateDashGeometryForReveal(route: RuntimeRoute, dash: DashRuntime, revealedLength: number): void {
        const segmentCount = dash.segmentCount;
        const revealFraction = THREE.MathUtils.clamp(revealedLength / Math.max(dash.length, 1e-6), 0, 1);
        const progress = revealFraction * segmentCount;
        const completeSegments = Math.min(Math.floor(progress), segmentCount);
        const partialFraction = progress - completeSegments;
        const visibleSegments = Math.min(segmentCount, completeSegments + (partialFraction > 1e-4 ? 1 : 0));
        const geometry = dash.mesh.geometry as THREE.BufferGeometry;

        if (dash.lastPartialSegment >= 0) {
            const previousPartial = dash.lastPartialSegment;
            this.writeDashGeometrySegment(
                geometry.getAttribute('position') as THREE.BufferAttribute,
                geometry.getAttribute('normal') as THREE.BufferAttribute,
                previousPartial,
                dash.profile[previousPartial],
                dash.profile[previousPartial + 1],
                route.definition.dash.widthMeters,
                route.definition.dash.thicknessMeters,
                previousPartial > 0 ? 0.75 : 0,
                previousPartial < segmentCount - 1 ? 0.75 : 0,
            );
            dash.lastPartialSegment = -1;
            (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
            (geometry.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
        }

        if (visibleSegments === 0) {
            dash.mesh.visible = false;
            geometry.setDrawRange(0, 0);
            return;
        }

        dash.mesh.visible = true;
        if (partialFraction > 1e-4 && completeSegments < segmentCount) {
            const partialStart = dash.profile[completeSegments];
            const partialEnd = this.dashProfilePointAt(
                dash,
                (completeSegments + partialFraction) / segmentCount,
            );
            this.writeDashGeometrySegment(
                geometry.getAttribute('position') as THREE.BufferAttribute,
                geometry.getAttribute('normal') as THREE.BufferAttribute,
                completeSegments,
                partialStart,
                partialEnd,
                route.definition.dash.widthMeters,
                route.definition.dash.thicknessMeters,
                completeSegments > 0 ? 0.75 : 0,
                0,
            );
            dash.lastPartialSegment = completeSegments;
            (geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
            (geometry.getAttribute('normal') as THREE.BufferAttribute).needsUpdate = true;
        }

        const indicesPerSegment = this.unitDashBoxGeometry.index?.count ?? 0;
        geometry.setDrawRange(0, visibleSegments * indicesPerSegment);
    }

    private updateDashGeometry(route: RuntimeRoute): void {
        const distance = route.revealedDistance;
        for (const dash of route.dashes) {
            const revealedLength = THREE.MathUtils.clamp(
                distance - dash.startDistance,
                0,
                dash.length,
            );

            if (revealedLength <= 0.01) {
                dash.mesh.visible = false;
                dash.mesh.geometry.setDrawRange(0, 0);
                continue;
            }

            this.updateDashGeometryForReveal(route, dash, revealedLength);
        }
    }

    private findCurrentDash(route: RuntimeRoute): { dash: DashRuntime; revealedLength: number } | undefined {
        const distance = Math.min(route.revealedDistance, Math.max(route.totalLength - 1e-4, 0));
        for (const dash of route.dashes) {
            if (distance >= dash.startDistance && distance <= dash.endDistance) {
                return {
                    dash,
                    revealedLength: THREE.MathUtils.clamp(distance - dash.startDistance, 0, dash.length),
                };
            }
        }
        return undefined;
    }

    private currentFront(route: RuntimeRoute, dash: DashRuntime, revealedLength: number): {
        position: THREE.Vector3;
        tangent: THREE.Vector3;
    } {
        const fraction = THREE.MathUtils.clamp(revealedLength / Math.max(dash.length, 1e-6), 0, 1);
        const step = 1 / Math.max(dash.segmentCount, 1);
        const position = this.dashProfilePointAt(dash, fraction);
        const before = this.dashProfilePointAt(dash, Math.max(0, fraction - step));
        const after = this.dashProfilePointAt(dash, Math.min(1, fraction + step));
        const tangent = after.sub(before);
        if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0);
        tangent.normalize();
        return { position, tangent };
    }

    private currentRouteFront(route: RuntimeRoute, distance: number): {
        position: THREE.Vector3;
        tangent: THREE.Vector3;
    } {
        const clampedDistance = THREE.MathUtils.clamp(distance, 0, route.totalLength);
        const position = this.pointAtDistance(route, clampedDistance);
        const sampleStep = Math.min(5, Math.max(route.totalLength / 1000, 0.5));
        const before = this.pathPointAt(
            route.pathPoints,
            route.cumulativeDistances,
            Math.max(0, clampedDistance - sampleStep),
        );
        const after = this.pathPointAt(
            route.pathPoints,
            route.cumulativeDistances,
            Math.min(route.totalLength, clampedDistance + sampleStep),
        );
        const tangent = new THREE.Vector3(after.x - before.x, after.y - before.y, 0);
        if (tangent.lengthSq() < 1e-8) tangent.set(1, 0, 0);
        tangent.normalize();
        return { position, tangent };
    }

    private spawnParticleBurst(
        route: RuntimeRoute,
        front: { position: THREE.Vector3; tangent: THREE.Vector3 },
        now: number,
    ): void {
        const particleConfig = route.definition.particles;
        const burstCount = Math.max(1, particleConfig?.particlesPerBurst ?? 6);
        const width = Math.max(route.definition.dash.widthMeters, 0.1);
        const thickness = Math.max(route.definition.dash.thicknessMeters, 0.1);
        const { position, tangent } = front;
        const travelDistanceMultiplier = Math.max(
            0,
            Number.isFinite(particleConfig?.travelDistanceMultiplier)
                ? particleConfig?.travelDistanceMultiplier ?? 1
                : 1,
        );
        const arcHeightMultiplier = Math.max(
            0,
            Number.isFinite(particleConfig?.arcHeightMultiplier)
                ? particleConfig?.arcHeightMultiplier ?? 1
                : 1,
        );
        const lateral = new THREE.Vector3(-tangent.y, tangent.x, 0);
        if (lateral.lengthSq() < 1e-8) lateral.set(0, 1, 0);
        lateral.normalize();

        for (let i = 0; i < burstCount; i++) {
            const particle = route.particleStates[route.nextParticleIndex];
            route.nextParticleIndex = (route.nextParticleIndex + 1) % route.particleStates.length;

            const across = burstCount === 1 ? 0 : i / (burstCount - 1) - 0.5;
            const jitter = (this.nextRandom(route) - 0.5) * width * 0.12;
            particle.origin.copy(position)
                .addScaledVector(lateral, across * width + jitter)
                .add(new THREE.Vector3(
                    0,
                    0,
                    (this.nextRandom(route) - 0.5) * thickness * 0.5,
                ));
            particle.position.copy(particle.origin);
            particle.lateral.copy(lateral);
            particle.tangent.copy(tangent);

            const sideSign = this.nextRandom(route) < 0.5 ? -1 : 1;
            particle.lateralTravelMeters = sideSign
                * width
                * (0.38 + this.nextRandom(route) * 0.82)
                * travelDistanceMultiplier;
            const isTangentOutlier = this.nextRandom(route) < 0.16;
            const tangentRange = isTangentOutlier ? 0.58 : 0.13;
            particle.forwardTravelMeters = (this.nextRandom(route) * 2 - 1)
                * width
                * tangentRange
                * travelDistanceMultiplier;
            particle.arcHeightMeters = Math.max(width * 0.14, thickness * 0.8, 4)
                * (0.55 + this.nextRandom(route) * 1.3)
                * arcHeightMultiplier;

            particle.velocity.copy(lateral).multiplyScalar(particle.lateralTravelMeters)
                .addScaledVector(tangent, particle.forwardTravelMeters);
            particle.velocity.z = particle.arcHeightMeters * 4;

            const colorIndex = route.particleSequence % route.particleColors.length;
            particle.color.copy(route.particleColors[colorIndex]);
            route.particleSequence++;
            particle.active = true;
            particle.bornAtMs = now;
            const baseLife = Math.max((particleConfig?.lifetimeMs ?? 680) / 1000, 0.05);
            particle.lifeSeconds = baseLife * (0.78 + this.nextRandom(route) * 0.48);
        }
    }

    private updateParticles(route: RuntimeRoute, now: number, _deltaSeconds: number): boolean {
        const config = route.definition.particles;
        if (!route.particleStates.some(particle => particle.active)) return false;

        let anyActive = false;
        const width = Math.max(route.definition.dash.widthMeters, 0.1);
        const baseSize = Math.max(
            config?.particleSizeMeters ?? width * (config?.particleSizeWidthRatio ?? 0.1),
            0.1,
        );

        for (let index = 0; index < route.particleStates.length; index++) {
            const particle = route.particleStates[index];
            const matrix = this.tempParticleMatrix;
            const color = this.tempParticleColor.set('#000000');

            if (particle.active) {
                const age = (now - particle.bornAtMs) / 1000;
                if (age >= particle.lifeSeconds) {
                    particle.active = false;
                } else {
                    const progress = THREE.MathUtils.clamp(age / particle.lifeSeconds, 0, 1);
                    particle.position.copy(particle.origin)
                        .addScaledVector(particle.lateral, particle.lateralTravelMeters * progress)
                        .addScaledVector(particle.tangent, particle.forwardTravelMeters * progress);
                    particle.position.z += 4 * particle.arcHeightMeters * progress * (1 - progress);

                    const lifeRatio = THREE.MathUtils.clamp(1 - progress, 0, 1);
                    const intensity = lifeRatio * lifeRatio * 1.7;
                    const size = baseSize * (0.42 + lifeRatio * 0.58);
                    matrix.compose(
                        particle.position,
                        this.tempParticleQuaternion,
                        this.tempParticleScale.set(size, size, size),
                    );
                    color.copy(particle.color).multiplyScalar(intensity);
                    anyActive = true;
                }
            }

            if (!particle.active) {
                matrix.makeScale(0, 0, 0);
            }
            route.particleMesh.setMatrixAt(index, matrix);
            route.particleMesh.setColorAt(index, color);
        }

        route.particleMesh.instanceMatrix.needsUpdate = true;
        if (route.particleMesh.instanceColor) route.particleMesh.instanceColor.needsUpdate = true;
        return anyActive;
    }

    private updateRoute(route: RuntimeRoute, now: number, deltaSeconds: number): void {
        this.updateMaterialAppearanceTransition(route, now);
        this.pollTerrain(route, now);

        if (!route.desiredVisible) {
            route.group.visible = false;
            return;
        }

        route.group.visible = true;
        if (route.revealing) {
            const speed = MAP_ROUTE_TIMING.revealSpeedMetersPerSecond;
            const elapsedSeconds = Math.max(0, (now - route.revealStartedAt) / 1000);
            route.revealedDistance = Math.min(
                route.totalLength,
                elapsedSeconds * speed,
            );

            const startMarkerId = this.getEndpointMarkerId(route, 'start');
            const endMarkerId = this.getEndpointMarkerId(route, 'end');
            const startDelayMs = Math.max(
                route.definition.animation?.startMarkerDelayMs ?? MAP_ROUTE_TIMING.startMarkerDelayMs,
                0,
            );
            const startTriggerDistance = speed * startDelayMs / 1000;

            const endLeadMs = MAP_ROUTE_TIMING.markerAppearanceTransitionMs
                + MAP_ROUTE_TIMING.arrivalSpringDelayMs;
            const endLeadDistance = speed * endLeadMs / 1000;
            const endAppearanceDistance = Math.max(0, route.totalLength - endLeadDistance);

            if (!route.startAnimationTriggered && startMarkerId && route.revealedDistance >= startTriggerDistance) {
                route.startAnimationTriggered = true;
                this.onMarkerAnimation?.(startMarkerId, 'start');
            }
            if (!route.endAppearanceTriggered && endMarkerId
                && route.revealedDistance >= endAppearanceDistance) {
                route.endAppearanceTriggered = true;
                this.onMarkerAnimation?.(endMarkerId, 'approach');
            }

            if (route.revealedDistance >= route.totalLength) {
                route.revealedDistance = route.totalLength;
                route.revealing = false;
                if (!route.endAnimationTriggered && endMarkerId) {
                    route.endAnimationTriggered = true;
                    this.onMarkerAnimation?.(endMarkerId, 'end');
                }
            }
        }

        if (route.desiredVisible) {
            const frontPoint = this.pathPointAt(
                route.pathPoints,
                route.cumulativeDistances,
                route.revealedDistance,
            );
            this.onRouteRevealProgress?.(
                route.definition.id,
                this.lngLatAtLocalPoint(frontPoint),
                route.revealing,
                route.revealedDistance,
            );
        }

        this.updateDashGeometry(route);

        if (route.revealing) {
            route.emissionAccumulator += deltaSeconds
                * Math.max(route.definition.particles?.emissionRatePerSecond ?? 28, 0);

            while (route.emissionAccumulator >= 1) {
                const currentDash = this.findCurrentDash(route);
                const front = currentDash
                    ? this.currentFront(route, currentDash.dash, currentDash.revealedLength)
                    : this.currentRouteFront(route, route.revealedDistance);

                this.spawnParticleBurst(route, front, now);
                route.emissionAccumulator -= 1;
            }
        }

        this.updateParticles(route, now, deltaSeconds);
    }

    private getEndpointMarkerId(route: RuntimeRoute, endpoint: 'start' | 'end'): string | undefined {
        const definition = route.definition;
        const explicit = endpoint === 'start' ? definition.startMarkerId : definition.endMarkerId;
        if (explicit) return explicit;
        const point = endpoint === 'start'
            ? definition.points[0]
            : definition.points.at(-1);
        return point?.kind === 'marker' ? point.markerId : undefined;
    }

    private hashString(value: string): number {
        let hash = 2166136261;
        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    private nextRandom(route: RuntimeRoute): number {
        route.randomSeed = (route.randomSeed + 0x6D2B79F5) >>> 0;
        let t = route.randomSeed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    private clearParticles(route: RuntimeRoute): void {
        const zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
        for (let index = 0; index < route.particleStates.length; index++) {
            route.particleStates[index].active = false;
            route.particleMesh.setMatrixAt(index, zeroMatrix);
            route.particleMesh.setColorAt(index, new THREE.Color('#000000'));
        }
        route.particleMesh.instanceMatrix.needsUpdate = true;
        if (route.particleMesh.instanceColor) route.particleMesh.instanceColor.needsUpdate = true;
    }

    private snapshotMaterialStyle(material: THREE.MeshStandardMaterial): RouteMaterialStyleSnapshot {
        return {
            color: material.color.clone(),
            emissive: material.emissive.clone(),
            emissiveIntensity: material.emissiveIntensity,
            opacity: material.opacity,
            roughness: material.roughness,
            metalness: material.metalness,
        };
    }

    private snapshotConfiguredStyle(style: MapRouteLineAppearance): RouteMaterialStyleSnapshot {
        return {
            color: new THREE.Color(style.color),
            emissive: new THREE.Color(style.emissive),
            emissiveIntensity: style.emissiveIntensity,
            opacity: style.opacity,
            roughness: style.roughness,
            metalness: style.metalness,
        };
    }

    private applyConfiguredMaterialStyle(
        material: THREE.MeshStandardMaterial,
        style: MapRouteLineAppearance,
    ): void {
        material.color.set(style.color);
        material.emissive.set(style.emissive);
        material.emissiveIntensity = style.emissiveIntensity;
        material.opacity = style.opacity;
        material.roughness = style.roughness;
        material.metalness = style.metalness;
        material.transparent = style.opacity < 1;
        material.depthWrite = style.opacity >= 1;
        material.needsUpdate = true;
    }

    private updateMaterialAppearanceTransition(route: RuntimeRoute, now: number): boolean {
        const transition = route.appearanceTransition;
        if (!transition) return false;

        const progress = THREE.MathUtils.clamp(
            (now - transition.startedAt) / transition.durationMs,
            0,
            1,
        );
        const eased = progress * progress * (3 - 2 * progress);
        const material = route.dashMaterial;

        material.color.lerpColors(transition.from.color, transition.to.color, eased);
        material.emissive.lerpColors(transition.from.emissive, transition.to.emissive, eased);
        material.emissiveIntensity = THREE.MathUtils.lerp(
            transition.from.emissiveIntensity,
            transition.to.emissiveIntensity,
            eased,
        );
        material.opacity = THREE.MathUtils.lerp(transition.from.opacity, transition.to.opacity, eased);
        material.roughness = THREE.MathUtils.lerp(transition.from.roughness, transition.to.roughness, eased);
        material.metalness = THREE.MathUtils.lerp(transition.from.metalness, transition.to.metalness, eased);

        if (progress >= 1) {
            const targetStyle = route.appearanceIsCurrent
                ? MAP_ROUTE_APPEARANCE.current
                : MAP_ROUTE_APPEARANCE.other;
            this.applyConfiguredMaterialStyle(material, targetStyle);
            route.appearanceTransition = undefined;
            return false;
        }

        return true;
    }

    private syncAnimationActivity(): void {
        MapAnimationTracker.setActive(this, this.routes.some(route =>
            route.revealing
            || route.appearanceTransition !== undefined
            || route.particleStates.some(particle => particle.active),
        ));
    }

    public setRouteCurrentState(routeId: string, isCurrent: boolean, animate = true): boolean {
        const route = this.routes.find(item => item.definition.id === routeId);
        if (!route || this.disposed) return false;

        if (route.appearanceIsCurrent === isCurrent) {
            if (!animate) {
                route.appearanceTransition = undefined;
                this.applyConfiguredMaterialStyle(
                    route.dashMaterial,
                    isCurrent ? MAP_ROUTE_APPEARANCE.current : MAP_ROUTE_APPEARANCE.other,
                );
            }
            this.syncAnimationActivity();
            return true;
        }

        route.appearanceIsCurrent = isCurrent;
        const targetStyle = isCurrent ? MAP_ROUTE_APPEARANCE.current : MAP_ROUTE_APPEARANCE.other;

        if (!animate || MAP_ROUTE_APPEARANCE.transitionDurationMs <= 0) {
            route.appearanceTransition = undefined;
            this.applyConfiguredMaterialStyle(route.dashMaterial, targetStyle);
            this.syncAnimationActivity();
            this.map.triggerRepaint();
            return true;
        }

        route.appearanceTransition = {
            startedAt: performance.now(),
            durationMs: MAP_ROUTE_APPEARANCE.transitionDurationMs,
            from: this.snapshotMaterialStyle(route.dashMaterial),
            to: this.snapshotConfiguredStyle(targetStyle),
        };

        route.dashMaterial.transparent = true;
        route.dashMaterial.depthWrite = false;
        route.dashMaterial.needsUpdate = true;
        this.syncAnimationActivity();
        this.map.triggerRepaint();
        return true;
    }

    public setRouteVisible(routeId: string, visible: boolean, animate = true): boolean {
        const route = this.routes.find(item => item.definition.id === routeId);
        if (!route || this.disposed) return false;

        if (route.desiredVisible === visible) {
            if (!animate && visible) {
                route.revealing = false;
                route.revealedDistance = route.totalLength;
                route.group.visible = true;
            }
            this.syncAnimationActivity();
            this.map.triggerRepaint();
            return true;
        }

        route.desiredVisible = visible;
        if (!visible) {
            route.revealing = false;
            route.revealedDistance = 0;
            route.group.visible = false;
            route.emissionAccumulator = 0;
            this.clearParticles(route);
            this.syncAnimationActivity();
            return true;
        }

        route.group.visible = true;
        route.emissionAccumulator = 0;
        route.startAnimationTriggered = !animate || !this.getEndpointMarkerId(route, 'start');
        route.endAppearanceTriggered = !animate || !this.getEndpointMarkerId(route, 'end');
        route.endAnimationTriggered = !animate || !this.getEndpointMarkerId(route, 'end');
        if (animate) {
            route.revealing = true;
            route.revealStartedAt = performance.now();
            route.revealedDistance = 0;
            route.lastFrameAt = route.revealStartedAt;
        } else {
            route.revealing = false;
            route.revealedDistance = route.totalLength;
            this.clearParticles(route);
        }
        this.syncAnimationActivity();
        this.map.triggerRepaint();
        return true;
    }

    async loadAndAdd(): Promise<void> {
        if (this.disposed || this.routes.length === 0) return;
        if (!this.map.getLayer(this.id)) this.map.addLayer(this);
    }

    onAdd: NonNullable<CustomLayerInterface['onAdd']> = (_map, gl) => {
        this.startedAt = performance.now();
        this.lastFrameAt = this.startedAt;
        this.initializeTerrainHeightMap(gl);
        this.map.on('move', this.requestTerrainHeightMapRefresh);
        this.map.on('moveend', this.requestTerrainHeightMapRefresh);
        this.map.on('sourcedata', this.onTerrainSourceData);
        this.map.on('styledata', this.requestTerrainHeightMapRefresh);
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.map.getCanvas(),
            context: gl,
            antialias: true,
        });
        this.renderer.autoClear = false;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 0.95;

        this.scene.add(new THREE.HemisphereLight(0xffffff, 0x4b5b73, 1.4));
        this.scene.add(new THREE.AmbientLight(0xffffff, 0.45));
        const key = new THREE.DirectionalLight(0xffffff, 1.0);
        key.position.set(-3, -4, 8);
        this.scene.add(key);
    };

    render: NonNullable<CustomLayerInterface['render']> = (_gl, args) => {
        if (!this.renderer || this.disposed || this.routes.length === 0) return;

        const now = performance.now();
        const deltaSeconds = Math.min(Math.max((now - this.lastFrameAt) / 1000, 0), 0.1);
        this.lastFrameAt = now;

        const mapProjection = new THREE.Matrix4().fromArray(args.defaultProjectionData.mainMatrix);
        const sceneTransform = new THREE.Matrix4()
            .makeTranslation(this.originMercator.x, this.originMercator.y, this.originMercator.z)
            .scale(new THREE.Vector3(
                this.metersToMercator,
                -this.metersToMercator,
                this.metersToMercator,
            ));
        const projectionMatrix = mapProjection.multiply(sceneTransform);
        this.camera.projectionMatrix.copy(projectionMatrix);
        this.camera.projectionMatrixInverse.copy(projectionMatrix).invert();

        let needsAnotherFrame = false;
        for (const route of this.routes) {
            this.updateRoute(route, now, deltaSeconds);
            if (
                route.revealing
                || route.appearanceTransition !== undefined
                || route.particleStates.some(particle => particle.active)
            ) {
                needsAnotherFrame = true;
            }
        }

        MapAnimationTracker.setActive(this, needsAnotherFrame);
        this.renderer.resetState();
        this.renderer.render(this.scene, this.camera);
        if (needsAnotherFrame) this.map.triggerRepaint();
    };

    onRemove: NonNullable<CustomLayerInterface['onRemove']> = (_map, gl) => {
        this.disposed = true;
        MapAnimationTracker.unregister(this);
        this.unregisterTerrainRefreshListeners();
        this.releaseTerrainHeightMapResources(gl);
        this.releaseResources();
    };

    public dispose(): void {
        this.disposed = true;
        MapAnimationTracker.unregister(this);
        if (this.map.getLayer(this.id)) this.map.removeLayer(this.id);
        else {
            this.unregisterTerrainRefreshListeners();
            if (this.terrainHeightMapGl) {
                this.releaseTerrainHeightMapResources(this.terrainHeightMapGl);
            }
            this.releaseResources();
        }
    }

    private releaseTerrainHeightMapResources(gl: WebGL2RenderingContext): void {
        if (this.terrainReadFramebuffer) gl.deleteFramebuffer(this.terrainReadFramebuffer);
        if (this.terrainHeightMapTarget?.texture) gl.deleteTexture(this.terrainHeightMapTarget.texture);
        this.terrainReadFramebuffer = undefined;
        this.terrainHeightMapTarget = undefined;
        this.terrainHeightPixels = undefined;
        this.terrainHeightMapReady = false;
        this.terrainHeightMapGl = undefined;
    }

    private releaseResources(): void {
        const geometries = new Set<THREE.BufferGeometry>();
        const materials = new Set<THREE.Material>();
        this.scene.traverse(object => {
            const mesh = object as THREE.Mesh;
            if (!mesh.isMesh) return;
            geometries.add(mesh.geometry);
            const objectMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
            objectMaterials.forEach(material => materials.add(material));
        });
        geometries.forEach(geometry => geometry.dispose());
        materials.forEach(material => material.dispose());
        this.scene.clear();
        this.unitDashBoxGeometry.dispose();
        this.renderer?.dispose();
        this.renderer = undefined;
        this.routes.length = 0;
    }
}

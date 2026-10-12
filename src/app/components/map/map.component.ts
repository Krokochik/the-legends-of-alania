import {Component, ElementRef, ViewChild, AfterViewInit, OnDestroy, viewChild, OnInit, effect, EffectRef} from '@angular/core';
import {Map, MercatorCoordinate, LngLatBoundsLike, addProtocol, setWorkerUrl, setWorkerCount} from 'maplibre-gl';
import MaplibreTransition from 'maplibre-transition';
import {Protocol} from 'pmtiles';
import {OverlayService} from '../../services/overlay.service';
import {LoadingOverlay} from '../loading-overlay/loading-overlay';
import {ResourceService} from '../../services/resource.service';
import {AnimatedMapModelLayer} from './animated-map-model-layer';
import {AnimatedMapRouteLayer} from './animated-map-route-layer';
import type {RouteMarkerAnimation} from './animated-map-route-layer';
import {MAP_MODEL_MARKERS, MAP_MARKER_STATE_APPEARANCE} from './map-model-markers';
import type {MapMarkerState, MapModelColorUpdate, MapModelPosition} from './map-model-markers';
import {MAP_ROUTE_DEFINITIONS, MAP_ROUTE_TIMING} from './map-routes';
import {MapService, type MapRouteState} from '../../services/map.service';
import {MapLoadedEvent} from '../../models/events/MapLoadedEvent';
import {MapAnimationEndEvent} from '../../models/events/MapAnimationEndEvent';

export interface MapCameraTarget {
    center?: [number, number];
    lng?: number;
    lat?: number;
    x?: number;
    y?: number;
    zoom?: number;
    pitch?: number;
    bearing?: number;
    offset?: [number, number];
    padding?: number | { top: number; right: number; bottom: number; left: number };
    durationMs?: number;
    easing?: (t: number) => number;
}

@Component({
    selector: 'app-map',
    template: `
        <div #mapContainer style="width:100vw;height:100vh;background:#0a1232;"></div>`,
    styleUrls: ['./map.css']
})
export class MapComponent implements OnInit, OnDestroy {

    readonly container = viewChild.required<ElementRef<HTMLDivElement>>('mapContainer');

    private map?: Map;
    private modelLayer?: AnimatedMapModelLayer;
    private routeLayer?: AnimatedMapRouteLayer;
    private cameraImageSize?: { width: number; height: number };
    private cameraWorkingBoundsMercator?: { minX: number; maxX: number; minY: number; maxY: number };
    private cameraFollowHeightActive = false;
    private cameraFollowHeightAnchorMeters?: number;
    private cameraFollowLatestTerrainElevation?: number;

    private readonly CAMERA_WORKING_AREA_SAFETY_PX = 1;
    private cameraFollowRouteId?: string;
    private cameraFollowTarget?: [number, number];
    private cameraFollowDistanceMeters = 0;
    private cameraFollowLastScheduledDistance = 0;
    private cameraFollowFinished = false;
    private cameraFollowHasStartedMovement = false;
    private cameraFollowMoveInProgress = false;
    private cameraFollowMoveEndHandler?: () => void;
    private cameraFollowProgressFrame?: number;
    private readonly CAMERA_FOLLOW_STEP_METERS = 180;
    private mapLayersReady = false;
    private destroyed = false;
    private lastAppliedMarkerStates?: Record<string, MapMarkerState>;
    private lastAppliedRouteStates?: Record<string, boolean>;
    private readonly deferredMarkerAppearanceIds = new Set<string>();
    private readonly mapStateEffect: EffectRef;

    private readonly MAP_WIDTH = 3344;
    private readonly MAP_HEIGHT = 1880;

    private readonly REGION_HOVER_COLOR = '#a78bfa';
    private readonly REGION_HOVER_OPACITY = 0.15;
    private readonly REGION_TRANSITION_DURATION = 300;

    private readonly REGION_GROUPS: string[][] = [
        ['region_nw', 'region_e'],
    ];

    constructor(
        private resources: ResourceService,
        private mapService: MapService,
    ) {
        this.mapStateEffect = effect(() => {
            const markerStates = this.mapService.markerStates();
            const routeStates = this.mapService.routeStates();
            if (this.mapLayersReady) {
                this.applyMapState(markerStates, routeStates, true);
            }
        });
        effect(() => {
            const target = this.mapService.cameraTarget();
            if (target) this.moveCameraTo(target);
        });
    }

    async ngOnInit(): Promise<void> {
        const protocol = new Protocol();
        addProtocol('pmtiles', protocol.tile);
        setWorkerCount(8);
        setWorkerUrl(new URL('maplibre-gl-worker.mjs', document.baseURI).href);

        const size = await this.loadImageSize('map.png');

        const LNG_SPAN = 1;
        const latSpan = LNG_SPAN * (size.height / size.width);

        const lng0 = 0, lat0 = 0;
        const lng1 = LNG_SPAN, lat1 = latSpan;

        const bounds: LngLatBoundsLike = [[lng0, lat0], [lng1, lat1]];

        const logicalOffsetX = (size.width - this.MAP_WIDTH) / 2;
        const logicalOffsetY = (size.height - this.MAP_HEIGHT) / 2;
        const workingLng0 = logicalOffsetX / size.width;
        const workingLng1 = (logicalOffsetX + this.MAP_WIDTH) / size.width;
        const workingLat1 = (size.height - logicalOffsetY) / size.width;
        const workingLat0 = (size.height - logicalOffsetY - this.MAP_HEIGHT) / size.width;
        const northWest = MercatorCoordinate.fromLngLat([workingLng0, workingLat1]);
        const southEast = MercatorCoordinate.fromLngLat([workingLng1, workingLat0]);

        const meter = MercatorCoordinate.fromLngLat([
            workingLng0, workingLat1
        ]).meterInMercatorCoordinateUnits();

        this.cameraWorkingBoundsMercator = {
            minX: Math.min(northWest.x, southEast.x) - 15000 * meter,
            maxX: Math.max(northWest.x, southEast.x) + 15000 * meter,
            minY: Math.min(northWest.y, southEast.y) - 12500 * meter,
            maxY: Math.max(northWest.y, southEast.y) + 12500 * meter,
        };

        const coordinates: [[number, number], [number, number], [number, number], [number, number]] = [
            [lng0, lat1], [lng1, lat1], [lng1, lat0], [lng0, lat0]
        ];

        this.map = new Map({
            container: this.container().nativeElement,
            maxBounds: bounds,
            minZoom: 0,
            maxZoom: 15,
            pitch: 55,
            attributionControl: false,
            style: {
                version: 8,
                sources: {
                    'map-image': {
                        type: 'image',
                        url: 'map.png',
                        coordinates,
                    },
                    'terrain-source': {
                        type: 'raster-dem',
                        url: 'pmtiles://output.pmtiles',
                        tileSize: 1024,
                        encoding: 'mapbox',
                        bounds: [lng0, lat0, lng1, lat1],
                        maxzoom: 11
                    },
                },
                layers: [
                    {id: 'map-layer', type: 'raster', source: 'map-image'},
                    {
                        id: 'hillshade',
                        type: 'hillshade',
                        source: 'terrain-source',
                        paint: {'hillshade-exaggeration': 0.3}
                    }
                ],
                terrain: {
                    source: 'terrain-source',
                    exaggeration: 4
                },
            }
        });

        this.map.on('dragstart', this.cancelCameraFollowOnUserInput);
        this.map.on('wheel', this.cancelCameraFollowOnUserInput);
        this.map.on('rotatestart', this.cancelCameraFollowOnUserInput);
        this.map.on('pitchstart', this.cancelCameraFollowOnUserInput);

        MaplibreTransition.init(this.map);

        this.map.on('load', async () => {
            this.map!.fitBounds(bounds, {padding: 0, animate: false});

            const fitZoom = this.map!.getZoom();
            this.map!.setMaxZoom(15);
            this.map!.setMinZoom(fitZoom);

            this.map!.setZoom(12.8);

            // this.setupRegions(size).catch(err => console.error('Regions failed:', err));

            await this.setupMapModels(size).catch(err => {
                console.error('Map models failed:', err);
            });

            setTimeout(() => document.dispatchEvent(new MapLoadedEvent()), 250);
        });
    }

    private async setupMapModels(
        imageSize: { width: number; height: number },
    ): Promise<void> {
        if (!this.map) {
            return;
        }
        this.cameraImageSize = imageSize;

        const logicalMapSize = {
            width: this.MAP_WIDTH,
            height: this.MAP_HEIGHT,
        };

        const layer = new AnimatedMapModelLayer(
            this.map,
            imageSize,
            logicalMapSize,
            MAP_MODEL_MARKERS,
            resourceKey => this.resources.get<Blob>(resourceKey),
        );

        this.modelLayer = layer;
        await layer.loadAndAdd();
        if (this.destroyed) return;

        const routes = new AnimatedMapRouteLayer(
            this.map,
            imageSize,
            logicalMapSize,
            MAP_ROUTE_DEFINITIONS,
            MAP_MODEL_MARKERS,
            MAP_MODEL_MARKERS[0]?.position,
            (markerId, animation) => this.handleRouteMarkerAnimation(markerId, animation),
            (routeId, center, revealing, distanceMeters, terrainElevationMeters) =>
                this.handleRouteRevealProgress(
                    routeId, center, revealing, distanceMeters, terrainElevationMeters,
                ),
        );

        this.routeLayer = routes;
        await routes.loadAndAdd();
        if (this.destroyed) return;

        this.snapCameraToInitialPosition();

        this.mapLayersReady = true;

        this.applyMapState(
            this.mapService.markerStates(),
            this.mapService.routeStates(),
            false,
        );
    }

    private applyMapState(
        states: Readonly<Record<string, MapMarkerState>>,
        routes: readonly MapRouteState[],
        animate: boolean,
    ): void {
        const markerSnapshot: Record<string, MapMarkerState> = { ...states };
        const routeSnapshot: Record<string, boolean> = {};
        const firstRouteSnapshot = this.lastAppliedRouteStates === undefined;
        for (const route of routes) {
            routeSnapshot[route.id] = route.visible;
        }

        const newlyRevealingRoutes = animate && !firstRouteSnapshot
            ? MAP_ROUTE_DEFINITIONS.filter(route =>
                routeSnapshot[route.id] === true
                && this.lastAppliedRouteStates?.[route.id] === false,
            )
            : [];
        if (newlyRevealingRoutes.length) {
            const routeToFollow = newlyRevealingRoutes.find(route => {
                const first = route.points[0];
                const startMarkerId = route.startMarkerId
                    ?? (first?.kind === 'marker' ? first.markerId : undefined);
                return !!startMarkerId && (states[startMarkerId] ?? 'inactive') === 'current';
            }) ?? newlyRevealingRoutes[0];
            if (routeToFollow) this.beginCameraFollow(routeToFollow.id);
        }
        const deferThisApply = new Set<string>();
        const origins = new Set<string>();

        for (const route of newlyRevealingRoutes) {
            const first = route.points[0];
            const last = route.points.at(-1);
            const startMarkerId = route.startMarkerId
                ?? (first?.kind === 'marker' ? first.markerId : undefined);
            const endMarkerId = route.endMarkerId
                ?? (last?.kind === 'marker' ? last.markerId : undefined);
            if (startMarkerId) origins.add(startMarkerId);
            if (endMarkerId) deferThisApply.add(endMarkerId);
        }

        for (const markerId of origins) deferThisApply.delete(markerId);

        for (const marker of MAP_MODEL_MARKERS) {
            const state = states[marker.id] ?? 'inactive';
            const previous = this.lastAppliedMarkerStates?.[marker.id];
            const stateChanged = previous !== state;

            if (animate && stateChanged && deferThisApply.has(marker.id)) {
                this.deferredMarkerAppearanceIds.add(marker.id);
                continue;
            }

            if (animate && !stateChanged) continue;
            if (stateChanged) this.deferredMarkerAppearanceIds.delete(marker.id);

            this.applyMarkerAppearance(marker.id, state, animate ? MAP_ROUTE_TIMING.markerAppearanceTransitionMs : 0);
        }

        const visibleDestinationIds = new Set<string>();
        for (const route of MAP_ROUTE_DEFINITIONS) {
            if (!routeSnapshot[route.id]) continue;
            const last = route.points.at(-1);
            const endMarkerId = route.endMarkerId
                ?? (last?.kind === 'marker' ? last.markerId : undefined);
            if (endMarkerId) visibleDestinationIds.add(endMarkerId);
        }
        for (const markerId of Array.from(this.deferredMarkerAppearanceIds)) {
            if (visibleDestinationIds.has(markerId)) continue;
            this.deferredMarkerAppearanceIds.delete(markerId);
            this.applyMarkerAppearance(
                markerId,
                states[markerId] ?? 'inactive',
                animate ? MAP_ROUTE_TIMING.markerAppearanceTransitionMs : 0,
            );
        }

        for (const route of routes) {
            const definition = MAP_ROUTE_DEFINITIONS.find(item => item.id === route.id);
            const lastPoint = definition?.points.at(-1);
            const endMarkerId = definition?.endMarkerId
                ?? (lastPoint?.kind === 'marker' ? lastPoint.markerId : undefined);
            const endMarkerIsCurrent = !!endMarkerId && (states[endMarkerId] ?? 'inactive') === 'current';

            this.routeLayer?.setRouteCurrentState(route.id, endMarkerIsCurrent, animate);

            const previous = this.lastAppliedRouteStates?.[route.id];
            const visibilityChanged = firstRouteSnapshot || previous !== route.visible;
            if (visibilityChanged) {
                const shouldAnimate = animate && !firstRouteSnapshot && previous !== route.visible;
                if (!route.visible && this.cameraFollowRouteId === route.id) {
                    this.stopCameraFollow();
                }
                this.routeLayer?.setRouteVisible(route.id, route.visible, shouldAnimate);
            }
        }

        this.lastAppliedMarkerStates = markerSnapshot;
        this.lastAppliedRouteStates = routeSnapshot;
    }

    private applyMarkerAppearance(
        markerId: string,
        state: MapMarkerState,
        durationMs: number,
    ): void {
        const appearance = MAP_MARKER_STATE_APPEARANCE[state];
        this.modelLayer?.setMarkerCurrent(markerId, state === 'current');
        this.modelLayer?.transitionColors(markerId, {
            baseColor: appearance.baseColor,
            accentColor: appearance.accentColor,
        }, durationMs);
        this.modelLayer?.transitionScale(markerId, appearance.scale, durationMs);
    }

    private handleRouteMarkerAnimation(
        markerId: string,
        animation: RouteMarkerAnimation,
    ): void {
        if (animation === 'start') return;

        if (animation === 'approach') {
            if (!this.deferredMarkerAppearanceIds.delete(markerId)) return;
            this.applyMarkerAppearance(
                markerId,
                this.mapService.getMarkerState(markerId),
                MAP_ROUTE_TIMING.markerAppearanceTransitionMs,
            );
            return;
        }

        this.modelLayer?.playRouteMarkerAnimation(markerId, animation);
    }

    public moveCameraTo(target: MapCameraTarget): boolean {
        if (!this.map) return false;

        let center: [number, number] | undefined;
        if (target.center) {
            center = target.center;
        } else if (target.lng !== undefined && target.lat !== undefined) {
            center = [target.lng, target.lat];
        } else if (target.x !== undefined && target.y !== undefined) {
            if (!this.cameraImageSize) return false;
            center = this.mapPositionToLngLat({
                kind: 'image-pixel',
                x: target.x,
                y: target.y,
            });
        } else if (target.x !== undefined || target.y !== undefined || target.lng !== undefined || target.lat !== undefined) {
            return false;
        }

        this.stopCameraFollow();

        const targetZoom = target.zoom ?? this.map.getZoom();
        const targetPitch = target.pitch ?? this.map.getPitch();
        const targetBearing = target.bearing ?? this.map.getBearing();
        if (center) {
            center = this.clampCameraCenterToWorkingArea(
                center,
                targetZoom,
                targetPitch,
                targetBearing,
            );
        }

        const options = {
            center: center ?? [this.map.getCenter().lng, this.map.getCenter().lat] as [number, number],
            zoom: target.zoom ?? this.map.getZoom(),
            pitch: target.pitch ?? this.map.getPitch(),
            bearing: target.bearing ?? this.map.getBearing(),
            duration: Math.max(0, target.durationMs ?? 1200),
            easing: target.easing ?? ((t: number) =>
                t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
            essential: true,
        };
        if (target.offset) Object.assign(options, { offset: target.offset });
        if (target.padding !== undefined) Object.assign(options, { padding: target.padding });

        this.map.easeTo(options);
        return true;
    }

    private snapCameraToInitialPosition(): void {
        if (!this.map || !this.cameraImageSize) return;
        const states = this.mapService.markerStates();
        const currentMarker = MAP_MODEL_MARKERS.find(
            marker => (states[marker.id] ?? 'inactive') === 'current',
        );
        const center = currentMarker
            ? this.mapPositionToLngLat(currentMarker.position)
            : this.mapPositionToLngLat({
                kind: 'image-pixel',
                x: this.MAP_WIDTH / 2,
                y: this.MAP_HEIGHT / 2,
            });

        this.map.jumpTo({
            center: this.clampCameraCenterToWorkingArea(center),
        });
    }

    private mapPositionToLngLat(position: MapModelPosition): [number, number] {
        if (position.kind === 'lng-lat') return [position.lng, position.lat];
        const imageSize = this.cameraImageSize;
        if (!imageSize) return [0, 0];

        const offsetX = (imageSize.width - this.MAP_WIDTH) / 2;
        const offsetY = (imageSize.height - this.MAP_HEIGHT) / 2;
        return [
            (offsetX + position.x) / imageSize.width,
            (imageSize.height - offsetY - position.y) / imageSize.width,
        ];
    }

    private beginCameraFollow(routeId: string): void {
        this.stopCameraFollow();
        if (this.map) {
            const center = this.map.getCenter();
            this.cameraFollowHeightAnchorMeters = this.map.queryTerrainElevation([
                center.lng,
                center.lat,
            ]) ?? this.map.getCenterElevation();
            this.cameraFollowLatestTerrainElevation = this.cameraFollowHeightAnchorMeters;
            this.cameraFollowHeightActive = false;
        }
        this.cameraFollowRouteId = routeId;
    }

    private readonly handleRouteRevealProgress = (
        routeId: string,
        center: [number, number],
        revealing: boolean,
        revealedDistanceMeters: number,
        terrainElevationMeters?: number,
    ): void => {
        if (this.destroyed || this.cameraFollowRouteId !== routeId) return;
        if (terrainElevationMeters !== undefined && Number.isFinite(terrainElevationMeters)) {
            this.cameraFollowLatestTerrainElevation = terrainElevationMeters;
        }
        this.cameraFollowTarget = center;
        this.cameraFollowDistanceMeters = revealedDistanceMeters;
        this.cameraFollowFinished = !revealing;
        if (this.cameraFollowProgressFrame === undefined) {
            this.cameraFollowProgressFrame = requestAnimationFrame(() => {
                this.cameraFollowProgressFrame = undefined;
                this.maybeAdvanceCameraFollow();
            });
        }
    };

    private maybeAdvanceCameraFollow(): void {
        const map = this.map;
        const target = this.cameraFollowTarget;
        const routeId = this.cameraFollowRouteId;
        if (!map || !target || !routeId) return;

        if (this.cameraFollowMoveInProgress) return;
        if (this.cameraFollowFinished) {
            document.dispatchEvent(new MapAnimationEndEvent());
            this.stopCameraFollow();
            return;
        }

        const boundedTarget = this.clampCameraCenterToWorkingArea(target);

        if (!this.cameraFollowHasStartedMovement) {
            this.cameraFollowHasStartedMovement = true;
            const current = map.getCenter();
            const distanceToRouteStart = this.geographicDistanceMeters(
                [current.lng, current.lat],
                boundedTarget,
            );

            if (distanceToRouteStart > 25) {
                this.scheduleCameraFollowMove(boundedTarget, this.cameraFollowDistanceMeters, 650);
                return;
            }

            this.cameraFollowLastScheduledDistance = 0;
        }

        const distanceSinceLastCameraTarget = Math.max(
            0,
            this.cameraFollowDistanceMeters - this.cameraFollowLastScheduledDistance,
        );
        if (!this.cameraFollowFinished && distanceSinceLastCameraTarget < this.CAMERA_FOLLOW_STEP_METERS) {
            return;
        }

        const speed = MAP_ROUTE_TIMING.revealSpeedMetersPerSecond;
        const durationMs = Math.max(
            this.cameraFollowFinished ? 100 : 1,
            distanceSinceLastCameraTarget / speed * 1000,
        );

        const current = map.getCenter();
        const targetDistance = this.geographicDistanceMeters(
            [current.lng, current.lat],
            boundedTarget,
        );
        if (targetDistance < 5) {
            this.cameraFollowLastScheduledDistance = this.cameraFollowDistanceMeters;
            if (this.cameraFollowFinished) this.stopCameraFollow();
            return;
        }

        this.scheduleCameraFollowMove(boundedTarget, this.cameraFollowDistanceMeters, durationMs);
    }

    private scheduleCameraFollowMove(
        center: [number, number],
        revealDistanceMeters: number,
        durationMs: number,
    ): void {
        const map = this.map;
        const routeId = this.cameraFollowRouteId;
        if (!map || !routeId) return;

        this.cameraFollowMoveInProgress = true;
        this.cameraFollowLastScheduledDistance = revealDistanceMeters;

        const onMoveEnd = (): void => {
            map.off('moveend', onMoveEnd);
            if (this.cameraFollowMoveEndHandler === onMoveEnd) {
                this.cameraFollowMoveEndHandler = undefined;
            }
            if (this.cameraFollowRouteId !== routeId) return;

            this.cameraFollowMoveInProgress = false;
            if (this.cameraFollowFinished) {
                this.stopCameraFollow();
                return;
            }
            if (this.cameraFollowProgressFrame === undefined) {
                this.cameraFollowProgressFrame = requestAnimationFrame(() => {
                    this.cameraFollowProgressFrame = undefined;
                    this.maybeAdvanceCameraFollow();
                });
            }
        };
        this.cameraFollowMoveEndHandler = onMoveEnd;
        map.on('moveend', onMoveEnd);

        const boundedCenter = this.clampCameraCenterToWorkingArea(center);
        map.easeTo({
            center: boundedCenter,
            duration: Math.max(0, durationMs),
            easing: (t: number) => t,
            essential: true,
        });
    }

    private clampCameraCenterToWorkingArea(
        center: [number, number],
        zoom = this.map?.getZoom() ?? 12.8,
        pitch = this.map?.getPitch() ?? 55,
        bearing = this.map?.getBearing() ?? 0,
    ): [number, number] {
        const map = this.map;
        const bounds = this.cameraWorkingBoundsMercator;
        if (!map || !bounds) return center;

        const canvas = map.getCanvas();
        const width = canvas.clientWidth || canvas.width;
        const height = canvas.clientHeight || canvas.height;
        if (width <= 0 || height <= 0) return center;

        const currentCenter = map.getCenter();
        const currentCenterMercator = MercatorCoordinate.fromLngLat([
            currentCenter.lng,
            currentCenter.lat,
        ]);
        const viewportSamples: Array<[number, number]> = [
            [0, 0], [width / 2, 0], [width, 0],
            [width, height / 2], [width, height],
            [width / 2, height], [0, height], [0, height / 2],
        ];

        const currentZoom = map.getZoom();
        const zoomScale = Math.pow(2, currentZoom - zoom);
        const currentPitchRadians = map.getPitch() * Math.PI / 180;
        const targetPitchRadians = Math.max(0, Math.min(80, pitch)) * Math.PI / 180;
        const currentBearingRadians = map.getBearing() * Math.PI / 180;
        const targetBearingRadians = bearing * Math.PI / 180;
        const bearingDelta = targetBearingRadians - currentBearingRadians;

        const halfFov = 18 * Math.PI / 180;
        const currentFarAngle = Math.min(currentPitchRadians + halfFov, 84.5 * Math.PI / 180);
        const targetFarAngle = Math.min(targetPitchRadians + halfFov, 84.5 * Math.PI / 180);
        const currentFarScale = Math.max(Math.tan(currentFarAngle), 0.05);
        const targetFarScale = Math.max(Math.tan(targetFarAngle), 0.05);
        const verticalPitchScale = targetFarScale / currentFarScale;
        const horizontalPitchScale = Math.cos(currentPitchRadians)
            / Math.max(Math.cos(targetPitchRadians), 0.15);

        let minOffsetX = Number.POSITIVE_INFINITY;
        let maxOffsetX = Number.NEGATIVE_INFINITY;
        let minOffsetY = Number.POSITIVE_INFINITY;
        let maxOffsetY = Number.NEGATIVE_INFINITY;

        const cosBearing = Math.cos(bearingDelta);
        const sinBearing = Math.sin(bearingDelta);

        for (const [screenX, screenY] of viewportSamples) {
            const geographic = map.unproject([screenX, screenY]);
            const mercator = MercatorCoordinate.fromLngLat([geographic.lng, geographic.lat]);
            let dx = mercator.x - currentCenterMercator.x;

            if (dx > 0.5) dx -= 1;
            else if (dx < -0.5) dx += 1;
            const dy = mercator.y - currentCenterMercator.y;

            const rotatedX = (dx * cosBearing - dy * sinBearing)
                * zoomScale * horizontalPitchScale;
            const rotatedY = (dx * sinBearing + dy * cosBearing)
                * zoomScale * verticalPitchScale;

            minOffsetX = Math.min(minOffsetX, rotatedX);
            maxOffsetX = Math.max(maxOffsetX, rotatedX);
            minOffsetY = Math.min(minOffsetY, rotatedY);
            maxOffsetY = Math.max(maxOffsetY, rotatedY);
        }

        const targetWorldSize = 512 * Math.pow(2, zoom);
        const safety = this.CAMERA_WORKING_AREA_SAFETY_PX / Math.max(targetWorldSize, 1);
        minOffsetX -= safety;
        maxOffsetX += safety;
        minOffsetY -= safety;
        maxOffsetY += safety;

        let minCenterX = bounds.minX - minOffsetX;
        let maxCenterX = bounds.maxX - maxOffsetX;
        let minCenterY = bounds.minY - minOffsetY;
        let maxCenterY = bounds.maxY - maxOffsetY;

        if (minCenterX > maxCenterX) {
            minCenterX = maxCenterX = (bounds.minX + bounds.maxX) / 2;
        }
        if (minCenterY > maxCenterY) {
            minCenterY = maxCenterY = (bounds.minY + bounds.maxY) / 2;
        }

        const requested = MercatorCoordinate.fromLngLat(center);
        const clampedX = Math.max(minCenterX, Math.min(maxCenterX, requested.x));
        const clampedY = Math.max(minCenterY, Math.min(maxCenterY, requested.y));
        const clamped = new MercatorCoordinate(clampedX, clampedY, 0).toLngLat();
        return [clamped.lng, clamped.lat];
    }

    private geographicDistanceMeters(
        a: [number, number],
        b: [number, number],
    ): number {
        const meanLatitudeRadians = (a[1] + b[1]) * Math.PI / 360;
        const dx = (b[0] - a[0]) * 111_320 * Math.cos(meanLatitudeRadians);
        const dy = (b[1] - a[1]) * 111_320;
        return Math.hypot(dx, dy);
    }

    private stopCameraFollow(): void {
        const map = this.map;
        if (this.cameraFollowMoveEndHandler && map) {
            map.off('moveend', this.cameraFollowMoveEndHandler);
            this.cameraFollowMoveEndHandler = undefined;
        }
        const wasMoving = this.cameraFollowMoveInProgress;
        this.cameraFollowRouteId = undefined;
        this.cameraFollowTarget = undefined;
        this.cameraFollowDistanceMeters = 0;
        this.cameraFollowLastScheduledDistance = 0;
        this.cameraFollowFinished = false;
        this.cameraFollowHasStartedMovement = false;
        this.cameraFollowMoveInProgress = false;
        this.cameraFollowHeightActive = false;
        this.cameraFollowHeightAnchorMeters = undefined;
        this.cameraFollowLatestTerrainElevation = undefined;
        if (this.cameraFollowProgressFrame !== undefined) {
            cancelAnimationFrame(this.cameraFollowProgressFrame);
            this.cameraFollowProgressFrame = undefined;
        }
        if (wasMoving) map?.stop();
    }

    private readonly cancelCameraFollowOnUserInput = (): void => {
        this.stopCameraFollow();
    };

    public transitionMapModelColors(
        markerId: string,
        colors: MapModelColorUpdate,
        durationMs = 800,
    ): boolean {
        return this.modelLayer?.transitionColors(markerId, colors, durationMs) ?? false;
    }

    public transitionMapModelScale(
        markerId: string,
        scale: number,
        durationMs = 800,
    ): boolean {
        return this.modelLayer?.transitionScale(markerId, scale, durationMs) ?? false;
    }

    private async setupRegions(imageSize: { width: number; height: number }): Promise<void> {
        const resp: string = await this.resources.get('map_geojson');
        const geoJson = JSON.parse(resp);

        const imageWidth = imageSize.width;
        const imageHeight = imageSize.height;
        const worldWidth = this.MAP_WIDTH;
        const worldHeight = this.MAP_HEIGHT;
        const offsetX = (imageWidth - worldWidth) / 2;
        const offsetY = (imageHeight - worldHeight) / 2;

        const transform = (coords: any): any => {
            if (typeof coords[0] === 'number') {
                const [x, y] = coords;
                return [
                    (offsetX + x) / imageWidth,
                    (imageHeight - offsetY - y) / imageWidth,
                ];
            }
            return coords.map(transform);
        };

        for (const f of geoJson.features) {
            if (f.geometry.type === 'Polygon') {
                f.geometry.coordinates = f.geometry.coordinates.map(transform);
            } else if (f.geometry.type === 'LineString') {
                f.geometry.coordinates = transform(f.geometry.coordinates);
            }
        }

        this.map!.addSource('regions', {
            type: 'geojson',
            data: geoJson,
            promoteId: 'id',
        });

        this.map!.addLayer({
            id: 'regions-fill',
            type: 'fill',
            source: 'regions',
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: {
                'fill-color': this.REGION_HOVER_COLOR,
                'fill-opacity': 0,
            },
        });

        this.map!.addLayer({
            id: 'regions-lines',
            type: 'line',
            source: 'regions',
            filter: ['==', ['geometry-type'], 'LineString'],
            paint: {
                'line-color': '#FDFF9D',
                'line-width': 1.5,
                'line-dasharray': [3, 3],
            },
        });

        const getGroup = (id: string | number): (string | number)[] => {
            for (const group of this.REGION_GROUPS) {
                if (group.includes(id as string)) return group;
            }
            return [id];
        };

        const transitionGroup = (ids: (string | number)[], opacity: number) => {
            for (const id of ids) {
                this.map!.transition(
                    {source: 'regions', id, layer: {id: 'regions-fill'}},
                    {
                        duration: this.REGION_TRANSITION_DURATION,
                        ease: 'cubic',
                        paint: {
                            'fill-opacity': [null, opacity],
                        },
                    }
                );
            }
        };

        let hoveredGroup: (string | number)[] = [];

        this.map!.on('mousemove', 'regions-fill', (e) => {
            if (!e.features?.length) return;
            const id = e.features[0].id!;

            if (hoveredGroup.includes(id)) return;

            if (hoveredGroup.length) {
                transitionGroup(hoveredGroup, 0);
            }

            const group = getGroup(id);
            hoveredGroup = group;
            transitionGroup(group, this.REGION_HOVER_OPACITY);

            this.map!.getCanvas().style.cursor = 'pointer';
        });

        this.map!.on('mouseleave', 'regions-fill', () => {
            if (hoveredGroup.length) {
                transitionGroup(hoveredGroup, 0);
                hoveredGroup = [];
            }
            this.map!.getCanvas().style.cursor = '';
        });
    }

    private loadImageSize(url: string): Promise<{ width: number; height: number }> {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve({width: img.naturalWidth, height: img.naturalHeight});
            img.onerror = reject;
            img.src = url;
        });
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        this.mapStateEffect.destroy();
        this.mapLayersReady = false;
        this.stopCameraFollow();
        this.map?.off('dragstart', this.cancelCameraFollowOnUserInput);
        this.map?.off('wheel', this.cancelCameraFollowOnUserInput);
        this.map?.off('rotatestart', this.cancelCameraFollowOnUserInput);
        this.map?.off('pitchstart', this.cancelCameraFollowOnUserInput);
        this.routeLayer?.dispose();
        this.modelLayer?.dispose();
        this.map?.remove();
    }
}


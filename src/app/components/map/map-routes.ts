import type { MapModelPosition } from './map-model-markers';

export type MapRoutePoint = MapModelPosition | {
    kind: 'marker';
    markerId: string;
};

export type MapRouteDashShape = 'straight' | 'bent';
export type MapRouteVisibilityRule = 'always' | 'frontier';

export interface MapRouteLineAppearance {
    color: string;
    emissive: string;
    emissiveIntensity: number;
    opacity: number;
    roughness: number;
    metalness: number;
}

export const MAP_ROUTE_APPEARANCE = {
    current: {
        color: '#ffeb9d',
        emissive: '#a8945e',
        emissiveIntensity: 0.32,
        opacity: 1,
        roughness: 0.38,
        metalness: 0.12,
    } satisfies MapRouteLineAppearance,
    other: {
        color: '#9db6cf',
        emissive: '#344b68',
        emissiveIntensity: 0.09,
        opacity: 0.48,
        roughness: 0.58,
        metalness: 0.04,
    } satisfies MapRouteLineAppearance,
    transitionDurationMs: 260,
} as const;

export const MAP_ROUTE_TIMING = {
    revealSpeedMetersPerSecond: 900,
    markerAppearanceTransitionMs: 520,
    arrivalSpringDelayMs: 300,
    startMarkerDelayMs: 240,
} as const;

export interface MapRouteDefinition {
    id: string;
    points: readonly MapRoutePoint[];
    startMarkerId?: string;
    endMarkerId?: string;
    visibility?: MapRouteVisibilityRule;

    dash: {
        lengthMeters: number;
        gapMeters: number;
        widthMeters: number;
        thicknessMeters: number;
        shape: MapRouteDashShape;
        bendOffsetMeters?: number;
    };

    terrain?: {
        clearanceMeters?: number;
        sampleSpacingMeters?: number;
        smoothingWindow?: number;
    };

    animation?: {
        startMarkerDelayMs?: number;
    };

    particles?: {
        colors: readonly [string, string, string];
        emissionRatePerSecond?: number;
        particlesPerBurst?: number;
        particleSizeMeters?: number;
        particleSizeWidthRatio?: number;
        travelDistanceMultiplier?: number;
        arcHeightMultiplier?: number;
        lifetimeMs?: number;
        initialSpeedMetersPerSecond?: number;
        maxParticles?: number;
    };
}

const ROUTE_CONFIG: Pick<MapRouteDefinition, 'dash' | 'terrain' | 'animation' | 'particles'> = {
    dash: {
        lengthMeters: 220,
        gapMeters: 145,
        widthMeters: 150,
        thicknessMeters: 18,
        shape: 'straight',
        bendOffsetMeters: 14,
    },
    terrain: {
        clearanceMeters: 3,
        sampleSpacingMeters: 24,
        smoothingWindow: 5,
    },
    animation: {
        startMarkerDelayMs: MAP_ROUTE_TIMING.startMarkerDelayMs,
    },
    particles: {
        colors: ['#4075c0', '#a249cb', '#fff2a1'],
        emissionRatePerSecond: 25,
        particlesPerBurst: 2,
        particleSizeWidthRatio: 0.1,
        travelDistanceMultiplier: 4,
        arcHeightMultiplier: 5,
        lifetimeMs: 1500,
        initialSpeedMetersPerSecond: 10,
        maxParticles: 320,
    }
};

export const MAP_ROUTE_DEFINITIONS: readonly MapRouteDefinition[] = [
    {
        ...ROUTE_CONFIG,
        id: 'dargavs-to-karmadon',
        startMarkerId: 'dargavs',
        endMarkerId: 'karmadon',
        visibility: 'frontier',
        points: [
            { kind: 'marker', markerId: 'dargavs' },
            { kind: 'marker', markerId: 'karmadon' },
        ],
    },{
        ...ROUTE_CONFIG,
        id: 'karmadon-to-three-sisters',
        startMarkerId: 'karmadon',
        endMarkerId: 'three-sisters',
        visibility: 'frontier',
        points: [
            { kind: 'marker', markerId: 'karmadon' },
            { kind: 'marker', markerId: 'three-sisters' },
        ],
    },{
        ...ROUTE_CONFIG,
        id: 'three-sisters-to-zadalesk',
        startMarkerId: 'three-sisters',
        endMarkerId: 'zadalesk',
        visibility: 'frontier',
        points: [
            { kind: 'marker', markerId: 'three-sisters' },
            { kind: 'marker', markerId: 'zadalesk' },
        ],
    },{
        ...ROUTE_CONFIG,
        id: 'zadalesk-to-zadalesk',
        startMarkerId: 'zadalesk',
        endMarkerId: 'beslan',
        visibility: 'frontier',
        points: [
            { kind: 'marker', markerId: 'zadalesk' },
            { kind: 'marker', markerId: 'beslan' },
        ],
    },{
        ...ROUTE_CONFIG,
        id: 'beslan-to-stolovaya',
        startMarkerId: 'beslan',
        endMarkerId: 'stolovaya',
        visibility: 'frontier',
        points: [
            { kind: 'marker', markerId: 'beslan' },
            { kind: 'marker', markerId: 'stolovaya' },
        ],
    },{
        ...ROUTE_CONFIG,
        id: 'stolovaya-to-khetag',
        startMarkerId: 'stolovaya',
        endMarkerId: 'khetag',
        visibility: 'frontier',
        points: [
            { kind: 'marker', markerId: 'stolovaya' },
            { kind: 'marker', markerId: 'khetag' },
        ],
    },
];

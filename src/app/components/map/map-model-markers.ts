export type MapModelPosition =
    | {
        kind: 'image-pixel';
        x: number;
        y: number;
    }
    | {
        kind: 'lng-lat';
        lng: number;
        lat: number;
    };

export type MapMarkerState = 'current' | 'active' | 'inactive' | 'blocked' | 'hidden';

export interface MapModelColorUpdate {
    baseColor?: string;
    accentColor?: string;
}

export interface MapModelAppearance extends MapModelColorUpdate {
    accentMaterialNames?: readonly string[];
}

export interface MapModelMarkerDefinition {
    id: string;
    resourceKey: string;
    position: MapModelPosition;

    modelHeightMeters?: number;
    altitudeMeters?: number;
    scale?: number;
    smoothNormals?: boolean;
    appearance?: MapModelAppearance;

    animation?: {
        rotationRadiansPerSecond?: number;
        floatAmplitudeMeters?: number;
        floatPeriodMs?: number;
        phaseRadians?: number;
    };

    playGltfAnimations?: boolean;
}

export interface MapMarkerPointDefinition {
    id: string;
    x: number;
    y: number;
    heightMeters: number;
}

export const MAP_MARKER_POINTS: readonly MapMarkerPointDefinition[] = [
    { id: 'dargavs', x: 1720, y: 888, heightMeters: 150 },
    { id: 'karmadon', x: 1720, y: 1117, heightMeters: 60 },
    { id: 'three-sisters', x: 1141, y: 834, heightMeters: 60 },
    { id: 'zadalesk', x: 1456, y: 802, heightMeters: 60 },
    { id: 'beslan', x: 1908, y: 632, heightMeters: 150 },
    { id: 'stolovaya', x: 2290, y: 900, heightMeters: 60 },
    { id: 'khetag', x: 1270, y: 500, heightMeters: 60 },
];

const DEFAULT_MARKER_MODEL = {
    resourceKey: 'model_map_pin',
    modelHeightMeters: 160,
    scale: 3,
    smoothNormals: false,
    altitudeMeters: 0,
    appearance: {
        baseColor: '#d2d2d2',
        accentColor: '#9a9a9a',
        accentMaterialNames: ['Accent'],
    },
    animation: {
        rotationRadiansPerSecond: 0,
        floatAmplitudeMeters: 24,
        floatPeriodMs: 2800,
        phaseRadians: 0,
    },
} satisfies Omit<MapModelMarkerDefinition, 'id' | 'position' | 'heightMeters'>;

export const MAP_MODEL_MARKERS: MapModelMarkerDefinition[] = MAP_MARKER_POINTS.map(
    (point, index) => ({
        ...DEFAULT_MARKER_MODEL,
        appearance: { ...DEFAULT_MARKER_MODEL.appearance },
        animation: {
            ...DEFAULT_MARKER_MODEL.animation,
            phaseRadians: index * Math.PI,
        },
        id: point.id,
        position: { kind: 'image-pixel', x: point.x, y: point.y },
        altitudeMeters: point.heightMeters,
    }),
);

export interface MapMarkerStateAppearance extends MapModelColorUpdate {
    scale: number;
}

export const MAP_MARKER_STATE_APPEARANCE: Readonly<Record<MapMarkerState, MapMarkerStateAppearance>> = {
    current: {
        scale: 5,
        baseColor: '#fff6b2',
        accentColor: '#d0b97c',
    },
    active: {
        scale: 3,
        baseColor: '#d0b97c',
        accentColor: '#a8945e',
    },
    inactive: {
        scale: 3,
        baseColor: '#d2d2d2',
        accentColor: '#9a9a9a',
    },
    blocked: {
        scale: 3,
        baseColor: '#c97b7b',
        accentColor: '#985a5a',
    },
    hidden: {
        scale: 0.00001,
        baseColor: '#d2d2d2',
        accentColor: '#9a9a9a'
    }
};

import { Injectable, computed, signal } from '@angular/core';
import { MAP_MARKER_POINTS, type MapMarkerState } from '../components/map/map-model-markers';
import {
    MAP_ROUTE_DEFINITIONS,
    type MapRouteDefinition,
} from '../components/map/map-routes';
import {MapCameraTarget} from '../components/map/map.component';

export interface MapRouteState {
    id: string;
    visible: boolean;
}

function getRouteEndpointIds(route: MapRouteDefinition): string[] {
    const firstPoint = route.points[0];
    const lastPoint = route.points.at(-1);
    const inferredStart = firstPoint?.kind === 'marker' ? firstPoint.markerId : undefined;
    const inferredEnd = lastPoint?.kind === 'marker' ? lastPoint.markerId : undefined;

    return Array.from(new Set([
        route.startMarkerId ?? inferredStart,
        route.endMarkerId ?? inferredEnd,
    ].filter((id): id is string => !!id)));
}

export const INITIAL_MAP_MARKER_STATES: Record<string, MapMarkerState> = all('inactive');

export function all(state: MapMarkerState): Record<string, MapMarkerState> {
    return {...Object.fromEntries(MAP_MARKER_POINTS.map(point => [point.id, state]))};
}

@Injectable({ providedIn: 'root' })
export class MapService {
    private readonly initialStates: Record<string, MapMarkerState> = {
        ...INITIAL_MAP_MARKER_STATES,
    };

    readonly markerStates = signal<Record<string, MapMarkerState>>({ ...this.initialStates });
    readonly hideRoutes = signal(false);

    readonly routeStates = computed<MapRouteState[]>(() => {
        const states = this.markerStates();

        return MAP_ROUTE_DEFINITIONS.map(route => ({
            id: route.id,
            visible: !this.hideRoutes() && this.shouldRouteBeVisible(route, states),
        }));
    });

    readonly cameraTarget = signal<MapCameraTarget | undefined>(undefined);

    public setMarkerState(markerId: string, state: MapMarkerState): void {
        this.markerStates.update(current => {
            if (current[markerId] === state) {
                return current;
            }
            return { ...current, [markerId]: state };
        });
    }

    public setMarkerStates(states: Partial<Record<string, MapMarkerState>>): void {
        this.markerStates.update(current => ({
            ...this.nonNullStates(current),
            ...this.nonNullStates(states)
        }));
    }

    public getMarkerState(markerId: string): MapMarkerState {
        return this.markerStates()[markerId] ?? 'inactive';
    }

    public resetMarkerStates(states: Partial<Record<string, MapMarkerState>> = {}): void {
        this.markerStates.set({ ...this.initialStates, ...this.nonNullStates(states) });
    }

    private nonNullStates(states: Partial<Record<string, MapMarkerState>> = {}) {
        return Object.fromEntries(
            Object.entries(states).filter(([_, value]) => value !== undefined)
        ) as Record<string, MapMarkerState>;
    }

    private shouldRouteBeVisible(
        route: MapRouteDefinition,
        states: Readonly<Record<string, MapMarkerState>>,
    ): boolean {
        if (route.visibility === 'always') {
            return true;
        }

        const endpointIds = getRouteEndpointIds(route);

        if (endpointIds.length === 0) {
            return true;
        }

        const endpointStates = endpointIds.map(id => states[id] ?? 'inactive');

        if (endpointStates.some(state => state === 'blocked' || state === 'inactive')) {
            return false;
        }

        if (endpointStates.length >= 2) {
            return endpointStates.every(state => state === 'active' || state === 'current')
                && endpointStates.some(state => state === 'active');
        }

        return endpointStates.length === 1
            ? endpointStates[0] === 'active' || endpointStates[0] === 'current'
            : true;
    }
}

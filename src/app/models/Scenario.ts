import {Dialogue} from './Dialogue';
import type {MapMarkerState} from '../components/map/map-model-markers';

export type Scenario = PlotNode[];

export interface PlotNode {
    id: number;
    dialogue: Dialogue;
    mapState: Record<string, MapMarkerState>;
}

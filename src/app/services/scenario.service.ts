import {Service, signal} from '@angular/core';
import {PlotNode, Scenario} from '../models/Scenario';
import {Dialogue} from '../models/Dialogue';
import {MapMarkerState} from '../components/map/map-model-markers';

@Service()
export class ScenarioService {

    private readonly _scenario: Scenario = [
        {
            id: 0,
            dialogue: Dialogue.INTRO,
            mapState: {
                'dargavs': 'current',
            }
        },
        {
            id: 1,
            dialogue: Dialogue.KARMADON,
            mapState: {
                ...this.active(['dargavs']),
                'karmadon': 'current'
            }
        },
        {
            id: 2,
            dialogue: Dialogue.THREE_SISTERS,
            mapState: {
                ...this.active(['dargavs', 'karmadon']),
                'three-sisters': 'current'
            }
        },
        {
            id: 3,
            dialogue: Dialogue.ZADALESK,
            mapState: {
                ...this.active(['dargavs', 'karmadon', 'three-sisters']),
                'zadalesk': 'current'
            }
        },
        {
            id: 4,
            dialogue: Dialogue.BESLAN,
            mapState: {
                ...this.active(['dargavs', 'karmadon', 'three-sisters', 'zadalesk']),
                'beslan': 'current'
            }
        },
        {
            id: 5,
            dialogue: Dialogue.STOLOVAYA,
            mapState: {
                ...this.active(['dargavs', 'karmadon', 'three-sisters', 'zadalesk', 'beslan']),
                'stolovaya': 'current'
            }
        },
        {
            id: 6,
            dialogue: Dialogue.FINAL,
            mapState: {
                ...this.active(['dargavs', 'karmadon', 'three-sisters', 'zadalesk', 'beslan', 'stolovaya']),
                'khetag': 'current'
            }
        }
    ];

    readonly currentNode = signal(0);

    getCurrentNode() {
        return this._scenario[this.currentNode()];
    }

    setCurrentNode(id: number) {
        this.currentNode.set(this._scenario.findIndex(node => node.id === id));
    }

    nextNode(): PlotNode | undefined {
        if (!this.hasNextNode()) return undefined;
        this.currentNode.update(n => n + 1);
        return this.getCurrentNode();
    }

    hasNextNode(): boolean {
        return this.currentNode() + 1 < this._scenario.length;
    }

    private active(args: string[]): Record<string, 'active'> {
        return this.state('active', args);
    }

    private state<T extends MapMarkerState>(state: T, args: string[]): Record<string, T> {
        const res = {} as any;
        args.forEach(arg => res[arg] = state);
        return res;
    }

}

import {Dialogue} from './Dialogue';
import {PlotNode} from './Scenario';
import {Signal, WritableSignal} from '@angular/core';
import {PlayableCharacter} from './PlayableCharacter';

export type GameFlags = {
    [key: string]: boolean;
};

export interface WritableGameState {
    player: WritableSignal<PlayableCharacter | undefined>;
    dialogueNode: WritableSignal<string | undefined>;
    flags: WritableSignal<GameFlags>;
}

export class GameState {
    player: Signal<PlayableCharacter | undefined>;
    dialogueNode: Signal<string | undefined>;
    plotNode: Signal<PlotNode>;
    flags: Signal<GameFlags>;

    constructor(opts: {
        player: WritableSignal<PlayableCharacter | undefined>,
        dialogueNode: WritableSignal<string | undefined>,
        plotNode: Signal<PlotNode>,
        flags: WritableSignal<GameFlags>
    }) {
        this.player = opts.player;
        this.dialogueNode = opts.dialogueNode;
        this.plotNode = opts.plotNode;
        this.flags = opts.flags;
    }

    serialize(): SerializedGameState {
        return {
            player: this.player()?.id,
            dialogueNode: this.dialogueNode(),
            plotNode: this.plotNode().id,
            flags: this.flags()
        };
    }

    writable(): WritableGameState {
        return {...this, plotNode: undefined} as WritableGameState;
    }
}

export interface SerializedGameState {
    player?: string;
    dialogueNode?: string;
    plotNode?: number;
    flags?: GameFlags;
}

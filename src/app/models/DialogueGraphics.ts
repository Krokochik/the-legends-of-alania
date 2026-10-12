import {CommandArgs} from './Command';

export type DialogueGraphics = SpriteDialogueGraphics;

export class SpriteDialogueGraphics {
    type: 'sprite';
    src: string;

    constructor(src: string) {
        this.type = 'sprite';
        this.src = src;
    }

}

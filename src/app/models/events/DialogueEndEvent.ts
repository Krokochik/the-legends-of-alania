export class DialogueEndEvent extends Event {
    static readonly TYPE = 'dialogue_end';

    constructor() {
        super(DialogueEndEvent.TYPE);
    }
}

export class MapAnimationEndEvent extends Event {
    static readonly TYPE = 'map_animation_end';

    constructor() {
        super(MapAnimationEndEvent.TYPE);
    }
}

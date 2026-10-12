export class MapLoadedEvent extends Event {
    static readonly TYPE = 'map_loaded';

    constructor() {
        super(MapLoadedEvent.TYPE);
    }
}

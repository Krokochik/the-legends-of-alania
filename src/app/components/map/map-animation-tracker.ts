import {MapAnimationEndEvent} from '../../models/events/MapAnimationEndEvent';

export class MapAnimationTracker {
    private static readonly sources = new Map<object, boolean>();
    private static cycleObserved = false;
    private static checkScheduled = false;
    private static firstCheckFrame?: number;
    private static secondCheckFrame?: number;

    static setActive(source: object, active: boolean): void {
        const wasActive = this.sources.get(source) ?? false;
        if (wasActive === active) return;

        this.sources.set(source, active);
        if (active) {
            this.cycleObserved = true;
            this.cancelScheduledCheck();
            return;
        }

        this.scheduleCheck();
    }

    static unregister(source: object): void {
        const wasActive = this.sources.get(source) ?? false;
        this.sources.delete(source);
        if (this.sources.size === 0) {
            this.cycleObserved = false;
            this.cancelScheduledCheck();
            return;
        }
        if (wasActive) this.scheduleCheck();
    }

    private static scheduleCheck(): void {
        if (!this.cycleObserved || this.checkScheduled) return;
        this.checkScheduled = true;
        this.firstCheckFrame = requestAnimationFrame(() => {
            this.firstCheckFrame = undefined;
            this.secondCheckFrame = requestAnimationFrame(() => {
                this.secondCheckFrame = undefined;
                this.checkScheduled = false;
                if (Array.from(this.sources.values()).some(Boolean)) return;
                if (!this.cycleObserved) return;
                this.cycleObserved = false;
                if (typeof document !== 'undefined') {
                    document.dispatchEvent(new MapAnimationEndEvent());
                }
            });
        });
    }

    private static cancelScheduledCheck(): void {
        if (this.firstCheckFrame !== undefined) {
            cancelAnimationFrame(this.firstCheckFrame);
            this.firstCheckFrame = undefined;
        }
        if (this.secondCheckFrame !== undefined) {
            cancelAnimationFrame(this.secondCheckFrame);
            this.secondCheckFrame = undefined;
        }
        this.checkScheduled = false;
    }
}

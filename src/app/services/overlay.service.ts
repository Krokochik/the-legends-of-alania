import {
    Injectable,
    ViewContainerRef,
    ComponentRef,
    Type,
    Injector,
    createComponent,
    EnvironmentInjector,
    inject,
    afterNextRender,
} from '@angular/core';
import { TransitionService } from './transition.service';

interface OverlayEntry<T = unknown> {
    ref: ComponentRef<T>;
    componentType: Type<T>;
    zIndex: number;
    name: string;
}

@Injectable({ providedIn: 'root' })
export class OverlayService {
    private container: ViewContainerRef | null = null;

    private overlays: OverlayEntry[] = [];

    private nextZIndex = 1000;

    private readonly injector = inject(Injector);

    constructor(
        private readonly envInjector: EnvironmentInjector,
        private transitions: TransitionService,
    ) {}

    registerContainer(vcr: ViewContainerRef): void {
        if (this.container) return;
        this.container = vcr;
    }

    async show<T>(
        component: Type<T>,
        opts?: {
            injector?: Injector;
            zIndex?: number;
            skipTransition?: boolean;
            componentName: string;
        },
    ): Promise<ComponentRef<T>> {
        if (!this.container) throw new Error();

        const existing = this.overlays.find(
            o => o.componentType === component,
        );

        if (existing) {
            this.bringToTop(existing, opts?.zIndex);
            return existing.ref as ComponentRef<T>;
        }

        const componentName = opts?.componentName ?? 'UnknownOverlay';
        const tag = `[overlay_${componentName}]`;

        const zIndex = this.assignZIndex(opts?.zIndex);

        const transition = opts?.skipTransition
            ? this.transitions.instantTransition(true)
            : this.transitions.getTransition('*', tag);

        const ref = createComponent(component, {
            environmentInjector: this.envInjector,
            elementInjector: opts?.injector,
        });

        const hostEl = ref.location.nativeElement as HTMLElement;
        hostEl.style.zIndex = String(zIndex);

        this.container.insert(ref.hostView);
        ref.changeDetectorRef.detectChanges();

        const entry: OverlayEntry<T> = {
            ref,
            componentType: component,
            zIndex,
            name: componentName,
        };
        this.overlays.push(entry);
        this.overlays.sort((a, b) => a.zIndex - b.zIndex);

        afterNextRender(() => {
            transition.animation
                .run(undefined, ref.location)
                .then(() => transition.after())
                .catch(() => transition.after());
        }, { injector: this.injector });

        return ref;
    }

    async hide(
        componentType?: Type<unknown>,
        skipTransition = false,
    ): Promise<void> {
        if (!this.container || this.overlays.length === 0) return;

        const targets = componentType
            ? this.overlays.filter(o => o.componentType === componentType)
            : [...this.overlays];

        if (targets.length === 0) return;

        targets.sort((a, b) => b.zIndex - a.zIndex);

        for (const target of targets) {
            await this.hideOne(target, skipTransition);
        }
    }

    async hideAll(skipTransition = false): Promise<void> {
        return this.hide(undefined, skipTransition);
    }

    get isOpen(): boolean {
        return this.overlays.length > 0;
    }

    get top(): ComponentRef<unknown> | undefined {
        return this.overlays.at(-1)?.ref;
    }

    isOpen$(componentType: Type<unknown>): boolean {
        return this.overlays.some(o => o.componentType === componentType);
    }

    private assignZIndex(explicit?: number): number {
        if (explicit !== undefined) {
            this.nextZIndex = Math.max(this.nextZIndex, explicit + 1);
            return explicit;
        }
        return this.nextZIndex++;
    }

    private bringToTop(entry: OverlayEntry, explicitZ?: number): void {
        const newZ = this.assignZIndex(explicitZ);
        entry.zIndex = newZ;

        const hostEl = entry.ref.location.nativeElement as HTMLElement;
        hostEl.style.zIndex = String(newZ);

        this.overlays.sort((a, b) => a.zIndex - b.zIndex);
    }

    private async hideOne(entry: OverlayEntry, skipTransition: boolean): Promise<void> {
        if (!this.container) return;

        const refToRemove = entry.ref;
        const tag = `[overlay_${entry.name}]`;
        const transition = skipTransition
            ? this.transitions.instantTransition()
            : this.transitions.getTransition(tag, '*');

        this.overlays = this.overlays.filter(o => o !== entry);

        try {
            await transition.animation.run(refToRemove.location, undefined);
        } finally {
            transition.after();
            const idx = this.container.indexOf(refToRemove.hostView);
            if (idx !== -1) {
                this.container.remove(idx);
            }
        }
    }
}

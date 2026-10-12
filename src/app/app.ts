import {
    Component,
    ViewChild,
    ViewContainerRef,
    Renderer2,
    signal,
    OnInit,
    ViewRef,
    Injector,
    inject,
    afterNextRender,
    AfterViewInit, viewChild, ApplicationRef, effect
} from '@angular/core';
import { RouterOutlet, Router } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AnimatedRouterOutlet } from './animated-router-outlet';
import { TransitionService } from './services/transition.service';
import {OverlayService} from './services/overlay.service';
import {IntroOverlay} from './components/intro-overlay/intro-overlay';
import {prewarm} from 'maplibre-gl';
import {GameService} from './services/game.service';
import {DialogueService} from './services/dialogue.service';
import {LoadingOverlay} from './components/loading-overlay/loading-overlay';
import {toSignal} from '@angular/core/rxjs-interop';

@Component({
    selector: 'app-root',
    standalone: true,
    imports: [CommonModule, AnimatedRouterOutlet],
    templateUrl: 'app.html',
    styleUrl: 'app.css'
})
export class App implements OnInit {
    private readonly injector = inject(Injector);
    private previousViewRef: ViewRef | null = null;
    private destroyTimer: ReturnType<typeof setTimeout> | null = null;
    private previousUrl: string | undefined = undefined;

    protected readonly activeLayer = signal<'green' | 'blue'>('blue');

    readonly layerBlue = viewChild.required('layerBlue', { read: ViewContainerRef });
    readonly layerGreen = viewChild.required('layerGreen', { read: ViewContainerRef });
    readonly layerOverlay = viewChild.required('layerOverlay', { read: ViewContainerRef });
    readonly outlet = viewChild.required('outlet', { read: ViewContainerRef });

    constructor(
        protected router: Router,
        private renderer: Renderer2,
        private transitions: TransitionService,
        private overlay: OverlayService,
        private game: GameService,
        private dialogue: DialogueService,
        private appRef: ApplicationRef,
    ) {
    }

    ngOnInit() {
        const start = Date.now();

        this.overlay.registerContainer(this.layerOverlay());
        this.overlay.show(LoadingOverlay, {skipTransition: true});
        this.appRef.whenStable().then(() => {
            setTimeout(() => this.overlay.hide(LoadingOverlay), Math.max(0, Date.now() - start + 500));
        });

        this.game.start();
    }

    onActivate(_instance: any, routerOutlet: RouterOutlet): void {
        const viewRef = this.outlet().detach(0);
        if (!viewRef) return;

        const currentUrl = routerOutlet.activatedRoute.snapshot.url
            .map(segment => segment.path)
            .join('/')
            .toLowerCase();

        const visibleName = this.activeLayer();
        const targetName: 'green' | 'blue' = visibleName === 'green' ? 'blue' : 'green';

        const targetLayer = this.layer(targetName);
        const oldLayer    = this.layer(visibleName);

        targetLayer.insert(viewRef);
        viewRef.detectChanges();

        const oldViewRef = this.previousViewRef;

        if (this.destroyTimer !== null) {
            clearTimeout(this.destroyTimer);
            this.destroyTimer = null;
        }

        const transition = this.transitions.getTransition(this.previousUrl, currentUrl);

        afterNextRender(() => {
            this.activeLayer.set(targetName);

            transition.animation.run(
                oldViewRef ? oldLayer.element : undefined,
                targetLayer.element
            ).then(() => {
                transition.after();
                if (oldViewRef) {
                    this.destroyTimer = setTimeout(() => {
                        const idx = oldLayer.indexOf(oldViewRef);
                        if (idx !== -1) {
                            oldLayer.remove(idx);
                        }
                        this.destroyTimer = null;
                    }, 10);
                }
            });
        }, { injector: this.injector });

        this.previousViewRef = viewRef;
        this.previousUrl = currentUrl;
    }

    private layer(name: string): ViewContainerRef {
        return name === 'green' ? this.layerGreen() : this.layerBlue();
    }
}

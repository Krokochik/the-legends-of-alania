import {
    AfterViewInit,
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    OnDestroy,
    effect,
    input,
    model,
    signal,
    viewChild, OnInit,
} from '@angular/core';
import {ImageSprite} from '../../models/Sprite';
import {
    RaggedEasing,
    RaggedRevealEngine,
    RaggedRevealOptions,
} from './ragged-reveal.engine';

export interface RaggedImageAnimationOptions {
    duration?: number;
    hideDuration?: number;
    delay?: number;
    easing?: RaggedEasing;
    easingPower?: number;
    roughness?: number;
    fine?: number;
    motion?: number;
    splatter?: number;
    freezeAt?: number;
    hideFreezeAt?: number;
    originX?: number;
    originY?: number;
    testTexture?: boolean;
}

const DEFAULT_OPTIONS: RaggedRevealOptions = {
    duration: 1900,
    hideDuration: 650,
    delay: 0,
    easing: 'powerOut',
    easingPower: 8,
    roughness: 0.72,
    fine: 0.65,
    motion: 0.45,
    splatter: 0.58,
    freezeAt: 0.93,
    hideFreezeAt: 1,
    originX: 0.5,
    originY: 0.5,
    testTexture: true,
};

@Component({
    selector: 'app-ragged-image',
    standalone: true,
    imports: [],
    host: {
        '[style.--background]': 'backgroundColor()'
    },
    templateUrl: './ragged-image.html',
    styleUrl: './ragged-image.css',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RaggedImage implements OnInit, OnDestroy {

    readonly sprite = input.required<ImageSprite>();
    readonly show = model<boolean>(true);
    readonly options = input<RaggedImageAnimationOptions>({});
    readonly fallbackAspectRatio = input('16 / 10');
    readonly backgroundColor = input('#111114');

    private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
    protected readonly aspectRatio = signal(this.fallbackAspectRatio());

    private engine?: RaggedRevealEngine;
    private destroyed = false;

    private transitionId = 0;
    private loadedUrl?: string;
    private inFlightLoad?: {
        url: string;
        promise: Promise<HTMLImageElement>;
    };

    private readonly stateEffect = effect(() => {
        const sprite = this.sprite();
        const visible = this.show();

        if (!this.engine || this.destroyed) return;

        void this.syncSpriteAndVisibility(sprite, visible).catch((error: unknown) => {
            if (!this.destroyed) {
                console.error('[RaggedImage] transition failed', error);
            }
        });
    });

    private readonly optionsEffect = effect(() => {
        const next = this.options();

        if (!this.engine || this.destroyed) return;

        this.engine.setOptions(this.normalizeOptions(next));
    });

    ngOnInit(): void {
        console.log()
        if (typeof window === 'undefined') return;

        this.engine = new RaggedRevealEngine(
            this.canvas().nativeElement,
            this.normalizeOptions(this.options()),
        );

        void this.syncSpriteAndVisibility(this.sprite(), this.show()).catch((error: unknown) => {
            if (!this.destroyed) {
                console.error('[RaggedImage] initial transition failed', error);
            }
        });
    }

    ngOnDestroy(): void {
        this.destroyed = true;
        this.transitionId++;
        this.engine?.destroy();
        this.engine = undefined;
    }

    replay(): void {
        void this.engine?.replay({
            duration: this.resolveOptions().duration,
            delay: this.resolveOptions().delay,
        });
    }

    hide(): void {
        void this.engine?.hide({
            duration: this.resolveOptions().hideDuration,
        });
    }

    reveal(): void {
        void this.engine?.reveal({
            duration: this.resolveOptions().duration,
            delay: this.resolveOptions().delay,
        });
    }

    private async syncSpriteAndVisibility(
        sprite: ImageSprite,
        visible: boolean,
    ): Promise<void> {
        const engine = this.engine;
        if (!engine || this.destroyed) return;

        const id = ++this.transitionId;
        const nextUrl = sprite.url;
        const spriteChanged = nextUrl !== this.loadedUrl;

        if (spriteChanged) {
            const nextImage = await this.loadSprite(nextUrl);
            if (id !== this.transitionId || this.destroyed) return;

            if (this.loadedUrl && engine.currentOpacity > 0.001) {
                const hidden = await engine.hide({
                    duration: this.resolveOptions().hideDuration,
                });

                if (!hidden || id !== this.transitionId || this.destroyed) return;
            } else {
                await engine.hide({duration: 1});
            }

            if (id !== this.transitionId || this.destroyed) return;

            engine.uploadImage(nextImage);
            this.loadedUrl = nextUrl;
            this.updateAspectRatio(sprite, engine.aspectRatio);
        }

        if (id !== this.transitionId || this.destroyed) return;

        if (visible) {
            await engine.reveal({
                duration: this.resolveOptions().duration,
                delay: this.resolveOptions().delay,
            });
        } else {
            await engine.hide({
                duration: this.resolveOptions().hideDuration,
            });
        }
    }

    private loadSprite(url: string): Promise<HTMLImageElement> {
        if (this.inFlightLoad?.url === url) {
            return this.inFlightLoad.promise;
        }

        const promise = this.engine!.loadImage(url).finally(() => {
            if (this.inFlightLoad?.url === url) {
                this.inFlightLoad = undefined;
            }
        });

        this.inFlightLoad = {url, promise};
        return promise;
    }

    private updateAspectRatio(sprite: ImageSprite, actualAspectRatio: number): void {
        const width = sprite.width;
        const height = sprite.height;

        if (width && height) {
            this.aspectRatio.set(`${width} / ${height}`);
            return;
        }

        if (actualAspectRatio > 0) {
            this.aspectRatio.set(`${actualAspectRatio} / 1`);
        }
    }

    private resolveOptions(): RaggedRevealOptions {
        return this.normalizeOptions(this.options());
    }

    private normalizeOptions(
        inputOptions: RaggedImageAnimationOptions,
    ): RaggedRevealOptions {
        return {
            ...DEFAULT_OPTIONS,
            ...inputOptions,
            freezeAt: clamp(inputOptions.freezeAt ?? DEFAULT_OPTIONS.freezeAt, 0.74, 0.99),
            hideFreezeAt: clamp(inputOptions.hideFreezeAt ?? DEFAULT_OPTIONS.hideFreezeAt, 0, 1),
            originX: clamp(inputOptions.originX ?? DEFAULT_OPTIONS.originX, 0, 1),
            originY: clamp(inputOptions.originY ?? DEFAULT_OPTIONS.originY, 0, 1),
            easingPower: Math.max(
                2,
                inputOptions.easingPower ?? DEFAULT_OPTIONS.easingPower,
            ),
        };
    }
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Number(value) || min));
}

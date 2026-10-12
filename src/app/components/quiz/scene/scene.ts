import {AfterViewInit, Component, effect, ElementRef, HostBinding, signal, viewChild, ViewChild} from '@angular/core';
import {RouterOutlet} from "@angular/router";
import {Sprite} from '../../sprite/sprite';
import {SceneService} from '../../../services/quiz/scene.service';

@Component({
    imports: [
        RouterOutlet,
        Sprite
    ],
    host: {
        '[class.loading]': 'loading()'
    },
    selector: 'app-scene',
    styleUrl: './scene.css',
    templateUrl: './scene.html',
})
export class Scene {

    readonly pressTop = viewChild.required<ElementRef<HTMLElement>>('pressTop');
    readonly pressBottom = viewChild.required<ElementRef<HTMLElement>>('pressBottom');
    readonly vignette = viewChild.required<ElementRef<HTMLElement>>('vignette');
    readonly vignetteRects = viewChild.required<ElementRef<HTMLElement>>('vignetteRects');
    readonly vignetteOverlay = viewChild.required<ElementRef<HTMLElement>>('vignetteOverlay');

    width: number;
    height: number;
    loading = signal(false);

    constructor(private scene: SceneService) {
        this.width = document.body.offsetWidth;
        this.height = document.body.offsetHeight;

        effect(() => {
            const state = this.scene.curtainsState();
            if (!state) return;
            this.loading.set(true)
;            if (state.type === 'press') {
                this.animatePress(state.position);
            } else if (state.type === 'vignette') {
                this.animateVignette(state.position);
            }
        });

    }

    animatePress(position: 'start' | 'finish') {
        const top = this.pressTop().nativeElement;
        const bottom = this.pressBottom().nativeElement;
        const translate = this.height / 2 - 23 / 2;

        if (position === 'start') {
            const duration = 1500;

            const opts: KeyframeAnimationOptions = {
                duration,
                easing: "cubic-bezier(0.42, 0, 0.58, 1)",
                fill: "forwards"
            };

            top.animate([
                {"transform": `translateY(-${this.height}px)`},
                {"transform": `translateY(-${translate}px)`},
            ], opts);
            bottom.animate([
                {"transform": `translateY(${this.height}px)`},
                {"transform": `translateY(${translate}px)`},
            ], opts);
            bottom.querySelector("app-sprite > *")!.animate([
                {"opacity": "1"},
                {"opacity": "0"},
            ], {
                delay: duration - 195,
                duration: 195,
                easing: "ease-out",
                fill: "forwards"
            });

            setTimeout(() => this.scene.notify(), duration);
        } else {
            const duration = 500;

            const opts: KeyframeAnimationOptions = {
                duration,
                easing: "ease-out",
                fill: "forwards"
            };

            const animation = top.animate([
                {"transform": `translateY(-${translate}px)`},
                {"transform": `translateY(-${this.height}px)`},
            ], opts);
            bottom.animate([
                {"transform": `translateY(${translate}px)`},
                {"transform": `translateY(${this.height}px)`},
            ], opts);
            bottom.querySelector("app-sprite > *")!.animate([
                {"opacity": "0"},
                {"opacity": "1"},
            ], {
                duration: 20,
                easing: "ease-out",
                fill: "forwards"
            });

            animation.finished.then(() => {
                this.scene.notify()
                this.loading.set(false);
            });
        }
    }

    animateVignette(position: 'start' | 'finish') {
        const vignette = this.vignette().nativeElement;
        const vignetteRects = this.vignetteRects().nativeElement;
        const vignetteOverlay = this.vignetteOverlay().nativeElement;

        if (position === 'start') {
            const animation = vignetteOverlay.animate([
                {"transform": "translate(-50%, -50%)"},
                {"transform": "translate(-50%, -50%) scale(0.001)"},
            ], {
                duration: 1500,
                easing: "cubic-bezier(0, 0, 0.35, 0.98)"
            });
            vignetteRects.querySelectorAll("& > *")!.forEach((rect, i) => {
                const animationTop = [
                    {"transform": `translateY(-${this.height}px)`},
                    {"transform": `translateY(-${this.height / 2}px)`},
                ];
                const animationBottom = [
                    {"transform": `translateY(${this.height}px)`},
                    {"transform": `translateY(${this.height / 2}px)`},
                ];
                const animationRight = [
                    {"transform": `translateX(${this.width}px)`},
                    {"transform": `translateX(${this.width / 2}px)`},
                ];
                const animationLeft = [
                    {"transform": `translateX(-${this.width}px)`},
                    {"transform": `translateX(-${this.width / 2}px)`},
                ];

                const animation = i == 0 ? animationTop
                    : i == 1 ? animationBottom
                        : i == 2 ? animationRight
                            : animationLeft;

                rect.animate(animation, {
                    delay: 750,
                    duration: 750,
                    fill: "forwards",
                    easing: "cubic-bezier(0, 0, 0.35, 0.98)"
                })
            });

            animation.finished.then(() => {
                this.scene.notify()
                this.loading.set(false);
            });
        } else {
            const animation = vignette.animate([
                { "opacity": "1", "display": "block" },
                { "opacity": "0", "display": "none" },
            ], {
                duration: 750,
                easing: "ease-out",
                fill: "forwards"
            });

            animation.finished.then(() => {
                this.scene.notify();
                this.loading.set(false);
            })
        }
    }

}

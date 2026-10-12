import {
    AfterViewInit,
    Component,
    ElementRef, input,
    Input,
    OnChanges,
    OnDestroy, OnInit,
    SimpleChanges, viewChild,
    ViewChild,
} from '@angular/core';
import {AmazingButtonColors, AmazingButtonEngine} from './amazing-button-engine';

@Component({
    standalone: true,
    imports: [],
    selector: 'button[amazing-button]',
    styleUrl: './amazing-button.css',
    template: `
        <canvas class="background" #canvas aria-hidden="true"></canvas>
        <ng-content/>
    `,
})
export class AmazingButton implements OnInit, OnChanges, OnDestroy {
    readonly defaultColorSet = [
        '#8a50d2', '#81a6a0', '#cb9646',
        '#8f895f', '#ad3535', '#75a243',
        '#2e7cad', '#a24384', '#c47740',
        '#26a650', '#71bd75', '#bb90e3',
        '#f67e82', '#4844b6', '#c00000'
    ];

    private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');

    readonly colors = input(this.randomColors());
    readonly seed = input<number>();
    readonly textureIntensity = input(1.25);

    private engine?: AmazingButtonEngine;

    ngOnInit(): void {
        this.engine = new AmazingButtonEngine(this.canvas().nativeElement, {
            colors: this.toPalette(this.colors()),
            seed: this.seed() ?? Math.random() * 100_000,
            intensity: this.textureIntensity(),
        });
    }

    ngOnChanges(changes: SimpleChanges): void {
        if (!this.engine) return;

        if (changes['colors']) {
            const previous = changes['colors'].previousValue as readonly string[] | undefined;
            const unchanged = previous
                && previous.length === this.colors().length
                && previous.every((color, index) => color === this.colors()[index]);
            if (!unchanged) this.engine.setColors(this.toPalette(this.colors()));
        }
        if (changes['seed']) this.engine.setSeed(this.seed() ?? Math.random() * 100_000);
        if (changes['textureIntensity']) this.engine.setIntensity(this.textureIntensity());
    }

    ngOnDestroy(): void {
        this.engine?.destroy();
        this.engine = undefined;
    }

    private randomColors(): string[] {
        const shuffled = [...this.defaultColorSet];

        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }

        return shuffled.slice(0, 3);
    }

    private toPalette(colors: readonly string[]): AmazingButtonColors {
        return [
            colors[0],
            colors[1],
            colors[2],
        ];
    }

}

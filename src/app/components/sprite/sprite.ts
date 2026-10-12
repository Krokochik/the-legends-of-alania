import {Component, HostBinding, input, Input, model, OnInit, signal} from '@angular/core';
import {ResourceService} from "../../services/resource.service";
import {Sprite as SpriteModel} from "../../models/Sprite";
import {DomSanitizer} from '@angular/platform-browser';
import {NgOptimizedImage} from '@angular/common';
import {FaIconComponent} from '@fortawesome/angular-fontawesome';
import {computeFilter} from '../../../color-filter-generator';

@Component({
    imports: [
        NgOptimizedImage,
        FaIconComponent
    ],
    host: {
        'style.filter': 'hostFilter()'
    },
    selector: 'app-sprite',
    styleUrl: './sprite.css',
    templateUrl: './sprite.html',
})
export class Sprite implements OnInit {

    readonly hostFilter = signal('');

    readonly src = input('unknown');
    readonly width = model<number>();
    readonly height = model<number>();
    readonly color = input<string>();

    protected sprite?: SpriteModel;
    protected filter?: string;

    constructor(private sprites: ResourceService,
                protected sanitizer: DomSanitizer) {
    }

    ngOnInit(): void {
        this.sprite = this.sprites.getSprite(this.src());
        this.width.set(this.width() ?? this.sprite.width);
        this.height.set(this.height() ?? this.sprite.height);

        if (this.sprite.type !== 'font-awesome' && this.color()) {
            this.filter = computeFilter(this.color()!, 0.5, 50).filter;
        }

        if (this.sprite.type === 'html') {
            this.sprite.content = this.sprite.content.replaceAll("$height", `${this.height()}`);
            this.sprite.content = this.sprite.content.replaceAll("$width", `${this.width()}`);
            this.sprite.content = this.sprite.content.replaceAll("$filter", `${this.filter}`);
            if (this.color())
                this.sprite.content = this.sprite.content.replaceAll("$color", `${this.color()}`);
            if (this.filter)
                this.hostFilter.set(this.filter);

            while (true) {
                const dynStart = this.sprite.content.indexOf('$eval(');
                if (dynStart < 0) break;
                let dynEnd = this.sprite.content.length;
                let balance = 0;
                for (let i = 6; i < dynEnd; i++) {
                    const char = this.sprite.content.charAt(dynStart + i);
                    if (char === '(') balance++;
                    if (char === ')') balance--;
                    if (balance < 0) {
                        dynEnd = i + dynStart;
                        break;
                    }
                }
                const dyn = this.sprite.content.substring(dynStart + 6, dynEnd);
                const res = eval(dyn);
                this.sprite.content = this.sprite.content.replaceAll('$eval(' + dyn + ')', res);
            }
        }
    }

}

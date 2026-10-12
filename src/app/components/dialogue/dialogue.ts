import {
    afterNextRender,
    AfterViewInit,
    Component, computed, effect,
    ElementRef, HostListener,
    Injector,
    OnInit,
    signal, untracked,
    viewChildren
} from '@angular/core';
import {DialogueService} from '../../services/dialogue.service';
import {DialogueLine} from '../../models/DialogueLine';
import {DialogueOption} from '../../models/DialogueOption';
import {Sprite} from '../sprite/sprite';
import {DialogueResult} from '../../models/DialogueResult';
import {OptionsResult} from 'yarn-bound';
import {RaggedImage} from '../ragged-image/ragged-image';
import {ResourceService} from '../../services/resource.service';
import {firstValueFrom, timer} from 'rxjs';
import {OverlayService} from '../../services/overlay.service';
import {LoadingOverlay} from '../loading-overlay/loading-overlay';
import {AmazingButton} from '../amazing-button/amazing-button';
import {FaIconComponent} from '@fortawesome/angular-fontawesome';
import {faCaretRight, faChevronRight} from '@fortawesome/free-solid-svg-icons';
import {Character} from '../../models/Character';

@Component({
    imports: [
        Sprite,
        RaggedImage,
        AmazingButton,
        FaIconComponent
    ],
    selector: 'app-dialogue',
    styleUrl: './dialogue.css',
    templateUrl: './dialogue.html',
})
export class Dialogue implements OnInit {

    readonly lines = signal<DialogueLine[]>([]);
    readonly options = signal<DialogueOption[] | undefined>(undefined);
    readonly lineElements = viewChildren<ElementRef<HTMLDivElement>>('line');
    readonly actors = signal<Character[]>([]);
    readonly dialogueEnd = signal(false);

    heights: number[] = [];

    nextResult?: DialogueResult;

    constructor(private injector: Injector,
                protected dialogue: DialogueService,
                protected resources: ResourceService,
                protected overlay: OverlayService) {
    }

    async ngOnInit() {
        await this.dialogue.waitFor();
        await document.fonts.ready;

        const res = this.dialogue.currentResult()!;
        this.render(res);
        this.nextResult = this.dialogue.advance();
    }

    @HostListener('window:keydown', ['$event'])
    handleKeyDown(event: KeyboardEvent) {
        if (event.key >= '1' && event.key <= '9') {
            const digit = +event.key;
            if (!this.options() || this.options()!.length < digit) return;
            this.advance(this.options()![digit - 1]);
            return;
        }

        if (event.key === ' ' || event.key === 'Enter') {
            this.advance();
            event.preventDefault();
        }
    }

    render(res: DialogueResult) {
        if (Array.isArray(res)) {
            this.options.set(res);
        } else {
            if (res.character) {
                this.actors.update(old => {
                    if (!old.find(c => c.id === res.character!.id)) {
                        old.push(res.character!);
                    }
                    return old;
                });
            }
            this.options.set(undefined);

            this.lines.update(lines => {
                return [...lines, res]
            });

            afterNextRender(() => {
                const lastElement = this.lineElements().at(-1);
                if (this.lineElements().length === 1) {
                    lastElement!.nativeElement.style.transform = 'translateY(0)';
                }
                this.heights.push(lastElement!.nativeElement.getBoundingClientRect().height);

                this.scroll();

                this.removeClippedLines();
            }, {injector: this.injector});
        }
    }

    removeClippedLines() {
        this.lineElements()
            .map((el, i) => [el.nativeElement.getBoundingClientRect(), i] as const)
            .filter(([rects]) => rects.y + 7 * rects.height < 0)
            .forEach(([_, i]) => {
                this.lines.update(l => {
                    l.splice(i, 1)
                    return l;
                });
                this.heights.splice(i, 1);
            });
    }

    scroll() {
        this.lineElements()
            .map((el, i) => [el.nativeElement, i] as const)
            .reverse()
            .forEach(([el, i]) => {
                const nextElementsHeight = this.heights
                    .filter((_, nI) => nI > i)
                    .reduce((a1, a2) => a1 + a2, 0);
                el.style.transform = `translateY(-${nextElementsHeight}px)`;
            });
    }

    advance(option?: DialogueOption) {
        if (this.options() && !option) return;

        if (this.nextResult) {
            this.render(this.nextResult!);
            this.nextResult = undefined;
        }
        if (this.dialogueEnd()) return;

        this.nextResult = this.dialogue.advance(option?.index);
        if (!this.nextResult) {
            this.dialogueEnd.set(true);
            return;
        }

        if (!!option) {
            this.options.set(undefined);
            return void this.advance();
        }
        if (Array.isArray(this.nextResult)) {
            this.render(this.nextResult!);
            this.nextResult = undefined;
        }
    }

    end() {
        this.dialogue.end();
    }

    protected readonly faCaretRight = faCaretRight;
}

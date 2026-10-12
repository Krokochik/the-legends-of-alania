import {AfterViewInit, Component, computed, ElementRef, OnInit, signal, viewChild, ViewChild} from '@angular/core';
import {Sprite} from '../sprite/sprite';
import {PlayableCharacter} from '../../models/PlayableCharacter';
import {Router} from '@angular/router';
import {App} from '../../app';
import {OverlayService} from '../../services/overlay.service';
import {LoadingOverlay} from '../loading-overlay/loading-overlay';
import {GameService} from '../../services/game.service';
import {CharacterService} from '../../services/character.service';
import {GameFlag} from '../../models/GameFlag';
import {QuizService} from '../../services/quiz/quiz.service';

@Component({
    imports: [
        Sprite
    ],
    selector: 'app-character-select',
    styleUrl: './character-select.css',
    templateUrl: './character-select.html',
})
export class CharacterSelect implements OnInit {

    readonly activeId;
    readonly activeIndex = computed(() =>
        this.characters.players.findIndex(p => p.id === this.activeId()));

    readonly arrow = viewChild.required<ElementRef>('arrow');

    constructor(private game: GameService, protected characters: CharacterService, private quiz: QuizService) {
        this.activeId = signal(this.quiz.fittingPlayer().id);
    }

    ngOnInit(): void {
        this.game.setSomeFlags({[GameFlag.QUIZ_PASSED]: true});

        this.arrow().nativeElement.animate([
            { 'transform': 'translateX(250px)' },
            { 'transform': 'translateX(0)' },
        ], {
            duration: 500,
            easing: 'ease-out',
            fill: 'forwards',
        });
    }

    select(id: string) {
        this.activeId.set(id);
    }

    async confirm() {
        this.game.setCharacter(this.characters.players[this.activeIndex()]);
    }

    protected readonly Math = Math;
}

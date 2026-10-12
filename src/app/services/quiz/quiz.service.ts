import {computed, inject, Injectable, Service, signal} from '@angular/core';
import {Question} from '../../models/quiz/Question';
import {Option} from '../../models/quiz/Option';
import {GameService} from '../game.service';
import {CharacterService} from '../character.service';

@Service()
export class QuizService {
    private readonly _questions: Question[] = [
        {
            text: 'Какой досуг вы предпочтете?',
            options: [
                {
                    text: 'Лежать дома',
                    sprite: 'quiz_opt_stub',
                    character: 'student'
                },
                {
                    text: 'Узнавать что-то новое',
                    sprite: 'quiz_opt_stub',
                    character: 'tourist'
                },
                {
                    text: 'Изучать новые места',
                    sprite: 'quiz_opt_stub',
                    character: 'scientist'
                },
                {
                    text: 'Тусоваться',
                    sprite: 'quiz_opt_stub',
                    character: 'hipster'
                }
            ]
        },
        {
            text: 'Лучший вкус зубной пасты?',
            options: [
                {
                    text: 'Что-нибудь сладкое',
                    sprite: 'quiz_opt_stub',
                    character: 'student'
                },
                {
                    text: 'Какая разница?',
                    sprite: 'quiz_opt_stub',
                    character: 'tourist'
                },
                {
                    text: 'Естественный',
                    sprite: 'quiz_opt_stub',
                    character: 'hipster'
                },
                {
                    text: 'Чистить зубы? Дела не ждут!',
                    sprite: 'quiz_opt_stub',
                    character: 'scientist'
                }
            ]
        },
        {
            text: 'Какую книгу вы бы купили?',
            options: [
                {
                    text: '"Сопри эту книгу" - Эбби Хоффман',
                    sprite: 'quiz_opt_stub',
                    character: 'hipster'
                },
                {
                    text: '"В диких условиях" - Джон Кракауэр',
                    sprite: 'quiz_opt_stub',
                    character: 'tourist'
                },
                {
                    text: '"Франкенштейн" - Мэри Шелли',
                    sprite: 'quiz_opt_stub',
                    character: 'scientist'
                },
                {
                    text: '"Гарри Поттер" - Джоан Роулинг',
                    sprite: 'quiz_opt_stub',
                    character: 'student'
                }
            ]
        },
        {
            text: 'Что вам ближе?',
            options: [
                {
                    text: 'В движении - жизнь',
                    sprite: 'quiz_opt_stub',
                    character: 'tourist'
                },
                {
                    text: 'Знание - сила',
                    sprite: 'quiz_opt_stub',
                    character: 'scientist'
                },
                {
                    text: 'Красота спасёт мир',
                    sprite: 'quiz_opt_stub',
                    character: 'hipster'
                },
                {
                    text: 'Я знаю, что ничего не знаю',
                    sprite: 'quiz_opt_stub',
                    character: 'student'
                }
            ]
        },
    ];

    readonly weights: Record<string, number> = {};

    private readonly _questionIndex = signal(0);
    readonly question = computed(() => this._questions[this._questionIndex()]);

    game = inject(GameService);
    characters = inject(CharacterService);

    nextQuestion(): void {
        this._questionIndex.set(this._questionIndex() + 1);
    }

    isLastQuestion(): boolean {
        return this._questionIndex() === this._questions.length - 1;
    }

    select(opt: Option) {
        this.weights[opt.character] = (this.weights[opt.character] ?? 0) + 1;
    }

    fittingPlayer() {
        const id = Object.entries(this.weights).sort((a, b) => b[1] - a[1])[0][0];
        return this.characters.getPlayer(id)!;
    }

}

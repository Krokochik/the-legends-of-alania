import {Component} from '@angular/core';
import {Question as QuestionModel} from "../../../models/quiz/Question";
import {QuizService} from "../../../services/quiz/quiz.service";
import {ActivatedRoute, Router} from "@angular/router";
import {Sprite} from "../../sprite/sprite";
import {Option} from "../../../models/quiz/Option";
import {SceneService} from '../../../services/quiz/scene.service';

@Component({
    imports: [
        Sprite
    ],
    selector: 'app-question',
    styleUrl: './question.css',
    templateUrl: './question.html',
})
export class Question {

    constructor(
        protected quiz: QuizService,
        protected scene: SceneService,
        private router: Router
    ) {}

    select(option: Option) {
        this.quiz.select(option);
        if (!this.quiz.isLastQuestion()) {
            this.scene.transition('start', 'press', () => {
                this.quiz.nextQuestion();
                setTimeout(() => this.scene.transition('finish', 'press'), 300);
            });
        } else {
            this.scene.transition('start', 'vignette', () => {
                this.router.navigate(['quiz/character']);
                this.scene.transition('finish', 'vignette');
            });
        }
    }

}

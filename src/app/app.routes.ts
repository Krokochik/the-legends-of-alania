import { Routes } from '@angular/router';
import {Scene as QuizScene} from "./components/quiz/scene/scene";
import {Question} from "./components/quiz/question/question";
import {CharacterSelect} from './components/character-select/character-select';
import {preloadQuizGuard} from './guards/preload-quiz-guard';
import {preloadMapGuard} from './guards/preload-map-guard';
import {Scene as MapScene} from "./components/map/scene/scene";
import {Dialogue} from './components/dialogue/dialogue';
import {LoadingOverlay} from './components/loading-overlay/loading-overlay';

export const routes: Routes = [
    {
        path: 'quiz',
        component: QuizScene,
        canActivate: [preloadQuizGuard, preloadMapGuard],
        children: [
            {
                path: '',
                component: Question
            },
            {
                path: 'character',
                component: CharacterSelect
            }
        ]
    },
    {
        path: 'game/map',
        component: MapScene,
        canActivate: [preloadMapGuard],
    },
    {
        path: 'game/dialogue',
        component: Dialogue,
    }
];

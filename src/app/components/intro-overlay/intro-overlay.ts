import {Component, OnInit, signal} from '@angular/core';
import {wait} from '../../app.config';

@Component({
    imports: [],
    host: {
        '[class.hiding]': 'hiding()'
    },
    selector: 'app-intro-overlay',
    styleUrl: './intro-overlay.css',
    templateUrl: './intro-overlay.html',
})
export class IntroOverlay {

    protected readonly hiding = signal(false);

    async hide(): Promise<void> {
        this.hiding.set(true);
        await wait(5000);
    }

}

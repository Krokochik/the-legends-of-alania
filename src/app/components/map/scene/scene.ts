import {Component, OnInit} from '@angular/core';
import {Sprite} from '../../sprite/sprite';
import {MapComponent} from '../map.component';
import {OverlayService} from '../../../services/overlay.service';
import {LoadingOverlay} from '../../loading-overlay/loading-overlay';

@Component({
    imports: [
        MapComponent
    ],
    selector: 'app-scene',
    styleUrl: './scene.css',
    templateUrl: './scene.html',
})
export class Scene implements OnInit {

    constructor(private overlay: OverlayService) {
    }

    ngOnInit(): void {
        // this.overlay.show(LoadingOverlay);
    }

}

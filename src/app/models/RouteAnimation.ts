import {ElementRef} from '@angular/core';

export interface RouteAnimation {
    duration: number;
    run: (prev?: ElementRef, cur?: ElementRef) => Promise<void>;
}

import {CanActivateFn} from '@angular/router';
import {inject} from '@angular/core';
import {ResourceService} from '../services/resource.service';

export const preloadMapGuard: CanActivateFn = (route, state) => {
    const sprites = inject(ResourceService);
    sprites.preloadGroup("map");
    return true;
};

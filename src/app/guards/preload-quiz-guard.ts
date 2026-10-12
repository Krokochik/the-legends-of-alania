import {CanActivateFn} from '@angular/router';
import {inject} from '@angular/core';
import {ResourceService} from '../services/resource.service';

export const preloadQuizGuard: CanActivateFn = (route, state) => {
    const sprites = inject(ResourceService);
    sprites.preloadGroup("quiz");
    return true;
};

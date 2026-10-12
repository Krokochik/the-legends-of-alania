import {ApplicationConfig, provideBrowserGlobalErrorListeners} from '@angular/core';
import {PreloadAllModules, provideRouter, RouteReuseStrategy, withPreloading} from '@angular/router';
import {routes} from './app.routes';
import {CustomReuseStrategy} from './router-reuse-strategy';

export const appConfig: ApplicationConfig = {
    providers: [
        provideBrowserGlobalErrorListeners(),
        provideRouter(routes, withPreloading(PreloadAllModules)),
        { provide: RouteReuseStrategy, useClass: CustomReuseStrategy },
    ]
};

export function oneTimeListener(type: string, listener: (v?: any) => any) {
    document.addEventListener(type, e => {
        document.removeEventListener(type, listener);
        listener(e);
    });
}

export function waitFor(event: string) {
    return new Promise(resolve => oneTimeListener(event, resolve));
}

export function wait(time: number) {
    return new Promise(resolve => setTimeout(resolve, time));
}

import { Injectable } from '@angular/core';
import { RouteReuseStrategy, ActivatedRouteSnapshot, DetachedRouteHandle } from '@angular/router';

@Injectable()
export class CustomReuseStrategy implements RouteReuseStrategy {
    private handlers = new Map<string, DetachedRouteHandle>();

    shouldDetach(route: ActivatedRouteSnapshot): boolean {
        return route.data?.['reuse'] === true;
    }

    store(route: ActivatedRouteSnapshot, handle: DetachedRouteHandle): void {
        if (handle) {
            this.handlers.set(route.routeConfig?.path ?? '', handle);
        }
    }

    shouldAttach(route: ActivatedRouteSnapshot): boolean {
        return this.handlers.has(route.routeConfig?.path ?? '');
    }

    retrieve(route: ActivatedRouteSnapshot): DetachedRouteHandle | null {
        return this.handlers.get(route.routeConfig?.path ?? '') ?? null;
    }

    shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot): boolean {
        return future.routeConfig === curr.routeConfig;
    }
}

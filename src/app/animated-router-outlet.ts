import { Directive, ViewContainerRef, ComponentRef, inject } from '@angular/core';
import { RouterOutlet, ActivatedRoute } from '@angular/router';

@Directive({
    selector: 'animated-router-outlet',
    standalone: true,
    exportAs: 'outlet'
})
export class AnimatedRouterOutlet extends RouterOutlet {
    private readonly vcr = inject(ViewContainerRef);

    override activateWith(activatedRoute: ActivatedRoute, environmentInjector: any): void {
        super.activateWith(activatedRoute, environmentInjector);

        const componentRef = this.component as ComponentRef<any> | null;
        if (!componentRef) return;

        const viewRef = componentRef.hostView;
        const index = this.vcr.indexOf(viewRef);
        if (index !== -1) {
            this.vcr.detach(index);
        }
    }
}

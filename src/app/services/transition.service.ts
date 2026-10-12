import {ElementRef, Service} from '@angular/core';
import {animationRule, AnimationRule} from '../models/AnimationRule';
import {RouteAnimation} from '../models/RouteAnimation';

@Service()
export class TransitionService {
    private readonly _transitionRegistry: AnimationRule[] = [
        animationRule(this.build('* => [overlay_IntroOverlay]', this.fadeTransition({
            persist: true,
            invert: true,
            duration: 750
        }))),
        animationRule(this.build('* => [overlay_*]', this.fadeTransition({
            persist: true,
            invert: true
        }))),
        animationRule(this.build('[overlay_*] => *', this.fadeTransition({
            persist: true
        }))),
    ];

    private readonly defaultTransition: AnimationRule = {
        from: '*',
        to: '*',
        animation: {
            run: async (_0, _1) => {},
            duration: 0
        },
        after: () => {}
    };

    private match(pattern: string, value: string): boolean {
        if (pattern === '*') return true;
        const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp('^' + escaped.replace('\\*', '.*') + '$');
        return regex.test(value);
    }

    getTransition(from: string | undefined, to: string): AnimationRule {
        if (from === undefined) from = '*';
        for (const rule of this._transitionRegistry) {
            if (this.match(rule.from, from) && this.match(rule.to, to)) {
                return rule;
            }
        }
        return this.defaultTransition;
    }

    fadeTransition(opts: {persist?: boolean, invert?: boolean, instant?: boolean, duration?: number} = {}) {
        const duration = opts.instant ? 0 : opts.duration ?? 300;
        let animation: Animation;

        const run = (prev?: ElementRef, cur?: ElementRef) => {
            const target = prev ?? cur;
            if (!target) return Promise.resolve();
            let frames = [
                { opacity: 1 }, { opacity: 0 }
            ];
            if (opts.invert) frames = frames.reverse();
            animation = target.nativeElement.animate(frames, {
                duration, fill: 'forwards'
            });
            return animation.finished as any;
        };
        const after = () => {
            if (!(opts.persist ?? true)) animation?.cancel();
        }

        return {run, after, duration};
    }

    instantTransition(invert = false) {
        return animationRule(this.build('* => *', this.fadeTransition({
            persist: true,
            instant: true,
            invert
        })));
    }

    private build(rule: string, opts: Pick<AnimationRule, 'after'> & RouteAnimation) {
        return {
            rule,
            after: opts.after,
            animation: {
                run: opts.run,
                duration: opts.duration,
            }
        };
    }
}

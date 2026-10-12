import {RouteAnimation} from './RouteAnimation';

export interface AnimationRule {
    from: string;
    to: string;
    animation: RouteAnimation;
    after: () => void;
}

export function animationRule(opts: Omit<AnimationRule, 'from' | 'to'> & {rule: string}): AnimationRule {
    const [from, to] = opts.rule.match(/(.+?)\s*=>\s*(.+)/)!.slice(1);
    return {
        from, to,
        animation: opts.animation,
        after: opts.after
    };
}

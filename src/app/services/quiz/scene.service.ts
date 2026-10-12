import {Injectable, Service, Signal, signal, WritableSignal} from '@angular/core';

@Service()
export class SceneService {

    readonly curtainsState: WritableSignal<{
        position: 'start' | 'finish';
        type: 'vignette' | 'press';
    } | undefined> = signal(undefined);

    private _callbacks: Set<() => void> = new Set();

    transition(position: 'start' | 'finish', type: 'vignette' | 'press', callback?: () => void) {
        this.curtainsState.set({ position, type });
        if (callback) {
            const wrapper = () => {
                callback();
                this._callbacks.delete(wrapper); // Удаляем именно обертку
            };
            this._callbacks.add(wrapper);
        }
    }

    notify() {
        this._callbacks.forEach(callback => callback());
    }

}

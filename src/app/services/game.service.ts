import {computed, effect, inject, Injector, Service, signal, WritableSignal} from '@angular/core';
import {GameFlags, GameState, SerializedGameState} from '../models/GameState';
import {GameFlag} from '../models/GameFlag';
import {Router} from '@angular/router';
import {Dialogue} from '../models/Dialogue';
import {DialogueService} from './dialogue.service';
import {LoadingOverlay} from '../components/loading-overlay/loading-overlay';
import {ScenarioService} from './scenario.service';
import {all, MapService} from './map.service';
import {PlayableCharacter} from '../models/PlayableCharacter';
import {CharacterService} from './character.service';
import {oneTimeListener, wait, waitFor} from '../app.config';
import {MapLoadedEvent} from '../models/events/MapLoadedEvent';
import {IntroOverlay} from '../components/intro-overlay/intro-overlay';
import {DialogueEndEvent} from '../models/events/DialogueEndEvent';
import {filter, firstValueFrom, forkJoin, take, tap, timer} from 'rxjs';
import {toObservable} from '@angular/core/rxjs-interop';
import {OverlayService} from './overlay.service';
import {TransitionService} from './transition.service';
import {MAP_MARKER_POINTS} from '../components/map/map-model-markers';
import {MapAnimationEndEvent} from '../models/events/MapAnimationEndEvent';

@Service()
export class GameService {

    private readonly STATE_STORAGE_KEY = 'gamesave';

    readonly state: GameState;
    private readonly save: WritableSignal<SerializedGameState>;

    router = inject(Router);
    scenario = inject(ScenarioService);
    map = inject(MapService);
    characters = inject(CharacterService);
    overlay = inject(OverlayService);
    injector = inject(Injector);
    transitions = inject(TransitionService);
    _dialogue?: DialogueService;

    get dialogue(): DialogueService {
        if (!this._dialogue) this._dialogue = this.injector.get(DialogueService);
        return this._dialogue;
    }

    constructor() {
        this.state = this.loadState();

        this.save = signal(this.state.serialize());
        effect(() => this.save.update(old => ({
            ...old,
            player: this.state.player()?.id,
            flags: this.state.flags(),
            dialogueNode: this.state.dialogueNode() ?? old.dialogueNode
        })));
        effect(() => this.writeSave());

        effect(() => {
            this.map.setMarkerStates(this.state.plotNode().mapState);
        });
    }

    async start() {
        if (!this.state.flags()[GameFlag.QUIZ_PASSED]) {
            await this.router.navigate(['quiz']);
        } else if (!this.state.player()) {
            await this.router.navigate(['quiz/character']);
        } else if (this.state.plotNode().id === 0) {
            await this.intro();
        } else {
            await this.openDialogue();
            this.setupDialogueListener();
        }
    }

    setupDialogueListener() {
        document.addEventListener(DialogueEndEvent.TYPE, async () => {
            await this.overlay.show(LoadingOverlay);
            await wait(this.getOverlayTransitionDuration('LoadingOverlay'));

            await this.router.navigate(['game/map']);
            await waitFor(MapLoadedEvent.TYPE);

            if (!this.scenario.hasNextNode()) {
                this.map.markerStates.set(all('active'));
                this.map.hideRoutes.set(true);
                await this.overlay.hide(LoadingOverlay);
                return;
            }

            await this.overlay.hide(LoadingOverlay);

            if (this.scenario.hasNextNode()) {
                await wait(1500);
                await this.nextPlotNode();
            }
        });
    }

    setCharacter(character?: PlayableCharacter) {
        this.state.writable().player.set(character);
        this.intro();
    }

    setDialogueNode(node?: string) {
        this.state.writable().dialogueNode.set(node);
    }

    setSomeFlags(flags: GameFlags) {
        this.state.writable().flags.update(old => ({
            ...old,
            ...flags
        }));
    }

    savePlotNode() {
        if (this.state.plotNode().id !== this.save().plotNode) {
            this.state.writable().dialogueNode.set(undefined);
        }
        this.save.update(old => ({
            ...old,
            plotNode: this.state.plotNode().id,
            dialogueNode: this.state.dialogueNode()
        }));
    }

    async nextPlotNode(followRout = true) {
        const nextNode = this.scenario.nextNode();
        if (!nextNode) return;

        if (!followRout) this.map.cameraTarget.set({});
        await waitFor(MapAnimationEndEvent.TYPE);
        await wait(1500);
        await this.overlay.show(LoadingOverlay);
        await wait(this.getOverlayTransitionDuration('LoadingOverlay'));
        this.savePlotNode();
        await this.openDialogue();
    }

    loadState(loadDefault = false): GameState {
        const json = loadDefault ? undefined : localStorage.getItem(this.STATE_STORAGE_KEY);
        try {
            const state: SerializedGameState = json ? JSON.parse(json) : {};
            if (Number.isInteger(state.plotNode)) {
                this.scenario.setCurrentNode(state.plotNode!);
            }
            const flags = state.flags ?? {};
            return new GameState({
                player: signal(this.characters.getPlayer(state.player)),
                dialogueNode: signal(state.dialogueNode),
                plotNode: computed(() => this.scenario.getCurrentNode()),
                flags: signal(flags)
            });
        } catch (e) {
            console.error("Failed to read game save", e);
            return this.loadState(true);
        }
    }

    writeSave() {
        localStorage.setItem(this.STATE_STORAGE_KEY, JSON.stringify(this.save()));
    }

    readonly dialogueReady = signal(false);

    async openDialogue() {
        const start = Date.now();
        const goto = () => this.router.navigate(['game/dialogue']);

        await this.overlay.show(LoadingOverlay);

        await this.dialogue!.waitFor();
        await wait(Date.now() - start + 1000);

        await goto();

        await this.overlay.hide(LoadingOverlay);
    }

    async intro() {
        await this.openDialogue();
        await waitFor(DialogueEndEvent.TYPE);

        const overlay = await this.overlay.show(IntroOverlay);
        await wait(this.getOverlayTransitionDuration('IntroOverlay'));

        await this.router.navigate(['game/map']);
        await waitFor(MapLoadedEvent.TYPE);

        const markerStates = this.map.markerStates();
        this.map.markerStates.set(all('hidden'));

        this.map.cameraTarget.set({
            pitch: 0,
            zoom: 12.4,
            durationMs: 0
        });

        await overlay.instance.hide();
        await this.overlay.hide(IntroOverlay);

        this.map.cameraTarget.set({
            pitch: 55,
            durationMs: 2500,
            bearing: 40,
            x: MAP_MARKER_POINTS[0].x - 100,
            y: MAP_MARKER_POINTS[0].y - 50,
        });
        await wait(1500);
        this.map.markerStates.set(markerStates);
        await wait(1000);
        this.map.cameraTarget.set({
            zoom: 12.9
        });
        await wait(1500);
        await this.nextPlotNode(false);
        this.setupDialogueListener();
    }

    async openCharacterSelect() {
        await this.router.navigate(['quiz/character']);
    }

    async openMap() {
        await this.overlay.show(LoadingOverlay);
        oneTimeListener(MapLoadedEvent.TYPE, () => this.overlay.hide(LoadingOverlay));
        await this.router.navigate(['game/map']);
    }

    private getOverlayTransitionDuration(name: string): number {
        return this.transitions.getTransition('*', `[overlay_${name}]`)?.animation?.duration ?? 0;
    }

}

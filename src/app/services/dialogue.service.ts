import {computed, effect, inject, Injector, OnInit, Service, signal, Signal, WritableSignal} from '@angular/core';
import {GameService} from './game.service';
import {GameState} from '../models/GameState';
import YarnBound, {CommandResult, DialogueResult as YarnDialogueResult, OptionsResult, TextResult} from 'yarn-bound';
import {ResourceService} from './resource.service';
import {toObservable} from '@angular/core/rxjs-interop';
import {filter, firstValueFrom, take} from 'rxjs';
import {DialogueLine} from '../models/DialogueLine';
import {DialogueResult} from '../models/DialogueResult';
import {CharacterService} from './character.service';
import {CommandArgs, parseCommand} from '../models/Command';
import {DialogueGraphics, SpriteDialogueGraphics} from '../models/DialogueGraphics';
import {DialogueEndEvent} from '../models/events/DialogueEndEvent';
import {oneTimeListener, waitFor} from '../app.config';

@Service()
export class DialogueService {

    readonly _commands: Record<string, (args: CommandArgs) => void> = {
        'show_graphics': args => {
            if (args.length == 2 && args[0] === 'sprite' && typeof args[1] === 'string') {
                this.showGraphics(new SpriteDialogueGraphics(args[1]));
            } else {
                console.error('Bad args for command "show_graphics"', args);
            }
        }
    };

    game = inject(GameService);
    resources = inject(ResourceService);
    characters = inject(CharacterService);
    injector = inject(Injector);

    runner?: YarnBound;

    readonly name: Signal<string | undefined>;
    readonly graphics = signal<DialogueGraphics | undefined>(undefined);
    readonly dialogueEnd = signal(false);
    private readonly ready = signal(false);

    constructor() {
        this.name = computed(() => this.game.state.plotNode().dialogue);

        effect(() => this.setup());
    }

    async setup(retry = false): Promise<void> {
        this.ready.set(false);
        if (!this.name!()) return this.runner = undefined;

        this.dialogueEnd.set(false);
        try {
            this.runner = new YarnBound({
                dialogue: await this.resources.get(`dialogue_${this.name!()!}`),
                startAt: this.game.state.dialogueNode(),
                handleCommand: command => {
                    if (!(command instanceof CommandResult)) {
                        console.error("Unknown command received", command);
                        return;
                    }
                    const {name, args} = parseCommand(command.command)!;
                    const exec = this._commands[name];
                    if (!exec) {
                        console.error("Command not found", command);
                        return;
                    }
                    exec(args);
                }
            });
        } catch (e) {
            if (retry) {
                console.error('Failed to initialize Yarn bound.', e);
                return;
            }
            console.error('Error initializing Yarn bound. Trying to reset node from ' + this.game.state.dialogueNode());
            this.game.setDialogueNode(undefined);
            return await this.setup(true);
        }
        this.ready.set(true);
    }

    async waitFor() {
        if (this.ready()) return;
        return await firstValueFrom(toObservable(this.ready, {injector: this.injector}).pipe(filter(v => v)));
    }

    advance(option?: number): DialogueResult | undefined {
        if (!this.runner) return;
        this.runner.advance(option);
        const res = this.runner.currentResult;
        if (!res || this.dialogueEnd()) return undefined;
        this.game.setDialogueNode(res.metadata.title);
        this.dialogueEnd.set(!!res.isDialogueEnd);
        return this.parseResult(res);
    }

    currentResult(): DialogueResult | undefined {
        if (!this.runner) return;
        return this.parseResult(this.runner.currentResult);
    }

    showGraphics(graphics: DialogueGraphics) {
        if (!(graphics instanceof SpriteDialogueGraphics)) {
            throw new Error('Unknown graphics requested: ' + JSON.stringify(graphics));
        }
        this.graphics.set(graphics);
    }

    end() {
        this.game.setDialogueNode(undefined);
        document.dispatchEvent(new DialogueEndEvent());
    }

    private parseResult(res?: YarnDialogueResult): DialogueResult | undefined {
        if (!res) return undefined;
        if (res instanceof TextResult) {
            const character = res.markup.find(m => m.name === 'character')?.properties?.['name'];
            return {
                text: res.text.trim(),
                character: character ? this.characters.get(character) : undefined
            };
        }
        if (res instanceof OptionsResult) {
            return res.options!.map((opt, index) => ({
                index,
                text: opt.text,
                available: opt.isAvailable
            }));
        }
        return undefined;
    }

}

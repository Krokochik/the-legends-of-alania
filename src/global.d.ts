declare module 'yarn-bound' {
    export interface YarnBoundOptions {
        dialogue: string;
        startAt?: string;
        variableStorage?: any;
        functions?: Record<string, (...args: any[]) => any>;
        handleCommand?: (command: { command: string; arguments: string[] } | any) => void;
        combineTextAndOptionsResults?: boolean;
        locale?: string;
        pauseCommand?: string;
    }

    export interface Metadata {
        title?: string;
        filetags?: string[];
        [key: string]: any;
    }

    export interface Markup {
        name: string;
        position?: number;
        properties?: Record<string, any>;
        length?: number;
    }

    export interface DialogueOption {
        text: string;
        isAvailable: boolean;
        hashtags: string[];
        markup: Markup[];
    }

    export class TextResult {
        constructor();
        text: string;
        hashtags: string[];
        metadata: Metadata;
        markup: Markup[];
        isDialogueEnd?: boolean;
        getGeneratorHere: () => Generator<any, any, any>;
    }

    export class OptionsResult {
        constructor();
        options: DialogueOption[];
        text?: string;
        hashtags: string[];
        metadata: Metadata;
        markup: Markup[];
        isDialogueEnd?: boolean;
        select: (index: number) => void;
        getGeneratorHere: () => Generator<any, any, any>;
    }

    export class CommandResult {
        constructor();
        command: string;
        hashtags: string[];
        metadata: Metadata;
        markup: Markup[];
        isDialogueEnd?: boolean;
        getGeneratorHere: () => Generator<any, any, any>;
    }

    export type DialogueResult = TextResult | OptionsResult | CommandResult;

    export default class YarnBound {
        constructor(options: YarnBoundOptions);

        public currentResult: DialogueResult;
        public history: DialogueResult[];
        public variableStorage: any;

        public advance(optionIndex?: number): DialogueResult;
        public jump(nodeTitle: string): void;
        public registerFunction(key: string, func: (...args: any[]) => any): void;
    }
}

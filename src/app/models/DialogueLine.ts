import {Character} from './Character';

export interface DialogueLine {
    character?: Character;
    text: string;
}

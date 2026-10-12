import { Service } from '@angular/core';
import {Character} from '../models/Character';
import {PlayableCharacter} from '../models/PlayableCharacter';

@Service()
export class CharacterService {

    readonly characters: Record<string, Character> = {
        'ВЫ': {
            id: 'ВЫ',
            name: 'Вы',
            color: '#c3f6ff'
        },
        'АМИНОН': {
            id: 'АМИНОН',
            name: 'Аминон',
            color: '#c75054'
        },
        'БАРАСТЫР': {
            id: 'БАРАСТЫР',
            name: 'Барастыр',
            color: '#5080c7'
        },
        '???': {
            id: '???',
            name: '???',
            color: '#8d8d8d'
        },
        'НЕЗНАКОМЕЦ': {
            id: 'НЕЗНАКОМЕЦ',
            name: 'Незнакомец',
            color: '#8d8d8d'
        },
        'СЕСТРА': {
            id: 'СЕСТРА',
            name: 'Сестра',
            color: '#8d2f94'
        },
        'СТАРИК': {
            id: 'СТАРИК',
            name: 'Старик',
            color: '#4c942f'
        },
        'МАЛЬЧИК': {
            id: 'МАЛЬЧИК',
            name: 'Мальчик',
            color: '#a29034'
        },
        'МУЖЧИНА': {
            id: 'МУЖЧИНА',
            name: 'Мужчина',
            color: '#a25534'
        },
        'КАЗБЕК': {
            id: 'КАЗБЕК',
            name: 'Казбек',
            color: '#a25534'
        },
        'ХЕТАГ': {
            id: 'ХЕТАГ',
            name: 'Хетаг',
            color: '#34a285'
        },
    };

    readonly players: PlayableCharacter[] = [
        {
            id: "tourist",
            labelSprite: "character_label_tourist",
            description: `Харизматичный пожилой ворон, бывший путешественник. Ныне любит сидеть в кресле-качалке, играть в лото и вспоминать свои невероятные путешествия. В своих рассказах может приукрасить действительность, иногда немного хитрит.`,
        },
        {
            id: "scientist",
            labelSprite: "character_label_scientist",
            description: `Эмоциональный лось-учёный, мечтающий получить Нобелевскую премию. Изобретателен, имеет знания во многих науках: астрономии, химии, информатике, психологии и других.`,
        },
        {
            id: "student",
            labelSprite: "character_label_student",
            description: "Весёлый неунывающий кролик. Любит активно проводить время и совершать полезные дела. Активно занимается спортом и играет. Никак не может усидеть на месте, постоянно прыгает и что-то делает.",
        },
        {
            id: "hipster",
            labelSprite: "character_label_hipster",
            description: "Сова-спортсменка, ведущая размеренный образ жизни и уверенная в огромной важности спорта и здоровья. По совместительству врач и профессиональный повар.",
        }
    ];

    get(id: string) {
        return this.characters[id]!;
    }

    getPlayer(id?: string) {
        if (!id) return undefined;
        return this.players.find((player) => player.id === id);
    }

}

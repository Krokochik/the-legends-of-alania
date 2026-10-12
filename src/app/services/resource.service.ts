import {inject, Injectable, Service} from '@angular/core';
import {ImageSprite, Sprite} from "../models/Sprite";
import {faCheck} from '@fortawesome/free-solid-svg-icons';
import {IMAGE_LOADER, ImageLoader} from '@angular/common';
import {ImageResource, InternetResource, Resource} from '../models/Resource';

@Service()
export class ResourceService {

    private readonly _resources: Record<string, Resource> = {
        'fancy_divider_body': {
            type: 'image',
            url: 'fancy_divider_body.svg',
        },
        'fancy_divider_head': {
            type: 'image',
            url: 'fancy_divider_head.svg',
        },
        'character_label_student': {
            type: 'image',
            url: 'character_label_student.svg',
            width: 427,
            height: 50
        },
        'character_label_scientist': {
            type: 'image',
            url: 'character_label_scientist.svg',
            width: 427,
            height: 50
        },
        'character_label_tourist': {
            type: 'image',
            url: 'character_label_tourist.svg',
            width: 427,
            height: 50
        },
        'character_label_hipster': {
            type: 'image',
            url: 'character_label_hipster.svg',
            width: 427,
            height: 50
        },
        'two_arrows_to_left': {
            type: 'image',
            url: 'two_arrows_to_left.svg',
            width: 180,
            height: 310
        },
        'map': {
            type: 'image',
            url: 'map.png',
            width: 5400,
            height: 3060
        },
        'map_geojson': {
            type: 'text',
            url: 'map.geojson'
        },
        'dialogue_intro': {
            type: 'text',
            url: 'dialogues/intro.yarn',
        },
        'dialogue_karmadon': {
            type: 'text',
            url: 'dialogues/karmadon.yarn',
        },
        'dialogue_three_sisters': {
            type: 'text',
            url: 'dialogues/three_sisters.yarn',
        },
        'dialogue_zadalesk': {
            type: 'text',
            url: 'dialogues/zadalesk.yarn',
        },
        'dialogue_beslan': {
            type: 'text',
            url: 'dialogues/beslan.yarn',
        },
        'dialogue_stolovaya': {
            type: 'text',
            url: 'dialogues/stolovaya.yarn',
        },
        'dialogue_final': {
            type: 'text',
            url: 'dialogues/final.yarn',
        },
        'test_elephant.png': {
            type: 'image',
            url: 'test_elephant.png',
        },
        'test_flowers.png': {
            type: 'image',
            url: 'test_flowers.png',
        },
        'test_mountain.png': {
            type: 'image',
            url: 'test_mountain.png',
        },
        'test_butterfly.png': {
            type: 'image',
            url: 'img.png',
        },
        'boy_test': {
            type: 'image',
            url: 'boy_test.png',
        },
        'girl_test': {
            type: 'image',
            url: 'girl_test.png',
        },
        'model_map_pin': {
            type: 'binary',
            url: 'map_pin.glb',
            mimeType: 'model/gltf-binary'
        },
        '1791739097641.jpg': {
            type: 'image',
            url: '1791739097641.jpg',
        },
        '1791739528831.jpg': {
            type: 'image',
            url: '1791739528831.jpg',
        },
        '1791739534992.jpg': {
            type: 'image',
            url: '1791739534992.jpg',
        },
        '1791739556366.jpg': {
            type: 'image',
            url: '1791739556366.jpg',
        },
        '1791739684102.jpg': {
            type: 'image',
            url: '1791739684102.jpg',
        },
        '1791739806398.jpg': {
            type: 'image',
            url: '1791739806398.jpg',
        },
        '1791739898983.jpg': {
            type: 'image',
            url: '1791739898983.jpg',
        },
        '1791739949377.jpg': {
            type: 'image',
            url: '1791739949377.jpg',
        },
        '1791740239987.jpg': {
            type: 'image',
            url: '1791740239987.jpg',
        },
        '1791742205088.jpg': {
            type: 'image',
            url: '1791742205088.jpg',
        },
        '1791754746442.jpg': {
            type: 'image',
            url: '1791754746442.jpg',
        },
        '1791755146622.jpg': {
            type: 'image',
            url: '1791755146622.jpg',
        },
        '1791755291076.jpg': {
            type: 'image',
            url: '1791755291076.jpg',
        },
        '1791755524810.jpg': {
            type: 'image',
            url: '1791755524810.jpg',
        },
        '1791755529609.jpg': {
            type: 'image',
            url: '1791755529609.jpg',
        },
        '1791755533558.jpg': {
            type: 'image',
            url: '1791755533558.jpg',
        },
        '1791758107428.jpg': {
            type: 'image',
            url: '1791758107428.jpg',
        },
        '1791758838695.jpg': {
            type: 'image',
            url: '1791758838695.jpg',
        },
        '1791782835201.jpg': {
            type: 'image',
            url: '1791782835201.jpg',
        },
        '1791789227103.jpg': {
            type: 'image',
            url: '1791789227103.jpg',
        },
        '1791789231506.jpg': {
            type: 'image',
            url: '1791789231506.jpg',
        },
        '1791789237003.jpg': {
            type: 'image',
            url: '1791789237003.jpg',
        },
        '1791789245419.jpg': {
            type: 'image',
            url: '1791789245419.jpg',
        },
        '1791796571683.jpg': {
            type: 'image',
            url: '1791796571683.jpg',
        },
        '1791796620296.jpg': {
            type: 'image',
            url: '1791796620296.jpg',
        },
        '1791796667344.jpg': {
            type: 'image',
            url: '1791796667344.jpg',
        },
        '1791797038806.jpg': {
            type: 'image',
            url: '1791797038806.jpg',
        },
        '1791800243553.jpg': {
            type: 'image',
            url: '1791800243553.jpg',
        },
        '1791800322306.jpg': {
            type: 'image',
            url: '1791800322306.jpg',
        },
        '1791800380963.jpg': {
            type: 'image',
            url: '1791800380963.jpg',
        },
        '1791800593159.jpg': {
            type: 'image',
            url: '1791800593159.jpg',
        },
        '1791800623350.jpg': {
            type: 'image',
            url: '1791800623350.jpg',
        },
        '1791802049623.jpg': {
            type: 'image',
            url: '1791802049623.jpg',
        },
        '1791802148007.jpg': {
            type: 'image',
            url: '1791802148007.jpg',
        },
        '1791802353005.jpg': {
            type: 'image',
            url: '1791802353005.jpg',
        },
        '1791802412068.jpg': {
            type: 'image',
            url: '1791802412068.jpg',
        },
        '1791802472037.jpg': {
            type: 'image',
            url: '1791802472037.jpg',
        },
        '1791802478905.jpg': {
            type: 'image',
            url: '1791802478905.jpg',
        },
        '1791802485760.jpg': {
            type: 'image',
            url: '1791802485760.jpg',
        },
        '1791803395058.jpg': {
            type: 'image',
            url: '1791803395058.jpg',
        },
        '1791803919205.jpg': {
            type: 'image',
            url: '1791803919205.jpg',
        },
        '1791804008567.jpg': {
            type: 'image',
            url: '1791804008567.jpg',
        },
        '1791804019655.jpg': {
            type: 'image',
            url: '1791804019655.jpg',
        },
        '1791804037620.jpg': {
            type: 'image',
            url: '1791804037620.jpg',
        },
    };

    private readonly _dynSprites: Record<string, Sprite> = {
        'unknown': {
            type: 'html',
            content: `<span>Failed to load sprite</span>`
        },
        'fancy_divider': {
            type: 'html',
            content: `
                <div style="display: flex; align-items: center; width: $widthpx; filter: $filter">
                    <img src="fancy_divider_head.svg" height="$height" style="transform: rotate(180deg)">

                    <img src="fancy_divider_body.svg"
                         height="$eval(5 * $height / 23)"
                         width="$eval($width - ($height * 125 / 23) * 2)"
                         style="object-fit: cover;object-position: left center;">

                    <img src="fancy_divider_head.svg" height="$height">
                </div>
            `
        },
        'quiz_opt_stub': {
            type: 'html',
            content: `<div style="width: $widthpx; height: $heightpx; background-color: #d9d9d9d9"></div>`
        },
        'fa_check': {
            type: 'font-awesome',
            content: faCheck
        },
        'character_avatar_stub': {
            type: 'html',
            content: `
                <div style="background-color: #202022; width: $widthpx; height: $heightpx; border-radius: $heightpx"></div>
            `
        },
    };

    private readonly _groups: Record<string, string[]> = {
        'quiz': [
            'fancy_divider_body', 'fancy_divider_head',
            'character_label_student', 'character_label_scientist',
            'character_label_tourist', 'character_label_hipster'
        ],
        'map': [
            'map', 'map_geojson'
        ]
    };

    private readonly _cache: Map<string, any> = new Map();

    private imageLoader = inject(IMAGE_LOADER, {optional: true}) as ImageLoader;

    getSprite(id: string): Sprite {
        return {...(this._resources[id] ?? this._dynSprites[id] ?? this._dynSprites['unknown'])} as Sprite;
    }

    getImageSprite(id: string): ImageSprite | undefined {
        const res = this._resources[id];
        return res?.type === 'image' ? res as ImageSprite : undefined;
    }

    async get<T = any>(id: string): Promise<T> {
        return (this._dynSprites[id] ?? this._cache.get(id) ?? await this.load(this._resources[id])) as T;
    }

    async preload(resourceId: string) {
        const res = this._resources[resourceId];
        if (!res) return;
        if (!('type' in res)) return;
        if (this._cache.has(resourceId)) return;

        if (res.type === 'image') {
            const finalUrl = this.imageLoader
                ? this.imageLoader({src: res.url, width: (res as ImageResource).width ?? 100})
                : res.url;

            const img = new Image();
            img.src = finalUrl;
        } else if (res.type === 'text' || res.type === 'binary') {
            this._cache.set(resourceId, await this.load(res));
        }
    }

    async load<T extends InternetResource = InternetResource>(res: T): Promise<any> {
        if (res.type === 'text') {
            return await (await fetch(res.url)).text();
        } else if (res.type === 'binary') {
            return await (await fetch(res.url)).blob();
        }
        throw new Error('Not implemented');
    }

    preloadGroup(id: string) {
        const group = this._groups[id];
        if (!group) return;
        group.forEach(sprite => this.preload(sprite));
    }

}

import {ImageSprite} from './Sprite';

export interface InternetResource {
    url: string;
    type: string;
}

export interface ImageResource extends InternetResource {
    type: 'image';
    width?: number;
    height?: number;
}

export interface TextResource extends InternetResource {
    type: 'text';
    mimeType?: string;
}

export interface BinaryResource extends InternetResource {
    type: 'binary';
    mimeType?: string;
}

export type Resource = ImageResource | TextResource | BinaryResource | InternetResource;

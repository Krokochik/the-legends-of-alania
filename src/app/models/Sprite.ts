import {IconDefinition} from '@fortawesome/angular-fontawesome';
import {ImageResource, InternetResource} from './Resource';

export interface BaseSprite {
    width?: number;
    height?: number;
}

export type ImageSprite = ImageResource;

export interface FontAwesomeSprite extends BaseSprite {
    type: 'font-awesome';
    content: IconDefinition;
}

export interface HtmlSprite extends BaseSprite {
    type: 'html';
    content: string;
}

export type Sprite = ImageSprite | FontAwesomeSprite | HtmlSprite;


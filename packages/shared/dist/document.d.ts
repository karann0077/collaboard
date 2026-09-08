export interface Point {
    x: number;
    y: number;
}
export interface BaseObject {
    objectId: string;
    color?: string;
    width?: number;
    style?: 'solid' | 'dashed' | 'dotted';
}
export interface StrokeObject extends BaseObject {
    path: Point[];
}
export interface ShapeObject extends BaseObject {
    type: 'rect' | 'circle' | 'line' | 'arrow';
    x?: number;
    y?: number;
    w?: number;
    h?: number;
    r?: number;
    x1?: number;
    y1?: number;
    x2?: number;
    y2?: number;
}
export interface TextObject extends BaseObject {
    type: 'text';
    text: string;
    x: number;
    y: number;
    fontSize?: number;
}
export type DrawableObject = StrokeObject | ShapeObject | TextObject;
export interface DocumentModel {
    version: number;
    objects: DrawableObject[];
}
export declare function createEmptyDocument(version?: number): DocumentModel;

export declare const EVENT_TYPES: {
    readonly STROKE_CREATED: "stroke.created";
    readonly SHAPE_CREATED: "shape.created";
    readonly TEXT_CREATED: "text.created";
    readonly OBJECT_UPDATED: "object.updated";
    readonly OBJECT_DELETED: "object.deleted";
    readonly BOARD_CLEARED: "board.cleared";
    readonly EVENT_UNDONE: "event.undone";
    readonly EVENT_REDONE: "event.redone";
};
export type EventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];
export declare const DOMAIN_EVENT_TYPES: Set<string>;

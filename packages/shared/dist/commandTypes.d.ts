export declare const COMMAND_TYPES: {
    readonly UNDO: "undo";
    readonly REDO: "redo";
    readonly STROKE_CREATED: "stroke.created";
    readonly SHAPE_CREATED: "shape.created";
    readonly TEXT_CREATED: "text.created";
    readonly OBJECT_UPDATED: "object.updated";
    readonly OBJECT_DELETED: "object.deleted";
    readonly BOARD_CLEARED: "board.cleared";
    readonly EVENT_UNDONE: "event.undone";
    readonly EVENT_REDONE: "event.redone";
};
export type CommandType = typeof COMMAND_TYPES[keyof typeof COMMAND_TYPES];

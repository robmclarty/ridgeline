type DirectionsOptions = {
    model: string;
    timeout: number;
    count?: number;
    isSkip?: boolean;
};
type DirectionsAutoOptions = DirectionsOptions & {
    /** Source of inspiration for the picker. Path or inline text. */
    inspiration?: string;
};
export declare const runDirections: (buildName: string, opts: DirectionsOptions) => Promise<void>;
export declare const runDirectionsAuto: (buildName: string, opts: DirectionsAutoOptions) => Promise<void>;
export {};

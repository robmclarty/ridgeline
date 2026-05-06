import { CatalogOptions } from "../catalog/types";
/** Count items by a string field and format as an indented list. */
export declare const countByField: (items: {
    [k: string]: unknown;
}[], field: string, indent?: string) => string;
export declare const runCatalog: (buildName: string, opts: CatalogOptions) => Promise<void>;

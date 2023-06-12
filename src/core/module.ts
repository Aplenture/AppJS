import * as CoreJS from "corejs";

interface Options {
    readonly debug: boolean;
    readonly cli: boolean;
}

export interface ModuleConfig {
    readonly name: string;
}

export abstract class Module {
    constructor(public readonly config: ModuleConfig) {
        if (!config.name) throw new Error(`missing name in module config`);
    }

    public abstract init(options: Options): Promise<CoreJS.Command<CoreJS.Response>[]>;
    public abstract validate(command: string, args: any): Promise<CoreJS.ErrorResponse | void>;
}
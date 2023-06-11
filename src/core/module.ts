import * as CoreJS from "corejs";

export abstract class Module {
    constructor(public readonly config: any) { }

    public abstract init(cli: boolean): Promise<CoreJS.Command<CoreJS.Response>[]>;
    public abstract validate(command: string, args: any): Promise<CoreJS.ErrorResponse | void>;
}
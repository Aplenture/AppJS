import * as CoreJS from "corejs";

export abstract class Module {
    public readonly onCommand = new CoreJS.Event<string, any>('Module.onCommand');

    constructor(public readonly config: any) { }

    public abstract createCommands(priv?: boolean): CoreJS.Command[];
}
import * as CoreJS from "corejs";

export abstract class Module {
    public readonly onCommand = new CoreJS.Event<string, any>('Module.onCommand');

    public abstract createCommands(): CoreJS.Command[];
}
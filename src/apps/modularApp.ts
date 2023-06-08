import * as CoreJS from "corejs";
import { loadModule, LoadModuleConfig } from "../utils";
import { App, AppConfig, Module } from "../core";

export interface ModularAppConfig extends AppConfig {
    readonly version: string;
    readonly author: string;
    readonly description: string;
    readonly modules: ReadonlyArray<LoadModuleConfig & { readonly config?: any; }>;
}

export class ModularApp extends App {
    public readonly onMessage = new CoreJS.Event<App, string>('App.onMessage');

    public readonly name: string;
    public readonly infos: string;

    private readonly commander = new CoreJS.Commander<CoreJS.Response>({
        fallback: async () => new CoreJS.TextResponse(this.infos)
    });

    constructor(config: ModularAppConfig) {
        super(config);

        (config.modules || []).forEach(data => {
            const module: Module = loadModule(data, data.config);

            this.commander.onCommand.on((args, command) => module.onCommand.emit(command, args));
            this.commander.add(...module.createCommands());
        });

        this.infos = ModularApp.createInfos(config, this.commander);
        this.commander.onMessage.on(message => this.onMessage.emit(this, message));
    }

    public execute(command?: string, args?: {}): Promise<CoreJS.Response> {
        return this.commander.execute(command, args) as any;
    }

    public executeLine(commandLine: string): Promise<CoreJS.Response> {
        return this.commander.executeLine(commandLine) as any;
    }

    private static createInfos(config: ModularAppConfig, commander: CoreJS.Commander<any>): string {
        let result = `${config.name} v${config.version} by ${config.author}\n`;

        if (config.description)
            result += '\n' + config.description + '\n';

        result += '\nCommands:\n';
        result += commander.help();

        return result;
    }
}
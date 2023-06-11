import * as CoreJS from "corejs";
import { loadConfig, loadModule, LoadModuleConfig } from "../utils";
import { Module } from "./module";
import { Server, ServerConfig } from "./server";

interface Config extends ServerConfig {
    readonly debug?: boolean;
    readonly name?: string;
    readonly version?: string;
    readonly author?: string;
    readonly description?: string;
    readonly modules?: ReadonlyArray<LoadModuleConfig & { readonly config?: any; }>;
}

export class App {
    public readonly onMessage = new CoreJS.Event<App, string>('App.onMessage');
    public readonly onError = new CoreJS.Event<App, Error>('App.onError');

    public readonly config: Config;

    private readonly modules: readonly Module[];

    private readonly commander = new CoreJS.Commander({
        fallback: async () => CoreJS.RESPONSE_NO_CONTENT
    });

    constructor(config: Config) {
        const infos: any = loadConfig('package.json');

        this.config = Object.assign({
            name: infos.name,
            version: infos.version,
            author: infos.author,
            description: infos.description
        }, config);

        this.modules = (config.modules || []).map(data => loadModule(data, data.config));

        this.commander.onMessage.on(message => this.onMessage.emit(this, message));
    }

    public get name(): string { return this.config.name; }
    public get debug(): boolean { return this.config.debug; }

    public async init(cli: boolean) {
        this.commander.clear();

        if (cli) {
            this.commander.set({
                name: 'start',
                description: "starts the server",
                action: async () => {
                    await this.init(false);

                    server.onMessage.on(message => this.onMessage.emit(this, message));
                    server.onError.on(error => this.onError.emit(this, error));

                    server.start();

                    return new CoreJS.TextResponse("server started");
                }
            });
        }

        await Promise.all(this.modules.map(async module => module.init(cli).then(commands => commands.forEach(command => this.commander.set(command)))));
    }

    public async execute(command?: string, args: any = {}): Promise<CoreJS.Response> {
        try {
            if (!command)
                return new CoreJS.TextResponse(this.commander.help(args.command && args.command.toString()));

            const validationResponse = (await Promise.all(this.modules.map(module => module.validate(command, args))))
                .find(result => result);

            if (validationResponse)
                return validationResponse;

            return await this.commander.execute(command, args);
        } catch (error) {
            const code = isNaN(error.code)
                ? CoreJS.ResponseCode.InternalServerError
                : error.code;

            const message = error instanceof CoreJS.CoreError
                ? error.message
                : '#_something_went_wrong';

            this.onError.emit(this, error);

            return new CoreJS.ErrorResponse(code, message);
        }
    }

    public createInfos(json = false): string {
        if (json) return JSON.stringify({
            name: this.config.name,
            version: this.config.version,
            author: this.config.author,
            description: this.config.description
        });

        let result = `${this.config.name} v${this.config.version} by ${this.config.author}\n`;

        if (this.config.description)
            result += '\n' + this.config.description + '\n';

        if (this.commander.count) {
            result += '\nCommands:\n';
            result += this.commander.help();
        } else {
            result += '\nNo commands found!\n'
        }

        return result;
    }
}
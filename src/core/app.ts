import * as CoreJS from "corejs";
import * as CommanderJS from "commanderjs";
import * as ModuleJS from "modulejs";
import { Server, ServerConfig } from "./server";

interface Config {
    readonly debug?: boolean;
    readonly name?: string;
    readonly version?: string;
    readonly author?: string;
    readonly description?: string;
    readonly modules?: ReadonlyArray<CoreJS.LoadModuleConfig & { readonly config?: any; }>;
}

export class App {
    public readonly onMessage = new CoreJS.Event<App, string>('App.onMessage');
    public readonly onError = new CoreJS.Event<App, Error>('App.onError');

    public readonly config: Config;

    private readonly modules: readonly ModuleJS.Module<any>[];

    private readonly commander: CommanderJS.Commander;
    private readonly server: Server;

    constructor(
        config: Config & ServerConfig,
        globalArgs: NodeJS.ReadOnlyDict<any> = {},
        globalParams: readonly CommanderJS.Parameter<any>[] = []
    ) {
        globalParams = Object.assign([
            new CommanderJS.BoolParameter('debug', 'enables/disables debug mode', false)
        ], globalParams);

        globalArgs = CommanderJS.parseArgs(globalArgs, globalParams);

        const infos: any = CoreJS.loadConfig('package.json');
        const debug = config.debug || globalArgs.debug;
        const name = config.name || infos.name;
        const version = config.version || infos.version;
        const author = config.author || infos.author;
        const description = `${name} v${version} by ${author}${config.description || infos.description
            ? '\n\n' + (config.description || infos.description)
            : ''}`;

        this.config = {
            debug,
            name,
            version,
            author,
            description
        };

        this.modules = (config.modules || []).map(data => CoreJS.loadModule(data, data.config));
        this.modules.forEach(module => module.onMessage.on(message => this.onMessage.emit(this, message)));

        this.commander = new CommanderJS.Commander({
            fallback: debug
                ? async () => new CoreJS.ErrorResponse(CoreJS.ResponseCode.BadRequest, 'unknown command')
                : async () => CoreJS.RESPONSE_NO_CONTENT,
            description,
            globalParams,
            globalArgs
        });

        this.server = new Server(this, Object.assign({}, config, {
            debug
        }));

        this.server.onMessage.on(message => this.onMessage.emit(this, message));
        this.server.onError.on(error => this.onError.emit(this, error));

        if (debug)
            this.commander.onMessage.on(message => this.onMessage.emit(this, message));
    }

    public get name(): string { return this.config.name; }
    public get debug(): boolean { return this.config.debug; }

    public async init(admin: boolean) {
        const options: ModuleJS.Options = {
            debug: this.debug,
            admin
        };

        this.commander.clear();

        if (admin) {
            this.commander.set({
                name: 'help',
                action: async args => new CoreJS.TextResponse(this.commander.help(args.command && args.command.toString())),
                description: 'Lists all commands or returns details of specific <command>.',
                parameters: [
                    new CommanderJS.StringParameter('command', 'Lists all commands with this prefix or returns details of specific command.', '')
                ]
            });

            this.commander.set({
                name: 'start',
                description: "starts the server",
                action: async () => {
                    if (this.server.isRunning)
                        return new CoreJS.ErrorResponse(CoreJS.ResponseCode.Forbidden, 'server is running already');

                    await this.init(false);
                    await this.server.start();

                    return new CoreJS.TextResponse("server stopped");
                }
            });

            this.commander.set({
                name: 'update',
                description: "updates all modules or specific [module](s)",
                parameters: [
                    new CommanderJS.ArrayParameter('module', 'to revert', null)
                ],
                action: async args => {
                    const modules = args.module
                        ? this.modules.filter(module => args.module.includes(module.name))
                        : this.modules;

                    await Promise.all(modules.map(module => module.update()));

                    return new CoreJS.TextResponse("updated");
                }
            });

            this.commander.set({
                name: 'reset',
                description: "resets all modules or specific [module](s)",
                parameters: [
                    new CommanderJS.ArrayParameter('module', 'to revert', null)
                ],
                action: async args => {
                    const modules = args.module
                        ? this.modules.filter(module => args.module.includes(module.name))
                        : this.modules;

                    await Promise.all(modules.map(module => module.reset()));

                    return new CoreJS.TextResponse("reset");
                }
            });

            this.commander.set({
                name: 'revert',
                description: "reverts specific <version> of all modules or specific [module](s)",
                parameters: [
                    new CommanderJS.ArrayParameter('module', 'to revert', null),
                    new CommanderJS.NumberParameter('version', 'all versions above or equal will be reverted', 0)
                ],
                action: async args => {
                    const modules = args.module
                        ? this.modules.filter(module => args.module.includes(module.name))
                        : this.modules;

                    await Promise.all(modules.map(module => module.revert(args.version)));

                    return new CoreJS.TextResponse("reverted");
                }
            });
        }

        await Promise.all(this.modules.map(async module => module.init(options).then(commands => commands.forEach(command => this.commander.set(command)))));
    }

    public async close(): Promise<void> {
        await this.server.stop();
        await Promise.all(this.modules.map(module => module.close()));
    }

    public async execute(command?: string, args: any = {}): Promise<CoreJS.Response> {
        try {
            if (!command)
                return new CoreJS.TextResponse(this.help(args.command && args.command.toString()));

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
            description: this.config.description,
            modules: this.modules.map(module => module.name)
        });

        return this.help();
    }

    public help(prefix?: string) {
        let result = this.commander.help(prefix);

        if (this.modules.length)
            result += '\nModules:\n' + this.modules.map(modules => modules.name).join('\n') + '\n';

        return result;
    }
}
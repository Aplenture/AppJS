import * as CoreJS from "corejs";
import * as CommanderJS from "commanderjs";
import * as ModuleJS from "modulejs";
import * as HTTP from "http";

const DEFAULT_HOST = 'localhost';

interface Options {
    readonly cli?: boolean;
    readonly server?: boolean;
    readonly flags?: readonly string[];
    readonly modules?: ReadonlyArray<CoreJS.LoadModuleConfig & { readonly config?: any; }>;
}

export interface Config {
    readonly debug?: boolean;
    readonly name: string;
    readonly version: string;
    readonly author: string;
    readonly description?: string;
    readonly cli?: Options;
    readonly server?: Options & {
        readonly host?: string;
        readonly port: number;
        readonly responseHeaders?: NodeJS.ReadOnlyDict<HTTP.OutgoingHttpHeader>;
        readonly allowedRequestHeaders?: readonly string[];
    }
}

export class App {
    public readonly onMessage = new CoreJS.Event<App, string>('App.onMessage');
    public readonly onError = new CoreJS.Event<App, Error>('App.onError');

    public readonly config: Config;

    private readonly modules: ModuleJS.Module<any, any, any>[] = [];

    private readonly commander: CommanderJS.Commander;

    private readonly responseHeaders: NodeJS.ReadOnlyDict<HTTP.OutgoingHttpHeader>;
    private readonly allowedRequestHeaders: readonly string[];
    private readonly allowedOrigins: readonly string[];

    private jsonInfoResponse: CoreJS.Response;
    private textInfoResponse: CoreJS.Response;

    private stopAction: () => void = null;
    private _isCLI = false;

    constructor(config: Config, args: NodeJS.ReadOnlyDict<any> = {}) {
        if (!config.name) throw new Error(`missing config value '${config.name}'`);
        if (!config.author) throw new Error(`missing config value '${config.author}'`);

        // calculate debug by config first then args
        args = Object.assign({ debug: config.debug }, args);

        const globalParams = ModuleJS.Parameters;
        const globalArgs = CommanderJS.parseArgs(args, globalParams);

        const infos: any = CoreJS.loadConfig('package.json');
        const debug = globalArgs.debug;
        const version = config.version || infos.version;
        const description = `${config.name} v${version} by ${config.author}${config.description
            ? '\n\n' + config.description
            : ''}`;

        const responseHeaders: NodeJS.Dict<HTTP.OutgoingHttpHeader> = Object.assign({}, config.server.responseHeaders || {});

        responseHeaders[CoreJS.ResponseHeader.AllowHeaders] = (config.server.allowedRequestHeaders || []).join(",");

        this.config = Object.assign({}, config, {
            debug,
            description,
            cli: Object.assign({
                flags: [],
                modules: []
            }, config.cli, {
                cli: true,
                server: false
            }),
            server: Object.assign({
                host: DEFAULT_HOST,
                flags: [],
                modules: [],
                responseHeaders: {},
                allowedRequestHeaders: []
            }, config.server, {
                cli: false,
                server: true
            })
        });

        this.responseHeaders = responseHeaders;
        this.allowedRequestHeaders = config.server.allowedRequestHeaders || [];

        this.allowedOrigins = responseHeaders[CoreJS.ResponseHeader.AllowOrigin]
            ? (responseHeaders[CoreJS.ResponseHeader.AllowOrigin] as string).split(',')
            : ['*'];

        this.commander = new CommanderJS.Commander({
            fallback: debug
                ? async () => new CoreJS.ErrorResponse(CoreJS.ResponseCode.BadRequest, 'unknown command')
                : async () => CoreJS.RESPONSE_NO_CONTENT,
            description,
            globalParams,
            globalArgs
        });

        if (debug)
            this.commander.onMessage.on(message => this.onMessage.emit(this, message));
    }

    public get name(): string { return this.config.name; }
    public get debug(): boolean { return this.config.debug; }

    public get isCLI(): boolean { return this._isCLI; }
    public get isRunning(): boolean { return !!this.stopAction; }

    public async init(options: Options = this.config.cli) {
        this._isCLI = options.cli;

        this.commander.clear();

        (options.modules || []).forEach(data => {
            const module: ModuleJS.Module<any, any, any> = CoreJS.loadModule(data, data.config, this.commander.args);

            module.onMessage.on(message => this.onMessage.emit(this, message));

            this.modules.push(module);
        });

        this.commander.set({
            name: 'ping',
            description: 'Returns pong.',
            execute: async () => new CoreJS.TextResponse('pong')
        });

        if (options.cli) {
            this.commander.set({
                name: 'help',
                description: 'Lists all commands or returns details of specific <command>.',
                parameters: [
                    new CommanderJS.StringParameter('command', 'Lists all commands with this prefix or returns details of specific command.', '')
                ],
                execute: async args => new CoreJS.TextResponse(this.help(args.command && args.command.toString()))
            });

            this.commander.set({
                name: 'start',
                description: "starts the server",
                execute: async () => {
                    if (this.isRunning)
                        return new CoreJS.ErrorResponse(CoreJS.ResponseCode.Forbidden, 'server is running already');

                    await this.init(this.config.server);
                    await this.start();

                    return new CoreJS.TextResponse("server stopped");
                }
            });

            this.commander.set({
                name: 'update',
                description: "updates all modules or specific [module](s)",
                parameters: [
                    new CommanderJS.ArrayParameter('module', 'to revert', null)
                ],
                execute: async args => {
                    await this.init(this.config.server);

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
                execute: async args => {
                    await this.init(this.config.server);

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
                execute: async args => {
                    await this.init(this.config.server);

                    const modules = args.module
                        ? this.modules.filter(module => args.module.includes(module.name))
                        : this.modules;

                    await Promise.all(modules.map(module => module.revert(args.version)));

                    return new CoreJS.TextResponse("reverted");
                }
            });
        }

        await Promise.all(this.modules.map(async module => module.init(options.flags).then(commands => commands.forEach(command => {
            command.onMessage.off({ listener: this.onMessage });
            command.onMessage.on((message, command) => this.onMessage.emit(this, `${command.name}: ${message}`), { listener: this.onMessage });

            this.commander.set(command);
        }))));
    }

    public async close(): Promise<void> {
        if (this.isRunning)
            this.stopAction();

        await Promise.all(this.modules.map(module => module.close()));
    }

    public async execute(command?: string, args: any = {}): Promise<CoreJS.Response> {
        try {
            if (!command)
                return new CoreJS.TextResponse(this.help(args.command && args.command.toString()));

            let errorResponse = (await Promise.all(this.modules.map(module => module.prepare(command, args))))
                .find(result => result);

            if (errorResponse)
                return errorResponse;

            const result = await this.commander.execute(command, args);

            await Promise.all(this.modules.map(module => module.finish(command, args)));

            return result;
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
        return this.commander.help(prefix, {
            globalParameters: this.isCLI
        });
    }

    public start() {
        if (this.isRunning) throw new Error('server is running already');

        if (!this.config.server) throw new Error('missing server config');
        if (!this.config.server.port) throw new Error(`missing server config value 'port'`);

        const server = HTTP.createServer((request, response) => this.onRequest(request, response));

        server.on('error', error => this.onError.emit(this, error));
        server.listen({ host: this.config.server.host, port: this.config.server.port });

        this.textInfoResponse = new CoreJS.TextResponse(this.createInfos(false));
        this.jsonInfoResponse = new CoreJS.Response(this.createInfos(true), CoreJS.ResponseType.JSON, CoreJS.ResponseCode.OK);

        this.onMessage.emit(this, `server started (debug mode: ${CoreJS.parseFromBool(this.config.debug)})`);

        return new Promise<void>(resolve => this.stopAction = () => {
            server.close();
            this.stopAction = null;
            this.onMessage.emit(this, 'server stopped');
            resolve();
        });
    }

    private async onRequest(request: HTTP.IncomingMessage, response: HTTP.ServerResponse) {
        const stopwatch = new CoreJS.Stopwatch();

        stopwatch.start();

        const responseHeaders: NodeJS.Dict<HTTP.OutgoingHttpHeader> = Object.assign({}, this.responseHeaders);

        responseHeaders[CoreJS.ResponseHeader.ContentType] = CoreJS.ResponseType.Text;

        // catch invalid origins
        if (!this.allowedOrigins.includes(request.headers.origin) && !this.allowedOrigins.includes('*')) {
            response.writeHead(CoreJS.ResponseCode.Forbidden, responseHeaders);
            response.end();
            return;
        }

        if (request.headers.origin)
            responseHeaders[CoreJS.ResponseHeader.AllowOrigin] = request.headers.origin;

        // catch option requests
        if (CoreJS.RequestMethod.Option == request.method) {
            response.writeHead(CoreJS.ResponseCode.NoContent, responseHeaders);
            response.end();
            return;
        }

        const ip = request.socket.remoteAddress;
        const url = new URL(request.url, 'http://' + request.headers.host + '/');
        const command = url.pathname.substring(1);
        const args: any = {};

        // parse url args
        url.searchParams.forEach((value, key) => args[key]
            ? Array.isArray(args[key])
                ? args[key].push(value)
                : args[key] = [args[key], value]
            : args[key] = value
        );

        // write allowed request headers to args
        this.allowedRequestHeaders.forEach(key => args[key] = request.headers[key]);

        const result: CoreJS.Response = command
            ? await this.execute(command, args)
            : args.json
                ? this.jsonInfoResponse
                : this.textInfoResponse;

        responseHeaders[CoreJS.ResponseHeader.ContentType] = result.type;

        response.writeHead(result.code, responseHeaders);
        response.end(result.data);

        stopwatch.stop();

        this.onMessage.emit(this, `'${ip}' requested '${request.url}' duration ${CoreJS.formatDuration(stopwatch.duration, { seconds: true, milliseconds: true })}`);
    }
}
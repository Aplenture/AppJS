/**
 * Aplenture/AppJS
 * https://github.com/Aplenture/AppJS
 * Copyright (c) 2023 Aplenture
 * MIT License https://github.com/Aplenture/AppJS/blob/main/LICENSE
 */

import * as CoreJS from "corejs";
import * as ModuleJS from "modulejs";
import * as HTTP from "http";

const PARAMETER_DEBUG = 'debug';
const PARAMETER_NAME = 'name';
const PARAMETER_VERSION = 'version';
const PARAMETER_AUTHOR = 'author';
const PARAMETER_DESCRIPTION = 'description';
const PARAMETER_CLI = 'cli';
const PARAMETER_SERVER = 'server';
const PARAMETER_FLAGS = 'flags';
const PARAMETER_MODULES = 'modules';
const PARAMETER_CLASS = 'class';
const PARAMETER_PATH = 'path';
const PARAMETER_OPTIONS = 'options';
const PARAMETER_HOST = 'host';
const PARAMETER_PORT = 'port';
const PARAMETER_RESPONSEHEADERS = 'responseHeaders';

interface Options {
    readonly cli?: boolean;
    readonly server?: boolean;
    readonly flags?: readonly string[];
    readonly modules?: ReadonlyArray<CoreJS.LoadModuleConfig & { readonly options?: any; }>;
}

export class App {
    public readonly onMessage = new CoreJS.Event<App, string>('App.onMessage');
    public readonly onError = new CoreJS.Event<App, Error>('App.onError');
    public readonly config = new CoreJS.Config();

    private readonly modules: ModuleJS.Module<any, any, any>[] = [];

    private commander: CoreJS.Commander;

    private responseHeaders: NodeJS.Dict<HTTP.OutgoingHttpHeader>;
    private allowedRequestHeaders: readonly string[];
    private allowedOrigins: readonly string[];

    private jsonInfoResponse: CoreJS.Response;
    private textInfoResponse: CoreJS.Response;

    private stopAction: () => void = null;
    private _isCLI = false;
    private _initialized = false;

    public get name(): string { return this.config.get(PARAMETER_NAME); }
    public get debug(): boolean { return this.config.get(PARAMETER_DEBUG); }
    public get version(): string { return this.config.get(PARAMETER_VERSION); }
    public get author(): string { return this.config.get(PARAMETER_AUTHOR); }
    public get description(): string { return this.commander.description; }

    public get isCLI(): boolean { return this._isCLI; }
    public get isRunning(): boolean { return !!this.stopAction; }
    public get initialized(): boolean { return this._initialized; }

    public init(args: string | NodeJS.ReadOnlyDict<any> = CoreJS.Args) {
        if (this.initialized)
            throw new Error(this.constructor.name + ' is already initialized');

        this._initialized = true;

        this.onMessage.emit(this, 'initializing');

        const infos: any = CoreJS.loadConfig('package.json');

        // setup app config by global module parameters
        ModuleJS.GlobalParameters.forEach(param => this.config.add(param));

        this.config.add(new CoreJS.StringParameter(PARAMETER_NAME, 'name of the app'));
        this.config.add(new CoreJS.StringParameter(PARAMETER_VERSION, 'version of the app', '1.0'));
        this.config.add(new CoreJS.StringParameter(PARAMETER_AUTHOR, 'author of the app', ''));
        this.config.add(new CoreJS.StringParameter(PARAMETER_DESCRIPTION, 'description of the app', ''));
        this.config.add(new CoreJS.DictionaryParameter(PARAMETER_CLI, 'cli config', [
            new CoreJS.BoolParameter(PARAMETER_CLI, '', true),
            new CoreJS.BoolParameter(PARAMETER_SERVER, '', false),
            new CoreJS.ArrayParameter<string>(PARAMETER_FLAGS, 'of cli', new CoreJS.StringParameter('', ''), []),
            new CoreJS.ArrayParameter<string>(PARAMETER_MODULES, 'of cli', new CoreJS.DictionaryParameter('', '', [
                new CoreJS.StringParameter(PARAMETER_CLASS, 'class name of the module'),
                new CoreJS.StringParameter(PARAMETER_PATH, 'to the module class'),
                new CoreJS.DictionaryParameter(PARAMETER_OPTIONS, 'from the module', [], {})
            ]), [])
        ]));
        this.config.add(new CoreJS.DictionaryParameter(PARAMETER_SERVER, 'server config', [
            new CoreJS.BoolParameter(PARAMETER_CLI, '', false),
            new CoreJS.BoolParameter(PARAMETER_SERVER, '', true),
            new CoreJS.StringParameter(PARAMETER_HOST, 'of server', 'localhost'),
            new CoreJS.NumberParameter(PARAMETER_PORT, 'of server'),
            new CoreJS.DictionaryParameter(PARAMETER_RESPONSEHEADERS, 'of server', [], {}),
            new CoreJS.ArrayParameter<string>(PARAMETER_FLAGS, 'of server', new CoreJS.StringParameter('', ''), []),
            new CoreJS.ArrayParameter<string>(PARAMETER_MODULES, 'of server', new CoreJS.DictionaryParameter('', '', [
                new CoreJS.StringParameter(PARAMETER_CLASS, 'class name of the module'),
                new CoreJS.StringParameter(PARAMETER_PATH, 'to the module class'),
                new CoreJS.DictionaryParameter(PARAMETER_OPTIONS, 'from the module')
            ]), [])
        ]));

        this.onMessage.emit(this, 'loading package.json');
        this.config.set(PARAMETER_VERSION, infos.version);

        this.onMessage.emit(this, 'loading config.json');
        this.config.deserialize(CoreJS.loadConfig());

        this.onMessage.emit(this, 'loading process args');
        this.config.deserialize(args);

        const debug: boolean = this.config.get(PARAMETER_DEBUG);
        const description = `${this.config.get(PARAMETER_NAME)} v${this.config.get(PARAMETER_VERSION)} by ${this.config.get(PARAMETER_AUTHOR)}${this.config.get(PARAMETER_DESCRIPTION)
            ? '\n\n' + this.config.get(PARAMETER_DESCRIPTION)
            : ''}`;

        const serverConfig: any = this.config.get(PARAMETER_SERVER);

        this.responseHeaders = Object.assign({}, serverConfig.responseHeaders || {});

        this.allowedOrigins = this.responseHeaders[CoreJS.ResponseHeader.AllowOrigin]
            ? (this.responseHeaders[CoreJS.ResponseHeader.AllowOrigin] as string).split(',')
            : ['*'];

        this.commander = new CoreJS.Commander(new CoreJS.Config(), {
            description,
            fallback: debug
                ? async () => new CoreJS.ErrorResponse(CoreJS.ResponseCode.BadRequest, 'unknown command')
                : async () => CoreJS.RESPONSE_NO_CONTENT,
        });

        // setup commander config by global module parameters
        ModuleJS.GlobalParameters.forEach(param => this.commander.config.add(param));

        if (debug)
            this.commander.onMessage.on(message => this.onMessage.emit(this, message));
    }

    public async load(options: Options = this.config.get(PARAMETER_CLI)) {
        if (!this.initialized)
            throw new Error(this.constructor.name + ' is not initialized');

        const args = this.commander.config.write();

        this.onMessage.emit(this, 'loading ' + JSON.stringify(options, null, 4));

        this._isCLI = options.cli;

        this.modules.splice(0);

        this.commander.clear();
        this.commander.set({
            name: 'ping',
            description: 'Returns pong.',
            execute: async () => new CoreJS.TextResponse('pong')
        });

        if (options.cli) {
            this.commander.set({
                name: 'help',
                description: 'Lists all commands or returns details of specific <command>.',
                parameters: new CoreJS.ParameterList(
                    new CoreJS.StringParameter('command', 'Lists all commands with this prefix or returns details of specific command.', '')
                ),
                execute: async args => new CoreJS.TextResponse(this.help(args.command && args.command.toString()))
            });

            this.commander.set({
                name: 'start',
                description: "starts the server",
                execute: async () => {
                    if (this.isRunning)
                        return new CoreJS.ErrorResponse(CoreJS.ResponseCode.Forbidden, 'server is running already');

                    await this.load(this.config.get(PARAMETER_SERVER));
                    await this.start();

                    return new CoreJS.TextResponse("server stopped");
                }
            });

            this.commander.set({
                name: 'update',
                description: "updates all modules or specific [module](s)",
                parameters: new CoreJS.ParameterList(
                    new CoreJS.ArrayParameter('module', 'to revert', new CoreJS.StringParameter('', ''), null)
                ),
                execute: async args => {
                    await this.load(this.config.get(PARAMETER_SERVER));

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
                parameters: new CoreJS.ParameterList(
                    new CoreJS.ArrayParameter('module', 'to revert', new CoreJS.StringParameter('', ''), null)
                ),
                execute: async args => {
                    await this.load(this.config.get(PARAMETER_SERVER));

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
                parameters: new CoreJS.ParameterList(
                    new CoreJS.ArrayParameter('module', 'to revert', new CoreJS.StringParameter('', ''), null),
                    new CoreJS.NumberParameter('version', 'all versions above or equal will be reverted', 0)
                ),
                execute: async args => {
                    await this.load(this.config.get(PARAMETER_SERVER));

                    const modules = args.module
                        ? this.modules.filter(module => args.module.includes(module.name))
                        : this.modules;

                    await Promise.all(modules.map(module => module.revert(args.version)));

                    return new CoreJS.TextResponse("reverted");
                }
            });

            this.commander.set({
                name: 'config',
                description: "returns the config",
                execute: async () => new CoreJS.TextResponse(this.config.serialize())
            });
        }

        await Promise.all((options.modules || []).map(async data => {
            try {
                const module: ModuleJS.Module<any, any, any> = CoreJS.loadModule(data, args, data.options);

                module.onMessage.on(message => this.onMessage.emit(this, message));

                const commands = await module.init(options.flags);

                commands.forEach(command => {
                    command.onMessage.off({ listener: this.onMessage });
                    command.onMessage.on((message, command) => this.onMessage.emit(this, `${command.name}: ${message}`), { listener: this.onMessage });

                    this.commander.set(command);
                });

                this.modules.push(module);
            } catch (error) {
                const coreError = CoreJS.CoreError.parseFromError<any>(error);

                switch (coreError.code) {
                    case CoreJS.CoreErrorCode.MissingParameter:
                        throw new Error(`missing option '${coreError.data.name}' for module '${data.path}/${data.class}'`);

                    default: throw error;
                }
            }
        }));

        this.allowedRequestHeaders = this.modules
            .map(module => module.allowedRequestHeaders)
            .flat();

        this.responseHeaders[CoreJS.ResponseHeader.AllowHeaders] = this.allowedRequestHeaders.join(",");

        this.textInfoResponse = new CoreJS.TextResponse(this.createInfos(false));
        this.jsonInfoResponse = new CoreJS.Response(this.createInfos(true), CoreJS.ResponseType.JSON, CoreJS.ResponseCode.OK);
    }

    public async close(): Promise<void> {
        if (!this.initialized)
            throw new Error(this.constructor.name + ' is not initialized');

        if (this.isRunning)
            this.stopAction();

        await Promise.all(this.modules.map(module => module.close()));
    }

    public async execute(command?: string, args?: NodeJS.ReadOnlyDict<any>, headers: HTTP.IncomingHttpHeaders = {}): Promise<CoreJS.Response> {
        if (!this.initialized)
            throw new Error(this.constructor.name + ' is not initialized');

        if (!command)
            return new CoreJS.TextResponse(this.help(args && args.command && args.command.toString()));

        try {
            const parsedArgs = this.commander.parseArgs(command, args);

            const errorResponse = (await Promise.all(this.modules.map(module => module.prepare(command, parsedArgs, headers))))
                .find(result => result);

            if (errorResponse)
                return errorResponse;

            const result = await this.commander.execute(command, parsedArgs, false);

            await Promise.all(this.modules.map(module => module.finish(command, parsedArgs, headers)));

            return result;
        } catch (error) {
            this.onError.emit(this, error);

            return error.constructor.name == CoreJS.CoreError.name
                ? new CoreJS.ErrorResponse(CoreJS.ResponseCode.Forbidden, error.message)
                : new CoreJS.ErrorResponse(CoreJS.ResponseCode.InternalServerError, '#_something_went_wrong');
        }
    }

    public createInfos(json = false): string {
        if (!this.initialized)
            throw new Error(this.constructor.name + ' is not initialized');

        if (json) return JSON.stringify({
            name: this.name,
            version: this.version,
            author: this.author,
            description: this.description,
            allowedRequestHeaders: this.allowedRequestHeaders,
            modules: this.modules.map(module => module.name)
        });

        return this.help();
    }

    public help(prefix?: string) {
        if (!this.initialized)
            throw new Error(this.constructor.name + ' is not initialized');

        return this.commander.help(prefix, {
            globalParameters: this.isCLI
        });
    }

    public start() {
        if (!this.initialized) throw new Error(this.constructor.name + ' is not initialized');
        if (this.isRunning) throw new Error('server is running already');

        const config: any = this.config.get(PARAMETER_SERVER);

        if (!config) throw new Error('missing server config');
        if (!config.port) throw new Error(`missing server config value 'port'`);
        if (!config.host) throw new Error(`missing server config value 'host'`);

        const server = HTTP.createServer((request, response) => this.onRequest(request, response));

        server.on('error', error => this.onError.emit(this, error));
        server.listen({ host: config.host, port: config.port });

        this.onMessage.emit(this, `server started (debug mode: ${CoreJS.parseFromBool(this.debug)})`);

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

        const result: CoreJS.Response = command
            ? await this.execute(command, args, request.headers)
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
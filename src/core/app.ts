import * as CoreJS from "corejs";
import * as HTTP from "http";
import { loadConfig, loadModule, LoadModuleConfig } from "../utils";
import { Commander } from "./commander";
import { Module } from "./module";

const DEFAULT_CONFIG = {
    host: 'localhost'
}

interface Config {
    readonly debug?: boolean;
    readonly name?: string;
    readonly version?: string;
    readonly author?: string;
    readonly description?: string;
    readonly host?: string;
    readonly port?: number;
    readonly modules?: ReadonlyArray<LoadModuleConfig & { readonly config?: any; }>;
    readonly responseHeaders?: NodeJS.ReadOnlyDict<HTTP.OutgoingHttpHeader>;
    readonly allowedRequestHeaders?: readonly string[];
}

export class App {
    public readonly onMessage = new CoreJS.Event<App, string>('App.onMessage');
    public readonly onError = new CoreJS.Event<App, Error>('App.onError');

    public readonly config: Config;
    public readonly textInfos: string;
    public readonly jsonInfos: string;

    private readonly responseHeaders: NodeJS.ReadOnlyDict<HTTP.OutgoingHttpHeader>;
    private readonly allowedRequestHeaders: readonly string[];
    private readonly allowedOrigins: readonly string[];

    private readonly jsonInfoResponse: CoreJS.Response;
    private readonly textInfoResponse: CoreJS.Response;

    private stopAction: () => void = null;

    private readonly privateCommander = new Commander();
    private readonly publicCommander = new CoreJS.Commander({
        fallback: async args => args.json ? this.jsonInfoResponse : this.textInfoResponse
    });

    constructor(config: Config) {
        const infos: any = loadConfig('package.json');
        const responseHeaders: NodeJS.Dict<HTTP.OutgoingHttpHeader> = Object.assign({}, config.responseHeaders || {});

        responseHeaders[CoreJS.ResponseHeader.AllowHeaders] = (config.allowedRequestHeaders || []).join(",");

        process.on('exit', code => this.onMessage.emit(this, "exit with code " + code));
        process.on('uncaughtException', error => this.onError.emit(this, error));
        process.on('unhandledRejection', reason => this.onError.emit(this, reason instanceof Error ? reason : reason ? new Error(reason.toString()) : new Error()));

        (config.modules || []).forEach(data => {
            const module: Module = loadModule(data, data.config);

            this.publicCommander.onCommand.on((args, command) => module.onCommand.emit(command, args));
            this.publicCommander.add(...module.createCommands(false));

            this.privateCommander.onCommand.on((args, command) => module.onCommand.emit(command, args));
            this.privateCommander.add(...module.createCommands(true));
        });

        this.config = Object.assign({
            name: infos.name,
            version: infos.version,
            author: infos.author,
            description: infos.description
        }, DEFAULT_CONFIG, config);

        this.responseHeaders = responseHeaders;
        this.allowedRequestHeaders = config.allowedRequestHeaders || [];

        this.textInfos = App.createInfos(this.config, this.publicCommander);
        this.jsonInfos = App.createInfos(this.config, this.publicCommander, true);

        this.textInfoResponse = new CoreJS.TextResponse(this.textInfos);
        this.jsonInfoResponse = new CoreJS.Response(this.jsonInfos, CoreJS.ResponseType.JSON, CoreJS.ResponseCode.OK);

        this.publicCommander.onMessage.on(message => this.onMessage.emit(this, 'public: ' + message));
        this.privateCommander.onMessage.on(message => this.onMessage.emit(this, 'private: ' + message));

        this.allowedOrigins = responseHeaders[CoreJS.ResponseHeader.AllowOrigin]
            ? (responseHeaders[CoreJS.ResponseHeader.AllowOrigin] as string).split(',')
            : ['*'];
    }

    public get name(): string { return this.config.name; }
    public get debug(): boolean { return this.config.debug; }

    public start() {
        if (this.stopAction) throw new Error('server is running already');
        if (!this.config.port) throw new Error('missing port in app config');

        const server = HTTP.createServer((request, response) => this.onRequest(request, response));

        server.on('error', error => this.onError.emit(this, error));
        server.listen({ host: this.config.host, port: this.config.port });

        this.onMessage.emit(this, 'server started');

        return new Promise<void>(resolve => this.stopAction = () => {
            server.close();
            this.stopAction = null;
            this.onMessage.emit(this, 'server stopped');
            resolve();
        });
    }

    public stop() {
        if (!this.stopAction)
            throw new Error('server is not running currently');

        this.stopAction();
    }

    public execute(command?: string, args?: {}): Promise<CoreJS.Response> {
        return this.privateCommander.execute(command, args);
    }

    public executeLine(commandLine?: string): Promise<CoreJS.Response> {
        return this.privateCommander.executeLine(commandLine);
    }

    public executeCLI() {
        return this.privateCommander.executeCLI();
    }

    private static createInfos(config: Config, commander: CoreJS.Commander, json = false): string {
        if (json) {
            return JSON.stringify({
                name: config.name,
                version: config.version,
                author: config.author,
                description: config.description
            });
        }

        let result = `${config.name} v${config.version} by ${config.author}\n`;

        if (config.description)
            result += '\n' + config.description + '\n';

        if (commander.count) {
            result += '\nCommands:\n';
            result += commander.help();
        }

        return result;
    }

    private async onRequest(request: HTTP.IncomingMessage, response: HTTP.ServerResponse) {
        const responseHeaders: NodeJS.Dict<HTTP.OutgoingHttpHeader> = Object.assign({}, this.responseHeaders);

        // todo: catch allowed methods
        // todo: catch allowed headers
        // todo: catch max age

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

        this.onMessage.emit(this, `'${ip}' requested '${request.url}'`);

        let code: CoreJS.ResponseCode;
        let message: string;

        try {
            const result: CoreJS.Response = await this.publicCommander.execute(command, args);

            responseHeaders[CoreJS.ResponseHeader.ContentType] = result.type;

            code = result.code;
            message = result.data;
        } catch (error) {
            this.onError.emit(this, error);

            code = isNaN(error.code)
                ? CoreJS.ResponseCode.InternalServerError
                : error.code;

            message = error instanceof CoreJS.CoreError
                ? error.message
                : '#_something_went_wrong';
        } finally {
            response.writeHead(code, responseHeaders);
            response.end(message);
        }
    }
}
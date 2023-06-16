import * as CoreJS from "corejs";
import * as HTTP from "http";
import { App } from "./app";

const DEFAULT_CONFIG = {
    host: 'localhost'
}

export interface ServerConfig {
    readonly debug?: boolean;
    readonly host?: string;
    readonly port?: number;
    readonly responseHeaders?: NodeJS.ReadOnlyDict<HTTP.OutgoingHttpHeader>;
    readonly allowedRequestHeaders?: readonly string[];
}

export class Server {
    public readonly onMessage = new CoreJS.Event<Server, string>('Server.onMessage');
    public readonly onError = new CoreJS.Event<Server, Error>('Server.onError');

    public readonly config: ServerConfig;

    private readonly responseHeaders: NodeJS.ReadOnlyDict<HTTP.OutgoingHttpHeader>;
    private readonly allowedRequestHeaders: readonly string[];
    private readonly allowedOrigins: readonly string[];

    private jsonInfoResponse: CoreJS.Response;
    private textInfoResponse: CoreJS.Response;

    private stopAction: () => void = null;

    constructor(public readonly app: App, config: ServerConfig) {
        const responseHeaders: NodeJS.Dict<HTTP.OutgoingHttpHeader> = Object.assign({}, config.responseHeaders || {});

        responseHeaders[CoreJS.ResponseHeader.AllowHeaders] = (config.allowedRequestHeaders || []).join(",");

        this.config = Object.assign({}, DEFAULT_CONFIG, config);

        this.responseHeaders = responseHeaders;
        this.allowedRequestHeaders = config.allowedRequestHeaders || [];

        this.allowedOrigins = responseHeaders[CoreJS.ResponseHeader.AllowOrigin]
            ? (responseHeaders[CoreJS.ResponseHeader.AllowOrigin] as string).split(',')
            : ['*'];
    }

    public get isRunning(): boolean { return !!this.stopAction; }

    public start() {
        if (this.isRunning) throw new Error('server is running already');
        if (!this.config.port) throw new Error('missing port in app config');

        const server = HTTP.createServer((request, response) => this.onRequest(request, response));

        server.on('error', error => this.onError.emit(this, error));
        server.listen({ host: this.config.host, port: this.config.port });

        this.textInfoResponse = new CoreJS.TextResponse(this.app.createInfos(false));
        this.jsonInfoResponse = new CoreJS.Response(this.app.createInfos(true), CoreJS.ResponseType.JSON, CoreJS.ResponseCode.OK);

        this.onMessage.emit(this, `server started (debug mode: ${CoreJS.parseFromBool(this.config.debug)})`);

        return new Promise<void>(resolve => this.stopAction = () => {
            server.close();
            this.stopAction = null;
            this.onMessage.emit(this, 'server stopped');
            resolve();
        });
    }

    public stop() {
        if (!this.isRunning)
            return;

        this.stopAction();
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
            ? await this.app.execute(command, args)
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
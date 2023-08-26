/**
 * Aplenture/AppJS
 * https://github.com/Aplenture/AppJS
 * Copyright (c) 2023 Aplenture
 * MIT License https://github.com/Aplenture/AppJS/blob/main/LICENSE
 */

import * as CoreJS from "corejs";
import * as FS from "fs";
import * as HTTP from "http";
import * as HTTPS from "https";
import { App } from "./app";

export class Server {
    public static readonly PARAMETER_DEBUG = 'debug';
    public static readonly PARAMETER_HTTPS = 'https';
    public static readonly PARAMETER_PORT = 'port';
    public static readonly PARAMETER_HOST = 'host';
    public static readonly PARAMETER_KEY = 'sslKey';
    public static readonly PARAMETER_CERT = 'sslCert';
    public static readonly PARAMETER_ALLOWED_REQUEST_HEADERS = 'requestHeaders';
    public static readonly PARAMETER_ALLOWED_ORIGINS = 'allowedOrigins';
    public static readonly PARAMETER_RESPONSE_HEADERS = 'responseHeaders';

    public static readonly Parameters: readonly CoreJS.Parameter<any>[] = [
        new CoreJS.BoolParameter(Server.PARAMETER_DEBUG, 'enables/disables debug mode', false),
        new CoreJS.BoolParameter(Server.PARAMETER_HTTPS, 'switch between http and https', false),
        new CoreJS.StringParameter(Server.PARAMETER_HOST, 'of server', 'localhost'),
        new CoreJS.NumberParameter(Server.PARAMETER_PORT, 'of server', 4431),
        new CoreJS.StringParameter(Server.PARAMETER_KEY, 'path to ssl key file', 'key.pem'),
        new CoreJS.StringParameter(Server.PARAMETER_CERT, 'path to ssl certification file', 'cert.pem'),
        new CoreJS.ArrayParameter(Server.PARAMETER_ALLOWED_REQUEST_HEADERS, 'allowed server request headers', new CoreJS.StringParameter('', ''), []),
        new CoreJS.ArrayParameter(Server.PARAMETER_ALLOWED_ORIGINS, 'allowed server origins', new CoreJS.StringParameter('', ''), []),
        new CoreJS.DictionaryParameter(Server.PARAMETER_RESPONSE_HEADERS, 'additional server response headers', [], {}),
    ];

    public readonly onMessage = new CoreJS.Event<Server, string>('Server.onMessage');
    public readonly onError = new CoreJS.Event<Server, Error>('Server.onError');

    private readonly allowedRequestHeaders: readonly string[];
    private readonly responseHeaders: NodeJS.ReadOnlyDict<HTTP.OutgoingHttpHeader>;
    private readonly allowedOrigins: readonly string[];

    private readonly jsonInfoResponse: CoreJS.Response;
    private readonly textInfoResponse: CoreJS.Response;

    private stopAction: () => void = null;

    constructor(
        public readonly app: App,
        public readonly config: CoreJS.Config
    ) {
        const defaultResponseHeaders = Object.assign({}, config.get(Server.PARAMETER_RESPONSE_HEADERS));

        this.responseHeaders = defaultResponseHeaders;
        this.allowedRequestHeaders = config.get<string[]>(Server.PARAMETER_ALLOWED_REQUEST_HEADERS);
        this.allowedOrigins = config.get<string[]>(Server.PARAMETER_ALLOWED_ORIGINS)

        if (0 == this.allowedOrigins.length)
            this.allowedOrigins = ['*'];

        defaultResponseHeaders[CoreJS.ResponseHeader.AllowHeaders] = this.allowedRequestHeaders.join(',');
        defaultResponseHeaders[CoreJS.ResponseHeader.AllowOrigin] = this.allowedOrigins.join(',');

        this.textInfoResponse = new CoreJS.TextResponse(this.createInfos(false));
        this.jsonInfoResponse = new CoreJS.Response(this.createInfos(true), CoreJS.ResponseType.JSON, CoreJS.ResponseCode.OK);
    }

    public get isRunning(): boolean { return !!this.stopAction; }
    public get debug(): boolean { return this.config.get(Server.PARAMETER_DEBUG); }

    public start() {
        if (this.isRunning) throw new Error('server is running already');

        if (this.config.get(Server.PARAMETER_HTTPS)) {
            if (!this.config.has(Server.PARAMETER_KEY))
                throw new Error(`config parameter '${Server.PARAMETER_KEY}' is needed when '${Server.PARAMETER_HTTPS} is enabled'`);

            if (!FS.existsSync(this.config.get(Server.PARAMETER_KEY)))
                throw new Error(`ssl key at '${this.config.get(Server.PARAMETER_KEY)}' does not exist`);

            if (!this.config.has(Server.PARAMETER_CERT))
                throw new Error(`config parameter '${Server.PARAMETER_CERT}' is needed when '${Server.PARAMETER_HTTPS} is enabled'`);

            if (!FS.existsSync(this.config.get(Server.PARAMETER_CERT)))
                throw new Error(`ssl certificate at '${this.config.get(Server.PARAMETER_CERT)}' does not exist`);
        }

        const server = this.config.get(Server.PARAMETER_HTTPS)
            ? HTTPS.createServer({
                key: FS.readFileSync(this.config.get(Server.PARAMETER_KEY)),
                cert: FS.readFileSync(this.config.get(Server.PARAMETER_CERT))
            }, (request, response) => this.onRequest(request, response))
            : HTTP.createServer((request, response) => this.onRequest(request, response));

        server.on('error', error => this.onError.emit(this, error));
        server.listen({
            host: this.config.get(Server.PARAMETER_HOST),
            port: this.config.get(Server.PARAMETER_PORT)
        });

        this.onMessage.emit(this, `server started (debug mode: ${CoreJS.parseFromBool(this.debug)})`);

        return new Promise<void>(resolve => this.stopAction = () => {
            server.close();
            this.stopAction = null;
            this.onMessage.emit(this, 'server stopped');
            resolve();
        });
    }

    public stop(): void {
        if (!this.isRunning)
            return;

        this.stopAction();
    }

    public createInfos(json = false): string {
        if (json) return JSON.stringify({
            name: this.app.name,
            version: this.app.version,
            author: this.app.author,
            description: this.app.description,
            routes: this.app.routes.map(route => route.name),
            allowedRequestHeaders: this.allowedRequestHeaders
        });

        let result = this.app.description;

        result += '\nAllowed Request Headers:\n';
        result += this.allowedRequestHeaders.join('\n');

        return result;
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

        // parse args by allowed request headers
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
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
    public static readonly PARAMETER_ENDPOINT = 'endpoint';
    public static readonly PARAMETER_HTTPS = 'https';
    public static readonly PARAMETER_PORT = 'port';
    public static readonly PARAMETER_HOST = 'host';
    public static readonly PARAMETER_KEY = 'sslKey';
    public static readonly PARAMETER_CERT = 'sslCert';
    public static readonly PARAMETER_ALLOWED_REQUEST_HEADERS = 'requestHeaders';
    public static readonly PARAMETER_ALLOWED_ORIGINS = 'allowedOrigins';
    public static readonly PARAMETER_RESPONSE_HEADERS = 'responseHeaders';

    public static readonly Parameters: readonly CoreJS.Parameter<any>[] = [
        new CoreJS.StringParameter(Server.PARAMETER_ENDPOINT, 'the domain of this server', 'http://localhost:4431'),
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

    private stopAction: () => void = null;
    private textInfoResponse: CoreJS.Response;
    private htmlInfoResponse: CoreJS.Response;
    private jsonInfoResponse: CoreJS.Response;

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
    }

    public get isRunning(): boolean { return !!this.stopAction; }
    public get debug(): boolean { return this.app.debug; }
    public get endpoint(): string { return this.config.get(Server.PARAMETER_ENDPOINT); }

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

        this.textInfoResponse = new CoreJS.TextResponse(this.toString());
        this.htmlInfoResponse = new CoreJS.HTMLResponse(this.toHTML());
        this.jsonInfoResponse = new CoreJS.Response(JSON.stringify(this), CoreJS.ResponseType.JSON, CoreJS.ResponseCode.OK);

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

    public toString() {
        let result = `${this.app.name} v${this.app.version} by ${this.app.author}\n`;

        if (this.app.description)
            result += `\n${this.app.description}\n`;

        if (this.app.repository)
            result += '\n' + this.app.repository + '\n';

        result += `\nEndpoint: ${this.endpoint}\n`;

        if (this.allowedRequestHeaders.length) {
            result += '\nAllowed Request Headers:\n';
            result += this.allowedRequestHeaders.join('\n');
        }

        result += '\nRoutes:\n';
        result += Object.keys(this.app.routes).map(route => `${route} - ${this.app.routes[route].description}`).join('\n') + '\n';

        return result;
    }

    public toJSON() {
        return {
            name: this.app.name,
            endpoint: this.endpoint,
            version: this.app.version,
            author: this.app.author,
            description: this.app.description,
            repository: this.app.repository,
            allowedRequestHeaders: this.allowedRequestHeaders,
            routes: Object.keys(this.app.routes).map(path => ({
                path,
                description: this.app.routes[path].description,
                parameters: this.app.routes[path].parameters
            }))
        };
    }

    public toHTML() {
        const appData = this.app.toJSON();

        let result = `<h1>${appData.name} v${appData.version}</h1>`;

        if (appData.description)
            result += `<h2>${appData.description}</h2>`;

        result += `<h4>by ${appData.author}</h4>`;

        if (appData.repository)
            result += `<h3>Repository</h3><a href="${appData.repository}">${appData.repository}</a>`;

        result += `<h3>Endpoint</h3><a href="${this.endpoint}">${this.endpoint}</a>`;

        if (this.allowedRequestHeaders.length) {
            result += '<h3>Allowed Headers</h3>';
            result += this.allowedRequestHeaders.join('</br>');
        }

        result += '<h3>Routes</h3>';
        result += Object.values(appData.routes).map(route => `<h4><a href="${this.endpoint}/${route.path}">/${route.path}</a></h4><p>${route.description}</p><table><tr><th colspan=5>Parameters</th><tr><th>Name</th><th>Type</th><th>Description</th><th>Optional</th><th>Default</th></tr>${route.parameters.map(param => `<tr><td><b>${param.name}</b></td><td>${param.type}</td><td>${param.description}</td><td>${param.optional}</td><td>${param.optional ? param.def : ''}</td></tr>`).join('')}</table>`).join('');

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
        const route = url.pathname.substring(1);
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

        const result: CoreJS.Response = route
            ? await this.app.execute(route, args)
            : args.html
                ? this.htmlInfoResponse
                : args.text
                    ? this.textInfoResponse
                    : this.jsonInfoResponse;

        responseHeaders[CoreJS.ResponseHeader.ContentType] = result.type;

        response.writeHead(result.code, responseHeaders);
        response.end(result.data);

        stopwatch.stop();

        this.onMessage.emit(this, `'${ip}' requested '${request.url}' duration ${CoreJS.formatDuration(stopwatch.duration, { seconds: true, milliseconds: true })}`);
    }
}
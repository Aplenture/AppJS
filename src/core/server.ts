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

export enum ServerParameter {
    Protocol = 'protocol',
    Port = 'port',
    Host = 'host',
    Key = 'sslKey',
    Cert = 'sslCert',
    AllowedRequestHeaders = 'requestHeaders',
    AllowedOrigins = 'allowedOrigins',
    ResponseHeaders = 'responseHeaders'
}

export enum Protocol {
    HTTP = "http",
    HTTPS = "https"
}

export class Server {
    public readonly onMessage = new CoreJS.Event<Server, string>('Server.onMessage');
    public readonly onError = new CoreJS.Event<Server, Error>('Server.onError');

    private _allowedRequestHeaders: readonly string[];
    private _responseHeaders: NodeJS.ReadOnlyDict<HTTP.OutgoingHttpHeader>;
    private _allowedOrigins: readonly string[];

    private _stopAction: () => void = null;
    private _textInfoResponse: CoreJS.Response;
    private _htmlInfoResponse: CoreJS.Response;
    private _jsonInfoResponse: CoreJS.Response;

    private _endpoint: string;

    constructor(
        public readonly app: App,
        public readonly config: CoreJS.Config
    ) {
        config.add(new CoreJS.StringParameter(ServerParameter.Protocol, 'http | https | empty', 'http'));
        config.add(new CoreJS.StringParameter(ServerParameter.Host, 'of server', 'localhost'));
        config.add(new CoreJS.NumberParameter(ServerParameter.Port, 'of server', 4431));
        config.add(new CoreJS.StringParameter(ServerParameter.Key, 'path to ssl key file', 'key.pem'));
        config.add(new CoreJS.StringParameter(ServerParameter.Cert, 'path to ssl certification file', 'cert.pem'));
        config.add(new CoreJS.ArrayParameter(ServerParameter.AllowedRequestHeaders, 'allowed server request headers', new CoreJS.StringParameter('', ''), []));
        config.add(new CoreJS.ArrayParameter(ServerParameter.AllowedOrigins, 'allowed server origins', new CoreJS.StringParameter('', ''), []));
        config.add(new CoreJS.DictionaryParameter(ServerParameter.ResponseHeaders, 'additional server response headers', [], {}));
    }

    public get isRunning(): boolean { return !!this._stopAction; }
    public get debug(): boolean { return this.app.debug; }
    public get endpoint(): string { return this._endpoint; }
    public get protocol(): string { return this.config.get(ServerParameter.Protocol); }

    public start(): Promise<void> {
        if (this.isRunning) throw new Error('server is running already');

        const protocol = this.protocol;

        switch (protocol) {
            case Protocol.HTTP:
                break;

            case Protocol.HTTPS:
                if (!this.config.has(ServerParameter.Key))
                    throw new Error(`missing config parameter '${ServerParameter.Key}'`);

                if (!FS.existsSync(this.config.get(ServerParameter.Key)))
                    throw new Error(`ssl key at '${this.config.get(ServerParameter.Key)}' does not exist`);

                if (!this.config.has(ServerParameter.Cert))
                    throw new Error(`missing config parameter '${ServerParameter.Cert}'`);

                if (!FS.existsSync(this.config.get(ServerParameter.Cert)))
                    throw new Error(`ssl certificate at '${this.config.get(ServerParameter.Cert)}' does not exist`);
                break;

            default:
                this.onMessage.emit(this, `not started (unsupported protocol '${protocol}')`);
                return Promise.resolve();
        }

        const defaultResponseHeaders = Object.assign({}, this.config.get(ServerParameter.ResponseHeaders));

        const host = this.config.get<string>(ServerParameter.Host);
        const port = this.config.get<number>(ServerParameter.Port);

        const server = protocol == Protocol.HTTP
            ? HTTP.createServer((request, response) => this.onRequest(request, response))
            : HTTPS.createServer({
                key: FS.readFileSync(this.config.get(ServerParameter.Key)),
                cert: FS.readFileSync(this.config.get(ServerParameter.Cert))
            }, (request, response) => this.onRequest(request, response));

        server.on('error', error => this.onError.emit(this, error));
        server.listen({ host, port });

        this._endpoint = `${protocol}://${host}:${port}/`;

        this._responseHeaders = defaultResponseHeaders;
        this._allowedRequestHeaders = this.config.get<string[]>(ServerParameter.AllowedRequestHeaders);
        this._allowedOrigins = this.config.get<string[]>(ServerParameter.AllowedOrigins)

        if (0 == this._allowedOrigins.length)
            this._allowedOrigins = ['*'];

        defaultResponseHeaders[CoreJS.ResponseHeader.AllowHeaders] = this._allowedRequestHeaders.join(',');
        defaultResponseHeaders[CoreJS.ResponseHeader.AllowOrigin] = this._allowedOrigins.join(',');

        this._textInfoResponse = new CoreJS.TextResponse(this.toString());
        this._htmlInfoResponse = new CoreJS.HTMLResponse(this.toHTML());
        this._jsonInfoResponse = new CoreJS.Response(JSON.stringify(this), CoreJS.ResponseType.JSON, CoreJS.ResponseCode.OK);

        this.onMessage.emit(this, `listen on '${this._endpoint}' (debug mode: ${CoreJS.parseFromBool(this.debug)})`);

        return new Promise<void>(resolve => this._stopAction = () => {
            server.close();
            this._stopAction = null;
            this.onMessage.emit(this, 'stopped');
            resolve();
        });
    }

    public stop(): void {
        if (!this.isRunning)
            return;

        this._stopAction();
    }

    public toString() {
        let result = `${this.app.name} v${this.app.version} by ${this.app.author}\n`;

        if (this.app.description)
            result += `\n${this.app.description}\n`;

        if (this.app.repository)
            result += '\n' + this.app.repository + '\n';

        result += `\nEndpoint: ${this.endpoint}\n`;

        if (this._allowedRequestHeaders.length) {
            result += '\nAllowed Request Headers:\n';
            result += this._allowedRequestHeaders.join('\n');
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
            allowedRequestHeaders: this._allowedRequestHeaders,
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

        if (this._allowedRequestHeaders.length) {
            result += '<h3>Allowed Headers</h3>';
            result += this._allowedRequestHeaders.join('</br>');
        }

        result += '<h3>Routes</h3>';
        result += Object.values(appData.routes).map(route => `<h4><a href="${this.endpoint}/${route.path}">/${route.path}</a></h4><p>${route.description}</p><table><tr><th colspan=5>Parameters</th><tr><th>Name</th><th>Type</th><th>Description</th><th>Optional</th><th>Default</th></tr>${Object.values(route.parameters).map(param => `<tr><td><b>${param.name}</b></td><td>${param.type}</td><td>${param.description}</td><td>${param.optional}</td><td>${param.optional ? param.def : ''}</td></tr>`).join('')}</table>`).join('');

        return result;
    }

    private async onRequest(request: HTTP.IncomingMessage, response: HTTP.ServerResponse) {
        const stopwatch = new CoreJS.Stopwatch();

        stopwatch.start();

        const responseHeaders: NodeJS.Dict<HTTP.OutgoingHttpHeader> = Object.assign({}, this._responseHeaders);

        responseHeaders[CoreJS.ResponseHeader.ContentType] = CoreJS.ResponseType.Text;

        // catch invalid origins
        if (!this._allowedOrigins.includes(request.headers.origin) && !this._allowedOrigins.includes('*')) {
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
        this._allowedRequestHeaders.forEach(key => args[key] = request.headers[key]);

        const result: CoreJS.Response = route
            ? await this.app.execute(route, args)
            : args.html
                ? this._htmlInfoResponse
                : args.text
                    ? this._textInfoResponse
                    : this._jsonInfoResponse;

        responseHeaders[CoreJS.ResponseHeader.ContentType] = result.type;

        response.writeHead(result.code, responseHeaders);
        response.end(result.data);

        stopwatch.stop();

        this.onMessage.emit(this, `'${ip}' requested '${request.url}' duration ${CoreJS.formatDuration(stopwatch.duration, { seconds: true, milliseconds: true })}`);
    }
}
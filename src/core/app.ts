/**
 * Aplenture/AppJS
 * https://github.com/Aplenture/AppJS
 * Copyright (c) 2023 Aplenture
 * MIT License https://github.com/Aplenture/AppJS/blob/main/LICENSE
 */

import * as CoreJS from "corejs";
import * as ModuleJS from "modulejs";

interface RouteData {
    readonly name: string;
    readonly paths: readonly string[];
}

interface Route {
    readonly name: string;
    readonly paths: readonly {
        readonly module: ModuleJS.Module<any, any, any>;
        readonly command: string;
    }[];
}

export class App {
    public static readonly PARAMETER_DEBUG = 'debug';
    public static readonly PARAMETER_NAME = 'name';
    public static readonly PARAMETER_VERSION = 'version';
    public static readonly PARAMETER_AUTHOR = 'author';
    public static readonly PARAMETER_DESCRIPTION = 'description';
    public static readonly PARAMETER_MODULES = 'modules';
    public static readonly PARAMETER_CLASS = 'class';
    public static readonly PARAMETER_PATH = 'path';
    public static readonly PARAMETER_OPTIONS = 'options';

    public static readonly Parameters: readonly CoreJS.Parameter<any>[] = [
        new CoreJS.BoolParameter(App.PARAMETER_DEBUG, 'enables/disables debug mode', false),
        new CoreJS.StringParameter(App.PARAMETER_NAME, 'name of the app'),
        new CoreJS.StringParameter(App.PARAMETER_VERSION, 'version of the app', '1.0'),
        new CoreJS.StringParameter(App.PARAMETER_AUTHOR, 'author of the app', ''),
        new CoreJS.StringParameter(App.PARAMETER_DESCRIPTION, 'description of the app', ''),
        new CoreJS.ArrayParameter<string>(App.PARAMETER_MODULES, 'installed app modules', new CoreJS.DictionaryParameter('', '', [
            new CoreJS.StringParameter(App.PARAMETER_CLASS, 'class name of the module'),
            new CoreJS.StringParameter(App.PARAMETER_PATH, 'to the module class'),
            new CoreJS.DictionaryParameter(App.PARAMETER_OPTIONS, 'from the module', [], {})
        ]), [])
    ];

    public static readonly InvalidRouteResponse = new CoreJS.ErrorResponse(CoreJS.ResponseCode.Forbidden, '#_invalid_route');

    public readonly onMessage = new CoreJS.Event<App, string>('App.onMessage');
    public readonly onError = new CoreJS.Event<App, Error>('App.onError');

    private readonly modules: readonly ModuleJS.Module<any, any, any>[] = [];

    private _routes: readonly Route[] = [];

    private _description: string;
    private _descriptionResponse: CoreJS.TextResponse;

    constructor(public readonly config: CoreJS.Config, args: NodeJS.ReadOnlyDict<any> = CoreJS.Args) {
        this.modules = config.get<ReadonlyArray<CoreJS.LoadModuleConfig & { readonly options?: any; }>>(App.PARAMETER_MODULES).map(data => {
            try {
                const module = CoreJS.loadModule<ModuleJS.Module<any, any, any>>(data, args, data.options);

                module.onMessage.on(message => this.onMessage.emit(this, message));

                return module;
            } catch (error) {
                const coreError = CoreJS.CoreError.parseFromError<any>(error);

                if (CoreJS.CoreErrorCode.MissingParameter == coreError.code)
                    throw new Error(`missing option '${coreError.data.name}' for module '${data.path}/${data.class}'`);

                throw error;
            }
        });

        this.updateDescription();
    }

    public get name(): string { return this.config.get(App.PARAMETER_NAME); }
    public get debug(): boolean { return this.config.get(App.PARAMETER_DEBUG); }
    public get version(): string { return this.config.get(App.PARAMETER_VERSION); }
    public get author(): string { return this.config.get(App.PARAMETER_AUTHOR); }
    public get description(): string { return this._description; }
    public get routes(): readonly Route[] { return this._routes; }

    public async init() {
        this.onMessage.emit(this, `initializing app '${this.name}'`);

        await this.modules.forEach(module => module.init());

        this.updateDescription();
    }

    public async load(...routes: readonly RouteData[]) {
        this.onMessage.emit(this, `loading app '${this.name}'`);

        try {
            this._routes = this.routes.concat(...routes.map((data, routeIndex) => {
                if (!data.name)
                    throw new Error(`route at index '${routeIndex}' has invalid name`);

                this.onMessage.emit(this, `loading app route '${data.name}'`);

                if (!data.paths || !data.paths.length)
                    throw new Error(`route '${data.name}' needs to have at least one path`);

                return {
                    name: data.name,
                    paths: data.paths.map((path, pathIndex) => {
                        const split = path.split(' ');

                        if (!split[0])
                            throw new Error(`missing module name for route at index '${routeIndex}' and path at index '${pathIndex}'`)

                        const moduleName = split[0].toLowerCase();
                        const module = this.modules.find(module => module.name.toLowerCase() === moduleName);

                        if (!module)
                            throw new Error(`module with name '${split[0]}' does not exist`);

                        const command = split[1];

                        if (!command)
                            throw new Error(`missing command for module route at index '${routeIndex}' and path at index '${pathIndex}'`)

                        return {
                            module,
                            command
                        };
                    })
                };
            }));
        } catch (error) {
            this.onError.emit(this, error);
            throw error;
        }

        this.updateDescription();
    }

    public async execute(route?: string, args?: NodeJS.ReadOnlyDict<any>): Promise<CoreJS.Response> {
        if (!route)
            return this._descriptionResponse;

        route = route.toLowerCase();

        const routeData = this._routes.find(tmp => tmp.name === route);

        if (!routeData)
            if (this.debug)
                return App.InvalidRouteResponse
            else
                return CoreJS.RESPONSE_NO_CONTENT;

        try {
            for (let i = 0, d = routeData.paths[i], r; i < routeData.paths.length; ++i, d = routeData.paths[i])
                if (r = await d.module.execute(d.command, args))
                    return r;
        } catch (error) {
            this.onError.emit(this, error);

            return error.constructor.name == CoreJS.CoreError.name
                ? new CoreJS.ErrorResponse(CoreJS.ResponseCode.Forbidden, error.message)
                : new CoreJS.ErrorResponse(CoreJS.ResponseCode.InternalServerError, '#_something_went_wrong');
        }
    }

    private updateDescription() {
        this._description = `${this.config.get(App.PARAMETER_NAME)} v${this.config.get(App.PARAMETER_VERSION)} by ${this.config.get(App.PARAMETER_AUTHOR)}\n`;

        if (this.config.has(App.PARAMETER_DESCRIPTION))
            this._description += '\n' + this.config.get(App.PARAMETER_DESCRIPTION) + '\n';

        this._description += '\nRoutes:\n';
        this._routes.forEach(route => this._description += route.name + '\n');

        this._descriptionResponse = new CoreJS.TextResponse(this._description);
    }
}
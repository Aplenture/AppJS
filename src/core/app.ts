/**
 * Aplenture/AppJS
 * https://github.com/Aplenture/AppJS
 * Copyright (c) 2023 Aplenture
 * MIT License https://github.com/Aplenture/AppJS/blob/main/LICENSE
 */

import * as BackendJS from "backendjs";
import * as CoreJS from "corejs";

interface RouteData {
    readonly description?: string;
    readonly paths: readonly string[];
}

interface Route {
    readonly description: string;
    readonly paths: readonly {
        readonly module: BackendJS.Module.Module<any, any, any>;
        readonly command: string;
        readonly args: NodeJS.ReadOnlyDict<any>;
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
        new CoreJS.StringParameter(App.PARAMETER_NAME, 'name of the app', '<my_app_name>'),
        new CoreJS.StringParameter(App.PARAMETER_VERSION, 'version of the app', '1.0'),
        new CoreJS.StringParameter(App.PARAMETER_AUTHOR, 'author of the app', '<author_name>'),
        new CoreJS.StringParameter(App.PARAMETER_DESCRIPTION, 'description of the app', '<my_app_description>'),
        new CoreJS.ArrayParameter<string>(App.PARAMETER_MODULES, 'installed app modules', new CoreJS.DictionaryParameter('', '', [
            new CoreJS.StringParameter(App.PARAMETER_CLASS, 'class name of the module'),
            new CoreJS.StringParameter(App.PARAMETER_PATH, 'to the module class'),
            new CoreJS.DictionaryParameter(App.PARAMETER_OPTIONS, 'from the module', [], {})
        ]), [])
    ];

    public readonly onMessage = new CoreJS.Event<App, string>('App.onMessage');
    public readonly onError = new CoreJS.Event<App, Error>('App.onError');

    private readonly modules: readonly BackendJS.Module.Module<any, any, any>[] = [];
    private readonly invalidRouteResponse: CoreJS.ErrorResponse;

    private _routes: NodeJS.Dict<Route> = {};

    private _description: string;
    private _descriptionResponse: CoreJS.TextResponse;

    constructor(public readonly config: CoreJS.Config, args: NodeJS.ReadOnlyDict<any> = {}) {
        this.invalidRouteResponse = this.debug
            ? new CoreJS.ErrorResponse(CoreJS.ResponseCode.Forbidden, '#_invalid_route')
            : CoreJS.RESPONSE_NO_CONTENT;

        this.modules = config.get<ReadonlyArray<CoreJS.LoadModuleConfig & { readonly options?: any; }>>(App.PARAMETER_MODULES).map(data => {
            try {
                const module = CoreJS.loadModule<BackendJS.Module.Module<any, any, any>>(data, args, data.options);

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
    public get routes(): NodeJS.ReadOnlyDict<Route> { return this._routes; }

    public async init() {
        await Promise.all(this.modules.map(module => {
            this.onMessage.emit(this, `init module ${this.name}/${module.name}`);

            return module.init();
        }));

        this.updateDescription();
    }

    public async deinit() {
        await Promise.all(this.modules.map(module => {
            this.onMessage.emit(this, `deinit module ${this.name}/${module.name}`);

            return module.deinit();
        }));
    }

    public async load(routes: NodeJS.ReadOnlyDict<RouteData>) {
        try {
            Object.keys(routes).forEach((name, routeIndex) => {
                const data = routes[name];

                if (!name)
                    throw new Error(`route at index '${routeIndex}' has invalid name`);

                this.onMessage.emit(this, `loading route ${this.name}/${name}`);

                if (!data.paths || !data.paths.length)
                    throw new Error(`route '${name}' needs to have at least one path`);

                const description = data.description || '';

                this._routes[name.toLowerCase()] = {
                    description,
                    paths: data.paths.map((path, pathIndex) => {
                        const split = path.split(' ');

                        if (!split[0])
                            throw new Error(`missing module name of route '${name}' at path index '${pathIndex}'`)

                        const moduleName = split[0].toLowerCase();
                        const module = this.modules.find(module => module.name.toLowerCase() === moduleName);

                        if (!module)
                            throw new Error(`module with name '${split[0]}' does not exist`);

                        const command = split[1];

                        if (!command)
                            throw new Error(`missing command of route '${name}' at path index '${pathIndex}'`)

                        const args = CoreJS.parseArgsFromString(split.slice(2).join(' '));

                        return {
                            module,
                            command,
                            args
                        };
                    })
                };
            });
        } catch (error) {
            this.onError.emit(this, error);
            throw error;
        }

        this.updateDescription();
    }

    public async execute(route?: string, args?: NodeJS.ReadOnlyDict<any>): Promise<CoreJS.Response> {
        if (!route)
            return this._descriptionResponse;

        const routeData = this._routes[route.toLowerCase()];

        if (!routeData)
            return this.invalidRouteResponse;

        try {
            for (let i = 0, d = routeData.paths[i], r; i < routeData.paths.length; ++i, d = routeData[i])
                if (r = await d.module.execute(d.command, Object.assign(args, d.args)))
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
        this._description += Object.keys(this._routes).map(route => `${route} - ${this._routes[route].description}`).join('\n');

        this._descriptionResponse = new CoreJS.TextResponse(this._description);
    }
}
/**
 * Aplenture/AppJS
 * https://github.com/Aplenture/AppJS
 * Copyright (c) 2023 Aplenture
 * MIT License https://github.com/Aplenture/AppJS/blob/main/LICENSE
 */

import * as BackendJS from "backendjs";
import * as CoreJS from "corejs";

export enum AppParameter {
    Name = 'name',
    Version = 'version',
    Author = 'author',
    Description = 'description',
    Repository = 'repository',
    Modules = 'modules',
    Class = 'class',
    Path = 'path',
    Options = 'options',
    Routes = 'routes'
}

const DEFAULT_MODULES: ModuleData[] = [{
    class: "Module",
    path: "./node_modules/backendjs/dist/account/core/module",
    options: {
        name: "account",
        databaseConfig: {
            host: "localhost",
            user: "dev",
            password: "",
            database: "my_app_database"
        }
    }
}];

const DEFAULT_ROUTES: NodeJS.ReadOnlyDict<RouteData> = {
    update: {
        description: "updates all modules",
        paths: [
            "account update"
        ]
    },
    reset: {
        description: "resets all modules",
        paths: [
            "account reset"
        ]
    },
    revert: {
        description: "reverts all modules",
        paths: [
            "account revert"
        ]
    },
    hasaccess: {
        description: "checks whether access is valid",
        paths: [
            "account hasaccess"
        ]
    },
    createAccount: {
        description: "creates a new account",
        paths: [
            "account createAccount"
        ]
    },
    login: {
        description: "account login",
        paths: [
            "account login"
        ]
    },
    logout: {
        description: "account logout",
        paths: [
            "account validate --rights 1",
            "account logout"
        ]
    },
    changePassword: {
        description: "changes the password from the account",
        paths: [
            "account validate --rights 1",
            "account changePassword"
        ]
    },
    getAccesses: {
        description: "returns all open accesses from the account",
        paths: [
            "account validate --rights 1",
            "account getAccesses"
        ]
    },
    createAccess: {
        description: "creates a new access",
        paths: [
            "account validate --rights 1",
            "account createAccess"
        ]
    },
    deleteAccess: {
        description: "deletes an existing access",
        paths: [
            "account validate --rights 1",
            "account deleteAccess"
        ]
    }
};

interface RouteData {
    readonly description?: string;
    readonly paths: readonly string[];
}

interface Route {
    readonly description: string;
    readonly parameters: CoreJS.ParameterList;
    readonly paths: readonly {
        readonly module: BackendJS.Module.Module<any, any, any>;
        readonly command: string;
        readonly args: NodeJS.ReadOnlyDict<any>;
    }[];
}

type ModuleData = BackendJS.LoadModuleConfig & { readonly options?: any; };

export class App {
    public readonly onMessage = new CoreJS.Event<App, string>('App.onMessage');
    public readonly onError = new CoreJS.Event<App, Error>('App.onError');

    private _initialized = false;
    private _modules: readonly BackendJS.Module.Module<any, any, any>[] = [];
    private _routes: NodeJS.Dict<Route> = {};
    private _invalidRouteResponse: CoreJS.ErrorResponse;

    constructor(public readonly config: CoreJS.Config) {
        config.onChange.on(() => this.onDebugChanged(this.debug), { args: BackendJS.Module.GlobalParamterName.Debug });

        // add global module parameters to config
        BackendJS.Module.GlobalParameters.forEach(param => config.add(param));

        config.add(new CoreJS.StringParameter(AppParameter.Name, 'name of the app', '<my_app_name>'));
        config.add(new CoreJS.StringParameter(AppParameter.Version, 'version of the app', '1.0'));
        config.add(new CoreJS.StringParameter(AppParameter.Author, 'author of the app', '<author_name>'));
        config.add(new CoreJS.StringParameter(AppParameter.Description, 'description of the app', '<my_app_description>'));
        config.add(new CoreJS.StringParameter(AppParameter.Repository, 'repository of the app', 'https://github.com/Aplenture/AppJS.git'));
        config.add(new CoreJS.ArrayParameter<ModuleData>(AppParameter.Modules, 'installed app modules', new CoreJS.DictionaryParameter('', '', [
            new CoreJS.StringParameter(AppParameter.Class, 'class name of the module'),
            new CoreJS.StringParameter(AppParameter.Path, 'to the module class'),
            new CoreJS.DictionaryParameter(AppParameter.Options, 'from the module', [], {})
        ]), DEFAULT_MODULES));

        config.add(new CoreJS.DictionaryParameter(AppParameter.Routes, 'all executable routes', undefined, DEFAULT_ROUTES));

        this.onDebugChanged(this.debug);
    }

    public get isInitialized(): boolean { return this._initialized; }
    public get name(): string { return this.config.get(AppParameter.Name); }
    public get debug(): boolean { return this.config.get(BackendJS.Module.GlobalParamterName.Debug); }
    public get version(): string { return this.config.get(AppParameter.Version); }
    public get author(): string { return this.config.get(AppParameter.Author); }
    public get description(): string { return this.config.get(AppParameter.Description); }
    public get repository(): string { return this.config.get(AppParameter.Repository); }
    public get routes(): NodeJS.ReadOnlyDict<Route> { return this._routes; }

    public async init(args: NodeJS.ReadOnlyDict<any> = {}) {
        const routes = this.config.get<NodeJS.ReadOnlyDict<RouteData>>(AppParameter.Routes);

        this._initialized = true;

        this.onMessage.emit(this, `init`);

        this._routes = {};
        this._modules = this.config.get<readonly ModuleData[]>(AppParameter.Modules).map(data => {
            try {
                const module = BackendJS.loadModule<BackendJS.Module.Module<any, any, any>>(data, args, data.options);

                module.onMessage.on((message, sender) => this.onMessage.emit(this, `${sender.name} module - ${message}`));

                return module;
            } catch (error) {
                const coreError = CoreJS.CoreError.parseFromError<any>(error);

                if (CoreJS.CoreErrorCode.MissingParameter == coreError.code)
                    throw new Error(`missing option '${coreError.data.name}' for module '${data.path}/${data.class}'`);

                throw error;
            }
        });

        await Promise.all(this._modules.map(module => module.init()));

        const moduleDatas = this._modules.map(module => module.toJSON());

        Object.keys(routes).forEach((name, routeIndex) => {
            const data = routes[name];

            if (!name)
                throw new Error(`route at index '${routeIndex}' has invalid name`);

            this.onMessage.emit(this, `loading route '${name}'`);

            if (!data.paths || !data.paths.length)
                throw new Error(`route '${name}' needs to have at least one path`);

            const description = data.description || '';
            const parameters = [];
            const routeArgs = [];

            const paths = data.paths.map((path, pathIndex) => {
                const split = path.split(' ');

                if (!split[0])
                    throw new Error(`missing module name of route '${name}' at path index '${pathIndex}'`)

                const moduleName = split[0].toLowerCase();
                const module = this._modules.find(module => module.name.toLowerCase() === moduleName);

                if (!module)
                    throw new Error(`module with name '${split[0]}' does not exist`);

                const command = split[1].toLowerCase();

                if (!command)
                    throw new Error(`missing command of route '${name}' at path index '${pathIndex}'`);

                if (!module.has(command))
                    throw new Error(`invalid command '${command}' of route '${name}' at path index '${pathIndex}'`);

                const args = CoreJS.parseArgsFromString(split.slice(2).join(' '));
                const moduleData = moduleDatas.find(data => data.name.toLowerCase() == moduleName);
                const commandData = moduleData.commands.find(tmp => tmp.name.toLowerCase() == command);

                // add all command parameters to serialization
                if (commandData.parameters)
                    for (const key in commandData.parameters)
                        if (!parameters.some(param => param.name.toLowerCase() == key.toLowerCase()))
                            parameters.push(commandData.parameters[key]);

                for (const key in args)
                    if (!routeArgs.includes(key))
                        routeArgs.push(key.toLowerCase());

                return {
                    module,
                    command,
                    args
                };
            });

            // remove all route args from serialization
            routeArgs.forEach(key => {
                const index = parameters.findIndex(param => param.name.toLowerCase() == key);

                if (0 > index)
                    return;

                parameters.splice(index, 1);
            });

            this._routes[name.toLowerCase()] = {
                description,
                parameters: new CoreJS.ParameterList(...parameters),
                paths
            };
        });
    }

    public async deinit() {
        if (!this._initialized)
            return;

        this._initialized = false;

        this.onMessage.emit(this, `deinit`);

        await Promise.all(this._modules.map(module => module.deinit()));

        this._routes = {};
        this._modules = [];
    }

    public async execute(route?: string, args?: NodeJS.ReadOnlyDict<any>): Promise<CoreJS.Response> {
        if (!route)
            return new CoreJS.TextResponse(this.toString());

        const routeData = this._routes[route.toLowerCase()];

        if (!routeData)
            return this._invalidRouteResponse;

        try {
            // parse args by all route command params
            // to prevent securtiy leaks
            args = routeData.parameters.parse(args, {}, true);

            for (let i = 0, d = routeData.paths[i], r: CoreJS.Response | void; i < routeData.paths.length; ++i, d = routeData.paths[i]) {
                // parse args by route path args
                Object.assign(args, d.args);

                // execute route commands until any command returns a reponse
                if (r = await d.module.execute(d.command, args))
                    return r;
            }
        } catch (error) {
            this.onError.emit(this, error);

            return error.constructor.name == CoreJS.CoreError.name
                ? new CoreJS.ErrorResponse(CoreJS.ResponseCode.Forbidden, error.message)
                : new CoreJS.ErrorResponse(CoreJS.ResponseCode.InternalServerError, '#_something_went_wrong');
        }
    }

    private onDebugChanged(debug: boolean) {
        this._invalidRouteResponse = this.debug
            ? new CoreJS.ErrorResponse(CoreJS.ResponseCode.Forbidden, '#_invalid_route')
            : CoreJS.RESPONSE_NO_CONTENT;
    }

    public toString() {
        let result = `${this.name} v${this.version} by ${this.author}\n`;

        if (this.description)
            result += '\n' + this.description + '\n';

        if (this.repository)
            result += '\n' + this.repository + '\n';

        result += '\nRoutes:\n';
        result += Object.keys(this._routes).map(route => `${route} - ${this._routes[route].description}`).join('\n') + '\n';

        return result;
    }

    public toJSON() {
        return {
            name: this.name,
            version: this.version,
            author: this.author,
            description: this.description,
            repository: this.repository,
            routes: Object.keys(this._routes).map(path => ({
                path,
                description: this._routes[path].description,
                parameters: this._routes[path].parameters.toJSON()
            }))
        };
    }
}
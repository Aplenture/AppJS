/**
 * Aplenture/AppJS
 * https://github.com/Aplenture/AppJS
 * Copyright (c) 2023 Aplenture
 * MIT License https://github.com/Aplenture/AppJS/blob/main/LICENSE
 */

import * as BackendJS from "backendjs";
import * as CoreJS from "corejs";

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
    public static readonly PARAMETER_DEBUG = 'debug';
    public static readonly PARAMETER_NAME = 'name';
    public static readonly PARAMETER_VERSION = 'version';
    public static readonly PARAMETER_AUTHOR = 'author';
    public static readonly PARAMETER_DESCRIPTION = 'description';
    public static readonly PARAMETER_REPOSITORY = 'repository';
    public static readonly PARAMETER_MODULES = 'modules';
    public static readonly PARAMETER_CLASS = 'class';
    public static readonly PARAMETER_PATH = 'path';
    public static readonly PARAMETER_OPTIONS = 'options';
    public static readonly PARAMETER_ROUTES = 'routes';

    public static readonly Parameters: readonly CoreJS.Parameter<any>[] = [
        new CoreJS.BoolParameter(App.PARAMETER_DEBUG, 'enables/disables debug mode', false),
        new CoreJS.StringParameter(App.PARAMETER_NAME, 'name of the app', '<my_app_name>'),
        new CoreJS.StringParameter(App.PARAMETER_VERSION, 'version of the app', '1.0'),
        new CoreJS.StringParameter(App.PARAMETER_AUTHOR, 'author of the app', '<author_name>'),
        new CoreJS.StringParameter(App.PARAMETER_DESCRIPTION, 'description of the app', '<my_app_description>'),
        new CoreJS.StringParameter(App.PARAMETER_REPOSITORY, 'repository of the app', 'https://github.com/Aplenture/AppJS.git'),
        new CoreJS.ArrayParameter<ModuleData>(App.PARAMETER_MODULES, 'installed app modules', new CoreJS.DictionaryParameter('', '', [
            new CoreJS.StringParameter(App.PARAMETER_CLASS, 'class name of the module'),
            new CoreJS.StringParameter(App.PARAMETER_PATH, 'to the module class'),
            new CoreJS.DictionaryParameter(App.PARAMETER_OPTIONS, 'from the module', [], {})
        ]), DEFAULT_MODULES),
        new CoreJS.DictionaryParameter(App.PARAMETER_ROUTES, 'all executable routes', undefined, DEFAULT_ROUTES)
    ];

    public readonly onMessage = new CoreJS.Event<App, string>('App.onMessage');
    public readonly onError = new CoreJS.Event<App, Error>('App.onError');

    private readonly modules: readonly BackendJS.Module.Module<any, any, any>[] = [];
    private readonly invalidRouteResponse: CoreJS.ErrorResponse;

    private _routes: NodeJS.Dict<Route> = {};

    constructor(public readonly config: CoreJS.Config, args: NodeJS.ReadOnlyDict<any> = {}) {
        this.invalidRouteResponse = this.debug
            ? new CoreJS.ErrorResponse(CoreJS.ResponseCode.Forbidden, '#_invalid_route')
            : CoreJS.RESPONSE_NO_CONTENT;

        this.modules = config.get<readonly ModuleData[]>(App.PARAMETER_MODULES).map(data => {
            try {
                const module = BackendJS.loadModule<BackendJS.Module.Module<any, any, any>>(data, args, data.options);

                module.onMessage.on(message => this.onMessage.emit(this, message));

                return module;
            } catch (error) {
                const coreError = CoreJS.CoreError.parseFromError<any>(error);

                if (CoreJS.CoreErrorCode.MissingParameter == coreError.code)
                    throw new Error(`missing option '${coreError.data.name}' for module '${data.path}/${data.class}'`);

                throw error;
            }
        });
    }

    public get name(): string { return this.config.get(App.PARAMETER_NAME); }
    public get debug(): boolean { return this.config.get(App.PARAMETER_DEBUG); }
    public get version(): string { return this.config.get(App.PARAMETER_VERSION); }
    public get author(): string { return this.config.get(App.PARAMETER_AUTHOR); }
    public get description(): string { return this.config.get(App.PARAMETER_DESCRIPTION); }
    public get repository(): string { return this.config.get(App.PARAMETER_REPOSITORY); }
    public get routes(): NodeJS.ReadOnlyDict<Route> { return this._routes; }

    public async init() {
        const routes = this.config.get<NodeJS.ReadOnlyDict<RouteData>>(App.PARAMETER_ROUTES);

        for (const key in this._routes)
            delete this._routes[key];

        await Promise.all(this.modules.map(module => {
            this.onMessage.emit(this, `init module ${this.name}/${module.name}`);

            return module.init();
        }));

        const moduleDatas = this.modules.map(module => module.toJSON());

        Object.keys(routes).forEach((name, routeIndex) => {
            const data = routes[name];

            if (!name)
                throw new Error(`route at index '${routeIndex}' has invalid name`);

            this.onMessage.emit(this, `loading route ${this.name}/${name}`);

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
                const module = this.modules.find(module => module.name.toLowerCase() === moduleName);

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
        for (const key in this._routes)
            delete this._routes[key];

        await Promise.all(this.modules.map(module => {
            this.onMessage.emit(this, `deinit module ${this.name}/${module.name}`);

            return module.deinit();
        }));
    }

    public async execute(route?: string, args?: NodeJS.ReadOnlyDict<any>): Promise<CoreJS.Response> {
        if (!route)
            return new CoreJS.TextResponse(this.toString());

        const routeData = this._routes[route.toLowerCase()];

        if (!routeData)
            return this.invalidRouteResponse;

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
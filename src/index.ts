/**
 * Aplenture/AppJS
 * https://github.com/Aplenture/AppJS
 * Copyright (c) 2023 Aplenture
 * MIT License https://github.com/Aplenture/AppJS/blob/main/LICENSE
 */

import * as BackendJS from "backendjs";
import * as CoreJS from "corejs";
import * as ModuleJS from "modulejs";
import { App, Server } from "./core";

const PARAMETER_PUBLIC_ROUTES = 'publicRoutes';
const PARAMETER_PRIVATE_ROUTES = 'privateRoutes';

process.on('exit', code => code && log.write("exit with code " + code));
process.on('SIGINT', () => process.exit());
process.on('SIGUSR1', () => process.exit());
process.on('SIGUSR2', () => process.exit());
process.on('uncaughtException', error => log.error(error));
process.on('unhandledRejection', reason => log.error(reason instanceof Error ? reason : reason ? new Error(reason.toString()) : new Error()));

const log = BackendJS.Log.createFileLog('./log.log');
const config = new CoreJS.Config(...App.Parameters);
const commander = new CoreJS.Commander();
const infos: any = CoreJS.loadConfig('package.json');
const commandLine = process.argv.slice(2).join(' ');

// add public app routes parameter to config
config.add(new CoreJS.ArrayParameter<string>(PARAMETER_PUBLIC_ROUTES, 'all routes which are executable from the server', new CoreJS.DictionaryParameter('', '', [
    new CoreJS.StringParameter('name', 'name of route'),
    new CoreJS.ArrayParameter('paths', 'all maodules and commands to call on this route (i.e. "my_module_name ping")', new CoreJS.StringParameter('', ''))
]), []));

// add private app routes parameter to config
config.add(new CoreJS.ArrayParameter<string>(PARAMETER_PRIVATE_ROUTES, 'all routes which are executable only from cli', new CoreJS.DictionaryParameter('', '', [
    new CoreJS.StringParameter('name', 'name of route'),
    new CoreJS.ArrayParameter('paths', 'all maodules and commands to call on this route (i.e. "my_module_name ping")', new CoreJS.StringParameter('', ''))
]), []));

// setup config by server parameters
Server.Parameters.forEach(param => config.add(param));

// setup config by global module parameters
ModuleJS.GlobalParameters.forEach(param => config.add(param));

log.write('loading package.json');
config.set(App.PARAMETER_VERSION, infos.version);

log.write('loading config.json');
config.deserialize(CoreJS.loadConfig());

log.write('loading process args');
config.deserialize(CoreJS.Args);

commander.set({
    name: 'help',
    description: 'Lists all commands or returns details of specific <command>.',
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('command', 'Lists all commands with this prefix or returns details of specific command.', '')
    ),
    execute: async args => {
        const app = new App(config, args);

        app.onError.on(error => process.stdout.write(error.stack));
        app.onError.on((error: any) => process.exit(error.code));

        await app.init();
        await app.load(...config.get<any[]>(PARAMETER_PUBLIC_ROUTES));

        return app.description;
    }
});

commander.set({
    name: 'start',
    description: "starts the server",
    execute: async args => {
        const app = new App(config, args);
        const server = new Server(app, config);

        process.title = app.name;

        app.onMessage.on(message => log.write(message));
        app.onError.on(error => log.error(error));

        server.onMessage.on(message => log.write(message));
        server.onError.on(error => log.error(error));

        await app.init();
        await app.load(...config.get<any[]>(PARAMETER_PUBLIC_ROUTES));
        await server.start();

        return "server stopped";
    }
});

commander.set({
    name: 'exec',
    description: 'executes public and private commands',
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('command', 'will be executed', '')
    ),
    execute: async args => {
        const app = new App(config, args);

        process.title = `${app.name} ${commandLine}`;

        app.onMessage.on(message => log.write(message));
        app.onError.on(error => log.error(error));

        await app.init();
        await app.load(
            ...config.get<any[]>(PARAMETER_PUBLIC_ROUTES),
            ...config.get<any[]>(PARAMETER_PRIVATE_ROUTES)
        );

        const response = await app.execute(args.command, args);

        return response.data;
    }
});

commander.set({
    name: 'config',
    description: "returns the config",
    execute: async () => config.serialize()
});

commander
    .executeLine(commandLine)
    .then(result => process.stdout.write(result))
    .catch(error => process.stdout.write(error.stack))
    .then(() => process.exit());
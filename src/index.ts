/**
 * Aplenture/AppJS
 * https://github.com/Aplenture/AppJS
 * Copyright (c) 2023 Aplenture
 * MIT License https://github.com/Aplenture/AppJS/blob/main/LICENSE
 */

import * as BackendJS from "backendjs";
import * as CoreJS from "corejs";
import * as FS from "fs";
import * as HTTP from "http";
import * as ModuleJS from "modulejs";
import { App, Server } from "./core";

const PARAMETER_PUBLIC_ROUTES = 'publicRoutes';
const PARAMETER_PRIVATE_ROUTES = 'privateRoutes';

const command = process.argv[2];
const route = process.argv[3] && 0 != process.argv[3].indexOf('-')
    ? process.argv[3]
    : '';

const args = CoreJS.parseArgsFromString(process.argv.slice(route ? 4 : 3).join(' '));

process.on('exit', code => code && log.write("exit with code " + code));
process.on('SIGINT', () => log.close().then(() => process.exit()));
process.on('SIGUSR1', () => log.close().then(() => process.exit()));
process.on('SIGUSR2', () => log.close().then(() => process.exit()));
process.on('uncaughtException', error => log.error(error));
process.on('unhandledRejection', reason => log.error(reason instanceof Error ? reason : reason ? new Error(reason.toString()) : new Error()));

const log = BackendJS.Log.createFileLog('./log.log');
const config = new CoreJS.Config(...App.Parameters, ...Server.Parameters, ...ModuleJS.GlobalParameters);
const commander = new CoreJS.Commander();
const infos: any = CoreJS.loadConfig('package.json');
const commandLine = process.argv.slice(2).join(' ');

// add routes parameters to config
config.add(new CoreJS.DictionaryParameter(PARAMETER_PUBLIC_ROUTES, 'all routes which are executable from the server', undefined, {}));
config.add(new CoreJS.DictionaryParameter(PARAMETER_PRIVATE_ROUTES, 'all routes which are executable only from cli', undefined, {}));

log.write('loading package.json');
config.set(App.PARAMETER_VERSION, infos.version);

log.write('loading config.json');
config.deserialize(CoreJS.loadConfig());

log.write('loading process args');
config.deserialize(args);

// commander.set({
//     name: 'help',
//     description: 'lists all commands or returns details of specific <command>',
//     parameters: new CoreJS.ParameterList(
//         new CoreJS.StringParameter('command', 'Lists all commands with this prefix or returns details of specific command.', '')
//     ),
//     execute: async args => {
//         const app = new App(config, args);

//         app.onError.on(error => process.stdout.write(error.stack));
//         app.onError.on((error: any) => process.exit(error.code));

//         await app.init();
//         await app.load(...config.get<any[]>(PARAMETER_PUBLIC_ROUTES));

//         return app.description;
//     }
// });

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
        await app.load(config.get(PARAMETER_PUBLIC_ROUTES));
        await server.start();

        return "server stopped";
    }
});

commander.set({
    name: 'exec',
    description: 'executes public and private commands',
    execute: async args => {
        const app = new App(config, args);

        process.title = `${app.name} ${commandLine}`;

        app.onMessage.on(message => log.write(message));
        app.onError.on(error => log.error(error));

        await app.init();
        await app.load(config.get(PARAMETER_PUBLIC_ROUTES));
        await app.load(config.get(PARAMETER_PRIVATE_ROUTES));

        const response = await app.execute(route, args);

        return response.data;
    }
});

commander.set({
    name: 'request',
    description: 'sends request to the server',
    execute: async args => new Promise<string>((resolve, reject) => {
        const params = CoreJS.URLArgsToString(args);
        const path = params
            ? `/${route}?${params}`
            : `/${route}`;

        const request = HTTP.request({
            host: config.get(Server.PARAMETER_HOST),
            port: config.get(Server.PARAMETER_PORT),
            path,
            method: 'GET'
        }, response => {
            let data = '';

            response.on('error', reject);
            response.on('data', chunk => data += chunk);
            response.on('close', () => {
                switch (response.statusCode) {
                    case CoreJS.ResponseCode.OK:
                        resolve(data.toString());
                        break;

                    default:
                        resolve(`Error ${response.statusCode}: ${data.toString()}`);
                        break;
                }
            });
        });

        request.on('error', reject);
        request.end();
    })
});

commander.set({
    name: 'config',
    description: "returns the config",
    parameters: new CoreJS.ParameterList(
        new CoreJS.StringParameter('type', 'serialization type', null),
        new CoreJS.NumberParameter('space', 'serialization option space', null),
        new CoreJS.StringParameter('write', 'writes the config to specific file path', null),
        new CoreJS.BoolParameter('overwrite', 'if true, existing config will be overwritten', false)
    ),
    execute: async args => {
        const data = config.serialize(args.type || CoreJS.SerializationType.JSON, args);

        if (!args.write)
            return data;

        if (FS.existsSync(args.write) && !args.overwrite)
            return `config at '${args.write}' exists already`;

        FS.writeFileSync(args.write, data);

        return `config written to '${args.write}'`;
    }
});

commander
    .execute(command, args)
    .then(result => process.stdout.write(result))
    .catch(error => process.stdout.write(error.stack))
    .then(() => log.close())
    .then(() => process.exit()); 